import {buildLayout} from './layout.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const xy=p=>p.pose||p;
const points=path=>(path||[]).map(p=>p.x+','+p.y).join(' ');
const kindName={ET:'陆侧车道',AGV:'海侧车道',SMV:'空轨',QC:'岸桥',RMG:'铁路吊',YC:'堆场桥'};

// The fallback plan uses the engine's actual coordinates and shared layout.
// Its glyphs are symbolic and keep their centres on each authoritative pose.
export function createPlanView(svg){
 let layout=null,key='',latest=null,choice=null,focusTarget=null,view='overview',follow=false;
 function extent(){
  if(focusTarget){return {minX:focusTarget.x-105,maxX:focusTarget.x+105,minY:focusTarget.y-88,maxY:focusTarget.y+88};}
  const bounds=layout.bounds;
  return {minX:bounds.minX-30,maxX:bounds.maxX+30,minY:bounds.minY-30,maxY:bounds.maxY+30};
 }
 function region(){
  if(view==='overview'||view==='top'){focusTarget=null;return;}
  const kind={rail:'RMG',yard:'YC',ship:'QC'}[view],rs=latest.resources.filter(r=>r.kind===kind);
  if(rs.length)focusTarget={x:rs.reduce((n,r)=>n+r.pose.x,0)/rs.length,y:rs.reduce((n,r)=>n+r.pose.y,0)/rs.length};
 }
 function target(type,id){const o=(type==='container'?latest?.containers:latest?.resources)?.find(o=>o.id===id);return o?.pose;}
 function render(){
  if(!layout||!latest)return;
  if(follow&&choice)focusTarget=target(choice.type,choice.id)||focusTarget;
  const b=extent(),width=b.maxX-b.minX,height=b.maxY-b.minY;
  svg.setAttribute('viewBox',[b.minX,b.minY,width,height].join(' '));
  const pixel=Math.max(width/Math.max(300,svg.clientWidth),height/Math.max(340,svg.clientHeight));
  const size=Math.max(2.5,pixel*4.5),labelSize=pixel*16;
  const allEdges=layout.corridors||layout.edges||[];
  const edges=allEdges.map(edge=>{
   const path=edge.points||edge.polyline||[],elevated=edge.level>0||edge.kind==='SMV'||(edge.allowedKinds||[]).includes('SMV');
   const color=elevated?'#60dacc':'#536976';
   return '<g><title>'+esc(edge.label||edge.id)+' · '+esc(kindName[edge.kind]||'通道')+'</title><polyline points="'+points(path)+'" fill="none" stroke="'+color+'" stroke-width="'+Math.max(edge.width||3,pixel*1.3)+'" stroke-linejoin="round"/>'+(elevated?'<polyline points="'+points(path)+'" fill="none" stroke="#c5f1dc" stroke-width="'+pixel*.5+'" stroke-dasharray="'+pixel*4+' '+pixel*3+'"/>':'')+'</g>';
  }).join('');
  const parking=(layout.parking||layout.parkingPockets||[]);
  const parkingItems=Array.isArray(parking)?parking:Object.values(parking);
  const bays=parkingItems.map(item=>{const p=xy(item);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return '';return '<rect x="'+(p.x-7)+'" y="'+(p.y-2.5)+'" width="14" height="5" fill="#153644" stroke="#5b8895" stroke-width="'+pixel*.5+'"><title>'+esc(item.id)+'</title></rect>';}).join('');
  function marker(o,type){
   const p=o.pose;if(!p)return '';
   const selected=choice?.type===type&&choice?.id===o.id,cargo=type==='container';
   const color=o.status==='fault'?'#ffb38c':cargo?(o.direction==='export'?'#75baff':'#c3a3ff'):'#5ce2cd';
   const label=o.id+' · '+(cargo?o.stageLabel:o.kind);
   const length=o.type==='20GP'?6.058:12.192;
   const graphic=cargo?'<rect x="'+(-length/2)+'" y="-1.219" width="'+length+'" height="2.438" transform="rotate('+(p.heading*180/Math.PI)+')" fill="'+color+'" stroke="#10242f" stroke-width="'+pixel*.45+'"/>':'<circle r="'+size+'" fill="#17313d" stroke="'+color+'" stroke-width="'+pixel*1.5+'"/>';

   return '<g class="map-object" data-object="'+type+'" data-id="'+esc(o.id)+'" tabindex="0" role="button" aria-label="'+esc(label)+'" transform="translate('+p.x+' '+p.y+')"><title>'+esc(label)+'</title>'+(selected?'<circle r="'+size*2+'" fill="none" stroke="#fff" stroke-width="'+pixel+'"/>':'')+graphic+(selected?'<text x="0" y="'+(-size*3)+'" text-anchor="middle" fill="#e8f8ff" font-size="'+labelSize+'" stroke="#13242e" stroke-width="'+pixel*3+'" paint-order="stroke">'+esc(o.id)+'</text>':'')+'</g>';
  }
  const trackRanges=new Map();
  for(const cargo of latest.containers){const p=cargo.railSlot?.pose;if(!p)continue;const r=trackRanges.get(p.x)||[p.y,p.y];r[0]=Math.min(r[0],p.y);r[1]=Math.max(r[1],p.y);trackRanges.set(p.x,r);}
  const tracks=[...trackRanges].map(([x,[a,b]])=>[-.7175,.7175].map(dx=>'<path d="M'+(x+dx)+' '+(a-9)+'V'+(b+9)+'" stroke="#9cb2b9" stroke-width="'+Math.max(.07,pixel*.7)+'"/>').join('')).join('');
  const selectedCargo=choice?.type==='container'?latest.containers.find(c=>c.id===choice.id):null;
  const route=selectedCargo?latest.resources.filter(r=>r.containerId===selectedCargo.id).map(r=>'<polyline points="'+points(r.route?.points)+'" fill="none" stroke="#ffe4a0" stroke-width="'+pixel*1.5+'" stroke-dasharray="'+pixel*5+' '+pixel*3+'"/>').join(''):'';
  svg.innerHTML='<rect x="'+b.minX+'" y="'+b.minY+'" width="'+width+'" height="'+height+'" fill="#142b37"/>'+edges+tracks+bays+route+'<g id="markers">'+latest.resources.map(o=>marker(o,'resource')).join('')+latest.containers.filter(o=>o.status!=='completed'||o.id===choice?.id).map(o=>marker(o,'container')).join('')+'</g><text x="'+(b.minX+pixel*14)+'" y="'+(b.maxY-pixel*15)+'" font-size="'+labelSize+'" fill="#a4c5d4">共享路网 · 青色为空轨 · 符号中心对应实际位置</text>';
 }
 return {
  update(snapshot,selected){latest=snapshot;choice=selected;const next=JSON.stringify([snapshot.config,snapshot.layoutExtent||snapshot.containers.length]);if(key!==next){layout=buildLayout(snapshot.config,snapshot.layoutExtent||snapshot.containers.length);key=next;region();}render();},
  setView(name){view=name;follow=false;if(latest){region();render();}},
  focus(type,id){const p=target(type,id);if(!p)return false;focusTarget=p;follow=false;render();return true;},
  setFollow(on){follow=on;if(on&&choice)focusTarget=target(choice.type,choice.id);render();},
  resize:render,
 };
}
