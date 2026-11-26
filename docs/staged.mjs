import {energyEnabled,priceTicket,energyBudgetView,lowerBoundEnergy,availableForTour,exceedsCapacity,permanentEnergyBlock} from './energy.mjs';
import {segment,stagePlan,trip} from './physical.mjs';
import {sweep,shortage} from './traffic.mjs';

const windows={
 export:{ET:['rail','land'],SMV:['land','bay'],BAY:['smv','agv'],RMG:['rail','rail'],
  railAGV:['bay','yard'],railYC:['yard','yard'],shipAGV:['quay','qc'],shipYC:['quay','quay'],QC:['qc','qc'],LAND:['et','smv']},
 import:{ET:['land','rail'],SMV:['bay','land'],BAY:['agv','smv'],RMG:['rail','rail'],
  railAGV:['agv','bay'],railYC:['agv','agv'],shipAGV:['qc','yard'],shipYC:['yard','yard'],QC:['qc','qc'],LAND:['smv','et']},
};
const roadLabels={'road:ET':'铁路集卡通道','road:SMV':'悬轨主线','road:west':'西侧 AGV 通道','road:east':'东侧 AGV 通道','berth:LAND':'陆侧联合作业位'};
export function zoneLabel(id){
 return roadLabels[id]??(id.startsWith('berth:')?'海侧泊位 '+id.slice(6):id.startsWith('sweep:')?'吊机走行区 '+id.split(':')[1]:id.replace('equipment:',''));
}
const claim=(id,range,props={})=>({id,start:range[0],end:range[1],state:'future',...props});
const overlap=(a,b)=>a.id===b.id || (a.span && b.span && a.span.kind===b.span.kind && a.span.lo<b.span.hi && b.span.lo<a.span.hi);
const stepKey=c=>c.stage.split('-')[1];
export function gate(sim,ticket,c){
 const needed=ticket.claims.filter(x=>x.state==='future' && x.start===stepKey(c));
 const blockers=[];
 for(const item of needed){
  if(item.resourceId && sim.resourceMap.get(item.resourceId).status==='fault')blockers.push({zone:item.id,faultId:item.resourceId,seq:null,containerId:null,active:false});
  for(const old of sim.tickets.values()){
   if(old.seq>=ticket.seq)break;
   const precedes=old.claims.find(x=>x.state!=='released' && overlap(item,x));
   if(precedes)blockers.push({zone:item.id,seq:old.seq,containerId:old.containerId,active:precedes.state==='active'});
  }
 }
 return {needed,blockers};
}
function booked(sim,resource){
 let count=0;
 for(const t of sim.tickets.values())if(t.claims.some(x=>x.resourceId===resource.id&&x.state!=='released'))count++;
 return count;
}
export function firstRoad(sim,c){
 const {rail}=segment(c);
 return c.stage==='export-rail'?'road:ET':rail?'road:west':'road:east';
}
export function unavailableRoad(sim,c){
 const road=firstRoad(sim,c);
 for(const t of sim.tickets.values())if(t.claims.some(x=>x.id===road && x.state!=='released'))return t;
 return null;
}
function materialize(sim,c,first,rail,slot,machines,spans){
 const range=windows[c.direction],bindings={},claims=[];
 for(const [kind,r] of Object.entries(machines)){
  const when=range[(kind==='AGV'||kind==='YC')?(rail?'rail':'ship')+kind:kind];
  bindings[kind]=r.id;
  claims.push(claim('equipment:'+r.id,when,{resourceId:r.id}));
  if(kind==='ET'||kind==='SMV')claims.push(claim('road:'+kind,when));
  if(kind==='AGV'){
   claims.push(claim(rail?'road:west':'road:east',when));
   if(!rail && sim.config.agv===1)claims.push(claim('road:west',when));
  }
  if(kind==='BAY')claims.push(claim('berth:'+r.id,when));
  if(spans[kind])claims.push(claim('sweep:'+r.id+':'+c.id,when,{span:spans[kind]}));
 }
 if(rail)claims.push(claim('berth:LAND',range.LAND));
 return {seq:sim.nextTicket,containerId:c.id,slotId:slot.id,first,rail,bindings,claims,decision:null};
}
function waitingOn(blockers){
 return [{kind:'TRAFFIC',total:blockers.length,busy:blockers.length,resourceIds:blockers.map(b=>zoneLabel(b.zone)),containerIds:blockers.map(b=>b.containerId)}];
}
export function propose(sim,c,slots){
 const {rail,first,kinds}=segment(c),fixed={},pools={},reasons=[];
 if(energyEnabled(sim)){
  const reason=permanentEnergyBlock(sim,c,rail,first);
  if(reason)return {reasons:[reason]};
 }
 for(const kind of kinds.filter(k=>!['RMG','QC','YC'].includes(k))){
  let pool=sim.equipment[kind];
  if(kind==='AGV'&&pool.length>=2)pool=pool.filter((r,i)=>(i%2===0)===rail);
  if(kind==='BAY'&&pool.length>=2)pool=pool.filter((r,i)=>(i%2===0)===(c.direction==='export'));
  const choices=pool.filter(r=>r.status!=='fault');
  if(!choices.length)reasons.push(shortage(kind,pool));
  else{
   fixed[kind]=choices.reduce((a,b)=>booked(sim,b)<booked(sim,a)?b:a);
   if(energyEnabled(sim)&&(kind==='BAY'||kind==='AGV'))pools[kind]=choices.sort((a,b)=>booked(sim,a)-booked(sim,b));
  }
 }
 const end=rail?'RMG':'QC',endSweep=sweep(sim,end,rail?c.railSlot.pose.y:c.shipSlot.pose.y);
 if(!endSweep.resource||endSweep.resource.status==='fault')reasons.push(shortage(end,endSweep.resource?[endSweep.resource]:[]));
 else fixed[end]=endSweep.resource;
 const options=first?slots[c.direction].filter(s=>!s.reservedFor&&!s.containerId):[sim.slotMap.get(c.slotId)];
 if(!options.length){
  const pool=sim.slotsByDirection[c.direction];
  reasons.push({kind:'YARD',total:pool.length,busy:pool.length,resourceIds:pool.map(s=>s.id),containerIds:pool.map(s=>s.containerId??s.reservedFor)});
 }
 if(reasons.length)return {reasons};
 const flatFloor=energyEnabled(sim)?lowerBoundEnergy(sim,c,rail,options,pools.BAY??[]):0;
 if(energyEnabled(sim)&&exceedsCapacity(sim,flatFloor))return {reasons:[{
  kind:'ENERGY',code:'unreachable',detail:'全部候选往返的最低能耗加保底已超过满电容量',total:pools.AGV.length,busy:pools.AGV.length,
  resourceIds:pools.AGV.map(r=>r.id),containerIds:[c.id],lowerBoundKWh:flatFloor}]};
 const exhausted=new Set();
 const cannotAfford=new Set((pools.AGV??[]).filter(r=>availableForTour(sim,r)+1e-8<flatFloor).map(r=>r.id));
 let last=[];const energyReasons=new Map(),chargeRequests=new Map();
 for(const slot of options){
  const yard=sweep(sim,'YC',slot.pose.x);
  if(!yard.resource||yard.resource.status==='fault'){last=[shortage('YC',yard.resource?[yard.resource]:[])];continue;}
  for(const agv of pools.AGV??[fixed.AGV])for(const bay of pools.BAY??[fixed.BAY]){
   if(exhausted.has(agv.id))break;
   const machines={...fixed,AGV:agv,YC:yard.resource};
   if(bay)machines.BAY=bay;
   const t=materialize(sim,c,first,rail,slot,machines,{[end]:endSweep.span,YC:yard.span});
   const checks=gate(sim,t,c);
   if(checks.blockers.length){last=waitingOn(checks.blockers);continue;}
   if(energyEnabled(sim)){
    const energy=priceTicket(sim,c,t);
    if(!energy.budget){
     const key=agv.id;
     if(!energyReasons.has(key)||energyReasons.get(key).requiredKWh>energy.reason.requiredKWh)energyReasons.set(key,energy.reason);
     if(energy.request&&(!chargeRequests.has(key)||chargeRequests.get(key).targetKWh>energy.request.targetKWh))chargeRequests.set(key,energy.request);
     if(cannotAfford.has(key)&&energy.reason.code!=='unreachable')exhausted.add(key);
     continue;
    }
    t.budget=energy.budget;
   }
   return {ticket:t};
  }
  if(pools.AGV && exhausted.size===pools.AGV.length)break;
 }
 return {reasons:energyReasons.size?[...energyReasons.values()]:last,chargeRequests:[...chargeRequests.values()]};
}
export function dispatchScore(sim,c,ticket){
 const policy=sim.config.dispatchPolicy;
 if(policy==='edd')return c.due;
 if(policy!=='empty-distance')return c.readyAt;
 const slot=sim.slotMap.get(ticket.slotId);
 const preview={...c,segmentRail:ticket.rail,bayId:ticket.bindings.BAY};
 const p=stagePlan(preview,ticket.bindings,slot,sim.layout);
 let distance=0;
 for(const kind of p.kinds.filter(k=>k!=='BAY')){
  const r=sim.resourceMap.get(ticket.bindings[kind]),from=r.home,dest={...p.position,z:from.z};
  if(kind==='RMG'||kind==='QC')dest.x=from.x;
  if(kind==='YC')dest.y=from.y;
  distance+=trip(from,dest,kind,sim.layout).distance;
 }
 return distance;
}
export function ticketView(sim,t,c){
 const active=t.claims.filter(x=>x.state==='active'),future=t.claims.filter(x=>x.state==='future');
 const gateState=c.action?{needed:[],blockers:[]}:gate(sim,t,c);
 const zones=items=>items.filter(x=>!x.resourceId).map(x=>x.id);
 return {seq:t.seq,containerId:c.id,segment:t.rail?'rail':'ship',plannedResourceIds:Object.values(t.bindings),
  heldResourceIds:active.flatMap(x=>x.resourceId?[x.resourceId]:[]),futureResourceIds:future.flatMap(x=>x.resourceId?[x.resourceId]:[]),
  pendingZones:zones(future),activeZones:zones(active),awaitedZones:[...new Set(gateState.blockers.map(x=>x.zone))],
  blockers:gateState.blockers,energyBudget:energyBudgetView(sim,t),decision:{...t.decision}};
}
