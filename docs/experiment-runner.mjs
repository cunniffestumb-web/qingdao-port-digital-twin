import {combineExperimentResults} from './experiments.mjs';

export function runPairedExperiment(plan,{onProgress,signal}={}){
 return new Promise((resolve,reject)=>{
  const workers=[],results={};
  let finished=false;
  function close(){
   finished=true;
   signal?.removeEventListener('abort',abort);
   for(const worker of workers)worker.terminate();
  }
  function fail(error){
   if(finished)return;
   close();reject(error);
  }
  function abort(){fail(new DOMException('已取消配对实验','AbortError'));}
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  try{
   for(const arm of ['baseline','candidate']){
    const worker=new Worker(new URL('./experiment-worker.mjs',import.meta.url),{type:'module'});
    workers.push(worker);
    worker.onerror=e=>fail(new Error(e.message||'实验计算线程异常'));
    worker.onmessageerror=()=>fail(new Error('无法读取实验线程消息'));
    worker.onmessage=({data})=>{
     if(finished)return;
     try{
      if(data.type==='progress'){onProgress?.(data.progress);return;}
      if(data.type!=='result')throw new Error(data.message||'实验线程返回未知消息');
      results[arm]=data.result;
      if(results.baseline && results.candidate){
       const report=combineExperimentResults(plan,results.baseline,results.candidate);
       close();resolve(report);
      }
     }catch(error){fail(error);}
    };
    worker.postMessage({arm,plan});
   }
  }catch(error){fail(error);}
 });
}
