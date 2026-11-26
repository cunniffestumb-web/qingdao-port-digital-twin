import {NODES} from './domain.mjs';
import {routeBetween,yardLane} from './layout.mjs';

const tolerance=1e-8;
const lengths=new WeakMap();
export const energyEnabled=s=>s.config.energyMode==='parking-contact';
const reserve=s=>s.config.batteryKWh*s.config.reserveSocPct/100;
const initial=s=>s.config.batteryKWh*s.config.initialSocPct/100;
const sideOf=r=>Number(r.id.slice(4))%2===1?'west':'east';
const energyOf=(s,empty,loaded)=>(empty*s.config.emptyKWhPerKm+loaded*s.config.loadedKWhPerKm)/1000;

export function initializeEnergy(s){
 s.batteries=new Map();
 if(!energyEnabled(s))return;
 for(const r of s.equipment.AGV)s.batteries.set(r.id,{charged:0,chargingSeconds:0,queueSeconds:0,request:null,session:null});
}
function routeLength(layout,a,b){
 let cache=lengths.get(layout);
 if(!cache){cache=new Map();lengths.set(layout,cache);}
 const key=[a.x,a.y,b.x,b.y].join('/');
 if(!cache.has(key)){
  const {points}=routeBetween(layout,'AGV',a,b);
  let m=0;
  for(let i=1;i<points.length;i++)m+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
  cache.set(key,m);
 }
 return cache.get(key);
}
function tour(s,c,t){
 const r=s.resourceMap.get(t.bindings.AGV),slot=s.slotMap.get(t.slotId);
 const yard={x:slot.pose.x,y:yardLane(t.rail)};
 const remote=t.rail?s.resourceMap.get(t.bindings.BAY).home:{x:NODES.quay.x,y:c.shipSlot.pose.y};
 const outsideFirst=t.rail===(c.direction==='export'),a=outsideFirst?remote:yard,b=outsideFirst?yard:remote;
 const emptyMetres=routeLength(s.layout,r.home,a)+routeLength(s.layout,b,r.home);
 const loadedMetres=routeLength(s.layout,a,b);
 return {resourceId:r.id,emptyMetres,loadedMetres,requiredKWh:energyOf(s,emptyMetres,loadedMetres),spent:0};
}
function storedAtRest(s,r,b){
 return initial(s)+b.charged-energyOf(s,r.emptyMetres,r.loadedMetres);
}
function commitments(s,r){
 let remaining=0,booked=false;
 for(const t of s.tickets.values())if(t.budget?.resourceId===r.id && !t.budget.returned){
  remaining+=Math.max(0,t.budget.requiredKWh-t.budget.spent);booked=true;
 }
 return {remaining,booked};
}
// Every ground route is rectilinear. The two empty legs via home are at
// least as long as the direct remote-to-yard displacement by the triangle
// inequality. This is a lower bound across all available bays/yard columns,
// never a substitute for pricing an accepted tour against the real graph.
export function lowerBoundEnergy(s,c,rail,slots,bays){
 const remoteX=rail?bays[0].home.x:NODES.quay.x,y=yardLane(rail);
 const dx=Math.min(...slots.map(v=>Math.abs(v.pose.x-remoteX)));
 const dy=rail?Math.min(...bays.map(r=>Math.abs(r.home.y-y))):Math.abs(c.shipSlot.pose.y-y);
 return energyOf(s,dx+dy,dx+dy);
}
const structuralFloors=new WeakMap();
export function permanentEnergyBlock(s,c,rail,first){
 const memo=structuralFloors.get(c);
 if(memo?.layout===s.layout&&memo.step===c.step)return memo.reason;
 const slots=first?s.slotsByDirection[c.direction]:[s.slotMap.get(c.slotId)];
 const bays=s.equipment.BAY.filter((r,i)=>s.equipment.BAY.length<2||(i%2===0)===(c.direction==='export'));
 const agvs=s.equipment.AGV.filter((r,i)=>s.equipment.AGV.length<2||(i%2===0)===rail);
 let reason=null;
 if(slots.length&&agvs.length&&(!rail||bays.length)){
  const lowerBoundKWh=lowerBoundEnergy(s,c,rail,slots,bays);
  const impossible=exceedsCapacity(s,lowerBoundKWh);
  const noCircuit=agvs.every(r=>!s.config[sideOf(r)+'Circuits'])&&initial(s)+tolerance<reserve(s)+lowerBoundKWh;
  if(impossible||noCircuit)reason={kind:'ENERGY',code:impossible?'unreachable':'no-circuit',
    detail:impossible?'全部候选往返的最低能耗加保底已超过满电容量':'所属停车区无供电回路且初始电量不足',
    total:agvs.length,busy:agvs.length,resourceIds:agvs.map(r=>r.id),containerIds:[c.id],lowerBoundKWh};
 }
 structuralFloors.set(c,{layout:s.layout,step:c.step,reason});return reason;
}
export function availableForTour(s,r){
 const b=s.batteries.get(r.id);
 return b.session?-Infinity:storedAtRest(s,r,b)-commitments(s,r).remaining-reserve(s);
}
export function exceedsCapacity(s,kWh){return kWh+reserve(s)>s.config.batteryKWh+tolerance;}
export function priceTicket(s,c,t){
 const budget=tour(s,c,t),r=s.resourceMap.get(budget.resourceId),b=s.batteries.get(r.id);
 const floor=reserve(s)+budget.requiredKWh,side=sideOf(r),committed=commitments(s,r);
 const circuits=s.config[side+'Circuits'];
 let code,detail;
 if(floor>s.config.batteryKWh+tolerance){code='unreachable';detail='满电仍不足以完成往返并保留安全电量';}
 else if(b.session){code='charging';detail='车辆正在停车袋补能';}
 else if(storedAtRest(s,r,b)-committed.remaining+tolerance>=floor)return {budget};
 else if(!circuits){code='no-circuit';detail='所属停车区没有可用供电回路';}
 else if(committed.booked){code='committed';detail='电量已承诺给先前获准的运输段';}
 else {code='needs-charge';detail='等待在本车停车袋补能';}
 const reason={kind:'ENERGY',code,detail,total:1,busy:1,resourceIds:[r.id],containerIds:[c.id],requiredKWh:budget.requiredKWh};
 const request=code==='needs-charge'||code==='no-circuit'
   ?{resourceId:r.id,containerId:c.id,targetKWh:Math.min(s.config.batteryKWh,Math.max(floor,s.config.targetSocPct*s.config.batteryKWh/100))}:null;
 return {reason,request};
}
export function accountMotion(s,c,r,metres,loaded){
 if(!energyEnabled(s)||r.kind!=='AGV')return;
 const budget=s.tickets.get(c.id)?.budget;
 if(!budget||budget.resourceId!==r.id)throw new Error('移动的 AGV 缺少能源承诺 '+r.id);
 budget.spent+=energyOf(s,loaded?0:metres,loaded?metres:0);
 if(budget.spent>budget.requiredKWh+tolerance)throw new Error('AGV 实走能量超过已登记的往返预算 '+r.id);
}
export function returnBudget(s,c,r){
 if(!energyEnabled(s)||r.kind!=='AGV')return;
 const b=s.tickets.get(c.id).budget;
 if(Math.abs(b.spent-b.requiredKWh)>tolerance)throw new Error('AGV 归位时预算与实际里程不符 '+r.id);
 b.returned=true;
}
function distanceInMotion(s,c,r){
 const a=c?.action;
 if(!a || c.binding.AGV!==r.id)return 0;
 const loaded=a.kind==='ride'&&a.kinds[0]==='AGV';
 const p=loaded?a.path:a.trips?.AGV;
 if(!p||p.arrived)return 0;
 const fraction=Math.max(0,Math.min(1,((c.blockedAt??s.time)-a.begin)/(loaded?a.duration:p.duration)));
 const when=p.seconds*fraction;
 let metres=0;
 for(const f of p.phases)if(f.edgeId){
  const elapsed=1-(f.until-when)/f.duration;
  metres+=Math.hypot(f.b.x-f.a.x,f.b.y-f.a.y)*Math.min(1,Math.max(0,elapsed));
 }
 return energyOf(s,loaded?0:metres,loaded?metres:0);
}
export function energyBudgetView(s,t){
 if(!t.budget)return null;
 const b=t.budget,r=s.resourceMap.get(b.resourceId);
 return {resourceId:b.resourceId,emptyMetres:b.emptyMetres,loadedMetres:b.loadedMetres,requiredKWh:b.requiredKWh,
  remainingKWh:Math.max(0,b.requiredKWh-b.spent-distanceInMotion(s,t.cargo,r))};
}
function note(s,type,r,message,req,extra={}){
 s.events.push({id:s.events.length+1,time:s.time,type,resourceId:r.id,containerId:null,stage:null,
  requestedBy:req.containerId,side:sideOf(r),targetKWh:req.targetKWh,message:r.id+' '+message,...extra});
}
function delivered(s,p){
 const elapsed=Math.min(p.endsAt,s.time)-p.at;
 return s.time>=p.endsAt?p.amount:Math.min(p.amount,elapsed*s.config.chargeKW*s.config.chargeEfficiency/3600);
}
function stopCharge(s,r,b,interrupted){
 const p=b.session;
 const chargedKWh=delivered(s,p),duration=s.time-p.at;
 b.charged+=chargedKWh;b.chargingSeconds+=duration;b.session=null;
 note(s,interrupted?'charge-interrupt':'charge-end',r,interrupted?'故障断开电源':'达到补能目标',p,{chargedKWh,gridKWh:chargedKWh/s.config.chargeEfficiency,duration,storedKWh:storedAtRest(s,r,b),startKWh:p.targetKWh-p.amount});
 s.needsDispatch=true;
}
export function chargeBoundaries(s){
 if(!energyEnabled(s))return;
 for(const [id,b] of s.batteries){
  const r=s.resourceMap.get(id);
  if(b.session && (s.time>=b.session.endsAt || r.status==='fault'))stopCharge(s,r,b,r.status==='fault');
  if(b.request && r.status==='fault')cancelQueue(s,r,b);
 }
}
function cancelQueue(s,r,b){
 if(!b.request)return;
 b.queueSeconds+=s.time-b.request.at;
 note(s,'charge-dequeue',r,'退出供电队列',b.request);b.request=null;
}
export function cancelEnergyQueue(s,resourceId){
 if(energyEnabled(s))cancelQueue(s,s.resourceMap.get(resourceId),s.batteries.get(resourceId));
}
export function serveCharging(s,requests){
 if(!energyEnabled(s))return;
 const waiting=new Set(s.containers.filter(c=>c.status==='waiting').map(c=>c.id));
 const covered=new Set();
 for(const [id,b] of s.batteries){
  if(b.request&&!waiting.has(b.request.containerId))cancelQueue(s,s.resourceMap.get(id),b);
  if(b.request||b.session)covered.add((b.request??b.session).containerId);
 }
 for(const choices of requests){
  for(const req of choices){
   if(covered.has(req.containerId))break;
   const r=s.resourceMap.get(req.resourceId),b=s.batteries.get(r.id);
   if(b.request||b.session||r.status!=='idle'||commitments(s,r).booked)continue;
   if(r.pose.x!==r.home.x || r.pose.y!==r.home.y)throw new Error('停车充电请求离开指定车位 '+r.id);
   b.request={...req,at:s.time};covered.add(req.containerId);note(s,'charge-queue',r,'在本车停车袋申请补能',req);
   break;
  }
 }
 for(const side of ['west','east']){
  const fleet=s.equipment.AGV.filter(r=>sideOf(r)===side);
  let free=s.config[side+'Circuits']-fleet.filter(r=>s.batteries.get(r.id).session).length;
  const queue=fleet.filter(r=>s.batteries.get(r.id).request).sort((a,b)=>s.batteries.get(a.id).request.at-s.batteries.get(b.id).request.at||a.id.localeCompare(b.id));
  for(const r of queue){
   if(free<=0)break;
   const b=s.batteries.get(r.id),q=b.request;
   const amount=q.targetKWh-storedAtRest(s,r,b);
   if(amount<=tolerance){cancelQueue(s,r,b);continue;}
   b.queueSeconds+=s.time-q.at;b.request=null;
   const seconds=3600*amount/(s.config.chargeKW*s.config.chargeEfficiency);
   const endsAt=Number((s.time+seconds).toFixed(9));
   b.session={...q,at:s.time,endsAt,amount};free--;
   note(s,'charge-start',r,'接入停车袋供电回路',q);
  }
 }
}
export function nextCharge(s){
 let next=Infinity;
 for(const b of s.batteries.values())if(b.session)next=Math.min(next,b.session.endsAt);
 return next;
}
export function batteryView(s,r,view){
 const b=s.batteries.get(r.id),p=b.session,charged=b.charged+(p?delivered(s,p):0);
 const emptyKWh=energyOf(s,view.emptyMetres,0),loadedKWh=energyOf(s,0,view.loadedMetres);
 const storedKWh=initial(s)+charged-emptyKWh-loadedKWh;
 const {remaining,booked}=commitments(s,r),partial=energyOf(s,view.emptyMetres-r.emptyMetres,view.loadedMetres-r.loadedMetres);
 const committedKWh=Math.max(0,remaining-partial);
 return {state:r.status==='fault'?'fault':p?'charging':b.request?'waiting-charge':booked?'committed':'parked',
  side:sideOf(r),capacityKWh:s.config.batteryKWh,initialKWh:initial(s),storedKWh,committedKWh,
  availableKWh:Math.max(0,storedKWh-committedKWh-reserve(s)),emptyKWh,loadedKWh,chargedKWh:charged,gridKWh:charged/s.config.chargeEfficiency,
  targetKWh:(p??b.request)?.targetKWh??null,chargeEndsAt:p?.endsAt??null,chargingSeconds:b.chargingSeconds+(p?s.time-p.at:0),
  queueSeconds:b.queueSeconds+(b.request?s.time-b.request.at:0)};
}
export function energyView(s,resources){
 const enabled=energyEnabled(s),groups=[],totals={initialKWh:0,storedKWh:0,emptyKWh:0,loadedKWh:0,gridKWh:0,chargedKWh:0,chargingSeconds:0,queueSeconds:0};
 if(enabled)for(const side of ['west','east']){
  const rs=resources.filter(r=>r.energy?.side===side);
  for(const r of rs)for(const k of Object.keys(totals))totals[k]+=r.energy[k];
  groups.push({side,capacity:s.config[side+'Circuits'],activeResourceIds:rs.filter(r=>r.energy.state==='charging').map(r=>r.id),
   queueResourceIds:rs.filter(r=>r.energy.state==='waiting-charge').sort((a,b)=>s.batteries.get(a.id).request.at-s.batteries.get(b.id).request.at||a.id.localeCompare(b.id)).map(r=>r.id)});
 }
 const next=nextCharge(s);
 return {enabled,mode:s.config.energyMode??'off',totals,groups,nextEnergyEventAt:Number.isFinite(next)?next:null};
}
