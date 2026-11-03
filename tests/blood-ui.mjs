import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const dungeon=JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.MoorCastle');
const caster=dungeon.enemies.find(p=>p.id==='mc-bloodcaster');
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('error',reject);server.on('exit',code=>reject(Error('Server exited '+code)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const [index,url]of [origin,pathToFileURL(process.cwd()+'/local.html').href].entries()){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-blood-tower]').count(),0);
    await page.locator('#dungeon').selectOption(dungeon.id);
    await page.locator('[data-blood-tower]').first().waitFor({state:'attached'});
    await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});
    assert.equal(await page.locator('[data-blood-tower]').count(),3);
    assert.equal(await page.locator('[data-blood-tower] text').count(),0);
    const tower=page.locator('[data-blood-tower]').first();
    await tower.dispatchEvent('pointermove',{clientX:500,clientY:400});
    assert.equal(await page.locator('#tooltip strong').innerText(),'Blood tower');
    assert.equal(await page.locator('#tooltip .blood-value').innerText(),'20 blood');
    const towerBox=await tower.boundingBox(),campfireBox=await page.locator('[data-campfire] image').first().boundingBox();
    assert.ok(towerBox.height<campfireBox.height*.85,'Blood marker is smaller than a campfire');
    assert.ok(await page.evaluate(()=>['campfires','blood-towers'].every(id=>
      Boolean(document.getElementById(id).compareDocumentPosition(document.getElementById('markers'))&Node.DOCUMENT_POSITION_FOLLOWING)
    )),'Mobs are painted over both kinds of map POI');
    const poiGeometry=()=>page.locator('[data-blood-tower],[data-campfire]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('transform'),n.innerHTML]));
    const beforeZoom=await poiGeometry(),beforeView=await page.locator('#map').getAttribute('viewBox');
    await page.locator('#map').dispatchEvent('wheel',{clientX:500,clientY:500,deltaY:-300});
    await page.waitForFunction(before=>document.querySelector('#map').getAttribute('viewBox')!==before,beforeView);
    assert.deepEqual(await poiGeometry(),beforeZoom,'Tower and campfire coordinates and map-unit sizes stay fixed on zoom');
    await page.locator('#map').press('f');
    await page.screenshot({path:`tmp/blood-tower-${index}.png`});
    assert.equal(await page.locator('.pull-blood').first().innerText(),'0 blood / 0 total');
    const marker=page.locator(`#markers > [data-placement="${caster.placementId}"]`);
    await marker.press('Shift+F10');await page.getByRole('menuitem',{name:'Add only this mob',exact:true}).click();
    assert.equal(await page.locator('.pull-blood').first().innerText(),'5 blood / 5 total');
    await marker.dispatchEvent('pointermove',{clientX:500,clientY:400});
    assert.equal(await page.locator('#tooltip .tip-score .blood-value').innerText(),'5 blood');
    assert.equal(await page.locator('#tooltip .tip-score .blood-value').getAttribute('title'),'1 blood orb · 5 blood');
    await page.screenshot({path:`tmp/blood-tooltip-${index}.png`});
    await page.locator('.pull-card').first().focus();
    assert.equal(await page.locator('#pull-tooltip .tip-pack-percent .blood-value').innerText(),'5 blood');
    await marker.press('Shift+F10');await page.getByRole('menuitem',{name:'Info',exact:true}).click();
    assert.equal(await page.locator('#inspector .blood-value').innerText(),'5 blood');
    await page.locator('.close-inspector').click();
    await marker.press('Shift+F10');await page.getByRole('menuitemcheckbox',{name:'Chicken',exact:true}).click();
    assert.equal(await page.locator('.pull-blood').first().innerText(),'0 blood / 0 total');
    await page.locator('#undo').click();
    assert.equal(await page.locator('.pull-blood').first().innerText(),'5 blood / 5 total');
    await page.locator('#shadow').click();
    assert.equal(await page.locator('.pull-blood').first().innerText(),'5 blood / 5 total');
    assert.match(await page.locator('.pull-detail:not(.pull-blood)').first().innerText(),/orbs/);
    for(const [enemyId,expected]of [['mc-bloodsummoner',13],['st-smallbloodelemental',16]]){
      const p=dungeon.enemies.find(p=>p.id===enemyId),mob=page.locator(`#markers > [data-placement="${p.placementId}"]`);
      await mob.press('Shift+F10');await page.getByRole('menuitem',{name:'Add only this mob',exact:true}).click();
      assert.equal(await page.locator('.pull-blood').first().innerText(),`${expected} blood / ${expected} total`);
      if(enemyId==='st-smallbloodelemental'){
        await mob.dispatchEvent('pointermove',{clientX:500,clientY:400});
        assert.equal(await page.locator('#tooltip .tip-score .blood-value').innerText(),'3 blood');
      }
    }
    await page.mouse.move(0,0);await page.screenshot({path:`tmp/blood-map-${index}.png`});
    await page.setViewportSize({width:390,height:900});await page.screenshot({path:`tmp/blood-mobile-${index}.png`});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#dungeon').selectOption('Level.ID.DesertDunes');
    await page.waitForFunction(()=>document.querySelectorAll('[data-blood-tower]').length===0);
    assert.equal(await page.locator('.pull-blood').count(),0);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Blood UI verified over HTTP and in local.html.');
}finally{await browser?.close();server.kill();}
