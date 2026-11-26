import {NODES} from './domain.mjs';

export const pose=(x,y,z=0,heading=0)=>({x,y,z,heading});
export const gantryGauge=Object.freeze({QC:30.48,RMG:54.0,YC:102.6});
export const railTruckX=146;
export const yardLane=rail=>rail?323:403;
export const activityZones={
  rail:'陆侧交接与悬轨单线',
  west:'海侧至堆场西线',
  east:'堆场至岸桥东线',
};
const defaults={et:4,agv:6,smv:3,rmg:2,qc:2,yc:2,bay:2,yardCapacity:8,count:72};
export function terminalSlot(kind,index){
  const id=(kind==='railSlot'?'R':'S')+'-'+String(index+1).padStart(4,'0');
  const row=Math.floor(index/20),along=(index%20-9.5)*13;
  const node=kind==='railSlot'?NODES.rail:NODES.ship;
  const x=kind==='railSlot'?node.x-5-(row%4)*4:node.x+(row%12-5.5)*2.65;
  const y=node.y+along+(kind==='shipSlot'?Math.floor(row/12)*440:Math.floor(row/4)*286);
  return {kind,id,label:(kind==='railSlot'?'车厢 ':'舱位 ')+id,pose:pose(x,y,kind==='railSlot'?1.25:12,Math.PI/2)};
}
export function yardSlot(direction,i){
  const sign=direction==='export'?-1:1;
  const id=(sign<0?'YE':'YI')+'-'+String(i+1).padStart(2,'0');
  return {kind:'yardSlot',id,label:'堆位 '+id,direction,containerId:null,reservedFor:null,
    pose:pose(NODES.yard.x+(i%8-3.5)*13,NODES.yard.y+sign*(7+Math.floor(i/8)*3))};
}
export function homePose(kind,node,index){
  const i=index-1,ref=NODES[node];
  if(kind==='ET')return pose(231,225-i*22);
  if(kind==='SMV')return pose(498,263-i*19,12);
  if(kind==='AGV')return i%2===0?pose(666,247-Math.floor(i/2)*19):pose(944,480+Math.floor(i/2)*19);
  if(kind==='BAY')return pose(625,334+i*20);
  // Wide home separation leaves a fixed idle gantry clear of the neighbouring service territory.
  if(kind==='QC'||kind==='RMG')return pose(ref.x,ref.y+i*72,0,Math.PI/2);
  return pose(735+(i%3)*56,i<3?ref.y:110-(Math.floor(i/3)-1)*120);
}
const key=(kind,p)=>kind+':'+p.x+','+p.y;
const widths={ET:10,AGV:10,SMV:3,RMG:1,YC:1,QC:1};
function rectConflict(edge,rect,margin){
  // Segment against a rectangle expanded by the rotating vehicle's swept half-diagonal.
  const pad=(edge.level==='gantry'?3:9)+margin;
  const extents={QC:[18,18],RMG:[29,11],YC:[11,53]}[edge.kind]??[0,0];
  const halfX=rect.length/2+pad+extents[0],halfY=rect.width/2+pad+extents[1];
  const [a,b]=edge.points;
  let low=0,high=1;
  for(const [axis,radius] of [['x',halfX],['y',halfY]]){
    const d=b[axis]-a[axis],offset=rect[axis]-a[axis];
    if(!d){if(Math.abs(offset)>radius)return false;continue;}
    const left=(offset-radius)/d,right=(offset+radius)/d;
    low=Math.max(low,Math.min(left,right));high=Math.min(high,Math.max(left,right));
    if(low>high)return false;
  }
  return true;
}
export function clearOfTraffic(layout,rect,margin=0){
  return !layout.corridors.some(e=>rectConflict(e,rect,margin)) &&
    !layout.berths.some(b=>Math.abs(rect.x-b.pose.x)<(rect.length+b.length)/2+margin &&
      Math.abs(rect.y-b.pose.y)<(rect.width+b.width)/2+margin);
}

export function buildLayout(options={},demandCount=options.count??72){
 const cfg={...defaults,...options},nodes=[],corridors=[],parking=[],berths=[],edges=new Map(),positions=new Map();
 const xmin=[],ymin=[];
 function node(k,p){
  const id=key(k,p);
  if(!edges.has(id)){edges.set(id,[]);positions.set(id,p);nodes.push({id,kind:k,pose:p});xmin.push(p.x);ymin.push(p.y);}
  return id;
 }
 function join(k,p,q){
  const a=node(k,p),b=node(k,q);
  if(a===b||edges.get(a).some(e=>e.to===b))return;
  const id=k+' '+a.split(':')[1]+'→'+b.split(':')[1];
  const level=k==='SMV'?'elevated':['QC','YC','RMG'].includes(k)?'gantry':'ground';
  corridors.push({id,kind:k,level,width:widths[k],points:[p,q]});
  edges.get(a).push({to:b,id});edges.get(b).push({to:a,id});
 }
 function spine(k,x,ys,z=0){
  const values=[...new Set(ys)].sort((a,b)=>a-b);
  for(let i=1;i<values.length;i++)join(k,pose(x,values[i-1],z),pose(x,values[i],z));
 }
 function horizontal(k,y,xs,z=0){
  const values=[...new Set(xs)].sort((a,b)=>a-b);
  for(let i=1;i<values.length;i++)join(k,pose(values[i-1],y,z),pose(values[i],y,z));
 }
 const west=yardLane(true),east=yardLane(false);
 const rails=[],ships=[],columns=[],etPark=[],westPark=[],eastPark=[],smvPark=[],bays=[];
 for(let i=0;i<demandCount;i++){rails.push(terminalSlot('railSlot',i).pose.y);ships.push(terminalSlot('shipSlot',i).pose.y);}
 for(let i=0;i<cfg.yardCapacity;i++)columns.push(yardSlot('export',i).pose.x);
 for(const [kind,name] of [['ET','rail'],['SMV','landside'],['AGV','yard'],['RMG','rail'],['QC','quay'],['YC','yard'],['BAY','seaside']]){
  for(let i=1;i<=cfg[kind.toLowerCase()];i++){
   const p=homePose(kind,name,i),id=kind+'-'+String(i).padStart(2,'0');
   if(kind==='BAY'){bays.push(p.y);berths.push({id,kind:'sea',pose:p,length:18,width:7});continue;}
   parking.push({id:'P-'+id,resourceId:id,kind,pose:p});node(kind,p);
   if(kind==='ET'){etPark.push(p.y);join(kind,p,pose(208,p.y));}
   if(kind==='SMV'){smvPark.push(p.y);join(kind,p,pose(475,p.y,12));}
   if(kind==='AGV'){
    const w=i%2===1;(w?westPark:eastPark).push(p.y);join(kind,p,pose(w?690:920,p.y));
   }
  }
 }
 // Keep existing edge IDs stable when later jobs extend a railway module or vessel.
 function fillStops(values,kind,extras){
  const low=Math.min(...values,...extras),high=Math.max(...values,...extras);
  for(let i=0;i<2000;i+=20){
   for(let j=0;j<20;j++){
    const y=terminalSlot(kind,i+j).pose.y;
    if(y>=low&&y<=high)values.push(y);
   }
  }
 }
 fillStops(rails,'railSlot',[12,...parking.filter(r=>r.kind==='RMG').map(r=>r.pose.y)]);
 fillStops(ships,'shipSlot',[250,...parking.filter(r=>r.kind==='QC').map(r=>r.pose.y)]);
 spine('ET',railTruckX,[...rails,12]);horizontal('ET',12,[railTruckX,208]);horizontal('ET',258,[208,305]);spine('ET',208,[12,258,...etPark]);
 join('SMV',pose(305,258,12),pose(475,300,12));join('SMV',pose(475,300,12),pose(600,334,12));
 spine('SMV',475,[300,...smvPark],12);spine('SMV',600,[334,...bays],12);
 for(const y of bays){join('SMV',pose(600,y,12),pose(625,y,12));join('AGV',pose(625,y),pose(650,y));}
 spine('AGV',650,[west,...bays]);spine('AGV',690,[west,...westPark,...(cfg.agv===1?[east]:[])]);
 spine('AGV',920,[250,east,...eastPark]);horizontal('AGV',250,[920,1028]);spine('AGV',1028,[250,...ships]);
 horizontal('AGV',west,[650,690,...columns]);horizontal('AGV',east,[...(cfg.agv===1?[690]:[]),...columns,920]);
 for(const x of new Set(columns)){
  for(const [trunk,pad] of [[west,323],[east,403]]){
   join('AGV',pose(x,trunk),pose(x,pad));
   berths.push({id:'Y-'+x+'-'+pad,kind:'yard',pose:pose(x,pad),length:18,width:7});
  }
 }
 berths.push({id:'LAND',kind:'land',pose:pose(305,258),length:18,width:7});
 for(const [k,targets] of [['QC',ships],['RMG',rails],['YC',columns]]){
  const homes=parking.filter(p=>p.kind===k);
  if(k==='YC')for(const r of homes.filter(p=>p.pose.y!==NODES.yard.y))horizontal(k,r.pose.y,[r.pose.x-9,r.pose.x,r.pose.x+9]);
  const vals=[...targets,...homes.filter(p=>k!=='YC'||p.pose.y===NODES.yard.y).map(p=>k==='YC'?p.pose.x:p.pose.y)];
  if(k==='YC')horizontal(k,NODES.yard.y,vals);
  else spine(k,k==='QC'?1028:135,vals);
 }
 const layout={version:3,nodes,corridors,parking,berths,obstacles:[],bounds:{minX:Math.min(100,...xmin)-20,maxX:Math.max(1100,...xmin)+20,minY:Math.min(30,...ymin)-20,maxY:Math.max(650,...ymin)+20}};
 // Display-only stacks use proven clear rectangles, independent of demand and never used as cargo slots.
 function addStacks(xs,ys,length,width){
  for(const y of ys)for(const x of xs){
   const block={id:'D-'+x+'-'+y,kind:'stack',x,y,width,length};
   if(!clearOfTraffic(layout,block,8))continue;
   layout.obstacles.push(block);
   layout.bounds.minX=Math.min(layout.bounds.minX,x-length/2-15);
   layout.bounds.maxX=Math.max(layout.bounds.maxX,x+length/2+15);
   layout.bounds.minY=Math.min(layout.bounds.minY,y-width/2-15);
   layout.bounds.maxY=Math.max(layout.bounds.maxY,y+width/2+15);
  }
 }
 addStacks([350,530,750,885],[35,115,185,510,590,670],100,36);
 addStacks([320,490,670,845],[-125,-45,775,855],136,44);
 addStacks([-50,-210,-370],[115,300,500],124,48);
 Object.defineProperty(layout,'network',{value:{edges,positions,cache:new Map()}});
 return layout;
}
export function routeBetween(layout,kind,a,b){
 const {edges,positions,cache}=layout.network;
 const start=key(kind,a),end=key(kind,b),cacheKey=start+'>'+end;
 if(!edges.has(start)||!edges.has(end))throw new RangeError('路网缺少作业锚点 '+cacheKey);
 if(start===end)return {points:[a,b],edgeIds:[]};
 let path=cache.get(cacheKey);
 if(!path){
  const back=new Map([[start,null]]),queue=[start];
  for(let i=0;i<queue.length&&!back.has(end);i++)for(const edge of edges.get(queue[i])){
   if(back.has(edge.to))continue;
   back.set(edge.to,{from:queue[i],id:edge.id});queue.push(edge.to);
  }
  if(!back.has(end))throw new RangeError('作业点无连通路径 '+cacheKey);
  const intermediate=[],ids=[];
  for(let n=end;n!==start;){const e=back.get(n);ids.push(e.id);intermediate.push(n);n=e.from;}
  intermediate.reverse();intermediate.pop();path={intermediate,ids:ids.reverse()};cache.set(cacheKey,path);
 }
 return {points:[a,...path.intermediate.map(id=>({...positions.get(id),z:a.z})),b],edgeIds:path.ids};
}
