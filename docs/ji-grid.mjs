// Integral network-flow feasibility model for an integer-minute makespan bound.
// A homogeneous vehicle waiting for its next direction can wait in a ready pool
// or perform exactly one task. Each used vehicle enters once and exits following
// a real task. The two fleets share n(direction, minute), the joint handovers.
const name=(prefix,d,t)=>prefix+d+'_'+t;
const opposite=d=>d==='E'?'I':'E';
const transfer=(c,fleet,from)=>fleet==='S'?(from==='E'?c.T2:c.T1):(from==='E'?c.T3:c.T4);
export function buildGrid(c,H){
 const K=H-c.T0,lines=[],variables=new Set();
 const term=(k,d,t)=>{const n=name(k,d,t);variables.add(n);return n;};
 const equation=(positive,negative,total=0)=>lines.push((positive.join(' + ')||'0')+(negative.length?' - '+negative.join(' - '):'')+' = '+total);
 for(const d of ['E','I']){
  equation(Array.from({length:K+1},(_,t)=>term('n',d,t)),[],c.pairs);
  for(let t=0;t<=K;t++){
   const active=[];
   for(let u=Math.max(0,t-c.T0+1);u<=t;u++)active.push(term('n',d,u));
   lines.push(active.join(' + ')+' <= '+(d==='E'?c.exportLanes:c.importLanes));
  }
 }
 for(const [k,fleet] of [['S',c.smvs],['V',c.agvs]]){
  const firsts=[],lasts=[];
  for(const d of ['E','I'])for(let t=0;t<=K;t++){
   const prev=opposite(d),inLag=c.T0+transfer(c,k,prev),outLag=c.T0+transfer(c,k,d);
   const first=k==='V'||d==='E'?[term(k+'f',d,t)]:[],last=k==='V'||d==='I'?[term(k+'l',d,t)]:[];
   firsts.push(...first);lasts.push(...last);
   const arrivals=t>=inLag?[term(k+'c',prev,t-inLag)]:[];
   const previous=t>0?[term(k+'w',d,t-1)]:[],waiting=t<K?[term(k+'w',d,t)]:[];
   equation([...first,...arrivals,...previous],[term('n',d,t),...waiting]);
   const next=t+outLag<=K?[term(k+'c',d,t)]:[];
   equation([term('n',d,t)],[...last,...next]);
  }
  equation(firsts,[],fleet);equation(lasts,[],fleet);
 }
 return {lp:['Minimize',' objective: 0 nE_0','Subject To',...lines.map((r,i)=>' r'+i+': '+r),
  'General',...[...variables].map(v=>' '+v),'End'].join('\n'),variables:variables.size,constraints:lines.length};
}

export function unpackGrid(c,H,values){
 const ready={S:{E:[],I:[]},V:{E:[],I:[]}},id={S:0,V:0},counts={E:0,I:0};
 const lanes={E:Array(c.exportLanes).fill(-1),I:Array(c.importLanes).fill(-1)},rows=[];
 const integer=key=>{
  const value=values.get(key)??0;
  if(!Number.isFinite(value)||Math.abs(value-Math.round(value))>1e-5)throw new Error('MILP 流量不是可还原整数 '+key);
  return Math.round(value);
 };
 for(let t=0;t<=H-c.T0;t++)for(const d of ['E','I']){
  const jobs=integer(name('n',d,t)),crew={};
  for(const k of ['S','V']){
   const pool=ready[k][d];
   for(let n=0;n<integer(name(k+'f',d,t));n++)pool.push({id:++id[k],at:t});
   pool.sort((a,b)=>a.at-b.at||a.id-b.id);
   crew[k]=pool.splice(0,jobs);
   if(crew[k].length!==jobs||crew[k].some(p=>p.at>t))throw new Error('MILP 车辆流量还原失败');
   for(const p of crew[k].slice(0,integer(name(k+'c',d,t))))ready[k][opposite(d)].push({id:p.id,at:t+c.T0+transfer(c,k,d)});
  }
  for(let i=0;i<jobs;i++){
   // Prefer an unused identical lane; this realizes the original dummy-node
   // requirement that every configured lane is used, even when demand is low.
   let lane=lanes[d].indexOf(-1);if(lane<0)lane=lanes[d].findIndex(end=>end<=t);
   if(lane<0)throw new Error('MILP 作业道容量还原失败');
   lanes[d][lane]=t+c.T0;
   rows.push({id:d+(++counts[d]),direction:d==='E'?'export':'import',smv:'SMV-'+crew.S[i].id,agv:'AGV-'+crew.V[i].id,
    lane:(d==='E'?'L2-':'L1-')+(lane+1),smvArrival:t,smvDeparture:t+c.T0,agvArrival:t,agvDeparture:t+c.T0,start:t,end:t+c.T0});
  }
 }
 return rows;
}
