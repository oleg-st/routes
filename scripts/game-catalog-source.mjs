import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readDifficultyTables,selectSeasonDungeons} from './game-difficulty-source.mjs';
export const gamePlannerRoot=process.env.GAME_PLANNER_ROOT??'private/game-data/planner';
export const readJson=f=>JSON.parse(fs.readFileSync(f));
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function loadGameCatalogSource(){
 const read=n=>{
  const value=readJson(gamePlannerRoot+'/'+n+'.json');
  return n==='dungeons'&&value.playable.some(d=>Object.hasOwn(d.info,'AvailableForCasual'))?{...value,playable:selectSeasonDungeons(value,readDifficultyTables(process.env.GAME_DATA_ROOT??'private/game-data/all-dungeons'))}:value;
 };
 const manifest=read('manifest'),objects=new Map(),packages=[];
 for(const r of manifest.results.filter(r=>r.Kind!=='raw')){
  if(r.Error||r.Diagnostics?.length)throw Error('Incomplete export: '+r.Source);
  const bytes=fs.readFileSync(gamePlannerRoot+'/'+r.Output);if(sha(bytes)!==r.Sha256)throw Error('Stale export: '+r.Source);
  const pkg=JSON.parse(bytes);packages.push(pkg);
  for(const row of pkg.Objects)objects.set((pkg.Package+'.'+row.Index).toLowerCase(),{...row.Object,ref:pkg.Package+'.'+row.Index,source:pkg.Source});
 }
 const object=ref=>objects.get((typeof ref==='string'?ref:ref?.ObjectPath??'').toLowerCase());
 const cache=new Map();
 function properties(ref,seen=new Set()){
  const o=object(ref);if(!o)return{};if(cache.has(o.ref))return cache.get(o.ref);
  if(seen.has(o.ref))throw Error('Template cycle');seen.add(o.ref);
  const p=merge(properties(o.Template,seen),o.Properties??{});cache.set(o.ref,p);return p;
 }
 const strings=new Map();for(const t of read('localization'))for(const row of t.rows)strings.set(t.table+':'+row[0],row[1]);
 const text=t=>(t?.LocalizedString||t?.SourceString||t?.CultureInvariantString||strings.get(t?.TableId+':'+t?.Key)||null)?.replace(/\\+'/g,"'");
 const tables=read('tables'),npcs=read('npcs'),abilities=read('abilities');
 const curves=new Map(tables.filter(t=>t.type==='CurveTable').flatMap(t=>Object.entries(t.rows)));
 function curve(row,time=1){const c=curves.get(row);if(!c?.Keys?.length)return null;const ks=c.Keys;if(time<=ks[0].Time)return ks[0].Value;
  for(let i=1;i<ks.length;i++)if(time<=ks[i].Time){if(c.InterpMode?.endsWith('RCIM_Constant'))return ks[i-1].Value;return ks[i-1].Value+(ks[i].Value-ks[i-1].Value)*(time-ks[i-1].Time)/(ks[i].Time-ks[i-1].Time);}return ks.at(-1).Value;}
 function scalable(v){if(typeof v==='number')return v;if(v?.Value===undefined)return null;const row=v.Curve?.RowName;const factor=row&&row!=='None'?curve(row):1;return factor===null?null:v.Value*factor;}
 return{manifest,objects,packages,object,properties,text,tables,npcs,abilities,curves,curve,scalable,read};
}
function merge(a,b){if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return b;const r={...a};for(const[k,v]of Object.entries(b))r[k]=k in a?merge(a[k],v):v;return r;}
export const characterIdToEnemyId=id=>id.replaceAll('_','-').toLowerCase();
