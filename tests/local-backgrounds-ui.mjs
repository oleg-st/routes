import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
import {combinedLayouts} from '../data/combined-layouts.js';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try{
  const origin=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.locator('#map[aria-busy="false"]').waitFor({state:'visible'});
  await page.goto(origin);await ready();
  for(const id of Object.keys(combinedLayouts)){
    await page.selectOption('#dungeon',id);await ready();
    const labels=await page.locator('[data-floor]').allTextContents();
    assert.deepEqual(labels.slice(0,3),['Full map','Full map · Retouched','Referenced']);
    const markers=await page.locator('#markers').innerHTML();
    await page.getByRole('button',{name:'Full map · Retouched',exact:true}).click();await ready();
    assert.match(await page.locator('#map-image').getAttribute('href'),/background-user\.avif$/);
    assert.equal(await page.locator('#markers').innerHTML(),markers,'Background swap must not move or alter markers');
    await page.getByRole('button',{name:'Referenced',exact:true}).click();await ready();
    assert.match(await page.locator('#map-image').getAttribute('href'),/images-referenced/);
    await page.locator('[data-floor="3"]').click();await ready();
    console.log('Local map variants loaded:',id);
  }
  await page.goto(pathToFileURL(path.resolve('local.html')).href);await ready();
  await page.selectOption('#dungeon','Level.ID.DesertDunes');await ready();
  await page.getByRole('button',{name:'Full map · Retouched',exact:true}).click();await ready();
  assert.match(await page.locator('#map-image').getAttribute('href'),/desertdunes-background-user\.avif$/);
  await page.screenshot({path:'tmp/local-retouched-map.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: all 9 variants and layers load, marker geometry unchanged, file-mode local.html works.');
}finally{await browser?.close();server.kill();}
