// Coordinates are synthetic metres. Durations are scenario assumptions in seconds.
export const NODES = Object.fromEntries([
  ['rail','铁路装卸区',135,185],
  ['landside','陆侧交接区',305,258],
  ['smv','SMV 悬轨线',475,300],
  ['seaside','海侧交接区',625,334],
  ['yard','集装箱堆场',795,363],
  ['quay','岸桥作业区',1028,375],
  ['ship','船舶舱位',1080,457],
].map(([id,label,x,y])=>[id,{id,label,x,y}]));

const operations = [
  ['rail','铁路卸箱','铁路装箱','rail','rail',['RMG'],95],
  ['et','ET 驳运至陆侧','ET 驳运至铁路','rail','landside',['ET'],240],
  ['land','ET → SMV 交接','SMV → ET 交接','landside','landside',['ET','SMV'],60],
  ['smv','SMV 驳运至海侧','SMV 驳运至陆侧','landside','seaside',['SMV'],360],
  ['bay','SMV → AGV 交接','AGV → SMV 交接','seaside','seaside',['SMV','AGV','BAY'],120],
  ['agv','AGV 运至堆场','AGV 运至海侧','seaside','yard',['AGV'],220],
  ['yard','堆场转栈','堆场转栈','yard','yard',['YC'],140],
  ['quay','AGV 运至岸桥','AGV 运至堆场','yard','quay',['AGV'],170],
  ['qc','岸桥装船','岸桥卸船','quay','ship',['QC'],150],
];

export const STAGES = {};
export const ROUTES = {export:[],import:[]};
for (const direction of Object.keys(ROUTES)) {
  const inbound = direction === 'import';
  for (const [key,outLabel,inLabel,a,b,kinds,duration] of inbound ? [...operations].reverse() : operations) {
    const id = direction+'-'+key;
    const from = inbound ? b : a;
    const to = inbound ? a : b;
    const path = key === 'smv' ? [from,'smv',to] : [from,to];
    STAGES[id] = {id,label:inbound ? inLabel : outLabel,from,to,path,kinds,duration};
    ROUTES[direction].push(id);
  }
}

export function formatTime(seconds) {
  const total=Math.floor(seconds)+8*3600;
  const days=Math.floor(total/86400);
  const dayTime=total-days*86400;
  const clock=[Math.floor(dayTime/3600),Math.floor(dayTime%3600/60),dayTime%60]
    .map(value=>String(value).padStart(2,'0')).join(':');
  return days===0?clock:'D'+(days>0?'+':'')+days+' '+clock;
}

export function formatMoment(seconds){
  const rounded=Number(seconds.toFixed(9));
  const nanos=Math.round((rounded-Math.floor(rounded))*1e9);
  if(!nanos)return formatTime(rounded);
  const digits=String(nanos).padStart(9,'0').replace(/0+$/,'').padEnd(3,'0');
  return formatTime(rounded)+'.'+digits;
}
