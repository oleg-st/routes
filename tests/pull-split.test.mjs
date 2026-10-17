import test from 'node:test';
import assert from 'node:assert/strict';
import {outlineIntersection,planPullSplit} from '../pull-split.js';

const square=[[0,0],[10,0],[10,10],[0,10]];
const pull=(id,enemies)=>({id,enemies});
const context=(pulls,points,extra={})=>({pulls,points:new Map(Object.entries(points)),padding:1,...extra});
const cut=[[5,-20],[5,20]];

test('finite segment intersection measures only the part inside a convex outline',()=>{
  assert.equal(outlineIntersection([-5,5],[15,5],square),10);
  assert.equal(outlineIntersection([2,5],[8,5],square),6);
  assert.equal(outlineIntersection([-5,5],[-1,5],square),0);
  assert.equal(outlineIntersection([-5,0],[0,0],square),0);
  assert.equal(outlineIntersection([-5,-1],[15,-1],square),0);
});
test('largest overlap selects the target and line direction does not change membership',()=>{
  const ctx=context([pull('small',['s1','s2']),pull('large',['a','b','c','d'])],{s1:[3,0],s2:[7,0],a:[0,-10],b:[10,-10],c:[0,10],d:[10,10]},{start:[-10,0]});
  const plan=planPullSplit(ctx,cut);
  assert.equal(plan.pullId,'large');
  assert.deepEqual(plan,planPullSplit(ctx,[...cut].reverse()));
  assert.deepEqual(new Set([...plan.keep,...plan.move]),new Set(['a','b','c','d']));
});
test('previous and next pull determine which part remains first',()=>{
  const ctx=context([pull('prev',['p']),pull('target',['left','right']),pull('next',['n'])],{p:[20,0],left:[0,0],right:[10,0],n:[-10,0]});
  assert.deepEqual(planPullSplit(ctx,cut),{pullId:'target',index:1,keep:['right'],move:['left']});
});
test('entrance and nearest future boss provide route orientation without adjacent pulls',()=>{
  const ctx=context([pull('target',['left','right'])],{left:[0,0],right:[10,0],boss:[-20,0],farBoss:[100,100]},{start:[20,0],bosses:['farBoss','boss']});
  assert.deepEqual(planPullSplit(ctx,cut).keep,['right']);
  ctx.start=null;
  assert.deepEqual(planPullSplit(ctx,cut).keep,['right']);
});
test('line clipping two icons with centers on the same side leaves them together',()=>{
  const ctx=context([pull('target',['a','b','c'])],{a:[4,0],b:[4.5,2],c:[8,0]},{start:[0,0]});
  assert.deepEqual(planPullSplit(ctx,cut).keep,['a','b']);
  assert.deepEqual(planPullSplit(ctx,cut).move,['c']);
});
test('center ties and members on other floors stay in the original pull',()=>{
  const ctx=context([pull('target',['left','right','tie','other-floor'])],{left:[0,0],right:[10,0],tie:[5,0]},{start:[20,0]});
  assert.deepEqual(planPullSplit(ctx,cut).keep,['right','tie','other-floor']);
});
test('misses, zero length, and a cut with all centers on one side do not split',()=>{
  const ctx=context([pull('target',['a','b'])],{a:[0,0],b:[1,0]});
  for(const line of [cut,[[0,0],[0,0]],[[1.5,-5],[1.5,5]],[[0,-5],[0,5]]])assert.equal(planPullSplit(ctx,line),null);
});
test('an unsplittable largest overlap does not silently split a different pull',()=>{
  const ctx=context([pull('small',['a','b']),pull('large',['c','d'])],{a:[0,0],b:[10,0],c:[4.5,-15],d:[4.5,15]});
  assert.equal(planPullSplit(ctx,cut),null);
});
