import * as T from './vendor/three/three.module.js';
import {cargoSize,QUAY_FACE,SCENE_METRES} from './scene-scale.mjs';
import {buildLayout,gantryGauge} from './layout.mjs';
import {stackTexture} from './scene-compatibility.mjs';
import {addWagon,cargoFittings,containerFinish,machineShapes,taskContainerGeometry,makeHull} from './scene-machinery.mjs';

const v=(x,y,z)=>new T.Vector3(x,y,z);
const unitY=v(0,1,0);
const paint=['#b7462d','#197480','#ce9b44','#3d719a','#a95535','#387567','#869299','#7a4d57','#c5ad83'];
export function createModels({compact=false}={}){
 const cube=new T.BoxGeometry(),tube=new T.CylinderGeometry(.5,.5,1,compact?7:9),foliage=new T.IcosahedronGeometry(.5,1),materials=new Map();
 const yardGeo=new T.BoxGeometry(),uv=yardGeo.attributes.uv;
 // The side walls, locking doors and roof use separate faces of one texture atlas.
 for(let f=0;f<6;f++){
  const region=f===0?[.5,.5]:f===1?[.5,0]:f<4?[0,0]:[0,.5];
  for(let i=0;i<4;i++){const k=f*4+i;uv.setXY(k,region[0]+.005+uv.getX(k)*.49,region[1]+.006+uv.getY(k)*.488);}
 }
 const cargoGeo=taskContainerGeometry(yardGeo);
 const paintMaps=containerFinish({albedoOnly:compact}),shapes=machineShapes(),sharedExtras=[];
 const rowsTexture=compact?stackTexture():null;
 const finishes={
  stockrow:{map:rowsTexture,roughness:1},
  steel:{roughness:.57,metalness:.22},
  metal:{roughness:.31,metalness:.83},
  glass:{roughness:.10,metalness:.27,envMapIntensity:1.38,clearcoat:.64,clearcoatRoughness:.12},
  rubber:{roughness:.91,metalness:0},
  concrete:{roughness:.96,metalness:0},
  leaf:{roughness:.93,metalness:0},
  container:{roughness:.97,metalness:.18,...paintMaps},
 };
 function material(key){
  if(!materials.has(key)){
   const Material=key==='glass'?T.MeshPhysicalMaterial:T.MeshStandardMaterial;
   materials.set(key,new Material({color:'#fff',...finishes[key]}));
  }
  return materials.get(key);
 }
 function batch(){
  const groups=new Map(),work=new T.Object3D();
  function piece(geo,mat,p,s,color,rot,quat){
   if(compact&&mat!=='container'&&mat!=='stockrow'){
    const size=[s.x,s.y,s.z].sort((a,b)=>a-b);
    if(size[2]<.049||(size[1]<.016&&size[2]<.45))return;
    // Identical geometry can share one instance batch across paint colours.
    mat='steel';
   }
   const k=geo.uuid+mat;if(!groups.has(k))groups.set(k,{geo,mat,list:[]});
   work.position.copy(p);work.scale.copy(s);work.rotation.set(0,rot||0,0);if(quat)work.quaternion.copy(quat);
   work.updateMatrix();groups.get(k).list.push([work.matrix.clone(),new T.Color(color)]);
  }
  function box(x,y,z,w,h,d,color,rot=0,mat='steel'){piece(mat==='container'?yardGeo:cube,mat,v(x,y,z),v(w,h,d),color,rot);}
  function machined(x,y,z,w,h,d,color,mat='steel'){piece(compact?cube:shapes.bevel,mat,v(x,y,z),v(w,h,d),color,0);}
  function roller(a,b,width,color,profile='drum',mat='metal'){
   const A=v(...a),B=v(...b),dir=B.clone().sub(A),length=dir.length();if(length<.0001)return;
   piece(compact?tube:shapes[profile],mat,A.lerp(B,.5),v(width,length,width),color,0,new T.Quaternion().setFromUnitVectors(unitY,dir.normalize()));
  }
  function rod(a,b,width,color,square=false,mat='steel'){
   const A=v(...a),B=v(...b),dir=B.clone().sub(A),l=dir.length();if(l<.001)return;
   piece(square?cube:tube,mat,A.lerp(B,.5),v(width,l,width),color,0,new T.Quaternion().setFromUnitVectors(unitY,dir.normalize()));
  }
  function crown(x,y,z,w,h,d,color){piece(foliage,'leaf',v(x,y,z),v(w,h,d),color,x*.74);}
  function finish(){
   const group=new T.Group();
   for(const {geo,mat,list} of groups.values()){
    const mesh=new T.InstancedMesh(geo,material(mat),list.length);
    list.forEach(([m,c],i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,c);});
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
   }
   return group;
  }
  return {box,rod,roller,machined,crown,finish};
 }
 function container(b,x,bottom,z,color,angle=0,type='40HQ'){
  const {length,width,height}=cargoSize(type);
  b.box(x,bottom+height/2,z,length,height,width,color,angle,'container');
 }
 function containerHardware(type){
  const b=batch();cargoFittings(b,cargoSize(type));return b.finish();
 }
 function storageBlocks(b,layout,toWorld){
  const pitchX=12.72,pitchY=2.64,aisle=2.6,blocks=[];
  for(const zone of layout.obstacles){
   if(zone.kind!=='stack')continue;
   const cols=Math.floor((zone.length-.8)/pitchX);
   let rows=Math.floor((zone.width-.8)/pitchY);
   while(rows>0&&rows*pitchY+Math.floor((rows-1)/6)*aisle>zone.width-.8)rows--;
   if(cols<1||rows<1)continue;
   const center=toWorld({...zone,z:0}),length=zone.length/SCENE_METRES,width=zone.width/SCENE_METRES;
   b.box(center.x,.001,center.z,length,.004,width,'#747b75',0,'concrete');
   for(const sign of [-1,1])for(const side of [-1,1]){
    b.box(center.x+sign*(length/2-.18),.004,center.z+side*(width/2-.036),.3,.003,.014,'#d8c59c');
    b.box(center.x+sign*(length/2-.036),.004,center.z+side*(width/2-.15),.014,.003,.24,'#d8c59c');
   }
   const rowDepth=(rows-1)*pitchY+Math.floor((rows-1)/6)*aisle;
   const siteNumber=Math.abs(Math.round(zone.x*3+zone.y*5));
   let placed=0;
   // Neighbouring bays share a storage run. Its stepped end and lower top
   // tiers vary by block; the empty service aisle spans every six rows.
   for(let j=0;j<rows;j++){
    const rowEnd=cols-((siteNumber+Math.floor(j/3))%6===0?1:0);
    const z=center.z+(j*pitchY+Math.floor(j/6)*aisle-rowDepth/2)/SCENE_METRES;
    const xAt=i=>center.x+(i-(cols-1)/2)*pitchX/SCENE_METRES;
    for(let start=0;start<rowEnd;start+=3){
     const run=Math.min(3,rowEnd-start);
     const block=siteNumber+Math.floor(j/3)*13+Math.floor(start/3)*7;
     const tiers=2+block%3+(start+run<rowEnd&&block%5===0?1:0);
     placed+=run*tiers;
     if(compact){
      if(j%3)continue;
      const h=tiers*.2896,depth=Math.min(3,rows-j);
      b.box((xAt(start)+xAt(start+run-1))/2,.004+h/2,z+(depth-1)*pitchY/20,
       (run*pitchX-.53)/10,h,(depth*pitchY-.20)/10,'#ffffff',0,'stockrow');
     }else for(let i=start;i<start+run;i++)for(let level=0;level<tiers;level++){
      const mixed=(i*31+j*17+level*11+siteNumber)%7===0;
      const color=paint[(block+Math.floor(level/2)*3+(mixed?i+j+level:0))%paint.length];
      container(b,xAt(i),.004+level*.2896,z,color);
     }
    }
   }
   blocks.push({id:zone.id,x:zone.x,y:zone.y,length:zone.length,width:zone.width,boxes:placed});
  }
  return blocks;
 }
 function beamSection(b,x,height,z,length,heading,hue='#a7b2b0'){
  const nx=-Math.sin(heading),nz=Math.cos(heading),angle=-heading;
  for(const side of [-1,1]){
   b.box(x+side*nx*.071,height+.088,z+side*nz*.071,length,.176,.024,hue,angle);
   b.box(x+side*nx*.054,height+.008,z+side*nz*.054,length,.016,.063,'#65757a',angle);
  }
  b.box(x,height+.172,z,length,.018,.163,'#c5c6b9',angle);
 }
 // Rotary transfer bridges and the portal gauges are synthetic layout
 // assumptions. They make the routed movement possible in this schematic.
 function overhead(b,layout,toWorld,free){
  const seen=new Set(),supportPoints=[],segments=[],joints=new Map(),switches=[];
  const ways=layout.corridors.filter(c=>c.kind==='SMV');
  const pointKey=p=>p.x+','+p.y;
  for(const path of ways){
   const [a,q]=path.points,h=Math.atan2(q.y-a.y,q.x-a.x);
   for(const [p,heading] of [[a,h],[q,h+Math.PI]]){
    const key=pointKey(p);
    if(!joints.has(key))joints.set(key,{p,axes:[]});joints.get(key).axes.push(heading);
   }
  }
  const radius=.69;
  for(const j of joints.values()){
   const {axes,p}=j,endpoint=axes.length===1;
   // A suspended vehicle cannot spin under two crossing stationary beams.
   // The routed in-place rotation instead rides a rotating slotted bridge.
   // A straight end siding only needs a short buffer beyond the trolley bogie.
   const rotary=axes.some(h=>Math.abs(Math.sin(h-axes[0]))>.03)||(endpoint&&Math.abs(Math.sin(axes[0]))>.03);
   j.cut=rotary?radius:endpoint?-.67:0;
   if(!rotary)continue;
   const q=toWorld(p),rotor=batch();
   beamSection(rotor,0,0,0,radius*2-.007,0,'#a1adac');
   rotor.box(0,.23,0,.24,.108,.135,'#7a898c');
   const model=rotor.finish();model.position.copy(q);model.rotation.y=-axes[0];
   const rollerY=q.y+.265;
   for(let k=0;k<24;k++){
    const a=k*Math.PI/12,e=(k+1)*Math.PI/12;
    b.rod([q.x+Math.cos(a)*radius,rollerY,q.z+Math.sin(a)*radius],[q.x+Math.cos(e)*radius,rollerY,q.z+Math.sin(e)*radius],.036,'#7f9092',true);
   }
   for(const h of axes)b.rod([q.x+Math.cos(h)*radius,q.y+.18,q.z+Math.sin(h)*radius],[q.x+Math.cos(h)*radius,rollerY,q.z+Math.sin(h)*radius],.069,'#9caaa7',true);
   b.rod([q.x-radius,rollerY+.10,q.z],[q.x+radius,rollerY+.10,q.z],.071,'#92a09f',true);
   b.rod([q.x,rollerY+.11,q.z],[q.x,q.y+.23,q.z],.104,'#899795');
   switches.push({model,x:p.x,y:p.y,defaultHeading:axes[0]});
  }
  for(const path of ways){
   for(let i=1;i<path.points.length;i++){
    const a=toWorld(path.points[i-1]),q=toWorld(path.points[i]),length=Math.hypot(q.x-a.x,q.z-a.z);
    if(length<.001)continue;
    const key=[a,q].map(p=>p.x.toFixed(3)+','+p.z.toFixed(3)).sort().join('/');
    if(seen.has(key))continue;seen.add(key);
    const ux=(q.x-a.x)/length,uz=(q.z-a.z)/length,nx=-uz,nz=ux,heading=Math.atan2(uz,ux),angle=-heading,height=a.y;
    const start=joints.get(pointKey(path.points[i-1])).cut,end=length-joints.get(pointKey(path.points[i])).cut;
    const middle=(start+end)/2;
    if(end>start)beamSection(b,a.x+ux*middle,height,a.z+uz*middle,end-start,heading);
    for(let dist=start+.22;dist<end;dist+=.74){
     for(const side of [-1,1])b.box(a.x+ux*dist+nx*side*.087,height+.086,a.z+uz*dist+nz*side*.087,.019,.165,.014,'#879b9b',angle);
    }
    for(let j=0,count=Math.max(1,Math.ceil(length/3.3));j<count;j++){
     const t=(j+.5)/count,px=a.x+(q.x-a.x)*t,pz=a.z+(q.z-a.z)*t;
     if(supportPoints.some(p=>Math.hypot(px-p.x,pz-p.z)<2))continue;
     const offsets=[.68,-.68,.94,-.94,1.35,-1.35,1.9,-1.9,2.35,-2.35];
     const offset=offsets.find(d=>free(px+nx*d,pz+nz*d,.28,.28,.18));
     if(offset===undefined)continue;
     const cx=px+nx*offset,cz=pz+nz*offset;
     b.box(cx,.034,cz,.23,.068,.24,'#ada997',angle,'concrete');
     b.box(cx,(height+.18)/2,cz,.105,height+.18,.115,'#94a1a1',angle);
     b.rod([cx,height+.18,cz],[px,height+.18,pz],.096,'#96a6a4',true);
     b.rod([cx,height-.34,cz],[px+nx*offset*.24,height+.16,pz+nz*offset*.24],.062,'#8b9e9e',true);
     supportPoints.push({x:px,z:pz,pier:[cx,cz]});
    }
    segments.push([path.points[i-1],path.points[i]]);
   }
  }
  return {segments,supportPoints,switches};
 }
 function runwayRails(b,layout,toWorld){
  const seen=new Set();
  for(const c of layout.corridors.filter(c=>c.level==='gantry')){
   const gauge=gantryGauge[c.kind]/SCENE_METRES;
   for(let i=1;i<c.points.length;i++){
    const a=toWorld(c.points[i-1]),q=toWorld(c.points[i]),dx=q.x-a.x,dz=q.z-a.z,len=Math.hypot(dx,dz);
    if(len<.01)continue;
    const key=c.kind+[a,q].map(p=>p.x.toFixed(3)+','+p.z.toFixed(3)).sort().join('/');
    if(seen.has(key))continue;seen.add(key);
    const nx=-dz/len,nz=dx/len,angle=-Math.atan2(dz,dx);
    for(const side of [-1,1]){
     const x=(a.x+q.x)/2+side*nx*gauge/2,z=(a.z+q.z)/2+side*nz*gauge/2;
     b.box(x,-.004,z,len+.15,.015,.105,'#6d7979',angle,'concrete');
     b.box(x,.009,z,len+.15,.013,.017,'#acb6b3',angle,'metal');
    }
   }
  }
 }
 function infrastructure(b,layout,toWorld,clearOfTraffic){
  // Optional scenery passes the shared swept-space check. Storage heaps are
  // generated entirely inside the obstacle rectangles used by the path planner.
  const obstacles=layout.obstacles;
  // The planner protects vehicle centres. A gantry also has heavy trucks
  // on two offset rails, which reserve swept strips for ancillary furniture.
  const railFootprints=layout.corridors.filter(c=>c.level==='gantry').flatMap(c=>{
   const [a,q]=c.points,dx=q.x-a.x,dy=q.y-a.y,length=Math.hypot(dx,dy);
   const gauge=gantryGauge[c.kind];
   return [-1,1].map(side=>({x:(a.x+q.x)/2-side*dy/length*gauge/2,y:(a.y+q.y)/2+side*dx/length*gauge/2,
    length:Math.abs(dx)+(dx?20:4),width:Math.abs(dy)+(dy?20:4)}));
  });
  const clearPortal=layout.corridors.filter(c=>c.level==='gantry').map(c=>{
   const [a,q]=c.points,alongX=c.kind==='YC';
   return {x:(a.x+q.x)/2,y:(a.y+q.y)/2,length:Math.abs(q.x-a.x)+(alongX?22:gantryGauge[c.kind]+5),width:Math.abs(q.y-a.y)+(alongX?gantryGauge[c.kind]+5:22)};
  });
  const occupied=[...obstacles,...railFootprints,...clearPortal];
  const free=(x,z,l,w,margin=0)=>{
   const rect={x:x*SCENE_METRES+600,y:z*SCENE_METRES+330,length:l*SCENE_METRES,width:w*SCENE_METRES};
   if(occupied.some(o=>Math.abs(o.x-rect.x)<(o.length+rect.length)/2+margin*10&&Math.abs(o.y-rect.y)<(o.width+rect.width)/2+margin*10))return false;
   return clearOfTraffic(layout,rect,margin*SCENE_METRES);
  };
  const blocks=storageBlocks(b,layout,toWorld),guideway=overhead(b,layout,toWorld,free);
  runwayRails(b,layout,toWorld);
  // Service sheds, tanks, parked highway trailers and floodlights use only
  // spare land. Registration of their actual footprints also tests the layout.
  const fixtures=[],lamps=[];
  function place(x,z,l,w,draw){
   if(!free(x,z,l,w,.20))return;
   if(fixtures.some(f=>Math.abs(f.x-x)<(f.l+l)/2+.2&&Math.abs(f.z-z)<(f.w+w)/2+.2))return;
   draw();fixtures.push({x,z,l,w});
  }
  for(const [x,z,w,d] of [[-65,-19,12,6.8],[-68,8,12,6.8],[-57,-51,12,6.8],[7,-55,12,6.8],[20,-57,12,6.8],[-60,20,7,4],[-37,-27,8,4],[-32,43,9,4.5],[-10,41,8,4.2],[27,-15,5.8,3.1],[16,22,6.5,3.4],[-19,19,6.5,3.4],[1,-26,6.5,3.4]]){
   place(x,z,w+.5,d+.5,()=>{
    b.box(x,1.25,z,w,2.5,d,'#839195');b.box(x,2.56,z,w+.42,.12,d+.43,'#a4aca7');
    for(let j=0;j<4;j++){const dx=(j-1.5)*w*.20;b.box(x+dx,1.03,z+d/2+.02,w*.115,2.04,.045,'#485d66');b.box(x+dx,2.19,z+d/2+.06,w*.14,.10,.12,'#c2ad83');}
    // Individual roof panels, ventilators and a dock canopy give the
    // peripheral maintenance buildings a useful scale in elevated views.
    for(let dx=-w/2+.34;dx<w/2-.2;dx+=.51)b.box(x+dx,2.627,z,.018,.02,d-.21,'#879b96');
    for(const side of [-1,1]){
     const xx=x+side*w*.23;b.box(xx,2.71,z,.85,.19,1.05,'#768b87');b.box(xx,2.81,z,.72,.012,.92,'#5b7376');
     b.box(xx,2.64,z-d*.30,w*.29,.035,d*.16,'#95b2ad',0,'glass');
    }
    b.box(x,2.20,z+d/2+.09,w*.86,.066,.22,'#bcc5bb');
    b.box(x,2.30,z-d/2-.012,w*.94,.12,.022,'#718a8d');
   });
  }
  for(let i=0;i<6;i++){
   const x=-64+i*3.5,z=-38;
   place(x,z,2.92,2.92,()=>{b.rod([x,.06,z],[x,3.45,z],2.72,'#b4b7a5');b.rod([x,3.44,z],[x,3.55,z],2.78,'#c9cbb9');b.rod([x,1.12,z],[x,1.16,z],2.75,'#889996');});
  }
  for(let i=0;i<8;i++){
   const x=-63+i*2.0,z=30;
   place(x,z,.40,2.1,()=>{b.box(x,.13,z,.30,.21,1.34,'#465963');b.box(x,.28,z,.28,.15,1.2,'#8c9692');b.box(x,.31,z+.86,.29,.43,.35,i%2?'#a6714c':'#788f9a');b.box(x,.38,z+1.04,.22,.13,.012,'#466071');});
  }
  for(const z of [-25,9.3,26.5])for(let x=-38;x<40;x+=10.2){
   place(x+.21,z,.62,.23,()=>{b.rod([x,0,z],[x,4.5,z],.055,'#819295');b.rod([x,4.52,z],[x+.44,4.52,z],.045,'#9baba8');b.box(x+.44,4.49,z,.22,.065,.14,'#f3d9a6');lamps.push([x+.44,4.47,z]);});
  }
  // Maintain a clear perimeter around real rail, truck and lifting
  // envelopes. Optional corner cabinets and fence sections all use the same
  // checks as the warehouses, including the full swept portal span.
  for(const [cx,cz] of [[-50,30],[-37,43],[-27,45],[1,-40],[34,-20],[-12,29],[19,-27]]){
   place(cx,cz,3.6,1.45,()=>{
    b.box(cx,.007,cz,3.6,.014,1.45,'#8a9187',0,'concrete');
    for(let i=0;i<4;i++){
     const x=cx-1.24+i*.81;b.machined(x,.177,cz,.55,.34,.95,i%2?'#87958c':'#748784');
     for(let rib=0;rib<7;rib++)b.box(x-.204+rib*.068,.17,cz+.48,.018,.21,.019,'#536d67');
     b.box(x,.368,cz,.60,.045,.99,'#a3ad9d');
    }
   });
  }
  if(obstacles.length){
   const bounds={left:Math.min(...obstacles.map(o=>(o.x-o.length/2-600)/10))-1.1,
    front:Math.max(...obstacles.map(o=>(o.y+o.width/2-330)/10))+1.2,
    back:Math.min(...obstacles.map(o=>(o.y-o.width/2-330)/10))-1.2};
   const fence=(ax,az,bx,bz)=>{
    const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len;
    for(let i=0;i<len-1.9;i+=2.0){
     const x=ax+ux*(i+1),z=az+uz*(i+1);
     place(x,z,Math.abs(ux)*1.97+.024,Math.abs(uz)*1.97+.024,()=>{
      for(const y of [.13,.24])b.rod([x-ux*.98,y,z-uz*.98],[x+ux*.98,y,z+uz*.98],.009,'#899a94',true);
      for(const d of [-.92,0,.92])b.box(x+ux*d,.13,z+uz*d,.014,.26,.014,'#768882');
     });
    }
   };
   fence(bounds.left,bounds.back,39,bounds.back);fence(bounds.left,bounds.front,39,bounds.front);fence(bounds.left,bounds.back,bounds.left,bounds.front);
  }
  return {blocks,guideway,fixtures,lamps};
 }
 let wagonSets;
 function wagonPrototype(detailed){
  const b=batch();
  if(compact){
   if(detailed){
    for(const x of [-.119,0,.119])b.box(x,.108,0,.021,.034,1.26,'#515c56');
    for(const z of [-.61,0,.61])b.box(0,.110,z,.265,.030,.043,'#52605d');
    for(const z of [-.50,-.34,.34,.50])for(const side of [-1,1]){
     b.roller([side*.068,.066,z],[side*.085,.066,z],.087,'#63716d','flange','metal');
    }
   }else b.box(0,.099,0,.26,.052,1.26,'#495653');
   for(const z of [-.42,.42])b.box(0,.061,z,.18,.061,.215,'#394344');
  }else addWagon(b,0,0,.125,detailed);
  const temp=b.finish(),parts=[];const p=v(0,0,0),n=v(0,0,0),c=new T.Color(),m=new T.Matrix4(),normalMatrix=new T.Matrix3();
  temp.children.forEach(group=>{
   const positions=[],normals=[],colors=[],indices=[],geo=group.geometry;
   for(let i=0;i<group.count;i++){
    group.getMatrixAt(i,m);group.getColorAt(i,c);normalMatrix.getNormalMatrix(m);
    const vertexBase=positions.length/3;
    for(let j=0;j<geo.attributes.position.count;j++){
     p.fromBufferAttribute(geo.attributes.position,j).applyMatrix4(m);
     n.fromBufferAttribute(geo.attributes.normal,j).applyMatrix3(normalMatrix).normalize();
     positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);colors.push(c.r,c.g,c.b);
    }
    for(const idx of geo.index.array)indices.push(vertexBase+idx);
   }
   const result=new T.BufferGeometry();result.setAttribute('position',new T.Float32BufferAttribute(positions,3));result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));result.setAttribute('color',new T.Float32BufferAttribute(colors,3));result.setIndex(indices);
   const finish=group.material.clone();finish.vertexColors=true;
   sharedExtras.push(result,finish);parts.push([result,finish]);group.dispose();
  });
  return parts;
 }
 function rollingStock(positions){
  if(!wagonSets)wagonSets=[wagonPrototype(true),wagonPrototype(false)];
  const group=new T.Group(),matrix=new T.Matrix4();
  for(let i=0;i<positions.length;i+=20){
   const points=positions.slice(i,i+20),center=points.reduce((sum,p)=>sum.add(p),v(0,0,0)).multiplyScalar(1/points.length);
   center.y=0;const levels=new T.LOD();levels.position.copy(center);
   wagonSets.forEach((parts,lod)=>{
    const level=new T.Group();for(const [geo,finish] of parts){
     const stock=new T.InstancedMesh(geo,finish,points.length);
     points.forEach((p,index)=>stock.setMatrixAt(index,matrix.makeTranslation(p.x-center.x,0,p.z-center.z)));
     stock.castShadow=lod===0;stock.receiveShadow=true;level.add(stock);
    }
    levels.addLevel(level,lod===0?0:23,0.12);
   });
   group.add(levels);
  }
  return group;
 }
 function terminalFurniture(snap,toWorld,layout=buildLayout(snap.config,snap.layoutExtent??snap.containers.length)){
  const b=batch(),railRows=new Map(),wagonPositions=[];
  if(layout){
   const {minX,minY,maxY}=layout.bounds,left=Math.min(-58,(minX-600)/10-4);
   const start=Math.min(-88,(minY-330)/10-4),end=Math.max(88,(maxY-330)/10+4);
   b.box((left+QUAY_FACE)/2,-.538,(start+end)/2,QUAY_FACE-left,1.04,end-start,'#75807a',0,'concrete');
   // All berths share a continuous seawall. Hull groups are spaced 440 m apart.
   const shoreStart=Math.min(-42,...snap.containers.map(c=>(c.shipSlot.pose.y-330)/10-10));
   const shoreEnd=Math.max(42,...snap.containers.map(c=>(c.shipSlot.pose.y-330)/10+10));
   for(let z=shoreStart;z<shoreEnd;z+=3){
    b.box(QUAY_FACE-.14,-.39,z,.28,.78,3.014,'#627779',0,'concrete');
    b.box(QUAY_FACE+.10,-.35,z,.20,.53,.31,'#293a3c',0,'rubber');
    b.box(QUAY_FACE-.16,.017,z,.036,.003,1.42,'#beaa72');
    b.roller([QUAY_FACE-.25,.017,z],[QUAY_FACE-.25,.084,z],.094,'#a08b66','drum','metal');
   }
  }
  for(const cargo of snap.containers){
   if(!cargo.railSlot?.pose)continue;
   const p=toWorld(cargo.railSlot.pose),x=p.x,z=p.z;
   const bounds=railRows.get(x)||[z,z];bounds[0]=Math.min(bounds[0],z);bounds[1]=Math.max(bounds[1],z);railRows.set(x,bounds);
   wagonPositions.push(p);
   for(const dx of [-.075,.075])b.box(x+dx,.014,z,.008,.024,1.30,'#95a0a2');
   if(!compact)for(let j=0;j<6;j++)b.box(x,.002,z-.56+j*.21,.31,.013,.031,'#68685a');
  }
  if(railRows.size){
   const [x,[head]]=railRows.entries().next().value,z=head-1.68;
   // A service locomotive is coupled at the head of the actual task train.
   // Its wheels share the wagon rail heads, with track continuing beyond it.
   b.box(x,-.028,z,.42,.047,2.60,'#60685f');
   for(const dx of [-.075,.075])b.box(x+dx,.013,z,.008,.022,2.65,'#a4ada8');
   for(let j=-6;j<=6;j++)b.box(x,.001,z+j*.197,.33,.012,.033,'#6a6659');
   for(const wheelZ of [-.69,-.51,-.33,.34,.52,.70]){
    b.rod([x-.091,.077,z+wheelZ],[x+.091,.077,z+wheelZ],.029,'#424c4b');
    for(const side of [-1,1])b.roller([x+side*.068,.077,z+wheelZ],[x+side*.085,.077,z+wheelZ],.103,'#576260','flange','metal');
   }
   b.machined(x,.152,z,.30,.095,1.90,'#414f54');b.machined(x,.286,z+.09,.237,.187,1.49,'#bc854e');
   b.machined(x,.345,z-.60,.306,.303,.43,'#d4bb92');b.machined(x,.507,z-.60,.328,.028,.458,'#858e88');
   b.box(x,.395,z-.819,.234,.10,.009,'#415a68',0,'glass');
   for(const side of [-1,1]){
    b.box(x+side*.155,.393,z-.602,.009,.123,.284,'#435e68',0,'glass');
    for(let i=0;i<14;i++)b.box(x+side*.121,.299,z-.31+i*.071,.006,.084,.013,'#697b7b');
    b.rod([x+side*.149,.274,z-.35],[x+side*.149,.274,z+.92],.005,'#d4c39a');
   }
   b.box(x,.203,z-.945,.286,.049,.029,'#d0ac68');b.box(x,.405,z+.50,.10,.061,.18,'#677679');
  }
  for(const [x,[start,end]] of railRows){
   const mid=(start+end)/2,len=end-start+1.44;b.box(x,-.036,mid,.42,.064,len,'#62675e');
   for(const dx of [-.075,.075])b.box(x+dx,.013,mid,.008,.022,len,'#a2a9a7');
  }
  const ranges=[...railRows.values()];
  if(ranges.length){
   const start=Math.min(...ranges.map(r=>r[0]))-2.5,end=Math.max(...ranges.map(r=>r[1]))+4;
   const craneX=toWorld({x:snap.resources.find(r=>r.kind==='RMG')?.pose.x??135,y:330,z:0}).x;
   const left=Math.min(...railRows.keys(),craneX-1.73)-4,right=craneX+4.7;
   // The ballast is only as wide as a railway track. Extend the adjacent
   // service road, crane rails and land continuously to the last module.
   if(end>41){
    const length=end-41,mid=(end+41)/2;
    b.box((left+QUAY_FACE)/2,-.53,mid,QUAY_FACE-left,1.03,length,'#68786e');
    b.box((left+right)/2,-.010,mid,right-left,.018,length,'#5d6869');
    b.box(left+.16,.092,mid,.014,.018,length,'#b4bcb1');
    for(let z=41;z<end;z+=1.8)b.box(left+.16,.053,z,.027,.106,.027,'#8c9993');
   }
  }
  for(const slot of snap.yardSlots||[]){
   const p=toWorld(slot.pose);
   for(const x of [-.63,.63])for(const z of [-.134,.134]){
    b.box(p.x+x*.91,.005,p.z+z,.125,.002,.012,'#cbbd86');
    b.box(p.x+x,.005,p.z+z*.76,.012,.002,.075,'#cbbd86');
   }
  }
  const site=b.finish();site.add(rollingStock(wagonPositions));return site;
 }
 function vessel(){
  const g=new T.Group(),b=batch();
  const profiles=[[-24,.08,1.0],[-22,1.7,.75],[-18,3.75,.30],[-13,4.30,0],[14.0,4.35,0],[18,4.0,.1],[20,3.25,.40],[20.7,2.95,.5]];
  g.add(makeHull(profiles));
  const stacks=batch();
  if(compact){
   // Study slots in the centre retain their original, open receiving area.
   for(let bay=0;bay<17;bay+=2){
    const count=Math.min(2,17-bay),z=-15.4+(bay+(count-1)/2)*1.33;
    for(const side of [-1,1])stacks.box(side*2.31,1.207+.52,z,1.00,1.04,count*1.33-.04,'#ffffff',0,'stockrow');
   }
  }
  if(!compact)for(let bay=0;bay<17;bay++)for(let row=0;row<22;row++){
   const x=(row-10.5)*.275,z=-15.4+bay*1.33;
   if(Math.abs(z)<13.4&&Math.abs(x)<1.76)continue;
   const tiers=3+(bay*7+row*3)%4;
   for(let tier=0;tier<tiers;tier++)container(stacks,x,1.207+tier*.2896,z,paint[(bay*23+row*17+tier*7)%9],Math.PI/2);
  }

  const bridge=batch();
  bridge.box(0,3.5,13.5,6,3.1,4.1,'#c7cfbf');bridge.box(0,5.58,13.5,6.5,1.3,3.7,'#d7d9ca');bridge.box(0,6.62,13.4,7.5,.85,3.2,'#e0ddd0');bridge.box(0,6.67,11.77,6.9,.49,.08, '#354e5d',0,'glass');bridge.box(0,7.14,13.4,7.7,.19,3.35,'#abb9b8');
  for(const x of [-1.9,1.9]){bridge.box(x,4.7,17.2,1.02,4.8,1.47,'#a9634a');bridge.box(x,7.13,17.2,1.10,.48,1.55,'#3c4b50');}
  bridge.rod([0,7.1,13.1],[0,10.3,13.1],.11,'#d6d6c9');bridge.rod([-1.5,9.2,13.1],[1.5,9.2,13.1],.11,'#c3cdc5');bridge.rod([0,2.7,-20.5],[0,6.25,-20.5],.13,'#c9d1c7');
  for(const sign of [-1,1])for(let j=2;j<profiles.length-1;j++){const p=profiles[j],q=profiles[j+1];b.rod([sign*p[1],2.38+p[2],p[0]],[sign*q[1],2.38+q[2],q[0]],.06,'#aeaca1');}
  bridge.box(0,6.67,15.03,6.92,.49,.07, '#334c5c',0,'glass');
  for(const side of [-1,1]){
   bridge.box(side*3.76,6.66,13.4,.08,.49,2.92, '#354e5b',0,'glass');
   for(let j=0;j<6;j++){bridge.box(side*3.04,4.51,11.8+j*.62,.10,.24,.27,'#476373');}
   bridge.box(side*3.36,4.23,14.05,.65,.12,5.2,'#afb5ac');
   bridge.rod([side*3.60,4.62,11.4],[side*3.60,4.62,16.7],.055,'#c5c9bd');
   for(let j=0;j<8;j++)bridge.rod([side*3.6,4.25,11.45+j*.72],[side*3.6,4.64,11.45+j*.72],.045,'#b6c2b5');
   bridge.rod([side*3.45,3.38,15.25],[side*3.45,3.38,17.08],.50,'#d58036');
   for(const z of [-15.5,14.8])for(let j=0;j<5;j++)bridge.box(side*4.2,.38+j*.24,z,.12,.065,.26,'#c8c9b6');
   for(let j=0;j<8;j++)bridge.box(side*3.02,3.58,11.64+j*.48,.05,.22,.19,'#465e69');
  }
  for(let j=0;j<8;j++){bridge.box(-3.12+j*.87,6.65,15.09,.075,.60,.09,'#d4d7cb');bridge.box(-3.12+j*.87,6.65,11.73,.075,.60,.09,'#d4d7cb');}
  bridge.rod([-.89,8.08,13.05],[.89,8.08,13.05],.10,'#b8bfb7');
  for(const side of [-1,1]){bridge.rod([side*2.4,2.8,-19.7],[side*3.12,2.9,-18.8],.19,'#5a6262');}
  for(const sign of [-1,1]){
   for(const z of [-18,-14,-9,-3,3,9,14,17]){
    const x=sign*(Math.abs(z)>16?3.8:4.25);
    b.rod([x,1.97,z],[x,2.13,z],.035,'#aeb8b3',false,'metal');
   }
   // Mooring drums, capstans and fairleads at the fore and aft stations.
   for(const z of [-18.1,18.5]){
    const x=sign*2.35;
    b.roller([x-.34,2.36,z],[x+.34,2.36,z],.40,'#56676a','drum','metal');
    for(const dx of [-.3,.3])b.roller([x+dx-.018,2.36,z],[x+dx+.018,2.36,z],.55,'#747b75','drum','metal');
    b.box(x,2.18,z,.85,.15,.53,'#687b79');
   }
   // Enclosed rescue boat, davit arms and a platform below the bridge wings.
   bridge.machined(sign*3.24,3.96,16.15,.49,.45,1.35,'#d78b46');
   for(const z of [15.67,16.63])bridge.rod([sign*2.88,3.84,z],[sign*3.39,4.55,z],.053,'#bfc9c1',true);
   for(let j=0;j<3;j++)bridge.box(sign*3.07,5.4,12.4+j*.72,.018,.27,.42,'#496474',0,'glass');
  }
  bridge.roller([0,8.0,13.05],[0,8.31,13.05],.38,'#e0e0ce','drum','steel');
  bridge.machined(0,8.36,13.05,1.68,.12,.16,'#d6dbcb');
  bridge.rod([.9,7.08,13.45],[.9,8.6,13.45],.028,'#ccd3c7',false,'metal');
  const name=document.createElement('canvas');name.width=512;name.height=96;const nc=name.getContext('2d');nc.textAlign='center';nc.fillStyle='#e6e5d6';nc.font='bold 57px monospace';nc.fillText('INTERMODAL 01',256,70);
  const nt=new T.CanvasTexture(name);nt.colorSpace=T.SRGBColorSpace;
  const plate=new T.Mesh(new T.PlaneGeometry(4.15,.75),new T.MeshBasicMaterial({map:nt,transparent:true,depthWrite:false}));plate.position.set(0,1.61,20.76);g.add(plate);
  const upperWorks=bridge.finish();upperWorks.name='ship-superstructure';upperWorks.position.z=2.7;g.add(upperWorks,b.finish());g.scale.set(.80,1.2/1.95,.94);
  const vessel=new T.Group(),lines=batch();
  for(const [deckZ,shoreZ] of [[-17.1,-23.7],[-17.6,-11.8],[16.5,23.4],[16.9,11.0]]){
   const x=-3.03,end=QUAY_FACE-.30-48;
   lines.rod([x,1.23,deckZ],[(x+end)/2,.48,(deckZ+shoreZ)/2],.008,'#a99b79');
   lines.rod([(x+end)/2,.48,(deckZ+shoreZ)/2],[end,.083,shoreZ],.008,'#a99b79');
   lines.roller([end,.01,shoreZ],[end,.079,shoreZ],.060,'#967a4f','drum','metal');
   lines.roller([end,.079,shoreZ],[end,.100,shoreZ],.084,'#c0a06c','drum','metal');
  }
  vessel.add(g,stacks.finish(),lines.finish());vessel.position.set(48,0,12.7);return vessel;
 }
 // Contact is the underside of the locking feet. An independent frame keeps
 // the real twistlock spacing intact when the illustrative gantry is resized.
 function hoist(root,ceiling,{trolley=true}={}){
  const frame=batch(),cords=batch(),head=batch(),spreader=new T.Group(),endFrames=[];
  frame.machined(0,.040,0,.52,.071,.091,'#d9a338');
  frame.box(0,.080,.024,.18,.025,.041,'#817762',0,'metal');
  spreader.add(frame.finish());
  for(const sign of [-1,1]){
   const end=batch();
   // Fixed-width crossheads and twistlocks move along the telescopic arms.
   // The arms slide inside the central housing on the 20-foot setting.
   end.box(-sign*.19,.034,sign*.014,.38,.038,.039,'#b99a4f');
   end.roller([-sign*.32,.063,sign*.025],[-sign*.048,.063,sign*.025],.012,'#98a59c','drum','metal');
   end.machined(0,.026,0,.045,.046,.23,'#dbad50');
   for(const z of [-.105,.105]){
    end.box(0,.014,z,.028,.028,.031,'#424d50',0,'metal');
    end.rod([-sign*.013,.033,z],[sign*.024,.010,z*1.10],.012,'#a6843d',true);
   }
   const pair=end.finish();spreader.add(pair);endFrames.push([sign,pair]);
  }
  for(const dx of [-.20,.20])for(const dz of [-.041,.041])cords.box(dx,.5,dz,.003,1,.003,'#343e42',0,'metal');
  const wire=cords.finish();root.add(spreader,wire);
  let carriage;
  if(trolley){
   head.box(0,.015,0,.81,.13,.48,'#4e666b');head.box(.21,-.19,.22,.19,.27,.18,'#dacc9d');head.box(.21,-.16,.311,.14,.13,.009, '#426172',0,'glass');
   for(const x of [-.26,.26])for(const z of [-.16,.16]){
    head.roller([x,0,z-.022],[x,0,z+.022],.105,'#657376','rim','metal');head.box(x,-.049,z,.126,.011,.065,'#a29365');
   }
   head.roller([-.11,.110,0],[.11,.110,0],.097,'#89918d','drum','metal');
   head.machined(-.16,.111,0,.121,.083,.101,'#698489');
   carriage=head.finish();carriage.name='hoist-carriage';root.add(carriage);
  }
  return (contact,length,yaw)=>{
   const lift=Math.max(.001,ceiling-contact.y);
   spreader.position.copy(contact);spreader.rotation.y=yaw;
   for(const [sign,end] of endFrames)end.position.x=sign*(length/2-.012);
   wire.position.copy(contact);wire.position.y+=.035;wire.scale.set(1,Math.max(.001,lift-.035),1);wire.rotation.y=yaw;
   if(carriage)carriage.position.set(contact.x,ceiling,contact.z);
   return spreader;
  };
 }
 function crane(kind,index=1){
  const b=batch(),quay=kind==='QC',span=quay?7:gantryGauge[kind]/(SCENE_METRES*.54),height=quay?13.5:6.2,depth=quay?4.5:3.2;
  const steel=quay?(index%2?'#007ca1':'#cc8139'):kind==='RMG'?'#46818b':'#629a73',dark=quay?(index%2?'#326875':'#96613b'):'#50746d';
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const x=sx*span/2,z=sz*depth/2;b.box(x,.174,z,.32,.28,1.16,'#334650');
   b.rod([x,.26,z],[x-sx*.68,height,z-sz*.28],quay?.51:.34,steel,true);
  }
  for(const sz of [-1,1]){
   const z=sz*depth/2;
   b.rod([-span/2,height-.2,z],[span/2,height-.2,z],.47,steel,true);
   if(quay){
    b.rod([-span/2,2.3,z],[-span/2+.64,6.7,z],.26,dark,true);
    b.rod([-4.2,13.3,z],[.62,20.0,z],.39,steel,true);
    b.rod([.62,20,z],[3.1,13.5,z],.39,steel,true);
    b.rod([.62,20,z],[14.5,13.35,z],.12,'#68797c');
    b.rod([.62,20,z],[-9.2,13.35,z],.12,'#68797c');
   }
   const start=quay?-9.2:-span/2-.5,end=quay?16.7:span/2+.5;
   for(const y of [height,height+.79])b.rod([start,y,z],[end,y,z],.22,steel,true);
   const segments=quay?17:kind==='YC'?16:6;
   for(let i=0;i<segments;i++)b.rod([start+(end-start)*i/segments,height+(i%2)*.79,z],[start+(end-start)*(i+1)/segments,height+((i+1)%2)*.79,z],.13,steel,true);
  }
  for(const sx of [-1,1]){
   const x=sx*(span/2-.4);b.rod([x,height,-depth/2],[x,height,depth/2],.48,steel,true);
   b.rod([x,1,-depth/2],[x,height*.75,depth/2],.21,dark,true);b.rod([x,1,depth/2],[x,height*.75,-depth/2],.21,dark,true);
  }
  if(quay){b.box(-6.1,height+.97,0,3.7,1.65,4.5,'#cea976');b.box(-6.1,height+1.89,0,3.92,.18,4.72,'#dad4b5');b.rod([.62,20,-depth/2],[.62,20,depth/2],.3,steel,true);}
  if(!compact){
  // Maintenance access, guards, stair flights and bogies give each gantry a human scale.
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const x=sx*span/2,z=sz*depth/2;
   for(const dz of [-.43,-.18,.18,.43])b.rod([x-.17,.13,z+dz],[x+.17,.13,z+dz],.24,'#27383c');
  }
  const gx=-span/2-.10,gz=depth/2+.12;
  b.rod([gx-.045,.12,gz],[gx-.045,height+.19,gz],.012,'#d9bf82');b.rod([gx+.045,.12,gz],[gx+.045,height+.19,gz],.012,'#d9bf82');
  for(let y=.16;y<height+.19;y+=.087)b.rod([gx-.045,y,gz],[gx+.045,y,gz],.011,'#ccb979');
  for(let x=quay?-8:-span/2;x<(quay?14:span/2);x+=.37)b.rod([x,height+.09,gz],[x,height+.28,gz],.01,'#d9bd79');
  b.rod([quay?-8:-span/2,height+.28,gz],[quay?14:span/2,height+.28,gz],.014,'#e4ca82');
  if(quay){
   b.box(-2.8,3.80,gz,1.21,.047,.64,'#778885');
   b.box(-2.65,4.08,gz,.43,.55,.52,'#d8c69c');b.box(-2.430,4.13,gz,.008,.27,.45, '#496274',0,'glass');
   b.box(-2.65,4.13,gz+.265,.366,.27,.008, '#496274',0,'glass');
   for(let i=0;i<30;i++)b.box(-3.98+i*.044,.92+i*.096,gz,.072,.023,.21,'#b4ac90');
   b.rod([-4.01,1.12,gz+.12],[-2.68,4.0,gz+.12],.014,'#dfc479');
  }
  if(quay){
   // Decks terminate at the access door and the lifting machinery. Each
   // returning stair flight has an intermediate landing and paired rails.
   const rear=-6.12,edge=depth/2+.20;
   b.box(-2.8,height+.06,edge,12.8,.060,.38,'#7b8886',0,'metal');
   b.box(rear,height+.64,depth/2+.016,.54,1.05,.028,'#6b7b80');
   for(let l=0;l<5;l++){
    const low=height*.18+l*height*.145,high=low+height*.145;
    const start=l%2===0?-3.76:-2.79,end=l%2===0?-2.79:-3.76;
    b.box(start,low,edge,.57,.045,.58,'#748580',0,'metal');
    for(let j=0;j<12;j++){const f=(j+.5)/12;b.box(start+(end-start)*f,low+(high-low)*f,edge,.13,.018,.25,'#a3a99b',0,'metal');}
    for(const dz of [-.16,.16]){
     b.rod([start,low+.21,edge+dz],[end,high+.21,edge+dz],.018,'#e1be68',false,'metal');
     b.rod([start,low,edge+dz],[end,high,edge+dz],.054,'#8a9795',true);
    }
    b.box(end,high,edge,.57,.045,.58,'#788a84',0,'metal');
   }
   for(const x of [-8.9,15.9])for(const z of [-depth*.45,depth*.45]){
    b.roller([x,height+.47,z-.07],[x,height+.47,z+.07],.47,'#788887','rim','metal');
    b.box(x,height+.20,z,.55,.10,.25,'#677a7c');
   }
   for(let j=0;j<8;j++)b.box(rear-1.3+j*.36,height+1.07,depth/2+.014,.21,.68,.030,'#84908c');
  }
  }
  const root=new T.Group(),structure=b.finish();
  structure.scale.set(quay?gantryGauge.QC/(SCENE_METRES*span):.54,quay?.51:.42,quay?.53:.48);
  root.add(structure);
  const ceiling=(height-.28)*structure.scale.y;
  const pose=hoist(root,ceiling);
  pose(v(0,ceiling-.25,0),1.2192,0);
  return {model:root,pose};
 }
 const occlusion=document.createElement('canvas');occlusion.width=occlusion.height=96;
 const oc=occlusion.getContext('2d'),ocGradient=oc.createRadialGradient(48,48,0,48,48,48);
 ocGradient.addColorStop(0,'rgba(8,14,17,.55)');ocGradient.addColorStop(.58,'rgba(8,14,17,.33)');ocGradient.addColorStop(1,'rgba(8,14,17,0)');
 oc.fillStyle=ocGradient;oc.fillRect(0,0,96,96);
 const shadowTexture=new T.CanvasTexture(occlusion),shadowGeometry=new T.PlaneGeometry(1,1);
 const shadowMaterial=new T.MeshBasicMaterial({map:shadowTexture,depthWrite:false,transparent:true,toneMapped:false});
 function contactShadow(root,length,width){
  const shadow=new T.Mesh(shadowGeometry,shadowMaterial);shadow.rotation.x=-Math.PI/2;
  shadow.scale.set(length,width,1);shadow.position.y=.005;shadow.raycast=()=>{};root.add(shadow);
 }
 const plates=new Map(),plateGeometry=new T.PlaneGeometry(.137,.035);
 sharedExtras.push(plateGeometry);
 function addVehicleMark(group,id){
  if(!plates.has(id)){
   const card=document.createElement('canvas');card.width=256;card.height=64;
   const c=card.getContext('2d');c.fillStyle='#1e475c';c.fillRect(0,0,256,64);
   c.fillStyle='#f3f1de';c.textAlign='center';c.font='bold 48px monospace';c.fillText(id,128,49);
   const texture=new T.CanvasTexture(card);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
   const mat=new T.MeshStandardMaterial({map:texture,roughness:.53,metalness:.16});
   plates.set(id,mat);sharedExtras.push(texture,mat);
  }
  for(const side of [-1,1]){
   const plate=new T.Mesh(plateGeometry,plates.get(id));plate.position.set(-.092,.075,side*.153);
   plate.rotation.y=side<0?Math.PI:0;group.add(plate);
  }
 }
 function vehicle(kind,index=1){
  if(['RMG','YC','QC'].includes(kind))return crane(kind,index);
  const b=batch(),root=new T.Group();
  if(kind==='SMV'){
   // Under-running suspension bogies and compact drive cases are above the spreader.
   b.box(0,-.055,0,1.15,.089,.13,'#d4a74c');
   for(const x of [-.47,.47]){
    b.box(x,-.039,0,.20,.087,.174,'#c6ccc2');
    for(const z of [-.075,.075])b.rod([x,-.009,z-.008],[x,-.009,z+.008],.069,'#424b50');
    b.box(x,-.113,0,.11,.096,.092,'#777f76');
   }
   b.box(0,-.117,0,.70,.060,.095,'#9a874d');
   root.add(b.finish());const pose=hoist(root,-.10,{trolley:false});
   pose(v(0,-.2,0),1.2192,0);return {model:root,pose};
  }
  if(kind==='BAY'){
   for(const x of [-.78,.78])for(const z of [-.26,.26]){
    b.box(x,.35,z,.036,.70,.037,'#829b9a');b.box(x,.017,z,.09,.034,.105,'#959d94');
   }
   for(const z of [-.26,.26])b.box(0,.71,z,1.60,.036,.039,'#c8b988');
   root.add(b.finish());return {model:root,pose(){}};
  }
  const et=kind==='ET',body=et?'#bd9e63':'#126f96',frame='#37474e';
  // Reference silhouette: Qingdao AGV maintenance photo, 13 March 2020
  // https://www.qingdaonews.com/app/content/2020-03/15/content_21418524.htm
  // Keep the load supports at 1.20 m in this representative vehicle.
  const deck=.12,baseLength=et?1.30:1.47,wheelRadius=et?.047:.052;
  b.machined(0,.070,0,baseLength,.067,.185,frame);
  for(const z of [-.100,.100]){
   b.box(0,deck-.008,z,1.25,.016,.035,'#83999d');
   for(const x of [-.572,-.267,.267,.572])b.box(x,deck-.003,z,.042,.006,.046,'#586568',0,'rubber');
  }
  function roadWheel(x){
   const axleY=wheelRadius+.002;
   b.rod([x,axleY,-.13],[x,axleY,.13],.023,frame,false,'metal');
   for(const side of [-1,1]){
    const y=axleY,inside=.110,outside=.149;
    b.roller([x,y,side*inside],[x,y,side*outside],wheelRadius*2,'#272a29','tyre','rubber');
    b.roller([x,y,side*(outside-.008)],[x,y,side*(outside+.0003)],wheelRadius*1.16,et?'#899594':'#307592','rim','metal');
    for(let j=0;j<8;j++){
     const angle=j*Math.PI/4;const xx=x+wheelRadius*.32*Math.cos(angle),yy=y+wheelRadius*.32*Math.sin(angle);
     b.roller([xx,yy,side*outside],[xx,yy,side*(outside+.0019)],.0039,'#bdc0b1','drum','metal');
    }
    b.box(x,.112,side*.128,.164,.011,.049,body);
   }
  }
  for(const x of et?[-.51,-.37,.37,.79]:[-.477,.477])roadWheel(x);
  if(et){
   b.box(.779,.071,0,.35,.058,.214,frame);
   b.machined(.78,.190,0,.246,.230,.235,'#c5a26a');b.machined(.78,.311,0,.263,.018,.249,'#dbcfb4');
   b.box(.905,.238,0,.004,.077,.204,'#537383',0,'glass');
   for(const side of [-1,1]){
    const z=side*.120;b.box(.791,.238,z,.143,.078,.005,'#507280',0,'glass');
    b.box(.751,.116,side*.132,.080,.009,.029,'#9ca6a0',0,'metal');
    b.rod([.854,.258,z],[.88,.268,z*1.26],.004,'#4a585e');b.machined(.882,.258,z*1.26,.024,.030,.012,'#49585c');
    for(const dx of [-.56,.56])b.box(dx,.129,side*.131,.026,.026,.014,'#ad904d');
   }
  }else{
   // Narrow centre spine keeps the tyres and the full-height wheel arches open.
   for(const side of [-1,1]){
    for(const x of [-.65,.65])b.machined(x,.070,side*.112,.147,.077,.061,body);
    b.machined(0,.067,side*.114,.787,.086,.060,body);
    for(let i=0;i<4;i++){
     const x=(i-1.5)*.183,z=side*.147;
     b.machined(x,.071,z,.175,.065,.008,'#d5d7ca');
     b.box(x+.069,.082,z+side*.004,.012,.008,.001,'#38474b',0,'rubber');
     for(let k=0;k<6;k++)b.box(x-.052+k*.021,.048,z+side*.0045,.013,.0028,.0012,'#687c7c');
    }
    for(const x of [-.43,.43]){b.box(x,.117,side*.132,.14,.009,.05,body);b.box(x,.124,side*.137,.027,.015,.014,'#d8b16d');}
   }
   for(const x of [-.672,.672]){
    b.machined(x,.101,0,.118,.064,.284,body);
    for(let j=0;j<8;j++)b.box(x,.134,-.094+j*.026,.053,.002,.009,'#526873',0,'metal');
    b.machined(x,.143,.064,.032,.023,.042,'#303f46', 'rubber');
    b.roller([x,.138,-.075],[x,.156,-.075],.025,'#d89b46','drum','glass');
   }
  }
  for(const side of [-1,1]){
   const x=side*(et?.642:.736);
   b.machined(x,.062,0,.016,.035,.269,'#303839','rubber');
   for(let k=0;k<10;k++)b.box(x+side*.009,.062,-.113+k*.025,.003,.016,.013,'#d2aa4f');
   for(const z of [-.105,.105])b.machined(x+side*.009,.089,z,.006,.013,.024,side>0?'#e4e5ce':'#b25442','glass');
  }
  root.add(b.finish());if(!et)addVehicleMark(root,'AGV-'+String(index).padStart(2,'0'));contactShadow(root,et?1.9:1.59,.47);return {model:root,pose(){}};
 }
 return {batch,container,containerHardware,vehicle,vessel,infrastructure,terminalFurniture,material,cube,cargoGeo,tube,dispose(){shadowGeometry.dispose();shadowMaterial.dispose();shadowTexture.dispose();rowsTexture?.dispose();cube.dispose();yardGeo.dispose();cargoGeo.dispose();tube.dispose();foliage.dispose();for(const m of materials.values())m.dispose();for(const tex of [paintMaps.map,paintMaps.normalMap,paintMaps.roughnessMap])tex?.dispose();for(const g of Object.values(shapes))g.dispose();for(const extra of sharedExtras)extra.dispose();}};
}
