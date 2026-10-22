import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import fs from 'node:fs';

const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json'));

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    for(const [id,limit] of [['Level.ID.DesertDunes',2],['Level.ID.FrozenKingdom',4]]){
      if(await page.locator('#dungeon').inputValue()!==id)await page.locator('#dungeon').selectOption(id);
      const placement=dungeons.find(d=>d.id===id).enemies[0].placementId;
      await page.locator(`#markers > g[data-placement="${placement}"]`).waitFor();
      await page.locator('#map-loading').waitFor({state:'hidden'});
      const counter=page.locator('[data-route-chicken]'),tip=page.locator('#chicken-tooltip');
      await counter.focus();
      assert.match(await tip.innerText(),new RegExp(`Dungeon limit: ${limit} uses, shared by the party`));
      const ids=await page.locator('#markers > g[data-placement]:not(:has(.boss-ring))').evaluateAll(elements=>elements.slice(0,5).map(element=>element.dataset.placement));
      assert.ok(ids.length>limit);
      for(let i=0;i<=limit;i++){
        await page.locator(`#markers > g[data-placement="${ids[i]}"]`).press('Shift+F10');
        await page.getByRole('menuitemcheckbox',{name:'Chicken',exact:true}).click();
        await counter.focus();
        assert.equal(await counter.locator('b').innerText(),String(i+1));
        assert.equal(await counter.locator('.relic-warning').count(),i===limit?1:0);
        assert.equal(await tip.locator('.chicken-limit-warning').count(),i===limit?1:0);
      }
      assert.match(await tip.innerText(),new RegExp(`Dungeon limit exceeded: ${limit+1} / ${limit} Chicken uses`));
      assert.match(await tip.innerText(),/Not in a pull/);
      await tip.screenshot({path:`tmp/chicken-limit-${limit}.png`});
      await page.locator('#undo').click();await counter.focus();
      assert.equal(await tip.locator('.chicken-limit-warning').count(),0);
      assert.equal(await counter.locator('.relic-warning').count(),0);
      await page.locator('#redo').click();await counter.focus();
      assert.equal(await tip.locator('.chicken-limit-warning').count(),1);
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      console.log(`${url}: limit ${limit} passed`);
      await page.locator('#route-name').focus();await counter.focus();
      const bounds=await tip.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
      await page.setViewportSize({width:1440,height:1000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Chicken limits: adventure/capstone boundaries, unassigned mobs, undo/redo, narrow viewport, HTTP/local passed.');
}finally{await browser?.close();server.kill();}
