import {solveJi} from './ji-model.mjs';
self.onmessage=async({data})=>{
 try{
  const result=await solveJi(data.config,{onProgress:progress=>self.postMessage({type:'progress',progress})});
  self.postMessage({type:'result',result});
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
