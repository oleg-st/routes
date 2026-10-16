import test from 'node:test';
import assert from 'node:assert/strict';
import {interpolatePlayerPositions} from '../log-import/live-analysis.js';

const player={key:'1:1',actorID:1,type:'Player',deaths:[],positions:[
  {t:0,x:0,y:0,hp:100},{t:1500,x:1500,y:0,hp:80}]};
test('Player sampling fills a short gap at the enemy timestamp with swapped world axes',()=>{
  const [p]=interpolatePlayerPositions([player],[1300]);
  assert.equal(p.t,1300);assert.equal(p.x,0);assert.equal(p.y,1300);assert.equal(p.interpolated,true);
  assert.equal(interpolatePlayerPositions([player],[-1,0,1500,2000]).length,0);
});
test('Player sampling does not bridge death, invisibility, unknown visibility, map changes or teleports',()=>{
  for(const row of [{...player,deaths:[{timestamp:1000}]},
    {...player,positions:[player.positions[0],{...player.positions[1],hp:0}]},
    {...player,positions:[player.positions[0],{...player.positions[1],t:5000}]},
    {...player,positions:[player.positions[0],{...player.positions[1],x:10000}]}])assert.equal(interpolatePlayerPositions([row],[1300]).length,0);
  for(const state of ['invisible','unknown'])assert.equal(interpolatePlayerPositions([player],[1300],{visibility:{stateAt:()=>state}}).length,0);
  assert.equal(interpolatePlayerPositions([player],[1300],{mapChanges:[{timestamp:1000}]}).length,0);
});
