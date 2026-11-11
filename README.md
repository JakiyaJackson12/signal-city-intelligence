# SIGNAL City Intelligence

An interactive transit intelligence prototype with a Leaflet map, route filtering, vehicle selection, and simulated anomaly analysis.

## What you can explore

- Pan and zoom a real street map, select vehicle markers, filter routes, or focus a vehicle from the activity list.
- Use a synthetic demonstration fleet in the static frontend.
- Run the FastAPI backend for REST endpoints, optional live MBTA position retrieval, SQLite observation logs, and scikit-learn Isolation Forest analysis over **synthetic delay values**.
- Graceful map tile and offline SVG fallbacks.

**Data accuracy:** Demo locations and anomaly/delay figures are simulated. Live MBTA vehicle positions may be fetched only when the backend is running and the provider is available. This project does not calculate official arrival times or live delays.

## Stack

JavaScript, HTML, CSS, Leaflet, Python, FastAPI, SQLite, scikit-learn / Isolation Forest.

## Run the static frontend

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. Leaflet library and map tiles require internet connectivity.

## Run full-stack

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

## Tests

```bash
PYTHONPATH=api python -m pytest api/tests/test_api.py -q
```

## Deployment and limitations

The public portfolio includes a **static interactive preview**. A separately hosted Python backend is required to expose backend endpoints and run Isolation Forest for visitors. This repo does not claim that the full-stack backend is publicly deployed. The latest map fixes have not yet been verified across every live browser/tile provider.

Created by Jakiya Jackson.
