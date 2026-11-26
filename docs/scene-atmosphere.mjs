import * as T from './vendor/three/three.module.js';

export const daylightOffset=new T.Vector3(-57,46,26);
const direction=daylightOffset.clone().normalize();

export function harborWater(){
 const material=new T.ShaderMaterial({
  uniforms:{harborCapture:{value:null},captureMatrix:{value:new T.Matrix4()},captureReady:{value:0},uTime:{value:0},uNight:{value:0},skyMap:{value:null},hasSky:{value:0},sunward:{value:direction},portLights:{value:[new T.Vector4(),new T.Vector4()]}},
  vertexShader:`
   #include <common>
   #include <logdepthbuf_pars_vertex>
   varying vec3 worldPos;
   void main(){
    vec4 p=modelMatrix*vec4(position,1.);worldPos=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;
    #include <logdepthbuf_vertex>
   }`,
  fragmentShader:`
   #include <common>
   #include <logdepthbuf_pars_fragment>
   uniform float uTime,uNight,hasSky;uniform vec3 sunward;uniform sampler2D skyMap;
   uniform vec4 portLights[2];uniform sampler2D harborCapture;uniform mat4 captureMatrix;uniform float captureReady;varying vec3 worldPos;
   float random2(vec2 p){vec3 v=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
   // Analytic gradient of interpolated noise. Multiple advected scales give
   // the sheltered basin capillary ripples without parallel sine-wave bands.
   vec3 noiseGrad(vec2 p){
    vec2 cell=floor(p),f=fract(p),u=f*f*(3.-2.*f),d=6.*f*(1.-f);
    float a=random2(cell),b=random2(cell+vec2(1,0)),c=random2(cell+vec2(0,1)),e=random2(cell+1.);
    float k=a-b-c+e;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,d*vec2(b-a+k*u.y,c-a+k*u.x));
   }
   void main(){
    vec2 p=worldPos.xz,wind=vec2(.84,.54);float t=uTime*.11;
    vec3 gust=noiseGrad(p*.12-wind*t*.10);
    mat2 turn=mat2(.73,-.68,.68,.73);
    vec2 drift=p+vec2(gust.x*1.92,gust.x*.72);
    vec3 longR=noiseGrad(turn*(drift*vec2(.86,1.85))-wind*t*.65);
    vec3 shortR=noiseGrad(turn*turn*(drift*vec2(3.6,2.2))+wind*t*1.65);
    vec3 fineR=noiseGrad(turn*(drift*vec2(8.7,12.7))-wind*t*2.7);
    vec3 eye=normalize(cameraPosition-worldPos);float dist=distance(cameraPosition,worldPos);
    vec2 slope=longR.yz*.032+shortR.yz*(.015+.020*gust.x)+fineR.yz*.014*(1.-smoothstep(42.,155.,dist));
    vec3 n=normalize(vec3(slope.x,1.,slope.y)),ref=reflect(-eye,n);
    ref.y=max(.035,ref.y);ref=normalize(ref);
    vec2 skyUV=vec2(atan(ref.z,ref.x)*RECIPROCAL_PI2+.5,asin(ref.y)*RECIPROCAL_PI+.5);
    vec3 photo=texture2D(skyMap,skyUV).rgb*.5+texture2D(skyMap,skyUV+vec2(.012,.006)).rgb*.25+texture2D(skyMap,skyUV-vec2(.012,.006)).rgb*.25;
    vec3 sky=mix(vec3(.26,.37,.43),min(photo,vec3(1.8))*.56,hasSky*.69);
    sky=mix(sky,vec3(.028,.058,.105),uNight);
    vec4 projected=captureMatrix*vec4(worldPos,1.);
    vec2 uv=projected.xy/max(.001,projected.w)*.5+.5;
    float border=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
    float coast=1.-smoothstep(0.,50.,worldPos.x-44.3);
    vec2 warp=slope*(.026+.018*clamp(dist/100.,0.,1.));
    vec3 hull=texture2D(harborCapture,clamp(uv+warp,.001,.999)).rgb;
    sky=mix(sky,min(hull,vec3(2.7)),captureReady*smoothstep(0.,.020,border)*coast*.88);
    float fresnel=.065+.67*pow(1.-max(0.,dot(n,eye)),4.3);
    vec3 body=mix(vec3(.020,.084,.095),vec3(.005,.015,.028),uNight);
    body*=.82+.22*gust.x+.07*longR.x;
    vec3 col=mix(body,sky,fresnel);
    float glint=pow(max(0.,dot(ref,sunward)),190.);
    col+=mix(vec3(.88,.69,.42),vec3(.025,.04,.07),uNight)*glint;
    // A small broken reflection is visible directly seaward of an actual lit
    // crane. The light origins follow the equipment when it moves along rail.
    for(int i=0;i<2;i++){
     vec2 d=p-portLights[i].xz;
     float reach=exp(-abs(d.x)*.22)*exp(-d.y*d.y/(.4+abs(d.x)*.50));
     col+=uNight*portLights[i].w*reach*(.12+max(0.,shortR.y)*.35)*vec3(.47,.39,.23);
    }
    col=mix(col,mix(vec3(.39,.48,.50),vec3(.027,.045,.068),uNight),smoothstep(90.,570.,dist)*.69);
    gl_FragColor=vec4(col,1.);
    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
 const mesh=new T.Mesh(new T.PlaneGeometry(1600,1600),material);
 mesh.rotation.x=-Math.PI/2;mesh.position.set(65,-.72,0);return mesh;
}

function hash(x,z){const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);}
function noise(x,z){
 const i=Math.floor(x),j=Math.floor(z),fx=x-i,fz=z-j,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 const a=hash(i,j),b=hash(i+1,j),c=hash(i,j+1),d=hash(i+1,j+1);
 return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function coastHeight(x,z){
 const shoreline=-148+noise(x*.018,2)*24+8*Math.sin(x*.039),inland=shoreline-z;
 if(inland<0)return Math.max(-1.12,-.75+inland*.045);
 const rise=Math.min(1,inland/40),ridge=noise(x*.012,z*.016)*12+noise(x*.035,z*.040)*4.8;
 return -.72+rise*(1.6+ridge*.71)+Math.max(0,inland-54)*.012;
}
export function coastalBackdrop({compact=false}={}){
 const root=new T.Group(),g=new T.PlaneGeometry(800,240,compact?42:160,compact?14:54);g.rotateX(-Math.PI/2);
 const verts=g.attributes.position,colors=[],c=new T.Color(),woods=new T.Color('#354c43'),stone=new T.Color('#788174'),far=new T.Color('#607981');
 for(let i=0;i<verts.count;i++){
  const x=verts.getX(i),z=verts.getZ(i)-229,y=coastHeight(x,z),patch=noise(x*.063,z*.076);
  verts.setXYZ(i,x,y,z);
  c.copy(woods).lerp(stone,Math.max(0,patch-.25)*.69).lerp(far,Math.min(.40,Math.max(0,-z-148)*.0018));
  c.multiplyScalar(.88+.18*noise(x*.17,z*.13));colors.push(c.r,c.g,c.b);
 }
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();
 root.add(new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0})));
 if(compact)return root;
 // Place a low irregular belt on the distant ridge. The entire backdrop is
 // shifted behind the active layout, including larger northern parking areas.
 const geo=new T.IcosahedronGeometry(1,1),pos=geo.attributes.position;
 for(let i=0;i<pos.count;i++){
  const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),r=.83+.25*noise(x*6+y*2,z*5);
  pos.setXYZ(i,x*r,y*(.89+.17*r),z*r);
 }
 geo.computeVertexNormals();
 const points=[];
 for(let cluster=0;cluster<125;cluster++){
  const cx=-238+hash(cluster,11)*401,cz=-183+hash(cluster,19)*49;
  for(let j=0;j<11;j++){
   const i=cluster*11+j,x=cx+(hash(i,13)-.5)*4.8,z=cz+(hash(i,25)-.5)*3.6,y=coastHeight(x,z);
   if(y<.3||noise(cx*.066,cz*.083)<.43)continue;
   points.push({x,y,z,r:.35+hash(i,4)*.44});
  }
 }
 const foliage=new T.InstancedMesh(geo,new T.MeshStandardMaterial({roughness:1}),points.length),dummy=new T.Object3D();
 points.forEach(({x,y,z,r},i)=>{
  dummy.position.set(x,y+r*.45,z);dummy.scale.set(r*(1.1+hash(i,9)*.6),r*(.8+hash(i,2)*.7),r);dummy.rotation.y=hash(i,1)*6.28;dummy.updateMatrix();
  foliage.setMatrixAt(i,dummy.matrix);c.set(i%5===0?'#667359':i%3===0?'#506752':'#485f51');foliage.setColorAt(i,c);
 });
 root.add(foliage);return root;
}

// Render a small planar capture only when a scene state or camera change
// makes it necessary. High frequency waves still move between captures.
export function harborReflection(renderer,water,software=false){
 const target=new T.WebGLRenderTarget(480,300,{type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true});
 target.texture.colorSpace=T.LinearSRGBColorSpace;
 const mirror=new T.PerspectiveCamera(),up=new T.Vector3(),forward=new T.Vector3(),point=new T.Vector3(),clip=new T.Plane(),clip4=new T.Vector4(),q=new T.Vector4();
 const lastPosition=new T.Vector3(Infinity,0,0),lastQuaternion=new T.Quaternion(),waterLevel=water.position.y;
 let lastKey='',lastTime=-Infinity,captures=0;
 const uniforms=water.material.uniforms;
 uniforms.harborCapture.value=target.texture;
 function update(scene,camera,overlays,key,t,width,height){
  if(t-lastTime<(software?270:145))return;
  if(key===lastKey&&lastPosition.distanceToSquared(camera.position)<.0001&&1-Math.abs(lastQuaternion.dot(camera.quaternion))<.000002)return;
  if(camera.position.y<waterLevel+.025)return;
  const w=Math.max(160,Math.min(software?288:512,Math.round(width*.42))),h=Math.max(100,Math.round(w*height/width));
  if(target.width!==w||target.height!==h)target.setSize(w,h);
  lastKey=key;lastTime=t;lastPosition.copy(camera.position);lastQuaternion.copy(camera.quaternion);
  camera.updateMatrixWorld();camera.getWorldDirection(forward);forward.y*=-1;
  mirror.position.copy(camera.position);mirror.position.y=2*waterLevel-mirror.position.y;
  up.set(0,1,0).applyQuaternion(camera.quaternion);up.y*=-1;mirror.up.copy(up);
  mirror.lookAt(point.copy(mirror.position).add(forward));mirror.near=camera.near;mirror.far=camera.far;
  mirror.updateMatrixWorld();mirror.projectionMatrix.copy(camera.projectionMatrix);
  // Clip the underwater hull and the underside of the land out of the pass.
  clip.set(new T.Vector3(0,1,0),-waterLevel-.002).applyMatrix4(mirror.matrixWorldInverse);
  clip4.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
  const m=mirror.projectionMatrix.elements;
  q.set((Math.sign(clip4.x)+m[8])/m[0],(Math.sign(clip4.y)+m[9])/m[5],-1,(1+m[10])/m[14]);
  clip4.multiplyScalar(2/clip4.dot(q));m[2]=clip4.x;m[6]=clip4.y;m[10]=clip4.z+1-.002;m[14]=clip4.w;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
  uniforms.captureMatrix.value.multiplyMatrices(mirror.projectionMatrix,mirror.matrixWorldInverse);
  const visible=overlays.map(o=>o?.visible),saved=renderer.getRenderTarget(),shadow=renderer.shadowMap.needsUpdate;
  try{
   water.visible=false;for(const o of overlays)if(o)o.visible=false;
   renderer.shadowMap.needsUpdate=false;renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,mirror);captures++;uniforms.captureReady.value=1;
  }finally{
   renderer.setRenderTarget(saved);renderer.shadowMap.needsUpdate=shadow;water.visible=true;
   overlays.forEach((o,i)=>{if(o)o.visible=visible[i];});
  }
 }
 return {update,get captures(){return captures;},dispose(){target.dispose();}};
}

// The background service district is kept beyond the northern edge of every
// active layout. It never supplies boxes, vehicles or work positions.
export function distantServiceDistrict(models,{compact=false}={}){
 const b=models.batch();
 b.box(-46,-.082,-95,180,.15,84,'#737e74',0,'concrete');
 for(let row=0;row<3;row++){
  for(let col=0;col<8;col++){
   const x=-126+col*21,z=-65-row*27,seed=col+row*13;
   const grass=hash(seed,8)>.66;
   b.box(x,-.012,z,19.95,.022,23.8,grass?'#65765c':seed%3===0?'#88928a':'#80908a',0,'concrete');
   if(grass)continue;
   // Warehouse ridges, skylights and truck dock doors read as a connected
   // district at a distance; colour stays muted behind the operating terminal.
   for(let k=0;k<2;k++){
    const h=.91+hash(seed,k)*.8,w=8.8+hash(seed,13+k)*6.4,d=4.4+hash(seed,22+k)*2.1,bz=z+(k-.5)*9.3;
    b.box(x,h/2,bz,w,h,d,seed%4?'#849896':'#927e6b');
    b.box(x,h+.033,bz,w+.18,.066,d+.12,seed%3?'#a5afab':'#94a3a5');
    b.box(x,h+.081,bz,w*.88,.045,.14,'#859997');
    if(!compact)for(let j=0;j<5;j++){
     const xx=x+(j-2)*w*.17;b.box(xx,h*.35,bz+d*.501,w*.085,h*.64,.025,'#526465');
     b.box(xx,h+.078,bz-d*.24,w*.13,.026,d*.13,'#77918e',0,'glass');
    }
   }
  }
 }
 if(!compact)for(let i=0;i<4;i++){
  const x=-122+i*39,z=-127,height=3.6+i%2*.55;
  for(const side of [-1,1]){
   b.rod([x+side*.39,0,z],[x+side*.095,height,z],.051,'#788886',true);
   b.rod([x+side*.39,0,z],[x-side*.18,height*.66,z],.030,'#788886',true);
  }
  b.rod([x-.69,height-.42,z],[x+.69,height-.42,z],.061,'#84958f',true);
  if(i)for(const dx of [-.57,.57]){
   b.rod([x-39+dx,height-.42-(i%2?.55:-.55),z],[x-19.5+dx,height-1.0,z],.018,'#667c7a');
   b.rod([x-19.5+dx,height-1.0,z],[x+dx,height-.42,z],.018,'#667c7a');
  }
 }
 const district=b.finish();district.traverse(o=>{if(o.isMesh)o.castShadow=false;});
 return district;
}
