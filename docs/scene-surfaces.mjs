import * as T from './vendor/three/three.module.js';
import {railTruckX} from './layout.mjs';
import {HDRLoader} from './vendor/three/HDRLoader.js';
import {QUAY_FACE,SCENE_METRES} from './scene-scale.mjs';

// Photographic surface assets are stored locally. Source, license and checksums
// are in assets/surfaces/credits.json; no live texture service is required.
const asset=name=>new URL('./assets/surfaces/'+name,import.meta.url).href;
export function createSurfaces(renderer,{compact=false}={}){
 const group=new T.Group(),textures=[],materials=[],geometries=[],status={loaded:0,total:compact?2:7,errors:[]};
 const loader=new T.TextureLoader(),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 let disposed=false,environmentTarget=null,environment=null;
 function map(name,color=false){
  const texture=loader.load(asset(name),()=>{status.loaded++;},undefined,()=>{status.errors.push(name);});
  texture.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=anisotropy;textures.push(texture);return texture;
 }
 function pavement(name,color,tile){
  const m=new T.MeshStandardMaterial({color,roughness:1,metalness:0,
   map:map(name+'_diff_1k.jpg',true),normalMap:compact?null:map(name+'_nor_gl_1k.jpg'),roughnessMap:compact?null:map(name+'_rough_1k.jpg'),normalScale:new T.Vector2(.30,.30)});
  m.userData.tile=tile;m.userData.surfaceKind=name;materials.push(m);return m;
 }
 const concrete=pavement('concrete_floor_worn_001','#ebece9',.83),asphalt=pavement('asphalt_02','#aab1b3',.97);
 const slab=document.createElement('canvas');slab.width=slab.height=1024;
 const sc=slab.getContext('2d');let seed=4196;
 function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
 sc.fillStyle='#b7bab7';sc.fillRect(0,0,1024,1024);
 // At roughly 200 m per repeat the large concrete pours and replacement
 // panels remain visible from the overview. Fine aggregate comes from PBR.
 for(let row=0;row<20;row++){
  const shift=row%3*11;
  for(let col=-1;col<17;col++){
   const x=col*67+shift,y=row*51.2,n=Math.round(174+random()*34),warm=Math.round(random()*6);
   sc.fillStyle='rgb('+[n+warm,n+2,n-2].join(',')+')';sc.fillRect(x,y,67,51.3);
   sc.strokeStyle='rgba(69,74,72,.31)';sc.lineWidth=1.5;sc.strokeRect(x+.5,y+.55,66.1,50.2);
   if(random()>.86){
    sc.fillStyle='rgba(96,101,98,.17)';sc.fillRect(x+5+random()*18,y+3,15+random()*25,12+random()*18);
   }
  }
 }
 for(let i=0;i<150;i++){
  const x=random()*1024,y=random()*1024,r=7+random()*45;
  const fog=sc.createRadialGradient(x,y,0,x,y,r);fog.addColorStop(0,'rgba(66,68,65,.10)');fog.addColorStop(1,'rgba(66,68,65,0)');
  sc.fillStyle=fog;sc.fillRect(x-r,y-r,r*2,r*2);
 }
 const variation=new T.CanvasTexture(slab);variation.wrapS=variation.wrapT=T.RepeatWrapping;variation.anisotropy=anisotropy;textures.push(variation);
 const siteCanvas=document.createElement('canvas');siteCanvas.width=siteCanvas.height=1024;
 const siteMap=new T.CanvasTexture(siteCanvas);siteMap.anisotropy=anisotropy;textures.push(siteMap);
 const placement={value:new T.Vector4(-58,-42,103,84)};
 function groundFinish(mat,isConcrete){
  mat.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,{surfaceVariation:{value:variation},yardUse:{value:siteMap},yardExtent:placement});
   shader.vertexShader='varying vec2 siteXZ;\n'+shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nsiteXZ=(modelMatrix*vec4(transformed,1.)).xz;');
   shader.fragmentShader='varying vec2 siteXZ;uniform sampler2D surfaceVariation;uniform sampler2D yardUse;uniform vec4 yardExtent;\n'+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    vec3 panel=texture2D(surfaceVariation,siteXZ/20.0).rgb;
    vec2 pos=(siteXZ-yardExtent.xy)/yardExtent.zw;vec3 wear=texture2D(yardUse,vec2(pos.x,1.-pos.y)).rgb;
    float inside=step(0.,pos.x)*step(0.,pos.y)*step(pos.x,1.)*step(pos.y,1.);
    wear=mix(vec3(.80),wear,inside);
    `+(isConcrete?`
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.355,.343),.42)*(vec3(.31)+panel*.91)*(.58+wear*.53);
    `:`
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.170,.182,.181),.44)*(.71+.36*wear)*(.93+.08*panel);
    `));
  };
  mat.customProgramCacheKey=()=>isConcrete?'terminal-concrete-surface':'terminal-bituminous-surface';
 }
 groundFinish(concrete,true);groundFinish(asphalt,false);
 function drawUsage(layout,toWorld){
  const stacks=layout.obstacles.filter(o=>o.kind==='stack');
  const left=Math.min(-58,...stacks.map(o=>(o.x-o.length/2-600)/10-3)),right=QUAY_FACE;
  const back=Math.min(-43,...stacks.map(o=>(o.y-o.width/2-330)/10-3)),front=Math.max(42,...stacks.map(o=>(o.y+o.width/2-330)/10+3));
  placement.value.set(left,back,right-left,front-back);
  const c=siteCanvas.getContext('2d'),sx=1024/(right-left),sz=1024/(front-back);
  c.setTransform(1,0,0,1,0,0);c.fillStyle='#c9cecc';c.fillRect(0,0,1024,1024);
  c.setTransform(sx,0,0,sz,-left*sx,-back*sz);
  for(const box of stacks){
   const p=toWorld(box),w=box.length/10,h=box.width/10;
   c.fillStyle='#a7ada6';c.fillRect(p.x-w/2-.41,p.z-h/2-.42,w+.82,h+.84);
   c.strokeStyle='#d5d5bc';c.lineWidth=.067;c.strokeRect(p.x-w/2-.56,p.z-h/2-.55,w+1.12,h+1.10);
  }
  c.lineCap='round';
  for(const road of layout.corridors.filter(e=>e.level==='ground')){
   const a=toWorld(road.points[0]),p=toWorld(road.points[1]),len=Math.hypot(p.x-a.x,p.z-a.z);
   if(!len)continue;const nx=(a.z-p.z)/len,nz=(p.x-a.x)/len;
   for(const side of [-1,1]){
    c.beginPath();c.moveTo(a.x+nx*.13*side,a.z+nz*.13*side);c.lineTo(p.x+nx*.13*side,p.z+nz*.13*side);c.lineWidth=.15;c.strokeStyle='#7e8580';c.stroke();
   }
  }
  c.setTransform(1,0,0,1,0,0);siteMap.needsUpdate=true;
 }
 const paint=new T.MeshStandardMaterial({color:'#e9e2c5',roughness:.87,metalness:0}),yellow=new T.MeshStandardMaterial({color:'#d5a94b',roughness:.84});materials.push(paint,yellow);
 function plane(x,z,width,depth,material,y=.002,angle=0){
  const geo=new T.PlaneGeometry(width,depth);geo.rotateX(-Math.PI/2);
  if(material.userData.tile){const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*width/material.userData.tile,uv.getY(i)*depth/material.userData.tile);}
  const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);mesh.rotation.y=angle;mesh.receiveShadow=true;group.add(mesh);geometries.push(geo);return mesh;
 }
 plane((QUAY_FACE-58)/2,0,QUAY_FACE+58,82,concrete,-.0008);
 // All service-pad identifiers are painted from the routable layout. A single
 // mipmapped atlas allows the paint to disappear naturally in aerial views.
 const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=512;
 const signMap=new T.CanvasTexture(signCanvas);signMap.colorSpace=T.SRGBColorSpace;signMap.anisotropy=anisotropy;textures.push(signMap);
 const signPaint=new T.MeshStandardMaterial({map:signMap,transparent:true,depthWrite:false,roughness:.98,polygonOffset:true,polygonOffsetFactor:-1});materials.push(signPaint);
 function berthNames(pads,toWorld){
  const positions=[],uv=[],indices=[],cols=4,rows=Math.max(1,Math.ceil(pads.length/cols));
  const c=signCanvas.getContext('2d');
  c.clearRect(0,0,signCanvas.width,signCanvas.height);
  const cellW=signCanvas.width/cols,cellH=signCanvas.height/rows;
  c.textAlign='center';c.textBaseline='middle';c.font='700 '+Math.min(40,Math.floor(cellH*.77))+'px system-ui,sans-serif';c.fillStyle='#e9cf88';
  pads.forEach((pad,index)=>{
   const col=index%cols,row=Math.floor(index/cols),o=index*4;
   c.fillText(pad.id,col*cellW+cellW/2,row*cellH+cellH/2,cellW-14);
   const middle=toWorld(pad.pose),angle=pad.pose.heading||0,ux=Math.cos(angle),uz=Math.sin(angle);
   const x=middle.x-uz*(pad.width/20+.23),z=middle.z+ux*(pad.width/20+.23);
   const l=.65,d=.14;
   for(const [u,v] of [[-l,-d],[-l,d],[l,d],[l,-d]])positions.push(x+ux*u-uz*v,.013,z+uz*u+ux*v);
   const left=col/cols,right=(col+1)/cols,top=1-row/rows,bottom=1-(row+1)/rows;
   uv.push(left,top,left,bottom,right,bottom,right,top);indices.push(o,o+1,o+2,o,o+2,o+3);
  });
  signMap.needsUpdate=true;
  if(!positions.length)return null;
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();return new T.Mesh(g,signPaint);
 }
 const dummy=new T.Object3D(),travel=new T.Group();
 group.add(travel);
 // All horizontal positions and all widths originate in the routing model.
 // Shared world-space UVs keep junctions continuous where ribbons overlap.
 function setLayout(layout,toWorld){
  drawUsage(layout,toWorld);
  for(const old of [...travel.children]){if(old.isInstancedMesh)old.dispose();else old.geometry.dispose();travel.remove(old);}
  const roadPositions=[],roadUV=[],roadNormals=[],roadIndices=[];
  const white=[],gold=[];
  function stripe(x,z,w,d,angle,list=white,y=.007){
   dummy.position.set(x,y,z);dummy.rotation.set(0,angle,0);dummy.scale.set(w,.001,d);dummy.updateMatrix();list.push(dummy.matrix.clone());
  }
  function asphaltQuad(points){
   const offset=roadPositions.length/3;
   for(const [x,z] of points){roadPositions.push(x,.004,z);roadNormals.push(0,1,0);roadUV.push(x/asphalt.userData.tile,z/asphalt.userData.tile);}
   roadIndices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const keyed=new Set(),junctions=new Map();
  for(const corridor of layout.corridors){
   if(corridor.level!=='ground'||!['ET','AGV'].includes(corridor.kind))continue;
   for(let i=1;i<corridor.points.length;i++){
    const a=toWorld(corridor.points[i-1]),b=toWorld(corridor.points[i]);
    const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<.001)continue;
    const key=[corridor.width,...[[a.x,a.z],[b.x,b.z]].map(p=>p.map(q=>q.toFixed(4)).join(',')).sort()].join('/');
    if(keyed.has(key))continue;keyed.add(key);
    const heading=Math.atan2(dz,dx);
    for(const p of [a,b]){
     const pointKey=p.x+','+p.z;
     if(!junctions.has(pointKey))junctions.set(pointKey,{p,headings:[]});junctions.get(pointKey).headings.push(heading);
    }
    const ux=dx/len,uz=dz/len,nx=-uz,nz=ux,half=corridor.width/(SCENE_METRES*2),angle=-Math.atan2(dz,dx);
    const turn=Math.min(half,.45),ax=a.x-ux*turn,az=a.z-uz*turn,bx=b.x+ux*turn,bz=b.z+uz*turn;
    const railApron=corridor.kind==='ET'&&corridor.points[i-1].x===railTruckX&&corridor.points[i].x===railTruckX;
    const paved=railApron?.97:half;
    asphaltQuad([[ax+nx*paved,az+nz*paved],[bx+nx*paved,bz+nz*paved],[bx-nx*paved,bz-nz*paved],[ax-nx*paved,az-nz*paved]]);
    if(len<half*2)continue;
    // Interrupt edge stripes at intersections and turning pads. Lanes can
    // carry vehicles in either direction, so no fixed-direction arrows.
    for(const side of [-1,1])stripe((a.x+b.x)/2+side*nx*(half-.024),(a.z+b.z)/2+side*nz*(half-.024),len-half*1.8,.012,angle);
   }
  }
  function outline(pose,length,width,isBerth){
   const p=toWorld(pose),h=pose.heading||0,ux=Math.cos(h),uz=Math.sin(h),nx=-uz,nz=ux;
   const l=length/(2*SCENE_METRES),w=width/(2*SCENE_METRES),corner=Math.min(l*.42,.31),list=isBerth?gold:white;
   for(const sign of [-1,1])for(const side of [-1,1]){
    stripe(p.x+ux*sign*(l-corner/2)+nx*side*w,p.z+uz*sign*(l-corner/2)+nz*side*w,corner,.021,-h,list,.010);
    stripe(p.x+ux*sign*l+nx*side*w*.70,p.z+uz*sign*l+nz*side*w*.70,.021,w*.60,-h,list,.010);
   }
   if(isBerth)for(const side of [-1,1]){
    for(let d=-l+.17;d<l-.08;d+=.18)stripe(p.x+ux*d+nx*side*(w+.07),p.z+uz*d+nz*side*(w+.07),.11,.013,-h+Math.PI/4,gold,.009);
   }
  }
  for(const pad of layout.berths){
   outline(pad.pose,pad.length,pad.width,true);
   const p=toWorld(pad.pose),h=pad.pose.heading||0,dx=Math.cos(h),dz=Math.sin(h);
   for(const side of [-1,1]){
    const off=(pad.width/20-.10)*side;
    stripe(p.x-dz*off,p.z+dx*off,.17,.034,-h,gold,.011);
    stripe(p.x-dz*(off+.046*side),p.z+dx*(off+.046*side),.026,.092,-h,gold,.011);
   }
  }
  const identifiers=berthNames(layout.berths,toWorld);if(identifiers)travel.add(identifiers);
  for(const bay of layout.parking)if(['ET','AGV','SMV'].includes(bay.kind))outline(bay.pose,bay.length||17,bay.width||5,false);
  // The vehicle envelope is longer than the through lane is wide. Give
  // rotating chassis a fully paved apron at each junction and stopping end.
  for(const {p,headings} of junctions.values()){
   if(headings.length>1&&!headings.some(h=>Math.abs(Math.sin(h-headings[0]))>.05))continue;
   const radius=1.05;
   for(let i=0;i<12;i++){
    const a=-i*Math.PI/6,e=-(i+1)*Math.PI/6;
    asphaltQuad([[p.x,p.z],[p.x+radius*Math.cos(a),p.z+radius*Math.sin(a)],[p.x+radius*Math.cos(e),p.z+radius*Math.sin(e)],[p.x,p.z]]);
   }
  }
  const stacks=layout.obstacles.filter(o=>o.kind==='stack');
  if(stacks.length){
   const left=Math.min(-58,...stacks.map(o=>(o.x-o.length/2-600)/10-2.5));
   const back=Math.min(-41,...stacks.map(o=>(o.y-o.width/2-330)/10-3));
   const front=Math.max(41,...stacks.map(o=>(o.y+o.width/2-330)/10+3));
   const g=new T.PlaneGeometry(QUAY_FACE-left,front-back);g.rotateX(-Math.PI/2);
   g.translate((QUAY_FACE+left)/2,-.0028,(front+back)/2);
   const uv=g.attributes.uv,positions=g.attributes.position;
   for(let i=0;i<uv.count;i++)uv.setXY(i,positions.getX(i)/concrete.userData.tile,positions.getZ(i)/concrete.userData.tile);
   const extension=new T.Mesh(g,concrete);extension.receiveShadow=true;travel.add(extension);
  }
  if(roadPositions.length){
   const g=new T.BufferGeometry();
   for(const [attr,arr,size] of [['position',roadPositions,3],['normal',roadNormals,3],['uv',roadUV,2]])g.setAttribute(attr,new T.Float32BufferAttribute(arr,size));
   g.setIndex(roadIndices);const road=new T.Mesh(g,asphalt);road.name='routed-asphalt';road.receiveShadow=true;travel.add(road);
  }
  for(const [list,mat] of [[white,paint],[gold,yellow]]){
   if(!list.length)continue;const markings=new T.InstancedMesh(cube,mat,list.length);
   list.forEach((matrix,i)=>markings.setMatrixAt(i,matrix));markings.receiveShadow=true;travel.add(markings);
  }
 }
 // Recessed joints use a small repeating alpha map; they do not create a mesh
 // for every slab and fade naturally through mipmaps at the overview distance.
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
 ctx.clearRect(0,0,512,512);ctx.strokeStyle='rgba(55,59,60,.30)';ctx.lineWidth=1.8;ctx.strokeRect(1,1,510,510);
 const joints=new T.CanvasTexture(c);joints.wrapS=joints.wrapT=T.RepeatWrapping;joints.repeat.set((QUAY_FACE+58)/.6,82/.6);joints.anisotropy=anisotropy;textures.push(joints);
 const jointMaterial=new T.MeshBasicMaterial({map:joints,transparent:true,depthWrite:false,opacity:.30,polygonOffset:true,polygonOffsetFactor:-1});materials.push(jointMaterial);
 plane((QUAY_FACE-58)/2,0,QUAY_FACE+58,82,jointMaterial,.001);
 const cube=new T.BoxGeometry();geometries.push(cube);
 // Quay drainage channel and flush covers sit outside the working travel path.
 const drains=[],coverMat=new T.MeshStandardMaterial({color:'#485158',roughness:.61,metalness:.55});materials.push(coverMat);
 for(let z=-39;z<40;z+=.6){dummy.position.set(QUAY_FACE-.7,.006,z);dummy.rotation.set(0,0,0);dummy.scale.set(.075,.004,.15);dummy.updateMatrix();drains.push(dummy.matrix.clone());}
 const covers=new T.InstancedMesh(cube,coverMat,drains.length);drains.forEach((m,i)=>covers.setMatrixAt(i,m));group.add(covers);
 function loadEnvironment(scene,onLoad){
  if(compact)return;
  const pmrem=new T.PMREMGenerator(renderer);pmrem.compileEquirectangularShader();
  new HDRLoader().load(asset('kloofendal_48d_partly_cloudy_puresky_1k.hdr'),hdr=>{
   if(disposed){hdr.dispose();pmrem.dispose();return;}
   hdr.mapping=T.EquirectangularReflectionMapping;environment=hdr;environmentTarget=pmrem.fromEquirectangular(hdr);scene.environment=environmentTarget.texture;pmrem.dispose();status.loaded++;onLoad(hdr);
  },undefined,()=>{pmrem.dispose();status.errors.push('sky environment');});
 }
 function dispose(){disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();environmentTarget?.dispose();environment?.dispose();}
 return {group,loadEnvironment,setLayout,status,dispose};
}
