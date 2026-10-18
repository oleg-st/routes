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
export function projectGamePoint(position,frame){
  assert.ok(frame?.calibration,'Missing map calibration; extract or calibrate the new map before publishing');
  const c=frame.calibration;
  return {x:(position.y-c.ox)/c.sx,y:(position.x-c.oy)/c.sy};
}
