import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {correctDungeon} from '../data/placement-corrections.js';
import {mapViews,mapCoordinates} from '../map-views.js';
import {enemyMarkerRadius,enemyMarkerScale} from '../data/enemy-marker-sizes.js';

const root=process.cwd(),dungeon=correctDungeon(JSON.parse(fs.readFileSync('data/dungeons.json')).find(d=>d.id==='Level.ID.SandTomb'));
const view=mapViews(dungeon)[0],boss=dungeon.enemies.find(p=>p.id==='st-bossarbiter');
const hearts=dungeon.enemies.filter(p=>p.id==='st-bigbloodelemental').sort((a,b)=>mapCoordinates(a,view)[1]-mapCoordinates(b,view)[1]);
const members=[boss,hearts[0],hearts.at(-1)],catalog=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const fixture={dungeonID:dungeon.id,dungeonData:'custom',title:dungeon.name,fightID:1,reportCode:'example',duration:100,
  groups:Object.fromEntries(members.map((p,i)=>[String(i),{label:`G${i}`,enemies:[p.placementId],excluded:[],empowered:[]} ])),
  variants:[1,2].map(i=>({pulls:[{id:'boss-pull',start:0,end:100,groups:['0',String(i)]}]})),
  drawings:[],inferredPlacements:[],shadow:false,empowered:false,replacement:{ghorn:{active:false},witch:{active:false}},
};
const bundle=await build({entryPoints:['app.js'],bundle:true,format:'esm',write:false,alias:{'loro-crdt':'loro-crdt/base64'},plugins:[{
  name:'offline-import',setup(b){b.onLoad({filter:/[/\\]app\.js$/},args=>({
    contents:fs.readFileSync(args.path,'utf8').replace('live:createLiveImport({data,dungeonData:()=>dungeonDataMode,persist,callback:logCallback})',
      `live:{connected:()=>true,resume:async()=>null,load:async()=>(${JSON.stringify(fixture)})}`),resolveDir:root,loader:'js',
  }));},
}]});
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle.outputFiles[0].text);return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.avif':'image/avif','.jpg':'image/jpeg'}[path.extname(file)]??'application/octet-stream'}).end(bytes);
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const viewport of [{width:1440,height:1050},{width:1000,height:800}])for(const size of [6,12]){
    const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#map-loading').waitFor({state:'hidden'});
    await page.locator('#marker-size').evaluate((input,size)=>{input.value=size;input.dispatchEvent(new Event('input'));},size);
    await page.locator('#import-log-button').click();
    await page.locator('#log-url').fill('https://www.fellowshiplogs.com/reports/KDvzJny1w6YW8BaH?fight=1');
    await page.locator('#log-load').click();await page.locator('[data-log-choice]').first().waitFor();
    const metrics=async()=>page.locator('#map').evaluate((map,ids)=>{
      const bounds=map.getBoundingClientRect(),box=map.viewBox.baseVal;
      return {width:bounds.width,height:bounds.height,scale:map.getScreenCTM().a,aspect:box.width/box.height,
        circles:ids.map(id=>{const r=map.querySelector(`[data-placement="${id}"] .mob-ring`).getBoundingClientRect();
          return {radius:r.width/2,left:r.left-bounds.left,right:bounds.right-r.right,top:r.top-bounds.top,bottom:bounds.bottom-r.bottom};})};
    },members.map(p=>p.placementId));
    const checkScale=m=>{
      const zoom=m.scale/Math.min(m.width/view.width,m.height/view.height);
      members.forEach((p,i)=>assert.ok(Math.abs(m.circles[i].radius-enemyMarkerRadius(size,zoom,true)*enemyMarkerScale(catalog.get(p.id)))<.1,
        `${p.id} follows actual SVG zoom at ${viewport.width}px, marker size ${size}`));
    };
    const fitted=await metrics();checkScale(fitted);
    assert.ok(fitted.aspect<fitted.width/fitted.height,'reproduce the height-limited auto-fit frame');
    for(const circle of fitted.circles)for(const side of ['left','right','top','bottom'])assert.ok(circle[side]>=12,`${side}: full portrait stays within the map`);
    if(viewport.width===1440&&size===6)await page.screenshot({path:'tmp/log-import-boss-framing.png'});
    const bounds=await page.locator('#map').boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,-100);
    await page.waitForFunction(previous=>document.querySelector('#map').getScreenCTM().a>previous,fitted.scale);
    checkScale(await metrics());
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Import framing: distant boss choices fit whole portraits and use the same actual zoom as the mouse wheel.');
}finally{await browser?.close();server.close();}
