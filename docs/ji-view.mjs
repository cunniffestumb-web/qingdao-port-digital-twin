const preset4={pairs:2,smvs:1,agvs:1,importLanes:1,exportLanes:1,T0:2,T1:10,T2:1,T3:6,T4:1};
const preset12={...preset4,pairs:6,smvs:2,agvs:2};
const preset20={...preset12,pairs:10,importLanes:2,exportLanes:2};
const presets={figure4:preset12,teaching:preset4,figure6:preset20};
const fleets=[['pairs','每向箱数'],['smvs','空轨车 SMV'],['agvs','导引车 AGV'],['importLanes','进口作业位 L1'],['exportLanes','出口作业位 L2']];
const times=[['T0','T0 · 共同装卸'],['T1','T1 · SMV 经陆侧'],['T2','T2 · SMV 跨区'],['T3','T3 · AGV 经堆场'],['T4','T4 · AGV 跨区']];
const keys=[...fleets,...times].map(([k])=>k);
const doi='https://doi.org/10.1016/j.tre.2025.104485';
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=v=>numeric(v)?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(v):'—';
const cssPercent=v=>Math.max(0,Math.min(100,v))+'%';
const direction=r=>r.direction==='export'?'出口':'进口';
const shortId=id=>String(id).replace(/^([A-Za-z]+)[-_]?0*(\d+)$/,'$1$2');
const match=(c,p)=>keys.every(k=>c[k]===p[k]);
const statuses={optimal:'已证明最优',limited:'已达搜索上限',infeasible:'已证明不可行',feasible:'可行方案'};
function measuredWait(solution){
 if(numeric(solution?.waiting))return solution.waiting;
 if(!solution?.rows?.length)return null;
 return solution.rows.reduce((total,r)=>total+(r.smvDeparture-r.smvArrival)+(r.agvDeparture-r.agvArrival)-2*(r.end-r.start),0);
}
function solverName(r){
 if(typeof r.solver==='string')return r.solver;
 return [r.solver?.name,r.solver?.version].filter(Boolean).join(' ')||'调度求解器';
}
function sequence(rows){
 return [...rows].sort((a,b)=>a.start-b.start||a.end-b.end||String(a.id).localeCompare(String(b.id),'zh-CN',{numeric:true}));
}
function fields(defs,type){
 return defs.map(([id,label])=>`<label>${label}<input name="${id}" type="number" inputmode="${type==='count'?'numeric':'decimal'}" min="1" max="${type==='count'?(id==='pairs'?10:id.includes('Lanes')?3:4):30}" step="1" required value="${preset12[id]}"></label>`).join('');
}
function initialMarkup(){
 return `<header class="ji-heading"><div><h2>空轨车与 AGV 双循环调度</h2><p>安排每个箱子的两台车辆、交接作业位和到离时刻，求海侧交接的最短工期。</p></div><a href="${doi}" target="_blank" rel="noreferrer">Ji 等 · 2026 ↗</a></header>
 <form class="ji-form" data-ji="form"><div class="ji-form-head"><h3>算例输入</h3><label class="ji-preset">算例<select name="preset"><option value="figure4">论文图 4 · 12 箱</option><option value="teaching">解析教学 · 4 箱</option><option value="figure6">论文图 6 · 20 箱</option><option value="custom">自定义参数</option></select></label></div>
 <div class="ji-form-sections"><fieldset><legend>任务与作业资源</legend><div class="ji-parameters">${fields(fleets,'count')}</div></fieldset>
 <fieldset><legend>作业与转场时间 <small>整数分钟</small></legend><div class="ji-parameters">${fields(times,'time')}</div></fieldset></div>
 <details class="ji-limits"><summary>搜索预算</summary><div class="ji-budget"><label>限时（秒）<input type="number" name="timeLimitSec" value="30" min="1" max="120" step="1" required></label><label>节点上限<input type="number" name="nodeLimit" value="2000000" min="1" max="5000000" step="1" required></label></div></details><div class="ji-form-foot"><span data-ji="description">进口、出口各 6 箱，共 12 箱</span><div class="ji-actions"><button type="button" data-ji-action="cancel" hidden>取消求解</button><button type="submit" class="ji-primary" data-ji="solve">运行求解</button></div></div></form>
 <div class="ji-status" data-ji="status" role="status" aria-live="polite">就绪。求解结果将显示每个箱子的设备分配和共同作业时间。</div>
 <section data-ji="results" aria-label="求解结果"></section>
 <details class="ji-method"><summary>模型口径与文献依据</summary><p>L1 服务进口箱，L2 服务出口箱。每个箱子由一台 SMV 和一台 AGV 在同一作业位共同装卸 T0 分钟。两类车辆分别遵循双循环顺序和各自的转场时间，轨道占用包含 SMV 提前到位后的等待。</p>
 <p>工期从首台 SMV 在 L2 开始出口作业起算，至末台 SMV 在 L1 完成进口交接后离开。时间轴采用论文作业时间，港区全链路仿真另有运行时钟。本页复现 Ji 的目标与约束，使用 HiGHS 求解等价的时间展开 MILP，并用原到离时刻约束生成日程。论文作者的增强逻辑型 Benders 分解（E-LBBD）尚未复现。</p>
 <p>Li 等研究的是随机新任务与换电调度。港区能源实验中的停车补能属于扩展场景。<a href="${doi}" target="_blank" rel="noreferrer">Ji 等原文</a> · <a href="https://doi.org/10.1016/j.tre.2023.103110" target="_blank" rel="noreferrer">Li 等原文</a></p></details>`;
}
const inputLabels={pairs:'每向箱数',smvs:'SMV',agvs:'AGV',importLanes:'L1',exportLanes:'L2',T0:'T0',T1:'T1',T2:'T2',T3:'T3',T4:'T4',timeLimitSec:'限时',nodeLimit:'节点上限'};
function inputDifferences(saved,formValues){
 return Object.keys(inputLabels).filter(key=>saved[key]!==formValues[key]);
}
function reportInputContext(saved,formValues){
 const changes=inputDifferences(saved,formValues);
 const origin=match(saved,preset12)?'论文图 4 参数':match(saved,preset20)?'论文图 6 参数':match(saved,preset4)?'教学算例参数':'自定义参数';
 const edits=changes.map(key=>`${inputLabels[key]} ${fmt(saved[key])} → ${numeric(formValues[key])?fmt(formValues[key]):'未填'}`).join('，');
 return `<strong>${changes.length?'结果与当前表单不同':'结果与当前表单一致'}</strong> · ${origin}<p>每向 ${fmt(saved.pairs)} 箱 · SMV=${fmt(saved.smvs)} · AGV=${fmt(saved.agvs)} · L1=${fmt(saved.importLanes)} · L2=${fmt(saved.exportLanes)}</p><p>作业与转场（分钟） ${times.map(([key])=>key+'='+fmt(saved[key])).join(' / ')} · 求解限时 ${fmt(saved.timeLimitSec)} 秒 · 节点上限 ${fmt(saved.nodeLimit)}</p>${changes.length?'<p>结果参数 → 当前输入　'+safe(edits)+'</p>':''}`;
}
function downloadReport(content,type,filename){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function metric(label,value,unit='',detail=''){
 return `<div class="ji-metric"><span>${label}</span><strong>${safe(value)} <small>${unit}</small></strong>${detail?'<p>'+safe(detail)+'</p>':''}</div>`;
}
function resourceGroups(rows,mode){
 const groups=new Map();
 function push(label,kind,row,a,d){
  const key=kind+' '+label;if(!groups.has(key))groups.set(key,{kind,label,ops:[]});
  groups.get(key).ops.push({row,a,d});
 }
 for(const row of sequence(rows)){
  if(mode==='equipment'){push(row.smv,'SMV',row,row.smvArrival,row.smvDeparture);push(row.agv,'AGV',row,row.agvArrival,row.agvDeparture);}
  else{push(row.lane,'上层',row,row.smvArrival,row.smvDeparture);push(row.lane,'下层',row,row.agvArrival,row.agvDeparture);}
 }
 const natural=(a,b)=>String(a).localeCompare(String(b),'zh-CN',{numeric:true});
 return [...groups.values()].sort((a,b)=>mode==='equipment'?(['SMV','AGV'].indexOf(a.kind)-['SMV','AGV'].indexOf(b.kind)||natural(a.label,b.label)):(natural(a.label,b.label)||['上层','下层'].indexOf(a.kind)-['上层','下层'].indexOf(b.kind)));
}
function gantt(rows,horizon,mode,selected){
 const groups=resourceGroups(rows,mode);
 const magnitude=10**Math.floor(Math.log10(horizon/5)),step=[1,2,5,10].map(x=>x*magnitude).find(x=>x>=horizon/6);
 const ticks=[0];for(let t=step;t<horizon-horizon*.055;t+=step)ticks.push(t);ticks.push(horizon);
 const tick=ticks.map(t=>`<span style="left:${cssPercent(t/horizon*100)}">${fmt(t)}</span>`).join('');
 const bands=groups.map(g=>{
  const lastEnd=[];
  const ops=g.ops.slice().sort((a,b)=>a.a-b.a||a.d-b.d).map(o=>{
   let track=lastEnd.findIndex(end=>end<=o.a+1e-8);if(track===-1)track=lastEnd.length;lastEnd[track]=o.d;
   const r=o.row,port=r.direction==='export'?'ex':'im',width=Math.max(o.d-o.a,.001),a=o.a/horizon*100,w=width/horizon*100;
   const title=`${r.id} · ${direction(r)} · ${g.label} 到位 ${fmt(o.a)}，共同作业 ${fmt(r.start)}–${fmt(r.end)}，离开 ${fmt(o.d)} 分钟`;
   return `<button type="button" class="ji-op ${port} ${String(r.id)===String(selected)?'is-selected':''}" data-ji-task="${safe(r.id)}" style="left:${cssPercent(a)};width:${cssPercent(w)};top:${8+track*31}px" title="${safe(title)}" aria-label="${safe(title)}"><i style="left:${cssPercent((r.start-o.a)/width*100)};width:${cssPercent((r.end-r.start)/width*100)}"></i><b>${safe(shortId(r.id))}</b></button>`;
  }).join('');
  const label=mode==='equipment'?String(g.label):String(g.label)+' · '+g.kind;
  return `<div class="ji-chart-row"><strong>${safe(label)}</strong><div class="ji-lane" style="height:${Math.max(1,lastEnd.length)*31+12}px">${ops}</div></div>`;
 }).join('');
 return `<div class="ji-chart-scroll" role="region" aria-label="调度甘特图，可左右滚动" tabindex="0"><div class="ji-board" style="--ji-grid:${cssPercent(step/horizon*100)}"><div class="ji-chart-row ji-axis"><strong>分钟</strong><div>${tick}</div></div>${bands}</div></div>`;
}
function detail(row,cursor){
 if(!row)return '';
 const state=(a,d)=>cursor<a?'待到位':cursor<row.start?'等待交接':cursor<row.end?'共同作业':cursor<d?'等待离位':'已离位';
 const dwell=(type,id,a,d)=>`<tr><th scope="row">${type} · ${safe(id)}</th><td data-title="到位（分）">${fmt(a)}</td><td data-title="驻留等待（分）">${fmt((d-a)-(row.end-row.start))}</td><td data-title="离位（分）">${fmt(d)}</td><td data-title="游标时状态">${state(a,d)}</td></tr>`;
 return `<div class="ji-detail-title"><h4>箱 ${safe(row.id)} · ${direction(row)}</h4><span>${safe(row.lane)} 作业位</span></div>
 <p>共同作业 <strong>${fmt(row.start)}–${fmt(row.end)} 分钟</strong>，两车在位重叠 ${fmt(Math.min(row.smvDeparture,row.agvDeparture)-Math.max(row.smvArrival,row.agvArrival))} 分钟。</p>
 <div class="ji-table-scroll"><table class="ji-detail-table" role="table"><thead><tr><th>设备</th><th>到位</th><th>驻留等待</th><th>离位</th><th>游标时状态</th></tr></thead><tbody>${dwell('SMV',row.smv,row.smvArrival,row.smvDeparture)}${dwell('AGV',row.agv,row.agvArrival,row.agvDeparture)}</tbody></table></div>`;
}
function comparisons(report){
 const ref=match(report.config,preset12)?report.paper:null;
 const line=(label,cmax,wait,source)=>`<tr><th>${safe(label)}</th><td data-title="工期（分钟）">${fmt(cmax)}</td><td data-title="累计等待（设备分钟）">${fmt(wait)}</td><td data-title="来源">${safe(source)}</td></tr>`;
 const base=report.baseline,actual=line('双循环求解',report.cmax,measuredWait(report),solverName(report));
 const baseline=base?line(ref?'图 4(a) 原图时序核验':base.label||'基线日程',base.cmax,measuredWait(base),ref?'按图 4(a) 到离记录复算':'同一输入顺序预派工'):'';
 const difference=base&&numeric(base.cmax)&&numeric(report.cmax)?base.cmax-report.cmax:null;
 const delta=difference===null?'':difference===0?'本次计算与基线工期相同。':'本次可行方案较基线'+(difference>0?'缩短 ':'延长 ')+fmt(Math.abs(difference))+' 分钟'+(base.cmax?'（'+fmt(Math.abs(difference)/base.cmax*100)+'%）':'')+'。';
 const wait=measuredWait(report);
 const alternate=ref&&numeric(wait)&&report.cmax===ref.cmax&&Math.abs(wait-ref.waiting)>1e-6?
  '本次日程与图 4(c) 工期均为 '+fmt(ref.cmax)+' 分钟，累计等待分别为 '+fmt(wait)+' 和 '+fmt(ref.waiting)+' 设备分钟。目标函数仅最小化工期。':'';
 const paper=ref?line('图 4(a) 论文报告',ref.baselineCmax,ref.baselineWaiting,'论文报告 · 固定配对')+line('图 4(c) 论文报告',ref.cmax,ref.waiting,'论文报告 · 双循环'):'';
 return `<section class="ji-card"><h3>同条件方案对照</h3><div class="ji-table-scroll"><table class="ji-compare-table" role="table"><thead><tr><th>方案</th><th>工期（分钟）</th><th>累计等待（设备分钟）</th><th>来源</th></tr></thead><tbody>${actual}${baseline}${paper}</tbody></table></div><p class="ji-caption">${safe(delta)}累计等待按两车各自驻留时间扣除共同作业时间后逐箱累加，含装卸后的驻留。${safe(alternate||'多个可行日程可以取得相同的工期。')}</p></section>`;
}
function occupancy(rows,t){
 const lanes=new Map();
 for(const r of rows){
  if(!lanes.has(r.lane))lanes.set(r.lane,{lane:r.lane,direction:direction(r),smvs:[],agvs:[],active:[]});
  const l=lanes.get(r.lane);
  if(t>=r.smvArrival&&t<r.smvDeparture)l.smvs.push(r.smv+' / '+r.id);
  if(t>=r.agvArrival&&t<r.agvDeparture)l.agvs.push(r.agv+' / '+r.id);
  if(t>=r.start&&t<r.end)l.active.push(String(r.id));
 }
 return [...lanes.values()].sort((a,b)=>String(a.lane).localeCompare(String(b.lane),'zh-CN',{numeric:true}));
}
function occupancyMarkup(lanes){
 return lanes.map(l=>`<article class="ji-berth ${l.active.length?'ji-berth-active':''}"><div><h4>${safe(l.lane)} · ${l.direction}</h4><span>${l.active.length?'共同作业':l.smvs.length||l.agvs.length?'驻留':'空闲'}</span></div><p><b>上层轨道</b> ${safe(l.smvs.join('、')||'空闲')}</p><p><b>下层车道</b> ${safe(l.agvs.join('、')||'空闲')}</p></article>`).join('');
}

function proofTrials(report){
 const trials=report.stats?.trials||[];
 if(!trials.length)return '';
 const labels={feasible:'可行',infeasible:'不可行',optimal:'已证明最优',limited:'预算内未完成',unknown:'未判定'};
 return `<details class="ji-evidence" open><summary>工期界证据 · ${trials.length} 次判定</summary><div class="ji-table-scroll"><table><thead><tr><th>候选截止（分钟）</th><th>求解判定</th><th>耗时（秒）</th><th>搜索节点</th></tr></thead><tbody>${trials.map(t=>`<tr><td>${fmt(t.horizon)}</td><td>${safe(labels[t.status]||t.status)}</td><td>${numeric(t.elapsedMs)?fmt(t.elapsedMs/1000):'—'}</td><td>${fmt(t.nodes)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function starter(config){
 const guidance=match(config,preset12)?`<aside><h4>图 4 发表对照</h4><p>固定配对 <strong>52</strong> 分钟 · 双循环优化 <strong>41</strong> 分钟</p><a href="${doi}" target="_blank" rel="noreferrer">查看论文算例 ↗</a></aside>`:'';
 return `<section class="ji-guide"><div><h3>双循环转场</h3><table><thead><tr><th>离开 → 到达</th><th>SMV 转场</th><th>AGV 转场</th></tr></thead><tbody><tr><th>L2 出口 → L1 进口</th><td>${fmt(config.T2)} 分钟</td><td>${fmt(config.T3)} 分钟</td></tr><tr><th>L1 进口 → L2 出口</th><td>${fmt(config.T1)} 分钟</td><td>${fmt(config.T4)} 分钟</td></tr></tbody></table></div>${guidance}</section>`;
}

function auditMarkup(audit){
 if(!audit)return '<p>本方案尚无逐约束核查记录。</p>';
 const checks=audit.checks||[];
 return `<details class="ji-audit"><summary>约束核查 · ${audit.passed?'通过':'发现问题'}（${checks.filter(c=>c.passed).length}/${checks.length}）</summary><ul>${checks.map(c=>`<li><b class="${c.passed?'ji-good':'ji-warn'}">${c.passed?'通过':'异常'}</b><span><strong>${safe(c.label||c.id)}</strong> ${safe(typeof c.detail==='string'?c.detail:JSON.stringify(c.detail??''))}</span></li>`).join('')}</ul></details>`;
}

export function createJiPanel(host){
 if(!host)throw new TypeError('Ji 实验需要宿主节点');
 host.classList.add('ji-panel');host.innerHTML=initialMarkup();
 const get=name=>host.querySelector('[data-ji="'+name+'"]'),form=get('form'),resultBox=get('results');
 const status=text=>{get('status').textContent=text;};
 let disposed=false,request=0,controller=null,report=null,plan='candidate',mode='equipment',selected=null,cursor=0,raf=0,lastTick=0,followCursor=true;
 const current=()=>plan==='baseline'?report?.baseline:plan==='published'?report?.paperSchedule:report;
 const readConfig=()=>Object.fromEntries([...keys,'timeLimitSec','nodeLimit'].map(k=>[k,form.elements[k].valueAsNumber]));
 const rows=()=>current()?.rows||[];
 const byId=id=>rows().find(r=>String(r.id)===String(id));
 const horizon=()=>Math.max(1,current()?.cmax||0,...rows().map(r=>Math.max(r.smvDeparture,r.agvDeparture)));
 let viewVisible=true,three=null,loadingScene=false,sceneFailure=null,cameraView='overview';
 const sceneCard=document.createElement('section');
 sceneCard.className='ji-space';
 sceneCard.innerHTML=`<div class="ji-space-head"><div><h4>海侧交接三维示意</h4><p data-ji="scene-selection">等待日程</p></div><div class="ji-segments" aria-label="三维相机"><button type="button" data-ji-camera="overview" aria-pressed="true">全景</button><button type="button" data-ji-camera="selected" aria-pressed="false">选箱近景</button></div></div>
 <div class="ji-space-canvas" data-ji="three-host"></div><div class="ji-space-fleet" data-ji="space-fleet" aria-label="各车当前任务或转场"></div><p class="ji-space-note">上层 SMV、下层 AGV 在同湾交接。时刻取自当前日程；站位、升降距离与区外转场带为示意。每车在区外有独立显示位置，原文未提供行驶路径和速度。</p>`;
 function syncScene(){
  if(!three||!rows().length)return;
  three.setSchedule(report.config,rows());three.update(cursor,selected);
 }
 async function mountScene(){
  const mount=get('scene-mount');if(!mount)return;mount.append(sceneCard);
  if(three){three.setVisible(viewVisible);syncScene();return;}
  if(loadingScene||sceneFailure)return;
  loadingScene=true;
  try{
   const {createJiScene}=await import('./ji-scene.mjs');if(disposed)return;
   three=createJiScene(sceneCard.querySelector('[data-ji="three-host"]'),{onSelect:selectTask,onSummary:(text,fleet)=>{
    sceneCard.querySelector('[data-ji="scene-selection"]').textContent=text;
    sceneCard.querySelector('[data-ji="space-fleet"]').innerHTML=fleet.map(r=>'<div><b>'+safe(r.id)+'</b> <span>'+safe(r.text)+'</span></div>').join('');
   }});
   three.setVisible(viewVisible);syncScene();three.setView(cameraView);
  }catch(error){
   sceneFailure=error.message;const canvas=sceneCard.querySelector('[data-ji="three-host"]');
   canvas.classList.add('ji-space-fallback');canvas.textContent='此设备无法打开三维视图。下方甘特图与上下层占用可继续核对同一日程。';
   sceneCard.querySelector('[data-ji="scene-selection"]').textContent='二维时序可用';sceneCard.querySelectorAll('button').forEach(b=>{b.disabled=true;});
  }finally{loadingScene=false;}
 }
 function refreshContext(){
  const context=get('result-context');if(!context||!report)return;
  const values=readConfig();context.dataset.stale=String(inputDifferences(report.config,values).length>0);
  context.innerHTML=reportInputContext(report.config,values);
 }
 function progressText(p){
  if(typeof p==='string')return p;
  if(!p||typeof p!=='object')return '求解中…';
  return [p.message||p.label||'求解中…',numeric(p.nodes)?'已查 '+fmt(p.nodes)+' 节点':'',numeric(p.lowerBound)?'下界 '+fmt(p.lowerBound)+' 分钟':'',numeric(p.upperBound)?'可行上界 '+fmt(p.upperBound)+' 分钟':''].filter(Boolean).join(' · ');
 }
 function busy(on){
  get('solve').disabled=on;form.querySelector('[data-ji-action=cancel]').hidden=!on;form.setAttribute('aria-busy',String(on));
 }
 function stop(){
  cancelAnimationFrame(raf);raf=0;lastTick=0;
  const button=host.querySelector('[data-ji-action=play]');if(button){button.textContent='播放';button.setAttribute('aria-pressed','false');}
 }
 function timeView(){
  const range=get('cursor');if(!range)return;
  range.value=String(cursor);range.setAttribute('aria-valuetext',fmt(cursor)+' 分钟');
  get('time').textContent=fmt(Math.round(cursor*100)/100)+' / '+fmt(horizon())+' 分钟';
  const chart=host.querySelector('.ji-board');chart?.style.setProperty('--ji-cursor',cssPercent(100*cursor/horizon()));
  const lanes=occupancy(rows(),cursor),laneSignature=JSON.stringify(lanes),panel=get('occupancy');
  if(panel&&panel.dataset.signature!==laneSignature){panel.innerHTML=occupancyMarkup(lanes);panel.dataset.signature=laneSignature;}
  three?.update(cursor,selected);
  const r=byId(selected),signature=r?[r.id,cursor<r.smvArrival,cursor<r.agvArrival,cursor<r.start,cursor<r.end,cursor<r.smvDeparture,cursor<r.agvDeparture].join('/'):'';
  const slot=get('selected');if(slot&&slot.dataset.signature!==signature){slot.innerHTML=detail(r,cursor);slot.dataset.signature=signature;}
 }
 function revealCursor(){
  const scroller=host.querySelector('.ji-chart-scroll'),lane=scroller?.querySelector('.ji-lane');
  if(!lane||!scroller.clientWidth||scroller.scrollWidth<=scroller.clientWidth+1)return;
  const viewport=scroller.getBoundingClientRect(),track=lane.getBoundingClientRect();
  const labels=scroller.querySelector('.ji-axis>strong').getBoundingClientRect().width;
  const x=track.left+track.width*cursor/horizon(),left=viewport.left+labels+9,right=viewport.right-13;
  if(x<left||x>right)scroller.scrollLeft+=x-(left+right)/2;
 }
 function manualChart(event){if(raf&&event.target.closest('.ji-chart-scroll'))followCursor=false;}
 function tick(now){
  if(document.hidden||!host.getClientRects().length){stop();return;}
  if(!lastTick)lastTick=now;
  cursor=Math.min(horizon(),cursor+(now-lastTick)*.002);lastTick=now;timeView();if(followCursor)revealCursor();
  if(cursor>=horizon())stop();else raf=requestAnimationFrame(tick);
 }
 function seek(t){
  stop();followCursor=true;cursor=Math.max(0,Math.min(horizon(),t));timeView();revealCursor();
 }
 function drawChart(){
  const s=current(),list=rows();
  if(!list.length)return;
  if(!byId(selected))selected=sequence(list)[0].id;
  const controls=`<div class="ji-chart-controls"><div class="ji-segments" aria-label="甘特图分组"><button type="button" data-ji-group="equipment" aria-pressed="${mode==='equipment'}">按设备</button><button type="button" data-ji-group="lanes" aria-pressed="${mode==='lanes'}">按作业位</button></div><div class="ji-legend"><span><i class="ex"></i>出口</span><span><i class="im"></i>进口</span><span><i class="wait"></i>等待驻留</span></div></div>`;
  const source=plan==='candidate'?'本次求解':plan==='published'?'图 4(c) 原文日程':s.label||'基线日程';
  const summary='<p class="ji-plan-summary"><strong>'+safe(source)+'</strong> · 工期 '+fmt(s.cmax)+' 分钟 · 累计等待 '+fmt(measuredWait(s))+' 设备分钟</p><small class="ji-scroll-hint">甘特图可左右滑动</small>';
  get('chart').innerHTML=summary+'<div data-ji="scene-mount"></div>'+
  `<div class="ji-play"><button type="button" data-ji-action="play" aria-pressed="false">播放</button><button type="button" data-ji-action="back" aria-label="上一个调度时刻">上一时刻</button><button type="button" data-ji-action="next" aria-label="下一个调度时刻">下一时刻</button><label>时序游标<input data-ji="cursor" type="range" aria-label="调度时刻（分钟）" min="0" max="${horizon()}" step="0.01" value="${cursor}"></label><output data-ji="time"></output></div>`+controls+gantt(list,horizon(),mode,selected)+
  `<div class="ji-occupancy" data-ji="occupancy" aria-label="游标时刻各作业位状态"></div><div class="ji-detail"><div class="ji-detail-tools"><label>查看单箱<select data-ji="task-select">${sequence(list).map(r=>`<option value="${safe(r.id)}" ${String(r.id)===String(selected)?'selected':''}>${safe(r.id)} · ${direction(r)}</option>`).join('')}</select></label><small>按共同作业开始时刻排序</small></div><div data-ji="selected"></div></div>`+auditMarkup(s.audit);
  mountScene();timeView();revealCursor();
 }
 function draw(){
  stop();if(!report){resultBox.innerHTML=starter(readConfig());return;}
  const {cmax,lowerBound,upperBound}=report;
  const gap=report.gap;
  const elapsed=numeric(report.elapsedMs)?fmt(report.elapsedMs/1000)+' 秒':'';
  const opt=statuses[report.status]||String(report.status);
  const baseline=report.baseline?.rows?.length>0,published=report.paperSchedule?.rows?.length>0,list=rows();
  if(!list.length&&three){three.dispose();three=null;}
  const theoretical=report.stats?.theoreticalBound;
  const heading=`<div class="ji-result-head"><div><h3>求解结果 <span class="ji-proof">${safe(opt)}</span></h3><p>${report.config.pairs*2} 箱 · ${report.config.smvs} 台 SMV · ${report.config.agvs} 台 AGV · ${safe(solverName(report))}${elapsed?' · '+elapsed:''}</p></div><div class="ji-actions"><button type="button" data-ji-action="export">导出结果 JSON</button><button type="button" data-ji-action="export-lp">导出原式 LP</button></div></div><div class="ji-input-context" data-ji="result-context" aria-label="该报告的输入参数"></div>`;
  const metrics=`<div class="ji-metrics">${metric('可行工期 Cmax',fmt(cmax),'分','首出口开始至末进口离开')}${metric('求解下界',fmt(lowerBound),'分',numeric(theoretical)?'论文式 (36) 初始下界 '+fmt(theoretical)+' 分':'求解器可证明的界')}${metric('可行上界',fmt(upperBound),'分','已找到的可行调度')}${metric('相对间隙',numeric(gap)?fmt(gap*100):'—',numeric(gap)?'%':'','按本次求解证书')}</div>`;
  const panel=list.length?`<section class="ji-card"><div class="ji-result-head"><div><h3>交接时序</h3><p>点击色块或选择箱号，核对两车共同在位区间。</p></div><div class="ji-segments" aria-label="时间轴方案"><button type="button" data-ji-plan="candidate" aria-pressed="${plan==='candidate'}">求解方案</button>${baseline?`<button type="button" data-ji-plan="baseline" aria-pressed="${plan==='baseline'}">基线日程</button>`:''}${published?`<button type="button" data-ji-plan="published" aria-pressed="${plan==='published'}">图 4(c) 时序</button>`:''}</div></div><div data-ji="chart"></div></section>`:
  `<section class="ji-card"><h3>调度可行性</h3><p>${safe(report.message||report.reason||(report.status==='infeasible'?'该输入无法满足模型约束。':'求解器尚未返回可绘制的可行日程。'))}</p>${auditMarkup(report.audit)}</section>`;
  resultBox.innerHTML=heading+metrics+panel+comparisons(report)+proofTrials(report)+
  `<details class="ji-evidence"><summary>求解输入与搜索证据</summary><pre>${safe(JSON.stringify({config:report.config,solver:report.solver,status:report.status,lowerBound,upperBound,gap,elapsedMs:report.elapsedMs,stats:report.stats},null,2))}</pre></details>`;
  refreshContext();drawChart();
 }
 function selectTask(id){
  const r=byId(id);if(!r)return;selected=r.id;seek(r.start);
  host.querySelectorAll('[data-ji-task]').forEach(b=>b.classList.toggle('is-selected',b.dataset.jiTask===String(selected)));
  if(get('task-select'))get('task-select').value=String(selected);
 }
 function cancel(notice){
  if(!controller)return;request++;controller.abort();controller=null;busy(false);status(notice);
 }
 async function submit(event){
  event.preventDefault();if(controller||!form.reportValidity())return;
  stop();const config=readConfig(),serial=++request;controller=new AbortController();const {signal}=controller;
  busy(true);status('正在启动独立求解进程…');
  try{
   const {runJiExperiment}=await import('./ji-runner.mjs');
   if(disposed||serial!==request)return;
   const answer=await runJiExperiment(config,{signal,onProgress:p=>{if(!disposed&&request===serial)status(progressText(p));}});
   if(disposed||serial!==request)return;
   report=answer;plan='candidate';selected=null;cursor=0;draw();
   status('本次计算已结束 · '+(statuses[answer.status]||answer.status)+(answer.message?' · '+answer.message:''));
  }catch(e){
   if(disposed||serial!==request)return;
   status(signal.aborted?'已取消求解。':'求解未完成 · '+(e.message||String(e)));
  }finally{if(!disposed&&request===serial){controller=null;busy(false);}}
 }
 function changeInputs(){
  const conf=readConfig(),size=conf.pairs*2;
  get('description').textContent=Number.isFinite(size)?'进口、出口各 '+fmt(conf.pairs)+' 箱，共 '+fmt(size)+' 箱':'输入每向箱数';
  form.elements.preset.value=Object.keys(presets).find(key=>match(conf,presets[key]))||'custom';
  if(controller)cancel('参数已改变，已取消上一组求解。');
  stop();if(!report)draw();else refreshContext();
  status(!report?'参数已更新，可以运行求解。':inputDifferences(report.config,conf).length?'参数已更改。下方保留上次求解记录，运行求解以更新结果。':'当前参数与下方求解结果一致。');
 }
 function input(e){
  if(e.target===get('cursor')){seek(e.target.valueAsNumber);return;}
  if(form.contains(e.target)&&e.target.type==='number')changeInputs();
 }
 function change(e){
  if(e.target===form.elements.preset){const preset=presets[e.target.value];if(preset){for(const k of keys)form.elements[k].value=preset[k];changeInputs();}return;}
  if(e.target===get('task-select'))selectTask(e.target.value);
 }
 async function click(e){
  const b=e.target.closest('button');if(!b||!host.contains(b))return;
  if(b.dataset.jiCamera){cameraView=b.dataset.jiCamera;three?.setView(cameraView);sceneCard.querySelectorAll('[data-ji-camera]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.jiCamera===cameraView)));return;}
  if(b.dataset.jiTask!==undefined){selectTask(b.dataset.jiTask);return;}
  if(b.dataset.jiGroup){stop();mode=b.dataset.jiGroup;drawChart();host.querySelector('[data-ji-group="'+mode+'"]').focus();return;}
  if(b.dataset.jiPlan){plan=b.dataset.jiPlan;selected=null;cursor=0;draw();host.querySelector('[data-ji-plan="'+plan+'"]').focus();return;}
  switch(b.dataset.jiAction){
   case 'cancel': cancel('已取消本次求解。');break;
   case 'play':
    if(raf){stop();break;}
    if(cursor>=horizon())cursor=0;
    lastTick=0;followCursor=true;revealCursor();b.textContent='暂停';b.setAttribute('aria-pressed','true');raf=requestAnimationFrame(tick);break;
   case 'back': case 'next':{
    const points=[...new Set(rows().flatMap(r=>[r.smvArrival,r.agvArrival,r.start,r.end,r.smvDeparture,r.agvDeparture]))].sort((a,b)=>a-b);
    seek(b.dataset.jiAction==='next'?(points.find(t=>t>cursor+1e-7)??horizon()):(points.filter(t=>t<cursor-1e-7).at(-1)??0));break;
   }
   case 'export':{
    if(!report)break;const payload={source:doi,timeUnit:'minute',...report};
    downloadReport(JSON.stringify(payload,null,2),'application/json','ji-double-cycle-'+report.config.pairs*2+'-tasks.json');break;
   }
   case 'export-lp':{
    if(!report)break;const saved=report;
    try{
     const {buildJiMILP}=await import('./ji-model.mjs');if(disposed)break;
     const {lp}=buildJiMILP(saved.config);
     downloadReport(lp,'text/plain;charset=utf-8','ji-double-cycle-'+saved.config.pairs*2+'-tasks.lp');
    }catch(error){if(!disposed)status('原式 LP 导出失败 · '+error.message);}
    break;
   }
  }
 }
 form.addEventListener('submit',submit);host.addEventListener('input',input);host.addEventListener('change',change);host.addEventListener('click',click);host.addEventListener('pointerdown',manualChart);host.addEventListener('wheel',manualChart,{passive:true});
 draw();
 return {getResult:()=>report,getSceneStats:()=>three?{...three.getStats(),plan}:sceneFailure?{mode:"unavailable",reason:sceneFailure}:null,setVisible(value){viewVisible=!!value;three?.setVisible(viewVisible);if(!value)stop();else revealCursor();},dispose(){if(disposed)return;disposed=true;cancel('');stop();three?.dispose();form.removeEventListener('submit',submit);host.removeEventListener('input',input);host.removeEventListener('change',change);host.removeEventListener('click',click);host.removeEventListener('pointerdown',manualChart);host.removeEventListener('wheel',manualChart);host.replaceChildren();host.classList.remove('ji-panel');}};
}

