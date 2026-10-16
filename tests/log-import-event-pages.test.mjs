import test from 'node:test';
import assert from 'node:assert/strict';
import {collectEventPages,summarizeEventStream} from '../log-import/event-pages.js';
test('Preserves API cursor and distinct same-timestamp events across pages',async()=>{
  const cursors=[];
  const result=await collectEventPages({startTime:0,endTime:100,fetchPage:async cursor=>{
    cursors.push(cursor);return cursor===0?{data:[{timestamp:25,type:'damage',targetID:1}],nextPageTimestamp:25}:{data:[{timestamp:25,type:'damage',targetID:2}],nextPageTimestamp:null};
  }});
  assert.deepEqual(cursors,[0,25]);assert.equal(result.complete,true);assert.equal(result.eventCount,2);
  const summary=summarizeEventStream(result);assert.equal(summary.types.damage.count,2);assert.ok(summary.fields.includes('targetID'));
});
test('Does not claim completeness for capped, stalled, malformed, or missing pages',async()=>{
  for(const page of [{data:[]},{data:[],nextPageTimestamp:0},{data:[],nextPageTimestamp:101},{data:null,nextPageTimestamp:null}]){
    const result=await collectEventPages({startTime:0,endTime:100,fetchPage:async()=>page});assert.equal(result.complete,false);assert.ok(result.error);
  }
  const capped=await collectEventPages({startTime:0,endTime:100,maxPages:1,fetchPage:async()=>({data:[],nextPageTimestamp:1})});
  assert.equal(capped.complete,false);assert.match(capped.error,/limit/);
});
test('Retains fetched evidence when a later page fails or the user cancels',async()=>{
  const result=await collectEventPages({startTime:0,endTime:100,fetchPage:async cursor=>{
    if(cursor>0)throw new Error('network failure');return {data:[{type:'death'}],nextPageTimestamp:1};
  }});
  assert.equal(result.complete,false);assert.equal(result.eventCount,1);assert.match(result.error,/network/);
  const controller=new AbortController();controller.abort();
  const cancelled=await collectEventPages({startTime:0,endTime:100,signal:controller.signal,fetchPage:async()=>assert.fail('Must not fetch')});
  assert.equal(cancelled.complete,false);assert.match(cancelled.error,/cancelled/);
});
