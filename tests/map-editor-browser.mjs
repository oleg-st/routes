import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=process.cwd(),tmpRoot=path.resolve('tmp/map-editor-tests');fs.mkdirSync(tmpRoot,{recursive:true});
const work=fs.mkdtempSync(path.join(tmpRoot,'case-')),draftDir=path.join(work,'drafts');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const publicBefore=hash('data/combined-layouts.js');
const server=spawn(process.execPath,['scripts/map-editor-server.mjs'],{env:{...process.env,PORT:'0',MAP_EDITOR_DRAFT_ROOT:path.relative(root,draftDir)},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser,stderr='';server.stderr.on('data',b=>stderr+=b);
try{
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout: '+stderr)),20000);server.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+stderr));});});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1480,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#stage [data-layer]').first().waitFor();
  assert.equal(await page.locator('#dungeon').inputValue(),'Level.ID.IceCave');
  assert.equal(await page.locator('#stage [data-layer]').count(),2);
  const catalog=await fetch(origin+'/api/catalog').then(r=>r.json()),d=catalog.dungeons.find(d=>d.id==='Level.ID.IceCave');
  for(const m of d.mapImages){const r=await fetch(origin+'/api/image?'+new URLSearchParams({dungeon:d.id,map:m.id}));assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>1000);}
  assert.equal((await fetch(origin+'/private/game-data/native-mappings.json')).status,404);
  assert.equal((await fetch(origin+'/api/catalog',{headers:{Origin:'https://example.com'}})).status,403);
  await page.locator('[data-select="1"]').click();
  const before=Number(await page.locator('#x').inputValue()),box=await page.locator('#stage [data-layer="1"] > rect').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+60,box.y+box.height*.5+25,{steps:6});await page.mouse.up();
  assert.notEqual(Number(await page.locator('#x').inputValue()),before,'Dragging changes a layer transform');
  await page.locator('#undo').click();assert.equal(Number(await page.locator('#x').inputValue()),before);
  await page.locator('#redo').click();assert.notEqual(Number(await page.locator('#x').inputValue()),before);
  await page.locator('#scale').fill('0.75');await page.locator('#scale').press('Tab');
  await page.locator('#fit').click();await page.locator('#trace').click();
  const coordinates=await page.locator('#stage [data-layer="1"]').evaluate(g=>[[100,80],[850,100],[700,430],[120,420]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(g.getScreenCTM());return {x:p.x,y:p.y};}));
  for(const p of coordinates)await page.mouse.click(p.x,p.y);
  await page.locator('#trace').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Сохранено:'));
  const saved=JSON.parse(fs.readFileSync(path.join(draftDir,'IceCave.json')));assert.equal(saved.layers[1].outline.length,4);assert.equal(saved.layers[1].scale,.75);
  // Overlap the two real images. A cut in the top image must reveal exactly
  // the same pixels as hiding that image, including its opaque frame/artwork.
  for(const layer of [0,1]){
    await page.locator(`[data-select="${layer}"]`).click();
    for(const [field,value]of [['x','0'],['y','0'],['scale','1']]){await page.locator('#'+field).fill(value);await page.locator('#'+field).press('Tab');}
    await page.locator('#rectangle').click();
  }
  await page.locator('#opacity').fill('1');await page.locator('#markers').uncheck();await page.locator('#fit').click();
  const toScreen=async points=>page.locator('#stage [data-layer="1"]').evaluate((g,points)=>points.map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(g.getScreenCTM());return {x:p.x,y:p.y};}),points);
  const [center]=await toScreen([[512,256]]),clip={x:Math.floor(center.x)-4,y:Math.floor(center.y)-4,width:8,height:8};
  await page.waitForLoadState('networkidle');const covered=await page.screenshot({clip});
  await page.locator('#stage [data-layer="1"]').evaluate(g=>g.style.visibility='hidden');const underneath=await page.screenshot({clip});
  await page.locator('#stage [data-layer="1"]').evaluate(g=>g.style.visibility='');assert.notDeepEqual(covered,underneath);
  await page.locator('#cut-rectangle').click();const [a,b]=await toScreen([[430,180],[600,340]]);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
  await page.waitForLoadState('networkidle');assert.deepEqual(await page.screenshot({clip}),underneath,'Rectangle reveals the lower image pixels');
  await page.locator('#undo').click();assert.deepEqual(await page.screenshot({clip}),covered,'Undo restores the removed artwork');
  await page.locator('#redo').click();assert.deepEqual(await page.screenshot({clip}),underneath);
  await page.locator('#cut').click();const polygon=await toScreen([[650,120],[850,120],[850,260],[650,260]]);
  for(const p of polygon)await page.mouse.click(p.x,p.y);await page.locator('#cut').click();
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Сохранено:'));
  const cutDraft=JSON.parse(fs.readFileSync(path.join(draftDir,'IceCave.json')));assert.equal(cutDraft.layers[1].exclude.length,2);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const recipeFile=path.join(work,'wyrmheart-editor.mjs');await download.saveAs(recipeFile);
  assert.match(fs.readFileSync(recipeFile,'utf8'),/export default/);assert.ok(!fs.readFileSync(recipeFile,'utf8').includes('referenceFrame'));
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Загружен сохранённый черновик');
  assert.equal(await page.locator('#stage #cut-mask-1 polygon').count(),2,'Cutouts survive save/reload');
  await page.screenshot({path:path.resolve('tmp/map-editor-wyrmheart.png')});
  execFileSync(process.execPath,['scripts/prepare-combined-maps.mjs','--recipe='+recipeFile,'--preview'],{stdio:'pipe',windowsHide:true});
  assert.ok(fs.existsSync('private/combined-previews/icecave.svg'));assert.equal(hash('data/combined-layouts.js'),publicBefore,'Preview leaves published maps intact');
  const svg=fs.readFileSync('private/combined-previews/icecave.svg','utf8');assert.match(svg,/id="seam-1"/);assert.match(svg,/id="context-seam-1"/);
  assert.deepEqual(errors,[]);console.log('Map editor: Wyrmheart drag, scale, contours, rectangle/polygon cutouts revealing lower pixels, undo/redo, save/reload, export and renderer preview passed.');
}finally{
  await browser?.close();server.kill();
  assert.ok(work.startsWith(tmpRoot+path.sep));fs.rmSync(work,{recursive:true,force:true});
}
