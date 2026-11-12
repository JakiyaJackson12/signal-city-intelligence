/* Map-first interaction, independent of backend mode. */
(() => {
 const panel=document.querySelector('.map-panel');
 const expand=document.getElementById('map-expand');
 const reset=document.getElementById('map-reset');
 const zoomIn=document.getElementById('map-zoom-in');
 const zoomOut=document.getElementById('map-zoom-out');
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function resize(){if(state.map)setTimeout(()=>state.map.invalidateSize(),70)}
 function toggle(){
  const open=panel.classList.toggle('map-fullscreen');
  document.body.classList.toggle('map-open',open);
  expand.setAttribute('aria-pressed',String(open));
  expand.textContent=open?'✕ Exit full map':'⛶ Expand map';
  if(open)expand.focus();resize();
 }
 expand.addEventListener('click',toggle);
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&panel.classList.contains('map-fullscreen'))toggle()});
 reset.addEventListener('click',()=>{if(state.map)state.map.flyTo([42.3601,-71.0589],11,{animate:!reduced,duration:0.7});else if(window.signalFallbackZoom)window.signalFallbackZoom(0.01)});
 zoomIn.addEventListener('click',()=>{if(state.map)state.map.zoomIn();else window.signalFallbackZoom?.(1.35)});
 zoomOut.addEventListener('click',()=>{if(state.map)state.map.zoomOut();else window.signalFallbackZoom?.(1/1.35)});
 document.querySelector('.vehicle-feed')?.addEventListener('click',ev=>{
  const row=ev.target.closest('.vehicle-row');if(!row||!state.map)return;
  const v=state.vehicles.find(item=>String(item.id)===row.dataset.vehicleId);if(!v)return;
  state.selectedVehicleId=String(v.id);
  state.map.flyTo([v.lat,v.lon],15,{animate:!reduced,duration:0.8});
  state.markers?.eachLayer(marker=>{if(marker.getLatLng().lat===Number(v.lat)&&marker.getLatLng().lng===Number(v.lon))marker.openPopup();});
  document.getElementById('map')?.scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'});
 });
})();
