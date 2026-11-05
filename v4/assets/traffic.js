// Traffic snapshots are observations/estimates, never an assumed annual exposure series.
import { geometryLines, pointLineDistance, matchesFilters, project } from './analysis.js';

export const BASIS_LABELS={actual:'Provider Actual',estimate:'Estimated / derived',modeled:'Modeled',missing:'No volume'};
export function allowedTraffic(feature, basis='nonmodeled') {
  const p=feature.properties;
  if(!feature.geometry || !(p.aadt>0))return false;
  if(basis==='actual')return p.basis==='actual';
  return basis==='all' || p.basis!=='modeled';
}
export function trafficForView(collection, year, basis, roadKey=null, ward=null) {
  return collection.features.filter(f=>f.properties.inventory===year && allowedTraffic(f,basis) && (!roadKey || f.properties.keys.includes(roadKey)) && (!ward || f.properties.wards?.some(number=>String(number)===String(ward))));
}
export function lineLengthMeters(feature) {
  return geometryLines(feature).reduce((sum,line)=>sum+line.slice(1).reduce((n,xy,i)=>{const a=project(line[i]),b=project(xy);return n+Math.hypot(a[0]-b[0],a[1]-b[1]);},0),0);
}
export function buildTrafficIndex(collection) {
  const index=new Map();
  collection.features.forEach(f=>{const key=`${f.properties.inventory}|${f.properties.route}`;if(!index.has(key))index.set(key,[]);index.get(key).push(f);});
  return index;
}
export function compareTrafficSection(feature, peers, basis='nonmodeled') {
  const p=feature.properties, start=p.from, end=p.to;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return {coverage:0,aadt:null,change:null,ambiguous:false,peers:[]};
  const candidates=peers.filter(f=>allowedTraffic(f,basis)&&f.properties.route===p.route&&Number.isFinite(f.properties.from)&&Number.isFinite(f.properties.to)&&f.properties.to>start&&f.properties.from<end);
  const stops=[...new Set([start,end,...candidates.flatMap(f=>[Math.max(start,f.properties.from),Math.min(end,f.properties.to)])])].sort((a,b)=>a-b);
  let length=0,weighted=0,ambiguous=false;
  const used=new Map();
  for(let i=1;i<stops.length;i++) {
    const mid=(stops[i-1]+stops[i])/2, covers=candidates.filter(f=>f.properties.from<=mid&&f.properties.to>=mid);
    const values=[...new Set(covers.map(f=>f.properties.aadt))];
    if(values.length>1){ambiguous=true;continue;}
    if(values.length===1){const span=stops[i]-stops[i-1];length+=span;weighted+=span*values[0];covers.forEach(f=>used.set(f.properties.id,f));}
  }
  const coverage=Math.min(1,length/(end-start)),aadt=length?weighted/length:null;
  return {coverage,aadt,change:coverage>=1-1e-6&&!ambiguous&&aadt>0?(p.aadt-aadt)/aadt*100:null,ambiguous,peers:[...used.values()]};
}
export function crashesNearTrafficSection(records,feature,filters,distance=25) {
  const keys=new Set(feature.properties.keys);
  const matches=records.filter(r=>r.geometry&&matchesFilters(r,filters)&&r._roadKeys.some(k=>keys.has(k))&&pointLineDistance(r.geometry.coordinates,geometryLines(feature))<=distance);
  const count=period=>matches.filter(r=>r.properties.date>=period.start&&r.properties.date<=period.end).length;
  return {a:count(filters.a),b:count(filters.b)};
}
