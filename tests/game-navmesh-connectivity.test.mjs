import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph,search} from '../scripts/game-navmesh-connectivity.mjs';

function tile(x,layer,z,{y0=0,y1=100}={}){
  const id=`${x}:0:${layer}`,vertices=[[-100*x,y0,z],[-100*x-100,y0,z],[-100*x-100,y1,z],[-100*x,y1,z]];
  return {id,grid:{x,y:0,layer},vertices,offMeshConnections:[],offMeshSegments:[],polygons:[{index:0,type:0,flags:1,area:63,vertices:[0,1,2,3],
    neighbors:[{kind:'boundary'},{kind:'portal',side:0},{kind:'boundary'},{kind:'portal',side:4}]}]};
}
const connected=(tiles,gap=0.1)=>search(buildGraph({tiles},{maxPortalHeightGap:gap}),`${tiles[0].id}/0`,`${tiles[1].id}/0`).connected;
test('opposite portals connect adjacent cells even when layer indices differ',()=>assert.equal(connected([tile(0,0,0),tile(1,2,0)]),true));
test('stacked surfaces are not joined merely because XY overlaps',()=>assert.equal(connected([tile(0,0,0),tile(0,1,-1000)],130),false));
test('height tolerance does not bridge the G46-sized drop',()=>{
  assert.equal(connected([tile(0,0,0),tile(1,0,60)]),false);
  assert.equal(connected([tile(0,0,0),tile(1,0,60)],65),true);
  assert.equal(connected([tile(0,0,0),tile(1,0,-1000)],130),false);
});
test('portals that only touch at an endpoint do not create a passage',()=>assert.equal(connected([tile(0,0,0),tile(1,0,0,{y0:100,y1:200})]),false));
