export function runJiExperiment(config,{signal,onProgress}={}){
 return new Promise((resolve,reject)=>{
  let worker,finished=false;
  function close(){finished=true;signal?.removeEventListener('abort',abort);worker?.terminate();}
  function fail(error){if(!finished){close();reject(error);}}
  function abort(){fail(new DOMException('已取消论文求解','AbortError'));}
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  try{
   worker=new Worker(new URL('./ji-worker.mjs',import.meta.url),{type:'module'});
   worker.onerror=e=>fail(new Error(e.message||'求解线程异常'));
   worker.onmessageerror=()=>fail(new Error('无法读取求解线程消息'));
   worker.onmessage=({data})=>{
    if(finished)return;
    try{
     if(data.type==='progress'){onProgress?.(data.progress);return;}
     if(data.type!=='result')throw Error(data.message||'求解失败');
     close();resolve(data.result);
    }catch(e){fail(e);}
   };
   worker.postMessage({config});
  }catch(e){fail(e);}
 });
}
