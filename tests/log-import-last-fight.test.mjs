import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLog} from '../log-import/live-api.js';

const url='https://www.fellowshiplogs.com/reports/QLNmthnvDR26CPyj';
const fight={id:5,name:'Example',startTime:100,endTime:200,dungeonPulls:[{id:1,startTime:100,endTime:200}]};
const actors=[{id:1,type:'Player'},{id:2,type:'NPC',gameID:123}];
const event={type:'damage',timestamp:120,fight:5,sourceID:1,targetID:2};
const response=report=>({ok:true,json:async()=>({data:{reportData:{report}}})});

test('Last-fight import resolves an unsorted summary before requesting metadata and events',async()=>{
  for(const selector of ['?fight=last','#fight=last']){
    const calls=[];
    const result=await loadLog(url+selector,{token:'x',fetcher:async(_,options)=>{
      const body=JSON.parse(options.body);calls.push(body);
      if(calls.length===1)return response({fights:[{...fight,id:3,startTime:50},fight,{...fight,id:1,startTime:10}]});
      assert.deepEqual(body.variables.fights,[5]);
      return response(calls.length===2?{fights:[fight],masterData:{actors}}:{events:{data:[event],nextPageTimestamp:null}});
    }});
    assert.equal(calls.length,3);assert.equal(result.fightID,5);assert.equal(result.fight.id,5);assert.equal(result.complete,true);
  }
});

test('Last-fight import reports empty logs and does not fall back from an unfinished last run',async()=>{
  const lastURL=url+'?fight=last';
  await assert.rejects(loadLog(lastURL,{token:'x',fetcher:async()=>response({fights:[]})}),/no fights/);
  let calls=0;
  await assert.rejects(loadLog(lastURL,{token:'x',fetcher:async(_,options)=>{
    calls++;const body=JSON.parse(options.body);
    if(calls===1)return response({fights:[{...fight,id:4,startTime:50},{...fight,inProgress:true}]});
    assert.deepEqual(body.variables.fights,[5]);
    return response({fights:[{...fight,inProgress:true}],masterData:{actors}});
  }}),/still in progress/);
  assert.equal(calls,2);
});
