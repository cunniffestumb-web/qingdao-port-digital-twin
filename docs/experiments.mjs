import {energyDefaults,energySettings} from './energy-config.mjs';
import {createSimulation,advance,snapshot,injectTask,setResourceFault} from './engine.mjs';
import {ROUTES} from './domain.mjs';
import {readCheckpoint} from './scenarios.mjs';

const changes=['et','agv','smv','rmg','qc','yc','bay','yardCapacity','trafficPolicy','dispatchPolicy','energyMode',...Object.keys(energyDefaults)];
const assumptions=[
 '两组从仿真零时刻独立生成同一批任务，按相同时间与顺序执行录制中的插单和设备故障操作。',
 '观测期含末箱完成后的空闲时间。设备作业时间包含空驶、载运、装卸和退出，仅预约时间单独累计。',
 '排队等待含源箱位等待，分段派工还计入段内尚未获准的等待，分母为观测期内已释放任务数。',
 '工期从仿真零时刻计至末箱所在作业段退出结束。仅在两组同一非空任务集全部完成时比较工期。',
 '模型采用保守的通行区预约，单一堆区最多投入三台场桥。停车接触补能仅在显式启用的实验组生效，参数为合成；静止辅助能耗为零。未启用实际班列或船期窗口。',
 '结果来自同一随机种子的一次配对仿真。现场吞吐、统计显著性和最优配置需要独立验证。'
];

function frozen(object){
 if(object && typeof object==='object'){
  for(const value of Object.values(object))frozen(value);
  Object.freeze(object);
 }
 return object;
}
function defaultHorizon(doc){
 return Math.max(172800,doc.time,(doc.commands.at(-1)?.time??0)+172800);
}
export function defaultExperimentHorizon(recording){
 return defaultHorizon(readCheckpoint(recording));
}

function verifyCommands(doc,candidate){
 let count=doc.config.count;
 const failed=new Set();
 for(const c of doc.commands){
  if(c.action==='inject'){
   if(++count>2000)throw new RangeError('插单后的总任务数超过 2000 箱');
   continue;
  }
  const match=/^(ET|AGV|SMV|RMG|QC|YC|BAY)-(\d{2})$/.exec(c.id);
  const kind=match?.[1].toLowerCase(),number=Number(match?.[2]);
  if(!match || number<1 || number>doc.config[kind])throw new RangeError('源录制缺少故障操作所指设备 '+c.id);
  if(number>candidate[kind])throw new RangeError('候选配置移除了录制操作所指设备 '+c.id+'，无法执行同一故障脚本');
  if(failed.has(c.id)===c.failed)throw new RangeError('源录制含重复设备状态操作 '+c.id);
  if(c.failed)failed.add(c.id);else failed.delete(c.id);
 }
}

export function prepareExperiment(recording,candidatePatch={},horizon){
 const source=structuredClone(readCheckpoint(recording));
 if(!candidatePatch || typeof candidatePatch!=='object' || Array.isArray(candidatePatch))throw new TypeError('候选配置必须是设备与堆位参数对象');
 for(const [key,value] of Object.entries(candidatePatch)){
  if(!changes.includes(key))throw new TypeError('候选方案不可更改需求或未知参数 '+key);
  if(key==='energyMode'||Object.hasOwn(energyDefaults,key))continue;
  if(key==='trafficPolicy'&&['staged','segment'].includes(value) || key==='dispatchPolicy'&&['fifo','edd','empty-distance'].includes(value))continue;
  if(key==='trafficPolicy'||key==='dispatchPolicy')throw new RangeError('候选调度策略无效 '+key);
  if(!Number.isInteger(value)||value<0||value>64)throw new RangeError('候选参数须为 0 至 64 的整数 '+key);
 }
 const end=horizon===undefined?defaultHorizon(source):horizon;
 if(!Number.isFinite(end)||end<1||end>1e12)throw new RangeError('观测截止须为 1 至 10¹² 秒之间的有限值');
 if(end<(source.commands.at(-1)?.time??0))throw new RangeError('观测截止早于录制中的最后一次操作');
 const baselineConfig={...source.config},candidateConfig={...source.config,...candidatePatch};
 if(candidateConfig.energyMode!==undefined){
  candidateConfig.trafficPolicy??='staged';Object.assign(candidateConfig,energySettings(candidateConfig));
 }else if(Object.keys(candidatePatch).some(k=>Object.hasOwn(energyDefaults,k)))throw new RangeError('请明确选择能源模式');
 if(candidateConfig.trafficPolicy!==undefined||candidateConfig.dispatchPolicy!==undefined){
  candidateConfig.trafficPolicy??='staged';candidateConfig.dispatchPolicy??='fifo';
  if(candidateConfig.trafficPolicy==='segment'&&candidateConfig.dispatchPolicy!=='fifo')throw new RangeError('分段派工策略需要 staged 通行模式');
 }
 verifyCommands(source,candidateConfig);
 const effective=(cfg,key)=>cfg[key]??(key==='trafficPolicy'?'segment':key==='dispatchPolicy'?'fifo':key==='energyMode'?'off':energyDefaults[key]);
 const differences=changes.filter(key=>effective(baselineConfig,key)!==effective(candidateConfig,key) || (key==='trafficPolicy'&&source.version===3&&candidateConfig.trafficPolicy!==undefined) || (key==='energyMode'&&source.version<5&&candidateConfig.energyMode!==undefined))
  .map(key=>({key,baseline:effective(baselineConfig,key),candidate:effective(candidateConfig,key)}));
 return frozen({format:'port-sim-experiment-plan',version:1,modelVersion:source.version,
  recording:source,baselineConfig,candidateConfig,differences,horizon:end});
}

function stalledReasons(s){
 const reasons=new Set(),affected=new Set();
 for(const cargo of s.containers){
  if(cargo.blocked)affected.add(cargo.id);
  for(const reason of cargo.waitingFor){
   if(reason.kind==='ENERGY')reasons.add(reason.detail);
   if(!reason.total&&!['TRAFFIC','ENERGY'].includes(reason.kind))reasons.add(reason.kind+' 配置为 0 或无可达资源');
   if(reason.fault)for(const id of reason.resourceIds){
    if(s.resources.some(r=>r.id===id && r.status==='fault'))reasons.add(id+' 故障未修复');
   }
  }
 }
 for(const r of s.resources)if(r.status==='fault'&&affected.has(r.containerId))reasons.add(r.id+' 故障未修复');
 if(!reasons.size)reasons.add('尚有未完成任务，当前调度状态无可继续的动作或未来释放');
 return [...reasons];
}

export function runExperimentArm(plan,arm,{onProgress}={}){
 if(arm!=='baseline'&&arm!=='candidate')throw new TypeError('未知实验组 '+arm);
 const config=plan[arm+'Config'],sim=createSimulation(config),commands=plan.recording.commands;
 const horizon=plan.horizon,intervals=64;
 let applied=0;
 for(let i=0;i<=intervals;i++){
  const time=i===intervals?horizon:Number((horizon*i/intervals).toFixed(9));
  while(applied<commands.length && commands[applied].time<=time){
   const c=commands[applied++];
   advance(sim,c.time-sim.time);
   if(c.action==='inject')injectTask(sim,c.task);
   else if(!setResourceFault(sim,c.id,c.failed))throw new Error('未能执行录制设备操作 '+c.id);
  }
  advance(sim,time-sim.time);
  if(onProgress)onProgress({arm,time:sim.time,horizon,completed:sim.containers.filter(c=>c.status==='completed').length,
    total:sim.containers.length,appliedCommands:applied});
 }
 const demandManifest=sim.containers.map(c=>({id:c.id,direction:c.direction,type:c.type,teu:c.teu,priority:c.priority,
  release:c.release,due:c.due,durations:[...c.durations]}));
 const s=snapshot(sim),m=s.metrics;
 const status=m.completed===m.total?'completed':m.scheduled||s.energy.nextEnergyEventAt!==null||s.containers.some(c=>c.status==='active'&&!c.blocked&&c.actionKind)?'horizon':'stalled';
 const byKind={};
 for(const [kind,g] of Object.entries(m.byKind)){
  const capacity=g.total*horizon;
  byKind[kind]={total:g.total,busyTime:g.busyTime,reservedTime:g.reservedTime,
   utilization:capacity?g.busyTime/capacity:null,reservedRatio:capacity?g.reservedTime/capacity:null};
 }
 return {arm,energy:{enabled:s.energy.enabled,mode:s.energy.mode,nextEnergyEventAt:s.energy.nextEnergyEventAt,...s.energy.totals},modelVersion:s.modelVersion,config:{...config},status,horizon,total:m.total,released:m.released,completed:m.completed,teuCompleted:m.teuCompleted,
  waiting:m.waiting,active:m.active,scheduled:m.scheduled,overdue:m.overdue,lateCompleted:m.lateCompleted,
  makespan:status==='completed'&&m.total?Math.max(...s.containers.map(c=>c.completedAt)):null,avgWait:m.avgWait,
  avgSourceWait:m.released?s.containers.reduce((n,c)=>n+c.sourceWait,0)/m.released:0,
  avgPermitWait:m.released?s.containers.reduce((n,c)=>n+c.permitWait,0)/m.released:0,
  emptyMetres:s.resources.reduce((n,r)=>n+r.emptyMetres,0),loadedMetres:s.resources.reduce((n,r)=>n+r.loadedMetres,0),
  throughput:m.throughput,byKind,commandCount:applied,blockingReasons:status==='stalled'?stalledReasons(s):[],demandManifest};
}

export function combineExperimentResults(plan,left,right){
 for(const [arm,r] of [['baseline',left],['candidate',right]]){
  if(r.arm!==arm || r.horizon!==plan.horizon || r.commandCount!==plan.recording.commands.length ||
   Object.entries(plan[arm+'Config']).some(([key,value])=>r.config[key]!==value))
   throw new Error('实验组来源、配置、操作数量或截止时间不一致');
 }
 const expected=plan.recording.config.count+plan.recording.commands.filter(c=>c.action==='inject').length;
 if(left.demandManifest.length!==expected || JSON.stringify(left.demandManifest)!==JSON.stringify(right.demandManifest))
  throw new Error('配对需求清单或基准作业工时不一致，无法比较');
 const {demandManifest,...baseline}=left,{demandManifest:duplicate,...candidate}=right;
 const delta={};
 for(const key of ['completed','teuCompleted','released','waiting','active','scheduled','overdue','lateCompleted','avgWait','avgSourceWait','avgPermitWait','emptyMetres','loadedMetres','throughput'])
  delta[key]=candidate[key]-baseline[key];
 delta.makespan=baseline.makespan!==null && candidate.makespan!==null?candidate.makespan-baseline.makespan:null;
 return structuredClone({format:'port-sim-paired-experiment',version:1,modelVersion:plan.modelVersion,horizon:plan.horizon,
  recording:plan.recording,differences:plan.differences,demandManifest,durationOrder:ROUTES,baseline,candidate,delta,assumptions});
}
