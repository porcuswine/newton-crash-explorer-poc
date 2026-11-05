// Pure comparison and geometry functions, shared by the UI and its checks.
export const DAY_MS = 86400000;
const X_SCALE = 111320 * Math.cos(42.33 * Math.PI / 180);
const Y_SCALE = 111320;
export const project = ([x, y]) => [x * X_SCALE, y * Y_SCALE];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function normalizeRoadName(value = '') {
  let s = String(value).toUpperCase().trim().replace(/[.,]/g, ' ').replace(/\s+/g, ' ')
    .replace(/^(.+?)\s+(?:RTE|ROUTE)\b.*$/, '$1')
    .replace(/\b(?:NORTHBOUND|SOUTHBOUND|EASTBOUND|WESTBOUND)\b/g, ' ')
    .replace(/\b(?:NB|SB|EB|WB)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:MASSACHUSETTS TURNPIKE|MASS TURNPIKE|MASS PIKE|TURNPIKE|I[ -]?90|INTERSTATE 90)$/.test(s)) return 'I-90';
  if (/^(?:I[ -]?95|INTERSTATE 95)$/.test(s)) return 'I-95';
  s = s.replace(/^(?:ROUTE|RTE|RT)\s*(?:SR\s*)?(\d+)\b(?:\s+[NSEW])?$/, 'ROUTE $1');
  s = s.replace(/^(?:ROUTE|RTE|RT)\s*I[ -]?(\d+)\b(?:\s+[NSEW])?$/, 'I-$1');
  if (/^ROUTE (?:90|95)$/.test(s)) return s.replace('ROUTE ', 'I-');
  const words = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', BOULEVARD: 'BLVD', PARKWAY: 'PKWY', LANE: 'LN', DRIVE: 'DR', SQUARE: 'SQ', TERRACE: 'TER', COURT: 'CT', PLACE: 'PL', HIGHWAY: 'HWY', CIRCLE: 'CIR' };
  return s.split(' ').map((word) => words[word] || word).join(' ').replace(/\s+/g, ' ').trim();
}

export function reportedRoadKeys(properties) {
  const text = properties.street || properties.linkedStreet || '';
  const pieces = text.split(/\s*[/;]\s*/);
  const routeAnnotations = pieces.flatMap((piece) => [...piece.matchAll(/\b(?:RTE|ROUTE)\s+((?:I|SR)?\s*\d+)(?:\s+[NSEW](?:B)?)?\b/gi)].map((m) => `RTE ${m[1]}`));
  return [...new Set([...pieces, ...routeAnnotations].map(normalizeRoadName).filter(Boolean))];
}

export function involvementFlags(value) {
  const text = String(value || '');
  return { bicycle: /\b(?:bicyclists?|bicycles?|cyclists?)\b/i.test(text), pedestrian: /\bpedestrians?\b/i.test(text) };
}

export function dateDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY_MS : NaN;
}

export function periodDays(period) {
  return dateDay(period.end) - dateDay(period.start) + 1;
}

export function validatePeriods(a, b, coverage) {
  for (const [label, p] of [['A', a], ['B', b]]) {
    if (!Number.isFinite(dateDay(p.start)) || !Number.isFinite(dateDay(p.end))) return `Enter both dates for Period ${label}.`;
    if (p.start > p.end) return `Period ${label} must start before it ends.`;
    if (p.start < coverage.start || p.end > coverage.end) return `Choose dates between ${coverage.start} and ${coverage.end}, the available data window.`;
  }
  return null;
}

export function prepareRecord(feature) {
  const p = feature.properties;
  return { ...feature, _roadKeys: reportedRoadKeys(p), _users: involvementFlags(p.roadUsers), _day: dateDay(p.date) };
}

export function pointLineDistance(point, lines) {
  if (!point) return Infinity;
  const p = project(point);
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = project(line[i - 1]), b = project(line[i]);
      const length2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length2)) : 0;
      best = Math.min(best, distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
    }
  }
  return best;
}

export function matchesFilters(record, filters) {
  const p = record.properties;
  if (filters.ward && String(p.ward) !== String(filters.ward)) return false;
  if (!filters.severities.has(p.group)) return false;
  const users = record._users || involvementFlags(p.roadUsers);
  if (filters.involvement === 'bicycle' && !users.bicycle) return false;
  if (filters.involvement === 'pedestrian' && !users.pedestrian) return false;
  if (filters.involvement === 'either' && !users.bicycle && !users.pedestrian) return false;
  if (filters.involvement === 'both' && !(users.bicycle && users.pedestrian)) return false;
  const roadKeys = record._roadKeys || reportedRoadKeys(p);
  if (filters.roadKey && !roadKeys.some((key) => filters.roadMatchKeys?.has(key) || key === filters.roadKey)) return false;
  if (filters.routeLines) {
    if (!record.geometry) {
      if (!roadKeys.includes(filters.roadKey)) return false;
    } else if (pointLineDistance(record.geometry.coordinates, filters.routeLines) > filters.tolerance) return false;
  }
  if (filters.segment) {
    if (!record.geometry || pointLineDistance(record.geometry.coordinates, [filters.segment]) > filters.tolerance) return false;
  }
  return true;
}

export function comparePeriods(records, filters) {
  const all = records.filter((r) => matchesFilters(r, filters));
  const inPeriod = (r, p) => r.properties.date >= p.start && r.properties.date <= p.end;
  const aRecords = all.filter((r) => inPeriod(r, filters.a));
  const bRecords = all.filter((r) => inPeriod(r, filters.b));
  const aIds = new Set(aRecords.map((r) => r.properties.id));
  const bIds = new Set(bRecords.map((r) => r.properties.id));
  const union = all.filter((r) => aIds.has(r.properties.id) || bIds.has(r.properties.id));
  const display = union.filter((r) => filters.mapPeriod === 'a' ? aIds.has(r.properties.id) : filters.mapPeriod === 'b' ? bIds.has(r.properties.id) : true);
  const summary = (items, period) => ({ total: items.length, mapped: items.filter((r) => r.geometry).length, unlocated: items.filter((r) => !r.geometry).length, perYear: items.length * 365.2425 / periodDays(period), days: periodDays(period) });
  const a = summary(aRecords, filters.a), b = summary(bRecords, filters.b);
  const percent = (oldValue, newValue) => oldValue === 0 ? newValue === 0 ? 0 : null : (newValue - oldValue) / oldValue * 100;
  const years = [];
  for (let year = Math.min(+filters.a.start.slice(0, 4), +filters.b.start.slice(0, 4)); year <= Math.max(+filters.a.end.slice(0, 4), +filters.b.end.slice(0, 4)); year++) {
    years.push({ year, a: aRecords.filter((r) => +r.properties.date.slice(0, 4) === year).length, b: bRecords.filter((r) => +r.properties.date.slice(0, 4) === year).length });
  }
  return {
    a, b, delta: b.total - a.total, percent: percent(a.total, b.total), annualPercent: percent(a.perYear, b.perYear),
    overlap: filters.a.start <= filters.b.end && filters.b.start <= filters.a.end,
    unionCount: union.length, displayCount: display.length, unlocated: display.filter((r) => !r.geometry).length,
    points: display.filter((r) => r.geometry).map((r) => ({ type: 'Feature', id: r.properties.id, geometry: r.geometry, properties: { ...r.properties, period: aIds.has(r.properties.id) && bIds.has(r.properties.id) ? 'both' : aIds.has(r.properties.id) ? 'a' : 'b' } })),
    years,
  };
}

export function coordKey([x, y]) { return `${x.toFixed(6)},${y.toFixed(6)}`; }

export function geometryLines(feature) {
  return feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

export function buildRoadGraph(features, junctionLookup = {}) {
  const nodes = new Map(), edges = [], edgeKeys = new Set();
  const node = (xy) => {
    const id = coordKey(xy);
    if (!nodes.has(id)) nodes.set(id, { id, xy, projected: project(xy), neighbors: new Map(), roads: junctionLookup[id] || [] });
    return id;
  };
  for (const feature of features) for (const line of geometryLines(feature)) {
    for (let i = 1; i < line.length; i++) {
      const a = node(line[i - 1]), b = node(line[i]);
      if (a === b) continue;
      const key = [a, b].sort().join('|');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      const length = distance(nodes.get(a).projected, nodes.get(b).projected);
      nodes.get(a).neighbors.set(b, length); nodes.get(b).neighbors.set(a, length);
      edges.push({ a, b, length });
    }
  }
  return { nodes, edges };
}

export function snapToRoad(graph, xy) {
  const p = project(xy);
  let best = null;
  for (const edge of graph.edges) {
    const a = graph.nodes.get(edge.a).projected, b = graph.nodes.get(edge.b).projected;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / edge.length ** 2));
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = distance(p, q);
    if (!best || d < best.distance) best = { edge, t, xy: [q[0] / X_SCALE, q[1] / Y_SCALE], distance: d };
  }
  return best;
}

export function routeBetween(graph, from, to) {
  if (!from || !to) return null;
  const adjacency = new Map([...graph.nodes].map(([id, n]) => [id, new Map(n.neighbors)]));
  const positions = new Map([...graph.nodes].map(([id, n]) => [id, n.xy]));
  const attach = (endpoint, name) => {
    if (endpoint.nodeId) return endpoint.nodeId;
    positions.set(name, endpoint.xy); adjacency.set(name, new Map());
    for (const [id, cost] of [[endpoint.edge.a, endpoint.edge.length * endpoint.t], [endpoint.edge.b, endpoint.edge.length * (1 - endpoint.t)]]) {
      adjacency.get(name).set(id, cost); adjacency.get(id).set(name, cost);
    }
    return name;
  };
  const start = attach(from, '@start'), end = attach(to, '@end');
  if (!start || !end || !adjacency.has(start) || !adjacency.has(end)) return null;
  if (start === end) return null;
  if (from.edge && to.edge && from.edge.a === to.edge.a && from.edge.b === to.edge.b) {
    const cost = from.edge.length * Math.abs(from.t - to.t);
    adjacency.get(start).set(end, cost); adjacency.get(end).set(start, cost);
  }
  const costs = new Map([[start, 0]]), previous = new Map(), queue = [[0, start]], visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => b[0] - a[0]);
    const [cost, current] = queue.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === end) break;
    for (const [next, length] of adjacency.get(current)) {
      const candidate = cost + length;
      if (candidate < (costs.get(next) ?? Infinity)) { costs.set(next, candidate); previous.set(next, current); queue.push([candidate, next]); }
    }
  }
  if (!costs.has(end) || costs.get(end) < 1) return null;
  const path = [end];
  while (path[0] !== start) { const p = previous.get(path[0]); if (!p) return null; path.unshift(p); }
  return { coordinates: path.map((id) => positions.get(id)), lengthMeters: costs.get(end) };
}
