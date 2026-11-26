import * as T from './vendor/three/three.module.js';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {buildLayout,clearOfTraffic} from './layout.mjs';
import {createCompatibilityAppearance} from './scene-compatibility.mjs';
import {createChargeContacts,energyLabel} from './scene-energy.mjs';
import {createModels} from './scene-models.mjs';
import {coastalBackdrop,daylightOffset,distantServiceDistrict,harborReflection,harborWater} from './scene-atmosphere.mjs';
import {createSurfaces} from './scene-surfaces.mjs';
import {cargoSize,SCENE_METRES,QUAY_FACE} from './scene-scale.mjs';

const W=(x,y)=>new T.Vector3((x-600)/10,0,(y-330)/10);
const toKey=(type,id)=>type+':'+id;
const idNumber=id=>Number(String(id).match(/\d+$/)?.[0]||1);
const smooth=p=>p*p*(3-2*p);
function world(p){return W(p.x,p.y).setY((p.z||0)/SCENE_METRES);}
function stationLabel(text,subtitle=''){
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=subtitle?140:84;
 const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(16,39,50,.90)';ctx.beginPath();ctx.roundRect(3,3,378,canvas.height-7,11);ctx.fill();
 ctx.strokeStyle='rgba(185,219,217,.45)';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#7bf0d4';ctx.fillRect(13,23,5,35);
 ctx.font='650 41px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#edf6f4';ctx.fillText(text,197,42);
 if(subtitle){ctx.font='600 29px system-ui,sans-serif';ctx.fillStyle='#cce9e2';ctx.fillText(subtitle,193,99,355);}
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map,depthWrite:false,transparent:true}));sprite.scale.set(8.3,1.82,1);return sprite;
}
function harborSky(){
 const material=new T.ShaderMaterial({
  uniforms:{night:{value:0},hasPhoto:{value:0},skyPhoto:{value:null}},side:T.BackSide,depthWrite:false,
  vertexShader:`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 skyDir;void main(){skyDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`,
  fragmentShader:`
   #include <logdepthbuf_pars_fragment>
   varying vec3 skyDir;uniform float night;uniform float hasPhoto;uniform sampler2D skyPhoto;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
   void main(){vec3 d=normalize(skyDir);float y=max(0.,d.y);
    vec3 horizon=mix(vec3(.65,.79,.83),vec3(.075,.117,.172),night);
    vec3 zenith=mix(vec3(.17,.45,.71),vec3(.014,.031,.065),night);
    vec3 col=mix(horizon,zenith,pow(y,.53));
    vec2 uv=d.xz/max(.07,y)*2.3;float n=noise(uv)*.52+noise(uv*2.)*.27+noise(uv*4.)*.14+noise(uv*8.)*.07;
    float cloud=smoothstep(.51,.76,n)*smoothstep(.025,.18,y);
    col=mix(col,mix(vec3(.90,.93,.91),vec3(.15,.20,.26),night),cloud*.8);
    vec2 photoUV=vec2(atan(d.z,d.x)/6.283185307+.5,asin(clamp(d.y,.001,1.))/3.14159265+.5);
    vec3 photo=texture2D(skyPhoto,photoUV).rgb*.65;
    vec3 coastal=mix(vec3(.43,.56,.61),photo,smoothstep(.013,.21,d.y));
    col=mix(col,coastal,hasPhoto*(1.-night));
    float cloudLuma=clamp(dot(photo,vec3(.2126,.7152,.0722)),0.,1.7);
    vec3 darkSky=mix(vec3(.029,.048,.069),vec3(.009,.018,.033)+cloudLuma*vec3(.026,.027,.032),smoothstep(.012,.18,d.y));
    col=mix(col,darkSky,hasPhoto*night);
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <logdepthbuf_fragment>
    #include <colorspace_fragment>
   }`
 });return new T.Mesh(new T.SphereGeometry(360,32,16),material);
}
export function createPortScene(host,{onSelect=()=>{}}={}){
 let renderer=new T.WebGLRenderer({antialias:true,alpha:false,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
 const gl=renderer.getContext(),driver=gl.getExtension('WEBGL_debug_renderer_info');
 const software=!!driver&&/swiftshader|llvmpipe|software rasterizer/i.test(String(gl.getParameter(driver.UNMASKED_RENDERER_WEBGL)));
 if(software){
  // Context attributes are immutable. Keep native antialiasing/log depth
  // intact, and open a single-sample buffer only for the CPU rasterizer.
  renderer.dispose();renderer.forceContextLoss();
  renderer=new T.WebGLRenderer({antialias:false,alpha:false,logarithmicDepthBuffer:false,powerPreference:'high-performance'});
 }
 const compatibility=software?createCompatibilityAppearance():null;
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,software?.62:1.65));renderer.shadowMap.enabled=!software;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=T.PCFShadowMap;
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;
 const canvas=renderer.domElement;canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none';canvas.setAttribute('aria-label','可旋转、缩放与点选的立体港区');host.append(canvas);
 const scene=new T.Scene();scene.background=new T.Color('#99b6bd');scene.fog=new T.FogExp2('#a5bbbf',.00235);
 const camera=new T.PerspectiveCamera(40,1,.025,650),controls=new OrbitControls(camera,canvas);
 controls.enableDamping=true;controls.dampingFactor=.1;controls.maxPolarAngle=Math.PI*.47;controls.minDistance=.62;controls.maxDistance=230;controls.target.set(-1,1,0);
 const models=createModels({compact:software}),refs=new Map(),dynamic=new T.Group(),cranes=new Set(['QC','YC','RMG']);
 scene.add(dynamic);
 const hemi=new T.HemisphereLight('#d7e8ef','#6b706c',.42),sun=new T.DirectionalLight('#ffe4c2',2.72);
 sun.position.copy(daylightOffset);sun.castShadow=true;sun.shadow.mapSize.setScalar(software?1024:2048);Object.assign(sun.shadow.camera,{left:-78,right:78,top:64,bottom:-64,near:1,far:230});sun.shadow.normalBias=.008;sun.shadow.bias=-.00012;scene.add(hemi,sun,sun.target);
 const fill=new T.DirectionalLight('#c3dcf8',.20);fill.position.set(35,23,-50);scene.add(fill);
 const water=compatibility?.water??harborWater(),sky=software?new T.Group():harborSky(),hills=coastalBackdrop({compact:software}),district=distantServiceDistrict(models,{compact:software});scene.add(water,sky,hills,district);
 const land=models.batch();
 land.box((QUAY_FACE-330)/2,-.713,-45,QUAY_FACE+330,1.4,265,'#637270');land.box((QUAY_FACE-58)/2,-.205,0,QUAY_FACE+58,.40,82,'#53636a');
 const site=land.finish();scene.add(site);
 const surfaces=createSurfaces(renderer,{compact:software});scene.add(surfaces.group);
 scene.environmentIntensity=.43;scene.backgroundIntensity=.69;scene.backgroundBlurriness=.018;
 surfaces.loadEnvironment(scene,hdr=>{
  water.material.uniforms.skyMap.value=hdr;water.material.uniforms.hasSky.value=1;
  sky.material.uniforms.skyPhoto.value=hdr;sky.material.uniforms.hasPhoto.value=1;
  renderer.shadowMap.needsUpdate=true;
 });
 const reflection=software?null:harborReflection(renderer,water);
 const ship=models.vessel();scene.add(ship);
 const fleetHulls=[ship];let charging=null,energyLayout=null;let contentRevision=0,furniture=null,networkSite=null,siteInfo=null,layout=null,terminalKey='';
 const labelSprites=[];
 for(const [text,x,y,z] of [['铁路作业区',-47,4,-15],['陆侧交接',-29,2.5,-7],['海侧交接',3,2.5,.4],['集装箱堆场',19.5,3.2,4],['船舶泊位',48,3.4,-5]]){
  const s=stationLabel(text);s.position.set(x,y,z);scene.add(s);labelSprites.push(s);
 }
 const nightLights=new T.Group();nightLights.visible=false;scene.add(nightLights);
 const lampCanvas=document.createElement('canvas');lampCanvas.width=lampCanvas.height=64;
 const lc=lampCanvas.getContext('2d'),glow=lc.createRadialGradient(32,32,0,32,32,32);
 glow.addColorStop(0,'rgba(255,255,255,1)');glow.addColorStop(.13,'rgba(255,244,197,.88)');glow.addColorStop(.4,'rgba(252,199,136,.22)');glow.addColorStop(1,'rgba(248,175,88,0)');lc.fillStyle=glow;lc.fillRect(0,0,64,64);
 const lampMap=new T.CanvasTexture(lampCanvas),lampMat=new T.SpriteMaterial({map:lampMap,transparent:true,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false});
 const poolMaterial=new T.MeshBasicMaterial({map:lampMap,color:'#efbc79',transparent:true,opacity:.34,blending:T.AdditiveBlending,depthWrite:false});
 const poolGeo=new T.PlaneGeometry(12,9);
 const floodlights=new T.Group();nightLights.add(floodlights);
 function updateLamps(locations){
  floodlights.clear();
  for(const [x,y,z] of locations){
   const bulb=new T.Sprite(lampMat);bulb.position.set(x,y,z);bulb.scale.setScalar(.84);floodlights.add(bulb);
   const pool=new T.Mesh(poolGeo,poolMaterial);pool.rotation.x=-Math.PI/2;pool.position.set(x,.012,z);floodlights.add(pool);
  }
 }
 // Each work light has a luminous fitting at the underside of its gantry.
 // Keep a bounded number even in the maximum-fleet scenario.
 const vesselLights=new T.Group();nightLights.add(vesselLights);
 const navGeometry=new T.BoxGeometry(),navPaint=[new T.Color('#dda867'),new T.Color('#adc8ce'),new T.Color('#b65040'),new T.Color('#418d72')];
 const navMaterial=new T.MeshBasicMaterial({color:'#ffffff',toneMapped:false});
 function updateShipLamps(){
  for(const old of [...vesselLights.children]){old.dispose();vesselLights.remove(old);}
  const cells=[];
  for(const hull of fleetHulls){
   const bridge=hull.getObjectByName('ship-superstructure');bridge.updateWorldMatrix(true,false);
   const add=(x,y,z,l,h,w,col)=>cells.push({frame:bridge.matrixWorld,p:[x,y,z],l,h,w,col});
   for(const z of [11.722,15.081])for(let j=0;j<7;j++){
    if(j%3===1)continue;
    add((j-3)*.88,6.665,z,.64,.165,.008,j%3?1:0);
   }
   for(const side of [-1,1]){
    add(side*3.772,6.64,13.38,.018,.12,.16,side<0?2:3);
    for(const dz of [-.82,.31])add(side*3.805,6.67,13.4+dz,.009,.14,.40,1);
   }
   add(0,10.32,13.1,.043,.053,.043,1);
  }
  const lamps=new T.InstancedMesh(navGeometry,navMaterial,cells.length),m=new T.Object3D(),worldMatrix=new T.Matrix4();
  cells.forEach((c,i)=>{m.position.set(...c.p);m.scale.set(c.l,c.h,c.w);m.updateMatrix();lamps.setMatrixAt(i,worldMatrix.multiplyMatrices(c.frame,m.matrix));lamps.setColorAt(i,navPaint[c.col]);});
  vesselLights.add(lamps);
 }
 const workLights=[],fittingGeometry=new T.BoxGeometry(.29,.045,.19);
 const fittingMaterial=new T.MeshBasicMaterial({color:'#fff0d3',toneMapped:false});
 for(let i=0;i<6;i++){
  const source=new T.Mesh(fittingGeometry,fittingMaterial),halo=new T.Sprite(lampMat);
  halo.scale.set(.48,.48,1);const spot=new T.SpotLight(i%2?'#dfeced':'#fff0d4',i<2?225:114,23,.93,.64,2);
  nightLights.add(source,halo,spot,spot.target);workLights.push({source,halo,spot});
 }
 function updateWorkLights(){
  const shipCranes=latest.resources.filter(r=>r.kind==='QC').slice(0,2);
  const yardCranes=latest.resources.filter(r=>r.kind==='YC').slice(0,2);
  const stations=[shipCranes[0],shipCranes[1],yardCranes[0],yardCranes[1],shipCranes[0],shipCranes[1]];
  for(let i=0;i<workLights.length;i++){
   const {source,halo,spot}=workLights[i],r=stations[i],glint=water.material.uniforms?.portLights?.value[i];
   source.visible=halo.visible=!!r;spot.visible=!!r&&!software;
   if(!r){if(glint)glint.w=0;continue;}
   const rec=refs.get(toKey('resource',r.id)),quay=r.kind==='QC';
   const carriage=rec.model.getObjectByName('hoist-carriage');
   const fixed=i>=4;
   // The moving fitting sits directly under the trolley floor. The second
   // quay fitting mounts beneath the seaward boom girder and washes the deck.
   const at=fixed?rec.model.localToWorld(new T.Vector3(4.65,6.69,1.18)):
    carriage.localToWorld(new T.Vector3(-.23,-.067,-.14));
   source.position.copy(at);source.rotation.y=rec.model.rotation.y;halo.position.copy(at);spot.position.copy(at);
   if(fixed)spot.target.position.copy(rec.model.position).add(new T.Vector3(5.0,.70,.15));
   else{
    const contact=r.spreaderPose?world(r.spreaderPose):rec.model.position;
    spot.target.position.set(at.x+.08,Math.min(at.y-.6,Math.max(.025,contact.y)),at.z+.06);
   }
   spot.angle=fixed?.77:quay?.59:.79;spot.penumbra=.58;spot.intensity=fixed?324:quay?292:112;
   if(glint)glint.set(at.x,at.y,at.z,quay?.91:0);
  }
 }
 let selectedLabel=null;
 const corners=[];
 for(const x of [-.5,.5])for(const z of [-.5,.5]){
  corners.push(x,0,z,x*.63,0,z,x,0,z,x,0,z*.52);
 }
 const bracketGeometry=new T.BufferGeometry();bracketGeometry.setAttribute('position',new T.Float32BufferAttribute(corners,3));
 const ring=new T.LineSegments(bracketGeometry,new T.LineBasicMaterial({color:'#58f5da',transparent:true,opacity:.9,depthWrite:false,toneMapped:false}));
 scene.add(ring);ring.visible=false;
 const routeMaterial=new T.LineDashedMaterial({color:'#66e8d0',dashSize:.80,gapSize:.55,transparent:true,opacity:.8,depthWrite:false});
 const route=new T.Line(new T.BufferGeometry(),routeMaterial);
 scene.add(route);route.visible=false;
 const observer=new ResizeObserver(resize);observer.observe(host);
 let disposed=false,viewName='overview',lastChoice=null,latest=null,night=false,flight=null,animation=0,w=1,h=1,down=null;
 const views={overview:{look:[14,1.25,4],offset:[84,43,65]},rail:{look:[-46,1.05,-14],offset:[-8,5,12]},yard:{look:[19.5,1.0,3.3],offset:[-7,5,12]},ship:{look:[45,2.2,10],offset:[42,11,38]},top:{look:[-1,0,0],offset:[0,119,.01]}};
 function pose(view){
  const {look,offset}=views[view],target=new T.Vector3(...look);
  let berthShift=0;
  if(view==='ship'&&latest){
   const quay=latest.resources.filter(r=>r.kind==='QC');
   const crane=quay.find(r=>r.id===lastChoice?.id||r.containerId&&r.containerId===lastChoice?.id)
    ??quay.find(r=>r.spreaderPose);
   if(crane){berthShift=world(crane.pose).z-4.5;target.z+=berthShift;}
  }
  const aspect=w/h,scale=view==='overview'||view==='top'?Math.max(.89,Math.min(2.95,1.65/aspect)):Math.max(.82,Math.min(1.75,1.4/aspect));
  const position=target.clone().add(new T.Vector3(...offset).multiplyScalar(scale));
  if(view!=='overview'&&view!=='ship')return {position,target};
  // Fit the quay and transfer line to the space actually left by the HUD.
  // Standalone canvases and the stacked mobile layout need no side gutters.
  const overlay=host.closest('#overview');
  if(!overlay||w<680)return {position,target};
  const bounds=host.getBoundingClientRect();
  const limit=(id,edge,fallback)=>{
   const rect=overlay.querySelector(id)?.getBoundingClientRect();
   if(!rect?.height||rect.bottom<=bounds.top||rect.top>=bounds.bottom)return fallback;
   return edge==='right'?rect.right-bounds.left:edge==='left'?rect.left-bounds.left:rect.top-bounds.top;
  };
  const left=limit('#ops-left','right',0)+14,right=limit('#inspector','left',w)-14;
  const top=Math.min(h*.27,Math.max(35,overlay.querySelector('.scene-tools').getBoundingClientRect().bottom-bounds.top+10));
  const bottom=limit('#metrics','top',h)-12;
  if(right-left<w*.36||bottom-top<h*.27)return {position,target};
  const points=view==='overview'?[[-47,.5,-14],[-29,1,-7],[2,1,0],[19,.5,4],[43,9.5,4.5],[43,9.5,11.7],[48,1.2,-2],[48,1.2,22]]:
   [[43,9.5,4.5],[43,9.5,11.7],[43,0,6],[48,1.2,-4],[48,1.2,18],[48,4.5,24],[37,0,2]];
  const fit=new T.PerspectiveCamera(camera.fov,w/h,.02,700);
  for(let pass=0;pass<3;pass++){
   fit.position.copy(position);fit.lookAt(target);fit.updateMatrixWorld();
   const projected=points.map(([x,y,z])=>new T.Vector3(x,y,z+berthShift).project(fit));
   const xs=projected.map(p=>(p.x+1)*w/2),ys=projected.map(p=>(1-p.y)*h/2);
   const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
   const zoom=Math.max(1,(x1-x0)/(right-left),(y1-y0)/(bottom-top));
   const pixel=position.distanceTo(target)*2*Math.tan(fit.fov*Math.PI/360)/h;
   const move=new T.Vector3(((x0+x1-left-right)/2)*pixel,-((y0+y1-top-bottom)/2)*pixel,0).applyQuaternion(fit.quaternion);
   position.sub(target).multiplyScalar(zoom).add(target).add(move);target.add(move);
  }
  return {target,position};
 }
 function resize(){
  if(disposed)return;
  const rect=host.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;
  const changed=w!==rect.width||h!==rect.height;
  w=rect.width;h=rect.height;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(changed&&['overview','top','ship'].includes(viewName)&&!flight){const p=pose(viewName);camera.position.copy(p.position);controls.target.copy(p.target);controls.update();}
 }
 function fly(position,target){
  flight={start:performance.now(),from:camera.position.clone(),to:position,origin:controls.target.clone(),target};
 }
 let followTarget=null,followFlight=null,previousFrame=0,renderedFrames=0,renderedSnapshotTime=null,lastRenderedAt=null;
 function reportView(){host.dispatchEvent(new CustomEvent('portviewchange',{detail:{view:viewName,follow:followTarget?{...followTarget}:null}}));}
 function setView(view='overview'){
  if(!views[view])return false;clearHint();followTarget=null;viewName=view;const p=pose(view);fly(p.position,p.target);reportView();return true;
 }
 
 let cargoInstances=null,cargoRecords=[],cargoSlots=[],cargoDirty=false;
 let hardware=null,hardwareOwner=null,hardwareKey='';
 // A single instanced front panel identifies refrigerated containers in close-up.
 const coolerCanvas=document.createElement('canvas');coolerCanvas.width=256;coolerCanvas.height=288;
 const cc=coolerCanvas.getContext('2d');
 cc.fillStyle='#d8dbd1';cc.fillRect(0,0,256,288);cc.strokeStyle='#83918d';cc.lineWidth=5;cc.strokeRect(5,5,246,278);
 cc.fillStyle='#576866';cc.fillRect(16,28,219,119);cc.fillStyle='#a4b0a8';
 for(let j=0;j<16;j++)cc.fillRect(18,30+j*7,215,3);
 cc.fillStyle='#889891';cc.fillRect(20,159,134,104);
 for(const x of [56,116]){
  cc.fillStyle='#52625e';cc.beginPath();cc.arc(x,211,26,0,2*Math.PI);cc.fill();
  for(let j=0;j<6;j++){cc.strokeStyle='#aab4a8';cc.lineWidth=2;cc.beginPath();cc.arc(x,211,3+j*4,0,2*Math.PI);cc.stroke();}
 }
 cc.fillStyle='#8c9792';cc.fillRect(166,160,65,104);cc.fillStyle='#364d4d';cc.fillRect(172,169,53,23);cc.fillStyle='#b8cec1';cc.fillRect(177,174,32,8);cc.fillStyle='#e1bc61';cc.fillRect(177,219,37,16);
 const coolerTexture=new T.CanvasTexture(coolerCanvas);coolerTexture.colorSpace=T.SRGBColorSpace;
 const coolerMaterial=new T.MeshStandardMaterial({map:coolerTexture,roughness:.77,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-1});
 const coolerPlane=new T.PlaneGeometry(1,1);let coolers=null,coolerSlots=[];
 const cargoTransform=new T.Object3D(),cargoColor=new T.Color();
 function allocateCargo(records){
  if(!cargoInstances||records.length>cargoInstances.instanceMatrix.count){
   if(cargoInstances){dynamic.remove(cargoInstances);cargoInstances.dispose();}
   const capacity=2**Math.ceil(Math.log2(Math.max(16,records.length)));
   cargoInstances=new T.InstancedMesh(models.cargoGeo,models.material('container'),capacity);
   cargoInstances.instanceMatrix.setUsage(T.DynamicDrawUsage);cargoInstances.castShadow=true;cargoInstances.receiveShadow=true;
   cargoInstances.frustumCulled=false;dynamic.add(cargoInstances);
  }
  const refrigerated=records.filter(r=>r.refrigerated);
  if(!coolers||refrigerated.length>coolers.instanceMatrix.count){
   if(coolers){dynamic.remove(coolers);coolers.dispose();}
   coolers=new T.InstancedMesh(coolerPlane,coolerMaterial,Math.max(16,refrigerated.length));
   coolers.frustumCulled=false;dynamic.add(coolers);
  }
  coolerSlots=refrigerated.map(r=>r.model.userData.pick);coolers.count=refrigerated.length;
  refrigerated.forEach((r,i)=>{
   const yaw=r.model.rotation.y;
   cargoTransform.position.copy(r.model.position);cargoTransform.position.y+=r.height/2;
   cargoTransform.position.x-=Math.cos(yaw)*r.length/2;cargoTransform.position.z+=Math.sin(yaw)*r.length/2;
   cargoTransform.rotation.y=yaw-Math.PI/2;cargoTransform.scale.set(r.width*.985,r.height*.97,1);
   cargoTransform.updateMatrix();coolers.setMatrixAt(i,cargoTransform.matrix);
  });
  coolers.instanceMatrix.needsUpdate=true;
  cargoRecords=records;cargoSlots=records.map(rec=>rec.model.userData.pick);cargoInstances.count=records.length;
  records.forEach((rec,i)=>cargoInstances.setColorAt(i,cargoColor.set(rec.color)));
  if(cargoInstances.instanceColor)cargoInstances.instanceColor.needsUpdate=true;cargoDirty=true;
 }
 function syncCargo(){
  if(!cargoDirty||!cargoInstances)return;
  cargoRecords.forEach((rec,i)=>{
   cargoTransform.position.copy(rec.model.position);cargoTransform.position.y+=rec.height/2;
   cargoTransform.rotation.y=rec.model.rotation.y;cargoTransform.scale.set(rec.length,rec.height,rec.width);cargoTransform.updateMatrix();
   cargoInstances.setMatrixAt(i,cargoTransform.matrix);
  });
  cargoInstances.instanceMatrix.needsUpdate=true;cargoDirty=false;
 }
 function register(type,id,model,poseFn=()=>{}){
  const key=toKey(type,id);model.userData.pick={type,id};dynamic.add(model);
  const record={model,pose:poseFn,point:new T.Vector3(),pointOffset:new T.Vector3()};refs.set(key,record);return record;
 }
 function disposeInstances(group){group.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose();});}
 function update(snap,choice){
  if(disposed||!snap)return;
  if(followTarget&&choice&&lastChoice&&(lastChoice.id!==choice.id||lastChoice.type!==choice.type))followTarget={...choice};
  contentRevision++;latest=snap;lastChoice=choice;renderer.shadowMap.needsUpdate=true;
  const visibleCargo=[],wanted=new Set(),cargoById=new Map(snap.containers.map(c=>[c.id,c]));
  const extent=snap.layoutExtent??snap.containers.length;
  const key=[extent,...['yardCapacity','et','agv','smv','bay','rmg','yc','qc'].map(k=>snap.config[k])].join('/');
  if(key!==terminalKey){
   terminalKey=key;layout=buildLayout(snap.config,extent);
   if(furniture){scene.remove(furniture);disposeInstances(furniture);}
   if(networkSite){scene.remove(networkSite);disposeInstances(networkSite);}
   const network=models.batch();
   siteInfo=models.infrastructure(network,layout,world,clearOfTraffic);
   networkSite=network.finish();for(const junction of siteInfo.guideway.switches)networkSite.add(junction.model);scene.add(networkSite);
   furniture=models.terminalFurniture(snap,world,layout);scene.add(furniture);
   surfaces.setLayout(layout,world);updateLamps(siteInfo.lamps);
   const zMin=(layout.bounds.minY-330)/10,zMax=(layout.bounds.maxY-330)/10;
   water.scale.y=Math.max(1,(zMax-zMin+1200)/1600);water.position.z=(zMin+zMax)/2;district.position.z=Math.min(0,zMin+51);hills.position.z=district.position.z;
   const hullCount=Math.max(1,Math.ceil(snap.containers.length/240));
   while(fleetHulls.length>hullCount){const hull=fleetHulls.pop();scene.remove(hull);disposeInstances(hull);}
   while(fleetHulls.length<hullCount){
    const index=fleetHulls.length*240,slot=snap.containers[index]?.shipSlot;
    if(!slot)break;const hull=ship.clone();hull.position.z+=(slot.pose.y-snap.containers[0].shipSlot.pose.y)/10;
    scene.add(hull);fleetHulls.push(hull);
   }
   updateShipLamps();
  }
  if(!snap.energy?.enabled||energyLayout!==layout){
   if(charging){scene.remove(charging.group);charging.dispose();charging=null;}
   energyLayout=null;
  }
  if(snap.energy?.enabled){
   if(!charging){charging=createChargeContacts(layout,world,models);scene.add(charging.group);energyLayout=layout;}
   charging.update(snap);
  }
  const trolleys=snap.resources.filter(r=>r.kind==='SMV');
  for(const junction of siteInfo.guideway.switches){
   let closest=null,range=15.2;
   for(const r of trolleys){const d=Math.hypot(r.pose.x-junction.x,r.pose.y-junction.y);if(d<range){closest=r;range=d;}}
   junction.model.rotation.y=-(closest?.pose.heading??junction.defaultHeading);
  }
  for(const r of snap.resources){
   const k=toKey('resource',r.id);wanted.add(k);let rec=refs.get(k);
   if(!rec){const asset=models.vehicle(r.kind,idNumber(r.id));rec=register('resource',r.id,asset.model,asset.pose);}
   const pose=r.pose;
   rec.model.position.copy(world(pose));rec.model.rotation.y=-pose.heading+(cranes.has(r.kind)?Math.PI/2:0);
   rec.pointOffset.set(0,r.kind==='SMV'?-.09:cranes.has(r.kind)?2.5:.13,0);
   rec.point.copy(rec.model.position).add(rec.pointOffset);
   if(cranes.has(r.kind)||r.kind==='SMV'){
    const target=r.spreaderPose;
    const box=cargoById.get(r.containerId);
    // Keep spreader and box motion in a single snapshot. Transform the absolute
    // contact plane into crane-local coordinates once, including gantry heading.
    const contact=target?world(target).sub(rec.model.position).applyAxisAngle(new T.Vector3(0,1,0),-rec.model.rotation.y):
      new T.Vector3(0,r.kind==='SMV'?-.20:r.kind==='QC'?5.8:1.7,0);
    rec.hook=rec.pose(contact,box?cargoSize(box.type).length:1.2192,target?-target.heading-rec.model.rotation.y:0);
    if(target)rec.pointOffset.copy(world(target)).sub(rec.model.position);
   }
  }
  updateWorkLights();
  for(const c of snap.containers){
   const k=toKey('container',c.id);wanted.add(k);let rec=refs.get(k);
   if(!rec)rec=register('container',c.id,new T.Group());
   Object.assign(rec,cargoSize(c.type));rec.refrigerated=c.type==='冷藏箱';
   const palette=['#b85e3d','#b79d5f','#438487','#5c7a96','#a9744d','#778c70'];
   const base=c.type==='冷藏箱'?'#c9c9b6':palette[idNumber(c.id)%palette.length];
   rec.color=c.status==='scheduled'?'#'+cargoColor.set(base).lerp(new T.Color('#939a93'),.42).getHexString():base;
   const pose=c.pose;
   rec.model.position.copy(world(pose));rec.model.rotation.y=-pose.heading;rec.custody=c.custody;
   rec.pointOffset.set(0,rec.height/2,0);rec.point.copy(rec.model.position).add(rec.pointOffset);
   visibleCargo.push(rec);
  }
  for(const [k,rec] of refs)if(!wanted.has(k)){dynamic.remove(rec.model);disposeInstances(rec.model);refs.delete(k);}
  allocateCargo(visibleCargo);syncCargo();
  const hardwareCargo=choice?.type==='container'?cargoById.get(choice.id):cargoById.get(snap.resources.find(r=>r.id===choice?.id)?.containerId);
  const nextHardwareKey=hardwareCargo?hardwareCargo.id+'/'+hardwareCargo.type:'';
  if(hardwareKey!==nextHardwareKey){
   if(hardware){hardwareOwner?.remove(hardware);disposeInstances(hardware);hardware=null;}
   hardwareKey=nextHardwareKey;hardwareOwner=null;
   if(hardwareCargo&&models.containerHardware){hardware=models.containerHardware(hardwareCargo.type);hardwareOwner=refs.get(toKey('container',hardwareCargo.id))?.model;hardwareOwner?.add(hardware);}
  }
  const sel=choice&&refs.get(toKey(choice.type,choice.id));ring.visible=!!sel;
  const selectedBox=cargoById.get(choice?.id);
  const mover=choice?.type==='resource'?snap.resources.find(r=>r.id===choice.id):
   snap.resources.find(r=>r.id===selectedBox?.custody?.id&&r.route?.points?.length);
  const path=mover?.route?.points||mover?.route;
  route.visible=Array.isArray(path)&&path.length>1;
  if(route.visible){
   const height=mover.kind==='SMV'?1.39:.018;
   route.geometry.dispose();route.geometry=new T.BufferGeometry().setFromPoints(path.map(p=>world(p).setY(height)));route.computeLineDistances();
  }
  if(sel){
   ring.position.copy(sel.point).y+=.16;
   const subtitle=snap.energy?.enabled&&choice.type==='resource'?energyLabel(snap.resources.find(r=>r.id===choice.id)):'';
   if(selectedLabel?.userData.id!==choice.id||selectedLabel?.userData.subtitle!==subtitle){
    if(selectedLabel){scene.remove(selectedLabel);selectedLabel.material.map.dispose();selectedLabel.material.dispose();}
    selectedLabel=stationLabel(choice.id,subtitle);selectedLabel.userData.id=choice.id;selectedLabel.userData.subtitle=subtitle;selectedLabel.material.depthTest=false;selectedLabel.renderOrder=3;scene.add(selectedLabel);
   }
   selectedLabel.visible=true;selectedLabel.position.copy(sel.point).y+=2.45;
  }else if(selectedLabel)selectedLabel.visible=false;
  if(software)compatibility.apply(scene);refreshHint();
 }
 function follow(type,id){
  const rec=refs.get(toKey(type,id));if(!rec)return false;clearHint();
  followTarget={type,id};followFlight={start:performance.now(),position:camera.position.clone(),target:controls.target.clone()};viewName='follow';flight=null;reportView();return true;
 }
 function setFollow(value){
  if(!value){followTarget=null;viewName='custom';reportView();return true;}
  return !!lastChoice&&follow(lastChoice.type,lastChoice.id);
 }
 function focus(type,id){
  clearHint();
  if(type==='chargeContact'){
   const slot=charging?.slots.find(s=>s.id===id);if(!slot)return false;
   const target=slot.face.clone(),offset=new T.Vector3(.14,.20,.55).applyAxisAngle(new T.Vector3(0,1,0),-slot.heading);
   target.y+=.018;followTarget=null;viewName='custom';fly(target.clone().add(offset),target);reportView();return true;
  }
  const rec=refs.get(toKey(type,id));
  const slot=type==='railSlot'||type==='shipSlot'?latest?.containers.find(c=>c[type]?.id===id)?.[type]:null;
  if(!rec&&!slot)return false;
  const target=rec?rec.point.clone():world(slot.pose),dir=camera.position.clone().sub(controls.target).normalize();dir.y=Math.max(.38,dir.y);dir.normalize();
  followTarget=null;viewName='custom';fly(target.clone().addScaledVector(dir,cranes.has(id.split('-')[0])?13:3.4),target);reportView();return true;
 }
 function setNight(value){
  night=!!value;renderer.shadowMap.needsUpdate=true;nightLights.visible=night;if(!software)sky.material.uniforms.night.value=night?1:0;
  sky.visible=true;scene.background=new T.Color(night?'#101f31':'#adc5cb');scene.fog.color.set(night?'#15283a':'#a5bbbf');scene.fog.density=night?.0031:.00235;
  if(software)compatibility.setNight(night);else water.material.uniforms.uNight.value=night?1:0;scene.environmentIntensity=night?.087:.43;
  sun.color.set(night?'#b7d6f3':'#ffe4c2');sun.intensity=night?.53:2.72;hemi.intensity=night?.25:.42;fill.intensity=night?.085:.20;renderer.toneMappingExposure=night?1.03:.94;
 }
 const ray=new T.Raycaster();
 function pointRay(e){
  const r=canvas.getBoundingClientRect();
  ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);
 }
 function picked(){
  if(cargoInstances)cargoInstances.computeBoundingSphere();if(coolers)coolers.computeBoundingSphere();
  const targets=[dynamic,site,...fleetHulls,...(furniture?[furniture,networkSite]:[]),...(charging?[charging.group]:[])];
  const hit=ray.intersectObjects(targets,true)[0];if(!hit)return null;
  const station=hit.object.userData.stationIds?.[hit.instanceId];
  if(station)return {type:'resource',id:station,station:hit.object.userData.atContact[hit.instanceId]};
  if(hit.object===cargoInstances||hit.object===coolers)return (hit.object===coolers?coolerSlots:cargoSlots)[hit.instanceId]||null;
  let o=hit.object;while(o&&!o.userData.pick)o=o.parent;return o?.userData.pick||null;
 }
 const hint=document.createElement('div');hint.hidden=true;hint.setAttribute('role','tooltip');
 hint.style.cssText='position:fixed;z-index:9;pointer-events:none;padding:6px 10px;border:1px solid #7cb2b6;border-radius:5px;background:#102b36;color:#eaf6f4;font:600 14px/1.4 system-ui,sans-serif;white-space:nowrap';
 host.append(hint);
 let hoverTimer=0,hoverId=null,hoverPose=null;
 function clearHint(){clearTimeout(hoverTimer);hoverTimer=0;hoverId=null;hoverPose=null;hint.hidden=true;}
 function refreshHint(){
  if(!hoverId)return;const r=latest?.resources.find(r=>r.id===hoverId);
  if(hoverPose&&r&&(Math.hypot(r.pose.x-hoverPose.x,r.pose.y-hoverPose.y)>.18||Math.abs(Math.sin(r.pose.heading-hoverPose.heading))>.09)){clearHint();return;}
  const value=latest?.energy?.enabled?energyLabel(r):'';
  if(!value){clearHint();return;}hint.textContent=hoverId+' · '+value;
 }
 function hover(e){
  clearHint();if(!charging||e.buttons||e.pointerType==='touch')return;
  const x=e.clientX,y=e.clientY;
  hoverTimer=setTimeout(()=>{
   pointRay({clientX:x,clientY:y});
   // Only perform the full occlusion pick when the ray is beside an AGV or
   // its parking head. This avoids traversing the large yard on empty hovers.
   if(!charging.slots.some(s=>{const p=refs.get(toKey('resource',s.id))?.point;return p&&ray.ray.distanceToPoint(p)<.91||ray.ray.distanceToPoint(s.face)<.18;}))return;
   const obj=picked();if(!obj||obj.type!=='resource')return;
   hoverId=obj.id;hoverPose=obj.station?null:latest.resources.find(r=>r.id===hoverId)?.pose;refreshHint();if(!hoverId)return;
   hint.hidden=false;hint.style.left=Math.max(4,Math.min(window.innerWidth-hint.offsetWidth-6,x+12))+'px';
   hint.style.top=Math.max(4,Math.min(window.innerHeight-hint.offsetHeight-6,y+13))+'px';
  },140);
 }
 function pointerDown(e){clearHint();down={x:e.clientX,y:e.clientY,id:e.pointerId};}
 function pointerUp(e){
  if(!down||down.id!==e.pointerId||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down=null;return;}down=null;
  pointRay(e);const obj=picked();if(obj)onSelect({type:obj.type,id:obj.id});
 }
 const contactCloseup=e=>{if(!charging)return;pointRay(e);const o=picked();if(o?.station)focus('chargeContact',o.id);};
 canvas.addEventListener('dblclick',contactCloseup);
 canvas.addEventListener('pointermove',hover);canvas.addEventListener('pointerleave',clearHint);
 const manual=()=>{clearHint();if(viewName==='custom'&&!flight&&!followTarget)return;followTarget=null;flight=null;viewName='custom';reportView();};
 const drag=e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)manual();};
 canvas.addEventListener('pointermove',drag);canvas.addEventListener('wheel',manual,{passive:true});
 canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);
 canvas.addEventListener('pointercancel',()=>{down=null;});
 // Test lines of sight against the nearby moving gantries before settling into
 // a close tracking shot. Test the two ends as well as the centre of the load.
 const sight=new T.Raycaster(),vertical=new T.Vector3(0,1,0);
 let followDirection=null,directionKey='';
 function trackingOffset(rec){
  const key=followTarget.type+followTarget.id+':'+latest.time+':'+rec.model.rotation.y;
  if(directionKey===key&&followDirection)return followDirection.clone();
  directionKey=key;
  const raised=rec.model.position.y>.52&&rec.model.position.y<1.26;
  const chargeSlot=charging?.slots.find(s=>s.id===followTarget.id);
  const atCharger=chargeSlot&&rec.model.position.distanceTo(chargeSlot.position)<.002;
  const preferred=atCharger?new T.Vector3(.63,.47,2.10).applyAxisAngle(vertical,-chargeSlot.heading):
   new T.Vector3(-1.5,.84,raised?-2.1:2.1).applyAxisAngle(vertical,rec.model.rotation.y);
  if(cranes.has(followTarget.id.split('-')[0]))preferred.multiplyScalar(5.2);
  const obstacles=[...refs.values()].filter(r=>r!==rec&&cranes.has(r.model.userData.pick.id.split('-')[0])&&r.model.position.distanceTo(rec.point)<18).map(r=>r.model);
  for(const obstacle of obstacles)obstacle.updateWorldMatrix(true,true);
  const side=new T.Vector3((rec.length||1.2)*.39,0,0).applyAxisAngle(vertical,rec.model.rotation.y);
  const probes=[rec.point.clone(),rec.point.clone().add(side),rec.point.clone().sub(side)];
  let best=-1;
  for(const angle of [0,Math.PI/2,-Math.PI/2,Math.PI,.78,-.78,2.36,-2.36]){
   const offset=preferred.clone().applyAxisAngle(vertical,angle),cameraPoint=rec.point.clone().add(offset);
   const score=probes.reduce((sum,p)=>{
    const delta=cameraPoint.clone().sub(p);sight.far=delta.length();sight.near=.014;
    sight.set(p,delta.normalize());return sum+Number(!sight.intersectObjects(obstacles,true).length);
   },0);
   if(score>best){followDirection=offset;best=score;}if(score===3)break;
  }
  return followDirection.clone();
 }
 function frame(t){
  if(disposed)return;animation=requestAnimationFrame(frame);
  if(document.hidden||!host.isConnected||!host.getClientRects().length||t-previousFrame<1000/32)return;
  const dt=Math.min(1,Math.max(.001,(t-previousFrame)*.001));previousFrame=t;
  for(const rec of refs.values()){
   rec.point.copy(rec.model.position).add(rec.pointOffset);
  }
  syncCargo();
  const selected=lastChoice&&refs.get(toKey(lastChoice.type,lastChoice.id));
  if(selected&&selectedLabel){
   const isBox=lastChoice.type==='container';
   ring.scale.set(isBox?selected.length+.025:1.53,1,isBox?selected.width+.024:.33);
   ring.rotation.y=selected.model.rotation.y;ring.position.copy(selected.model.position).y+=isBox?selected.height+.012:.016;
   selectedLabel.position.copy(selected.point).y+=(followTarget?.id===lastChoice.id ? .46 : 1.0);
  }
  if(followTarget){
   const rec=refs.get(toKey(followTarget.type,followTarget.id));
   if(rec){
    const target=rec.point,dir=trackingOffset(rec);
    const desired=dir.add(target);
    if(followFlight){const p=Math.min(1,(t-followFlight.start)/560),u=smooth(p);
     controls.target.lerpVectors(followFlight.target,target,u);camera.position.lerpVectors(followFlight.position,desired,u);if(p===1)followFlight=null;
    }else{const catchUp=1-Math.exp(-dt*8.5);controls.target.lerp(target,catchUp);camera.position.lerp(desired,catchUp);}
   }else{followTarget=null;viewName='custom';reportView();}
  }
  if(flight){const p=Math.min(1,(t-flight.start)/560),u=smooth(p);camera.position.lerpVectors(flight.from,flight.to,u);controls.target.lerpVectors(flight.origin,flight.target,u);if(p>=1)flight=null;}
  controls.update();sky.position.copy(camera.position);
  const distance=camera.position.distanceTo(controls.target),extent=distance<6?3.5:distance<25?18:82;
  if(software){
   // Conventional depth allows early pixel rejection on CPU devices. Move
   // the clipping plane out with camera distance to keep coplanar markings
   // and the remote apron distinct without writing log depth per fragment.
   const near=Math.max(.055,Math.min(1.65,distance*.020));
   if(Math.abs(camera.near-near)>.001){camera.near=near;camera.updateProjectionMatrix();}
  }
  if(sun.target.position.distanceTo(controls.target)>.15||sun.shadow.camera.right!==extent){
   sun.target.position.copy(controls.target);sun.position.copy(controls.target).add(daylightOffset);
   Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});sun.shadow.camera.updateProjectionMatrix();
   sun.shadow.normalBias=extent<5?.0008:extent<25?.003:.008;renderer.shadowMap.needsUpdate=true;
  }
  if(hardware)hardware.visible=!!hardwareOwner&&camera.position.distanceTo(hardwareOwner.position)<24;

  for(const label of labelSprites){
   label.visible=!followTarget&&['overview','top','custom'].includes(viewName)&&camera.position.distanceTo(controls.target)>35;
   const size=Math.max(1.0,Math.min(23,camera.position.distanceTo(label.position)*.73*123/h));
   label.scale.set(size,size*.219,1);
  }
  if(selectedLabel&&selected)selectedLabel.visible=!(['ship','rail','yard'].includes(viewName)&&selected.point.distanceTo(controls.target)>19);
  if(selectedLabel?.visible){const size=camera.position.distanceTo(selectedLabel.position)*.73*118/h;selectedLabel.scale.set(size,size*(selectedLabel.userData.subtitle ? .365 : .219),1);}
  if(!software){
   water.material.uniforms.uTime.value=t*.001;
   reflection.update(scene,camera,[ring,route,selectedLabel,...labelSprites],contentRevision+'/'+night+'/'+surfaces.status.loaded,t,w,h);
  }
  renderer.render(scene,camera);renderedFrames++;renderedSnapshotTime=latest?.time??null;lastRenderedAt=performance.now();
 }
 function dispose(){
  if(disposed)return;disposed=true;cancelAnimationFrame(animation);observer.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointermove',drag);canvas.removeEventListener('wheel',manual);
  canvas.removeEventListener('dblclick',contactCloseup);canvas.removeEventListener('pointermove',hover);canvas.removeEventListener('pointerleave',clearHint);clearHint();hint.remove();
  if(charging){scene.remove(charging.group);charging.dispose();charging=null;}
  const geometries=new Set(),mats=new Set(),textures=new Set();
  scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of [].concat(o.material)){mats.add(m);if(m.map)textures.add(m.map);}});
  for(const g of geometries)g.dispose();for(const m of mats)m.dispose();for(const tex of textures)tex.dispose();models.dispose();compatibility?.dispose();reflection?.dispose();surfaces.dispose();sun.shadow.dispose();renderer.dispose();canvas.remove();refs.clear();
 }
 function getStats(){return {mode:'webgl',energyContacts:charging?.stats()??[],renderBackend:software?'software':'hardware',renderProfile:software?'compatibility':'full',renderEffects:{pbr:!software,shadowMaps:!software,planarReflections:!software,stockRepresentation:software?'grouped-decorative-rows':'individual-decorative-boxes'},pixelRatio:renderer.getPixelRatio(),reflectionCaptures:reflection?.captures??0,snapshotTime:latest?.time??null,renderedSnapshotTime,lastRenderedAt,layout:layout&&{version:layout.version,corridors:layout.corridors.length,berths:layout.berths.length,parking:layout.parking.length,stackBlocks:siteInfo.blocks,guidewaySegments:siteInfo.guideway.segments.length,guidewayPiers:siteInfo.guideway.supportPoints.length,rotaryJunctions:siteInfo.guideway.switches.map(j=>({x:j.x,y:j.y,heading:-j.model.rotation.y})),fixtures:siteInfo.fixtures},renderedFrames,assets:{...surfaces.status},hardware:hardware?.visible?hardwareKey:null,camera:{target:controls.target.toArray(),position:camera.position.toArray(),near:camera.near,far:camera.far,maxOrbitDistance:controls.maxDistance},resources:latest?.resources.length||0,containers:[...refs.keys()].filter(k=>k.startsWith('container:')).length,selected:lastChoice,follow:followTarget,night,view:viewName,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,resourceModels:[...refs.values()].filter(r=>r.model.userData.pick.type==='resource').map(r=>({id:r.model.userData.pick.id,world:r.model.position.toArray(),hook:r.hook?.getWorldPosition(new T.Vector3()).toArray()||null})),cargoModels:cargoRecords.map(r=>({id:r.model.userData.pick.id,length:r.length,width:r.width,height:r.height,color:r.color,world:{x:r.model.position.x,y:r.model.position.y,z:r.model.position.z},custody:r.custody}))};}
 resize();const p=pose('overview');camera.position.copy(p.position);controls.target.copy(p.target);controls.update();animation=requestAnimationFrame(frame);
 return {update,resize,setView,focus,follow,setFollow,setNight,dispose,getStats};
}
