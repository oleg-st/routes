import assert from 'node:assert/strict';
// Unreal export indexes and coordinates are not persistent identities.
export function actorGuids(packages){
  const result=new Map();
  for(const p of packages)for(const row of p.Objects){
    const guid=row.Object?.ActorInstanceGuid?.ActorGuid;
    if(guid)result.set(p.Package+'.'+row.Index,String(guid).toLowerCase());
  }
  return result;
}
export function resolveIdentity(registry,guid){
  assert.ok(guid&&!/^0+$/.test(guid.replace(/[^0-9a-f]/g,'')),'Missing persistent actor GUID');
  return registry[guid]??={placementId:'placement-game-'+guid};
}
export function dungeonIdentity(registry,id){
  return registry.dungeons[id]??={actors:{},legacyPlacementIds:[]};
}
export function selectMapFrame(position,frames,preferred,{allowOutside=false,displayAreas}={}){
  const candidates=Object.entries(frames).filter(([,f])=>f.bounds&&['x','y','z'].every(k=>position[k]>=f.bounds[0][k]&&position[k]<=f.bounds[1][k]));
  const visible=displayAreas?.filter(a=>candidates.some(([id])=>id===a.id)&&['x','y','z'].every(k=>position[k]>=a.bounds[0][k]&&position[k]<=a.bounds[1][k]));
  const id=candidates.some(([id])=>id===preferred)?preferred:candidates.length===1?candidates[0][0]:visible?.[0]?.id??(allowOutside&&frames[preferred]?preferred:null);
  assert.ok(id,'Missing or ambiguous map area; review current map bounds: '+JSON.stringify({position,preferred,candidates:candidates.map(([id])=>id)}));
  return {mapImageId:id,mapPosition:projectGamePoint(position,frames[id])};
}
export function projectGamePoint(position,frame){
  assert.ok(frame?.calibration,'Missing map calibration; extract or calibrate the new map before publishing');
  const c=frame.calibration;
  return {x:(position.y-c.ox)/c.sx,y:(position.x-c.oy)/c.sy};
}
