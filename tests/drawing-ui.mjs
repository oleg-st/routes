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
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.locator('#map-loading').waitFor({state:'hidden'});
    const map=page.locator('#map'),drawings=page.locator('#drawings > g');
    const point=async(x,y)=>{const r=await map.boundingBox();return {x:r.x+x,y:r.y+y};};
    const click=async(x,y,options)=>{const p=await point(x,y);await page.mouse.click(p.x,p.y,options);};
    const move=async(x,y)=>{const p=await point(x,y);await page.mouse.move(p.x,p.y);};
    const stroke=()=>drawings.first().locator('.annotation-line');
    assert.equal(await page.locator('[data-tool=erase]').count(),0);
    await page.getByRole('button',{name:'Draw arrow and settings',exact:true}).click();
    await page.getByRole('button',{name:'Purple',exact:true}).click();
    await page.getByRole('button',{name:'Thick',exact:true}).click();
    await click(280,240);await move(500,290);
    assert.equal(await page.locator('#draft .annotation-line').count(),1);
    const arrowFill=selector=>page.locator(selector).evaluate(line=>{
      const id=line.getAttribute('marker-end').slice(5,-1);
      return document.getElementById(id)?.querySelector('path').getAttribute('fill');
    });
    assert.equal(await arrowFill('#draft .annotation-line'),'#9000ff','draft arrowhead has an explicit matching color for Safari');
    assert.equal(await drawings.count(),0);
    await click(500,290);
    assert.equal(await drawings.count(),1);
    assert.equal(await stroke().getAttribute('stroke'),'#9000ff');
    assert.equal(await arrowFill('#drawings .annotation-line'),'#9000ff','saved arrowhead keeps its own color');
    assert.equal(await stroke().getAttribute('stroke-width'),'5');
    assert.equal((await stroke().getAttribute('points')).split(' ').length,2);
    const original=await stroke().getAttribute('points');
    await move(390,265);
    assert.equal(await drawings.first().locator('[data-endpoint="0"]').evaluate(el=>getComputedStyle(el).opacity),'1');
    const view=await map.getAttribute('viewBox');
    for(const [from,to] of [[[280,240],[250,310]],[[500,290],[540,350]]]){
      await move(...from);await page.mouse.down();await move(...to);await page.mouse.up();
    }
    assert.equal(await map.getAttribute('viewBox'),view,'Endpoint drag must not pan');
    const edited=await stroke().getAttribute('points');assert.notEqual(edited,original);
    await page.locator('#undo').click();await page.locator('#undo').click();assert.equal(await stroke().getAttribute('points'),original);
    await page.locator('#redo').click();await page.locator('#redo').click();assert.equal(await stroke().getAttribute('points'),edited);
    await click(395,330,{button:'right'});await page.getByRole('menuitem',{name:'Delete arrow',exact:true}).click();
    assert.equal(await drawings.count(),0);await page.locator('#undo').click();assert.equal(await drawings.count(),1);
    // Right-drag continues to pan without opening a deletion menu.
    await move(395,330);await page.mouse.down({button:'right'});await move(425,350);await page.mouse.up({button:'right'});
    assert.equal(await page.locator('#enemy-menu').isHidden(),true);
    await page.keyboard.press('f');
    // Escape cancels an in-progress arrow.
    await page.locator('[data-tool=line]').click();await click(250,440);await move(500,440);await page.keyboard.press('Escape');
    assert.equal(await page.locator('#draft > g').count(),0);assert.equal(await drawings.count(),1);
    // Two-point relic paths delete from their endpoints and undo correctly.
    for(const [tool,y] of [['portal',460],['invis',540]]){
      // Dragging must neither create a path nor leave a pending first point.
      await page.locator(`[data-tool=${tool}]`).click();
      await move(300,y);await page.mouse.down();await move(500,y);await page.mouse.up();
      assert.equal(await drawings.count(),1);
      assert.equal(await page.locator('#draft > g').count(),0);
      await click(300,y);await move(500,y);
      assert.equal(await drawings.count(),1);
      assert.equal(await page.locator('#draft .annotation-line').count(),1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#draft > g').count(),0);
      await page.locator(`[data-tool=${tool}]`).click();await click(300,y);await click(500,y);
      assert.equal(await drawings.count(),2);
      const path=drawings.nth(1).locator('.annotation-line'),before=await path.getAttribute('points'),beforeView=await map.getAttribute('viewBox');
      // Grab off-center to verify the icon does not jump to the pointer.
      for(const x of [300,500]){await move(x+5,y+5);await page.mouse.down();await move(x+35,y+25);await page.mouse.up();}
      const after=await path.getAttribute('points');assert.notEqual(after,before);assert.equal(await map.getAttribute('viewBox'),beforeView);
      const icon=await drawings.nth(1).locator('[data-endpoint="0"]').boundingBox(),expected=await point(330,y+20);
      assert.ok(Math.abs(icon.x+icon.width/2-expected.x)<1&&Math.abs(icon.y+icon.height/2-expected.y)<1);
      await page.locator('#undo').click();await page.locator('#undo').click();assert.equal(await path.getAttribute('points'),before);
      await page.locator('#redo').click();await page.locator('#redo').click();assert.equal(await path.getAttribute('points'),after);
      await click(330,y+20,{button:'right'});await page.getByRole('menuitem',{name:`Delete ${tool}`,exact:true}).click();
      assert.equal(await drawings.count(),1);
    }
    for(const [text,x] of [['First note\n<keep this text>',340],['Second note',560]]){
      await page.locator('[data-tool=marker]').click();await click(x,630);await page.getByRole('textbox',{name:'Marker text'}).fill(text);await page.locator('#place-marker').click();
    }
    assert.equal(await drawings.count(),3);
    assert.equal(await drawings.nth(1).locator('text').textContent(),'1');assert.equal(await drawings.nth(2).locator('text').textContent(),'2');
    const notePosition=()=>drawings.nth(2).locator('circle').last().evaluate(el=>[el.getAttribute('cx'),el.getAttribute('cy')]);
    const beforeNote=await notePosition(),beforeNoteView=await map.getAttribute('viewBox');
    await move(560,630);await page.mouse.down();await move(600,680);await page.mouse.up();
    const afterNote=await notePosition();assert.notDeepEqual(afterNote,beforeNote);assert.equal(await map.getAttribute('viewBox'),beforeNoteView);
    await page.locator('#undo').click();assert.deepEqual(await notePosition(),beforeNote);
    await page.locator('#redo').click();assert.deepEqual(await notePosition(),afterNote);
    await move(600,680);assert.equal(await page.locator('.note-tooltip-text').innerText(),'Second note');
    await move(340,630);assert.equal(await page.locator('.note-tooltip-text').innerText(),'First note\n<keep this text>');
    await click(340,630,{button:'right'});await page.getByRole('menuitem',{name:'Edit note',exact:true}).click();
    await page.getByRole('textbox',{name:'Marker text'}).fill('Edited note');await page.locator('#place-marker').click();
    await move(340,630);assert.equal(await page.locator('.note-tooltip-text').innerText(),'Edited note');
    await page.locator('#undo').click();await move(340,630);assert.equal(await page.locator('.note-tooltip-text').innerText(),'First note\n<keep this text>');
    await page.locator('#redo').click();
    await click(340,630,{button:'right'});await page.getByRole('menuitem',{name:'Delete note',exact:true}).click();
    assert.equal(await drawings.count(),2);assert.equal(await drawings.nth(1).locator('text').textContent(),'1');
    await page.locator('#undo').click();assert.equal(await drawings.count(),3);
    // Focused annotations also expose the same context actions from the keyboard.
    await drawings.nth(1).focus();await page.keyboard.press('Shift+F10');assert.equal(await page.getByRole('menuitem',{name:'Edit note',exact:true}).isVisible(),true);await page.keyboard.press('Escape');
    await page.locator('#storage-status[data-state=saved]').waitFor({state:'attached'});await page.reload();await page.locator('#map-loading').waitFor({state:'hidden'});
    assert.equal(await drawings.count(),3);assert.equal(await stroke().getAttribute('stroke-width'),'5');assert.equal(await stroke().getAttribute('points'),edited);
    assert.deepEqual(await notePosition(),afterNote);
    await move(340,630);assert.equal(await page.locator('.note-tooltip-text').innerText(),'Edited note');
    await page.getByRole('button',{name:'Draw arrow and settings',exact:true}).click();
    await page.screenshot({path:`tmp/drawing-${url===origin?'server':'local'}.png`});
    assert.deepEqual(errors,[]);console.log(`Drawing interactions passed: ${url===origin?'server':'local file'}`);
    await context.close();
  }
}finally{await browser?.close();server.kill();}
