import * as maplibregl from './vendor/maplibre-gl.mjs';
import { TrafficExplorer } from './traffic-ui.js';
import { defaultPeriods, equalizePeriods } from './periods.js';
import { normalizeRoadName, prepareRecord, comparePeriods, validatePeriods, periodDays, geometryLines, buildRoadGraph, snapToRoad, routeBetween } from './analysis.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const severityColors = { damage: '#b99750', injury: '#d4684a', fatal: '#8b324c', unknown: '#7d8e98' };
const severityLabels = { damage: 'Property damage', injury: 'Non-fatal injury', fatal: 'Fatal injury', unknown: 'Severity unknown' };
const empty = () => ({ type: 'FeatureCollection', features: [] });
const state = { map: null, all: [], records: new Map(), visibleIds: new Set(), candidates: [], bounds: null, ready: false, selectedId: null, view: 'both', road: null, roadFeatures: [], graph: null, start: null, end: null, segment: null, picking: null, markers: [], result: null, trafficUI: null, wards: new Map(), activeWard: null };
const node = (tag, text, className) => { const n = document.createElement(tag); if (className) n.className = className; n.textContent = text; return n; };
const showDate = (date) => date ? dateFmt.format(new Date(`${date}T12:00:00Z`)) : 'Not reported';
const pretty = (value) => String(value || '').split(/\s+/).map((p) => /^(I-?\d+|US|MA|NB|SB|EB|WB|[0-9]+)$/i.test(p) ? p : p[0]?.toUpperCase() + p.slice(1).toLowerCase()).join(' ');
const signed = (n, format = fmt) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${format.format(Math.abs(n))}`;
const percent = (n) => n === null ? 'n/a (A = 0)' : `${signed(n, decimal)}%`;
function errorAt(id, message) { $(id).textContent = message || ''; $(id).hidden = !message; }

function boundsFor(features) {
  const bounds = new maplibregl.LngLatBounds();
  const visit = (xy) => typeof xy[0] === 'number' ? bounds.extend(xy) : xy.forEach(visit);
  features.forEach((f) => visit(f.geometry.coordinates));
  return bounds;
}
function fitBounds(bounds, maxZoom = 15) {
  if (!bounds) return;
  const height = state.map.getContainer().clientHeight;
  state.map.fitBounds(bounds, { padding: { top: Math.min(125, height * .23), bottom: Math.min(165, height * .27), left: 30, right: 35 }, maxZoom, duration: reducedMotion ? 0 : 550 });
}
function closeDetails() {
  state.selectedId = null; state.candidates = [];
  $('crash-detail').hidden = true;
  state.map?.getSource('selected')?.setData(empty());
}
function uniqueVisible(features) {
  return [...new Map(features.map((f) => [String(f.properties.id), state.records.get(String(f.properties.id))])).values()].filter((f) => f && state.visibleIds.has(f.properties.id)).sort((a,b) => b.properties.date.localeCompare(a.properties.date) || b.properties.id.localeCompare(a.properties.id));
}
function showCrash(feature, candidates = [feature], move = false) {
  state.trafficUI?.closeDetails();
  if(!$('crashes-visible').checked){$('crashes-visible').checked=true;updateCrashVisibility();}
  const p = feature.properties, content = $('detail-content');
  state.selectedId = p.id; state.candidates = uniqueVisible(candidates);
  content.replaceChildren();
  const tag = node('span', severityLabels[p.group], `severity-tag ${p.group}-tag`); tag.prepend(document.createElement('i'));
  content.append(tag, node('h2', showDate(p.date), 'detail-date'), node('p', p.time || 'Time not reported', 'detail-time'), node('h3', [p.number, pretty(p.street) || 'Location not reported'].filter(Boolean).join(' '), 'detail-location'));
  if (p.nearby) content.append(node('p', `Near ${pretty(p.nearby)}`, 'detail-nearby'));
  const counts = node('div', '', 'count-grid');
  for (const [label, value] of [['Vehicles',p.vehicles],['Injuries',p.injuries],['Fatalities',p.fatalities]]) { const box = node('div',''); box.append(node('strong',value == null ? '—' : fmt.format(value)),node('span',label)); counts.append(box); }
  content.append(counts);
  const facts = node('dl', '', 'detail-facts');
  for (const [label,value] of [['Ward (2022 boundaries)',p.ward?`Ward ${p.ward}`:'Outside ward polygons'],['Collision type',p.collision],['Maximum injury reported',p.injurySeverity],['Weather',p.weather],['Light conditions',p.light],['Road surface',p.surface],...(p.roadUsers ? [['Bicycle / pedestrian report',p.roadUsers]] : [])]) { const row=node('div',''); row.append(node('dt',label),node('dd',value || 'Not reported')); facts.append(row); }
  content.append(facts);
  if (p.status !== 'Closed') content.append(node('p','Provisional record. Details may change as MassDOT updates the data.','record-note'));
  if (p.locationCheck === 'outside_city') content.append(node('p','Reported as a Newton crash; its coordinates fall outside the municipal outline.','record-note'));
  content.append(node('p',`MassDOT crash #${p.id} · ${p.status || 'Status not reported'}`,'detail-source'));
  $('same-location').hidden = state.candidates.length < 2;
  $('crash-choice').replaceChildren();
  if (state.candidates.length > 1) {
    $('crash-choice-label').textContent = `${state.candidates.length} matching crashes here`;
    state.candidates.forEach((f) => { const option=node('option',`${showDate(f.properties.date)} · ${f.properties.time || 'Unknown time'} · #${f.properties.id}`); option.value=f.properties.id; option.selected=f.properties.id===p.id; $('crash-choice').append(option); });
  }
  $('crash-detail').hidden = false; $('crash-detail').scrollTop = 0;
  state.map.getSource('selected').setData({ type:'FeatureCollection',features:[feature] });
  if (move) state.map.easeTo({ center:feature.geometry.coordinates,zoom:Math.max(16.5,state.map.getZoom()),offset:innerWidth>640?[-100,0]:[0,-40],duration:reducedMotion?0:550 });
}

function readFilters() {
  const equalizationError=syncTimeframes();
  const a={start:$('a-start').value,end:$('a-end').value},b={start:$('b-start').value,end:$('b-end').value};
  const error=equalizationError||validatePeriods(a,b,state.coverage);
  errorAt('date-error',error ? `${error} Results still show the last valid comparison.` : null);
  if (error) return null;
  const numbered = state.road && /^(I-|ROUTE )/.test(state.road.key);
  const matchKeys = new Set([state.road?.key]);
  if (numbered) state.roadFeatures.forEach((f)=>f.properties.keys.forEach((key)=>matchKeys.add(key)));
  return { a,b,ward:$('ward-filter').value || null,severities:new Set([...document.querySelectorAll('input[name=severity]:checked')].map((i)=>i.value)),involvement:$('involvement').value,roadKey:state.road?.key || null,roadMatchKeys:matchKeys,routeLines:numbered?state.roadFeatures.flatMap(geometryLines):null,segment:state.segment?.coordinates || null,tolerance:+$('match-distance').value,mapPeriod:state.view };
}
function resetTimeframes() {
  const defaults=defaultPeriods(state.coverage);
  if(defaults.error)throw new Error(defaults.error);
  state.autoAEnd=true;$('equalize-timeframes').checked=true;
  for(const name of ['a','b'])for(const edge of ['start','end'])$(`${name}-${edge}`).value=defaults[name][edge];
  syncTimeframes();
}
function syncTimeframes() {
  const enabled=$('equalize-timeframes').checked;
  let a={start:$('a-start').value,end:$('a-end').value},b={start:$('b-start').value,end:$('b-end').value},error=null;
  $('a-start').readOnly=enabled;
  $('a-start-caption').textContent=enabled?'From (calculated)':'From';
  if(enabled){
    const matched=equalizePeriods(a,b,{autoEnd:state.autoAEnd,coverage:state.coverage});
    a=matched.a;error=matched.error;
    if(a.start)$('a-start').value=a.start;
    if(a.end)$('a-end').value=a.end;
  }
  const valid=!error&&!validatePeriods(a,b,state.coverage);
  $('timeframe-lengths').textContent=valid?(enabled?`${fmt.format(periodDays(a))} ${periodDays(a)===1?'day':'days'} each. B controls the length.`:`A: ${fmt.format(periodDays(a))} days · B: ${fmt.format(periodDays(b))} days. Dates are independent.`):'Enter valid dates within the available data window.';
  $('timeframe-anchor-note').textContent=!enabled?'Check the box to match A’s day count to B.':state.autoAEnd?'A’s end defaults to B’s season before 2020.':'A stays anchored to your chosen end date.';
  return error;
}
function updateWardScope(filters) {
  state.activeWard=filters.ward?state.wards.get(String(filters.ward)):null;
  state.map.getSource('ward-selection').setData({type:'FeatureCollection',features:state.activeWard?[state.activeWard]:[]});
  $('fit-ward').disabled=!state.activeWard;
  $('ward-location-note').hidden=!state.activeWard;
  if(state.activeWard){
    const eligible=comparePeriods(state.all,{...filters,ward:null,mapPeriod:'both'});
    const outside=eligible.points.filter(f=>f.properties.ward==null).length;
    $('ward-location-note').textContent=`Ward totals require coordinates. Unassignable across both periods: ${fmt.format(eligible.unlocated)} unlocated records; ${fmt.format(outside)} points outside all 2022 wards. Other filters apply.`;
  }
}
function fitSelectedWard() { if(state.activeWard)fitBounds(boundsFor([state.activeWard]),15); }
function renderAnnual(years) {
  const chart=$('annual-chart'); chart.replaceChildren();
  const max=Math.max(1,...years.flatMap((y)=>[y.a,y.b]));
  years.forEach((y)=>{ const row=node('div','','year-row'); row.append(node('span',`${y.year}${y.year===2026?'*':''}`)); const bars=node('div','','year-bars'); for (const p of ['a','b']) {const bar=node('i','',p);bar.style.width=`${y[p]/max*100}%`;bars.append(bar);}row.append(bars,node('span',`${y.a} / ${y.b}`,'year-values')); row.title=`${y.year}: Period A ${y.a}, Period B ${y.b}`;chart.append(row); });
  chart.setAttribute('aria-label',years.map((y)=>`${y.year}: A ${y.a}, B ${y.b}`).join('; '));
}
function applyAnalysis() {
  if (!state.ready) return;
  const filters=readFilters(); if (!filters) return;
  closeDetails();
  const result=comparePeriods(state.all,filters); state.result=result; state.filters=filters;
  state.visibleIds=new Set(result.points.map((f)=>f.properties.id));
  for (const p of ['a','b']) {
    $(`metric-${p}-dates`).textContent=`${showDate(filters[p].start)} – ${showDate(filters[p].end)}`;
    $(`metric-${p}-total`).textContent=fmt.format(result[p].total);
    $(`metric-${p}-annual`).textContent=`${decimal.format(result[p].perYear)} crashes / year · ${fmt.format(result[p].unlocated)} unlocated`;
  }
  $('metric-delta').textContent=`${signed(result.delta)} (${percent(result.percent)})`;
  $('metric-annual-delta').textContent=`Per-year change: ${percent(result.annualPercent)}`;
  $('scope-label').textContent=state.road ? `${pretty(state.road.label)} · ${state.segment ? `selected segment (${decimal.format(state.segment.lengthMeters/1609.344)} mi)` : 'whole road'}` : 'All Newton roads';
  if(filters.ward)$('scope-label').textContent=`Ward ${filters.ward} · ${$('scope-label').textContent}`;
  const view=state.view==='both'?'A + B':`Period ${state.view.toUpperCase()}`;
  let description=`${view}: ${fmt.format(result.points.length)} mapped · ${fmt.format(result.unlocated)} unlocated`;
  if (state.segment) {
    const unlocated=comparePeriods(state.all,{...filters,segment:null}).unlocated;
    description+=` · ${fmt.format(unlocated)} unlocated whole-road records cannot be assigned to this segment`;
  }
  $('map-count').textContent=description;
  $('overlap-note').hidden=!result.overlap;
  $('empty-state').hidden=result.points.length>0;
  $('empty-state').textContent=result.displayCount && !result.points.length ? 'Matching records have no coordinates for this map view.' : 'No crashes match this view.';
  $('open-recent').disabled=!result.points.length;
  document.querySelectorAll('[data-period]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.period===state.view)));
  document.querySelector('.scope-banner').setAttribute('aria-busy','true');
  state.map.getSource('crashes').setData({type:'FeatureCollection',features:result.points});
  renderAnnual(result.years);
  updateWardScope(filters);
  state.trafficUI?.update(filters);
}

function markerFor(endpoint,label) {
  if (!endpoint) return;
  const element=node('div',label,'endpoint-marker'); element.setAttribute('aria-label',`Segment endpoint ${label}`);
  state.markers.push(new maplibregl.Marker({element}).setLngLat(endpoint.xy).addTo(state.map));
}
function drawRoad() {
  state.map.getSource('road-selected').setData({type:'FeatureCollection',features:state.roadFeatures.map((f)=>({type:'Feature',geometry:f.geometry,properties:{}}))});
  state.map.getSource('segment-selected').setData(state.segment?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:state.segment.coordinates},properties:{}}]}:empty());
  state.markers.forEach((m)=>m.remove());state.markers=[];markerFor(state.start,'S');markerFor(state.end,'E');
}
function stopPicking() { state.picking=null; $('pick-notice').hidden=true; $('pick-segment').classList.remove('active'); state.map.getCanvas().style.cursor=''; }
function clearSegment(apply=true) {
  state.start=null;state.end=null;state.segment=null;stopPicking();
  for (const id of ['segment-start','segment-end']) { $(id).querySelectorAll('[data-map]').forEach((n)=>n.remove()); $(id).value=''; }
  $('segment-status').textContent='Whole road shown. Choose two junctions or pick endpoints on the highlighted road.';
  $('match-distance').disabled=!(state.road && /^(I-|ROUTE )/.test(state.road.key));
  drawRoad();if(apply)applyAnalysis();
}
function updateSegment() {
  state.segment=state.start&&state.end?routeBetween(state.graph,state.start,state.end):null;
  if (state.segment) $('segment-status').textContent=`Selected path: ${decimal.format(state.segment.lengthMeters/1609.344)} miles. Only matching roadway records within ${$('match-distance').value} m are included.`;
  else if (state.start && state.end) $('segment-status').textContent='No connected path between those endpoints. Whole-road totals are shown; choose endpoints on one connected section.';
  else $('segment-status').textContent='Whole road shown until both segment endpoints are selected.';
  $('match-distance').disabled=!(state.segment || /^(I-|ROUTE )/.test(state.road?.key || ''));
  drawRoad();applyAnalysis();
}
function populateEndpoints() {
  const ownKeys=new Set(state.roadFeatures.flatMap((f)=>f.properties.keys));
  const choices=[];
  let endpointNumber=0;
  for (const [id,n] of state.graph.nodes) {
    const cross=n.roads.filter((key)=>!ownKeys.has(key)).map((key)=>pretty(state.catalog.get(key)?.label || key));
    if (cross.length || n.neighbors.size===1) choices.push({id,label:cross.length?[...new Set(cross)].join(' / '):`Road endpoint ${++endpointNumber}`});
  }
  choices.sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
  const repeated=new Map();
  for (const c of choices) {const n=(repeated.get(c.label)||0)+1;repeated.set(c.label,n);if(n>1)c.label+=` (junction ${n})`;}
  for (const select of [$('segment-start'),$('segment-end')]) {
    select.replaceChildren();const whole=node('option','Whole road');whole.value='';select.append(whole);
    choices.forEach((c)=>{const option=node('option',c.label);option.value=c.id;select.append(option);});
  }
  $('pick-segment').disabled=!state.graph.edges.length;
}
function chooseRoad(key) {
  state.road=key?state.catalog.get(key):null;
  state.roadFeatures=state.road?state.road.indices.map((index)=>state.roads.features[index]):[];
  state.graph=state.road?buildRoadGraph(state.roadFeatures,state.roads.junctions):null;
  $('road-search').value=state.road?pretty(state.road.label):'';
  $('clear-road').hidden=!state.road;errorAt('road-error',null);
  $('segment-controls').hidden=!state.road;
  if(state.road) { $('selected-road-name').textContent=pretty(state.road.label);populateEndpoints(); }
  clearSegment(false);applyAnalysis();
  if(state.activeWard)fitSelectedWard();
  else if(state.roadFeatures.length)fitBounds(boundsFor(state.roadFeatures),16);
}
function roadChanged() {
  if(!state.ready)return;
  const value=$('road-search').value.trim();if(!value){chooseRoad(null);return;}
  const key=normalizeRoadName(value);
  if(!state.catalog.has(key)){errorAt('road-error','Choose a road or route from the suggestions. The previous selection is still shown.');return;}
  chooseRoad(key);
}
function setMapEndpoint(which,snap) {
  const select=$(which==='start'?'segment-start':'segment-end');
  select.querySelectorAll('[data-map]').forEach((n)=>n.remove());
  const option=node('option',`Map-selected ${which}`);option.value=`@map-${which}`;option.dataset.map='true';select.append(option);select.value=option.value;
  state[which]=snap;
}
function pickEndpoint(event) {
  const snap=snapToRoad(state.graph,[event.lngLat.lng,event.lngLat.lat]);
  if(!snap || snap.distance>80){$('pick-notice').textContent='Click closer to the highlighted road (within 80 m).';return;}
  if(state.picking==='start') {setMapEndpoint('start',snap);state.picking='end';$('pick-notice').textContent='Now click the end of the segment on the highlighted road.';drawRoad();}
  else {setMapEndpoint('end',snap);stopPicking();updateSegment();}
}

function updateBoundaryView() {
  const mode=$('boundary-mode').value;
  for(const id of ['ward-fills','ward-labels'])if(state.map?.getLayer(id))state.map.setLayoutProperty(id,'visibility',mode==='wards'?'visible':'none');
  for(const id of ['precinct-fills','precinct-outlines','precinct-labels'])if(state.map?.getLayer(id))state.map.setLayoutProperty(id,'visibility',mode==='precincts'?'visible':'none');
  if(state.map?.getLayer('ward-outlines'))state.map.setLayoutProperty('ward-outlines','visibility',mode==='none'?'none':'visible');
  $('ward-key').hidden=mode==='none';
}

async function fetchJSON(path) { const r=await fetch(path);if(!r.ok)throw new Error(`Could not load ${path} (${r.status}).`);return r.json(); }
async function initialize() {
  // Basemap and initial map/layer setup are inserted below from the tested POC.
  const style={version:8,glyphs:new URL('assets/fonts/{fontstack}/{range}.pbf',location.href).href.replaceAll('%7B','{').replaceAll('%7D','}'),sources:{streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}},layers:[{id:'background',type:'background',paint:{'background-color':'#e9eee9'}},{id:'streets',type:'raster',source:'streets',paint:{'raster-saturation':-.78,'raster-contrast':-.05,'raster-brightness-min':.12,'raster-opacity':.9}}]};
  const map=new maplibregl.Map({container:'map',style,center:[-71.21,42.329],zoom:12,minZoom:10,maxZoom:19,maxBounds:[[-71.42,42.18],[-71.05,42.45]],renderWorldCopies:false,dragRotate:false,pitchWithRotate:false,touchPitch:false,attributionControl:false,fadeDuration:reducedMotion?0:150});state.map=map;
  map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.addControl(new maplibregl.ScaleControl({unit:'imperial',maxWidth:80}),'bottom-left');map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'MassDOT · MassGIS'}),'bottom-right');
  map.on('error',(e)=>{if(e.sourceId==='streets'||String(e.error?.message).includes('tile.openstreetmap.org'))$('tile-notice').hidden=false;else console.error(e.error);});
  const loaded=new Promise((resolve)=>map.once('load',resolve));
  const [crashes,city,wards,precincts,summary,roads,traffic]=await Promise.all([fetchJSON('assets/data/crashes.geojson'),fetchJSON('assets/data/newton_boundary.geojson'),fetchJSON('assets/data/newton_wards_2022.geojson'),fetchJSON('assets/data/newton_precincts_2022.geojson'),fetchJSON('assets/data/summary.json'),fetchJSON('assets/data/roads.geojson'),fetchJSON('assets/data/traffic.geojson'),loaded]);
  if(crashes.features.length!==summary.total)throw new Error('Incomplete crash dataset.');
  if(crashes.wardAssignment?.boundaryYear!==2022||traffic.wardAssignment?.boundaryYear!==2022)throw new Error('Ward assignments are missing from the local data export.');
  state.wards=new Map(wards.features.map(f=>[String(f.properties.ward),f]));
  state.all=crashes.features.map(prepareRecord);state.records=new Map(state.all.map((f)=>[f.properties.id,f]));state.roads=roads;state.catalog=new Map(roads.catalog.map((r)=>[r.key,r]));state.coverage={start:`${summary.fromYear}-01-01`,end:summary.ytdLatestDate};state.bounds=boundsFor(city.features);
  for(const input of document.querySelectorAll('input[type=date]')){input.min=state.coverage.start;input.max=state.coverage.end;}
  resetTimeframes();
  $('coverage-note').textContent=`Data through ${showDate(state.coverage.end)}.`;
  $('data-record-note').textContent=`${fmt.format(summary.total)} records; ${fmt.format(summary.mapped)} with coordinates and ${fmt.format(summary.unlocated)} unlocated. Citywide and whole-road totals include matching unlocated records.`;
  $('ytd-note').textContent=`2026 YTD: ${fmt.format(summary.ytdRecords)} available records. Latest crash: ${showDate(summary.ytdLatestDate)}. Reporting lag applies.`;
  const options=document.createDocumentFragment();roads.catalog.forEach((road)=>{const option=node('option','');option.value=pretty(road.label);options.append(option);});$('road-options').append(options);
    map.addSource('city', { type: 'geojson', data: city });
    map.addSource('wards', { type: 'geojson', data: wards });
    map.addSource('precincts', { type: 'geojson', data: precincts });
    map.addLayer({ id: 'ward-fills', type: 'fill', source: 'wards', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.26 } });
    map.addLayer({ id: 'precinct-fills', type: 'fill', source: 'precincts', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.32 } });
    map.addLayer({ id: 'precinct-outlines', type: 'line', source: 'precincts', layout: { visibility: 'none' }, paint: { 'line-color': '#344b50', 'line-width': 1.2, 'line-opacity': 0.75, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'ward-outlines', type: 'line', source: 'wards', paint: { 'line-color': '#354f55', 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'city-outline', type: 'line', source: 'city', paint: { 'line-color': '#263f45', 'line-width': 2.6, 'line-opacity': 0.95 } });
    map.addSource('ward-selection',{type:'geojson',data:empty()});
    map.addLayer({id:'selected-ward-fill',type:'fill',source:'ward-selection',paint:{'fill-color':['get','fill'],'fill-opacity':.1}});
    map.addLayer({id:'selected-ward-casing',type:'line',source:'ward-selection',paint:{'line-color':'#fffffc','line-width':7,'line-opacity':.95}});
    map.addLayer({id:'selected-ward-outline',type:'line',source:'ward-selection',paint:{'line-color':'#224b52','line-width':3.5,'line-opacity':1}});

    map.addSource('road-selected',{type:'geojson',data:empty()});
    map.addSource('segment-selected',{type:'geojson',data:empty()});
    map.addLayer({id:'road-casing',type:'line',source:'road-selected',paint:{'line-color':'#ffffff','line-width':7,'line-opacity':.9}});
    map.addLayer({id:'road-path',type:'line',source:'road-selected',paint:{'line-color':'#8067a0','line-width':3.5,'line-opacity':.85}});
    map.addLayer({id:'segment-casing',type:'line',source:'segment-selected',paint:{'line-color':'#ffffff','line-width':9}});
    map.addLayer({id:'segment-path',type:'line',source:'segment-selected',paint:{'line-color':'#594078','line-width':5.5}});
    map.addSource('crashes', { type: 'geojson', data: empty(), cluster: true, clusterMaxZoom: 15, clusterRadius: 36 });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'crashes', filter: ['has', 'point_count'], paint: { 'circle-color': '#285b61', 'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 25, 500, 31], 'circle-stroke-width': 2, 'circle-stroke-color': '#fffffc', 'circle-opacity': 0.94 } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'crashes', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
    map.addLayer({ id: 'crash-points', type: 'circle', source: 'crashes', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'group'], 'damage', severityColors.damage, 'injury', severityColors.injury, 'fatal', severityColors.fatal, severityColors.unknown], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 5.5, 18, 7], 'circle-stroke-color': ['match', ['get', 'period'], 'a', '#466fa4', 'b', '#94634b', '#8b6398'], 'circle-stroke-width': 2, 'circle-opacity': 0.92 } });
    map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected', paint: { 'circle-radius': 13, 'circle-color': '#285b61', 'circle-opacity': 0.1, 'circle-stroke-width': 2, 'circle-stroke-color': '#1f4a50' } });
    map.addLayer({ id: 'selected-point', type: 'circle', source: 'selected', paint: { 'circle-radius': 6.5, 'circle-color': ['match', ['get', 'group'], 'damage', severityColors.damage, 'injury', severityColors.injury, 'fatal', severityColors.fatal, severityColors.unknown], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    map.addLayer({ id: 'ward-labels', type: 'symbol', source: 'wards', minzoom: 10, maxzoom: 16, layout: { 'text-field': ['concat', 'WARD ', ['get', 'ward']], 'text-font': ['Noto Sans Regular'], 'text-size': 14, 'text-letter-spacing': 0.08, 'text-padding': 10, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#18383f', 'text-halo-color': '#fffffc', 'text-halo-width': 3 } });
    map.addLayer({ id: 'precinct-labels', type: 'symbol', source: 'precincts', minzoom: 10, maxzoom: 17, layout: { visibility: 'none', 'text-field': ['get', 'district'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-padding': 7, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#18383f', 'text-halo-color': '#fffffc', 'text-halo-width': 2.5 } });

    updateBoundaryView();
  state.trafficUI=new TrafficExplorer({map,data:traffic,state,closeCrash:closeDetails,onPickStart:stopPicking});
  state.ready=true;applyAnalysis();fitBounds(state.bounds,13);
  map.on('sourcedata',(e)=>{if(e.sourceId==='crashes'&&e.isSourceLoaded){$('map-status').hidden=true;document.querySelector('.scope-banner').setAttribute('aria-busy','false');}});
  map.once('idle',()=>{$('map-status').hidden=true;document.querySelector('.scope-banner').setAttribute('aria-busy','false');});
  map.on('click',async(event)=>{
    if(state.picking){pickEndpoint(event);return;}
    if(state.trafficUI.handleClick(event))return;
    const candidates=uniqueVisible(map.queryRenderedFeatures([[event.point.x-5,event.point.y-5],[event.point.x+5,event.point.y+5]],{layers:['crash-points','selected-point']}));
    if(candidates.length){showCrash(candidates[0],candidates);return;}
    const clusters=map.queryRenderedFeatures(event.point,{layers:['clusters']});
    if(clusters.length){try{const f=clusters[0],zoom=await map.getSource('crashes').getClusterExpansionZoom(f.properties.cluster_id);map.easeTo({center:f.geometry.coordinates,zoom:Math.min(zoom+.2,19),duration:reducedMotion?0:450});}catch(error){console.error(error);}return;}
    state.trafficUI.handleClick(event,true);
  });
  map.on('mousemove',(event)=>{map.getCanvas().style.cursor=(state.picking||state.trafficUI.picking)?'crosshair':map.queryRenderedFeatures(event.point,{layers:['clusters','crash-points','selected-point','traffic-volume','traffic-modeled']}).length?'pointer':'';});
  const requested=new URL(location.href).searchParams.get('crash');
  if(requested&&state.visibleIds.has(requested))showCrash(state.records.get(requested),[state.records.get(requested)],true);
}

function updateCrashVisibility(){for(const id of ['clusters','cluster-count','crash-points','selected-halo','selected-point'])if(state.map?.getLayer(id))state.map.setLayoutProperty(id,'visibility',$('crashes-visible').checked?'visible':'none');if(!$('crashes-visible').checked)closeDetails();}
$('crashes-visible').addEventListener('change',updateCrashVisibility);
$('ward-filter').addEventListener('change',()=>{
  if(!state.ready)return;
  applyAnalysis();
  if((state.filters?.ward||'')!==$('ward-filter').value)return;
  if(state.activeWard)fitSelectedWard();
  else if(state.roadFeatures.length)fitBounds(boundsFor(state.roadFeatures),16);
  else fitBounds(state.bounds,13);
});
$('fit-ward').addEventListener('click',fitSelectedWard);
$('filters-form').addEventListener('submit',(e)=>{e.preventDefault();roadChanged();});
$('filters-form').addEventListener('change',(e)=>{
  if(e.target.id==='a-end'||e.target.id==='equalize-timeframes')state.autoAEnd=false;
  if(e.target.matches('input[type=date],input[name=severity],#involvement,#equalize-timeframes')&&state.ready)applyAnalysis();
});
$('road-search').addEventListener('change',roadChanged);
$('road-search').addEventListener('input',()=>{if(!$('road-search').value&&state.road)chooseRoad(null);});
$('clear-road').addEventListener('click',()=>chooseRoad(null));
$('clear-segment').addEventListener('click',()=>clearSegment());
$('fit-road').addEventListener('click',()=>{if(state.roadFeatures.length)fitBounds(boundsFor(state.segment?[{geometry:{type:'LineString',coordinates:state.segment.coordinates}}]:state.roadFeatures),16);});
$('fit-map').addEventListener('click',()=>fitBounds(state.bounds,13));
$('pick-segment').addEventListener('click',()=>{if(!state.graph)return;state.trafficUI?.cancelPicking();if(state.picking){stopPicking();return;}clearSegment(false);state.picking='start';closeDetails();$('pick-segment').classList.add('active');$('pick-notice').hidden=false;$('pick-notice').textContent='Click the start of the segment on the highlighted road.';state.map.getCanvas().style.cursor='crosshair';applyAnalysis();});
for(const [id,which] of [['segment-start','start'],['segment-end','end']])$(id).addEventListener('change',()=>{stopPicking();const value=$(id).value;if(!value)state[which]=null;else if(!value.startsWith('@map-')){const n=state.graph.nodes.get(value);state[which]=n?{nodeId:value,xy:n.xy}:null;}updateSegment();});
$('match-distance').addEventListener('change',updateSegment);
document.querySelectorAll('[data-period]').forEach((button)=>button.addEventListener('click',()=>{state.view=button.dataset.period;applyAnalysis();}));
$('reset-filters').addEventListener('click',()=>{if(!state.ready)return;state.trafficUI?.cancelPicking();state.trafficUI?.closeDetails();$('filters-form').reset();resetTimeframes();state.view='both';updateCrashVisibility();chooseRoad(null);fitBounds(state.bounds,13);});
$('open-recent').addEventListener('click',()=>{const list=state.result?.points || [];if(!list.length)return;const feature=uniqueVisible(list)[0],xy=feature.geometry.coordinates;showCrash(feature,list.filter((f)=>Math.abs(f.geometry.coordinates[0]-xy[0])<.000001&&Math.abs(f.geometry.coordinates[1]-xy[1])<.000001),true);$('close-detail').focus({preventScroll:true});});
$('close-detail').addEventListener('click',closeDetails);
$('crash-choice').addEventListener('change',(e)=>{const feature=state.records.get(e.target.value);if(feature&&state.visibleIds.has(feature.properties.id))showCrash(feature,state.candidates);});
$('boundary-mode').addEventListener('change',updateBoundaryView);
$('retry').addEventListener('click',()=>location.reload());
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){if(state.picking)stopPicking();else closeDetails();}});
initialize().catch((error)=>{console.error(error);$('map-status').hidden=false;$('map-status').classList.add('error');$('map-status-text').textContent=error.message || 'Could not load the map.';$('retry').hidden=false;});
