// Ji et al., Transportation Research Part E 205 (2026), 104485, Sections 4.1–4.4.
// This is the homogeneous sea-side transfer model. All times are minutes.
import loadHighs from './vendor/ji-highs/highs.mjs';
import {buildGrid,unpackGrid} from './ji-grid.mjs';
import {figure4Reference} from './ji-reference.mjs';
export const jiPresets=Object.freeze({figure4:Object.freeze({pairs:6,smvs:2,agvs:2,importLanes:1,exportLanes:1,T0:2,T1:10,T2:1,T3:6,T4:1})});
const classic=jiPresets.figure4;
const tolerance=1e-5;
export function validateJi(input={}){
 const c={...classic,nodeLimit:2000000,timeLimitSec:30,...input};
 const max={pairs:10,smvs:4,agvs:4,importLanes:3,exportLanes:3,T0:30,T1:30,T2:30,T3:30,T4:30,nodeLimit:5000000,timeLimitSec:120};
 for(const [key,value] of Object.entries(c))if(!Object.hasOwn(max,key)||!Number.isInteger(value)||value<1||value>max[key])throw new RangeError('论文实验参数无效 '+key);
 if(c.smvs>c.pairs||c.agvs>2*c.pairs||c.importLanes>c.pairs||c.exportLanes>c.pairs)throw new RangeError('原模型要求每台车及每条作业道至少执行一项任务，当前任务数量不足');
 return c;
}
const figure4=c=>Object.keys(classic).every(k=>classic[k]===c[k]);
const ids=(n,prefix)=>Array.from({length:n},(_,i)=>prefix+(i+1));
export const paperBound=c=>Math.ceil(c.pairs/c.smvs)*(c.T1+c.T2+2*c.T0)-c.T1;
const waitOf=(c,rows)=>rows.reduce((w,r)=>w+r.smvDeparture-r.smvArrival+r.agvDeparture-r.agvArrival-2*c.T0,0);
const maxEnd=rows=>Math.max(...rows.map(r=>r.smvDeparture));
function makeRow(id,direction,smv,agv,lane,sa,sd,aa,ad,T0){
 const start=Math.max(sa,aa);
 return {id,direction,smv,agv,lane,smvArrival:sa,smvDeparture:sd,agvArrival:aa,agvDeparture:ad,start,end:start+T0};
}
function serial(c){
 const rows=[];let start=0;
 for(let k=0;k<2*c.pairs;k++){
  const inbound=k%2===1,pair=Math.floor(k/2),end=start+c.T0;
  rows.push(makeRow((inbound?'I':'E')+(pair+1),inbound?'import':'export','SMV-'+(1+Math.floor(pair*c.smvs/c.pairs)),
   'AGV-'+(1+Math.floor(k*c.agvs/(2*c.pairs))),(inbound?'L1-':'L2-')+(1+pair%(inbound?c.importLanes:c.exportLanes)),
   start,end,start,end,c.T0));
  start=end+Math.max(inbound?c.T1:c.T2,inbound?c.T4:c.T3);
 }
 return rows;
}
export function auditJi(input,rows,claimed){
 const c=validateJi(input),checks=[];
 function check(id,label,passed,detail){checks.push({id,label,passed:Boolean(passed),detail});}
 const tasks=[...ids(c.pairs,'E'),...ids(c.pairs,'I')],S=ids(c.smvs,'SMV-'),V=ids(c.agvs,'AGV-');
 const lanes=[...ids(c.importLanes,'L1-'),...ids(c.exportLanes,'L2-')];
 check('tasks','任务唯一分配',rows.length===tasks.length&&tasks.every(id=>rows.filter(r=>r.id===id).length===1)&&rows.every(r=>S.includes(r.smv)&&V.includes(r.agv)&&r.direction===(r.id[0]==='E'?'export':'import')),'式 2、8 · '+rows.length+' 箱');
 const finite=rows.every(r=>[r.smvArrival,r.smvDeparture,r.agvArrival,r.agvDeparture].every(v=>Number.isFinite(v)&&v>=-tolerance));
 check('time','到离时刻与联合交接',finite&&rows.every(r=>Math.min(r.smvDeparture,r.agvDeparture)-Math.max(r.smvArrival,r.agvArrival)>=c.T0-tolerance && Math.abs(r.start-Math.max(r.smvArrival,r.agvArrival))<tolerance && Math.abs(r.end-r.start-c.T0)<tolerance),'式 15、19、31–34 · 共同处理至少 '+c.T0+' 分钟');
 for(const [kind,vehicles] of [['smv',S],['agv',V]]){
  const arrival=kind+'Arrival',departure=kind+'Departure';
  const valid=vehicles.every(v=>{
   const route=rows.filter(r=>r[kind]===v).sort((a,b)=>a[arrival]-b[arrival]);
   if(!route.length || kind==='smv'&&(route[0].direction!=='export'||route.at(-1).direction!=='import'))return false;
   return route.slice(1).every((r,i)=>{
    const prev=route[i],out=prev.direction==='export';
    const travel=kind==='smv'?(out?c.T2:c.T1):(out?c.T3:c.T4);
    return prev.direction!==r.direction&&r[arrival]>=prev[departure]+travel-tolerance;
   });
  });
  check(kind,kind.toUpperCase()+' 序列与最短转场',valid,kind==='smv'?'式 3–7、16–17 · 出口起、进口止':'式 9–13、20–21 · 首尾方向自由，连续任务交替');
 }
 const laneOK=rows.every(r=>lanes.includes(r.lane)&&r.lane.startsWith(r.direction==='import'?'L1-':'L2-')) &&
  lanes.every(l=>{const seq=rows.filter(r=>r.lane===l).sort((a,b)=>a.smvArrival-b.smvArrival);return seq.length&&seq.slice(1).every((r,i)=>r.smvArrival>=seq[i].smvDeparture-tolerance);});
 check('tracks','方向匹配与悬轨占用互斥',laneOK,'式 18、22–30 · 每条作业道均使用');
 check('cmax','末台 SMV 离开时刻',Number.isFinite(claimed)&&Math.abs(claimed-maxEnd(rows))<tolerance,'式 1、14 · Cmax = max SMV departure');
 return {passed:checks.every(x=>x.passed),checks};
}

export function buildJiMILP(input={}){
 const c=validateJi(input),E=ids(c.pairs,'E'),I=ids(c.pairs,'I'),tasks=[...E,...I];
 const H=maxEnd(serial(c)),M=H+Math.max(c.T0,c.T1,c.T2,c.T3,c.T4);
 const lines=[],bins=[],map={smv:[],agv:[],lane:[]};let constraints=0;
 const sum=v=>v.join(' + '),row=expr=>lines.push(' r'+(++constraints)+': '+expr);
 const dur=(i,a,b)=>row(b+'_'+i+' - '+a+'_'+i+' >= '+c.T0);
 function chain(kind,k,allowed,starts,ends,allowedArc){
  const head=kind[0]+k,assign={},arcs={};
  for(const i of allowed){assign[i]=head+'_'+i;bins.push(assign[i]);}
  const edge=(a,b)=>{const name=head+'_'+a+'_'+b;bins.push(name);arcs[a+':'+b]=name;return name;};
  row(sum(starts.map(i=>edge('O',i)))+' = 1');row(sum(ends.map(i=>edge(i,'O')))+' = 1');
  for(const a of allowed)for(const b of allowed)if(a!==b&&allowedArc(a,b))edge(a,b);
  for(const i of allowed){
   row(sum(['O',...allowed].map(j=>arcs[j+':'+i]).filter(Boolean))+' - '+assign[i]+' = 0');
   row(sum(['O',...allowed].map(j=>arcs[i+':'+j]).filter(Boolean))+' - '+assign[i]+' = 0');
  }
  map[kind].push({assign,arcs});return {assign,arcs};
 }
 for(let k=1;k<=c.smvs;k++)chain('smv',k,tasks,E,I,(a,b)=>a[0]!==b[0]);
 for(let k=1;k<=c.agvs;k++)chain('agv',k,tasks,tasks,tasks,(a,b)=>a[0]!==b[0]);
 for(const [list,n,prefix] of [[I,c.importLanes,'L1-'],[E,c.exportLanes,'L2-']]){
  for(let k=1;k<=n;k++){
   const lane=chain('lane',map.lane.length+1,list,list,list,(a,b)=>list.indexOf(a)<list.indexOf(b));
   map.lane.at(-1).label=prefix+k;
  }
 }
 row(map.smv[0].assign.E1+' = 1');row(map.agv[0].assign.E1+' = 1');
 for(const i of tasks){
  for(const kind of ['smv','agv','lane'])row(sum(map[kind].map(v=>v.assign[i]).filter(Boolean))+' = 1');
  row('Cmax - sd_'+i+' >= 0');
  for(const [a,b] of [['sa','sd'],['aa','ad'],['aa','sd'],['sa','ad']])dur(i,a,b);
 }
 for(const list of [E,I])for(let k=1;k<list.length;k++)row('sa_'+list[k]+' - sa_'+list[k-1]+' >= 0');
 for(const a of tasks)for(const b of tasks)if(a!==b){
  const cross=a[0]!==b[0],out=a[0]==='E';
  for(const kind of cross?['smv','agv']:['lane']){
   const arcs=map[kind].map(r=>r.arcs[a+':'+b]).filter(Boolean);
   if(!arcs.length)continue;
   const agv=kind==='agv',travel=cross?(agv?(out?c.T3:c.T4):(out?c.T2:c.T1)):0;
   row((agv?'aa_':'sa_')+b+' - '+(agv?'ad_':'sd_')+a+' - '+arcs.map(v=>M+' '+v).join(' - ')+' >= '+(travel-M));
  }
 }
 const bounds=[' '+paperBound(c)+' <= Cmax <= '+H,...tasks.flatMap(i=>['sa','sd','aa','ad'].map(v=>' 0 <= '+v+'_'+i+' <= '+H))];
 const lp=['Minimize',' objective: Cmax','Subject To',...lines,'Bounds',...bounds,'Binary',...bins.map(v=>' '+v),'End'].join('\n');
 return {lp,map,tasks,rows:constraints,binaries:bins.length};
}
// Given the three independently optimized orders, restore independent arrival
// and departure variables with the original dwell and overlap inequalities.
function retime(c,rows,h,deadline){
 const lines=[];
 const rule=(v,w,lag=0)=>lines.push(v+' - '+w+' >= '+lag);
 for(const r of rows){
  const i=r.id;rule('Cmax','sd_'+i);
  for(const [a,d] of [['sa','sd'],['aa','ad'],['aa','sd'],['sa','ad']])rule(d+'_'+i,a+'_'+i,c.T0);
 }
 for(const [kind,ids] of [['smv',new Set(rows.map(r=>r.smv))],['agv',new Set(rows.map(r=>r.agv))],['lane',new Set(rows.map(r=>r.lane))]]){
  for(const id of ids){
   const seq=rows.filter(r=>r[kind]===id).sort((a,b)=>a.start-b.start);
   for(let k=1;k<seq.length;k++){
    const prev=seq[k-1],out=prev.direction==='export',v=kind==='agv';
    const lag=kind==='lane'?0:v?(out?c.T3:c.T4):(out?c.T2:c.T1);
    rule((v?'aa_':'sa_')+seq[k].id,(v?'ad_':'sd_')+prev.id,lag);
   }
  }
 }
 const lp=['Minimize',' objective: Cmax','Subject To',...lines.map((r,i)=>' r'+i+': '+r),'End'].join('\n');
 const m=h.createModel({format:'lp',data:lp});
 try{
  const left=(deadline-performance.now())/1000;if(left<=0)return rows;
  m.options.set({output_flag:false,time_limit:left});m.run();
  if(m.getModelStatus()===13)return rows;
  if(m.getModelStatus()!==7)throw new Error('原到离约束的定序 LP 未能求解');
  const x=m.getSolution().colValue,at=(key,i)=>{const v=x[m.getColByName(key+'_'+i)];return Math.abs(v-Math.round(v))<1e-7?Math.round(v):v;};
  return rows.map(r=>makeRow(r.id,r.direction,r.smv,r.agv,r.lane,at('sa',r.id),at('sd',r.id),at('aa',r.id),at('ad',r.id),c.T0));
 }finally{m.dispose();}
}
let runtime;
export async function solveJi(input={},options={}){
 const c=validateJi(input),t0=performance.now();
 options.onProgress?.({phase:'model',elapsedMs:0});
 const reference=figure4(c)?figure4Reference(c):null;
 let rows=serial(c);
 const base=reference?.baseline??{label:'同输入顺序预派工',rows:[...rows],cmax:maxEnd(rows),waiting:waitOf(c,rows)};
 base.audit=auditJi(c,base.rows,base.cmax);
 if(reference)reference.double.audit=auditJi(c,reference.double.rows,reference.double.cmax);
 // The search starts with a constructed feasible witness, independently of both
 // published outcomes. At a proved infeasible H the integer optimum is >= H+1.
 let lower=paperBound(c),upper=maxEnd(rows),nodes=0,variables=0,constraints=0;
 const trials=[];
 const beforeLoad=performance.now();runtime??=loadHighs();const h=await runtime;
 const loadMs=performance.now()-beforeLoad,deadline=t0+1000*c.timeLimitSec;
 while(lower<upper){
  const secondsLeft=(deadline-performance.now())/1000;
  if(secondsLeft<=0||nodes>=c.nodeLimit)break;
  const H=Math.floor((lower+upper-1)/2),grid=buildGrid(c,H),start=performance.now();
  options.onProgress?.({phase:'solving',horizon:H,lowerBound:lower,upperBound:upper,nodes,elapsedMs:start-t0});
  const m=h.createModel({format:'lp',data:grid.lp});
  let conclusion='limited',explored=0;
  try{
   const solveBudget=(deadline-performance.now())/1000;
   if(solveBudget<=0)break;
   m.options.set({output_flag:false,time_limit:solveBudget,mip_max_nodes:c.nodeLimit-nodes,mip_rel_gap:0,mip_abs_gap:0,random_seed:0});
   m.run();const code=m.getModelStatus();
   explored=Math.max(0,Number(m.info.get('mip_node_count')));nodes+=explored;
   variables=Math.max(variables,grid.variables);constraints=Math.max(constraints,grid.constraints);
   if(code===8){lower=H+1;conclusion='infeasible';}
   else if(m.info.get('primal_solution_status')===2){
    const x=m.getSolution().colValue,values=new Map();
    for(let i=0;i<x.length;i++)values.set(m.getColName(i),x[i]);
    const candidate=unpackGrid(c,H,values),span=maxEnd(candidate);
    if(!auditJi(c,candidate,span).passed||span>H+tolerance)throw new Error('时间展开 MILP 的可行证书未通过核验');
    rows=candidate;upper=span;conclusion='feasible';
   }else if(![13,14,16,17].includes(code))throw new Error('HiGHS 求解状态异常 '+code);
  }finally{m.dispose();}
  trials.push({horizon:H,status:conclusion,nodes:explored,elapsedMs:performance.now()-start});
  if(conclusion==='limited')break;
 }
 rows=retime(c,rows,h,deadline);
 const cmax=maxEnd(rows),audit=auditJi(c,rows,cmax);
 if(!audit.passed||cmax<lower-tolerance)throw new Error('原到离事件或优化界未通过核验');
 const status=Math.abs(cmax-lower)<tolerance?'optimal':'limited';
 return {format:'port-sim-ji-optimization',version:1,config:c,status,solver:{name:'HiGHS',version:'1.16.0',method:'时间展开 MILP 分支切割与原式定序 LP'},
  cmax,lowerBound:lower,upperBound:cmax,gap:(cmax-lower)/cmax,elapsedMs:performance.now()-t0,
  stats:{nodes,variables,constraints,trials,theoreticalBound:paperBound(c),loadMs,timeLimitSec:c.timeLimitSec,nodeLimit:c.nodeLimit},
  provenance:{doi:'10.1016/j.tre.2025.104485',objective:'min Cmax',timeUnit:'min',model:'Ji equations (1)–(35), homogeneous balanced transfer tasks',
   proof:'Integer time-expanded MILP; feasible deadlines provide audited upper bounds; proved infeasible H implies Cmax >= H+1.',
   waiting:'Sum over assigned vehicles and tasks of departure minus arrival minus T0. Waiting is reported, not optimized.'},
  rows,audit,waiting:waitOf(c,rows),baseline:base,paperSchedule:reference?.double??null,
  paper:reference?{cmax:41,waiting:19,lowerBound:35,baselineCmax:52,baselineWaiting:66}:null};
}
