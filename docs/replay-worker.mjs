import {restoreState,snapshot} from './engine.mjs';
import {checkpointAt} from './replay.mjs';
let recording=null;
self.onmessage=({data})=>{
 if(data.type==='load'){recording=data.recording;return;}
 if(data.type!=='seek')return;
 try{if(!recording)throw Error('缺少实验记录');const sim=restoreState(checkpointAt(recording,data.time,data.commandLimit));self.postMessage({id:data.id,snapshot:snapshot(sim)});}
 catch(error){self.postMessage({id:data.id,error:error.message});}
};
