import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyGameSummons} from '../log-import/game-summons.js';
import {classifySummons} from '../log-import/summon-evidence.js';
import {gameSummonRules,gameSummonBuild} from '../data/game-summon-rules.js';
import {matchLiveLog} from '../log-import/live-matcher.js';

const parent={key:'1:1',actorID:1,instance:1,gameID:331,firstTime:0,deaths:[]};
const child={key:'2:1',actorID:2,instance:1,gameID:324,firstTime:15000,firstPosition:{x:4000,y:0,t:15000},nearest:[{distance:5000}]};
const cast={fight:5,type:'cast',timestamp:10000,sourceID:1,sourceInstance:1,abilityGameID:2181,sourceResources:{x:0,y:0}};
const actors=[{id:1,gameID:331,type:'NPC'},{id:2,gameID:324,type:'NPC'}];
const input=()=>({fightID:5,actors,rows:[parent,child],events:[cast]});

test('Target-relative disciple pools identify a distant Clot Spawn without repeated waves',()=>{
  const args=input(),result=classifySummons(args);
  assert.equal(result.length,1);assert.equal(result[0].rule,'disciple-clot-pools');
  assert.equal(result[0].sourceKey,'1:1');assert.equal(result[0].basis,'game-data-cast-spawn');
  assert.equal(result[0].abilityGameID,2181);
  assert.equal(classifyGameSummons({...args,events:[cast,cast]}).length,1);
});

test('Game cast rules retain static, early, distant, stale and unrelated enemies',()=>{
  for(const changed of [
    {...child,nearest:[{distance:0}]},{...child,nearest:[{distance:999}]},
    {...child,firstTime:9999},{...child,firstTime:23000},
    {...child,firstPosition:{x:7000,y:0,t:15000}},{...child,firstPosition:{x:4000,y:0,t:19000}},
    {...child,firstPosition:undefined},{...child,gameID:325},
  ])assert.deepEqual(classifyGameSummons({...input(),rows:[parent,changed]}),[]);
  for(const changed of [{...cast,fake:true},{...cast,positionOnly:true},{...cast,fight:6},
    {...cast,abilityGameID:2180},{...cast,sourceResources:undefined}])
    assert.deepEqual(classifyGameSummons({...input(),events:[changed]}),[]);
  assert.deepEqual(classifyGameSummons({...input(),actors:[{...actors[0],type:'Player'}]}),[]);
  assert.deepEqual(classifyGameSummons({...input(),rows:[{...parent,deaths:[{timestamp:9000}]},child]}),[]);
});

test('Multiple possible parents or unspecified source instances do not establish parentage',()=>{
  const other={...parent,key:'3:1',actorID:3};
  assert.deepEqual(classifyGameSummons({...input(),actors:[...actors,{...actors[0],id:3}],rows:[parent,other,child],events:[cast,{...cast,sourceID:3}]}),[]);
  assert.deepEqual(classifyGameSummons({...input(),rows:[parent,{...parent,key:'1:2',instance:2},child],events:[{...cast,sourceInstance:undefined}]}),[]);
  assert.equal(classifyGameSummons({...input(),events:[{...cast,timestamp:9500},cast]}).length,1);
});

test('An exact cast sample resolves phase rows of one boss when the log omits sourceInstance',()=>{
  const first={...parent,key:'encounter:bridge',gameID:133,positions:[{x:0,y:0,t:1000}]};
  const second={...parent,key:'encounter:summit',gameID:133,positions:[{x:20000,y:0,t:10000}]};
  const args={fightID:5,actors:[{id:1,gameID:133,type:'NPC',subType:'Boss'}],
    rows:[first,second,{...child,gameID:134,firstTime:11000}],
    events:[{...cast,sourceInstance:undefined,abilityGameID:631,sourceResources:{x:20000,y:0}}]};
  assert.equal(classifyGameSummons(args)[0].sourceKey,'encounter:summit');
  args.events[0].sourceResources=undefined;assert.deepEqual(classifyGameSummons(args),[]);
});

test('Eggbearer death requires a complete 2..3 Spiderling wave and fresh corpse coordinates',()=>{
  const corpse={...parent,gameID:267,positions:[{x:0,y:0,t:9900}],deaths:[{timestamp:10000}]};
  const children=[0,1,2].map(i=>({...child,key:`2:${i+1}`,instance:i+1,gameID:89,firstTime:11000+i*100,
    firstPosition:{x:300+i*100,y:0,t:11000+i*100}}));
  const run=rows=>classifyGameSummons({fightID:5,actors:[{id:1,type:'NPC',gameID:267}],rows,events:[]});
  assert.equal(run([corpse,...children]).length,3);assert.equal(run([corpse,...children.slice(1)]).length,2);
  for(const rows of [[corpse,children[0]],[corpse,...children,{...children[0],key:'2:4'}],
    [{...corpse,deaths:[]},...children],[{...corpse,positions:[{x:0,y:0,t:8000}]},...children],
    [corpse,...children.map(c=>({...c,firstPosition:{...c.firstPosition,t:16000}}))],
    [{...corpse,gameID:268},...children],
    [corpse,...children.map(c=>({...c,nearest:[{distance:500}]}))]])assert.deepEqual(run(rows),[]);
});

test('Generated identities distinguish spawned NPCs from buff targets and transformations',()=>{
  assert.equal(gameSummonBuild,JSON.parse(fs.readFileSync('scripts/game-summon-semantics.json')).steamBuild);
  assert.equal(new Set(gameSummonRules.map(r=>r.id)).size,gameSummonRules.length);
  assert.ok(!gameSummonRules.some(r=>[775,1403,1478].includes(r.abilityGameID)));
  assert.deepEqual(gameSummonRules.find(r=>r.id==='han-eth-response-cast').childGameIDs,[316,324,325,326,334]);
  assert.deepEqual(gameSummonRules.find(r=>r.id==='han-eth-clot-pools').childGameIDs,[323,324]);
});

test('A boss cast in a new attempt can summon after a death in an earlier attempt',()=>{
  const args={fightID:5,actors:[{id:1,gameID:92,type:'NPC',subType:'Boss'}],
    rows:[{...parent,gameID:92,deaths:[{timestamp:5000}]},{...child,gameID:89}],events:[
      {fight:5,type:'dungeonencounterstart',timestamp:9000,encounterID:33},
      {...cast,abilityGameID:1396,sourceResources:{x:0,y:0,hitPoints:100}},
    ]};
  assert.equal(classifyGameSummons(args).length,1);
  args.rows[0].deaths.push({timestamp:9500});
  assert.deepEqual(classifyGameSummons(args),[]);
});

test('Live matcher excludes a game-data summon while preserving the static instance of the same type',async()=>{
  const dungeon={id:'test',name:'Test',enemies:[{id:'mob',placementId:'static',packId:'pack',worldPosition:{x:0,y:0},
    mapPosition:{x:0.5,y:0.5},mapImageId:'map'}],mapImages:[{id:'map',width:100,height:100}]};
  const catalog=new Map([['mob',{id:'mob',gameId:324,name:'Clot Spawn'}]]);
  const resources=x=>({x,y:0,hitPoints:100,maxHitPoints:100});
  const log={complete:true,reportCode:'example',fight:{id:5,name:'Test',startTime:0,endTime:20000,dungeonPulls:[{id:1,startTime:0,endTime:20000}]},
    actors:[...actors,{id:3,type:'Player'}],events:[
      {fight:5,type:'damage',timestamp:0,sourceID:3,targetID:2,targetInstance:1,sourceResources:resources(0),targetResources:resources(0)},
      {...cast,sourceResources:resources(0)},
      {fight:5,type:'damage',timestamp:15000,sourceID:3,targetID:2,targetInstance:2,sourceResources:resources(0),targetResources:resources(4000)},
    ]};
  const options={dungeon,catalog,presets:{},dungeonData:'custom'};
  const result=await matchLiveLog(log,options);
  assert.deepEqual(Object.values(result.groups).flatMap(g=>g.enemies),['static']);
  log.events[1].abilityGameID=2182;
  await assert.rejects(matchLiveLog(log,options),/more instances than the map/);
});
