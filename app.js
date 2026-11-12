'use strict';
const ROUTE_COLORS = {'Red':'#f35a60','Orange':'#ffac52','Blue':'#55a7f8','Green-B':'#57cdaf','Green-C':'#57cdaf','Green-D':'#57cdaf','Green-E':'#57cdaf'};
const $ = id => document.getElementById(id);
const state = {mode:'demo',route:'',map:null,markers:null,pending:false,backend:false,vehicles:[],selectedVehicleId:null,hasFit:false};
function safeText(v) {return v === null || v === undefined ? 'N/A' : String(v);}
function color(route) {return ROUTE_COLORS[route] || '#b1cbd9';}
function setStatus(message,error=false){$('notice').innerHTML='';const icon=document.createElement('span');icon.className='notice-icon';icon.textContent=error?'⚠':'ⓘ';const s=document.createElement('span');s.textContent=message;$('notice').append(icon,s);}
async function getJSON(path){
 if(state.backend){
  const response=await fetch(path,{cache:'no-store'});
  const data=await response.json().catch(()=>({detail:'Invalid API response'}));
  if(!response.ok)throw new Error(data.detail||`HTTP ${response.status}`);
  return data;
 }
 const u=new URL(path,location.href);const route=u.searchParams.get('route');
 if(u.searchParams.get('mode')==='live'){throw new Error('Live MBTA requires the separately hosted Python backend. This portfolio preview uses simulated data.')}
 if(u.pathname.endsWith('/api/snapshot')){let v=DEMO_VEHICLES.filter(x=>!route||x.route===route);const a=v.map(x=>x.delay_minutes);return {vehicles:v,summary:{vehicles:v.length,avg_delay_minutes:a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):null,on_time_pct:v.length?Math.round(v.filter(x=>x.delay_minutes<6).length/v.length*100):null},timestamp:new Date().toISOString(),source:'synthetic portfolio preview',cache_hit:false};}
 if(u.pathname.endsWith('/api/history'))return {points:DEMO_HISTORY.filter(x=>!route||x.route===route)};
 if(u.pathname.endsWith('/api/anomalies'))return DEMO_MODEL;
const r=await fetch(path,{cache:'no-store'});let value;try{value=await r.json()}catch{throw new Error('Server returned an invalid response.')}if(!r.ok)throw new Error(typeof value.detail==='string'?value.detail:`Request failed (${r.status})`);return value;}
function fmt(n,suffix=''){return n == null?'N/A':`${n}${suffix}`;}
// Set up a real street map. If the provider fails, keep vehicle dots visible
// against a neutral geographic grid instead of showing broken tiles.
function initMap() {
    const mapElement = $('map');

    if (!window.L) {
        showCoordinateFallback(mapElement);
        return;
    }

    state.map = L.map('map', {
        zoomControl: false,
        preferCanvas: true
    }).setView([42.3601, -71.0589], 11);

    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // Primary tiles plus an independent, credited backup provider.
    // A failed external tile CDN must not leave the map permanently blank.
    const tileOptions = {maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'};
    let activeTiles;
    let failed = 0;
    let switched = false;
    function mountTiles(url, options) {
        const layer = L.tileLayer(url, {...tileOptions, ...options});
        layer.on('tileerror', () => {
            failed += 1;
            if (failed < 3) return;
            if (!switched) {
                switched = true;
                failed = 0;
                state.map.removeLayer(activeTiles);
                setStatus('Switching to backup map tiles. Vehicle locations remain interactive.');
                mountTiles('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
                });
            } else {
                mapElement.classList.add('map-tiles-unavailable');
                setStatus('Street tiles could not be loaded. Vehicle pins and zoom controls remain available.');
            }
        });
        layer.on('tileload', () => {failed=0; mapElement.classList.remove('map-tiles-unavailable');});
        activeTiles=layer.addTo(state.map);
    }
    mountTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    state.markers = L.layerGroup().addTo(state.map);
    // Recompute tile geometry after cards finish their responsive layout.
    requestAnimationFrame(() => state.map.invalidateSize());
    window.addEventListener('resize', () => state.map.invalidateSize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) state.map.invalidateSize(); });
}

// Works without Leaflet or any external map services. This is a geographic
// coordinate plot, NOT a replacement for the street map.
function showCoordinateFallback(container) {
    container.classList.add('map-coordinate-fallback');
    const info = document.createElement('div');
    info.className = 'coordinate-info';
    info.textContent = 'Boston geographic coordinate view · Street map unavailable';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 900 450');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Transit positions plotted by Boston geographic coordinates');
    svg.id = 'fallbackPlot';
    container.replaceChildren(svg, info);
    // Offline geographic plot: native pointer pan + wheel/pinch-independent zoom via viewBox.
    let x=0,y=0,scale=1,last=null;
    const update=()=>{svg.setAttribute('viewBox',`${x} ${y} ${900/scale} ${450/scale}`)};
    const clamp=()=>{const w=900/scale,h=450/scale;x=Math.max(0,Math.min(900-w,x));y=Math.max(0,Math.min(450-h,y));};
    svg.addEventListener('pointerdown',e=>{last={x:e.clientX,y:e.clientY};svg.setPointerCapture(e.pointerId);svg.style.cursor='grabbing'});
    svg.addEventListener('pointermove',e=>{if(!last)return;let rect=svg.getBoundingClientRect();x-=(e.clientX-last.x)*900/(rect.width*scale);y-=(e.clientY-last.y)*450/(rect.height*scale);last={x:e.clientX,y:e.clientY};clamp();update()});
    svg.addEventListener('pointerup',()=>{last=null;svg.style.cursor='grab'});
    svg.addEventListener('pointercancel',()=>{last=null;svg.style.cursor='grab'});
    svg.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(1,Math.min(5,scale*(e.deltaY<0?1.2:1/1.2)));clamp();update()},{passive:false});
    window.signalFallbackZoom=(factor)=>{scale=Math.max(1,Math.min(5,scale*factor));clamp();update()};
}

function drawFallbackVehicles(vehicles) {
    const svg = $('fallbackPlot');
    if (!svg) return;
    svg.replaceChildren();
    for (let i=1;i<8;i++) {const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',String(i*112.5));line.setAttribute('x2',String(i*112.5));line.setAttribute('y1','0');line.setAttribute('y2','450');line.setAttribute('stroke','#416079');line.setAttribute('stroke-opacity','.35');svg.append(line);}
    for (let i=1;i<5;i++) {const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('y1',String(i*90));line.setAttribute('y2',String(i*90));line.setAttribute('x1','0');line.setAttribute('x2','900');line.setAttribute('stroke','#416079');line.setAttribute('stroke-opacity','.35');svg.append(line);}
    const minLat = 42.25, maxLat = 42.46, minLon = -71.19, maxLon = -70.94;
    for (const vehicle of vehicles) {
        const lat = Number(vehicle.lat), lon = Number(vehicle.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
            lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(30 + (lon-minLon)/(maxLon-minLon)*840));
        dot.setAttribute('cy', String(20 + (maxLat-lat)/(maxLat-minLat)*410));
        dot.setAttribute('r','5');
        dot.setAttribute('fill',color(vehicle.route));
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${vehicle.route} ${vehicle.id}`;
        dot.appendChild(title);
        svg.appendChild(dot);
    }
}
function drawMap(vehicles){state.vehicles=vehicles;if(!state.markers){drawFallbackVehicles(vehicles);return;}state.markers.clearLayers();const bounds=[];for(const v of vehicles){
 if(!Number.isFinite(Number(v.lat)) || !Number.isFinite(Number(v.lon))) continue;
 bounds.push([v.lat,v.lon]);
 const c=color(v.route);
 const div=L.divIcon({className:'',html:`<div class="vehicle-marker" style="background:${c}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});
 const m=L.marker([v.lat,v.lon],{icon:div});
 const container=document.createElement('div');const b=document.createElement('b');b.textContent=`${v.route} · ${v.id}`;const p=document.createElement('p');p.textContent=v.delay_minutes==null?'Delay: not available':`Demo delay: ${v.delay_minutes} min`;container.append(b,p);
 m.bindPopup(container);m.addTo(state.markers);
 if(v.id===state.selectedVehicleId) m.openPopup();
} 
 if(bounds.length && !state.hasFit){ state.map.fitBounds(bounds,{padding:[40,40],maxZoom:12});state.hasFit=true; }
 requestAnimationFrame(()=>state.map.invalidateSize());
}
function setMode(mode){state.mode=mode;$('demoBtn').classList.toggle('selected',mode==='demo');$('liveBtn').classList.toggle('selected',mode==='live');$('demoBtn').setAttribute('aria-pressed',String(mode==='demo'));$('liveBtn').setAttribute('aria-pressed',String(mode==='live'));
 $('sourceNote').textContent=mode==='demo'?'Simulated data · For demonstration':'Requires hosted Python backend';$('dataSource').textContent=mode.toUpperCase();$('sourceFoot').textContent=mode==='demo'?'Synthetic demonstration feed':'MBTA V3 public API';$('mapMode').textContent=mode==='demo'?'SIMULATED':'LIVE MBTA';$('historyBadge').textContent=mode==='demo'?'DEMO HISTORY':'COLLECTED HISTORY';
 setStatus(mode==='demo'?'Demo mode: simulated positions, delays and history. Not real MBTA measurements.':'Live mode: actual MBTA vehicle positions. Vehicle lateness is unknown until schedule/prediction data are integrated.');loadAll();}
function renderSummary(s){$('vehiclesCount').textContent=fmt(s.vehicles);$('avgDelay').textContent=fmt(s.avg_delay_minutes,s.avg_delay_minutes==null?'':' min');$('onTime').textContent=fmt(s.on_time_pct,s.on_time_pct==null?'':'%');}
function renderFeed(vehicles){const container=$('vehicleFeed');container.replaceChildren();if(!vehicles.length){const p=document.createElement('div');p.className='empty';p.textContent='No vehicles returned for this filter.';container.append(p);return;}
 for(const v of vehicles.slice(0,18)){const row=document.createElement('button');row.type='button';row.className='vehicle-row';row.dataset.vehicleId=String(v.id);row.setAttribute('aria-label',`Focus map on ${v.route} vehicle ${v.id}`);const label=document.createElement('div');label.className='vehicle-label';const tag=document.createElement('span');tag.className='route-tag';tag.style.background=color(v.route);tag.textContent=v.route.replace('Green-','G-');const detail=document.createElement('div');const title=document.createElement('strong');title.textContent=v.id;const sub=document.createElement('small');sub.textContent=`${Number(v.lat).toFixed(3)}, ${Number(v.lon).toFixed(3)}`;detail.append(title,sub);label.append(tag,detail);const status=document.createElement('div');status.className='vehicle-state '+(v.status==='DELAYED'?'bad':v.status==='ON TIME'?'good':'unknown');status.textContent=v.status;const value=document.createElement('small');value.textContent=v.delay_minutes==null?'Delay unknown':`${v.delay_minutes} min observed`;status.append(value);row.append(label,status);container.append(row);}
}
function renderHistory(points){const sums=new Map();for(const p of points){const v=sums.get(p.route)||{sum:0,count:0};if(p.avg_delay !=null){v.sum+=p.avg_delay*p.observations;v.count+=p.observations;}sums.set(p.route,v);}const items=[...sums].map(([route,v])=>({route,delay:v.count?v.sum/v.count:0})).sort((a,b)=>b.delay-a.delay).slice(0,6);const bars=$('routeBars');bars.replaceChildren();if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='No historical measurements collected for this mode yet.';bars.append(p);return;}const max=Math.max(...items.map(i=>i.delay),1);for(const item of items){const row=document.createElement('div');row.className='bar-row';const n=document.createElement('span');n.className='bar-label';n.textContent=item.route;const track=document.createElement('div');track.className='bar-track';const fill=document.createElement('div');fill.className='bar-fill';fill.style.width=`${Math.round(item.delay/max*100)}%`;fill.style.background=color(item.route);track.append(fill);const val=document.createElement('span');val.className='bar-value';val.textContent=`${item.delay.toFixed(1)}m`;row.append(n,track,val);bars.append(row);}}
function renderML(ml){$('modelResults').replaceChildren();if(!ml.available){$('modelStatus').textContent='MODEL NOT READY';$('modelCaveat').textContent=ml.reason;return;}$('modelStatus').textContent=`● ${ml.method} · ${ml.training_samples} ${ml.source.toUpperCase()} observations`;$('modelCaveat').textContent=ml.caveat;for(const o of ml.anomalies.slice(0,4)){const line=document.createElement('div');line.className='model-item';const text=document.createElement('span');text.textContent=`${o.route} · unusual observation`;const b=document.createElement('b');b.textContent=`${Number(o.delay_minutes).toFixed(1)} min`;line.append(text,b);$('modelResults').append(line);}}
async function loadAll(){if(state.pending)return;state.pending=true;$('refreshBtn').disabled=true;$('updated').textContent='Refreshing…';const query=new URLSearchParams({mode:state.mode});if(state.route)query.set('route',state.route);try{const [snapshot,history,ml]=await Promise.all([getJSON('/api/snapshot?'+query),getJSON('/api/history?'+query),getJSON('/api/anomalies?mode='+state.mode)]);
 renderSummary(snapshot.summary);renderFeed(snapshot.vehicles);drawMap(snapshot.vehicles);renderHistory(history.points);renderML(ml);$('mapCount').textContent=`${snapshot.vehicles.length} vehicles`;$('updated').textContent=`Updated ${new Date(snapshot.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;$('feedStatus').textContent=snapshot.cache_hit?'Cached provider response':'Last refreshed from '+snapshot.source;$('feedBadge').textContent=state.mode==='demo'?'DEMO FEED':'AGENCY FEED';
}catch(error){$('updated').textContent='Unable to refresh';setStatus(error.message,true);$('vehiclesCount').textContent='—';$('avgDelay').textContent='—';$('onTime').textContent='—';$('vehicleFeed').replaceChildren();const p=document.createElement('div');p.className='empty';p.textContent='No data available. Try Demo network or refresh again.';$('vehicleFeed').append(p);if(state.markers)state.markers.clearLayers();}finally{state.pending=false;$('refreshBtn').disabled=false;}}
async function start(){
 try{const health=await fetch('/api/health',{cache:'no-store'});const data=health.ok?await health.json():{};state.backend=!!(data.ok&&data.backend&&data.backend.includes('FastAPI'))}catch{state.backend=false}
 $('liveBtn').disabled=!state.backend;
 if(!state.backend){$('sourceNote').textContent='Offline static preview · simulated data';setStatus('Interactive map available; synthetic vehicle positions. FastAPI backend is not connected on this static preview.');}
 $('currentDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});initMap();for(const route of Object.keys(ROUTE_COLORS)){const o=document.createElement('option');o.value=route;o.textContent=route;$('routeSelect').append(o);} $('routeSelect').addEventListener('change',e=>{state.route=e.target.value;loadAll();});$('demoBtn').addEventListener('click',()=>setMode('demo'));$('liveBtn').addEventListener('click',()=>setMode('live'));$('refreshBtn').addEventListener('click',loadAll);await loadAll();}
start();
