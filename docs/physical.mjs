import {NODES} from './domain.mjs';

// Synthetic terminal geometry in metres; z is elevation and heading is radians in map XY.
import {pose,terminalSlot,yardSlot,homePose,routeBetween,yardLane,railTruckX} from './layout.mjs';
export {pose,terminalSlot,yardSlot,homePose};
const anchor=(key,z=0)=>pose(NODES[key].x,NODES[key].y,z);
const speeds={AGV:5,ET:6,SMV:5,RMG:2,QC:2,YC:2};
export const mobile=kind=>['AGV','ET','SMV'].includes(kind);
export const boxHeight=type=>type==='20GP'?2.591:2.896;
function angleDelta(a,b){return Math.atan2(Math.sin(b-a),Math.cos(b-a));}
export function trip(a,b,kind,layout){
  const {points,edgeIds}=routeBetween(layout,kind,a,b);
  const phases=[];
  let last=a,distance=0,seconds=0;
  function append(end,length,duration){
    if(duration>1e-9){seconds+=duration;phases.push({a:last,b:end,until:seconds,duration});}
    last=end;distance+=length;
  }
  function turn(heading){
    const angle=angleDelta(last.heading,heading);
    append({...last,heading},0,Math.abs(angle)/(Math.PI/6));
  }
  for(const [index,end] of points.slice(1).entries()){
    const dx=end.x-last.x,dy=end.y-last.y,length=Math.hypot(dx,dy);
    if(!length)continue;
    let heading=Math.atan2(dy,dx);
    // Suspended trolleys run in both directions with their body parallel to the beam.
    if(kind==='SMV' && Math.abs(angleDelta(last.heading,heading))>Math.PI/2)heading+=Math.PI;
    if(mobile(kind))turn(heading);
    append({...end,heading:last.heading},length,length/speeds[kind]);
    phases.at(-1).edgeId=edgeIds[index];
  }
  if(mobile(kind))turn(b.heading);
  return {points,edgeIds,phases,distance,seconds,duration:Math.ceil(seconds)};
}
export function blend(a,b,t){
  const angle=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading));
  return pose(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t,a.heading+angle*t);
}
export function along(path,progress){
  const time=path.seconds*progress;
  for(const phase of path.phases){
    if(time<phase.until)return blend(phase.a,phase.b,1-(phase.until-time)/phase.duration);
  }
  return {...path.points.at(-1)};
}
const segmentKinds={rail:['RMG','ET','SMV','BAY','AGV','YC'],ship:['YC','AGV','QC']};
export function segment(c){
  const first=c.step===0;
  const rail=(c.direction==='export')===first;
  return {first,rail,kinds:segmentKinds[rail?'rail':'ship']};
}
export function stagePlan(c,binding,slot,layout){
  const outbound=c.direction==='export';
  const key=c.stage.split('-')[1];
  const h=boxHeight(c.type);
  const station=node=>{
    if(node==='rail')return pose(railTruckX,c.railSlot.pose.y,0,Math.PI/2);
    if(node==='quay')return pose(NODES.quay.x,c.shipSlot.pose.y,0,Math.PI/2);
    if(node==='yard')return pose(slot.pose.x,yardLane(c.segmentRail),0);
    if(node==='seaside'&&c.bayId)return homePose('BAY','seaside',Number(c.bayId.split('-')[1]));
    if(node==='landside'||node==='seaside'){
      return anchor(node);
    }
    return anchor(node);
  };
  const deck=(kind,node)=>{
    const id=binding[kind];
    return {kind:kind==='SMV'?'suspension':'deck',id,label:id+(kind==='SMV'?' 挂架':' 车板'),
      pose:{...station(node),z:kind==='SMV'?10-h:1.2}};
  };
  const swaps={
    rail:['RMG',c.railSlot,deck('ET','rail'),['RMG','ET']],
    land:['SMV',deck('ET','landside'),deck('SMV','landside'),['ET','SMV']],
    bay:['SMV',deck('SMV','seaside'),deck('AGV','seaside'),['SMV','AGV','BAY']],
    qc:['QC',deck('AGV','quay'),c.shipSlot,['QC','AGV']],
  };
  const roads={
    et:['ET','rail','landside'],smv:['SMV','landside','seaside'],
    agv:['AGV','seaside','yard'],quay:['AGV','yard','quay'],
  };
  const actions=[];
  const lift=(crane,source,target,kinds,duration)=>{
    actions.push({kind:'lift',crane,source,target,kinds,duration,clearance:crane==='SMV'?0:crane==='QC'?15:4});
  };
  const duration=c.durations[c.step];
  if(swaps[key]){
    const [crane,a,b,kinds]=swaps[key];
    lift(crane,outbound?a:b,outbound?b:a,kinds,duration);
  }else if(key==='yard'){
    lift('YC',deck('AGV','yard'),slot,['AGV','YC'],duration);
  }else{
    const [kind,a,b]=roads[key],from=outbound?a:b,to=outbound?b:a;
    if(c.custody.kind==='yardSlot')lift('YC',slot,deck('AGV','yard'),['AGV','YC'],50);
    const source=deck(kind,from),target=deck(kind,to);
    const path=trip(source.pose,target.pose,kind,layout);
    actions.push({kind:'ride',kinds:[kind],source,target,duration:Math.max(duration,path.duration),path});
  }
  const node=key==='rail'?'rail':key==='qc'?'quay':key==='yard'?'yard':key==='land'?'landside':key==='bay'?'seaside':outbound?roads[key][1]:roads[key][2];
  const kinds=[...new Set(actions.flatMap(a=>a.kinds))];
  return {actions,kinds,node,position:station(node)};
}
export function liftPose(action,t){
  const a=action.source.pose,b=action.target.pose;
  const peak=Math.max(a.z,b.z)+action.clearance;
  if(t<0.25)return blend(a,{...a,z:peak},t*4);
  if(t<0.75)return blend({...a,z:peak},{...b,z:peak},(t-0.25)*2);
  return blend({...b,z:peak},b,(t-0.75)*4);
}
