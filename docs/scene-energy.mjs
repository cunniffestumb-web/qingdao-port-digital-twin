import * as T from './vendor/three/three.module.js';

const labels={parked:'停放',committed:'运输已派工','waiting-charge':'候充',charging:'充电中',fault:'故障'};
export function energyLabel(resource){
 if(!Number.isFinite(resource?.soc)||!resource.energy)return '';
 return (labels[resource.energy.state]||'停放')+' · SOC '+resource.soc.toFixed(1)+'%';
}

// One unit is 10 m. Both the end cabinet and its receiving strip sit inside
// the existing 17 m parking outline beyond the AGV's rotational envelope.
const face=.797;
const poseMatrix=(p,h)=>new T.Matrix4().makeRotationY(-h).setPosition(p);
function shape(x,y,z,w,h,d,color){
 return {matrix:new T.Matrix4().makeScale(w,h,d).setPosition(x,y,z),color:new T.Color(color)};
}
function link(a,b,width,color){
 const p=new T.Vector3(...a),v=new T.Vector3(...b).sub(p);
 const direction=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize());
 return {matrix:new T.Matrix4().compose(p.addScaledVector(v,.5),direction,new T.Vector3(width,v.length(),width)),color:new T.Color(color)};
}
function cabinet(){
 const pieces=[
  shape(.822,.006,.051,.052,.012,.102,'#999e94'),
  shape(.826,.072,.052,.044,.124,.082,'#bbc2b8'),
  shape(.826,.137,.052,.047,.006,.084,'#748183'),
  shape(.826,.072,.094,.038,.108,.003,'#a3b3ae'),
  shape(.831,.075,.096,.003,.023,.004,'#384b50'),
  shape(.802,.073,.051,.006,.066,.066,'#35474a'),
  shape(.802,.111,.051,.009,.006,.070,'#d9b266'),
  shape(.825,.126,.097,.023,.013,.004,'#384b50'),
 ];
 for(let i=0;i<4;i++){
  pieces.push(shape(face+.0015,.051+i*.013,.051,.003,.007,.048,'#b1aa8e'));
  pieces.push(shape(.813,.039+i*.012,.095,.006,.003,.002,'#617477'));
 }
 return pieces;
}
const closedBrush=[];
for(const sign of [-1,1]){
 closedBrush.push(shape(sign*.727,.074,sign*.051,.017,.056,.061,'#516164'));
 for(let i=0;i<4;i++)closedBrush.push(shape(sign*.737,.051+i*.013,sign*.051,.005,.006,.042,'#475153'));
}
const joinedBrush=[
 shape(face-.003,.071,.051,.006,.058,.053,'#425255'),
 shape(.758,.071,.051,.037,.012,.045,'#718184'),
];
for(const z of [.034,.068]){
 joinedBrush.push(link([.733,.047,z],[.779,.085,z],.005,'#9caaa9'));
 joinedBrush.push(link([.733,.084,z],[.779,.052,z],.005,'#9caaa9'));
 joinedBrush.push(link([.778,.067,z],[face-.006,.072,z],.0045,'#515d5e'));
}
for(const z of [.035,.060]){
 const loop=[[.737,.083,z],[.748,.045,z],[.758,.032,z],[.769,.035,z],[.783,.067,z]];
 for(let i=1;i<loop.length;i++)joinedBrush.push(link(loop[i-1],loop[i],.0032,'#303a39'));
}
for(let i=0;i<4;i++)joinedBrush.push(shape(face-.0006,.051+i*.013,.051,.0012,.006,.045,'#444a49'));

export function createChargeContacts(layout,world,models){
 const group=new T.Group();group.name='parking-contact-chargers';
 const slots=layout.parking.filter(p=>p.kind==='AGV').map(p=>{
  const edge=layout.corridors.find(e=>e.kind==='AGV'&&e.points.some(q=>q.x===p.pose.x&&q.y===p.pose.y));
  const entry=edge?.points.find(q=>q.x!==p.pose.x||q.y!==p.pose.y);
  if(!entry)throw Error('AGV停车袋缺少入口 '+p.id);
  const heading=Math.atan2(p.pose.y-entry.y,p.pose.x-entry.x),position=world(p.pose);
  const frame=poseMatrix(position,heading);
  return {id:p.resourceId,parking:p.id,frame,heading,position,face:new T.Vector3(face,.071,.051).applyMatrix4(frame)};
 });
 const fixedShape=cabinet(),indicatorMaterial=new T.MeshBasicMaterial({color:'#ffffff',toneMapped:false});
 const make=(capacity,material,dynamic=false)=>{
  const mesh=new T.InstancedMesh(models.cube,material,Math.max(1,capacity));mesh.count=0;
  mesh.castShadow=material!==indicatorMaterial;mesh.receiveShadow=mesh.castShadow;
  if(dynamic){mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);}
  mesh.userData.stationIds=[];mesh.userData.atContact=[];group.add(mesh);return mesh;
 };
 const cabinets=make(slots.length*fixedShape.length,models.material('steel'));
 const receivers=make(slots.length*(closedBrush.length+joinedBrush.length),models.material('steel'),true);
 const signals=make(slots.length,indicatorMaterial,true);
 const work=new T.Matrix4();
 function add(mesh,frame,part,id,atContact=true){
  const i=mesh.count++;mesh.setMatrixAt(i,work.multiplyMatrices(frame,part.matrix));mesh.setColorAt(i,part.color);
  mesh.userData.stationIds[i]=id;mesh.userData.atContact[i]=atContact;
 }
 for(const slot of slots)for(const part of fixedShape)add(cabinets,slot.frame,part,slot.id);
 cabinets.instanceMatrix.needsUpdate=true;if(cabinets.instanceColor)cabinets.instanceColor.needsUpdate=true;
 const lamps=Object.fromEntries(Object.entries({charging:'#38dfad','waiting-charge':'#ffc55f',fault:'#ea6664',standby:'#56625f'}).map(([state,color])=>[state,shape(.825,.126,.0996,.018,.008,.0015,color)]));
 let states=[];
 function update(snap){
  const resources=new Map(snap.resources.filter(r=>r.kind==='AGV').map(r=>[r.id,r]));
  const active=new Set(snap.energy.groups.flatMap(g=>g.activeResourceIds));
  const queued=new Set(snap.energy.groups.flatMap(g=>g.queueResourceIds));
  receivers.count=signals.count=0;states=[];
  for(const s of slots){
   const r=resources.get(s.id);if(!r)continue;
   const at=world(r.pose),frame=poseMatrix(at,r.pose.heading);
   for(const part of closedBrush)add(receivers,frame,part,s.id,false);
   const atHome=at.distanceTo(s.position)<.002&&Math.abs(Math.sin(r.pose.heading-s.heading))<.002;
   const state=r.energy?.state;
   const signal=atHome&&state==='charging'&&active.has(r.id)?'charging':atHome&&state==='waiting-charge'&&queued.has(r.id)?'waiting-charge':
    atHome&&state==='fault'?'fault':'standby';
   const engaged=signal==='charging';
   if(engaged)for(const part of joinedBrush)add(receivers,s.frame,part,s.id);
   add(signals,s.frame,lamps[signal],s.id);
   states.push({id:s.id,parking:s.parking,side:r.energy?.side,signal,engaged,face:s.face.toArray(),soc:r.soc});
  }
  for(const mesh of [receivers,signals]){
   mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
   mesh.boundingSphere=null;
  }
 }
 function dispose(){for(const obj of group.children)obj.dispose();indicatorMaterial.dispose();group.clear();}
 return {group,slots,update,dispose,stats:()=>states};
}
