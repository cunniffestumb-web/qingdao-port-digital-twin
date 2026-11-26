import {energyDefaults,energySettings} from './energy-config.mjs';
// A checkpoint stores initial conditions and timestamped user interventions.
// Replaying a validated command log also rebuilds all derived indexes and histories.
const fields={seed:4294967295,count:2000,yardCapacity:64,et:64,smv:64,agv:64,rmg:64,bay:64,yc:64,qc:64};
const hasOnly=(object,keys)=>object && typeof object==='object' && !Array.isArray(object) &&
  Object.keys(object).every(key=>keys.includes(key));
function check(ok,message) {
  if (!ok) throw new TypeError(message);
}

export function taskOptions(input={}) {
  check(hasOnly(input,['direction','type','priority','dueIn']),'任务字段无效');
  const {direction='export',type='40HQ',priority='普通',dueIn=7200}=input;
  check(['export','import'].includes(direction),'任务方向无效');
  check(['20GP','40HQ','冷藏箱'].includes(type),'箱型无效');
  check(['普通','加急'].includes(priority),'优先级无效');
  check(Number.isFinite(dueIn) && dueIn>=0 && dueIn<=1e12,'截止时长无效');
  return {direction,type,priority,dueIn};
}

export function readCheckpoint(input) {
  const doc=typeof input==='string'?JSON.parse(input):input;
  if(doc?.format==='port-sim' && [1,2].includes(doc.version)) throw new TypeError('旧版调度模型不兼容，请用原版本打开实验。');
  check(hasOnly(doc,['format','version','config','commands','time']) && doc.format==='port-sim' && [3,4,5].includes(doc.version),'场景格式或版本无效');
  const keys=Object.keys(fields);
  if(doc.version>=4)keys.push('trafficPolicy','dispatchPolicy');
  if(doc.version===5)keys.push('energyMode',...Object.keys(energyDefaults));
  check(hasOnly(doc.config,keys),'场景参数无效');
  if(doc.version===5){check(Object.keys(energyDefaults).every(k=>doc.config[k]!==undefined),'缺少能源参数');energySettings(doc.config);}
  if(doc.version>=4)check(['staged','segment'].includes(doc.config.trafficPolicy)&&['fifo','edd','empty-distance'].includes(doc.config.dispatchPolicy)&&
    (doc.config.trafficPolicy==='staged'||doc.config.dispatchPolicy==='fifo'),'调度策略无效');
  for (const [key,max] of Object.entries(fields)) {
    const n=doc.config[key];
    check(Number.isInteger(n) && n>=0 && n<=max,'场景参数无效 '+key);
  }
  check(Number.isFinite(doc.time) && doc.time>=0 && doc.time<=1e12,'场景时间无效');
  check(Array.isArray(doc.commands),'操作记录无效');
  let previous=0;
  for (const command of doc.commands) {
    check(command && Number.isFinite(command.time) && command.time>=previous && command.time<=doc.time,'操作时间无效');
    previous=command.time;
    if (command.action==='inject') {
      check(hasOnly(command,['action','time','task']) && command.task,'任务记录无效');
      taskOptions(command.task);
    } else {
      check(command.action==='fault' && hasOnly(command,['action','time','id','failed']) &&
        typeof command.id==='string' && typeof command.failed==='boolean','设备记录无效');
    }
  }
  return doc;
}
