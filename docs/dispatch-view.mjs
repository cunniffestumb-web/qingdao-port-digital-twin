import {formatMoment} from './domain.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(type,id)=>`<button class="link" data-object="${type}" data-id="${esc(id)}">${esc(id)}</button>`;
export const policyOptions={trafficPolicy:[['segment','整段保守预约'],['staged','分段协同放行']],dispatchPolicy:[['fifo','先就绪先服务'],['edd','最早截止优先'],['empty-distance','首程空驶最短']]};
export const policyLabels={trafficPolicy:'通行方式',dispatchPolicy:'派工顺序'};
export const effectivePolicy=(config,key)=>config[key]??(key==='trafficPolicy'?'segment':'fifo');
export const policyName=(config,key)=>policyOptions[key].find(([value])=>value===effectivePolicy(config,key))?.[1]||'未知策略';
export function policyControls(config,{disabled=false}={}){
 return Object.entries(policyOptions).map(([key,options])=>`<label>${policyLabels[key]}<select name="${key}" ${disabled?'disabled':''}>${options.map(([value,label])=>`<option value="${value}" ${effectivePolicy(config,key)===value?'selected':''} ${key==='dispatchPolicy'&&value!=='fifo'&&effectivePolicy(config,'trafficPolicy')==='segment'?'disabled':''}>${label}</option>`).join('')}</select></label>`).join('');
}
export function syncPolicyControls(form){
 const traffic=form.elements.trafficPolicy,dispatch=form.elements.dispatchPolicy;if(!traffic||!dispatch)return;
 for(const option of dispatch.options)option.disabled=traffic.value==='segment'&&option.value!=='fifo';
 if(traffic.value==='segment')dispatch.value='fifo';
}
const zoneName=(state,id)=>state.traffic?.zoneLabels?.[id]||state.traffic?.zones?.find(z=>z.id===id)?.label||id;
const ids=(items,type)=>items?.length?items.map(id=>link(type,id)).join(' · '):'—';
export function ticketDetail(state,c){
 const t=c.ticket;if(!t)return '';
 const decision=t.decision||{};
 const ahead=[...new Set((t.blockers||[]).map(b=>b.containerId).filter(Boolean))],faults=[...new Set((t.blockers||[]).map(b=>b.faultId).filter(Boolean))];
 return `<section class="dispatch-detail"><div><strong>分段协同 · 顺序 ${t.seq}</strong><span>${c.phase==='awaiting-permit'?'等待下一工序放行':'已准入运输段'}</span></div><dl class="kv"><dt>已领用设备</dt><dd>${ids(t.heldResourceIds,'resource')}</dd><dt>后续待用设备</dt><dd>${ids(t.futureResourceIds,'resource')}</dd>${t.energyBudget?`<dt>本段牵引预算</dt><dd>${t.energyBudget.requiredKWh.toFixed(2)} kWh</dd><dt>剩余动力承诺</dt><dd>${t.energyBudget.remainingKWh.toFixed(2)} kWh</dd>`:''}<dt>源端排队</dt><dd>${((c.sourceWait||0)/60).toFixed(1)} 分</dd><dt>段内等许可</dt><dd>${((c.permitWait||0)/60).toFixed(1)} 分</dd>${t.awaitedZones?.length?`<dt>等待条件</dt><dd>${t.awaitedZones.map(id=>esc(zoneName(state,id))).join(' · ')}</dd>`:''}</dl>${ahead.length?`<p>排在前方：${ahead.map(id=>link('container',id)).join(' · ')}</p>`:''}${faults.length?`<p class="warn">等待 ${faults.map(id=>link('resource',id)).join(' · ')} 修复，才能领用后续设备。</p>`:''}<p class="dispatch-decision">准入依据：${esc(policyName({dispatchPolicy:decision.policy||state.config.dispatchPolicy},'dispatchPolicy'))}${decision.policy==='empty-distance'&&Number.isFinite(decision.score)?' · 首程预计空驶 '+decision.score.toFixed(1)+' m':''}${Number.isFinite(decision.due)&&decision.policy==='edd'?' · 截止 '+formatMoment(decision.due):''}。后续预约只确定顺序，不表示设备已到场。</p></section>`;
}
export function futureResourceDetail(resource){
 const pending=resource.futureTickets||[];
 if(!pending.length)return '';
 return `<section class="dispatch-detail"><strong>后续预约 · ${pending.length} 箱</strong><p>${pending.slice(0,8).map(t=>`<span>顺序 ${t.seq} ${link('container',t.containerId)}</span>`).join(' · ')}${pending.length>8?' · 其余 '+(pending.length-8)+' 箱':''}</p><p class="dispatch-decision">此列表表示计划使用顺序。当前承运箱由“当前任务”单独显示。</p></section>`;
}
export function coordinationPanel(state){
 const zones=state.traffic?.zones||[],tickets=state.containers.filter(c=>c.ticket).sort((a,b)=>a.ticket.seq-b.ticket.seq),waiting=tickets.filter(c=>c.phase==='awaiting-permit');
 return `<section class="card coordination-panel" aria-label="协同调度态势"><div class="cardhead"><div><div class="eyebrow">COORDINATED OPERATIONS</div><h2>协同调度态势</h2></div><span class="chip">${esc(policyName(state.config,'trafficPolicy'))} · ${esc(policyName(state.config,'dispatchPolicy'))}</span></div><div class="coordination-body"><p class="coordination-intro">${effectivePolicy(state.config,'trafficPolicy')==='staged'?'已腾空的作业域可接续下一箱；车辆归位和交接净空仍是放行条件。':'当前按整个运输段预留设备和通行区，可在仿真实验中对比分段放行。'}</p><div class="stat-strip"><div><strong>${zones.length}</strong><span>已取得区域许可</span></div><div><strong>${state.config.trafficPolicy==='staged'?tickets.length:state.metrics.active}</strong><span>已准入运输段</span></div><div><strong>${waiting.length}</strong><span>段内等放行</span></div></div><h3>当前区域许可</h3><div class="coordination-zones">${zones.length?zones.map(z=>`<div><strong>${esc(z.label||z.id)}</strong><span>${link('container',z.ownerJob)}</span><small>取得于 ${formatMoment(z.reservedAt)}</small></div>`).join(''):'<p class="empty">当前没有占用的通行区。</p>'}</div>${tickets.length?`<h3>运输段接续队列 <small>显示最前 ${Math.min(12,tickets.length)} / ${tickets.length} 箱</small></h3><div class="dispatch-queue">${tickets.slice(0,12).map(c=>`<article><div><span class="dispatch-seq">${c.ticket.seq}</span>${link('container',c.id)}<span class="chip ${c.blocked?'fault':c.phase==='awaiting-permit'?'waiting':'active'}">${c.blocked?'故障暂停':c.phase==='awaiting-permit'?'等许可':'执行中'}</span></div><p>${esc(c.stageLabel)} · ${esc(c.custody.label)}</p><dl><dt>已领用</dt><dd>${ids(c.ticket.heldResourceIds,'resource')}</dd><dt>后续待用</dt><dd>${ids(c.ticket.futureResourceIds,'resource')}</dd></dl></article>`).join('')}</div>`:''}<p class="coordination-footnote">区域数量包含吊机走行区；后续预约不计设备实际作业或占用时长。场景、票据和任务使用同一仿真时钟。</p></div></section>`;
}
