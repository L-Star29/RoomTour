import * as THREE from 'three';

// Intersect the actual surface instead of placing the marker on a bounding-box face.
export function surfaceAnchor(object, direction = 'top', fraction = null) {
 object.updateWorldMatrix(true,true);
 const box=new THREE.Box3().setFromObject(object);
 const center=box.getCenter(new THREE.Vector3());
 if(fraction){center.x=THREE.MathUtils.lerp(box.min.x,box.max.x,fraction[0]);center.z=THREE.MathUtils.lerp(box.min.z,box.max.z,fraction[1]);}
 const extent=box.getSize(new THREE.Vector3()).length()+.1;
 const axis=direction==='top'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
 const ray=new THREE.Raycaster(center.clone().addScaledVector(axis,extent),axis.clone().negate());
 const hit=ray.intersectObject(object,true)[0];
 if(hit)return hit.point.clone().addScaledVector(axis,.002);
 // Thin or open meshes may not intersect at their center. Use an actual vertex.
 let nearest=null,distance=Infinity;
 object.traverse(mesh=>{
  const positions=mesh.geometry?.attributes?.position;
  if(!positions)return;
  for(let i=0;i<positions.count;i++){
   const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
   const d=p.distanceToSquared(center);
   if(d<distance){nearest=p;distance=d;}
  }
 });
 return nearest?nearest.addScaledVector(axis,.002):center;
}
