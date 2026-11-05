import { BASIS_LABELS, trafficForView, buildTrafficIndex, compareTrafficSection, crashesNearTrafficSection, lineLengthMeters } from './traffic.js';

const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const decimal=new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const make=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const collection=features=>({type:'FeatureCollection',features});
const percent=value=>`${value>0?'+':''}${decimal.format(value)}%`;
const volumeColor=['step',['get','aadt'],'#8ac3bd',5000,'#47968e',15000,'#27717a',30000,'#245570',60000,'#183953'];

export class TrafficExplorer {
  constructor({map,data,state,closeCrash,onPickStart}) {
    Object.assign(this,{map,data,state,closeCrash,onPickStart});
    this.index=buildTrafficIndex(data);this.byId=new Map(data.features.map(f=>[f.properties.id,f]));this.selected=null;this.picking=false;this.signature=null;
    map.addSource('traffic',{type:'geojson',data:collection([])});
    map.addSource('traffic-selected',{type:'geojson',data:collection([])});
    map.addLayer({id:'traffic-casing',type:'line',source:'traffic',paint:{'line-color':'#ffffff','line-width':5,'line-opacity':.7}},'clusters');
    map.addLayer({id:'traffic-volume',type:'line',source:'traffic',filter:['!=',['get','basis'],'modeled'],paint:{'line-color':volumeColor,'line-width':['interpolate',['linear'],['zoom'],10,1.5,14,3,18,6],'line-opacity':.9}},'clusters');
    map.addLayer({id:'traffic-modeled',type:'line',source:'traffic',filter:['==',['get','basis'],'modeled'],paint:{'line-color':'#8c70a1','line-width':2.5,'line-dasharray':[2,2],'line-opacity':.8}},'clusters');
    map.addLayer({id:'traffic-selected-line',type:'line',source:'traffic-selected',paint:{'line-color':'#edb54c','line-width':8,'line-opacity':.95}},'clusters');
    for(const id of ['traffic-year','traffic-basis','traffic-visible'])$(id).addEventListener('change',()=>this.update());
    $('inspect-traffic').addEventListener('click',()=>{
      if(this.picking){this.cancelPicking();return;}
      this.onPickStart();this.closeDetails();this.closeCrash();this.picking=true;
      $('inspect-traffic').classList.add('active');$('traffic-pick-notice').hidden=false;
      $('traffic-pick-notice').textContent='Click a colored traffic line to inspect its volume and source. Escape cancels.';
      this.map.getCanvas().style.cursor='crosshair';
    });
    $('open-traffic').addEventListener('click',()=>{
      const feature=[...this.features].sort((a,b)=>lineLengthMeters(b)-lineLengthMeters(a))[0];
      if(feature)this.showDetails(feature);
    });
    $('close-traffic-detail').addEventListener('click',()=>this.closeDetails());
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){this.cancelPicking();this.closeDetails();}});
  }
  get year(){return +$('traffic-year').value;}
  get basis(){return $('traffic-basis').value;}
  get visible(){return $('traffic-visible').checked;}
  cancelPicking(){this.picking=false;$('inspect-traffic').classList.remove('active');$('traffic-pick-notice').hidden=true;this.map.getCanvas().style.cursor='';}
  closeDetails(){this.selected=null;$('traffic-detail').hidden=true;this.map.getSource('traffic-selected')?.setData(collection([]));}
  update(filters=this.filters) {
    if(!filters)return;this.filters=filters;
    const signature=[this.year,this.basis,this.state.road?.key,filters.ward].join('|');
    if(signature!==this.signature){
      this.features=trafficForView(this.data,this.year,this.basis,this.state.road?.key,filters.ward);
      this.visibleIds=new Set(this.features.map(f=>f.properties.id));
      this.map.getSource('traffic').setData(collection(this.features));this.signature=signature;
    }
    for(const id of ['traffic-casing','traffic-volume','traffic-modeled','traffic-selected-line'])this.map.setLayoutProperty(id,'visibility',this.visible?'visible':'none');
    $('traffic-legend').hidden=!this.visible;
    $('traffic-legend-year').textContent=`Traffic · ${this.year} inventory`;
    $('traffic-modeled-key').hidden=this.basis!=='all';
    const summary=this.data.summary[this.year];
    $('traffic-summary').textContent=`${fmt.format(this.features.length)} sections ${this.visible?'shown':'available'}${this.state.road?' on this road':''}. ${this.year} inventory: ${fmt.format(summary.records)} source sections; ${fmt.format(summary.withoutGeometry)} lack line geometry.${this.state.segment?' Traffic sections are shown in full, beyond the selected crash segment.':''}`;
    if(filters.ward)$('traffic-summary').textContent+=` Only sections intersecting Ward ${filters.ward}; official sections are shown in full.`;
    const modeled=trafficForView(this.data,this.year,'all',this.state.road?.key,filters.ward).filter(f=>f.properties.basis==='modeled').length;
    $('traffic-basis-note').textContent=this.basis==='actual'?'Only records whose AADT derivation is labeled “Actual” by the provider.':this.basis==='all'?`${fmt.format(modeled)} modeled sections in this selection are included; modeled lines are dashed.`:`${fmt.format(modeled)} modeled sections in this selection are excluded. Remaining volumes include estimates and values grown from older counts.`;
    const values=this.features.map(f=>f.properties.aadt);
    $('traffic-range').textContent=values.length?`Reported range: ${fmt.format(Math.min(...values))}–${fmt.format(Math.max(...values))} vehicles / day.`:'No volumes match this traffic view. Missing data does not mean zero traffic.';
    for(const id of ['open-traffic','inspect-traffic'])$(id).disabled=!this.visible||!this.features.length;
    if(!this.visible){this.cancelPicking();this.closeDetails();}
    else if(this.selected){if(!this.visibleIds.has(this.selected))this.closeDetails();else this.showDetails(this.byId.get(this.selected),false);}
  }
  handleClick(event,force=false) {
    if(!this.visible)return false;
    const picking=this.picking;
    if(!picking&&!force)return false;
    const p=event.point;
    const candidates=this.map.queryRenderedFeatures([[p.x-6,p.y-6],[p.x+6,p.y+6]],{layers:['traffic-volume','traffic-modeled']});
    const feature=candidates.map(f=>this.byId.get(f.properties.id)).find(f=>f&&this.visibleIds.has(f.properties.id));
    if(feature){this.cancelPicking();this.showDetails(feature);return true;}
    if(picking)$('traffic-pick-notice').textContent='Click closer to a colored traffic line, or use “Open a section” in the controls.';
    return picking;
  }
  showDetails(feature,move=true) {
    this.closeCrash();this.selected=feature.properties.id;
    this.map.getSource('traffic-selected').setData(collection([feature]));
    const p=feature.properties,content=$('traffic-detail-content');content.replaceChildren();
    content.append(make('span',BASIS_LABELS[p.basis],`traffic-badge ${p.basis}`),make('h2',p.road||p.route,'detail-location'),make('strong',`${fmt.format(p.aadt)}`,'traffic-aadt'),make('p','vehicles / day · reported AADT','traffic-aadt-unit'));
    const facts=make('dl','','detail-facts');
    for(const [label,value] of [['Inventory version',String(p.inventory)],['AADT collection year',p.countYear||'Not reported'],['AADT derivation',`${p.derivation} (code ${p.derivationCode??'not reported'})`],['Source of AADT',p.source],['Provider-reported date',p.reportedDate||'Not reported'],['Route identifier',p.route],['Station identifier',p.station||'Not reported'],['Assignment note',p.qualityNote||'Not reported']]){
      const row=make('div','');row.append(make('dt',label),make('dd',String(value)));facts.append(row);
    }
    content.append(facts);
    const other=p.inventory===2024?2023:2024,peer=compareTrafficSection(feature,this.index.get(`${other}|${p.route}`)||[],this.basis);
    const comparison=make('section','','traffic-peer');comparison.append(make('h3',`Compare ${other} inventory`));
    if(peer.aadt!==null){
      comparison.append(make('strong',`${fmt.format(peer.aadt)} vehicles / day`),make('p',`${decimal.format(peer.coverage*100)}% of the same route-measure interval has a matching volume.`));
      if(peer.change!==null)comparison.append(make('p',`${p.inventory} vs ${other}: ${percent(peer.change)} in reported AADT.`,'traffic-change'));
      else comparison.append(make('p','Incomplete or conflicting coverage: no percentage change is calculated.','traffic-caution'));
      const years=[...new Set(peer.peers.map(f=>f.properties.countYear||'not reported'))];
      comparison.append(make('p',`Other inventory’s collection-year field: ${years.join(', ')}.`));
    } else comparison.append(make('p','No comparable record for this route interval under the selected traffic-source filter.'));
    comparison.append(make('p','This compares inventory snapshots. It does not establish a calendar-year traffic trend.','traffic-caution'));content.append(comparison);
    const crashes=crashesNearTrafficSection(this.state.all,feature,this.filters);
    const nearby=make('section','','traffic-peer');nearby.append(make('h3','Crashes near this traffic section'),make('p',`Period A: ${fmt.format(crashes.a)} · Period B: ${fmt.format(crashes.b)}`,'traffic-nearby-counts'),make('p','Current crash filters; matching reported roadway and coordinates within 25 m. These counts are approximate and are not a crash rate.'));content.append(nearby);
    if(this.filters.ward)nearby.append(make('p',`Counts include only Ward ${this.filters.ward}. The official traffic section may cross its boundary.`));
    content.append(make('p','Traffic-adjusted crash rates are pending verified annual exposure. Inventory dates, collection years, and older-count adjustments are not interchangeable.','record-note'));
    const link=make('a','View original MassDOT section ↗','traffic-source-link');
    link.href=`${this.data.sources[p.inventory].url}/query?${new URLSearchParams({f:'pjson',where:`OBJECTID=${p.objectId}`,outFields:'*',returnGeometry:'false'})}`;link.target='_blank';link.rel='noopener noreferrer';content.append(link);
    $('traffic-detail').hidden=false;$('traffic-detail').scrollTop=0;
    if(move){
      const coordinates=feature.geometry.coordinates.flat();
      const xs=coordinates.map(xy=>xy[0]),ys=coordinates.map(xy=>xy[1]);
      const container=this.map.getContainer(),height=container.clientHeight,width=container.clientWidth;
      this.map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:{top:Math.min(115,height*.25),bottom:Math.min(135,height*.25),left:25,right:width>640?Math.min(340,width*.4):25},maxZoom:16.5,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:450});
    }
  }
}
