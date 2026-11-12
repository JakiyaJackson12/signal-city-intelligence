"""SIGNAL interactive transit map and simulated ML anomaly analysis.
Live MBTA vehicle positions do not establish actual arrival delays.
"""
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from sklearn.ensemble import IsolationForest

BASE = Path(__file__).resolve().parent
PROJECT = BASE.parent

def extract_js(name):
    source = (PROJECT / "demo-data.js").read_text()
    matched = re.search(r"const\s+" + name + r"\s*=\s*", source)
    if not matched:
        raise RuntimeError(f"Missing {name} in demo-data.js")
    return json.JSONDecoder().raw_decode(source[matched.end():].lstrip())[0]

DEMO_VEHICLES = extract_js("DEMO_VEHICLES")
DEMO_HISTORY = extract_js("DEMO_HISTORY")
ALLOWED = {"Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E"}

def create_app(database: Path | None = None, serve_frontend=True):
    app = FastAPI(title="SIGNAL City Intelligence", version="0.2.0", docs_url="/api/docs")
    db_file = database or Path(os.getenv("SIGNAL_DB", str(BASE / "signal_observations.db")))
    db_file.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_file, check_same_thread=False)
    db.execute("CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, observed_at TEXT, mode TEXT, vehicle_id TEXT, route TEXT, lat REAL, lon REAL, delay_minutes REAL)")
    db.commit()
    db_lock = Lock()
    cache = {"when": 0, "vehicles": []}

    @app.get("/api/health")
    def health():
        return {"ok": True, "data": "simulated or publicly observed", "backend": "FastAPI/SQLite/scikit-learn"}

    def live_vehicles():
        if time.time() - cache["when"] < 55 and cache["vehicles"]:
            return cache["vehicles"], True
        url = "https://api-v3.mbta.com/vehicles?" + urlencode({
            "filter[route]": "Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E",
            "page[limit]": 150,
        })
        headers = {"User-Agent": "SIGNAL-portfolio-demo/0.2", "Accept": "application/vnd.api+json"}
        if os.getenv("MBTA_API_KEY"):
            headers["x-api-key"] = os.environ["MBTA_API_KEY"]
        try:
            with urlopen(Request(url, headers=headers), timeout=8) as response:
                payload = json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            raise HTTPException(503, "Live MBTA unavailable. Try simulated demo mode.") from exc
        vehicles = []
        for item in payload.get("data", []):
            attrs = item.get("attributes", {})
            lat, lon = attrs.get("latitude"), attrs.get("longitude")
            route = item.get("relationships", {}).get("route", {}).get("data") or {}
            code = route.get("id", "Unknown")
            if lat is None or lon is None:
                continue
            vehicles.append({
                "id": item["id"], "route": code, "lat": lat, "lon": lon,
                "delay_minutes": None, "status": "UNKNOWN", "heading": attrs.get("bearing")
            })
        cache.update(when=time.time(), vehicles=vehicles)
        return vehicles, False

    @app.get("/api/snapshot")
    def snapshot(mode: str = Query("demo", pattern="^(demo|live)$"), route: str = ""):
        if route and route not in ALLOWED:
            raise HTTPException(422, "Unknown route")
        if mode == "demo":
            vehicles, from_cache = DEMO_VEHICLES, False
        else:
            vehicles, from_cache = live_vehicles()
        vehicles = [v for v in vehicles if not route or v["route"] == route]
        delays = [v["delay_minutes"] for v in vehicles if v.get("delay_minutes") is not None]
        ontime = sum(1 for value in delays if value < 6)
        now = datetime.now(timezone.utc).isoformat()
        with db_lock:
            db.executemany(
                "INSERT INTO observations(observed_at,mode,vehicle_id,route,lat,lon,delay_minutes) VALUES (?,?,?,?,?,?,?)",
                [(now, mode, v["id"], v["route"], v["lat"], v["lon"], v.get("delay_minutes")) for v in vehicles],
            )
            db.commit()
        return {
            "vehicles": vehicles,
            "summary": {
                "vehicles": len(vehicles),
                "avg_delay_minutes": round(sum(delays) / len(delays), 1) if delays else None,
                "on_time_pct": round(100 * ontime / len(delays)) if delays else None,
            },
            "timestamp": now,
            "source": "synthetic FastAPI dataset" if mode == "demo" else "MBTA public vehicle positions",
            "cache_hit": from_cache,
        }

    @app.get("/api/history")
    def history(mode: str = Query("demo", pattern="^(demo|live)$"), route: str = ""):
        if mode == "demo":
            return {"points": [p for p in DEMO_HISTORY if not route or p["route"] == route], "source": "synthetic"}
        return {"points": [], "source": "live positions only; no observed delay values"}

    @app.get("/api/anomalies")
    def anomalies(mode: str = Query("demo", pattern="^(demo|live)$")):
        if mode != "demo":
            return {"available": False, "reason": "Live MBTA delay measurements are not available; model remains demo-only."}
        import numpy as np
        samples = [[float(v.get("delay_minutes") or 0)] for v in DEMO_VEHICLES]
        model = IsolationForest(n_estimators=100, contamination=0.14, random_state=42)
        flagged = model.fit_predict(np.array(samples))
        found = [
            {"route": v["route"], "delay_minutes": v["delay_minutes"]}
            for v, prediction in zip(DEMO_VEHICLES, flagged) if prediction == -1
        ]
        found.sort(key=lambda x: x["delay_minutes"], reverse=True)
        return {
            "available": True,
            "method": "IsolationForest",
            "training_samples": len(samples),
            "source": "simulated",
            "anomalies": found[:8],
            "caveat": "Anomaly detection is trained on synthetic demo delays, not validated on real MBTA delays.",
        }

    @app.get("/api/observations")
    def observations():
        with db_lock:
            count = db.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
            recent = db.execute(
                "SELECT observed_at,mode,vehicle_id,route,lat,lon,delay_minutes "
                "FROM observations ORDER BY id DESC LIMIT 10"
            ).fetchall()
        return {
            "count": count,
            "recent": [
                {
                    "observed_at": r[0], "mode": r[1], "vehicle_id": r[2],
                    "route": r[3], "latitude": r[4], "longitude": r[5],
                    "delay_minutes": r[6],
                } for r in recent
            ],
        }

    if serve_frontend:
        app.mount("/", StaticFiles(directory=str(PROJECT), html=True), name="ui")
    return app

app = create_app()
