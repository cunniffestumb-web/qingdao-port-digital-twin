/** Clip a recording after at most commandLimit user interventions, then advance to time. */
export function checkpointAt(recording,time,commandLimit=recording.commands.length){
 if(!Number.isFinite(time)||time<0||time>recording.time)throw new RangeError('回看时刻必须位于已记录的时间范围内');
 if(!Number.isInteger(commandLimit)||commandLimit<0||commandLimit>recording.commands.length)
  throw new RangeError('操作边界必须是已记录的操作数量');
 const commands=recording.commands.slice(0,commandLimit).filter(command=>command.time<=time);
 return structuredClone({...recording,time,commands});
}

/** Map an intervention event in a complete snapshot event log to its inclusive command prefix. */
export function commandLimitForEvent(recording,events,eventId){
 if(!Number.isInteger(eventId)||eventId<1||!Array.isArray(events)||!Array.isArray(recording?.commands))return null;
 let commandIndex=0,expectedId=1;
 for(const e of events){
  // Missing earlier records can make repeated, same-time transitions ambiguous.
  if(e.id!==expectedId++)return null;
  if(e.type!=='fault' && e.type!=='repair'){
   if(e.id===eventId)return null;
   continue;
  }
  while(recording.commands[commandIndex]?.action==='inject')commandIndex++;
  const command=recording.commands[commandIndex++];
  if(command?.action!=='fault'||command.time!==e.time||command.id!==e.resourceId||command.failed!==(e.type==='fault'))return null;
  if(e.id===eventId)return commandIndex;
 }
 return null;
}

/** Coalesce seeks while a worker is running so dragging cannot queue many replays. */
export class ReplayController{
 constructor(recording,{onState,onError}){
  this.onState=onState;this.onError=onError;this.latestId=0;this.pending=null;this.busy=false;this.alive=true;
  this.worker=new Worker(new URL('./replay-worker.mjs',import.meta.url),{type:'module'});
  this.worker.onmessage=({data})=>{
   if(!this.alive)return;this.busy=false;
   if(data.id===this.latestId){if(data.error)this.onError(data.error);else this.onState(data.snapshot);}
   this.drain();
  };
  this.worker.onerror=event=>{if(this.alive){this.onError(event.message||'历史回看未能加载');this.dispose();}};
  this.worker.postMessage({type:'load',recording});
 }
 seek(time,commandLimit){if(!this.alive)return;this.pending={type:'seek',time,commandLimit,id:++this.latestId};this.drain();}
 drain(){if(!this.alive||this.busy||!this.pending)return;this.busy=true;const request=this.pending;this.pending=null;this.worker.postMessage(request);}
 dispose(){this.alive=false;this.pending=null;this.worker.terminate();}
}
