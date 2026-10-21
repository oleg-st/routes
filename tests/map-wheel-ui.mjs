import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<.0001,`${label}: ${actual} vs ${expected}`);
try{
  const origin=await new Promise((resolve,reject)=>{
    server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
    server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}`)));
  });
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');
    const gesture=events=>page.evaluate(async events=>{
      const map=document.querySelector('#map'),box=map.getBoundingClientRect();
      const clientX=Math.round(box.x+box.width*.63),clientY=Math.round(box.y+box.height*.37);
      const point=()=>{const p=new DOMPoint(clientX,clientY).matrixTransform(map.getScreenCTM().inverse());return [p.x,p.y];};
      const width=map.viewBox.baseVal.width,anchor=point();
      for(const event of events)map.dispatchEvent(new WheelEvent('wheel',{cancelable:true,clientX,clientY,...event}));
      const immediate=map.viewBox.baseVal.width;
      await new Promise(resolve=>setTimeout(resolve,220));
      return {factor:width/immediate,anchor,after:point(),immediate,settled:map.viewBox.baseVal.width};
    },events);
    const single=await gesture([{deltaY:-100}]);
    near(single.factor,1.16,'single tick responds immediately');
    near(single.settled,single.immediate,'no animation continues after input');
    single.anchor.forEach((n,i)=>near(single.after[i],n,'cursor anchor stays fixed'));
    near((await gesture([{deltaY:100}])).factor,1/1.16,'reverse tick');
    const burst=await gesture(Array.from({length:3},()=>({deltaY:-100})));
    near(burst.factor,1.16**3,'three quick ticks keep the same step');
    near((await gesture([{deltaY:300}])).factor,1/burst.factor,'one large event equals three small events');
    near((await gesture(Array.from({length:30},()=>({deltaY:-10})))).factor,burst.factor,'sensitivity depends on distance, not event count');
    await gesture([{deltaY:300}]);
    near((await gesture(Array.from({length:10},()=>({deltaY:-10})))).factor,single.factor,'trackpad event count does not change sensitivity');
    near((await gesture([{deltaY:100}])).factor,1/single.factor,'restore scale');
    const tiny=await gesture([{deltaY:-1}]);assert.ok(tiny.factor>1&&tiny.factor<1.002,'tiny trackpad movement stays tiny');
    await gesture([{deltaY:1}]);
    near((await gesture([{deltaY:-3,deltaMode:1}])).factor,single.factor,'line mode normalization');
    await gesture([{deltaY:100}]);
    const height=await page.locator('#map').evaluate(node=>node.getBoundingClientRect().height);
    near((await gesture([{deltaY:-100/height,deltaMode:2}])).factor,single.factor,'page mode normalization');
    await gesture([{deltaY:100}]);
    const zero=await gesture([{deltaY:0,deltaX:100},{deltaY:-100},{deltaY:100}]);
    near(zero.factor,1,'zero and opposite deltas do not zoom');
    // Wheel input must not leave delayed work after a reset.
    const reset=await page.evaluate(async()=>{
      const map=document.querySelector('#map');
      map.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:700,clientY:550,cancelable:true}));
      map.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
      const before=map.getAttribute('viewBox');
      await new Promise(resolve=>setTimeout(resolve,280));
      return {before,after:map.getAttribute('viewBox')};
    });
    assert.equal(reset.after,reset.before,'no delayed zoom after reset');
    const sequence=await page.evaluate(async()=>{
      const map=document.querySelector('#map'),factors=[];
      for(const [deltaY,pause] of [[-100,0],[-100,40],[-100,40],[-100,40],[-100,40],[100,40],[100,220]]){
        if(pause)await new Promise(resolve=>setTimeout(resolve,pause));
        const width=map.viewBox.baseVal.width;
        map.dispatchEvent(new WheelEvent('wheel',{deltaY,clientX:700,clientY:550,cancelable:true}));
        factors.push(width/map.viewBox.baseVal.width);
      }
      map.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
      return factors;
    });
    [1,1,1,1,1,-1,-1].forEach((power,i)=>near(sequence[i],1.16**power,
      `tick ${i+1} keeps its fixed step regardless of timing or direction`));
    near((await gesture([{deltaY:1000000}])).factor,1,'cannot zoom out beyond the whole-map fit');
    near((await gesture([{deltaY:1000000}])).factor,1,'repeated zoom-out stays at the whole-map fit');
    near((await gesture([{deltaY:-1000000}])).factor,24,'large input respects zoom-in limit');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Wheel zoom passed in server and local modes: immediate response, fixed sensitivity regardless of timing, zoom limits, input units and cursor anchor.');
}finally{await browser?.close();server.kill();}
