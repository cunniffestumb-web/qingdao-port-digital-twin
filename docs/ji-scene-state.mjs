// Space is illustrative. The half-open occupancy and service intervals below
// are taken directly from the selected solver witness, in minutes.
const SMV_Y=1.28,DECK=.12,BOX_H=.2896,HUNG=SMV_Y-.20-BOX_H;
const centres=[0,-1.90,1.90,-3.80];
const kindFields={SMV:['smv','smvArrival','smvDeparture'],AGV:['agv','agvArrival','agvDeparture']};
export const jiVehicleEnvelope=Object.freeze({AGV:{length:1.50,width:.32,height:.17},SMV:{length:1.18,width:.24,height:.22}});
const smooth=f=>f*f*(3-2*f);
const order=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true});

export function buildJiSceneSchedule(config,sourceRows){
 const lanes=[],rows=sourceRows.map(r=>({...r})),count=config.importLanes+config.exportLanes;
 for(const [zone,n] of [['L1',config.importLanes],['L2',config.exportLanes]])for(let i=1;i<=n;i++){
  lanes.push({id:zone+'-'+i,direction:zone==='L1'?'import':'export',z:(lanes.length-(count-1)/2)*1.72,slots:0});
 }
 const laneById=new Map(lanes.map(l=>[l.id,l]));
 for(const lane of lanes){
  const ends=[];
  for(const row of rows.filter(r=>r.lane===lane.id).sort((a,b)=>a.agvArrival-b.agvArrival||a.start-b.start||order(a.id,b.id))){
   let i=ends.findIndex(d=>d<=row.agvArrival);
   if(i<0)i=ends.length;
   ends[i]=row.agvDeparture;row.queueIndex=i;row.x=centres[i];row.z=lane.z;
  }
  lane.slots=ends.length;
 }
 const fleets=[];
 for(const [kind,[owner,a,d]] of Object.entries(kindFields)){
  const n=kind==='SMV'?config.smvs:config.agvs;
  for(let i=1;i<=n;i++){
   const id=kind+'-'+i,jobs=rows.filter(r=>r[owner]===id).sort((x,y)=>x[a]-y[a]||order(x.id,y.id));
   fleets.push({id,kind,index:i,jobs,a,d});
  }
 }
 return {config,rows,lanes,laneById,fleets,extent:Math.max(0,...rows.flatMap(r=>[r.smvDeparture,r.agvDeparture]))};
}
function resourceAt(schedule,fleet,t){
 const {id,kind,index,jobs,a,d}=fleet,y=kind==='SMV'?SMV_Y:0;
 const now=jobs.find(r=>r[a]<=t&&t<r[d]);
 const result={id,kind,phase:null,taskId:null,lane:null,queueIndex:null,position:null,heading:0,arrival:null,departure:null,start:null,end:null,envelope:jiVehicleEnvelope[kind]};
 if(now){
  const phase=t<now.start?'waiting':t<now.end?'transfer':'post-service';
  return {...result,phase,taskId:now.id,direction:now.direction,lane:now.lane,queueIndex:now.queueIndex,position:[now.x,y,now.z],
   arrival:now[a],departure:now[d],start:now.start,end:now.end};
 }
 const previous=jobs.filter(r=>r[d]<=t).at(-1),next=jobs.find(r=>r[a]>t);
 // Each resource has its own external schematic turnaround track. The path
 // visualizes the elapsed transfer interval; no metric route or speed is inferred.
 const stripZ=schedule.lanes[0].z-1.5-(index-1)*.58;
 const from=previous?.direction==='import'?-1:1,to=-from;
 let x,phase;
 if(previous&&next){
  const f=(t-previous[d])/(next[a]-previous[d]);
  x=2.4*(from+(to-from)*f);phase='transit';
 }else if(next){
  x=next.direction==='export'?2.4:-2.4;phase='before-arrival';
 }else{
  x=previous?.direction==='import'?2.4:-2.4;phase='departed';
 }
 return {...result,phase,taskId:next?.id??null,previousTask:previous?.id??null,nextTask:next?.id??null,
  fromLane:previous?.lane??null,toLane:next?.lane??null,position:[x,y,stripZ],heading:0,
  arrival:next?.[a]??null,departure:previous?.[d]??null};
}
export function sampleJiScene(schedule,time,selectedId=null){
 const t=Math.max(0,Math.min(schedule.extent,Number(time)||0));
 const resources=schedule.fleets.map(f=>resourceAt(schedule,f,t));
 const boxes=schedule.rows.map(r=>{
  const outbound=r.direction==='export',supplier=outbound?r.smv:r.agv,receiver=outbound?r.agv:r.smv;
  const arrival=outbound?r.smvArrival:r.agvArrival,departure=outbound?r.agvDeparture:r.smvDeparture;
  let phase='outside',carrier=null,height=null;
  if(t>=arrival&&t<r.start){phase='waiting';carrier=supplier;height=outbound?HUNG:DECK;}
  else if(t>=r.start&&t<r.end){
   phase='transfer';carrier=r.smv;const u=smooth((t-r.start)/(r.end-r.start));
   height=outbound?HUNG+(DECK-HUNG)*u:DECK+(HUNG-DECK)*u;
  }else if(t>=r.end&&t<departure){phase='received';carrier=receiver;height=outbound?DECK:HUNG;}
  return {id:r.id,direction:r.direction,lane:r.lane,queueIndex:r.queueIndex,visible:height!==null,phase,carrier,deliveryComplete:t>=r.end,
   position:height===null?null:[r.x,height,r.z],start:r.start,end:r.end,smv:r.smv,agv:r.agv};
 });
 return {time:t,selectedId,lanes:schedule.lanes,resources,boxes,heights:{deck:DECK,hung:HUNG,beam:SMV_Y,container:BOX_H}};
}
