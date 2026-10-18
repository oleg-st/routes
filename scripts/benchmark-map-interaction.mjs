// Run with node scripts/benchmark-map-interaction.mjs [output.json].
// The temporary page-only wrappers measure JS rendering and solver calls;
// these timings exclude browser painting and are not an FPS measurement.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
 const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}`)));});
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.js',async route=>{
  const response=await route.fetch(),body=await response.text();
  await route.fulfill({response,body:body+`\nwindow.__profile={render:[],layout:[]};
const benchRender=renderMap;renderMap=function(...args){const start=performance.now();try{return benchRender(...args);}finally{window.__profile.render.push(performance.now()-start);}};
const benchLayout=separateMarkerCenters;separateMarkerCenters=function(...args){const start=performance.now();try{return benchLayout(...args);}finally{window.__profile.layout.push(performance.now()-start);}};`});
 });
 await page.goto(origin);await page.locator('#map-loading').waitFor({state:'hidden'});
 const results=[];
 const report=async(kind)=>page.evaluate(kind=>{
  const stats=xs=>{xs.sort((a,b)=>a-b);return {calls:xs.length,medianMs:xs[Math.floor(xs.length/2)]||0,p95Ms:xs[Math.floor(xs.length*.95)]||0};};
  return {kind,mobs:document.querySelectorAll('#markers > g').length,render:stats(window.__profile.render),layout:stats(window.__profile.layout)};
 },kind);
 for(const id of ['Level.ID.UrrakMarkets','Level.ID.FrozenKingdom']){
  await page.locator('#dungeon').selectOption(id);await page.locator('#map-loading').waitFor({state:'hidden'});
  await page.mouse.move(700,550);await page.mouse.wheel(0,-100);await page.mouse.wheel(0,100);
  await page.evaluate(()=>{window.__profile={render:[],layout:[]};});
  await page.mouse.move(700,550);await page.mouse.down({button:'right'});await page.mouse.move(950,650,{steps:30});await page.mouse.up({button:'right'});
  results.push(await report(id+' pan'));
  await page.evaluate(()=>{window.__profile={render:[],layout:[]};});
  for(let i=0;i<24;i++)await page.locator('#map').dispatchEvent('wheel',{deltaY:i<12?-100:100,clientX:700,clientY:550});
  results.push(await report(id+' zoom'));
  await page.evaluate(()=>{window.__profile={render:[],layout:[]};});
  await page.locator('#show-packs').evaluate(e=>{e.checked=true;e.dispatchEvent(new Event('input'));e.checked=false;e.dispatchEvent(new Event('input'));});
  await page.locator('#markers > g').first().dispatchEvent('click');
  await page.locator('#markers > g').first().dispatchEvent('click');
  results.push(await report(id+' selection and labels'));
 }
 if(errors.length)throw Error(errors.join('\n'));
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();server.kill();}
