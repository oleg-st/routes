// Loaded only for R1–R3 links. No static imports: shared validation and current
// tuple semantics are supplied by the caller, without duplicating the app.
export async function legacyDictionary(dungeon,modifierIds){
  const placements=[...new Set([...dungeon.enemies.map(e=>e.placementId),...modifierIds])].sort();
  const packs=[...new Set(dungeon.enemies.map(e=>e.packId).filter(Boolean))].sort();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([placements,packs]))));
  const fingerprint=btoa(String.fromCharCode(...digest.subarray(0,12))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return {placements,packs,fingerprint};
}

export async function decodeLegacyRoute(bytes,prefix,context){
  const {dungeons,enemies,loadDungeon,transform,expandRoute,validateRoute,modifierPlacementIds,assertRouteBuild}=context;
  const decoded=await transform(bytes,DecompressionStream);
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
  if(!Array.isArray(payload))throw new Error('Invalid compact route.');
  if(loadDungeon)await loadDungeon(`Level.ID.${payload[0]}`);
  const dungeon=dungeons.find(d=>d.id===`Level.ID.${payload[0]}`);
  if(!dungeon)throw new Error('This dungeon is not available in the current dataset.');
  assertRouteBuild({buildId:payload[1]},dungeon);
  const mapped=prefix==='R3.';
  const legacy=mapped?null:await legacyDictionary(dungeon,modifierPlacementIds(dungeon.id));
  if(legacy&&payload[2]!==legacy.fingerprint)throw new Error('This route uses a different enemy dataset. Import cancelled to avoid selecting incorrect enemies.');
  return validateRoute(await expandRoute(payload,dungeons,prefix==='R2.'||mapped&&payload.length>9,mapped,false,legacy),dungeons,enemies);
}
