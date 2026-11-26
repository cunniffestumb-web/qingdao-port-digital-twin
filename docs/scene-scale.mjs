// Metres in the scenario axes (horizontal x/y, vertical z). Three uses Y-up.
// Hapag-Lloyd Container Specification, p.5, ISO 668 external dimensions:
// https://static-cf.hapag-lloyd.com/content/dam/website/downloads/local_info/HPL-CONTAINER_SPECIFICATION.pdf
// Refrigerated tasks represent 40 ft high-cube reefers in this scenario.
const standard20 = Object.freeze({length:6.058,width:2.438,height:2.591});
const highCube40 = Object.freeze({length:12.192,width:2.438,height:2.896});
export const SCENE_METRES = 10;
// Quay face at scenario x=1043 m. The buffer projects into a 2.2 m mooring gap.
export const QUAY_FACE = 44.30;
export const QC_GAUGE = 3.048;
export function containerMetres(type){return type==='20GP'?standard20:highCube40;}
export function cargoSize(type){
 const {length,width,height}=containerMetres(type);
 return {length:length/SCENE_METRES,width:width/SCENE_METRES,height:height/SCENE_METRES};
}
