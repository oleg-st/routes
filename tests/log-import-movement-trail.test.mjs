import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMovementTrail,movementTrailLines,movementPlayerColor} from '../log-import/movement-trail.js';

const view={id:'start',name:'Start',path:'map.avif',width:1000,height:1000};
const dungeon={id:'test-trail',mapImages:[view],enemies:[
  {mapImageId:'start',worldPosition:{x:0,y:0},mapPosition:{x:0,y:0}},
  {mapImageId:'start',worldPosition:{x:1000,y:1000},mapPosition:{x:1,y:1}}
]};
const log={fight:{startTime:1000,friendlyPlayers:[1]},actors:[{id:1,name:'Tank'}],events:[]};
const row=positions=>({type:'Player',actorID:1,key:'1:1',positions:positions.map(([t,x,y,hp=100])=>({t:t+1000,x,y,hp}))});
test('Movement preserves world axis conversion, players and time, excluding unrelated actors',()=>{
  const trail=buildMovementTrail(log,[row([[0,10,20],[1000,30,40]]),{...row([[0,0,0],[1000,10,10]]),actorID:2}],dungeon);
  assert.equal(trail.players.length,1);
  assert.equal(trail.players[0].name,'Tank');
  assert.deepEqual(trail.players[0].segments,[[[0,10,20],[1,30,40]]]);
});
test('Movement does not bridge deaths, respawns, portals, map changes, long gaps or impossible jumps',()=>{
  for(const event of [{type:'death'},{type:'respawn'},{type:'resurrect'},{type:'applydebuff',abilityGameID:1002176},{type:'mapchange',mapName:'Start'}]){
    const trail=buildMovementTrail({...log,events:[{...event,timestamp:2500,targetID:1}]},[row([[0,0,0],[1000,100,100],[2000,200,200],[3000,300,300]])],dungeon);
    assert.deepEqual(trail.players[0].segments.map(s=>s.map(p=>p[0])),[[0,1],[2,3]],event.type);
  }
  for(const positions of [
    [[0,0,0],[1000,100,100],[2000,200,200,0],[3000,300,300],[4000,400,400]],
    [[0,0,0],[1000,100,100],[20000,200,200],[21000,300,300]],
    [[0,0,0],[1000,100,100],[1001,900,900],[2000,950,950]]
  ])assert.equal(buildMovementTrail(log,[row(positions)],dungeon).players[0].segments.length,2);
});
test('Review shows only approach/current pull, separates sparse samples and preserves player colors',()=>{
  const trail={mapId:view.id,players:[{id:'1',segments:[[[0,0,0],[1,1,1],[4,4,4],[5,5,5],[6,6,6],[20,20,20]]]}]};
  const state={pulls:[{end:7},{start:5,end:6}],complete:false};
  const lines=movementTrailLines(trail,state,view,dungeon);
  assert.deepEqual(lines.map(l=>({estimated:l.estimated,inCombat:l.inCombat,points:l.points})),[{estimated:false,inCombat:true,points:[[4,4],[5,5],[6,6]]}]);
  const heroes=[{name:'Xavian',classColor:'#077365'}];
  trail.players[0].className='Xavian';
  assert.equal(movementTrailLines(trail,state,view,dungeon,heroes)[0].color,'#077365');
  assert.equal(movementPlayerColor({className:'Unknown'},heroes),'#60c7ff');
  assert.deepEqual(movementTrailLines(trail,{...state,complete:true},view,dungeon),[]);
  assert.ok(movementTrailLines(trail,{pulls:[{start:5,end:6}]},view,dungeon).some(l=>l.estimated));
});
