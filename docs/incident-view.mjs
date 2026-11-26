import {deriveIncidentReport,deriveCustodyAudit} from './incidents.mjs';
import {formatMoment} from './domain.mjs';
import {activityZones} from './layout.mjs';
const kinds={ET:'陆侧集卡',AGV:'自动导引车',SMV:'悬挂单轨',RMG:'铁路吊',QC:'岸桥',YC:'堆场桥',BAY:'交接位',YARD:'堆位',TRAFFIC:'通道与泊位',COVERAGE:'设备可达范围',DISPATCH:'任务派工',ENERGY:'动力与补能'};

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const object=(type,id)=>id?`<button class="link" data-object="${type}" data-id="${esc(id)}">${esc(id)}</button>`:'—';
const span=n=>n<60?`${Number(n.toFixed(3))} 秒`:`${Math.floor(n/60)} 分 ${Number((n%60).toFixed(3))} 秒`;
const moment=n=>n===null||n===undefined?'—':formatMoment(n);
const keyval=rows=>'<dl class="kv">'+rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')+'</dl>';
export function incidentRows(state,{query='',status='',selected=null,page=0}={}){
 const report=deriveIncidentReport(state),needle=query.trim().toUpperCase();
 const filtered=report.episodes.filter(e=>(!status||e.status===status)&&(!needle||[e.id,e.resourceId,e.containerId].some(v=>String(v??'').toUpperCase().includes(needle))));
 const pages=Math.ceil(filtered.length/8);page=Math.max(0,Math.min(page,pages-1));
 let episode=filtered.find(e=>e.id===selected)||filtered[page*8]||null;
 if(episode)page=Math.floor(filtered.indexOf(episode)/8);
 const rows=filtered.slice(page*8,page*8+8).map(e=>`<tr class="${e.id===episode?.id?'selected':''}"><td><button class="link" data-incident="${esc(e.id)}" aria-pressed="${e.id===episode?.id}">${esc(e.resourceId)}</button><small class="row-sub">${esc(e.id)}</small></td><td class="time-cell" data-label="发生时刻">${moment(e.occurredAt)}</td><td><span class="chip ${e.status==='open'?'fault':'completed'}">${e.status==='open'?'故障中':'已修复'}</span></td><td data-label="直接影响">${e.containerId?esc(e.containerId):'无直接任务'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">'+(report.episodes.length?'没有匹配的故障记录。':'当前没有设备故障记录。可在设备监控中注入故障，观察系统响应。')+'</td></tr>';
 const affected=new Set(report.episodes.filter(e=>e.status==='open').map(e=>e.containerId).filter(Boolean));
 const summary=`<div class="incident-stat"><span>故障中</span><strong class="${report.openCount?'danger':''}">${report.openCount}</strong><small>当前未修复设备</small></div><div class="incident-stat"><span>已修复记录</span><strong>${report.resolvedCount}</strong><small>保留每次故障与修复</small></div><div class="incident-stat"><span>直接受影响任务</span><strong>${affected.size}</strong><small>按当前故障关联箱去重</small></div>`;
 const notices=report.notices.map(n=>`<div class="operation-notice"><strong>${n.kind==='zero-capacity'?'配置运力不足':'运行等待'}</strong><span>${esc(kinds[n.resourceKind]||n.resourceKind||n.kind)} · ${n.count??n.containerIds?.length??0} 箱</span><div>${(n.containerIds||[]).slice(0,6).map(id=>object('container',id)).join(' · ')}${(n.containerIds?.length||0)>6?' …':''}</div></div>`).join('')||'<p class="empty">当前没有容量或通行等待提示。</p>';
 return {report,episode,page,pages,count:filtered.length,rows,summary,notices};
}
export function incidentDetail(episode,state){
 if(!episode)return '<div class="empty">选择一条故障记录，查看影响范围和发生时刻。</div>';
 const e=episode,stillBlocked=e.currentBlockerIds?.length>0;
 const explain=e.status==='open'?'设备故障尚未修复。':stillBlocked?'该设备已修复，关联任务仍因其他设备故障暂停。':e.containerId&&e.workResumedAt!==null&&e.workResumedAt!==undefined?'本次故障联停已解除；后续动作仍需满足通行条件。':e.containerId?'该设备已修复；故障联停解除时刻尚无记录。':'故障发生时没有直接承运任务。';
 return `<div class="detail incident-detail"><div class="eyebrow">FAULT TRACE · ${esc(e.id)}</div><h3>${esc(e.resourceId)}</h3><span class="chip ${e.status==='open'?'fault':'completed'}">${e.status==='open'?'故障中':'设备已修复'}</span><p class="incident-explain">${explain}</p>${keyval([['故障发生',moment(e.occurredAt)],['相对仿真秒',String(e.occurredAt)+' s'],['设备修复',moment(e.repairedAt)],['故障持续',span(e.duration)],['故障联停解除',moment(e.workResumedAt)],['直接影响箱',object('container',e.containerId)],['故障时伙伴',(e.partnerIds||[]).map(id=>object('resource',id)).join(' · ')||'无直接联合任务'],['故障时持有通道',(e.heldZoneIds||[]).map(id=>esc(state.traffic?.zoneLabels?.[id]||activityZones[id]||id)).join(' · ')||'无记录'],['本次联停待修复',(e.currentBlockerIds||[]).map(id=>object('resource',id)).join(' · ')||'—']])}<div class="detail-actions"><button class="primary" data-incident-replay="${e.occurredAt}" data-id="${esc(e.resourceId)}">回看发生时刻</button><button data-locate="resource" data-id="${esc(e.resourceId)}">定位设备</button><button data-audit-export="${esc(e.id)}">导出该条记录</button></div><p class="hud-caption">仅列出可由事件确认的直接影响。正常排队单列为运行提示，未推算间接损失。</p><div class="evidence-refs"><b>事件证据</b>${state.events.filter(v=>v.id===e.faultEventId||v.id===e.repairEventId).map(v=>`<div><time>${moment(v.time)}</time><span>#${v.id} · ${esc(v.message)}</span></div>`).join('')}</div></div>`;
}
export function custodyPanel(state,id,open=false){
 const audit=deriveCustodyAudit(state,id);if(!audit)return '';
 const holder=h=>h?.label||h?.id||'未记录';
 return `<details class="custody-audit" data-custody="${esc(id)}" ${open?'open':''}><summary>承载交接记录 · ${audit.transfers.length} 次</summary><p>起始承载：${esc(holder(audit.initialHolder))}</p><ol>${audit.transfers.map(t=>`<li><time>${moment(t.time)}</time><span>${esc(holder(t.from))} <b>→</b> ${esc(holder(t.to))}</span><button class="link" data-custody-replay="${t.time}" data-id="${esc(id)}">回看 #${t.eventId}</button></li>`).join('')||'<li>尚未发生承载交接。</li>'}</ol><p>当前承载：<strong>${esc(holder(audit.currentHolder))}</strong></p><small>记录仿真中的托管转移；现场传感器确认尚未接入。</small></details>`;
}
export function auditExport(state,id,{historical=false,boundary=null}={}){
 const report=deriveIncidentReport(state),episode=report.episodes.find(e=>e.id===id);
 if(!episode)throw new Error('当前快照中没有这条故障记录');
 return {format:'port-incident-audit',version:1,source:'synthetic-simulation',modelVersion:state.modelVersion||3,layoutVersion:state.layoutVersion,timeSemantics:{workResumedAt:'故障造成的联合冻结解除时刻，不表示车辆已移动或已取得下一许可'},config:{...state.config},asOf:state.time,historical,boundary:historical?(boundary||{kind:'time-final'}):null,episode,custody:episode.containerId?deriveCustodyAudit(state,episode.containerId):null,events:state.events.filter(e=>e.id===episode.faultEventId||e.id===episode.repairEventId||e.containerId&&e.containerId===episode.containerId)};
}
