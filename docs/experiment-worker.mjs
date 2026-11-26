import {runExperimentArm} from './experiments.mjs';

self.onmessage=({data})=>{
 try{
  const result=runExperimentArm(data.plan,data.arm,{onProgress:progress=>self.postMessage({type:'progress',progress})});
  self.postMessage({type:'result',result});
 }catch(error){
  self.postMessage({type:'error',message:error.message});
 }
};
