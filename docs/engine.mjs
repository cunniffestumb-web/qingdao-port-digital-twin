import {energyDefaults,energySettings} from './energy-config.mjs';
import {initializeEnergy,accountMotion,returnBudget,cancelEnergyQueue,serveCharging,chargeBoundaries,nextCharge,energyEnabled,batteryView,energyView} from './energy.mjs';
import { readCheckpoint, taskOptions } from './scenarios.mjs';
import { NODES, ROUTES, STAGES } from './domain.mjs';

import {terminalSlot,yardSlot,homePose,boxHeight,trip,along,liftPose,stagePlan,segment} from './physical.mjs';

import {probe} from './traffic.mjs';
import {propose,gate,ticketView,dispatchScore,firstRoad,unavailableRoad,zoneLabel} from './staged.mjs';
import {buildLayout,activityZones} from './layout.mjs';

const fleet = [
  ['ET','rail',4], ['SMV','landside',3], ['AGV','yard',6],
  ['RMG','rail',2], ['BAY','seaside',2], ['YC','yard',2], ['QC','quay',2],
];

function integer(value,fallback,max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n=Number(value);
  return Number.isFinite(n) ? Math.max(0,Math.min(max,Math.trunc(n))) : fallback;
}

function seeded(seed) {
  let state=seed;
  return () => {
    state=(Math.imul(1664525,state)+1013904223)>>>0;
    return state / 4294967296;
  };
}

function log(sim,c,type,message,extra={}) {
  const event={id:sim.events.length+1,time:sim.time,type,containerId:c.id,stage:c.stage,message,...extra};
  sim.events.push(event);
  c.history.push(event);
}

function makeCargo(number,direction,type,release,due,priority,random) {
  const stages=ROUTES[direction];
  const durations=stages.map(id=>{
    const base=STAGES[id].duration;
    const variation=id.endsWith('-bay') ? 1 : 0.9;
    return Math.round(base*(variation+0.2*random()));
  });
  const railSlot=terminalSlot('railSlot',number-1),shipSlot=terminalSlot('shipSlot',number-1);
  const source=direction==='export'?railSlot:shipSlot;
  return {railSlot,shipSlot,custody:owner(source),pose:source.pose,binding:{},slotId:null,plan:null,action:null,id:'QD'+String(number).padStart(5,'0'),direction,type,teu:type==='20GP'?1:2,
    release,due,priority,origin:NODES[STAGES[stages[0]].from].label,
    destination:NODES[STAGES[stages.at(-1)].to].label,step:0,durations,stage:stages[0],
    status:'scheduled',carrierIds:[],history:[],wait:0,readyAt:null,completedAt:null,blockedAt:null};
}

export function createSimulation(options={}) {
  const config={seed:integer(options.seed,42,4294967295),count:integer(options.count,72,2000),yardCapacity:integer(options.yardCapacity,8,64)};
  if(options.energyMode===undefined&&Object.keys(energyDefaults).some(k=>options[k]!==undefined))throw new RangeError('请明确选择能源模式');
  const version=options.energyMode!==undefined?5:options.trafficPolicy!==undefined||options.dispatchPolicy!==undefined?4:3;
  if(version>=4){
    config.trafficPolicy=options.trafficPolicy??'staged';
    config.dispatchPolicy=options.dispatchPolicy??'fifo';
    if(!['segment','staged'].includes(config.trafficPolicy)||!['fifo','edd','empty-distance'].includes(config.dispatchPolicy))throw new RangeError('调度策略无效');
    if(config.trafficPolicy==='segment'&&config.dispatchPolicy!=='fifo')throw new RangeError('分段派工策略需要 staged 通行模式');
  }
  if(version===5)Object.assign(config,energySettings({...options,...config}));
  const resources=[];
  for (const [kind,home,defaultCount] of fleet) {
    const count=integer(options[kind.toLowerCase()],defaultCount,64);
    config[kind.toLowerCase()]=count;
    for (let i=1;i<=count;i++) {
      const p=homePose(kind,home,i);
      resources.push({id:kind+'-'+String(i).padStart(2,'0'),kind,status:'idle',containerId:null,
        home:p,standby:kind==='YC'&&i>3,standbyReason:kind==='YC'&&i>3?'单一箱区设三个独立走行区，额外场桥停放于北侧备用轨':null,parkingId:'P-'+kind+'-'+String(i).padStart(2,'0'),pose:p,soc:null,emptyMetres:0,loadedMetres:0,completed:0,busyTime:0,reservedTime:0,blockedTime:0,since:0,motion:'idle',frozen:false});
    }
  }
  const random=seeded(config.seed);
  const containers=[];
  for (let i=0;i<config.count;i++) {
    const direction=i%2 ? 'import' : 'export';
    const type=['20GP','40HQ','冷藏箱'][Math.floor(random()*3)];
    const release=i<8 ? 0 : Math.floor(i/8)*280+Math.floor(random()*130);
    const due=release+4500+Math.floor(random()*3600);
    const priority=random()<0.18 ? '加急' : '普通';
    containers.push(makeCargo(i+1,direction,type,release,due,priority,random));
  }
  const yardSlots=[];
  for(const direction of ['export','import'])for(let i=0;i<config.yardCapacity;i++)yardSlots.push(yardSlot(direction,i));
  const sim={time:0,modelVersion:version,tickets:new Map(),nextTicket:1,config,containers,resources,yardSlots,events:[],commands:[],
    layout:buildLayout(config,containers.length),permits:new Map(),
    equipment:Object.fromEntries(fleet.map(([k])=>[k,resources.filter(r=>r.kind===k)])),
    slotsByDirection:Object.fromEntries(['export','import'].map(d=>[d,yardSlots.filter(s=>s.direction===d)])),
    slotMap:new Map(yardSlots.map(s=>[s.id,s])),resourceMap:new Map(resources.map(r=>[r.id,r]))};
  initializeEnergy(sim);settle(sim);
  return sim;
}

const clockTime=seconds=>Number(seconds.toFixed(9));
function owner({kind,id,label}){return {kind,id,label};}
function ledgerKey(r){
  if(r.frozen)return 'blockedTime';
  if(r.motion==='reserved')return 'reservedTime';
  if(r.motion==='service'||r.motion==='reposition'||r.motion==='egress')return 'busyTime';
  return null;
}
function motion(sim,r,value,frozen=false){
  const key=ledgerKey(r);
  if(key)r[key]+=sim.time-r.since;
  r.motion=value;r.since=sim.time;r.frozen=frozen;
}
function assigned(sim,c,kind){return sim.resourceMap.get(c.binding[kind]);}
function clock(sim,c){return c.blockedAt??sim.time;}
function queue(sim,c){
  sim.needsDispatch=true;
  c.status='waiting';c.readyAt=sim.time;
  log(sim,c,'wait','等待整段设备与目的箱位');
}
function orderedWaiting(sim){
  return sim.containers.filter(c=>c.status==='waiting').sort((a,b)=>
    (sim.config.dispatchPolicy==='edd'?a.due-b.due:0)||a.readyAt-b.readyAt||(sim.config.dispatchPolicy==='edd'?0:Number(b.priority==='加急')-Number(a.priority==='加急'))||a.id.localeCompare(b.id));
}
function transfer(sim,c,receiver){
  c.custody=owner(receiver);
  log(sim,c,'custody','箱体移交至 '+receiver.label,{custody:{...c.custody}});
}
const motionPhase=a=>a.kind==='prepare'||a.kind==='egress';
function beginAction(sim,c){
  const a=c.plan.actions.shift();
  a.begin=sim.time;a.end=clockTime(a.begin+a.duration);c.action=a;
  c.carrierIds=a.kinds.map(k=>c.binding[k]);
  if(!c.plan.started && !motionPhase(a)){
    c.plan.started=true;
    log(sim,c,'start',STAGES[c.stage].label+' · '+c.carrierIds.join(' / '),{participants:[...c.carrierIds]});
  }
  for(const kind of a.kinds){
    const r=assigned(sim,c,kind);
    const moving=motionPhase(a) && a.trips[kind]?.duration>0;
    motion(sim,r,motionPhase(a)?(moving?(a.kind==='egress'?'egress':'reposition'):'reserved'):'service');
    if(moving)log(sim,c,'depart',r.id+(a.kind==='egress'?' 空驶返回停车位':' 空驶前往作业点'),{resourceId:r.id});
  }
  if(a.kind==='lift'){
    if(a.source.kind==='yardSlot'){
      const slot=sim.yardSlots.find(s=>s.id===a.source.id);
      slot.containerId=null;sim.needsDispatch=true;
    }
    const id=c.binding[a.crane];
    transfer(sim,c,{kind:'spreader',id,label:id+' 吊具'});
    log(sim,c,'lift',id+' 起吊',{resourceId:id});
  }
}

function beginStage(sim,c){
  const slot=sim.yardSlots.find(s=>s.id===c.slotId);
  const p=stagePlan(c,sim.tickets.get(c.id)?.bindings??c.binding,slot,sim.layout);
  c.plan=p;
  const trips={};
  let duration=0;
  for(const kind of p.kinds.filter(k=>k!=='BAY')){
    const r=assigned(sim,c,kind);
    const dest={...p.position,z:r.pose.z};
    if(kind==='QC'||kind==='RMG'){dest.x=r.pose.x;dest.heading=Math.PI/2;}
    if(kind==='YC'){dest.y=r.pose.y;dest.heading=0;}
    const path=trip(r.pose,dest,kind,sim.layout);
    if(path.duration){trips[kind]=path;duration=Math.max(duration,path.duration);}
  }
  if(duration){
    // Establish the gantry's longitudinal alignment before admitting the truck
    // to the inner transfer lane. Withdraw the truck first on return.
    const ordered=p.kinds.includes('YC') && trips.YC && trips.AGV
      ? [{YC:trips.YC},{AGV:trips.AGV}] : [trips];
    p.actions.unshift(...ordered.map(group=>({kind:'prepare',duration:Math.max(...Object.values(group).map(t=>t.duration)),kinds:p.kinds,trips:group})));
  }
  log(sim,c,'dispatch','段内派工 '+p.kinds.map(k=>c.binding[k]).join(' / '));
  beginAction(sim,c);
}
const releases={
  export:{rail:['RMG'],land:['ET'],bay:['SMV','BAY'],yard:['YC','AGV'],quay:['YC'],qc:['QC','AGV']},
  import:{qc:['QC'],yard:['AGV','YC'],agv:['YC'],bay:['AGV','BAY'],land:['SMV'],rail:['ET','RMG']},
};
function finishAction(sim,c){
  const a=c.action;
  if(a.kind==='ride'){
    const r=assigned(sim,c,a.kinds[0]);
    r.loadedMetres+=a.path.distance;accountMotion(sim,c,r,a.path.distance,true);
    r.pose={...a.target.pose,z:r.pose.z};
    c.pose={...a.target.pose};
  }
  if(a.kind==='lift'){
    c.pose={...a.target.pose};
    transfer(sim,c,a.target);
    if(a.target.kind==='yardSlot'){
      const slot=sim.yardSlots.find(s=>s.id===c.slotId);
      slot.reservedFor=null;slot.containerId=c.id;
    }
    log(sim,c,'drop',a.target.label+' 落稳');
  }
  for(const kind of a.kinds)motion(sim,assigned(sim,c,kind),'reserved');
  if(c.plan.actions.length){beginAction(sim,c);return;}
  const t=sim.tickets.get(c.id),key=c.stage.split('-')[1];
  const returning=t?t.claims.filter(x=>x.resourceId&&x.end===key).map(x=>sim.resourceMap.get(x.resourceId).kind):releases[c.direction][key]??[];
  if(!c.plan.serviceFinished){
    log(sim,c,'finish',STAGES[c.stage].label+'完成');
    c.plan.serviceFinished=true;
    const trips={};
    for(const kind of returning.filter(k=>k!=='BAY')){
      const r=assigned(sim,c,kind);
      const route=trip(r.pose,r.home,kind,sim.layout);
      if(route.duration)trips[kind]=route;
    }
    if(Object.keys(trips).length){
      const ordered=trips.YC && trips.AGV?[{AGV:trips.AGV},{YC:trips.YC}]:[trips];
      c.plan.actions.push(...ordered.map(group=>({kind:'egress',duration:Math.max(...Object.values(group).map(t=>t.duration)),kinds:Object.keys(group),trips:group})));
      log(sim,c,'egress','设备沿已预约路线返回停车位');
      beginAction(sim,c);return;
    }
  }
  for(const kind of returning){
    const r=assigned(sim,c,kind);
    returnBudget(sim,c,r);motion(sim,r,'idle');r.status='idle';r.containerId=null;r.completed++;
    delete c.binding[kind];
    log(sim,c,'return',r.id+' 归还调度',{resourceId:r.id});
  }
  if(t){
    const done=t.claims.filter(x=>x.end===key && x.state==='active');
    for(const claim of done)claim.state='released';
    if(done.length)log(sim,c,'gate-release','已退出 '+done.map(x=>zoneLabel(x.id)).join(' / '),{zones:done.map(x=>x.id),ticketSeq:t.seq});
    syncTicket(sim,c,t);sim.needsDispatch=true;
  }
  c.step++;c.action=null;c.plan=null;c.carrierIds=[];
  if(c.step===9||c.custody.kind==='yardSlot'){
    sim.permits.delete(c.id);sim.tickets.delete(c.id);sim.needsDispatch=true;log(sim,c,'clear','本段设备已退出，释放交通区');
  }
  if(c.step===9){
    c.completedAt=sim.time;c.stage='done';c.status='completed';
    log(sim,c,'complete','到达'+c.destination+'，全程完成');
  }else{
    c.stage=ROUTES[c.direction][c.step];
    if(c.custody.kind==='yardSlot')queue(sim,c);
    else {log(sim,c,'wait','按预约进入下一工序');if(t)c.permitSince=sim.time;else beginStage(sim,c);}
  }
}

function available(sim){
   const slots={export:[],import:[]};
  for(const s of sim.yardSlots)if(!s.reservedFor&&!s.containerId)slots[s.direction].push(s);
  return {slots};
}
function syncTicket(sim,c,t){
  const active=t.claims.filter(x=>x.state==='active');
  const zoneDetails={};
  for(const x of active.filter(x=>!x.resourceId)){
    let participants=[];
    if(x.id.startsWith('road:'))participants=[c.binding[x.id==='road:ET'?'ET':x.id==='road:SMV'?'SMV':'AGV']];
    else if(x.id.startsWith('sweep:'))participants=[x.id.split(':')[1]];
    else participants=(x.id==='berth:LAND'?['ET','SMV']:['BAY','AGV','SMV']).map(k=>c.binding[k]);
    zoneDetails[x.id]={reservedAt:x.since,resourceIds:participants.filter(Boolean)};
  }
  sim.permits.set(c.id,{zones:Object.keys(zoneDetails),spans:[],resourceIds:Object.values(c.binding),reservedAt:t.at,zoneDetails});
}
function enterGate(sim,c,t){
  const {needed,blockers}=gate(sim,t,c);
  if(blockers.length)return false;
  for(const item of needed){
    item.state='active';item.since=sim.time;
    if(item.resourceId){
      const r=sim.resourceMap.get(item.resourceId);
      if(r.status!=='idle')throw new Error('设备不在停车位 '+r.id);
      r.status='busy';r.containerId=c.id;c.binding[r.kind]=r.id;motion(sim,r,'reserved');
    }
  }
  if(c.permitSince!=null){c.permitWait=(c.permitWait??0)+sim.time-c.permitSince;c.permitSince=null;}
  syncTicket(sim,c,t);
  if(needed.length)log(sim,c,'gate-acquire','获准进入 '+needed.map(x=>zoneLabel(x.id)).join(' / '),{zones:needed.map(x=>x.id),ticketSeq:t.seq,bindings:{...c.binding}});
  beginStage(sim,c);return true;
}
function settleStaged(sim){
  do{
    sim.needsDispatch=false;
    for(const t of sim.tickets.values()){
      const c=t.cargo;
      if(!c.action&&c.blockedAt===null)enterGate(sim,c,t);
    }
    const order=orderedWaiting(sim);

    const {slots}=available(sim);
    const possible=new Map(),closed=new Set(),energyRequests=[];
    // At most one initial segment can start in each first vehicle corridor.
    for(const c of order){
      const domain=firstRoad(sim,c);
      if(closed.has(domain)||c.step===0&&!slots[c.direction].length)continue;
      if(unavailableRoad(sim,c)){closed.add(domain);continue;}
      const {ticket,chargeRequests}=propose(sim,c,slots);
      if(!ticket){if(chargeRequests?.length)energyRequests.push(chargeRequests);continue;}
      const score=dispatchScore(sim,c,ticket);
      ticket.decision={policy:sim.config.dispatchPolicy,score,readyAt:c.readyAt,due:c.due};
      const old=possible.get(domain);
      if(!old || score<old.ticket.decision.score)possible.set(domain,{c,ticket});
      if(sim.config.dispatchPolicy!=='empty-distance')closed.add(domain);
    }
    // Commit one proposal before recalculating; provisional proposals do not
    // own slots, hardware or queue positions.
    let next=null;
    for(const p of possible.values())if(!next || p.ticket.decision.score<next.ticket.decision.score)next=p;
    if(!next){serveCharging(sim,energyRequests);continue;}
    const {c,ticket:t}=next;
    cancelEnergyQueue(sim,t.bindings.AGV);sim.nextTicket++;t.at=sim.time;t.cargo=c;sim.tickets.set(c.id,t);
    if(t.first){c.slotId=t.slotId;sim.slotMap.get(t.slotId).reservedFor=c.id;}
    c.segmentRail=t.rail;if(t.bindings.BAY)c.bayId=t.bindings.BAY;
    c.wait+=sim.time-c.readyAt;c.status='active';
    log(sim,c,'ticket','登记有序票 '+t.seq+' · '+t.decision.policy,{ticketSeq:t.seq,decision:{...t.decision},plannedBindings:{...t.bindings}});
    if(!enterGate(sim,c,t))throw new Error('准入后首动作门槛改变');
    sim.needsDispatch=true;
  }while(sim.needsDispatch);
}
function settle(sim){
  sim.explanationCache=null;
  chargeBoundaries(sim);
  for(const c of sim.containers){
    if(c.status==='scheduled' && c.release===sim.time){log(sim,c,'release','任务从'+c.origin+'释放');queue(sim,c);}
    if(c.status!=='active'||c.blockedAt!==null||!c.action)continue;
    const a=c.action;
    if(motionPhase(a)){
      for(const [kind,path] of Object.entries(a.trips)){
        if(path.arrived || (clockTime(a.begin+path.duration)>sim.time && a.end>sim.time))continue;
        path.arrived=true;
        const r=assigned(sim,c,kind);
        r.emptyMetres+=path.distance;accountMotion(sim,c,r,path.distance,false);r.pose={...path.points.at(-1)};motion(sim,r,'reserved');
        log(sim,c,a.kind==='egress'?'park':'arrive',r.id+(a.kind==='egress'?' 已停稳':' 已对位'),{resourceId:r.id});
      }
    }
    if(a.end<=sim.time)finishAction(sim,c);
  }
  if(!sim.needsDispatch)return;
  if(sim.config.trafficPolicy==='staged'){settleStaged(sim);return;}
  sim.needsDispatch=false;
  let storageFreed;
  do {
    storageFreed=false;
    const {slots}=available(sim);
    const taken=new Set([...sim.permits.values()].flatMap(p=>p.zones));
    if(taken.has('west')&&taken.has('east'))break;
    for(const c of orderedWaiting(sim)){
      if(taken.has(segment(c).rail?'west':'east'))continue;
      const lease=probe(sim,c,slots);
      if(lease.reasons)continue;
      const {first,slot,rail,resources,zones,spans}=lease;
      if(first){slot.reservedFor=c.id;c.slotId=slot.id;}
      c.segmentRail=rail;
      for(const [kind,r] of Object.entries(resources)){
        r.status='busy';r.containerId=c.id;
        motion(sim,r,'reserved');c.binding[kind]=r.id;
      }
      for(const z of zones)taken.add(z);
      sim.permits.set(c.id,{zones,spans,resourceIds:Object.values(c.binding),reservedAt:sim.time});
      log(sim,c,'permit','预约交通区：'+zones.map(z=>activityZones[z]).join(' / '),{zoneIds:[...zones]});
      if(c.binding.BAY)c.bayId=c.binding.BAY;
      c.wait+=sim.time-c.readyAt;c.status='active';
      log(sim,c,'reserve','整段预约 '+Object.values(c.binding).join(' / '),{bindings:{...c.binding}});
      beginStage(sim,c);
      if(!first && c.custody.kind==='spreader') storageFreed=true;
      if(taken.has('west')&&taken.has('east'))break;
    }
  } while(storageFreed);
}
export function advance(sim,seconds){
  if(!Number.isFinite(seconds)||seconds<=0)return sim;
  const target=clockTime(sim.time+seconds);
  while(sim.time<target){
    let next=nextCharge(sim);
    for(const c of sim.containers){
      if(c.status==='scheduled')next=Math.min(next,c.release);
      if(c.status!=='active'||c.blockedAt!==null||!c.action)continue;
      next=Math.min(next,c.action.end);
      if(motionPhase(c.action))for(const path of Object.values(c.action.trips)){
        if(!path.arrived)next=Math.min(next,clockTime(c.action.begin+path.duration));
      }
    }
    if(next>target){sim.time=target;break;}
    sim.time=next;settle(sim);
  }
  return sim;
}
function explanations(sim){
  if(sim.explanationCache)return sim.explanationCache;
  const {slots}=available(sim),result=new Map(),groups=new Map();
  for(const c of orderedWaiting(sim)){
    if(!groups.has(c.stage))groups.set(c.stage,[]);
    groups.get(c.stage).push(c);
  }
  for(const cs of groups.values())cs.forEach((c,i)=>{
    const waitingFor=(sim.config.trafficPolicy==='staged'?propose(sim,c,slots):probe(sim,c,slots)).reasons??[];
    const wait=waitingFor.find(r=>r.kind==='TRAFFIC');
    result.set(c.id,{queuePosition:i+1,queueLength:cs.length,waitingFor,
      pathWait:wait?{kind:'zone',ids:wait.resourceIds,owners:wait.containerIds}:null});
  });
  if(energyEnabled(sim))sim.explanationCache=result;
  return result;
}
function eventCopy(e){
  const copy={...e};
  for(const key of ['bindings','plannedBindings','decision','custody'])if(e[key])copy[key]={...e[key]};
  for(const key of ['participants','zoneIds','zones','heldZoneIds','partnerIds'])if(e[key])copy[key]=[...e[key]];
  return copy;
}
function cargoView(sim,c,queues){
  const {action:a,plan,binding,step,durations,readyAt,blockedAt,slotId,...plain}=c;
  const t=a?Math.max(0,Math.min(1,(clock(sim,c)-a.begin)/a.duration)):0;
  const position=a?.kind==='ride'?along(a.path,t):a?.kind==='lift'?liftPose(a,t):{...c.pose};
  const segmentEnd=c.direction==='export'?7:3;
  let targetSlot=c.step<segmentEnd?slotId:c.direction==='export'?c.shipSlot.id:c.railSlot.id;
  if(!targetSlot)targetSlot=null;
  const labels={egress:'退出作业位',prepare:'空驶对位',ride:'载箱运输',lift:t<0.25?'起吊':t<0.75?'吊具移位':'下放'};
  const participants=[...c.carrierIds],ticket=sim.tickets.get(c.id);
  const view=ticket?ticketView(sim,ticket,c):null;
  const sourceWait=c.wait+(c.status==='waiting'?sim.time-readyAt:0);
  const permitWait=(c.permitWait??0)+(c.permitSince!=null?sim.time-c.permitSince:0);
  const pathWait=view?.blockers.length?{kind:'zone',ids:view.awaitedZones.map(zoneLabel),owners:view.blockers.map(b=>b.containerId).filter(Boolean)}:null;
  return {...plain,railSlot:{...c.railSlot,pose:{...c.railSlot.pose}},shipSlot:{...c.shipSlot,pose:{...c.shipSlot.pose}},
    x:position.x,y:position.y,z:position.z,pose:position,custody:{...c.custody},carrierIds:participants,
    participants,pathWait,ticket:view,sourceWait,permitWait,permitIds:[...(sim.permits.get(c.id)?.zones??[])],reservedIds:Object.values(binding).filter(id=>!participants.includes(id)),targetSlot,
    actionKind:a?.kind??null,action:labels[a?.kind]??(c.status==='completed'?'完成':'等待放行'),
    history:c.history.map(eventCopy),phase:a?(a.kind==='prepare'?'preparing':a.kind==='egress'?'egress':'service'):(ticket?'awaiting-permit':c.status),
    blocked:blockedAt!==null,progress:c.status==='completed'?1:a?.kind==='prepare'?0:a?.kind==='egress'?1:t,
    wait:sourceWait+permitWait,totalElapsed:Math.max(0,(c.completedAt??sim.time)-c.release),
    completedStages:step,stageLabel:c.status==='completed'?'已完成':STAGES[c.stage].label,
    journey:ROUTES[c.direction].map((id,i)=>({id,label:STAGES[id].label,state:i<step?'completed':i===step?c.status:'pending'})),
    ...(queues.has(c.id)?(energyEnabled(sim)?structuredClone(queues.get(c.id)):queues.get(c.id)):{waitingFor:[],queuePosition:null,queueLength:0}),...(pathWait?{pathWait}:{} )};
}
function resourceView(sim,r,c,box){
  const {frozen,since,...plain}=r;
  const a=c?.action;
  let p={...r.pose},spreaderPose=null;
  if(a && motionPhase(a) && a.trips[r.kind] && c.binding[r.kind]===r.id){
    const path=a.trips[r.kind];
    p=along(path,Math.min(1,(clock(sim,c)-a.begin)/path.duration));
  }
  if(a?.kind==='ride' && box.custody.id===r.id)p={...box.pose,z:r.pose.z};
  if(a?.kind==='lift' && box.custody.id===r.id)spreaderPose={...box.pose,z:box.pose.z+boxHeight(box.type)};
  const path=a&&motionPhase(a)?a.trips[r.kind]:a?.kind==='ride'&&box.custody.id===r.id?a.path:null;
  let route=null;
  if(path){
    const fraction=Math.max(0,Math.min(1,(clock(sim,c)-a.begin)/(a.kind==='ride'?a.duration:path.duration)));
    const when=path.seconds*fraction,phase=path.phases.find(f=>f.until>when);
    let remainingM=0;
    for(const f of path.phases)if(f.edgeId && f.until>when){
      remainingM+=Math.hypot(f.b.x-f.a.x,f.b.y-f.a.y)*Math.min(1,(f.until-when)/f.duration);
    }
    route={edgeIds:[...path.edgeIds],currentEdge:phase?.edgeId??null,remainingM,points:path.points.map(p=>({...p}))};
  }
  const futureTickets=[];
  for(const t of sim.tickets.values())if(t.claims.some(x=>x.resourceId===r.id && x.state==='future'))futureTickets.push({seq:t.seq,containerId:t.containerId});
  const view={...plain,futureTickets,home:{...r.home},route,pose:p,x:p.x,y:p.y,z:p.z,spreaderPose,blocked:frozen};
  if(route && (a.kind==='ride'||!path.arrived)){
    const field=a.kind==='ride'?'loadedMetres':'emptyMetres';
    view[field]+=Math.max(0,path.distance-route.remainingM);
  }
  if(energyEnabled(sim)&&r.kind==='AGV'){view.energy=batteryView(sim,r,view);view.soc=100*view.energy.storedKWh/view.energy.capacityKWh;}
  const key=ledgerKey(r);
  if(key)view[key]+=sim.time-since;
  return view;
}
export function snapshot(sim){
  const time=sim.time,queues=explanations(sim);
  const containers=sim.containers.map(c=>cargoView(sim,c,queues));
  const jobs=new Map(sim.containers.map((c,i)=>[c.id,[c,containers[i]]]));
  const resources=sim.resources.map(r=>resourceView(sim,r,...(jobs.get(r.containerId)??[])));
  const metrics={total:containers.length,released:0,completed:0,active:0,waiting:0,scheduled:0,
    teuCompleted:0,avgWait:0,throughput:0,utilization:0,overdue:0,lateCompleted:0,onTimeCompleted:0,byKind:{}};
  let wait=0;
  for (const c of containers) {
    metrics[c.status]++;
    if (c.status==='completed') {
      metrics.teuCompleted+=c.teu;
      if (c.completedAt>c.due) metrics.lateCompleted++;
      else metrics.onTimeCompleted++;
    } else if (c.status!=='scheduled' && time>c.due) metrics.overdue++;
    if (c.status!=='scheduled') metrics.released++;
    wait+=c.wait;
  }
  for (const [kind] of fleet) {
    const pool=resources.filter(r=>r.kind===kind);
    const group={total:pool.length,idle:0,busy:0,fault:0,utilization:0,reservedTime:0,busyTime:0};
    for (const r of pool) {
      group[r.status]++;group.busyTime+=r.busyTime;group.reservedTime+=r.reservedTime;
      if (time) group.utilization+=r.busyTime/(pool.length*time);
    }
    metrics.byKind[kind]=group;
  }
  metrics.avgWait=metrics.released?wait/metrics.released:0;
  metrics.throughput=time?metrics.teuCompleted*3600/time:0;
  metrics.utilization=time&&resources.length?resources.reduce((n,r)=>n+r.busyTime,0)/(time*resources.length):0;
  const zones=[...sim.permits].flatMap(([ownerJob,p])=>[
    ...p.zones.map(id=>({id,label:activityZones[id]??zoneLabel(id)})),...p.spans.map(s=>({id:s.kind+'-'+ownerJob,label:s.kind+' 走行区',...s})),
  ].map(zone=>({...zone,ownerJob,resourceIds:[...(p.zoneDetails?.[zone.id]?.resourceIds??p.resourceIds)],reservedAt:p.zoneDetails?.[zone.id]?.reservedAt??p.reservedAt})));
  const tickets=containers.filter(c=>c.ticket).map(c=>c.ticket).sort((a,b)=>a.seq-b.seq);
  const zoneLabels=Object.fromEntries(tickets.flatMap(t=>[...t.activeZones,...t.pendingZones,...t.awaitedZones]).map(id=>[id,zoneLabel(id)]));
  return {time,energy:energyView(sim,resources),modelVersion:sim.modelVersion,layoutVersion:3,layoutExtent:containers.length,traffic:{zones,tickets,zoneLabels,waitingCount:containers.filter(c=>c.pathWait).length},config:{...sim.config},containers,resources,events:sim.events.map(eventCopy),yardSlots:sim.yardSlots.map(s=>({...s,pose:{...s.pose}})),metrics};
}

export function injectTask(sim,input={}) {
  const task=taskOptions(input);
  const number=sim.containers.length+1;
  if (number>2000) throw new RangeError('单场景最多支持 2000 箱');
  const {direction,type,priority,dueIn}=task;
  const random=seeded((sim.config.seed+Math.imul(number,2654435761))>>>0);
  const cargo=makeCargo(number,direction,type,sim.time,sim.time+dueIn,priority,random);
  sim.containers.push(cargo);
  sim.layout=buildLayout(sim.config,sim.containers.length);
  sim.commands.push({time:sim.time,action:'inject',task});
  settle(sim);
  return cargo.id;
}

export function setResourceFault(sim,id,failed=true) {
  const r=sim.resources.find(r=>r.id===id);
  if (!r) throw new RangeError('未找到设备 '+id);
  if (typeof failed!=='boolean') throw new TypeError('故障标志无效');
  if ((r.status==='fault')===failed) return false;
  const c=sim.containers.find(c=>c.id===r.containerId);
  r.status=failed?'fault':c?'busy':'idle';
  if (c) {
    const team=sim.resources.filter(member=>member.containerId===c.id);
    if (failed && c.blockedAt===null) {
      c.blockedAt=sim.time;
      for (const member of team) motion(sim,member,member.motion,true);
    }
    if (!failed && team.every(member=>member.status!=='fault')) {
      const delay=sim.time-c.blockedAt;
      if(c.action){c.action.begin=clockTime(c.action.begin+delay);c.action.end=clockTime(c.action.begin+c.action.duration);}
      c.blockedAt=null;
      for (const member of team) motion(sim,member,member.motion,false);
    }
  }
  const type=failed?'fault':'repair';
  const event={id:sim.events.length+1,time:sim.time,type,containerId:c?.id??null,
    resourceId:id,stage:c?.stage??null,message:id+(failed?' 故障停机':' 已修复')};
  if(sim.config.trafficPolicy==='staged'&&failed && c){
    event.partnerIds=Object.values(c.binding).filter(id=>id!==r.id);
    event.heldZoneIds=[...(sim.permits.get(c.id)?.zones??[])];
  }
  sim.events.push(event);
  if(c) c.history.push(event);
  sim.needsDispatch=true;
  sim.commands.push({time:sim.time,action:'fault',id,failed});
  settle(sim);
  return true;
}

export function exportState(sim) {
  return {format:'port-sim',version:sim.modelVersion,config:{...sim.config},time:sim.time,
    commands:sim.commands.map(command=>command.task?{...command,task:{...command.task}}:{...command})};
}

export function restoreState(data) {
  const doc=readCheckpoint(data);
  const sim=createSimulation(doc.config);
  for (const command of doc.commands) {
    advance(sim,command.time-sim.time);
    if (command.action==='inject') injectTask(sim,command.task);
    else if (!setResourceFault(sim,command.id,command.failed)) throw new TypeError('重复的设备状态变更');
  }
  advance(sim,doc.time-sim.time);
  return sim;
}
