import * as T from './vendor/three/three.module.js';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {createModels} from './scene-models.mjs';
import {buildJiSceneSchedule,sampleJiScene} from './ji-scene-state.mjs';

const position=()=>new T.Vector3();
const phases={outside:'区外',waiting:'等待交接',transfer:'共同作业',received:'已接箱'};
const palette={import:'#29857d',export:'#c85d34'};
const round=n=>Math.round(n*1e5)/1e5;
const coords=v=>v.toArray().map(round);

function sign(text,color){
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=104;
 const c=canvas.getContext('2d');c.fillStyle='#133244';c.fillRect(0,0,384,104);
 c.fillStyle=color;c.fillRect(0,0,12,104);c.font='600 49px system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff';c.fillText(text,198,50,354);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const mat=new T.SpriteMaterial({map:texture,transparent:true});const sprite=new T.Sprite(mat);sprite.scale.set(1.25,.34,1);return sprite;
}
function buildSite(schedule,models){
 const g=new T.Group(),b=models.batch(),lanes=schedule.lanes;
 const minZ=lanes[0].z-1.5-(Math.max(schedule.config.smvs,schedule.config.agvs)-1)*.58,maxZ=lanes.at(-1).z;
 const left=Math.min(-2.6,...schedule.rows.map(r=>r.x-1.08)),right=3.4;
 const centerX=(right+left)/2,span=right-left,centerZ=(minZ+maxZ)/2,depth=maxZ-minZ+2;
 b.box(centerX,-.087,centerZ,span+1.4,.16,depth,'#79858b',0,'concrete');
 // The exposed concrete panels stop at the marked operating strips.
 for(let x=left-.3;x<right+.65;x+=1.27)b.box(x,-.0046,centerZ,.009,.005,depth-.012,'#717f84');
 for(let z=minZ-.65;z<maxZ+1;z+=1.24)b.box(centerX,-.0044,z,span+1.38,.005,.01,'#737f82');
 b.box(centerX,-.04,minZ+(lanes[0].z-1.5-minZ)/2,span+.9,.086,lanes[0].z-minZ-.82,'#616e76',0,'concrete');
 for(const lane of lanes){
  const z=lane.z,accent=lane.direction==='export'?'#d58a45':'#45a697';
  b.box(centerX,-.013,z,span,.034,.86,'#445760',0,'concrete');
  for(const side of [-1,1])b.box(centerX,.009,z+side*.404,span,.012,.024,'#e8dfbd');
  for(const x of [left+.62,right-.65]){
   const forward=lane.direction==='export'?1:-1;
   b.box(x,.012,z,.32,.008,.033,'#b7c4bc');
   for(const side of [-1,1])b.rod([x+.16*forward,.016,z],[x+.058*forward,.016,z+.081*side],.031,'#b7c4bc',true);
  }
  // Split box beams with a central opening for the suspended bogie.
  for(const side of [-1,1]){
   b.box(centerX,1.375,z+side*.089,span+.25,.19,.071,'#a4b0ab');
   b.box(centerX,1.295,z+side*.06,span+.25,.028,.098,'#687d80');
   b.box(centerX,1.484,z+side*.089,span+.31,.033,.105,'#bfc8bb');
  }
  for(let x=left+.08;x<=right;x+=.35)b.box(x,1.388,z+.13,.025,.146,.014,'#849592');
  for(const x of [left+.11,right-.08]){
   const pz=z-.48;
   b.box(x,.049,pz,.24,.098,.245,'#aeb3aa',0,'concrete');
   b.box(x,.72,pz,.106,1.38,.105,'#88999b');
   b.box(x,1.465,z-.18,.13,.09,.72,'#9aa9a6');
   b.rod([x,1.1,pz],[x,1.415,z+.04],.059,'#839798',true);
   for(const y of [.135,.211,.287])b.box(x,y,pz,.113,.04,.112,'#e3ac4f');
  }
  for(const x of new Set(schedule.rows.filter(r=>r.lane===lane.id).map(r=>r.x))){
   for(const side of [-1,1])for(const edge of [-1,1]){
    b.box(x+side*.70,.017,z+edge*.28,.16,.009,.027,accent);
    b.box(x+side*.77,.017,z+edge*.225,.027,.009,.13,accent);
   }
  }
  const label=sign(lane.id+' '+(lane.direction==='export'?'出口':'进口'),accent);
  label.position.set(left+.29,1.78,z);g.add(label);
 }
 const n=Math.max(schedule.config.agvs,schedule.config.smvs);
 for(let i=0;i<n;i++){
  const z=lanes[0].z-1.5-i*.58;
  if(i<schedule.config.agvs)for(const side of [-1,1])b.box(.0,.012,z+.22*side,6.3,.012,.019,'#b4b6ad');
  if(i<schedule.config.smvs){
   for(const side of [-1,1])b.box(0,1.335,z+.073*side,6.28,.106,.055,'#657f88');
   for(const x of [-3.13,3.13])b.box(x,.65,z,.071,1.30,.088,'#73878b');
  }
 }
 const external=sign('区外转场','#98acbb');external.scale.set(1.37,.37,1);external.position.set(2.3,1.86,minZ-.13);g.add(external);
 g.add(b.finish());return {group:g,centerX,centerZ,depth,span,minZ,maxZ};
}
function releaseGroup(root){
 if(!root)return;
 root.traverse(o=>{
  if(o.isInstancedMesh)o.dispose();
  if(o.isSprite){o.material.map.dispose();o.material.dispose();}
 });
 root.removeFromParent();
}
export function createJiScene(host,{onSelect=()=>{},onSummary=()=>{}}={}){
 const renderer=new T.WebGLRenderer({alpha:false,antialias:true,powerPreference:'low-power'});
 const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),device=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const compact=/swiftshader|llvmpipe|software/i.test(device);
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,compact?.85:1.65));renderer.shadowMap.enabled=!compact;
 renderer.shadowMap.type=T.PCFShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor('#bfd1d7');
 renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Ji 海侧作业单元，空轨车在上层，导引车在下层');host.append(renderer.domElement);
 const sky=document.createElement('canvas');sky.width=2;sky.height=128;const skyInk=sky.getContext('2d'),skyGrad=skyInk.createLinearGradient(0,0,0,128);
 skyGrad.addColorStop(0,'#7f9ba9');skyGrad.addColorStop(.65,'#acbfc5');skyGrad.addColorStop(1,'#b7c6c6');skyInk.fillStyle=skyGrad;skyInk.fillRect(0,0,2,128);
 const skyTexture=new T.CanvasTexture(sky);skyTexture.colorSpace=T.SRGBColorSpace;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(33,1,.02,100),controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=false;controls.minDistance=1.8;controls.maxDistance=28;controls.maxPolarAngle=Math.PI*.47;controls.zoomSpeed=.75;
 scene.background=skyTexture;scene.add(new T.HemisphereLight('#eaf7ff','#94a5a7',1.8));
 const sun=new T.DirectionalLight('#fff1d8',2.5);sun.position.set(-3,8,5);sun.castShadow=!compact;sun.shadow.mapSize.set(1024,1024);
 Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:30});sun.shadow.bias=-.00025;sun.shadow.normalBias=.008;scene.add(sun);
 const models=createModels({compact});
 const boxMats=Object.fromEntries(Object.entries(palette).map(([k,color])=>{const mat=models.material('container').clone();mat.color.set(color);return[k,mat];}));
 const focusMaterial=new T.MeshBasicMaterial({color:'#ffcb57',side:T.DoubleSide});
 const frameShape=new T.Shape(),L=.845,W=.31,edge=.027;
 frameShape.moveTo(-L,-W);frameShape.lineTo(L,-W);frameShape.lineTo(L,W);frameShape.lineTo(-L,W);frameShape.closePath();
 const hole=new T.Path();hole.moveTo(-L+edge,-W+edge);hole.lineTo(-L+edge,W-edge);hole.lineTo(L-edge,W-edge);hole.lineTo(L-edge,-W+edge);hole.closePath();frameShape.holes.push(hole);
 const focus=new T.Mesh(new T.ShapeGeometry(frameShape),focusMaterial);focus.rotation.x=-Math.PI/2;scene.add(focus);
 const resources=new Map(),boxes=new Map(),pickables=[];const ray=new T.Raycaster(),mouse=new T.Vector2();
 let schedule=null,source=null,state=null,site=null,disposed=false,shown=true,inView=true,frame=0,renderedFrames=0,renderedTime=null,view='overview',selected=null,summaryKey='';
 function render(){
  frame=0;if(disposed||!shown||!inView||document.hidden||!host.isConnected||!host.clientWidth||!host.clientHeight)return;
  renderer.render(scene,camera);renderedFrames++;renderedTime=state?.time??null;
 }
 function invalidate(){if(!disposed&&!frame&&shown&&inView&&!document.hidden)frame=requestAnimationFrame(render);}
 function resize(){
  const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(site)aim();invalidate();}
 }
 function aim(){
  if(!site||!schedule)return;
  const target=position(),delta=position(),row=schedule.rows.find(r=>r.id===selected);
  if(view==='selected'&&row){
   // Keep the eye in the selected bay's aisle. A view through neighbouring
   // overhead beams would hide the actual pickup behind another vehicle.
   target.set(row.x,.65,row.z);delta.set(camera.aspect<1.2?1.76:1.26,.55,1.28);
   camera.fov=camera.aspect<1.2?52:56;
  }else{
   camera.fov=33;target.set(site.centerX,.49,site.centerZ);delta.set(2.1,4.7,8.3).normalize();
   const radius=Math.max((site.span+1.4)/Math.max(camera.aspect,.40),site.depth*.58+1.35);
   delta.multiplyScalar(Math.max(5.55,radius*1.80));
  }
  site.group.traverse(o=>{if(o.isSprite)o.visible=view==='overview';});camera.updateProjectionMatrix();
  camera.position.copy(target).add(delta);controls.target.copy(target);controls.update();invalidate();
 }
 function setSchedule(config,rows){
  if(rows===source)return;
  source=rows;schedule=buildJiSceneSchedule(config,rows);
  for(const r of resources.values())releaseGroup(r.model);
  for(const b of boxes.values())b.removeFromParent();
  releaseGroup(site?.group);resources.clear();boxes.clear();pickables.length=0;
  site=buildSite(schedule,models);scene.add(site.group);
  for(const f of schedule.fleets){
   const rec=models.vehicle(f.kind,f.index);rec.model.userData.resourceId=f.id;
   resources.set(f.id,rec);scene.add(rec.model);pickables.push(rec.model);
  }
  for(const r of schedule.rows){
   const mesh=new T.Mesh(models.cargoGeo,boxMats[r.direction]);mesh.scale.set(1.2192,.2896,.2438);mesh.castShadow=true;mesh.receiveShadow=true;
   mesh.userData.taskId=r.id;boxes.set(r.id,mesh);scene.add(mesh);pickables.push(mesh);
  }
  summaryKey='';aim();
 }
 function update(time,id){
  if(!schedule)return;
  const changed=id!==selected;selected=id;state=sampleJiScene(schedule,time,id);
  for(const r of state.resources){
   const rec=resources.get(r.id);rec.model.position.fromArray(r.position);rec.model.rotation.y=-r.heading;
   if(r.kind==='SMV'){
    const carried=state.boxes.find(b=>b.visible&&b.carrier===r.id);
    const y=carried?carried.position[1]+state.heights.container-r.position[1]:-.2;
    rec.pose(new T.Vector3(0,y,0),1.2192,0);
   }
  }
  for(const b of state.boxes){
   const mesh=boxes.get(b.id);mesh.visible=b.visible;
   if(b.visible){mesh.position.fromArray(b.position);mesh.position.y+=state.heights.container/2;}
  }
  const row=schedule.rows.find(r=>r.id===id),box=state.boxes.find(b=>b.id===id);focus.visible=!!row;
  if(row)focus.position.set(row.x,.028,row.z);
  const phase=box?.phase==='outside'?(box.deliveryComplete?'已完成交接':'尚未进入交接区'):phases[box?.phase];
  const summary=row?[row.id,row.direction==='export'?'出口 ↓':'进口 ↑',row.lane,phase].join(' · '):'';
  const phaseNames={'before-arrival':'待到位',waiting:'等待',transfer:'共同作业','post-service':'作业后驻留',departed:'已离区'};
  const fleetSummary=state.resources.map(r=>{
   const message=r.phase==='transit'?(r.fromLane+' → '+r.toLane):((r.taskId||'')+' '+(phaseNames[r.phase]||''));
   return {id:r.id,phase:r.phase,text:message.trim()};
  });
  const nextKey=summary+JSON.stringify(fleetSummary);
  if(nextKey!==summaryKey){summaryKey=nextKey;onSummary(summary,fleetSummary);}
  if(changed&&view==='selected')aim();invalidate();
 }
 let down=null;
 function pointerDown(e){down=[e.clientX,e.clientY];}
 function pick(e){
  if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
  const rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,camera);
  for(const hit of ray.intersectObjects(pickables.filter(o=>o.visible),true)){
   let node=hit.object;
   while(node&&!node.userData.taskId&&!node.userData.resourceId)node=node.parent;
   const id=node?.userData.taskId??state?.resources.find(r=>r.id===node?.userData.resourceId)?.taskId;
   if(id){onSelect(id);return;}
  }
 }
 const observer=new ResizeObserver(resize);observer.observe(host);
 const intersection=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;if(inView)invalidate();});intersection.observe(host);
 function visibility(){if(!document.hidden)invalidate();}
 controls.addEventListener('change',invalidate);document.addEventListener('visibilitychange',visibility);
 renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pick);
 resize();
 return {setSchedule,update,setView(name){view=name==='selected'?'selected':'overview';aim();},
  setVisible(v){shown=!!v;if(shown){resize();invalidate();}else{cancelAnimationFrame(frame);frame=0;}},
  getStats(){
   const resourceModels=[...resources].map(([id,{model}])=>{
    model.updateWorldMatrix(true,true);const aabb=new T.Box3();
    // Painted ID plates and soft contact-shadow planes have no solid volume.
    model.traverse(o=>{
     if(!o.isInstancedMesh)return;
     if(!o.boundingBox)o.computeBoundingBox();
     aabb.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    return {id,visible:model.visible,position:coords(model.position),heading:round(-model.rotation.y),bounds:{min:coords(aabb.min),max:coords(aabb.max)}};
   });
   const boxModels=[...boxes].map(([id,m])=>({id,visible:m.visible,position:m.visible?[round(m.position.x),round(m.position.y-m.scale.y/2),round(m.position.z)]:null,dimensions:coords(m.scale)}));
   const sceneResourceIds=[],sceneBoxIds=[];scene.traverse(o=>{if(o.userData.resourceId)sceneResourceIds.push(o.userData.resourceId);if(o.userData.taskId)sceneBoxIds.push(o.userData.taskId);});
   return {...state,mode:'webgl',memory:{...renderer.info.memory},sceneResourceIds,sceneBoxIds,driver:device,profile:compact?'compact':'full',view,shown,inView,renderedFrames,renderedTime,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,resourceModels,boxModels};
  },
  dispose(){
   if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();controls.dispose();
   document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pick);
   releaseGroup(site?.group);for(const r of resources.values())releaseGroup(r.model);resources.clear();boxes.clear();pickables.length=0;scene.clear();state=null;
   Object.values(boxMats).forEach(m=>m.dispose());focus.geometry.dispose();focusMaterial.dispose();skyTexture.dispose();sun.shadow.dispose();models.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  }};
}
