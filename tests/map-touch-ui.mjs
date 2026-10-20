import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {enemyMarkerRadius,enemyMarkerScale} from '../data/enemy-marker-sizes.js';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{
    server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
    server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}`)));
  });
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.locator('#dungeon').selectOption({label:'Ransack of Drakheim'});
    await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');
    const map=page.locator('#map'),bounds=await map.boundingBox();
    const view=()=>map.evaluate(node=>{
      const b=node.viewBox.baseVal;return {x:b.x,y:b.y,w:b.width,h:b.height};
    });
    const initial=await view(),imageWidth=Number(await page.locator('#map-image').getAttribute('width'));
    assert.ok(Math.abs(initial.w-imageWidth/3)<.01,'mobile opens at 3× zoom');
    const screenRadii=await page.locator('#markers .mob-ring').evaluateAll(nodes=>nodes.map(node=>({
      radius:node.r.baseVal.value*node.getScreenCTM().a,boss:node.classList.contains('boss-ring'),
    })));
    const baseRadius=enemyMarkerRadius(Number(await page.locator('#marker-size').inputValue()),3,true);
    assert.ok(Math.abs(Math.min(...screenRadii.filter(r=>!r.boss).map(r=>r.radius))-baseRadius*enemyMarkerScale({baseHealth:0})/3)<.01,'mobile mob icons are three times smaller');
    assert.ok(screenRadii.filter(r=>r.boss).every(r=>Math.abs(r.radius-baseRadius*enemyMarkerScale({isBoss:true})/3)<.01),'boss icons are also three times smaller');
    const client=await context.newCDPSession(page);
    const touch=async(type,points)=>{
      await client.send('Input.dispatchTouchEvent',{
        type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2})),
      });
      await page.evaluate(()=>new Promise(requestAnimationFrame));
    };
    const cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height*.6;
    const pair=(gap,dx=0,dy=0)=>[[1,cx-gap+dx,cy+dy],[2,cx+gap+dx,cy+dy]];
    const mapPoint=(x,y)=>map.evaluate((node,[x,y])=>{
      const p=new DOMPoint(x,y).matrixTransform(node.getScreenCTM().inverse());return [p.x,p.y];
    },[x,y]);
    const near=(actual,expected,message)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<.02,`${message}: ${actual} vs ${expected}`));
    const selected=await page.locator('#markers .assigned-ring').count();
    const anchor=await mapPoint(cx,cy);
    await touch('touchStart',pair(35));
    const frozenMarker=await page.locator('#markers > g').first().elementHandle();
    const frozenGeometry=await frozenMarker.innerHTML();
    for(const gap of [45,60,80])await touch('touchMove',pair(gap));
    assert.ok(await frozenMarker.evaluate(node=>node.isConnected),'pinch reuses the existing marker scene');
    assert.equal(await frozenMarker.innerHTML(),frozenGeometry,'marker positions and geometry stay fixed in map coordinates');
    const enlarged=await view();
    assert.ok(enlarged.w<initial.w*.5,'spreading fingers zooms in');
    near(await mapPoint(cx,cy),anchor,'pinch stays anchored between fingers');
    await touch('touchMove',pair(80,20,25));
    near(await mapPoint(cx+20,cy+25),anchor,'two fingers also pan');
    await touch('touchMove',pair(35,20,25));
    assert.ok(Math.abs((await view()).w-initial.w)<.05,'pinching fingers zooms back out');
    // Lifting one finger continues panning without clicking or editing.
    await touch('touchEnd',[[2,cx+55,cy+25]]);
    const beforePan=await view();
    await touch('touchMove',[[1,cx+5,cy+40]]);
    assert.notEqual((await view()).x,beforePan.x);
    await touch('touchEnd',[]);
    assert.ok(await frozenMarker.evaluate(node=>node.isConnected),'layout waits briefly after release');
    await page.waitForFunction(node=>!node.isConnected,frozenMarker);
    assert.equal(await page.locator('#markers .assigned-ring').count(),selected,'pinch does not select mobs');
    assert.equal(await page.locator('#drawings > g').count(),0);
    assert.equal(await map.evaluate(node=>node.classList.contains('dragging')),false);
    // A pinch also works with a drawing tool selected and leaves no draft behind.
    await page.getByRole('button',{name:'Draw arrow and settings',exact:true}).click();
    await touch('touchStart',pair(35));await touch('touchMove',pair(60));await touch('touchEnd',[]);
    assert.equal(await page.locator('#drawings > g').count(),0);
    assert.equal(await page.locator('#draft > *').count(),0);
    // A new gesture cancels the pending settle, including while fingers pause.
    await touch('touchStart',pair(35));
    const resumedMarker=await page.locator('#markers > g').first().elementHandle();
    await touch('touchMove',pair(50));
    await page.waitForTimeout(250);
    assert.ok(await resumedMarker.evaluate(node=>node.isConnected),'no delayed relayout while the next gesture is active');
    await touch('touchEnd',[]);
    await page.waitForFunction(node=>!node.isConnected,resumedMarker);
    // OS interruption must not leave stale pointers or a stuck gesture.
    await touch('touchStart',pair(35));await touch('touchCancel',[]);
    await page.locator('[data-tool=select]').click();
    const beforeSingle=await view();
    await touch('touchStart',[[1,cx,cy]]);await touch('touchMove',[[1,cx+25,cy+20]]);await touch('touchEnd',[]);
    assert.notEqual((await view()).x,beforeSingle.x,'single-finger pan recovers after cancellation');
    assert.equal(await map.evaluate(node=>node.classList.contains('dragging')),false);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Mobile map passed in server and local modes: smaller icons, frozen pinch layout, delayed settle, gesture restart, anchored pan, drawing safety and cancellation.');
}finally{await browser?.close();server.kill();}
