// Synthetic training parameters. Consumption is battery-side kWh/km; power is grid-side kW.
export const energyDefaults=Object.freeze({
 batteryKWh:120,initialSocPct:60,reserveSocPct:10,targetSocPct:80,emptyKWhPerKm:4,loadedKWhPerKm:6,
 chargeKW:120,chargeEfficiency:0.9,westCircuits:1,eastCircuits:1,
});
export const energyRanges=Object.freeze(Object.fromEntries(Object.entries({
 batteryKWh:[0.01,10000],initialSocPct:[0,100],reserveSocPct:[0,100],targetSocPct:[0,100],
 emptyKWhPerKm:[0,1000],loadedKWhPerKm:[0,1000],chargeKW:[0.01,10000],chargeEfficiency:[0.001,1],
 westCircuits:[0,64],eastCircuits:[0,64],
}).map(([key,[min,max]])=>[key,Object.freeze({min,max,integer:key.endsWith('Circuits')})])));
export function energySettings(config){
 if(!['off','parking-contact'].includes(config.energyMode))throw new RangeError('能源模式无效');
 const result={energyMode:config.energyMode};
 for(const [key,fallback] of Object.entries(energyDefaults)){
  const n=config[key]===undefined?fallback:config[key],r=energyRanges[key];
  if(!Number.isFinite(n)||n<r.min||n>r.max||r.integer&&!Number.isInteger(n))throw new RangeError('能源参数超出范围 '+key);
  result[key]=n;
 }
 if(result.reserveSocPct>=result.targetSocPct)throw new RangeError('补能目标必须高于保底电量');
 if(result.energyMode==='parking-contact'&&config.trafficPolicy==='segment')throw new RangeError('停车接触补能需要分段通行模式');
 return result;
}
