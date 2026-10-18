import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newRoute,clearRoute,hasRouteChanges,newPull,renamePull,movePull,assignEnemies,scoreRoute,scorePull,enemyScore,validateRoute,setReplacement,effectivePositions,shadowTarget,shadowTimeline,orbCount,applyModifierPresets,toggleModifier} from '../route-model.js';
import {pullOutline} from '../map-geometry.js';
import {correctDungeon} from '../data/placement-corrections.js';
const read=n=>JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
const dungeons=read('dungeons').map(correctDungeon),enemies=new Map(read('enemies').map(e=>[e.id,e]));
const d=dungeons.find(d=>d.name==="Sailor's Abyss"),lost=d.enemies.find(p=>enemies.get(p.id).name==='Lost Soul');
test('Clearing removes all route content, preserves identity, and reloads with zero pulls',()=>{
  const r=newRoute(d,'test'),id=r.id;r.name='My route';r.shadow=true;
  r.pulls.push(newPull(1));r.pulls[0].enemies=[lost.placementId];r.pulls[0].note='Plan';
  r.excluded=[lost.placementId];r.modifiers.empowered={active:true,enemies:[lost.placementId]};
  r.drawings=['line','portal','invis','note'].map(kind=>({kind,points:[[10,20],[30,40]]}));
  clearRoute(r);
  assert.equal(r.id,id);assert.equal(r.name,'My route');assert.equal(r.dungeonId,d.id);
  assert.deepEqual(r.pulls,[]);assert.deepEqual(r.drawings,[]);assert.deepEqual(r.excluded,[]);
  assert.equal(r.shadow,false);assert.ok(Object.values(r.modifiers).every(m=>!m.active));
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies);
  assert.equal(loaded.pulls.length,0);assert.equal(scoreRoute(loaded,d,enemies).score,0);
});
test('Arrow style survives JSON; old paths become straight and invalid widths use medium',()=>{
  const r=newRoute(d,'test');
  r.drawings=[{id:'arrow',mapId:d.mapImages[0].id,kind:'line',color:'#9000ff',width:5,points:[[10,20],[60,90],[150,180]]}];
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies);
  assert.deepEqual(loaded.drawings[0].points,[[10,20],[150,180]]);
  assert.equal(loaded.drawings[0].color,'#9000ff');assert.equal(loaded.drawings[0].width,5);
  for(const width of [0,-2,100,'5',null]){r.drawings[0].width=width;assert.equal(validateRoute(r,dungeons,enemies).drawings[0].width,3);}
  r.drawings[0].points=[[1,2]];assert.throws(()=>validateRoute(r,dungeons,enemies),/two endpoints/);
});
test('Moving pulls updates automatic names and keeps colors at their list positions',()=>{
  const r=newRoute(d,'test');r.pulls.push(newPull(1),newPull(2));
  const original=[...r.pulls],colors=r.pulls.map(p=>p.color);
  original[1].enemies=[lost.placementId];original[1].note='Interrupt first';
  movePull(r,1,0);
  assert.deepEqual(r.pulls.map(p=>p.id),[original[1].id,original[0].id,original[2].id]);
  assert.deepEqual(r.pulls.map(p=>p.name),['Pull 1','Pull 2','Pull 3']);
  assert.deepEqual(r.pulls.map(p=>p.color),colors);
  assert.deepEqual(r.pulls[0].enemies,[lost.placementId]);assert.equal(r.pulls[0].note,'Interrupt first');
  movePull(r,0,2);
  assert.deepEqual(r.pulls.map(p=>p.id),[original[0].id,original[2].id,original[1].id]);
  assert.deepEqual(r.pulls.map(p=>p.name),['Pull 1','Pull 2','Pull 3']);
  assert.deepEqual(r.pulls.map(p=>p.color),colors);
});
test('Manual names survive reordering and JSON roundtrip, including names like Pull 9',()=>{
  const r=newRoute(d,'test');r.pulls.push(newPull(1),newPull(2));
  renamePull(r.pulls[0],'Boss',0);renamePull(r.pulls[1],'Pull 9',1);
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies),colors=loaded.pulls.map(p=>p.color);
  movePull(loaded,0,2);
  assert.deepEqual(loaded.pulls.map(p=>p.name),['Pull 9','Pull 2','Boss']);
  assert.deepEqual(loaded.pulls.map(p=>p.color),colors);
  renamePull(loaded.pulls[0],'   ',0);movePull(loaded,0,1);
  assert.deepEqual(loaded.pulls.map(p=>p.name),['Pull 1','Pull 2','Boss']);
});
test('Legacy custom names survive and color-only edits keep automatic naming',()=>{
  const r=newRoute(d,'test');r.pulls.push(newPull(1),newPull(2));
  for(const p of r.pulls)delete p.customName;
  r.pulls[0].name='Opening pack';r.pulls[1].name='Пулл 2';
  const loaded=validateRoute(r,dungeons,enemies);
  renamePull(loaded.pulls[1],loaded.pulls[1].name,1);loaded.pulls[1].color='#abcdef';
  movePull(loaded,2,0);
  assert.deepEqual(loaded.pulls.map(p=>p.name),['Pull 1','Opening pack','Pull 3']);
  assert.equal(loaded.pulls[1].color,'#abcdef');
});
test('Invalid or unchanged pull moves leave the route untouched',()=>{
  const r=newRoute(d,'test'),before=structuredClone(r);
  for(const [from,to]of [[0,0],[-1,0],[0,-1],[0,1],[1,0],[0,.5]])movePull(r,from,to);
  assert.deepEqual(r,before);
});
test('Shadow Lord uses the same current kill scores without name-based deductions',()=>{
  const r=newRoute(d,'test');assignEnemies(r,r.pulls[0].id,[lost.placementId]);
  assert.equal(scoreRoute(r,d,enemies).score,1);
  r.shadow=true;assert.equal(scoreRoute(r,d,enemies).score,1);
  assert.equal(scoreRoute(r,d,enemies).percent,1/d.requiredScore*100);
});
test('Moving an existing pack to another pull never counts it twice',()=>{
  const r=newRoute(d,'test'),p=newPull(1);r.pulls.push(p);
  const ids=d.enemies.filter(e=>e.packId===lost.packId).map(e=>e.placementId);
  assignEnemies(r,r.pulls[0].id,ids);const before=scoreRoute(r,d,enemies);
  assignEnemies(r,p.id,ids);assert.equal(r.pulls[0].enemies.length,0);assert.equal(scoreRoute(r,d,enemies).score,before.score);
  assignEnemies(r,p.id,ids);assert.equal(scoreRoute(r,d,enemies).score,0);
});
test('Chicken mobs stay in the pull and count as mobs while scoring zero',()=>{
  const r=newRoute(d,'test'),boss=d.enemies.find(p=>enemies.get(p.id).isBoss);
  assignEnemies(r,r.pulls[0].id,[lost.placementId,boss.placementId]);r.excluded=[lost.placementId];
  const s=scoreRoute(r,d,enemies);assert.equal(s.score,0);assert.equal(s.orbScore,0);assert.equal(s.bosses,1);assert.equal(s.count,2);
  assert.ok(effectivePositions(r,d).some(p=>p.placementId===lost.placementId));
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies);
  assert.ok(loaded.pulls[0].enemies.includes(lost.placementId));assert.deepEqual(loaded.excluded,[lost.placementId]);
  r.modifiers.empowered={active:true,enemies:[lost.placementId]};r.shadow=true;
  assert.equal(scoreRoute(r,d,enemies).score,0);assert.equal(scoreRoute(r,d,enemies).orbScore,0);
  r.excluded=[];assert.equal(scoreRoute(r,d,enemies).score,3);
});
test('Kill score depends on attributes, not the display name',()=>{
  assert.equal(enemyScore({name:'Lost Soul',dungeonScore:2}),2);
  assert.equal(enemyScore({name:'Unknown',dungeonScore:null},false),null);
});
test('JSON roundtrip preserves Unicode notes, floors, drawings and mode',()=>{
  const r=newRoute(d,'test');r.name='Test route 🧭';r.pulls[0].note='Interrupt the cast → save cooldowns';r.shadow=true;
  assignEnemies(r,r.pulls[0].id,[lost.placementId]);r.drawings=[{id:'test',mapId:d.mapImages[0].id,kind:'portal',color:'#abcdef',points:[[1,2],[3,4]]}];
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons);
  assert.equal(loaded.name,r.name);assert.equal(loaded.pulls[0].note,r.pulls[0].note);assert.equal(loaded.shadow,true);assert.deepEqual(loaded.drawings[0].points,[[1,2],[3,4]]);
});
test('Import rejects duplicate, foreign, malformed and incompatible data',()=>{
  const r=newRoute(d,'test');r.pulls[0].enemies=[lost.placementId];r.pulls.push({...newPull(1),enemies:[lost.placementId]});
  assert.throws(()=>validateRoute(r,dungeons),/multiple pulls/);
  r.pulls.pop();r.pulls[0].enemies=['foreign'];assert.throws(()=>validateRoute(r,dungeons),/another dataset/);
  r.pulls[0].enemies=[];r.drawings=[{mapId:d.mapImages[0].id,points:[[NaN,0]]}];assert.throws(()=>validateRoute(r,dungeons),/coordinates/);
  assert.throws(()=>validateRoute({version:999},dungeons),/format/);
});
test('Empowered multiplies the game score and never empowers bosses',()=>{
  const r=newRoute(d,'test'),boss=d.enemies.find(p=>enemies.get(p.id).isBoss);
  assignEnemies(r,r.pulls[0].id,[lost.placementId,boss.placementId]);
  r.modifiers.empowered={active:true,enemies:[lost.placementId,boss.placementId]};
  assert.equal(scoreRoute(r,d,enemies).score,3);
  r.shadow=true;assert.equal(scoreRoute(r,d,enemies).score,3);
  r.modifiers.empowered.active=false;assert.equal(scoreRoute(r,d,enemies).score,1);
});
test('Both replacements suppress original packs, count once, and restore on disable',()=>{
  const r=newRoute(d,'test');r.pulls.push(newPull(1));
  const packs=[...new Set(d.enemies.filter(p=>!enemies.get(p.id).isBoss).map(p=>p.packId))].slice(0,2);
  const ids=d.enemies.filter(p=>packs.includes(p.packId)).map(p=>p.placementId);
  assignEnemies(r,r.pulls[0].id,ids);const original=scoreRoute(r,d,enemies).score;
  setReplacement(r,'ghorn',packs[0],d,enemies);setReplacement(r,'witch',packs[1],d,enemies);
  assignEnemies(r,r.pulls[1].id,['modifier:ghorn','modifier:witch']);
  assert.equal(scorePull(r.pulls[0],d,enemies,r).score,0);
  assert.equal(scoreRoute(r,d,enemies).score,40);assert.equal(scoreRoute(r,d,enemies).orbScore,40);
  assert.equal(effectivePositions(r,d).filter(p=>p.modifier).length,2);
  assert.ok(ids.every(id=>!effectivePositions(r,d).some(p=>p.placementId===id)));
  assert.throws(()=>setReplacement(r,'witch',packs[0],d,enemies),/already/);
  r.modifiers.ghorn.active=false;r.modifiers.witch.active=false;
  assert.equal(scoreRoute(r,d,enemies).score,original);
  r.modifiers.ghorn.active=true;r.excluded=['modifier:ghorn'];
  assert.equal(scorePull(r.pulls[1],d,enemies,r).score,0);
  const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies);assert.deepEqual(loaded.modifiers,r.modifiers);
});
test('Orb rounding uses cumulative score, handles reordering and thresholds',()=>{
  const dungeon={id:'Level.ID.FrozenKingdom',name:"Cithrel's Fall",requiredScore:188,enemies:[{id:'a',placementId:'a'},{id:'b',placementId:'b'},{id:'c',placementId:'c'}]};
  const es=new Map([['a',{dungeonScore:1}],['b',{dungeonScore:1}],['c',{dungeonScore:63}]]),r=newRoute(dungeon,'test');r.shadow=true;r.pulls=[{enemies:['a']},{enemies:['b']},{enemies:['c']}];
  const result=shadowTimeline(r,dungeon,es);assert.deepEqual(result.map(p=>p.orbs),[1,0,30]);assert.equal(result[2].spawns,1);
  r.pulls.reverse();const reversed=shadowTimeline(r,dungeon,es);assert.equal(reversed.at(-1).total,result.at(-1).total);
  assert.equal(reversed.reduce((s,p)=>s+p.orbs,0),orbCount(65,dungeon));
  assert.equal(shadowTarget(dungeons.find(d=>d.name==='The Heart of Tuzari')),90);assert.equal(shadowTarget(d),60);
});
test('Import migrates v1 and rejects invalid modifier state and one-ended paths',()=>{
  const r=newRoute(d,'test');delete r.modifiers;r.version=1;
  const migrated=validateRoute(r,dungeons,enemies);assert.equal(migrated.version,2);assert.equal(migrated.modifiers.empowered.active,false);
  migrated.modifiers.empowered.enemies=['foreign'];assert.throws(()=>validateRoute(migrated,dungeons,enemies),/empowered/);
  migrated.modifiers.empowered.enemies=[];migrated.modifiers.ghorn={active:true,packId:d.enemies.find(p=>enemies.get(p.id).isBoss).packId};assert.throws(()=>validateRoute(migrated,dungeons,enemies),/boss pack/);
  r.drawings=[{mapId:d.mapImages[0].id,kind:'invis',points:[[1,2]]}];assert.throws(()=>validateRoute(r,dungeons,enemies),/two endpoints/);
});
test('Pull envelopes contain padded single, collinear and spread-out mobs',()=>{
  for(const points of [[[1,2]],[[0,0],[0,0]],[[0,0],[10,0]],[[0,0],[10,0],[5,6]]]){
    const hull=pullOutline(points,4);assert.ok(hull.length>=4);assert.ok(hull.every(p=>p.every(Number.isFinite)));
    for(const point of points)for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length];assert.ok((b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])>=-1e-9);}
  }
  assert.deepEqual(pullOutline([],4),[]);
});
test('All dungeons can create, score and validate a complete map route',()=>{
  for(const dungeon of dungeons){const r=newRoute(dungeon,'test');assignEnemies(r,r.pulls[0].id,dungeon.enemies.map(e=>e.placementId));const s=scoreRoute(r,dungeon,enemies);assert.equal(s.unknown,0);assert.ok(s.percent>=100,dungeon.name);assert.doesNotThrow(()=>validateRoute(r,dungeons));}
});
test('Every automatic modifier target exists and replacements exclude only the matched mobs',()=>{
  const presets=read('modifier-placements');assert.equal(presets.buildId,read('manifest').buildId);
  let marked=0,replacements=0;
  for(const dungeon of dungeons){
    const r=newRoute(dungeon,'test'),row=presets.dungeons[dungeon.id];applyModifierPresets(r,dungeon,presets);
    assert.deepEqual(r.modifiers.empowered.enemies,row.empowered);marked+=row.empowered.length;
    assignEnemies(r,r.pulls[0].id,dungeon.enemies.map(p=>p.placementId));
    const before=scoreRoute(r,dungeon,enemies).score;
    for(const kind of ['ghorn','witch'])if(row[kind]){
      replacements++;const ids=row[kind].replacedEnemies;
      assert.ok(ids.every(id=>dungeon.enemies.some(p=>p.placementId===id&&!enemies.get(p.id)?.isBoss)));
      toggleModifier(r,kind);
      assert.ok(r.pulls[0].enemies.includes('modifier:'+kind));
      const expected=before-ids.reduce((s,id)=>s+enemies.get(dungeon.enemies.find(p=>p.placementId===id).id).dungeonScore,0)+20;
      assert.equal(scoreRoute(r,dungeon,enemies).score,expected);
      assert.equal(effectivePositions(r,dungeon).length,dungeon.enemies.length-ids.length+1);
      const loaded=validateRoute(JSON.parse(JSON.stringify(r)),dungeons,enemies);assert.deepEqual(loaded.modifiers,r.modifiers);
      toggleModifier(r,kind);assert.equal(scoreRoute(r,dungeon,enemies).score,before);
    }
  }
  assert.equal(marked,64);assert.equal(replacements,28);
});

test('Save state tracks content through saving, undo, clearing, and reload',()=>{
  const r=newRoute(d,'test');assert.equal(hasRouteChanges(r),false);
  r.pulls.push(newPull(1));assert.equal(hasRouteChanges(r),true);
  const saved=structuredClone(r);assert.equal(hasRouteChanges(r,saved),false);
  r.name='Changed';assert.equal(hasRouteChanges(r,saved),true);
  r.name=saved.name;assert.equal(hasRouteChanges(r,saved),false);
  r.drawings=[{id:'arrow',mapId:d.mapImages[0].id,kind:'line',color:'#9000ff',width:5,points:[[10,20],[60,90]]}];
  assert.equal(hasRouteChanges(r,saved),true);
  const loaded=validateRoute(r,dungeons,enemies);assert.equal(hasRouteChanges(loaded,r),false);
  clearRoute(loaded);assert.equal(hasRouteChanges(loaded,r),true);
  assert.equal(hasRouteChanges(loaded),false);
});

test('All annotation identities survive repeated saved-route reloads without mutating the source',()=>{
  const r=newRoute(d,'test');
  r.drawings=['line','portal','invis','note'].map((kind,i)=>({
    id:`annotation-${i}`,mapId:d.mapImages[0].id,kind,color:'#abcdef',text:kind==='note'?'Keep this note':'',
    points:kind==='note'?[[10,20]]:[[10,20],[30,40]],
  }));
  const before=structuredClone(r);
  let loaded=r;
  for(let i=0;i<3;i++)loaded=validateRoute(JSON.parse(JSON.stringify(loaded)),dungeons,enemies);
  assert.equal(loaded.id,r.id);
  assert.deepEqual(loaded.pulls.map(p=>p.id),r.pulls.map(p=>p.id));
  assert.deepEqual(loaded.drawings,r.drawings);
  assert.deepEqual(r,before);
});

test('Legacy annotations acquire distinct stable IDs on their first saved reload',()=>{
  const r=newRoute(d,'test');
  r.drawings=Array.from({length:3},()=>({mapId:d.mapImages[0].id,kind:'note',points:[[10,20]],text:'Legacy'}));
  const migrated=validateRoute(r,dungeons,enemies),ids=migrated.drawings.map(d=>d.id);
  assert.equal(new Set(ids).size,3);
  assert.ok(ids.every(id=>typeof id==='string'&&id.length>0));
  const reloaded=validateRoute(JSON.parse(JSON.stringify(migrated)),dungeons,enemies);
  assert.deepEqual(reloaded.drawings.map(d=>d.id),ids);
  assert.ok(r.drawings.every(d=>!('id' in d)));
});

test('Ambiguous annotation IDs are rejected instead of silently assigning new identities',()=>{
  const r=newRoute(d,'test');
  r.drawings=['line','note'].map(kind=>({id:'duplicate',mapId:d.mapImages[0].id,kind,points:[[10,20],[30,40]]}));
  assert.throws(()=>validateRoute(r,dungeons,enemies),/Duplicate drawing ID/);
});
