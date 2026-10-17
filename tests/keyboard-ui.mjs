import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const url of [origin,pathToFileURL(`${process.cwd()}/local.html`).href]){
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    // Supply both the layout-dependent symbol and physical code, as a browser does.
    const press=(key,code,modifiers={},target='body')=>page.locator(target).dispatchEvent('keydown',{key,code,...modifiers});
    const count=async()=>Number(await page.locator('#pull-count').textContent());
    for(const keys of [
      {n:'n',z:'z',y:'y',f:'f',b:'b',v:'v',d:'d',s:'s'},
      {n:'т',z:'я',y:'н',f:'а',b:'и',v:'м',d:'в',s:'ы'},
      {n:'n',z:'y',y:'z',f:'f',b:'b',v:'v',d:'d',s:'s'},
    ]){
      const before=await count();
      await press(keys.n,'KeyN');assert.equal(await count(),before+1);
      for(const modifier of ['ctrlKey','metaKey']){
        await press(keys.z,'KeyZ',{[modifier]:true});assert.equal(await count(),before);
        await press(keys.z.toUpperCase(),'KeyZ',{[modifier]:true,shiftKey:true});assert.equal(await count(),before+1);
        await press(keys.z,'KeyZ',{[modifier]:true});assert.equal(await count(),before);
        await press(keys.y,'KeyY',{[modifier]:true});assert.equal(await count(),before+1);
        await press(keys.f,'KeyF',{[modifier]:true});assert.equal(await page.locator('#search').evaluate(el=>el===document.activeElement),true);
        await page.locator('#search').evaluate(el=>el.blur());
      }
      for(const [letter,tool] of [['b','box'],['v','select'],['d','line'],['s','split']]){
        await press(keys[letter],`Key${letter.toUpperCase()}`);
        assert.equal(await page.locator(`[data-tool=${tool}]`).evaluate(el=>el.classList.contains('active')),true);
      }
      await press('Escape','Escape');assert.equal(await page.locator('[data-tool=select]').evaluate(el=>el.classList.contains('active')),true);
      const map=page.locator('#map'),fitted=await map.getAttribute('viewBox'),bounds=await map.boundingBox();
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
      await page.mouse.move(bounds.x+bounds.width/2+70,bounds.y+bounds.height/2+40);await page.mouse.up();
      assert.notEqual(await map.getAttribute('viewBox'),fitted);
      await press(keys.f,'KeyF');assert.equal(await map.getAttribute('viewBox'),fitted);
      // Typing and native input undo must not mutate the route.
      await press(keys.n,'KeyN',{},'#route-name');await press(keys.z,'KeyZ',{ctrlKey:true},'#route-name');
      await press(keys.n,'KeyN',{altKey:true});assert.equal(await count(),before+1);
    }
    // Preserve support for events from environments that do not provide code.
    const before=await count();await press('n','');assert.equal(await count(),before+1);
    await press('z','',{ctrlKey:true});assert.equal(await count(),before);
    assert.deepEqual(errors,[]);await context.close();
    console.log(`Keyboard shortcuts passed: ${url===origin?'server':'local file'}`);
  }
}finally{await browser?.close();server.kill();}
