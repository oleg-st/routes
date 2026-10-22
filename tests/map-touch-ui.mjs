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
    const startState=()=>page.evaluate(()=>{
      const ring=document.querySelector('#map-start circle'),boss=document.querySelector('#markers .boss-ring');
      return {radius:ring.r.baseVal.value*ring.getScreenCTM().a,bossRadius:boss.r.baseVal.value*boss.getScreenCTM().a};
    });
    const initialStart=await startState();
    assert.ok(initialStart.radius<=10&&initialStart.radius<=initialStart.bossRadius/2+.01,'mobile start flag is compact and smaller than bosses');
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
    const mob=await page.locator('#markers > g').evaluateAll(nodes=>{
      for(const node of nodes){
        if(node.querySelector('.boss-ring'))continue;
        const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
        if(document.elementFromPoint(x,y)?.closest('[data-placement]')===node)return {id:node.dataset.placement,x,y};
      }
    });
    assert.ok(mob,'a non-boss mob is reachable on the mobile map');
    const hold=async(x,y)=>{await touch('touchStart',[[1,x,y]]);await page.waitForTimeout(600);};
    await hold(mob.x,mob.y);
    assert.equal(await page.getByRole('menuitemcheckbox',{name:'Chicken',exact:true}).isVisible(),true,'holding a mob opens its actions');
    await touch('touchEnd',[]);
    assert.equal(await page.locator('#markers .assigned-ring').count(),selected,'releasing a hold does not assign the mob');
    await page.getByRole('menuitemcheckbox',{name:'Chicken',exact:true}).tap();
    assert.equal(await page.locator(`[data-placement="${mob.id}"] .chicken-ring`).count(),1,'the touch menu can make a chicken');
    await page.locator('#undo').click();
    // Release, movement, cancellation and a second finger must all disarm the hold.
    await touch('touchStart',[[1,mob.x,mob.y]]);await touch('touchCancel',[]);await page.waitForTimeout(600);
    assert.equal(await page.locator('#enemy-menu').isHidden(),true,'cancelled touch does not open a menu');
    await touch('touchStart',[[1,mob.x,mob.y]]);await touch('touchMove',[[1,mob.x+20,mob.y+15]]);await page.waitForTimeout(600);
    assert.equal(await page.locator('#enemy-menu').isHidden(),true,'panning does not open a menu');
    await touch('touchMove',[[1,mob.x,mob.y]]);await touch('touchEnd',[]);
    await touch('touchStart',[[1,mob.x,mob.y]]);await touch('touchStart',[[1,mob.x,mob.y],[2,mob.x+35,mob.y]]);await page.waitForTimeout(600);
    assert.equal(await page.locator('#enemy-menu').isHidden(),true,'a second finger cancels the menu hold');
    await touch('touchEnd',[]);await page.waitForTimeout(250);
    // Portal endpoints keep their drag gesture and also expose deletion on hold.
    await page.locator('[data-tool=portal]').tap();
    await page.touchscreen.tap(cx-55,cy);await page.touchscreen.tap(cx+55,cy);
    assert.equal(await page.locator('#drawings > g').count(),1);
    const portalPoints=await page.locator('#drawings .annotation-line').getAttribute('points');
    await hold(cx-55,cy);await touch('touchEnd',[]);
    assert.equal(await page.locator('#drawings .annotation-line').getAttribute('points'),portalPoints,'holding an endpoint does not move it');
    await page.getByRole('menuitem',{name:'Delete portal',exact:true}).tap();
    assert.equal(await page.locator('#drawings > g').count(),0,'a portal can be deleted by touch');
    const anchor=await mapPoint(cx,cy);
    await touch('touchStart',pair(35));
    const frozenMarker=await page.locator('#markers > g').first().elementHandle();
    const frozenGeometry=await frozenMarker.innerHTML();
    const markerState=node=>{
      const ring=node.querySelector('.mob-ring'),matrix=ring.getScreenCTM();
      const center=new DOMPoint(ring.cx.baseVal.value,ring.cy.baseVal.value)
        .matrixTransform(matrix).matrixTransform(document.querySelector('#map').getScreenCTM().inverse());
      return {radius:ring.r.baseVal.value*matrix.a,center:[center.x,center.y]};
    };
    const originalMarker=await frozenMarker.evaluate(markerState);
    for(const gap of [45,60,80]){
      await touch('touchMove',pair(gap));
      const current=await frozenMarker.evaluate(markerState);
      near(current.center,originalMarker.center,'icon center stays fixed while its size changes');
      assert.ok(Math.abs(current.radius-originalMarker.radius*Math.sqrt(initial.w/(await view()).w))<.01,'live icon size follows the regular zoom curve');
    }
    assert.ok(await frozenMarker.evaluate(node=>node.isConnected),'pinch reuses the existing marker scene');
    assert.equal(await frozenMarker.innerHTML(),frozenGeometry,'live resizing reuses portrait and ring nodes');
    const enlarged=await view();
    assert.ok(enlarged.w<initial.w*.5,'spreading fingers zooms in');
    near(await mapPoint(cx,cy),anchor,'pinch stays anchored between fingers');
    await touch('touchMove',pair(80,20,25));
    near(await mapPoint(cx+20,cy+25),anchor,'two fingers also pan');
    await touch('touchMove',pair(35,20,25));
    assert.ok(Math.abs((await view()).w-initial.w)<.05,'pinching fingers zooms back out');
    assert.ok(Math.abs((await frozenMarker.evaluate(markerState)).radius-originalMarker.radius)<.01,'icons shrink back immediately during zoom-out');
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
    const radiusBeforeSettle=(await resumedMarker.evaluate(markerState)).radius;
    await touch('touchEnd',[]);
    await page.waitForFunction(node=>!node.isConnected,resumedMarker);
    const radiusAfterSettle=await page.locator('#markers > g').first().evaluate(markerState);
    assert.ok(Math.abs(radiusAfterSettle.radius-radiusBeforeSettle)<.01,'settling changes layout without a jump in icon size');
    // OS interruption must not leave stale pointers or a stuck gesture.
    await touch('touchStart',pair(35));await touch('touchCancel',[]);
    await page.locator('[data-tool=select]').click();
    const beforeSingle=await view();
    await touch('touchStart',[[1,cx,cy]]);await touch('touchMove',[[1,cx+25,cy+20]]);await touch('touchEnd',[]);
    assert.notEqual((await view()).x,beforeSingle.x,'single-finger pan recovers after cancellation');
    assert.equal(await map.evaluate(node=>node.classList.contains('dragging')),false);
    // At distant zoom the entrance shrinks live and does not grow back on settle.
    await touch('touchStart',pair(80));
    const startHandle=await page.locator('#map-start > g').elementHandle();
    for(const gap of [40,20,5]){
      await touch('touchMove',pair(gap));
      const currentStart=await startState();
      assert.ok(currentStart.radius<=10.01&&currentStart.radius<=currentStart.bossRadius/2+.01,'flag stays smaller than a boss during zoom-out');
      assert.ok(await startHandle.evaluate(node=>node.isConnected),'flag resizes without replacing its nodes');
    }
    assert.ok(Math.abs((await view()).w-imageWidth)<.01,'pinch zoom-out stops at the whole-map fit');
    const distantStart=await startState();
    const overviewRadius=Math.min(10,enemyMarkerRadius(Number(await page.locator('#marker-size').inputValue()),1,true)/2);
    assert.ok(Math.abs(distantStart.radius-overviewRadius)<.01,'flag uses its overview size at the zoom-out limit');
    await touch('touchEnd',[]);
    await page.waitForFunction(node=>!node.isConnected,startHandle);
    assert.ok(Math.abs((await startState()).radius-distantStart.radius)<.01,'start flag size is stable after delayed layout');
    await page.locator('#add-pull').tap();
    const card=page.locator('.pull-card').first(),second=page.locator('.pull-card').nth(1);
    await card.locator('.pull-name').tap();
    assert.equal(await card.evaluate(node=>node.classList.contains('selected')),true,'one short tap selects a different pull');
    assert.equal(await page.locator('#pull-tooltip').isHidden(),true,'a short tap does not open the hint');
    await second.locator('.pull-name').tap();
    assert.equal(await second.evaluate(node=>node.classList.contains('selected')),true,'one tap switches back to the second pull');
    await card.scrollIntoViewIfNeeded();
    const cardBox=await card.locator('.pull-name').boundingBox(),px=cardBox.x+cardBox.width/2,py=cardBox.y+cardBox.height/2;
    await touch('touchStart',[[1,px,py]]);
    assert.equal(await page.locator('#pull-tooltip').isHidden(),true,'touching a pull does not immediately show the hint');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#pull-tooltip').isVisible(),true,'holding a pull shows its hint');
    // A touch hold can also trigger native drag/focus/leave events. None of
    // those should dismiss a hint that the user has explicitly opened.
    await card.dispatchEvent('dragstart');
    assert.equal(await page.locator('#pull-tooltip').isVisible(),true,'a prevented native touch drag keeps the hint open');
    await touch('touchEnd',[]);
    await card.dispatchEvent('focusout');
    await page.locator('#pull-tooltip').dispatchEvent('pointerleave',{pointerType:'touch'});
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#pull-tooltip').isVisible(),true,'focus and pointer changes after release keep the hint open');
    assert.equal(await second.evaluate(node=>node.classList.contains('selected')),true,'releasing a hold does not switch pulls');
    await card.locator('.pull-name').tap();
    assert.equal(await card.evaluate(node=>node.classList.contains('selected')),true,'the next short tap still switches immediately');
    assert.equal(await page.locator('#pull-tooltip').isHidden(),true,'switching pulls dismisses the hint');
    await touch('touchStart',[[1,px,py]]);await touch('touchMove',[[1,px,py-20]]);await page.waitForTimeout(600);
    assert.equal(await page.locator('#pull-tooltip').isHidden(),true,'scrolling cancels the pull hint');
    await touch('touchEnd',[]);
    for(const selector of ['#map image','.pull-card .pull-name','.map-controls img']){
      assert.equal(await page.locator(selector).first().evaluate(node=>getComputedStyle(node).webkitUserSelect),'none','Safari selection is disabled on hold targets');
    }
    const toolbarImage=page.locator('[data-tool=portal] img');
    assert.equal(await toolbarImage.evaluate(node=>getComputedStyle(node).webkitUserDrag),'none','toolbar images cannot start native dragging');
    for(const type of ['contextmenu','dragstart']){
      assert.equal(await toolbarImage.evaluate((node,type)=>!node.dispatchEvent(new Event(type,{bubbles:true,cancelable:true})),type),true,`toolbar suppresses native ${type}`);
    }
    assert.equal(await card.evaluate(node=>!node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))),true,'pull holds suppress the browser menu');
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Mobile map passed in server and local modes: single-tap pull selection, hold hints and context actions, gesture cancellation, live icon resizing, anchored pan and drawing safety.');
}finally{await browser?.close();server.kill();}
