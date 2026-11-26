import {energyDefaults,energyRanges} from './energy-config.mjs';
import {formatMoment} from './domain.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const link=id=>`<button class="link" data-object="resource" data-id="${esc(id)}">${esc(id)}</button>`;
export const energyFields=[['batteryKWh','每车电池容量','kWh'],['initialSocPct','初始电量','%'],['reserveSocPct','保底电量','%'],['targetSocPct','常规补能目标','%'],['emptyKWhPerKm','空驶牵引耗能','kWh/km'],['loadedKWhPerKm','载箱牵引耗能','kWh/km'],['chargeKW','每回路输入功率','kW'],['chargeEfficiency','电网至电池效率','0–1'],['westCircuits','西侧供电回路','条'],['eastCircuits','东侧供电回路','条']];
export const energyKeys=['energyMode',...energyFields.map(([key])=>key)];
export const effectiveEnergy=(config,key)=>config[key]??(key==='energyMode'?'off':energyDefaults[key]);
export const energyModeName=mode=>mode==='parking-contact'?'停车接触补能':'关闭能源约束';
export const energyStateName=state=>({'parked':'停车待命','committed':'运输承诺中','waiting-charge':'排队候充','charging':'正在补能','fault':'故障停机'}[state]||'未启用');
export function energyControls(config,{disabled=false}={}){
 const enabled=effectiveEnergy(config,'energyMode')==='parking-contact';
 return `<fieldset class="energy-config"><legend>AGV 能源约束</legend><label>运行方式<select name="energyMode" ${disabled?'disabled':''}><option value="off" ${!enabled?'selected':''}>关闭能源约束</option><option value="parking-contact" ${enabled?'selected':''}>停车接触补能 · 分段调度</option></select></label><p>按实际路线预留整程动力，车辆归位后共享有限供电回路。此模式采用合成停车位与参数。</p><details class="energy-parameters" ${!enabled?'hidden':''}><summary>电池与供电参数 <span>合成训练值</span></summary><div class="form-grid">${energyFields.map(([key,label,unit])=>`<label>${label}<span>${unit}</span><input type="number" name="${key}" min="${energyRanges[key].min}" max="${energyRanges[key].max}" step="${energyRanges[key].integer?1:'any'}" required value="${effectiveEnergy(config,key)}" ${disabled?'disabled':''}></label>`).join('')}</div><p>保底须低于目标；满电也不足以完成整程时，任务会明确等待。静止、原地转向与故障持位的辅助耗电设为 0，未建模电池磨损、温度或电价。</p></details></fieldset>`;
}
export function syncEnergyControls(form){
 const mode=form.elements.energyMode;if(!mode)return;
 const enabled=mode.value==='parking-contact',traffic=form.elements.trafficPolicy;
 if(traffic){if(enabled)traffic.value='staged';const segment=[...traffic.options].find(o=>o.value==='segment');if(segment)segment.disabled=enabled;}
 const details=form.querySelector('.energy-parameters');if(details)details.hidden=!enabled;
}
export function energyBaseline(config){
 const mode=effectiveEnergy(config,'energyMode');
 return `<details class="energy-baseline"><summary>能源配置 · ${energyModeName(mode)}</summary>${mode==='parking-contact'?`<dl>${energyFields.map(([key,label,unit])=>`<div><dt>${label}</dt><dd>${n(effectiveEnergy(config,key))} ${unit}</dd></div>`).join('')}</dl>`:'<p>此组不计算动力预算、SOC 或充电台账。</p>'}</details>`;
}
export function energyResourceDetail(resource){
 const e=resource.energy;if(!e||resource.soc===null||resource.soc===undefined)return '';
 const pct=Math.max(0,Math.min(100,resource.soc));
 return `<section class="energy-detail"><div class="energy-detail-head"><strong>动力与补能</strong><span class="chip ${e.state==='charging'?'completed':e.state==='waiting-charge'?'waiting':''}">${energyStateName(e.state)}</span></div><div class="soc-number">${n(pct)}<small>%</small></div><progress value="${pct}" max="100" aria-label="${esc(resource.id)} 剩余电量 ${n(pct)}%"></progress><dl class="kv"><dt>当前存量</dt><dd>${n(e.storedKWh)} / ${n(e.capacityKWh)} kWh</dd><dt>尚未兑现承诺</dt><dd>${n(e.committedKWh)} kWh</dd><dt>可再承诺电量</dt><dd>${n(e.availableKWh)} kWh</dd><dt>累计牵引耗能</dt><dd>${n(e.emptyKWh+e.loadedKWh)} kWh</dd><dt>电池累计充入</dt><dd>${n(e.chargedKWh)} kWh</dd><dt>所属供电侧</dt><dd>${e.side==='west'?'西侧':'东侧'}</dd>${e.state==='charging'&&Number.isFinite(e.chargeEndsAt)?`<dt>本次目标</dt><dd>${n(e.targetKWh)} kWh</dd><dt>预计充至目标</dt><dd>${formatMoment(e.chargeEndsAt)}</dd>`:''}<dt>累计候充</dt><dd>${n(e.queueSeconds/60)} 分</dd><dt>累计通电</dt><dd>${n(e.chargingSeconds/60)} 分</dd></dl><p>可再承诺电量已扣除保底和已有行程预算；静止辅助负荷未计入。</p><div class="detail-actions"><button data-charge-contact="${esc(resource.id)}">查看停车补能位</button></div></section>`;
}
export function energyPanel(state){
 const energy=state.energy;if(!energy?.enabled)return '';
 const total=energy.totals,vehicles=state.resources.filter(r=>r.kind==='AGV'&&r.energy),balance=total.initialKWh+total.chargedKWh-total.emptyKWh-total.loadedKWh-total.storedKWh;
 return `<section class="card energy-panel" aria-label="AGV 能源与供电"><div class="cardhead"><div><div class="eyebrow">AGV ENERGY & CHARGING</div><h2>AGV 能源与供电</h2></div><span class="chip">合成停车接触补能</span></div><div class="energy-panel-body"><div class="stat-strip"><div><strong>${n(total.emptyKWh+total.loadedKWh)}</strong><span>牵引耗能 / kWh</span></div><div><strong>${n(total.gridKWh)}</strong><span>电网输入 / kWh</span></div><div><strong>${n(total.storedKWh)}</strong><span>车队现存电量 / kWh</span></div></div><div class="energy-circuits">${energy.groups.map(group=>`<section><h3>${group.side==='west'?'西侧':'东侧'}供电 <small>${group.activeResourceIds.length} / ${group.capacity} 条回路</small></h3><p><b>正在通电</b>${group.activeResourceIds.map(link).join(' · ')||'当前无车辆'}</p><p><b>停车候充</b>${group.queueResourceIds.map(link).join(' · ')||'当前无排队'}</p></section>`).join('')}</div><div class="energy-fleet">${vehicles.map(r=>`<article><div>${link(r.id)}<span>${energyStateName(r.energy.state)}</span></div><strong>${n(r.soc)}<small>%</small></strong><progress value="${r.soc}" max="100" aria-label="${esc(r.id)} 电量"></progress><p><span>已承诺 ${n(r.energy.committedKWh)} kWh</span><span>可再承诺 ${n(r.energy.availableKWh)} kWh</span></p></article>`).join('')}</div><div class="energy-ledger"><h3>车队电量核对</h3><p>初始 ${n(total.initialKWh)} ＋ 电池充入 ${n(total.chargedKWh)} − 空驶耗能 ${n(total.emptyKWh)} − 载运耗能 ${n(total.loadedKWh)} ＝ 现存 ${n(total.storedKWh)} kWh</p><small>按未舍入值核对的余差：${Math.abs(balance)<1e-7?'小于 0.0000001':n(Math.abs(balance))} kWh。电网输入与电池充入分开统计；效率损失不记为牵引耗能。</small></div><p class="energy-scope">车辆在各自实际停车位补能，共享同侧有限供电回路。参数属于合成训练设定；此布局不代表青岛港装卸并行补电，也未复现洋山固定站换电。</p></div></section>`;
}
export function energyComparison(report){
 if(!report.baseline.energy?.enabled&&!report.candidate.energy?.enabled)return '';
 const rows=[['牵引耗能','kWh',e=>e.emptyKWh+e.loadedKWh],['电网输入','kWh',e=>e.gridKWh],['电池实际充入','kWh',e=>e.chargedKWh],['初始车队电量','kWh',e=>e.initialKWh],['截止车队电量','kWh',e=>e.storedKWh],['累计通电','设备小时',e=>e.chargingSeconds/3600],['累计候充','设备小时',e=>e.queueSeconds/3600]];
 return `<section class="comparison-energy"><h4>同观察期能源台账</h4><div class="tablewrap"><table class="comparison-table"><thead><tr><th>指标</th><th>基准</th><th>候选</th><th>候选 − 基准</th></tr></thead><tbody>${rows.map(([label,unit,get])=>{const a=report.baseline.energy?.enabled?get(report.baseline.energy):null,b=report.candidate.energy?.enabled?get(report.candidate.energy):null;return `<tr><th scope="row">${label}<small>${unit}</small></th><td data-label="基准">${a===null?'—':n(a)}</td><td data-label="候选">${b===null?'—':n(b)}</td><td data-label="候选 − 基准">${a===null||b===null?'—':(b-a>0?'+':'')+n(b-a)}</td></tr>`;}).join('')}</tbody></table></div><p class="comparison-note">“—”表示该组未启用能源计算。较少的电网取电量可能来自更低的截止电量，须结合完成量、牵引耗能与初末电量判断。</p></section>`;
}
