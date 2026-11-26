import {createSimulation,advance,snapshot,injectTask,setResourceFault,exportState,restoreState} from './engine.mjs';
import {formatTime,formatMoment} from './domain.mjs';
import {incidentRows,incidentDetail,custodyPanel,auditExport} from './incident-view.mjs';
import {createPlanView} from './plan-view.mjs';
import {createPortScene} from './scene3d.mjs';
import {hud,analysisPanel,csvRows} from './dashboard.mjs';
import {ReplayController,commandLimitForEvent} from './replay.mjs';
import {createExperimentPanel} from './experiment-view.mjs';
import {policyControls,syncPolicyControls,policyName,ticketDetail,futureResourceDetail} from './dispatch-view.mjs';
import {energyControls,syncEnergyControls,energyResourceDetail,energyModeName} from './energy-view.mjs';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',tracking:'m3 8 9-5 9 5v9l-9 5-9-5z M3 8l9 5 9-5 M12 13v9',equipment:'M3 16V7h11v9z M14 11h4l3 4v2h-7 M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',research:'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15',play:'m7 4 13 8-13 8z',pause:'M8 4v16 M16 4v16',step:'m4 5 12 7-12 7z M19 5v14',reset:'M3 10a9 9 0 1 1 1 8 M3 3v7h7',pulse:'M2 13h5l3-8 4 14 3-7h5',done:'m4 12 5 5L20 6',time:'M12 3a9 9 0 1 0 .01 0 M12 7v5l4 2'};
const ico=n=>'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="'+icons[n]+'"/></svg>';
icons.scenario='M4 7h16M4 17h16M8 4v6M16 14v6';
icons.analysis=icons.pulse;
icons.paper='M4 3h12l4 4v14H4z M15 3v5h5 M7 12h10 M7 16h6';
icons.incidents='m12 3 10 18H2z M12 9v5 M12 17h.01';
const tabs={overview:['港区全景','铁路 · 空轨 · 堆场 · 船舶'],tracking:['逐箱追踪','按箱号、运输方向与作业状态检索全程记录'],equipment:['设备监控','设备占用、空驶接驳与故障干预'],incidents:['异常追溯','从设备故障追溯直接影响、修复记录与历史现场'],analysis:['运行分析','真实事件驱动的吞吐、工期、等待与瓶颈分析'],scenario:['仿真实验','配置运输需求、设备运力与运行扰动，保存可复现实验'],paper:['论文实验','Ji · 海侧 SMV–AGV 严格双循环优化'],research:['研究依据','海铁联运场景、调度研究与仿真假设']};
const statuses={scheduled:'未释放',active:'作业中',waiting:'等待中',completed:'已完成'};
const flow=d=>d==='export'?'出口':'进口';
const associatedResources=c=>[...new Set([...(c?.participants||c?.carrierIds||[]),...(c?.reservedIds||[])])];
const resourceStatus=r=>r.status==='fault'?'故障停机':r.blocked?'联合作业暂停':r.standby?'备用轨停放':r.energy?.state==='charging'?'停车补能':r.energy?.state==='waiting-charge'?'排队候充':r.motion==='egress'?'离场归位':r.motion==='reserved'?'已预约':r.status==='busy'?'作业中':'空闲';
let sim=createSimulation({trafficPolicy:'staged',dispatchPolicy:'fifo',energyMode:'parking-contact'}),state=snapshot(sim),tab='overview',choice={type:'container',id:state.containers[0]?.id},page=0,timer=null,prewarmed=true;
const expandedHistory=new Set(),expandedReservations=new Set(),expandedCustody=new Set();
let incidentSelection=null,incidentPage=0;
let portScene=null,view3d=true,night=false,replay=null;
let lastCargoId=state.containers[0]?.id,lastResourceId=state.resources[0]?.id;
const experimentPanel=createExperimentPanel({getRecording:()=>exportState(sim),onNotice:message=>announce(message)});
let jiPanel=null,jiLoading=false;
async function mountJi(){
 if(jiPanel){jiPanel.setVisible?.(true);return;}
 if(jiLoading)return;jiLoading=true;
 $('ji-panel').innerHTML='<p class="empty" role="status">正在载入论文实验工作区…</p>';
 try{const {createJiPanel}=await import('./ji-view.mjs');jiPanel=createJiPanel($('ji-panel'));jiPanel.setVisible?.(tab==='paper');}
 catch(error){$('ji-panel').innerHTML='<div class="empty" role="alert">论文实验未能载入：'+esc(error.message)+'。<button data-open-paper>重新载入</button></div>';}
 finally{jiLoading=false;}
}
function selectObject(type,id){
 choice={type,id};if(type==='container')lastCargoId=id;else lastResourceId=id;
 if((tab==='tracking'||tab==='incidents'||tab==='analysis')&&type==='resource'){setTab('equipment');return;}
 if((tab==='equipment'||tab==='analysis'||tab==='incidents')&&type==='container'){$('query').value=id;$('status').value='';$('direction').value='';setTab('tracking');return;}
 render();
}
window.portApp={getSimulation:()=>sim,getExperimentResult:()=>experimentPanel.getResult(),getJiResult:()=>jiPanel?.getResult?.()??null,getJiSceneStats:()=>jiPanel?.getSceneStats?.()??null,getSnapshot:()=>replay?state:snapshot(sim),getLiveSnapshot:()=>snapshot(sim),isReplay:()=>!!replay,getSceneStats:()=>portScene?.getStats(),refresh:()=>{state=snapshot(sim);render();}};
$('nav').innerHTML=Object.entries(tabs).map(([k,[label]])=>'<button data-tab="'+k+'">'+ico(k)+label+'</button>').join('');
$('step').innerHTML=ico('step')+'单步';
$('step').title='推进 1 秒';
$('reset').innerHTML=ico('reset')+'重置';

const planView=createPlanView($('map'));
try{portScene=createPortScene($('scene3d'),{onSelect:({type,id})=>selectObject(type,id)});$('map').hidden=true;}catch(error){view3d=false;$('scene3d').hidden=true;$('scene-note').textContent='3D 未启用 · 已切换二维态势';console.warn('3D unavailable',error.message);}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{if(view3d)portScene?.setView(b.dataset.view);else{planView.setView(b.dataset.view);$('follow-object').setAttribute('aria-pressed','false');for(const item of document.querySelectorAll('[data-view]'))item.setAttribute('aria-pressed',item===b);}};
$('focus-object').onclick=()=>view3d?portScene?.focus(choice.type,choice.id):planView.focus(choice.type,choice.id);
$('scene3d').addEventListener('portviewchange',event=>{$('follow-object').setAttribute('aria-pressed',!!event.detail.follow);for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',b.dataset.view===event.detail.view);});
$('follow-object').onclick=()=>{const on=$('follow-object').getAttribute('aria-pressed')!=='true';if(view3d)portScene?.setFollow?.(on);else planView.setFollow(on);$('follow-object').setAttribute('aria-pressed',on);};
$('hud-toggle').onclick=()=>{const on=document.body.classList.toggle('clean-view');$('hud-toggle').setAttribute('aria-pressed',on);$('hud-toggle').textContent=on?'显示数据':'纯净视图';};
$('night').onclick=()=>{night=!night;portScene?.setNight(night);$('night').textContent=night?'日景':'夜景';};
$('view-mode').onclick=()=>{if(!portScene)return;view3d=!view3d;$('scene3d').hidden=!view3d;$('map').hidden=view3d;$('scene-note').hidden=!view3d;$('view-mode').textContent=view3d?'2D':'3D';portScene.resize();if(!view3d)planView.resize();};
function setTab(key){
 if(key==='scenario'&&replay){leaveReplay();announce('已返回最新现场，可配置实验与执行干预');}
 if(key==='paper')stop();else jiPanel?.setVisible?.(false);
 tab=key;document.body.dataset.page=key;
 for(const name of Object.keys(tabs)) $(name).hidden=name!==key;
 for(const b of $('nav').children) b.setAttribute('aria-current',b.dataset.tab===key?'page':'false');
 alignNav();
 $('title').textContent=$('crumb').textContent=tabs[key][0];
 $('deck').textContent=tabs[key][1];
 if(key==='scenario')renderScenario();
 if(key==='paper')mountJi();
 render();
 requestAnimationFrame(()=>portScene?.resize());
}
function alignNav(){
 const nav=$('nav'),current=nav.querySelector('[aria-current="page"]');
 if(!current||nav.scrollWidth<=nav.clientWidth)return;
 const a=nav.getBoundingClientRect(),b=current.getBoundingClientRect();
 nav.scrollLeft+=b.left-a.left+(b.width-a.width)/2;
}
window.addEventListener('resize',()=>requestAnimationFrame(alignNav));
function tag(v,label){return '<span class="chip '+esc(v)+'">'+esc(label)+'</span>';}
function metric(icon,label,num,unit,note,color){return '<div class="metric" style="--accent:'+color+'"><span class="label">'+label+'</span>'+ico(icon)+'<strong>'+num+'<small>'+unit+'</small></strong><span class="note">'+note+'</span></div>';}
function renderMetrics(){
 const m=state.metrics;
 $('metrics').innerHTML=metric('tracking','任务总量',m.total,'箱','已释放 '+m.released+' 箱','var(--blue)')+metric('pulse','正在作业',m.active,'箱','排队等待 '+m.waiting+' 箱','var(--teal)')+metric('done','完成转运',m.completed,'箱','累计完成 '+m.teuCompleted+' TEU','var(--purple)')+metric('equipment','设备利用率',Math.round(m.utilization*100),'%','已占用 '+state.resources.filter(r=>r.status==='busy').length+' / '+state.resources.length+' 台','var(--amber)');
}
function renderMarkers(){planView.update(state,choice);}
const kv=entries=>'<dl class="kv">'+entries.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>';
const duration=s=>s>=86400?Math.floor(s/86400)+' 天 '+Math.floor(s%86400/3600)+' 时':s>=3600?Math.floor(s/3600)+' 时 '+Math.floor(s%3600/60)+' 分':s<60?Math.floor(s)+' 秒':Math.floor(s/60)+' 分 '+Math.floor(s%60)+' 秒';
function history(c){return '<ul class="history '+(expandedHistory.has(c.id)?'expanded':'')+'">'+(expandedHistory.has(c.id)?c.history.slice():c.history.slice(-3)).reverse().map(e=>'<li><time>'+formatTime(e.time)+'</time> '+esc(e.message)+'</li>').join('')+'</ul>';}
function journey(c){return '<div class="journey-heading">全程里程碑 <b>'+c.completedStages+' / '+c.journey.length+' 环节</b></div><ol class="journey">'+c.journey.map(s=>'<li class="'+s.state+'"><i>'+(s.state==='completed'?'✓':'')+'</i><span>'+esc(s.label)+'</span><small>'+(s.state==='completed'?'已完成':s.state==='active'?'作业中':s.state==='waiting'?'等待中':'')+'</small></li>').join('')+'</ol>';}
function objButton(type,id){return '<button class="link" data-object="'+type+'" data-id="'+esc(id)+'">'+esc(id)+'</button>';}
function waitingInfo(c){
 if(c.status!=='waiting')return trafficInfo(c);
 const blockers=(c.waitingFor||[]).filter(b=>b.kind!=='TRAFFIC'||!c.pathWait).map(b=>'<div><b>'+esc(b.kind==='ENERGY'?'动力与补能':b.kind)+'</b><span>'+(b.kind==='ENERGY'?esc(b.detail||'等待足够的整程动力预算'):b.total?b.busy+' / '+b.total+' 个资源被占用':'未配置可用资源')+'</span><small>'+(b.resourceIds||[]).map(id=>state.resources.some(r=>r.id===id)?objButton('resource',id):esc(id)).join(' · ')+'</small></div>').join('');
 return trafficInfo(c)+(blockers?'<div class="waiting-info"><strong>等待资源</strong>'+(c.queuePosition?'<p>同环节队列第 '+c.queuePosition+' 位 · 共 '+c.queueLength+' 箱</p>':'')+blockers+'</div>':'');
}
function trafficInfo(c){
 const wait=c.pathWait;if(!wait)return '';
 const names={zone:'等待通道放行',dock:'等待交接泊位',unreachable:'当前没有可通行路线',coverage:'等待可达作业设备'};
 const owners=[...new Set(wait.owners||[])].filter(Boolean).map(id=>state.containers.some(x=>x.id===id)?objButton('container',id):esc(id));
 return '<div class="waiting-info traffic-info"><strong>'+esc(names[wait.kind]||'等待通行条件')+'</strong><p>'+esc((wait.ids||[]).join(' · ')||'通行区域未释放')+'</p>'+(owners.length?'<div><b>当前占用</b><small>'+owners.join(' · ')+'</small></div>':'')+'</div>';
}
function detail(){
 const cargo=choice.type==='container';
 const o=(cargo?state.containers:state.resources).find(obj=>obj.id===choice.id);
 if(!o)return '<p class="empty">选择箱号或设备以查看作业详情。</p>';
 if(!cargo)return '<div class="detail"><h3>'+esc(o.id)+'</h3>'+tag('',o.kind)+' '+tag(o.status==='fault'?'fault':o.status==='busy'?'active':'',resourceStatus(o))+kv([['当前任务',o.containerId?objButton('container',o.containerId):o.standby?'备用 · 不参与本堆区派工':'待分配'],['完成作业',o.completed+' 次'],['实际作业',duration(o.busyTime)],['仅预约时间',duration(o.reservedTime||0)],...(o.standby?[['配置说明',esc(o.standbyReason||'单堆区可用走行范围有限，该设备停放于独立备用轨')]]:[]),['停车位置',esc(o.parkingId||'—')],['当前路段',esc(o.route?.currentEdge||'—')],['本程剩余',Number.isFinite(o.route?.remainingM)?Math.round(o.route.remainingM)+' m':'—'],['运动状态',o.blocked?'已冻结 · 等待联合设备修复':o.motion==='egress'?'驶离作业位 · 返回停车位':o.motion==='reposition'?'空驶到场':o.motion==='reserved'?'已预约 · 待联合交接':o.motion==='service'?'执行作业':'静止']])+futureResourceDetail(o)+energyResourceDetail(o)+'<div class="detail-actions"><button data-locate="resource" data-id="'+esc(o.id)+'">三维定位</button><button class="'+(o.status==='fault'?'primary':'danger-button')+'" '+(replay?'disabled title="历史回看为只读"':'')+' data-fault="'+esc(o.id)+'" data-failed="'+(o.status!=='fault')+'">'+(o.status==='fault'?'修复设备':'注入故障')+'</button></div></div>';
 const percent=Math.round(o.progress*100);
 return '<div class="detail"><h3>'+esc(o.id)+'</h3>'+tag(o.direction,flow(o.direction))+' '+tag(o.status,statuses[o.status])+' '+tag('',o.type)+kv([['运输路径',esc(o.origin)+' → '+esc(o.destination)],['当前环节',esc(o.stageLabel)],['作业阶段',esc(o.action||(o.phase==='preparing'?'车辆空驶接驳':o.phase==='service'?'执行装卸 / 运输':statuses[o.status]))],['当前承载',esc(o.custody?.label||o.custody?.id||'—')],['截止时刻',formatTime(o.due)],['任务优先级',esc(o.priority)],['承运设备',o.carrierIds.map(id=>objButton('resource',id)).join(' / ')||'—'],['累计排队等待',duration(o.wait)],...(o.permitIds?.length?[['已取得区域许可',o.permitIds.length+' 处']]:[])])+(o.reservedIds?.length?'<details class="reservation-detail" data-reservation="'+esc(o.id)+'" '+(expandedReservations.has(o.id)?'open':'')+'><summary data-reserve-toggle="'+esc(o.id)+'">已领用待协同 · '+o.reservedIds.length+' 台 / 位</summary><div>'+o.reservedIds.map(id=>objButton('resource',id)).join(' · ')+(o.targetSlot?'<p>目的堆位：'+esc(o.targetSlot)+'</p>':'')+'</div></details>':'')+'<div class="detail-actions"><button data-locate="container" data-id="'+esc(o.id)+'">三维定位</button></div><small>本环节进度 · '+percent+'%</small><div class="progress"><i style="width:'+percent+'%"></i></div>'+(o.blocked?'<div class="waiting-info"><strong>联合作业暂停</strong><p>等待 '+associatedResources(o).filter(id=>state.resources.some(r=>r.id===id&&r.status==='fault')).map(id=>objButton('resource',id)).join('、')+' 修复</p></div>':'')+waitingInfo(o)+ticketDetail(state,o)+custodyPanel(state,o.id,expandedCustody.has(o.id))+journey(o)+'<div class="history-head"><small>作业记录 · '+o.history.length+' 条</small><button class="link" data-history="'+esc(o.id)+'">'+(expandedHistory.has(o.id)?'收起':'查看全部')+'</button></div>'+(o.history.length?history(o):'<p class="muted">等待任务释放</p>')+'</div>';
}
function renderOverview(){
 renderMetrics();renderMarkers();portScene?.update(state,choice);if(portScene)$('scene-note').textContent=portScene.getStats().renderProfile==='compatibility'?'兼容画质 · 拖动旋转 · 可切换二维态势':'拖动旋转 · 滚轮缩放 · 点击设备 / 集装箱查看详情';$('ops-left').innerHTML=hud(state);
 $('inspector').innerHTML='<div class="cardhead"><div><div class="eyebrow">OBJECT INSPECTOR</div><h2>'+(choice.type==='resource'?'设备详情':'单箱详情')+'</h2></div>'+ico(choice.type==='resource'?'equipment':'tracking')+'</div>'+detail();
 $('eventcount').textContent='最近 '+Math.min(6,state.events.length)+' 条';
 $('events').innerHTML=state.events.slice(-6).reverse().map(e=>'<div class="event"><time>'+formatTime(e.time)+'</time><i></i><span>'+(e.containerId?objButton('container',e.containerId):e.resourceId?objButton('resource',e.resourceId):'系统')+' · '+esc(e.message)+'</span></div>').join('')||'<div class="empty">仿真推进后，作业事件将在这里显示。</div>';
}
function renderTracking(){
 const q=$('query').value.trim().toUpperCase(),dir=$('direction').value,status=$('status').value;
 const list=state.containers.filter(c=>c.id.toUpperCase().includes(q)&&(!dir||c.direction===dir)&&(!status||c.status===status));
 if(list.length && (choice.type!=='container'||!list.some(c=>c.id===choice.id))){choice={type:'container',id:list.find(c=>c.id===lastCargoId)?.id||list[0].id};lastCargoId=choice.id;}
 const pages=Math.ceil(list.length/10);
 page=Math.max(0,Math.min(page,pages-1));
 $('result').textContent=list.length+' 箱';
 $('rows').innerHTML=list.slice(page*10,page*10+10).map(c=>'<tr data-object="container" data-id="'+esc(c.id)+'" class="'+(choice.id===c.id?'selected':'')+'"><td>'+objButton('container',c.id)+'</td><td>'+tag(c.direction,flow(c.direction))+'</td><td>'+esc(c.type)+'</td><td>'+esc(c.stageLabel)+'</td><td>'+tag(c.status,statuses[c.status])+'</td><td>'+esc(c.carrierIds.join(' / ')||'—')+'</td></tr>').join('')||'<tr><td colspan="6" class="empty">没有符合条件的箱号，请调整搜索或筛选条件。</td></tr>';
 $('page').textContent=(pages?page+1:0)+' / '+pages;$('prev').disabled=page===0;$('next').disabled=page+1>=pages;
 $('trackdetail').innerHTML=list.length?detail():'<p class="empty">没有匹配的集装箱。调整筛选条件后显示详情。</p>';
}
function renderEquipment(){
 $('fleetcount').textContent=state.resources.length+' 台设备';
 $('fleet').innerHTML=state.resources.map(r=>'<button data-object="resource" data-id="'+esc(r.id)+'" class="'+(choice.id===r.id?'selected':'')+'"><b class="mono">'+esc(r.id)+'</b><small>'+esc(r.kind)+' · '+resourceStatus(r)+'</small></button>').join('');
 $('fleetdetail').innerHTML=detail();
}
function renderIncidents(){
 const result=incidentRows(state,{query:$('incident-query').value,status:$('incident-status').value,selected:incidentSelection,page:incidentPage});
 incidentSelection=result.episode?.id||null;incidentPage=result.page;
 $('incident-summary').innerHTML=result.summary;$('incident-rows').innerHTML=result.rows;
 $('incident-detail').innerHTML=incidentDetail(result.episode,state);
 $('incident-count').textContent=result.count+' 条记录';$('incident-page').textContent=(result.pages?result.page+1:0)+' / '+result.pages;
 $('incident-prev').disabled=result.page===0;$('incident-next').disabled=result.page+1>=result.pages;
 $('operation-notices').innerHTML=result.notices;
}
function sourceInfo(){
 const stats=portScene?.getStats(),renderTime=stats?.renderedSnapshotTime;
 const visual=tab!=='overview'?'当前未显示三维场景':!view3d?'二维态势 · '+formatMoment(state.time):Number.isFinite(renderTime)?formatMoment(renderTime)+(Math.abs(renderTime-state.time)<1e-8?' · 与快照一致':' · 等待画面更新'):'等待首帧';
 $('source-details').innerHTML=kv([['数据来源','本地合成仿真'],['运行模式',replay?'历史回看 · 只读':timer!==null?'仿真正在推进':'仿真已暂停'],['快照时刻',formatMoment(state.time)],['相对仿真秒',state.time+' s'],...(replay?[['回看边界',replay.context?.eventId?'事件 #'+replay.context.eventId+' 之后':'该时刻全部干预之后']]:[]),['当前画面',visual],['画质模式',stats?.renderProfile==='compatibility'?'兼容画质 · 简化材质与装饰':'精细画质'],['现场采集连接','未接入'],['现场采样时延','— · 未接入遥测'],['调度模型','版本 '+(state.modelVersion||3)],['场景布局','版本 '+state.layoutVersion],['通行方式',policyName(state.config,'trafficPolicy')],['派工顺序',policyName(state.config,'dispatchPolicy')],['能源模式',energyModeName(state.config.energyMode)],['任务随机种子',state.config.seed]])+'<p>暂停时仿真时钟停止；历史回看重建已有实验记录。此处的同步状态只描述本地模型与画面。</p>';
}
function render(){
 const focused=document.activeElement;
 const focusScope=focused?.closest('#markers,#rows,#fleet,#analysis-content,#inspector,#trackdetail,#fleetdetail,#incident-rows,#incident-detail')?.id;
 const focusAttribute=['data-object','data-history','data-fault','data-locate','data-reserve-toggle','data-incident','data-incident-replay','data-audit-export'].find(name=>focused?.hasAttribute(name));
 const focusSelector=focusAttribute?'['+focusAttribute+'="'+CSS.escape(focused.getAttribute(focusAttribute))+'"]'+(focused.hasAttribute('data-id')?'[data-id="'+CSS.escape(focused.dataset.id)+'"]':''):null;
 $('clock').textContent=formatTime(state.time);
 $('clock-context').textContent=(replay?'历史回看 · ':prewarmed?'含初始预演 · ':'已运行 · ')+duration(state.time);
 $('clock').title='仿真时间，非真实港口时钟';
 $('runflag').classList.toggle('running',timer!==null);
 $('runflag').textContent=replay?'历史回看 · 只读':timer!==null?'仿真运行中':'仿真已暂停';
 $('run').innerHTML=timer!==null?ico('pause')+'暂停':ico('play')+'运行';
 $('step').disabled=timer!==null||!!replay;$('run').disabled=!!replay;$('reset').disabled=!!replay;$('replay-open').disabled=!!replay;
 if(replay)$('replay-at').textContent=formatMoment(state.time)+' / '+formatMoment(replay.recording.time);
 if(tab==='overview')renderOverview();
 if(tab==='tracking')renderTracking();
 if(tab==='equipment')renderEquipment();
 if(tab==='incidents')renderIncidents();
 if($('source-dialog').open)sourceInfo();
 if(tab==='analysis')$('analysis-content').innerHTML=analysisPanel(state);
 if(focusScope&&focusSelector)$(focusScope)?.querySelector(focusSelector)?.focus({preventScroll:true});
}
function tick(seconds){advance(sim,seconds);state=snapshot(sim);render();}
function stop(){if(timer!==null)clearInterval(timer);timer=null;}
$('run').onclick=()=>{
 if(timer!==null)stop();
 else {let previous=performance.now(),ui=0;timer=setInterval(()=>{const now=performance.now(),elapsed=(now-previous)/1000;previous=now;advance(sim,elapsed*Number($('speed').value));state=snapshot(sim);portScene?.update(state,choice);if(now-ui>250){ui=now;render();}},100);}
 render();
};
$('step').onclick=()=>tick(1);
$('reset').title='从 08:00 重新开始相同场景';
$('reset').onclick=()=>{stop();prewarmed=false;sim=createSimulation(state.config);state=snapshot(sim);choice={type:'container',id:state.containers[0]?.id};page=0;render();};
$('prev').onclick=()=>{page--;renderTracking();};
$('next').onclick=()=>{page++;renderTracking();};
for(const id of ['query','direction','status']) $(id).addEventListener('input',()=>{page=0;renderTracking();});
document.addEventListener('click',e=>{
 if(e.target.closest('[data-open-paper]')){setTab('paper');return;}
 const disclosure=e.target.closest('summary'),box=disclosure?.parentElement;
 if(box?.matches('[data-custody],[data-reservation]')){e.preventDefault();box.open=!box.open;const set=box.hasAttribute('data-custody')?expandedCustody:expandedReservations,id=box.dataset.custody||box.dataset.reservation;box.open?set.add(id):set.delete(id);return;}
 const episode=e.target.closest('[data-incident]');if(episode){incidentSelection=episode.dataset.incident;render();return;}
 const incidentReplay=e.target.closest('[data-incident-replay]');if(incidentReplay){
  const report=incidentRows(state).report,record=report.episodes.find(v=>v.resourceId===incidentReplay.dataset.id&&v.occurredAt===Number(incidentReplay.dataset.incidentReplay)&&v.id===incidentSelection);
  if(!record)return;const recording=replay?.recording||exportState(sim),commandLimit=commandLimitForEvent(recording,state.events,record.faultEventId);
  if(commandLimit===null){announce('未找到这条故障的干预边界，无法精确重建');return;}
  choice={type:'resource',id:record.resourceId};lastResourceId=choice.id;setTab('overview');enterReplay(record.occurredAt,{commandLimit,eventId:record.faultEventId});return;
 }
 const custodyReplay=e.target.closest('[data-custody-replay]');if(custodyReplay){choice={type:'container',id:custodyReplay.dataset.id};lastCargoId=choice.id;setTab('overview');enterReplay(Number(custodyReplay.dataset.custodyReplay));return;}
 const audit=e.target.closest('[data-audit-export]');if(audit){try{download(audit.dataset.auditExport+'.json',JSON.stringify(auditExport(state,audit.dataset.auditExport,{historical:!!replay,boundary:replay?.context?.eventId?{kind:'after-intervention',...replay.context}:null}),null,2),'application/json');announce('故障追溯记录已导出');}catch(error){announce(error.message);}return;}
 const fault=e.target.closest('[data-fault]');if(fault){
  if(replay){announce('历史回看为只读，请返回最新现场后干预');return;}
  const failed=fault.dataset.failed==='true',before=snapshot(sim),beforeResource=before.resources.find(r=>r.id===fault.dataset.fault),beforeJob=before.containers.find(c=>c.id===beforeResource?.containerId);
  setResourceFault(sim,fault.dataset.fault,failed);state=snapshot(sim);const resource=state.resources.find(r=>r.id===fault.dataset.fault),job=state.containers.find(c=>c.id===beforeJob?.id),others=associatedResources(job).filter(id=>state.resources.some(r=>r.id===id&&r.status==='fault'));
  announce(resource.id+(failed?' 已停机'+(job?'，'+job.id+' 作业已冻结':'，暂停接收新任务'):' 已修复'+(job?.blocked?'，'+job.id+' 仍等待 '+others.join('、')+' 修复':beforeJob?.blocked&&job?'，'+job.id+' 故障联停解除'+(job.phase==='awaiting-permit'?'，仍等待通行许可':''):resource.containerId&&!beforeJob?'，已接收新任务 '+resource.containerId:'')));render();return;
 }
 const contact=e.target.closest('[data-charge-contact]');if(contact){selectObject('resource',contact.dataset.chargeContact);setTab('overview');if(portScene){if(!view3d)$('view-mode').click();portScene.focus('chargeContact',contact.dataset.chargeContact);}else{planView.focus('resource',contact.dataset.chargeContact);announce('当前使用二维态势，可查看设备停车位置');}return;}
 const locate=e.target.closest('[data-locate]');if(locate){selectObject(locate.dataset.locate,locate.dataset.id);setTab('overview');if(view3d)portScene?.focus(choice.type,choice.id);else planView.focus(choice.type,choice.id);return;}
 const historyButton=e.target.closest('[data-history]');
 if(historyButton){const id=historyButton.dataset.history;expandedHistory.has(id)?expandedHistory.delete(id):expandedHistory.add(id);render();return;}
 const nav=e.target.closest('#nav [data-tab]');
 if(nav){
  if(nav.dataset.tab==='equipment')choice={type:'resource',id:lastResourceId||state.resources[0]?.id};
  if(nav.dataset.tab==='tracking')choice={type:'container',id:lastCargoId||state.containers[0]?.id};
  setTab(nav.dataset.tab);return;
 }
 const obj=e.target.closest('[data-object]');
 if(obj){selectObject(obj.dataset.object,obj.dataset.id);}
});
$('map').addEventListener('keydown',e=>{
 if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-object]')){
  e.preventDefault();const id=e.target.closest('[data-object]').dataset.id;
  e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  Array.from($('markers').children).find(el=>el.dataset.id===id)?.focus();
 }
});
advance(sim,600);
state=snapshot(sim);
choice={type:'container',id:state.containers.find(c=>c.status==='active')?.id||state.containers[0]?.id};
setTab('overview');

function announce(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(announce.timeout);announce.timeout=setTimeout(()=>{$('notice').hidden=true;},6000);}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function loadSimulation(next){incidentSelection=null;incidentPage=0;if(replay)leaveReplay();stop();sim=next;state=snapshot(sim);prewarmed=false;choice={type:'container',id:state.containers[0]?.id};lastCargoId=choice.id;lastResourceId=state.resources[0]?.id;page=0;$('query').value='';$('status').value='';$('direction').value='';portScene?.update(state,choice);render();}
function renderScenario(){
 const fields=[['seed','随机种子',0,4294967295],['count','初始任务 / 箱',0,2000],['et','陆侧集卡 ET',0,64],['smv','悬挂单轨 SMV',0,64],['agv','自动导引车 AGV',0,64],['rmg','铁路吊 RMG',0,64],['bay','海侧交接位 BAY',0,64],['yc','堆场桥 YC',0,64],['qc','岸桥 QC',0,64],['yardCapacity','每方向堆位 / 箱',0,64]];
 $('scenario-content').innerHTML='<div class="lab-grid"><form id="config-form" class="lab-card"><h3>配置新实验</h3><p class="muted">相同种子和配置可重现相同任务。应用后从 08:00 开始新实验。</p><p class="muted">当前单堆区最多 3 台场桥参与作业；额外场桥在备用轨停放。可对比整段预约与分段放行；派工规则仅影响后续准入。实验吞吐来自合成模型。</p><div class="form-grid">'+fields.map(([id,label,min,max])=>'<label>'+label+'<input name="'+id+'" type="number" required min="'+min+'" max="'+max+'" step="1" value="'+(state.config[id]??8)+'"></label>').join('')+policyControls(state.config)+'</div>'+energyControls(state.config)+'<button type="submit" class="primary">应用配置并重置</button></form><div><form id="inject-form" class="lab-card"><h3>临时插入运输任务</h3><p class="muted">任务在当前仿真时刻释放，设备占用与排队按同一规则处理。</p><div class="form-grid"><label>运输方向<select name="direction"><option value="export">出口 · 铁路 → 船舶</option><option value="import">进口 · 船舶 → 铁路</option></select></label><label>箱型<select name="type"><option>40HQ</option><option>20GP</option><option>冷藏箱</option></select></label><label>优先级<select name="priority"><option>普通</option><option>加急</option></select></label><label>距截止 / 分钟<input name="dueIn" type="number" min="0" max="1000000" value="120" required></label></div><button type="submit" class="primary">插入任务</button></form><section class="lab-card"><h3>保存与恢复实验</h3><p class="muted">保存随机种子、当前仿真时刻与插单、故障干预记录，可恢复相同现场。</p><div class="detail-actions"><button id="save-state">保存实验 JSON</button><label class="file-button">恢复实验<input id="load-state" type="file" accept=".json,application/json"></label><button id="export-csv">导出箱台账 CSV</button></div><p class="muted">设备故障可在“设备监控”中注入与修复。</p></section></div></div>';
 $('scenario-content').insertAdjacentHTML('beforeend','<div id="experiment-panel"></div>');experimentPanel.mount($('experiment-panel'));
 syncEnergyControls($('config-form'));syncPolicyControls($('config-form'));
 $('config-form').onchange=()=>{syncEnergyControls($('config-form'));syncPolicyControls($('config-form'));};
 $('config-form').onsubmit=e=>{e.preventDefault();const config=Object.fromEntries([...new FormData(e.currentTarget)].map(([k,v])=>[k,['trafficPolicy','dispatchPolicy','energyMode'].includes(k)?v:Number(v)]));try{loadSimulation(createSimulation(config));announce('新实验已就绪 · '+config.count+' 箱 · 种子 '+config.seed);}catch(error){announce('配置未应用：'+error.message);}};
 $('inject-form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));data.dueIn=Number(data.dueIn)*60;try{const id=injectTask(sim,data);state=snapshot(sim);choice={type:'container',id};lastCargoId=id;announce('任务 '+id+' 已插入当前实验');render();}catch(error){announce('任务未插入：'+error.message);}};
 $('save-state').onclick=()=>{download('port-sim-'+Math.floor(state.time)+'.json',JSON.stringify(exportState(sim),null,2),'application/json');announce('实验文件已生成');};
 $('export-csv').onclick=()=>download('container-register.csv',csvRows(state),'text/csv;charset=utf-8');
 $('load-state').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>5e6)throw Error('文件超过 5 MB');const restored=restoreState(await file.text());loadSimulation(restored);renderScenario();announce('实验已恢复至 '+formatTime(state.time));}catch(error){announce('恢复失败：'+error.message);}finally{e.target.value='';}};
}

function enterReplay(targetTime=null,context={}){
 if(!replay){stop();const recording=exportState(sim);replay={recording,controller:null,context:null};
  $('replay-time').max=recording.time;$('replay-time').value=recording.time;
  $('replay-panel').hidden=false;document.body.classList.add('is-replay');
  replay.controller=new ReplayController(recording,{onState:preview=>{if(!replay)return;state=preview;$('replay-status').textContent='已重建 '+formatMoment(state.time)+(replay.context?.eventId?' · 事件 #'+replay.context.eventId+' 之后；同刻后续干预尚未执行':' · 该时刻全部干预后的状态');render();portScene?.update(state,choice);},onError:message=>{if(replay){$('replay-status').textContent='回看失败：'+message;announce('回看失败：'+message);}}});
  state=snapshot(sim);
 }
 if(Number.isFinite(targetTime))seekReplay(targetTime,context);else $('replay-status').textContent='按原实验记录重建状态，回看不会修改现场。';
 render();
}
function seekReplay(time,context={}){
 if(!replay)return;replay.context=context;$('replay-time').value=time;$('replay-status').textContent='正在重建 '+formatMoment(time)+' 的现场…';replay.controller.seek(time,context.commandLimit);
}
function leaveReplay(){
 if(!replay)return;replay.controller?.dispose();replay=null;state=snapshot(sim);
 $('replay-panel').hidden=true;document.body.classList.remove('is-replay');render();portScene?.update(state,choice);
}
$('replay-open').onclick=()=>enterReplay();
$('return-live').onclick=leaveReplay;
$('replay-time').oninput=e=>seekReplay(Number(e.target.value));
$('source-open').onclick=()=>{sourceInfo();$('source-dialog').showModal();};
$('source-close').onclick=()=>$('source-dialog').close();
for(const id of ['incident-query','incident-status'])$(id).addEventListener('input',()=>{incidentSelection=null;incidentPage=0;renderIncidents();});
$('incident-prev').onclick=()=>{incidentPage--;incidentSelection=null;renderIncidents();};
$('incident-next').onclick=()=>{incidentPage++;incidentSelection=null;renderIncidents();};
$('incident-help').onclick=()=>{choice={type:'resource',id:lastResourceId||state.resources[0]?.id};setTab('equipment');};

document.addEventListener('toggle',event=>{const node=event.target;if(!node.isConnected||!node.matches?.('[data-reservation]'))return;node.open?expandedReservations.add(node.dataset.reservation):expandedReservations.delete(node.dataset.reservation);},true);

document.addEventListener('toggle',event=>{const node=event.target;if(!node.isConnected||!node.matches?.('[data-custody]'))return;node.open?expandedCustody.add(node.dataset.custody):expandedCustody.delete(node.dataset.custody);},true);
