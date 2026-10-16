import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReportURL} from '../log-import/report-url.js';
test('Report selection accepts query and legacy fragment fight links',()=>{
  assert.deepEqual(parseReportURL('https://www.fellowshiplogs.com/reports/JLhT1y4Fa3n9Xjx8?fight=6&type=damage-done'),{reportCode:'JLhT1y4Fa3n9Xjx8',fightID:6});
  assert.deepEqual(parseReportURL('https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv#fight=12&type=damage-done'),{reportCode:'c4nFLaThdAxtVpYv',fightID:12});
});
test('Invalid hosts, ambiguous fights and non-numeric fights are rejected',()=>{
  for(const url of ['https://evil.test/reports/c4nFLaThdAxtVpYv?fight=5','https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=last','https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv?fight=5#fight=12'])assert.throws(()=>parseReportURL(url));
});
test('Report-only links are accepted for selection but not for downloading a fight',()=>{
  const url='https://www.fellowshiplogs.com/reports/c4nFLaThdAxtVpYv';
  assert.deepEqual(parseReportURL(url,{requireFight:false}),{reportCode:'c4nFLaThdAxtVpYv',fightID:null});
  assert.throws(()=>parseReportURL(url));
  assert.throws(()=>parseReportURL(url+'?fight=last',{requireFight:false}));
});
