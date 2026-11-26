import {segment} from './physical.mjs';
import {activityZones} from './layout.mjs';

// A road corridor includes its junctions and rotating-vehicle envelope. The west
// and east fleets have independent parking and road networks (one pooled AGV
// uses the drawn connector). Gantries reserve their entire out-and-back sweep.
const halfDepth={RMG:10,QC:17,YC:10};
export function sweep(sim,kind,target){
 const axis=kind==='YC'?'x':'y';
 const fleet=sim.equipment[kind].filter(r=>!r.standby);
 let chosen=null,nearest=Infinity;
 for(const r of fleet){
   const d=Math.abs(r.home[axis]-target);
   if(d<nearest){chosen=r;nearest=d;}
 }
 if(!chosen)return {};
 const pad=halfDepth[kind]+1;
 return {resource:chosen,span:{kind,lo:Math.min(target,chosen.home[axis])-pad,hi:Math.max(target,chosen.home[axis])+pad}};
}
export function shortage(kind,pool){
 const blocked=pool.filter(r=>r.status!=='idle');
 const fault=blocked.filter(r=>r.status==='fault').length;
 return {kind,total:pool.length,busy:blocked.length-fault,...(fault?{fault}:{}),
   resourceIds:blocked.map(r=>r.id),containerIds:blocked.map(r=>r.containerId)};
}
function trafficReason(conflicts){
 return {kind:'TRAFFIC',total:conflicts.length,busy:conflicts.length,
   resourceIds:conflicts.map(o=>o.zone),containerIds:conflicts.map(o=>o.owner)};
}
export function probe(sim,c,slots){
 const {rail,first,kinds}=segment(c);
 const zones=rail?['rail','west']:['east'];
 if(sim.config.agv===1&&!rail)zones.push('west');
 const conflicts=[];
 for(const [owner,p] of sim.permits)for(const zone of zones)if(p.zones.includes(zone))conflicts.push({zone:activityZones[zone],owner});
 const held=conflicts.length?trafficReason(conflicts):null;
 const fixed={},reasons=[];
 for(const kind of kinds.filter(k=>!['YC','RMG','QC'].includes(k))){
   let pool=sim.equipment[kind];
   if(kind==='AGV'&&pool.length>=2)pool=pool.filter((r,i)=>(i%2===0)===rail);
   if(kind==='BAY'&&pool.length>=2)pool=pool.filter((r,i)=>(i%2===0)===(c.direction==='export'));
   const r=pool.find(r=>r.status==='idle');
   if(!r)reasons.push(shortage(kind,pool));else fixed[kind]=r;
 }
 const options=first?slots[c.direction].filter(s=>!s.reservedFor&&!s.containerId):[sim.slotMap.get(c.slotId)];
 if(!options.length){
    const pool=sim.slotsByDirection[c.direction];
    reasons.push({kind:'YARD',total:pool.length,busy:pool.length,resourceIds:pool.map(s=>s.id),containerIds:pool.map(s=>s.containerId??s.reservedFor)});
 }
 const endKind=rail?'RMG':'QC',endTarget=rail?c.railSlot.pose.y:c.shipSlot.pose.y;
 const end=sweep(sim,endKind,endTarget);
 if(!end.resource||end.resource.status!=='idle')reasons.push(shortage(endKind,end.resource?[end.resource]:[]));
 if(held)reasons.push(held);
 if(reasons.length)return {reasons};
 let last=[];
 for(const slot of options){
   const yard=sweep(sim,'YC',slot.pose.x);
   if(!yard.resource||yard.resource.status!=='idle'){last=[shortage('YC',yard.resource?[yard.resource]:[])];continue;}
   const spans=[end.span,yard.span];
   const occupied=[];
   for(const [owner,p] of sim.permits)for(const a of spans)for(const b of p.spans){
     if(a.kind===b.kind&&a.lo<b.hi&&b.lo<a.hi)occupied.push({zone:a.kind+' 轨道走行区',owner});
   }
   if(occupied.length){last=[trafficReason(occupied)];continue;}
   return {rail,first,slot,zones,spans,resources:{...fixed,[endKind]:end.resource,YC:yard.resource}};
 }
 return {reasons:last};
}
