// Reports are derived from simulation events in their committed order. The
// event ID disambiguates interventions that occur at the same simulation time.
const capacityFields={ET:'et',AGV:'agv',SMV:'smv',RMG:'rmg',QC:'qc',YC:'yc',BAY:'bay',YARD:'yardCapacity'};

function operationalNotices(s){
 const groups=new Map();
 function notice(kind,resourceKind){
  const id=kind+':'+resourceKind;
  if(!groups.has(id))groups.set(id,{id,kind,resourceKind,count:0,containerIds:[]});
  return groups.get(id);
 }
 for(const [kind,field] of Object.entries(capacityFields)){
  if(s.config[field]===0)notice('zero-capacity',kind);
 }
 for(const c of s.containers){
  if(c.status!=='waiting'&&c.phase!=='awaiting-permit')continue;
  const kinds=new Set(c.waitingFor.map(reason=>reason.kind));
  if(!kinds.size)kinds.add('DISPATCH');
  for(const kind of kinds){
   const group=notice(s.config[capacityFields[kind]]===0?'zero-capacity':'waiting',kind);
   group.containerIds.push(c.id);group.count++;
  }
 }
 return [...groups.values()];
}

export function deriveIncidentReport(s){
 const episodes=[],leases=new Map(),open=new Map(),pauses=new Map();
 for(const e of s.events){
  if(e.time>s.time)continue;
  const job=e.containerId;
  if(e.type==='permit'){
   leases.set(job,{partners:new Set(),zones:[...e.zoneIds],refs:[e.id]});
  }else if(e.type==='reserve' || e.type==='return'){
   const lease=leases.get(job);
   if(!lease)continue;
   if(e.type==='reserve')lease.partners=new Set(Object.values(e.bindings));
   else lease.partners.delete(e.resourceId);
   lease.refs.push(e.id);
  }else if(e.type==='clear'){
   leases.delete(job);
  }else if(e.type==='fault'){
   const lease=leases.get(job);
   const episode={id:'fault-'+e.id,faultEventId:e.id,repairEventId:null,resourceId:e.resourceId,
    containerId:job,stage:e.stage,occurredAt:e.time,repairedAt:null,status:'open',
    partnerIds:e.partnerIds?[...e.partnerIds]:[...(lease?.partners??[])].filter(id=>id!==e.resourceId),heldZoneIds:[...(e.heldZoneIds??lease?.zones??[])],
    workResumedAt:null,currentBlockerIds:[],eventRefs:[...(lease?.refs??[]),e.id]};
   episodes.push(episode);open.set(e.resourceId,episode);
   if(job){
    if(!pauses.has(job))pauses.set(job,{episodes:[],failed:new Map()});
    const group=pauses.get(job);
    episode.eventRefs.push(...group.failed.values());
    group.episodes.push(episode);group.failed.set(e.resourceId,e.id);
   }
  }else if(e.type==='repair'){
   const episode=open.get(e.resourceId);
   if(!episode)continue;
   open.delete(e.resourceId);
   episode.status='resolved';episode.repairedAt=e.time;episode.repairEventId=e.id;episode.eventRefs.push(e.id);
   const group=pauses.get(episode.containerId);
   if(!group)continue;
   group.failed.delete(e.resourceId);
   episode.eventRefs.push(...group.failed.values());
   if(!group.failed.size){
    for(const member of group.episodes){
     member.workResumedAt=e.time;member.eventRefs.push(e.id);
    }
    pauses.delete(episode.containerId);
   }
  }
 }
 for(const group of pauses.values()){
  for(const episode of group.episodes){
   episode.currentBlockerIds=[...group.failed.keys()];
   episode.eventRefs.push(...group.failed.values());
  }
 }
 for(const episode of episodes){
  episode.duration=Number(((episode.repairedAt??s.time)-episode.occurredAt).toFixed(9));
  episode.eventRefs=[...new Set(episode.eventRefs)].sort((a,b)=>a-b);
 }
 const openCount=open.size;
 return {asOf:s.time,source:'simulation-event-log',modelVersion:s.modelVersion||3,layoutVersion:s.layoutVersion,
  episodes:episodes.reverse(),notices:operationalNotices(s),openCount,resolvedCount:episodes.length-openCount};
}

function holder(record){
 return record?{kind:record.kind,id:record.id,label:record.label}:null;
}
export function deriveCustodyAudit(s,containerId){
 const cargo=s.containers.find(c=>c.id===containerId);
 if(!cargo)return null;
 const initial=holder(cargo.direction==='export'?cargo.railSlot:cargo.shipSlot);
 let current=initial;
 const transfers=[];
 for(const e of cargo.history){
  if(e.type!=='custody'||e.time>s.time)continue;
  const next=holder(e.custody);
  transfers.push({eventId:e.id,time:e.time,stage:e.stage,from:holder(current),to:holder(next)});
  current=next;
 }
 return {asOf:s.time,containerId,source:'simulation-event-log',initialSource:'scenario-slot',
  initialHolder:initial,currentHolder:holder(current),transfers};
}
