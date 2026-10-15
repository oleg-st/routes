import {fullMaps} from './data/full-maps.js';
import {mapStarts} from './data/map-starts.js';
import {campfires} from './data/map-campfires.js';
import {combinedMap} from './data/combined-maps.js';
export function mapCampfires(dungeon,view){
  return (campfires[dungeon.id]||[]).filter(p=>onMap(p,view)).map(p=>({id:p.id,point:view.sources&&p.overviewPoint?p.overviewPoint:mapCoordinates(p,view)}));
}
export function mapStart(dungeon,view){
  const start=mapStarts[dungeon.id];
  if(!start||!onMap(start,view))return null;
  const point=mapCoordinates(start,view);
  // Some stitched backgrounds crop the entrance (Regath). Mark the edge
  // leading to it, with enough inset to keep the flag and label on the image.
  return point.map((value,i)=>{const size=i?view.height:view.width;return value<0?size*.03:value>size?size*.97:value;});
}
export function mapViews(dungeon){
  const full=fullMaps[dungeon.id],combined=combinedMap(dungeon);
  const layers=full?Object.keys(full.sources).map(id=>dungeon.mapImages.find(m=>m.id===id)).filter(Boolean):dungeon.mapImages;
  // Published builds retain reference coordinates but omit its private background.
  return [combined,full,...layers].filter(view=>view?.path);
}
export function onMap(position,view){return !!position.mapPosition&&(position.mapImageId===view.id||!!view.sources?.[position.mapImageId]);}
export function mapCoordinates(position,view){
  if(view.sources&&position.mapMembers?.length){const points=position.mapMembers.map(p=>mapCoordinates(p,view));return [0,1].map(i=>points.reduce((sum,p)=>sum+p[i],0)/points.length);}
  if(view.referenceId){
    const reference=fullMaps[view.referenceId];
    // Empty/one-encounter source layers lack a fitted world calibration. Their
    // original-layer drawings use the recipe's explicit source transform.
    if(position.worldPosition||reference.sources[position.mapImageId]?.calibration||view.placements?.[position.placementId])return mapCoordinates(position,reference);
  }
  if(view.placements?.[position.placementId])return view.placements[position.placementId];
  const p=position.mapPosition;let t=view.sources?.[position.mapImageId];
  if(!t)return [p.x*view.width,p.y*view.height];
  if(view.kind==='combined')return [t.x+p.x*t.width,t.y+p.y*t.height];
  const c=t.calibration,w=position.worldPosition||(c?{y:p.x*c.sx+c.ox,x:p.y*c.sy+c.oy}:null);
  if(!w)return null;
  const inside=source=>['x','y','z'].every(k=>w[k]>=source.bounds[0][k]&&w[k]<=source.bounds[1][k]);
  // Upstream planners disagree on some floor boundaries. Only switch when
  // world coordinates identify one unambiguous reference floor.
  if(Number.isFinite(w.z)&&!inside(t)){
    const matches=Object.values(view.sources).filter(inside);
    if(matches.length===1)t=matches[0];
  }
  // Leaflet reference coordinates increase upwards; SVG increases downwards.
  return [(w.y-t.left)*t.factor+t.x,view.height-((w.x-t.bottom)*t.factor+t.y)];
}
// Referenced coordinates remain valid for saved objects in published builds,
// even though that view and its private background are no longer offered.
export function drawingMap(dungeon,id){
  return mapViews(dungeon).find(map=>map.id===id)||dungeon.mapImages.find(map=>map.id===id)||(fullMaps[dungeon.id]?.id===id?fullMaps[dungeon.id]:null);
}
function drawingBasis(view,dungeon){
  const overview=combinedMap(dungeon)||fullMaps[dungeon.id];
  // Full map and Referenced share the calibrated overview coordinate frame.
  if(view.sources||!overview)return [[0,0],[1,0],[0,1]];
  return [[0,0],[1,0],[0,1]].map(([x,y])=>mapCoordinates({mapImageId:view.id,mapPosition:{x:x/view.width,y:y/view.height}},overview));
}
function applyBasis(point,basis){
  const [o,x,y]=basis;
  return [0,1].map(i=>o[i]+point[0]*(x[i]-o[i])+point[1]*(y[i]-o[i]));
}
function invertBasis(point,basis){
  const [o,x,y]=basis,a=x[0]-o[0],b=y[0]-o[0],c=x[1]-o[1],d=y[1]-o[1],det=a*d-b*c;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  const dx=point[0]-o[0],dy=point[1]-o[1];
  return [(d*dx-b*dy)/det,(a*dy-c*dx)/det];
}
function projectDrawingPoint(point,source,target,dungeon){
  if(source.id===target.id||source.sources&&target.sources)return [...point];
  return invertBasis(applyBasis(point,drawingBasis(source,dungeon)),drawingBasis(target,dungeon));
}
function drawingIntersectsMap(drawing,view){
  const inside=([x,y])=>x>=0&&x<=view.width&&y>=0&&y<=view.height;
  if(drawing.kind==='note')return inside(drawing.points[0]);
  if(drawing.points.some(inside))return true;
  // A line can cross the map even when both endpoints are outside it.
  return drawing.points.slice(1).some((b,i)=>{
    const a=drawing.points[i];let start=0,end=1;
    for(const [axis,limit] of [[0,view.width],[1,view.height]]){
      const delta=b[axis]-a[axis];
      if(Math.abs(delta)<1e-12){if(a[axis]<0||a[axis]>limit)return false;continue;}
      const t0=-a[axis]/delta,t1=(limit-a[axis])/delta;
      start=Math.max(start,Math.min(t0,t1));end=Math.min(end,Math.max(t0,t1));
      if(start>end)return false;
    }
    return true;
  });
}
export function drawingOnMap(drawing,view,dungeon){
  const source=drawingMap(dungeon,drawing.mapId);
  if(!source)return null;
  const points=drawing.points.map(point=>projectDrawingPoint(point,source,view,dungeon));
  if(points.some(point=>!point?.every(Number.isFinite)))return null;
  const projected=source.id===view.id?drawing:{...drawing,points};
  return drawingIntersectsMap(projected,view)?projected:null;
}
// Editing from any view writes back into the object's original coordinate frame.
// Do not apply visibility filtering here: dragging may cross the map boundary.
export function drawingPointFromMap(point,drawing,view,dungeon){
  const source=drawingMap(dungeon,drawing.mapId);
  return source?projectDrawingPoint(point,view,source,dungeon):null;
}
