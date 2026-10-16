import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceToSegment,distanceToPatrol,placementDistance,createPackDistance} from '../log-import/placement-geometry.js';
test('Patrol matching projects onto a segment instead of choosing only its endpoints',()=>{
  assert.equal(distanceToPatrol({x:50,y:3},[{x:0,y:0},{x:100,y:0}]),3);
  assert.equal(distanceToSegment({x:110,y:0},{x:0,y:0},{x:100,y:0}),10);
});
test('Patrol matching does not invent a closing leg or bridge missing points',()=>{
  assert.equal(distanceToPatrol({x:50,y:50},[{x:0,y:0},{x:100,y:0},{x:100,y:100}]),50);
  assert.equal(distanceToPatrol({x:50,y:0},[{x:0,y:0},null,{x:100,y:0}]),50);
});
test('Missing and duplicate patrol vertices have safe distances',()=>{
  assert.equal(distanceToPatrol({x:0,y:0},[]),Infinity);
  assert.equal(distanceToPatrol({x:3,y:4},[{x:0,y:0},{x:0,y:0}]),5);
  assert.equal(distanceToPatrol({x:NaN,y:0},[{x:0,y:0}]),Infinity);
});
test('A distant initial placement can match its patrol, preserving both pieces of evidence',()=>{
  const match=placementDistance({x:90,y:2},{worldPosition:{x:0,y:0},patrolPath:[{x:0,y:0},{x:100,y:0}]});
  assert.equal(match.distance,2);assert.equal(match.evidence,'patrol');assert.ok(match.spawnDistance>90);
});

test('Compiled pack distances match exhaustive geometry and radius boundaries',()=>{
  let seed=173;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const point=()=>({x:(random()-.5)*10000,y:(random()-.5)*10000});
  for(let trial=0;trial<30;trial++){
    const path=[point(),point(),null,point(),point()];path.push(path.at(-1));
    const placements=[{worldPosition:point(),patrolPath:path},{worldPosition:point(),patrolPath:path},{worldPosition:null,patrolPath:[null,point()]}];
    const distance=createPackDistance(placements);
    for(let i=0;i<30;i++){
      const p=point(),expected=Math.min(...placements.map(m=>placementDistance(p,m).distance));
      assert.equal(distance(p),expected);
      for(const range of [100,1500,6000,expected,Math.max(0,expected-1e-7)])
        assert.equal(distance(p,range),expected<=range?expected:Infinity);
    }
  }
  assert.equal(createPackDistance([])({x:0,y:0}),Infinity);
  assert.equal(createPackDistance([{worldPosition:{x:0,y:0}}])({x:NaN,y:0}),Infinity);
});
