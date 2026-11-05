/* Newton Crash Explorer — a static, read-only MapLibre proof of concept. */
import * as maplibregl from './vendor/maplibre-gl.mjs';
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat('en-US');
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { map: null, records: new Map(), candidates: [], bounds: null, ready: false, selectedId: null, tileErrors: false };
  const severityColors = { damage: '#b99750', injury: '#d4684a', fatal: '#8b324c', unknown: '#7d8e98' };
  const severityLabels = { damage: 'Property damage', injury: 'Non-fatal injury', fatal: 'Fatal injury', unknown: 'Severity unknown' };

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function reportValue(value) {
    return value === null || value === undefined || value === '' ? 'Not reported' : String(value);
  }

  function displayDate(value) {
    if (!value) return 'Date not reported';
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) ? dateFormat.format(parsed) : value;
  }

  function streetName(value) {
    if (!value) return 'Location not reported';
    // Display typography only; the preserved original records remain unchanged.
    return value.split(/\s+/).map((part) => /^(I-?\d+|US|MA|NB|SB|EB|WB|[0-9]+)$/i.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
  }

  function uniqueRecords(features) {
    const unique = new Map();
    for (const f of features) {
      const id = String(f.properties.id);
      if (state.records.has(id)) unique.set(id, state.records.get(id));
    }
    return [...unique.values()].sort((a, b) => (b.properties.date || '').localeCompare(a.properties.date || '') || b.properties.id.localeCompare(a.properties.id));
  }

  function showCrash(feature, candidates = [feature], move = false) {
    const p = feature.properties;
    state.selectedId = String(p.id);
    state.candidates = uniqueRecords(candidates);
    const content = $('detail-content');
    content.replaceChildren();
    const tag = textElement('span', severityLabels[p.group] || severityLabels.unknown, `severity-tag ${p.group}-tag`);
    tag.prepend(document.createElement('i'));
    content.append(tag, textElement('h2', displayDate(p.date), 'detail-date'), textElement('p', reportValue(p.time), 'detail-time'));
    const location = [p.number, streetName(p.street)].filter(Boolean).join(' ');
    content.append(textElement('h3', location, 'detail-location'));
    if (p.nearby) content.append(textElement('p', `Near ${streetName(p.nearby)}`, 'detail-nearby'));

    const counts = document.createElement('div');
    counts.className = 'count-grid';
    for (const [label, value] of [['Vehicles', p.vehicles], ['Injuries', p.injuries], ['Fatalities', p.fatalities]]) {
      const item = document.createElement('div');
      item.append(textElement('strong', value === null || value === undefined ? '—' : numberFormat.format(value)), textElement('span', label));
      counts.append(item);
    }
    content.append(counts);
    const facts = document.createElement('dl');
    facts.className = 'detail-facts';
    const rows = [['Collision type', p.collision], ['Maximum injury reported', p.injurySeverity], ['Weather', p.weather], ['Light conditions', p.light], ['Road surface', p.surface]];
    if (p.roadUsers) rows.push(['Pedestrian / bicycle involvement', p.roadUsers]);
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.append(textElement('dt', label), textElement('dd', reportValue(value)));
      facts.append(row);
    }
    content.append(facts);
    if (p.status !== 'Closed') content.append(textElement('p', 'Provisional record. Details may change as MassDOT updates its data.', 'record-note'));
    if (p.locationCheck === 'outside_city') content.append(textElement('p', 'Reported by MassDOT as a Newton crash. Its mapped coordinates fall outside the city outline.', 'record-note'));
    content.append(textElement('p', `MassDOT crash #${p.id} · ${reportValue(p.status)} record`, 'detail-source'));

    const sameLocation = state.candidates.length > 1;
    $('same-location').hidden = !sameLocation;
    $('crash-choice').replaceChildren();
    if (sameLocation) {
      $('crash-choice-label').textContent = `${state.candidates.length} crashes at this map location`;
      for (const other of state.candidates) {
        const option = document.createElement('option');
        option.value = other.properties.id;
        option.textContent = `${displayDate(other.properties.date)} · ${other.properties.time || 'Time unknown'} · #${other.properties.id}`;
        option.selected = other.properties.id === p.id;
        $('crash-choice').append(option);
      }
    }

    $('intro').hidden = true;
    $('crash-detail').hidden = false;
    $('sidebar').classList.add('detail-open');
    document.querySelector('.sidebar-scroll').scrollTop = 0;
    const selected = state.map.getSource('selected');
    selected.setData({ type: 'FeatureCollection', features: [feature] });
    if (move) state.map.easeTo({ center: feature.geometry.coordinates, zoom: Math.max(16.5, state.map.getZoom()), duration: reducedMotion ? 0 : 650 });
    state.map.resize();
  }

  function closeDetails() {
    state.selectedId = null;
    state.candidates = [];
    $('crash-detail').hidden = true;
    $('intro').hidden = false;
    $('sidebar').classList.remove('detail-open');
    document.querySelector('.sidebar-scroll').scrollTop = 0;
    state.map?.getSource('selected')?.setData({ type: 'FeatureCollection', features: [] });
    state.map?.resize();
  }

  function fitNewton() {
    if (!state.bounds) return;
    state.map.fitBounds(state.bounds, { padding: window.innerWidth < 641 ? { top: 65, bottom: 70, left: 25, right: 40 } : { top: 80, bottom: 100, left: 50, right: 55 }, duration: reducedMotion ? 0 : 600, maxZoom: 13 });
  }

  function geometryBounds(geometry) {
    const bounds = new maplibregl.LngLatBounds();
    const visit = (coordinates) => {
      if (typeof coordinates[0] === 'number') bounds.extend(coordinates);
      else coordinates.forEach(visit);
    };
    visit(geometry.coordinates);
    return bounds;
  }

  async function fetchJSON(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
    return response.json();
  }

  function fatalError(message) {
    $('map-status').hidden = false;
    $('map-status').classList.add('error');
    $('map-status-text').textContent = message;
    $('retry').hidden = false;
  }

  async function initialize() {
    if (!maplibregl.Map) throw new Error('The map library could not load. Please refresh the page.');
    // OSM tiles are requested normally by the browser with caching and attribution.
    // There is no tile prefetch, proxy, background download or cache bypass.
    const style = {
      version: 8,
      glyphs: new URL('assets/fonts/{fontstack}/{range}.pbf', window.location.href).href.replaceAll('%7B', '{').replaceAll('%7D', '}'),
      sources: { streets: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9eee9' } }, { id: 'streets', type: 'raster', source: 'streets', paint: { 'raster-saturation': -0.78, 'raster-contrast': -0.05, 'raster-brightness-min': 0.12, 'raster-opacity': 0.9 } }],
    };
    const map = new maplibregl.Map({ container: 'map', style, center: [-71.21, 42.329], zoom: 12, minZoom: 10, maxZoom: 19, maxBounds: [[-71.42, 42.18], [-71.05, 42.45]], renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false, fadeDuration: reducedMotion ? 0 : 200 });
    state.map = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 85 }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '<a href="https://apps.crashdata.dot.mass.gov/cdp/home" target="_blank" rel="noopener">MassDOT</a> · <a href="https://www.mass.gov/info-details/massgis-data-2022-wards-and-precincts" target="_blank" rel="noopener">MassGIS</a>' }), 'bottom-right');
    map.on('error', (event) => {
      if (event.sourceId === 'streets' || String(event.error?.message).includes('tile.openstreetmap.org')) {
        if (!state.tileErrors) {
          state.tileErrors = true;
          $('tile-notice').hidden = false;
        }
      } else {
        console.error('Map error:', event.error);
      }
    });
    const mapLoaded = new Promise((resolve) => map.once('load', resolve));
    const [crashes, city, wards, precincts, summary] = await Promise.all([
      fetchJSON('assets/data/crashes.geojson'), fetchJSON('assets/data/newton_boundary.geojson'),
      fetchJSON('assets/data/newton_wards_2022.geojson'), fetchJSON('assets/data/newton_precincts_2022.geojson'), fetchJSON('assets/data/summary.json'), mapLoaded,
    ]);
    if (crashes.features.length !== summary.mapped) throw new Error('The map data is incomplete. Please refresh the page.');
    state.records = new Map(crashes.features.map((feature) => [feature.properties.id, feature]));
    state.bounds = geometryBounds(city.features[0].geometry);
    $('mapped-count').textContent = numberFormat.format(summary.mapped);
    $('data-record-note').textContent = `${numberFormat.format(summary.total)} reported crashes. The map shows ${numberFormat.format(summary.mapped)} with coordinates. Another ${numberFormat.format(summary.unlocated)} records have no mapped location.`;
    $('ytd-note').textContent = `2026 YTD: ${numberFormat.format(summary.ytdRecords)} available records. The latest reported crash in this download is ${displayDate(summary.ytdLatestDate)}. Recent crashes may not yet have been submitted or published.`;

    map.addSource('city', { type: 'geojson', data: city });
    map.addSource('wards', { type: 'geojson', data: wards });
    map.addSource('precincts', { type: 'geojson', data: precincts });
    map.addLayer({ id: 'ward-fills', type: 'fill', source: 'wards', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.26 } });
    map.addLayer({ id: 'precinct-fills', type: 'fill', source: 'precincts', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.32 } });
    map.addLayer({ id: 'precinct-outlines', type: 'line', source: 'precincts', layout: { visibility: 'none' }, paint: { 'line-color': '#344b50', 'line-width': 1.2, 'line-opacity': 0.75, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'ward-outlines', type: 'line', source: 'wards', paint: { 'line-color': '#354f55', 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'city-outline', type: 'line', source: 'city', paint: { 'line-color': '#263f45', 'line-width': 2.6, 'line-opacity': 0.95 } });
    map.addSource('crashes', { type: 'geojson', data: crashes, cluster: true, clusterMaxZoom: 15, clusterRadius: 36 });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'crashes', filter: ['has', 'point_count'], paint: { 'circle-color': '#285b61', 'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 25, 500, 31], 'circle-stroke-width': 2, 'circle-stroke-color': '#fffffc', 'circle-opacity': 0.94 } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'crashes', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
    map.addLayer({ id: 'crash-points', type: 'circle', source: 'crashes', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'group'], 'damage', severityColors.damage, 'injury', severityColors.injury, 'fatal', severityColors.fatal, severityColors.unknown], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 5.5, 18, 7], 'circle-stroke-color': '#fffffc', 'circle-stroke-width': 1.3, 'circle-opacity': 0.92 } });
    map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected', paint: { 'circle-radius': 13, 'circle-color': '#285b61', 'circle-opacity': 0.1, 'circle-stroke-width': 2, 'circle-stroke-color': '#1f4a50' } });
    map.addLayer({ id: 'selected-point', type: 'circle', source: 'selected', paint: { 'circle-radius': 6.5, 'circle-color': ['match', ['get', 'group'], 'damage', severityColors.damage, 'injury', severityColors.injury, 'fatal', severityColors.fatal, severityColors.unknown], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    map.addLayer({ id: 'ward-labels', type: 'symbol', source: 'wards', minzoom: 10, maxzoom: 16, layout: { 'text-field': ['concat', 'WARD ', ['get', 'ward']], 'text-font': ['Noto Sans Regular'], 'text-size': 14, 'text-letter-spacing': 0.08, 'text-padding': 10, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#18383f', 'text-halo-color': '#fffffc', 'text-halo-width': 3 } });
    map.addLayer({ id: 'precinct-labels', type: 'symbol', source: 'precincts', minzoom: 10, maxzoom: 17, layout: { visibility: 'none', 'text-field': ['get', 'district'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-padding': 7, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#18383f', 'text-halo-color': '#fffffc', 'text-halo-width': 2.5 } });
    updateBoundaryView();

    // Cluster counts always represent the full loaded set; no visual-only filters
    // are applied that could leave stale counts in clustered data.
    map.on('click', async (event) => {
      const points = map.queryRenderedFeatures([[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]], { layers: ['crash-points', 'selected-point'] });
      if (points.length) {
        const candidates = uniqueRecords(points);
        if (candidates.length) showCrash(candidates[0], candidates);
        return;
      }
      const clusters = map.queryRenderedFeatures(event.point, { layers: ['clusters'] });
      if (!clusters.length) return;
      const feature = clusters[0];
      try {
        const zoom = await map.getSource('crashes').getClusterExpansionZoom(feature.properties.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(zoom + 0.2, map.getMaxZoom()), duration: reducedMotion ? 0 : 500 });
      } catch (error) {
        console.error('Could not expand cluster:', error);
      }
    });
    map.on('mousemove', (event) => {
      const interactive = map.queryRenderedFeatures(event.point, { layers: ['clusters', 'crash-points', 'selected-point'] }).length;
      map.getCanvas().style.cursor = interactive ? 'pointer' : '';
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'crashes' && event.isSourceLoaded) {
        state.ready = true;
        $('map-status').hidden = true;
        $('open-recent').disabled = false;
      }
    });
    map.once('idle', () => {
      state.ready = true;
      $('map-status').hidden = true;
      $('open-recent').disabled = false;
    });
    fitNewton();

    // An accessible entry point also makes the POC usable without clicking the canvas.
    $('open-recent').addEventListener('click', () => {
      const sorted = [...state.records.values()].filter((f) => f.properties.locationCheck === 'inside_city').sort((a, b) => b.properties.date.localeCompare(a.properties.date) || b.properties.id.localeCompare(a.properties.id));
      const feature = sorted[0];
      const xy = feature.geometry.coordinates;
      const sameCoordinates = sorted.filter((f) => Math.abs(f.geometry.coordinates[0] - xy[0]) < 0.000001 && Math.abs(f.geometry.coordinates[1] - xy[1]) < 0.000001);
      showCrash(feature, sameCoordinates, true);
      $('close-detail').focus({ preventScroll: true });
    });
    const requested = new URL(window.location.href).searchParams.get('crash');
    if (requested && state.records.has(requested)) showCrash(state.records.get(requested), [state.records.get(requested)], true);
  }

  $('retry').addEventListener('click', () => window.location.reload());
  $('fit-map').addEventListener('click', fitNewton);
  $('close-detail').addEventListener('click', () => { closeDetails(); $('open-recent').focus({ preventScroll: true }); });
  $('crash-choice').addEventListener('change', (event) => {
    const feature = state.records.get(event.target.value);
    if (feature) showCrash(feature, state.candidates);
  });
  function updateBoundaryView() {
    const mode = $('boundary-mode').value;
    const wardLayers = ['ward-fills', 'ward-labels'];
    const precinctLayers = ['precinct-fills', 'precinct-outlines', 'precinct-labels'];
    for (const id of wardLayers) if (state.map?.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', mode === 'wards' ? 'visible' : 'none');
    for (const id of precinctLayers) if (state.map?.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', mode === 'precincts' ? 'visible' : 'none');
    if (state.map?.getLayer('ward-outlines')) state.map.setLayoutProperty('ward-outlines', 'visibility', mode === 'none' ? 'none' : 'visible');
    $('ward-key').hidden = mode === 'none';
  }
  $('boundary-mode').addEventListener('change', updateBoundaryView);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selectedId !== null) closeDetails();
  });
  initialize().catch((error) => { console.error(error); fatalError(error.message || 'The map could not load. Please try again.'); });
})();
