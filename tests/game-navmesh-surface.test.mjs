import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTriangleXY,prepareNavmesh,sampleNavmesh} from '../scripts/game-navmesh-surface.mjs';
const triangle=z=>[[0,0,z],[100,0,z],[0,100,z]];
const nav=levels=>prepareNavmesh({tiles:levels.map((z,i)=>({id:String(i),renderVertices:triangle(z),surfaceTriangles:[{vertices:[0,1,2],polygon:0}]}))});
test('interpolates sloping surfaces and clamps positions outside to an edge',()=>{
  const t=[[0,0,0],[100,0,100],[0,100,200]];
  assert.deepEqual(projectTriangleXY({x:25,y:25,z:999},t),{point:[25,25,75],horizontalDistance:0});
  assert.deepEqual(projectTriangleXY({x:50,y:-10,z:999},t),{point:[50,0,50],horizontalDistance:10});
});
test('keeps stacked floors and chooses the closest height, not the top floor',()=>{
  const r=sampleNavmesh(nav([0,1000]),{x:25,y:25,z:90});
  assert.deepEqual(r.surfaceHeightsAtXY,[0,1000]);assert.equal(r.closestHeightAtXY.verticalOffset,90);
  assert.equal(r.belowAllSurfaceBy,0);
});
test('outside XY is not equivalent to below map; legitimate lower floors stay valid',()=>{
  const r=sampleNavmesh(nav([-12000,0]),{x:25,y:-5,z:-11900});
  assert.equal(r.closestHeightAtXY,null);assert.equal(r.nearestXY.horizontalDistance,5);
  assert.equal(r.bestNearbyHeight.verticalOffset,100);assert.equal(r.belowAllSurfaceBy,0);
  assert.equal(sampleNavmesh(nav([-12000,0]),{x:25,y:25,z:-24000}).belowAllSurfaceBy,12000);
});
test('rejects malformed geometry and query coordinates',()=>{
  assert.throws(()=>prepareNavmesh({tiles:[]}));
  assert.throws(()=>sampleNavmesh(nav([0]),{x:NaN,y:0,z:0}));
});
