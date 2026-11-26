import * as T from './vendor/three/three.module.js';

// SwiftShader transforms every submitted triangle on the CPU. These stock
// textures depict non-task heaps; numbered task containers stay individual.
export function stackTexture(){
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=192;
 const ctx=canvas.getContext('2d'),palette=['#96634e','#507b80','#b28753','#6d8b9b','#a16e60','#698477','#989c90','#c0a684'];
 for(let row=0;row<4;row++)for(let col=0;col<4;col++){
  const x=col*96,y=row*48;ctx.fillStyle=palette[(row*3+col*5+row*col)%palette.length];ctx.fillRect(x,y,96,48);
  ctx.fillStyle='rgba(39,49,46,.47)';ctx.fillRect(x,y+46,96,2);ctx.fillRect(x+94,y,2,48);
  ctx.fillStyle='rgba(220,219,195,.16)';ctx.fillRect(x+2,y+2,91,2);
  for(let j=6;j<94;j+=5){ctx.fillStyle='rgba(31,43,39,.14)';ctx.fillRect(x+j,y+5,1.3,39);}
 }
 const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;return tex;
}

export function createCompatibilityAppearance(){
 const replacements=new Map(),created=new Set(),night={value:0};
 function matte(source){
  if(replacements.has(source))return replacements.get(source);
  const m=new T.MeshBasicMaterial({color:source.color??'#ffffff',map:source.map||null,vertexColors:source.vertexColors,
   transparent:source.transparent,opacity:source.opacity,side:source.side,depthWrite:source.depthWrite,
   polygonOffset:source.polygonOffset,polygonOffsetFactor:source.polygonOffsetFactor,polygonOffsetUnits:source.polygonOffsetUnits,
   toneMapped:false});
  // Unlike an unlit flat tint this retains face orientation on a rotated
  // container, machine or girder. Illumination is evaluated per vertex.
  const pavement=source.userData.surfaceKind;
  m.onBeforeCompile=shader=>{
   shader.uniforms.portNight=night;
   shader.vertexShader='varying float directionalShade;\n'+shader.vertexShader.replace('#include <project_vertex>',`
    mat3 axes=mat3(modelMatrix);
    #ifdef USE_INSTANCING
     axes=axes*mat3(instanceMatrix);
    #endif
    vec3 safeScale=max(vec3(dot(axes[0],axes[0]),dot(axes[1],axes[1]),dot(axes[2],axes[2])),vec3(1.e-12));
    vec3 nWorld=normalize(axes*(normal/safeScale));
    directionalShade=.51+.47*max(0.,dot(nWorld,normalize(vec3(-.72,.58,.33))))+.13*max(0.,nWorld.y);
    #include <project_vertex>`);
   shader.fragmentShader='varying float directionalShade;uniform float portNight;\n'+shader.fragmentShader.replace('#include <color_fragment>',
    '#include <color_fragment>\ndiffuseColor.rgb*=directionalShade*mix(vec3(1.08,1.04,.99),vec3(.25,.34,.46),portNight);');
   if(pavement){
    const concrete=pavement.startsWith('concrete');
    shader.vertexShader='varying vec2 pavedXZ;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\npavedXZ=(modelMatrix*vec4(transformed,1.)).xz;');
    const tint=concrete?`vec2 panels=pavedXZ/vec2(.70,.51);float tone=fract(dot(floor(panels),vec2(.267,.383)));
     vec2 edge=min(fract(panels),1.-fract(panels));float seam=1.-smoothstep(.003,.019,min(edge.x,edge.y));
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.29,.30,.285),.49)*(.965+.065*tone-.065*seam);`:
     'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.15,.16,.16),.35);';
    shader.fragmentShader='varying vec2 pavedXZ;\n'+shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+tint);
   }
  };
  m.customProgramCacheKey=()=>pavement||'matte-object';
  replacements.set(source,m);created.add(m);return m;
 }
 function apply(root){
  root.traverse(o=>{
   if(!o.isMesh)return;
   if(o.material?.isMeshStandardMaterial)o.material=matte(o.material);
  });
 }
 const pixels=new Uint8Array(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const ripple=Math.sin((x*2+y*7)*Math.PI/32+Math.sin(x*Math.PI/8))*.044+Math.sin((x*5-y*3)*Math.PI/32)*.026;
  const n=(y*64+x)*4;for(let k=0;k<3;k++)pixels[n+k]=Math.round(233+ripple*233);pixels[n+3]=255;
 }
 const ripples=new T.DataTexture(pixels,64,64);ripples.wrapS=ripples.wrapT=T.RepeatWrapping;
 ripples.repeat.set(165,165);ripples.magFilter=T.LinearFilter;ripples.minFilter=T.LinearMipMapLinearFilter;ripples.generateMipmaps=true;ripples.needsUpdate=true;
 const waterMat=new T.MeshBasicMaterial({color:'#427a81',map:ripples,toneMapped:false});
 const water=new T.Mesh(new T.PlaneGeometry(1600,1600),waterMat);water.rotation.x=-Math.PI/2;water.position.set(65,-.72,0);
 function setNight(value){night.value=value?1:0;waterMat.color.set(value?'#193545':'#3e727a');}
 function dispose(){ripples.dispose();for(const m of created)m.dispose();for(const m of replacements.keys())m.dispose();replacements.clear();created.clear();}
 return {apply,water,setNight,dispose};
}
