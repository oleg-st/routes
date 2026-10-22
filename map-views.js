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
export function mapPatrols(placements,view){
  const packs=new Map();
  for(const p of placements){
    const reference=!p.gameGuid&&view.patrols?.[view.placementPatrols?.[p.placementId]];
    const segments=[];let segment=[];
    const flush=()=>{if(segment.length>1)segments.push(segment);segment=[];};
    if(reference?.length>1)segment=reference;
    else for(const [i,point] of (p.mapPatrolPath||[]).entries()){
      // Keep floor transitions disconnected, including on stitched overviews.
      if(i&&(point.mapImageId!==p.mapPatrolPath[i-1].mapImageId||
        positionRegion(point,view)?.id!==positionRegion(p.mapPatrolPath[i-1],view)?.id))flush();
      const xy=onMap(point,view)?mapCoordinates({...point,worldPosition:p.patrolPath?.[i]},view):null;
      if(xy)segment.push(xy);else flush();
    }
    flush();
    if(!segments.length)continue;
    const length=segments.reduce((total,points)=>total+points.slice(1).reduce((sum,point,i)=>sum+Math.hypot(point[0]-points[i][0],point[1]-points[i][1]),0),0);
    const key=p.packId??p.placementId,previous=packs.get(key);
    // Offset member trails describe one pack patrol. Use the longest existing
    // trail instead of inventing averaged coordinates; break ties consistently.
    if(!previous||length>previous.length||length===previous.length&&p.placementId<previous.placementId){
      packs.set(key,{packId:p.packId,placementId:p.placementId,segments,length});
    }
  }
  return [...packs.values()].flatMap(({packId,segments})=>segments.map(points=>({packId,points})));
}
function insidePolygon([x,y],polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [ax,ay]=polygon[i],[bx,by]=polygon[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
}
function displayRegions(view,mapImageId){
  return (view.referenceId?fullMaps[view.referenceId]:view).displayRegions?.filter(r=>r.mapImageId===mapImageId)||[];
}
function projectRegion(point,region){
  const t=region.transform;
  return [t.x+point[0]*t.width,t.y+point[1]*t.height];
}
function positionRegion(position,view){
  const reference=view.referenceId?fullMaps[view.referenceId]:view;
  const c=reference.sources?.[position.mapImageId]?.calibration,w=position.worldPosition,p=position.mapPosition;
  const normalized=w&&c?[(w.y-c.ox)/c.sx,(w.x-c.oy)/c.sy]:p&&[p.x,p.y];
  return normalized&&displayRegions(view,position.mapImageId).find(r=>insidePolygon(normalized,r.polygon));
}
export function mapCoordinates(position,view){
  if(view.sources&&position.mapMembers?.length){const points=position.mapMembers.map(p=>mapCoordinates(p,view));return [0,1].map(i=>points.reduce((sum,p)=>sum+p[i],0)/points.length);}
  if(view.referenceId){
    const reference=fullMaps[view.referenceId];
    // Empty/one-encounter source layers lack a fitted world calibration. Their
    // original-layer drawings use the recipe's explicit source transform.
    if(position.worldPosition||reference.sources[position.mapImageId]?.calibration||view.placements?.[position.placementId])return mapCoordinates(position,reference);
  }
  if(!position.gameGuid&&view.placements?.[position.placementId])return view.placements[position.placementId];
  const p=position.mapPosition;let t=view.sources?.[position.mapImageId];
  if(!t)return [p.x*view.width,p.y*view.height];
  if(view.kind==='combined')return [t.x+p.x*t.width,t.y+p.y*t.height];
  const c=t.calibration,w=position.worldPosition||(c?{y:p.x*c.sx+c.ox,x:p.y*c.sy+c.oy}:null);
  if(!w)return null;
  // Some source textures show two floors on top of each other. A cropped
  // region of one floor is displayed separately in the overview artwork.
  // Apply the same transform to all coordinates, including new game actors.
  const normalized=c?[(w.y-c.ox)/c.sx,(w.x-c.oy)/c.sy]:p&&[p.x,p.y];
  const region=positionRegion(position,view);
  if(region)return projectRegion(normalized,region);
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
// Log map changes may have an empty name, and mapImages is not entrance-first.
// Resolve a layer from its world bounds instead of projecting through an
// arbitrary first layer. Overlapping floors without a name/height stay unknown.
export function worldMapImage(worldPosition,dungeon,mapName){
  if(dungeon.mapImages.length===1)return dungeon.mapImages[0];
  const sources=fullMaps[dungeon.id]?.sources;
  const contains=map=>{
    const bounds=map.gameFrame?.bounds??sources?.[map.id]?.bounds;
    return bounds&&['x','y','z'].every(k=>!Number.isFinite(worldPosition[k])||worldPosition[k]>=bounds[0][k]&&worldPosition[k]<=bounds[1][k]);
  };
  const named=dungeon.mapImages.find(m=>mapName&&m.name===mapName);
  if(named&&(!(named.gameFrame?.bounds??sources?.[named.id]?.bounds)||contains(named)))return named;
  const matches=dungeon.mapImages.filter(contains);
  if(matches.length===1)return matches[0];
  if(mapName==='Start'){
    const entrance=dungeon.mapImages.find(m=>m.id===mapStarts[dungeon.id]?.mapImageId);
    if(entrance&&(!(entrance.gameFrame?.bounds??sources?.[entrance.id]?.bounds)||contains(entrance)))return entrance;
  }
  return null;
}
// Log events have world coordinates but no normalized map position. Overviews
// already contain world transforms; original layers need their own calibration.
export function worldMapCoordinates(worldPosition,mapImageId,view,dungeon){
  if(!Number.isFinite(worldPosition?.x)||!Number.isFinite(worldPosition?.y))return null;
  const layer=dungeon.mapImages.find(m=>m.id===mapImageId);
  if(view.kind==='combined'&&!view.referenceId&&view.sources?.[mapImageId]){
    if(!layer)return null;
    const xy=worldMapCoordinates(worldPosition,mapImageId,layer,dungeon),t=view.sources[mapImageId];
    return xy?[t.x+xy[0]/layer.width*t.width,t.y+xy[1]/layer.height*t.height]:null;
  }
  if(view.sources?.[mapImageId])return mapCoordinates({worldPosition,mapImageId},view);
  if(view.id!==mapImageId)return null;
  const c=layer?.gameFrame?.calibration;
  if(c){
    if(![c.sx,c.sy,c.ox,c.oy].every(Number.isFinite)||!c.sx||!c.sy)return null;
    return [(worldPosition.y-c.ox)/c.sx*view.width,(worldPosition.x-c.oy)/c.sy*view.height];
  }
  const samples=dungeon.enemies.filter(p=>p.mapImageId===mapImageId&&
    [p.worldPosition?.x,p.worldPosition?.y,p.mapPosition?.x,p.mapPosition?.y].every(Number.isFinite));
  const fit=(worldAxis,mapAxis)=>{
    if(samples.length<2)return null;
    const lo=samples.reduce((a,b)=>a.worldPosition[worldAxis]<b.worldPosition[worldAxis]?a:b);
    const hi=samples.reduce((a,b)=>a.worldPosition[worldAxis]>b.worldPosition[worldAxis]?a:b);
    const span=hi.worldPosition[worldAxis]-lo.worldPosition[worldAxis];
    if(span<1)return null;
    const scale=(hi.mapPosition[mapAxis]-lo.mapPosition[mapAxis])/span;
    const offset=lo.mapPosition[mapAxis]-lo.worldPosition[worldAxis]*scale;
    if(!scale||samples.some(p=>Math.abs(p.worldPosition[worldAxis]*scale+offset-p.mapPosition[mapAxis])>1e-6))return null;
    return worldPosition[worldAxis]*scale+offset;
  };
  const x=fit('y','x'),y=fit('x','y');
  return x===null||y===null?null:[x*view.width,y*view.height];
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
  const overview=combinedMap(dungeon)||fullMaps[dungeon.id];
  const normalized=[point[0]/source.width,point[1]/source.height];
  const region=!source.sources&&overview&&displayRegions(overview,source.id).find(r=>insidePolygon(normalized,r.polygon));
  const projected=region?projectRegion(normalized,region):applyBasis(point,drawingBasis(source,dungeon));
  if(!target.sources&&overview)for(const r of displayRegions(overview,target.id)){
    const t=r.transform,original=[(projected[0]-t.x)/t.width,(projected[1]-t.y)/t.height];
    if(insidePolygon(original,r.polygon))return [original[0]*target.width,original[1]*target.height];
  }
  return invertBasis(projected,drawingBasis(target,dungeon));
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
