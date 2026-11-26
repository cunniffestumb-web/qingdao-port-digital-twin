import * as T from './vendor/three/three.module.js';

// The same UV rectangles describe the painted surface, its corrugation normals
// and its roughness. Height data stays independent of printed labels.
export function containerFinish({albedoOnly=false}={}){
 const w=1024,h=512;
 function canvas(){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
 const albedo=canvas(),height=canvas(),normal=canvas(),rough=canvas();
 const ink=albedo.getContext('2d'),relief=height.getContext('2d');
 ink.fillStyle='#d9dbd5';ink.fillRect(0,0,w,h);
 relief.fillStyle='#888';relief.fillRect(0,0,w,h);
 function panel(x,y,pitch){
  for(let k=8;k<505;k+=pitch){
   const grad=relief.createLinearGradient(x+k,0,x+k+pitch,0);
   for(const [f,c] of [[0,173],[.24,173],[.39,106],[.65,106],[.83,173],[1,173]])grad.addColorStop(f,'rgb('+[c,c,c]+')');
   relief.fillStyle=grad;relief.fillRect(x+k,y+9,pitch,238);
   const coat=ink.createLinearGradient(x+k,0,x+k+pitch,0);
   coat.addColorStop(0,'#ecede7');coat.addColorStop(.38,'#dce0d9');coat.addColorStop(.63,'#d3d7d2');coat.addColorStop(.85,'#eeeee8');
   ink.fillStyle=coat;ink.fillRect(x+k,y+9,pitch,238);
  }
  for(const [ctx,color] of [[relief,'#b9b9b9'],[ink,'#adb4aa']]){ctx.strokeStyle=color;ctx.lineWidth=6;ctx.strokeRect(x+4,y+4,504,248);}
 }
 panel(0,0,15);panel(0,256,21);panel(512,256,32);
 for(const x of [512,768]){
  ink.fillStyle='#d8dcd5';ink.fillRect(x+4,3,248,248);
  for(let i=0;i<4;i++){
   ink.fillStyle='#c2c8be';ink.fillRect(x+11,25+i*52,233,7);
   relief.fillStyle='#b0b0b0';relief.fillRect(x+10,25+i*52,233,6);
  }
  for(const dx of [57,183]){
   ink.fillStyle='#79837b';ink.fillRect(x+dx-1,14,7,222);
   ink.fillStyle='#e1e4da';ink.fillRect(x+dx+1,15,3,220);
   relief.fillStyle='#ccc';relief.fillRect(x+dx-1,14,7,222);
   for(const y of [28,87,184,226]){ink.fillStyle='#8f9991';ink.fillRect(x+dx-5,y,15,6);}
   ink.fillStyle='#aab1a6';ink.fillRect(x+dx,164,33,5);
  }
  ink.strokeStyle='#969f96';ink.lineWidth=5;ink.strokeRect(x+3,4,249,247);
 }
 ink.fillStyle='#e6e5d8';ink.fillRect(25,30,103,24);
 ink.fillStyle='#4d5957';ink.font='bold 12px monospace';ink.fillText('INTERMODAL',31,46);
 ink.fillStyle='#eee9d2';ink.fillRect(793,19,60,17);ink.fillStyle='#56615b';ink.font='11px monospace';ink.fillText('ISO 668',799,32);
 // Modest wear follows the ribs and top/bottom rails, avoiding uniform grime.
 let seed=982451653;
 function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
 for(let i=0;i<1900;i++){
  const x=random()*w,y=random()*h,edge=y%256<14||y%256>236;
  ink.fillStyle=edge?'rgba(103,91,72,.35)':'rgba(106,114,102,.11)';
  ink.fillRect(x,y,random()*3+.3,edge?random()*3.3+.4:random()*8+.3);
 }
 // Moisture leaves dark drips below the top rail and a dusty strip near
 // the sill. Keep this narrower than a corrugation so the paint reads at scale.
 for(const y of [0,256])for(let j=0;j<33;j++){
  const x=9+random()*485,len=5+random()*38,fade=ink.createLinearGradient(x,y+7,x,y+len);
  fade.addColorStop(0,'rgba(76,65,46,.25)');fade.addColorStop(1,'rgba(88,80,62,0)');
  ink.fillStyle=fade;ink.fillRect(x,y+7,.7+random()*2.0,len);
 }
 if(albedoOnly){
  const map=new T.CanvasTexture(albedo);map.colorSpace=T.SRGBColorSpace;return {map};
 }
 const elev=relief.getImageData(0,0,w,h).data,cols=ink.getImageData(0,0,w,h).data;
 const nc=normal.getContext('2d'),rc=rough.getContext('2d'),n=nc.createImageData(w,h),r=rc.createImageData(w,h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const dx=(elev[(y*w+Math.min(w-1,x+1))*4]-elev[(y*w+Math.max(0,x-1))*4])*.018;
  const dy=(elev[(Math.min(h-1,y+1)*w+x)*4]-elev[(Math.max(0,y-1)*w+x)*4])*.018;
  const inv=1/Math.hypot(dx,dy,1);
  n.data[i]=127.5*(1-dx*inv);n.data[i+1]=127.5*(1+dy*inv);n.data[i+2]=127.5*(1+inv);n.data[i+3]=255;
  const grit=143+(255-cols[i])*.31+random()*8;
  r.data[i]=r.data[i+1]=r.data[i+2]=grit;r.data[i+3]=255;
 }
 nc.putImageData(n,0,0);rc.putImageData(r,0,0);
 const textures=[albedo,normal,rough].map(c=>{const t=new T.CanvasTexture(c);t.anisotropy=4;return t;});
 textures[0].colorSpace=T.SRGBColorSpace;
 return {map:textures[0],normalMap:textures[1],roughnessMap:textures[2],normalScale:new T.Vector2(.78,.67)};
}

export function machineShapes(){
 // This is a solid shoulder/tread profile with recessed circular sidewalls.
 // The axis is local Y, matching Three cylinders and the batch's axial helper.
 const profile=(points,segments)=>new T.LatheGeometry(points.map(([radius,y])=>new T.Vector2(radius,y)),segments);
 const tyre=profile([[.24,-.49],[.34,-.50],[.43,-.47],[.48,-.38],[.50,-.25],[.488,-.22],[.50,-.19],[.50,-.05],[.488,-.02],[.50,.01],[.50,.17],[.49,.20],[.50,.23],[.50,.32],[.475,.42],[.42,.485],[.34,.50],[.24,.49],[.24,-.49]],32);
 const rim=profile([[0,-.48],[.47,-.48],[.5,-.42],[.5,.36],[.46,.49],[.39,.49],[.33,.20],[.20,.14],[.15,.31],[0,.31]],32);
 const flange=profile([[0,-.48],[.43,-.48],[.46,-.39],[.47,.25],[.50,.31],[.50,.42],[.46,.47],[.38,.45],[.30,.16],[.15,.14],[0,.30]],18);
 const bevel=new T.BoxGeometry(1,1,1,4,4,4),pos=bevel.attributes.position,norm=bevel.attributes.normal;
 const p=new T.Vector3(),core=new T.Vector3(),out=new T.Vector3();
 for(let i=0;i<pos.count;i++){
  p.fromBufferAttribute(pos,i);
  for(const axis of ['x','y','z'])if(Math.abs(p[axis])===.25)p[axis]=Math.sign(p[axis])*.466;
  core.copy(p).clampScalar(-.466,.466);
  out.copy(p).sub(core).normalize();p.copy(core).addScaledVector(out,.034);
  pos.setXYZ(i,p.x,p.y,p.z);norm.setXYZ(i,out.x,out.y,out.z);
 }
 return {tyre,rim,flange,bevel,drum:new T.CylinderGeometry(.5,.5,1,24)};
}

// The compact synthetic flatcar has a fixed box support plane. The bolster,
// bearings and two independently visible steel wheels are below that plane.
export function addWagon(b,x,z,deck=.125,detailed=true){
 const rail=.025,rad=.040,axleY=rail+rad;
 b.box(x,deck-.018,z,.050,.032,1.245,'#3d4849');
 for(const side of [-1,1]){
  const xx=x+side*.119;
  b.box(xx,deck-.019,z,.012,.032,1.235,'#424f50');
  b.box(xx,deck-.005,z,.020,.010,1.259,'#6d7164');
  for(const dz of [-.607,0,.607])b.box(xx,deck-.002,z+dz,.028,.004,.040,'#baa368');
 }
 for(const dz of [-.610,-.41,0,.41,.610])b.box(x,deck-.012,z+dz,.263,.021,.031,'#535a54');
 for(const offset of [-.42,.42]){
  const center=z+offset;
  b.box(x,axleY+.016,center,.188,.029,.043,'#393f40');
  for(const side of [-1,1]){
   b.box(x+side*.096,axleY+.005,center,.019,.027,.225,'#41484a');
   if(detailed){
    for(const dz of [-.047,.047])b.roller([x+side*.098,axleY,center+dz],[x+side*.098,axleY+.029,center+dz],.016,'#606357','drum','metal');
    b.box(x+side*.106,axleY+.017,center,.006,.011,.117,'#6a726b');
   }
  }
  for(const dz of [-.083,.083]){
   const zz=center+dz;
   if(detailed)b.rod([x-.093,axleY,zz],[x+.093,axleY,zz],.012,'#43494b');
   for(const side of [-1,1]){
    const a=[x+side*.068,axleY,zz],c=[x+side*.083,axleY,zz];
    if(detailed)b.roller(c,a,rad*2.13,'#697473','flange','metal');
    else b.rod(a,c,rad*2,'#586060');
    if(detailed)b.box(x+side*.103,axleY,zz,.016,.020,.028,'#4a5252');
   }
  }
 }
 for(const sign of [-1,1]){
  b.box(x,deck-.026,z+sign*.631,.034,.024,.033,'#3e4140');
  if(detailed){
   b.box(x+.007,deck-.026,z+sign*.647,.026,.018,.018,'#63625a');
   b.box(x+.113,deck-.035,z+sign*.569,.017,.010,.069,'#bfad73');
  }
 }
}

// The door leaves sit back from the posts; round bars and hinges can then
// occupy that recess without increasing the ISO external length.
export function taskContainerGeometry(base){
 const pos=Array.from(base.attributes.position.array),normal=Array.from(base.attributes.normal.array),uv=Array.from(base.attributes.uv.array),idx=Array.from(base.index.array);
 for(const [offset,sign] of [[0,1],[4,-1]]){
  const inner=[];
  for(let i=0;i<4;i++){
   const j=(offset+i)*3;inner.push([sign*.487,pos[j+1]*.944,pos[j+2]*.939]);pos.splice(j,3,...inner[i]);
  }
  for(const [a,b] of [[0,1],[1,3],[3,2],[2,0]]){
   const A=new T.Vector3().fromBufferAttribute(base.attributes.position,offset+a),B=new T.Vector3().fromBufferAttribute(base.attributes.position,offset+b);
   const C=new T.Vector3(...inner[b]),D=new T.Vector3(...inner[a]);
   const norm=B.clone().sub(A).cross(C.clone().sub(A)).normalize(),start=pos.length/3;
   const face=norm.x*sign>=0?[A,B,C,D]:[D,C,B,A];
   if(norm.x*sign<0)norm.negate();
   for(const p of face){pos.push(p.x,p.y,p.z);normal.push(norm.x,norm.y,norm.z);uv.push(.502,.507);}
   idx.push(start,start+1,start+2,start,start+2,start+3);
  }
 }
 const result=new T.BufferGeometry();result.setAttribute('position',new T.Float32BufferAttribute(pos,3));result.setAttribute('normal',new T.Float32BufferAttribute(normal,3));result.setAttribute('uv',new T.Float32BufferAttribute(uv,2));result.setIndex(idx);return result;
}

export function cargoFittings(b,{length,width,height}){
 const doorX=length*.493,bridge=width*.465;
 // Each door leaf has two locking rods, three cam retainers and a latch lever.
 for(const side of [-1,1]){
  for(const offset of [.21,.71]){
   const z=side*bridge*offset;
   b.roller([doorX,.023,z],[doorX,height-.022,z],.0032,'#a7aca0','drum','metal');
   for(const h of [.10,.38,.77,.91])b.box(doorX+.0009,height*h,z,.0028,.0046,.010,'#afb4a7',0,'metal');
   b.rod([doorX+.0017,height*.39,z],[doorX+.0017,height*.37,z+side*.021],.0026,'#b9baad',false,'metal');
  }
  for(const h of [.15,.50,.84]){
   const z=side*width*.416;
   b.box(doorX-.0007,height*h,z,.0029,.0075,.024,'#9ca59c',0,'metal');
   b.roller([doorX,height*h-.0065,side*width*.464],[doorX,height*h+.0065,side*width*.464],.0035,'#b5b7a9','drum','metal');
  }
 }
 for(const side of [-1,1])for(const level of [.031,.969]){
  const z=side*width*.460,y=height*level;
  b.box(length*.4972,y,z,.0022,.010,.011,'#737d77',0,'metal');
  b.box(length*.4990,y,z,.0008,.0038,.006,'#2d3f43',0,'rubber');
 }
}

// The sheer line and the beam are sampled along the length. Keep the working
// deck level, with a sharp deck edge and smoothly joined hull panels below.
export function makeHull(profiles){
 const stations=new T.CatmullRomCurve3(profiles.map(([z,b,h])=>new T.Vector3(b,h,z)),false,'centripetal').getPoints(80);
 const sections=[[.04,-3.14],[.53,-3.10],[.78,-2.65],[.90,-2.02],[.955,-1.33],[.968,-1.13],[.989,-.18],[.998,.66],[1,1.95]];
 const shades=['#79443a','#83423a','#8f4b41','#91483f','#985545','#594c46','#273e4a','#243d4c','#345063'];
 const positions=[],uv=[],colors=[],indices=[];
 function vertex(x,y,z,u,v,color){
  positions.push(x,y,z);uv.push(u,v);const c=new T.Color(color);colors.push(c.r,c.g,c.b);return positions.length/3-1;
 }
 for(const sign of [-1,1]){
  const start=positions.length/3;
  stations.forEach((station,i)=>{
   for(let j=0;j<sections.length;j++){
    const [fraction,y]=sections[j];
    const top=y+(j===sections.length-1?station.y:0);
    vertex(sign*fraction*station.x,top,station.z,i/(stations.length-1),j/(sections.length-1),shades[j]);
   }
  });
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<sections.length-1;j++){
   const a=start+i*sections.length+j,b=a+sections.length;
   indices.push(...(sign===1?[a,a+1,b,b,a+1,b+1]:[a,b,a+1,b,b+1,a+1]));
  }
 }
 function quad(A,B,C,D,color){
  const start=positions.length/3;
  for(const [i,p] of [A,B,C,D].entries())vertex(...p,i%2,i>1?1:0,color);
  indices.push(start,start+1,start+2,start,start+2,start+3);
 }
 for(let i=0;i<stations.length-1;i++){
  const a=stations[i],b=stations[i+1],y=1.95+a.y,yy=1.95+b.y;
  quad([-a.x,y,a.z],[-b.x,yy,b.z],[b.x,yy,b.z],[a.x,y,a.z],'#788481');
 }
 for(const p of [stations[0],stations.at(-1)])for(let j=0;j<sections.length-1;j++){
  const [a,ay]=sections[j],[b,y0]=sections[j+1],by=y0+(j+1===sections.length-1?p.y:0);
  quad([-p.x*a,ay,p.z],[p.x*a,ay,p.z],[p.x*b,by,p.z],[-p.x*b,by,p.z],shades[j+1]);
 }
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
 const hullPaint=new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.52,metalness:.31});
 hullPaint.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 steelPlate;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsteelPlate=position;');
  shader.fragmentShader='varying vec3 steelPlate;\n'+shader.fragmentShader
   .replace('#include <map_fragment>',`#include <map_fragment>
    vec2 panel=vec2(steelPlate.z/1.42+floor(steelPlate.y/.28)*.33,steelPlate.y/.28);
    float tone=fract(sin(dot(floor(panel),vec2(12.991,71.37)))*23821.);
    vec2 seam=min(fract(panel),1.-fract(panel));
    float weld=1.-smoothstep(.002,.016,min(seam.x,seam.y));
    diffuseColor.rgb*=.963+.065*tone-.045*weld;
    diffuseColor.rgb*=mix(.77,1.,smoothstep(-.76,-.45,steelPlate.y));`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor*=mix(.59,1.,smoothstep(-.84,-.42,steelPlate.y));');
 };
 const hull=new T.Mesh(geo,hullPaint);
 hull.castShadow=hull.receiveShadow=true;return hull;
}
