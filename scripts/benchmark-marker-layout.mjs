// Run with node scripts/benchmark-marker-layout.mjs [module path] [output.json].
// Measures the solver in Chromium, without mixing SVG rendering into its time.
import fs from 'node:fs';
import {chromium} from 'playwright';
import {mapViews,mapCoordinates,onMap} from '../map-views.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {enemyMarkerScale,enemyMarkerRadius} from '../data/enemy-marker-sizes.js';

const source=fs.readFileSync(process.argv[2]||'map-geometry.js','utf8');
const enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const cases=[];
for(const dungeon of JSON.parse(fs.readFileSync('data/dungeons.json')).map(correctDungeon)){
  const map=mapViews(dungeon)[0];
  for(const zoom of [.4,1,3,12,24]){
    const unit=Math.max(map.width/1150,map.height/930)/zoom;
    const markers=dungeon.enemies.filter(p=>onMap(p,map)).map(p=>{
      const radius=enemyMarkerRadius(6,zoom)*enemyMarkerScale(enemies.get(p.id));
      return {id:p.placementId,point:mapCoordinates(p,map).map(v=>v/unit),radius,maxDisplacement:Math.max(40,radius*2)};
    });
    cases.push({name:`${dungeon.name} @ ${zoom}x`,kind:'map',markers});
  }
}
for(const count of [300,1000,3000])for(const dense of [false,true]){
  const columns=Math.ceil(Math.sqrt(count)),spacing=dense?1:16;
  cases.push({name:`${count} ${dense?'dense':'spread'}`,kind:'synthetic',markers:Array.from({length:count},(_,i)=>({
    id:`mob-${String(i).padStart(5,'0')}`,point:[i%columns*spacing,Math.floor(i/columns)*spacing],radius:[7,10,13][i%3],maxDisplacement:40,
  }))});
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  const rows=await page.evaluate(async({source,cases})=>{
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const {separateMarkerCenters}=await import(url);URL.revokeObjectURL(url);
    for(let i=0;i<5;i++)separateMarkerCenters(cases[0].markers,0,.25,{tolerance:.02});
    const rows=[];
    for(const {name,kind,markers} of cases){
      const times=[];let centers;
      for(let i=0;i<5;i++){
        const start=performance.now();centers=separateMarkerCenters(markers,0,.25,{tolerance:.02});times.push(performance.now()-start);
      }
      times.sort((a,b)=>a-b);
      let violations=0,maxExcess=0,maxShift=0;
      for(let i=0;i<markers.length;i++){
        const a=markers[i],p=centers.get(a.id);maxShift=Math.max(maxShift,Math.hypot(p[0]-a.point[0],p[1]-a.point[1]));
        for(let j=i+1;j<markers.length;j++){
          const b=markers[j],q=centers.get(b.id),excess=a.radius+b.radius-.5*Math.min(a.radius,b.radius)-Math.hypot(p[0]-q[0],p[1]-q[1]);
          if(excess>.1){violations++;maxExcess=Math.max(maxExcess,excess);}
        }
      }
      rows.push({name,kind,count:markers.length,medianMs:+times[2].toFixed(2),maxMs:+times.at(-1).toFixed(2),violations,maxExcess:+maxExcess.toFixed(2),maxShift:+maxShift.toFixed(2)});
    }
    return rows;
  },{source,cases});
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(rows,null,2)+'\n');
  console.log(JSON.stringify({realCases:rows.filter(r=>r.kind==='map').length,worstMaps:rows.filter(r=>r.kind==='map').sort((a,b)=>b.medianMs-a.medianMs).slice(0,5),synthetic:rows.filter(r=>r.kind==='synthetic')},null,2));
}finally{await browser.close();}
