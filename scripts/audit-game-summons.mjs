// Discovery report, not automatic summon classification. Spawned actors include
// projectiles, hazards, effects and transformations as well as NPCs.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {loadGameCatalogSource,gamePlannerRoot,sha} from './game-catalog-source.mjs';

const s=loadGameCatalogSource(),root='private/game-data/all-dungeons';
const packageOf=r=>(typeof r==='string'?r:r?.ObjectPath)?.replace(/\.[^.]+$/,'').toLowerCase();
const walk=(v,fn)=>{if(!v||typeof v!=='object')return;fn(v);for(const c of Object.values(v))walk(c,fn);};
const packages=new Map(s.packages.map(p=>[p.Package.toLowerCase(),p]));
const queue=[...s.npcs.map(n=>packageOf(n.ref)),...s.abilities.filter(a=>/\/NPC\//i.test(a.ref)).map(a=>packageOf(a.ref))],seen=new Set();
while(queue.length){
  const key=queue.pop();if(seen.has(key))continue;seen.add(key);const pkg=packages.get(key);if(!pkg)continue;
  walk(pkg.Objects,v=>{if(v.ObjectPath){const dep=packageOf(v);if(packages.has(dep))queue.push(dep);}});
}
const candidates=[...seen].map(k=>packages.get(k)).filter(p=>p?.Inventory.some(o=>o.Type==='BlueprintGeneratedClass')).sort((a,b)=>a.Source.localeCompare(b.Source));
const list=root+'/summon-discovery-assets.txt',status=list+'.status.json';
if(process.argv.includes('--export')){
  // Physical source paths also work for plugin-mounted packages such as /ForestMeadow/.
  fs.writeFileSync(list,candidates.map(p=>p.Source).join('\n')+'\n');
  const run=spawnSync('dotnet',['private/game-data/extractor/bin/Debug/net10.0/Extractor.dll','--assets',list,'--scripts'],{stdio:'inherit',windowsHide:true});
  if(run.error)throw run.error;if(run.status!==0)throw Error('Summon discovery export failed');
}
if(!fs.existsSync(status))throw Error('Run node scripts/audit-game-summons.mjs --export first');
const results=new Map(JSON.parse(fs.readFileSync(status)).map(r=>[r.Source.toLowerCase(),r]));
const errors=[],spawnPackages=[],hashes={},files={};
for(const pkg of candidates){
  const r=results.get(pkg.Source.toLowerCase());
  if(!r?.Output||r.Error||r.Diagnostics?.length){errors.push({source:pkg.Source,error:r?.Error??r?.Diagnostics??'Not exported'});continue;}
  const bytes=fs.readFileSync(root+'/behavior-scripts/'+r.Output),body=JSON.parse(bytes),calls=[],npcReferences=new Set();
  hashes[pkg.Package]=sha(bytes);
  files[pkg.Package]=root+'/behavior-scripts/'+r.Output;
  walk(body,v=>{
    if(v.Function?.ObjectName&&/:(?:SpawnActorFromAbility|SpawnActorAt|BeginDeferredActorSpawn|SpawnAIFromClass)'/.test(v.Function.ObjectName)){
      const classes=new Set(),variables=new Set();
      walk(v.Parameters,n=>{
        if(n.Token==='EX_ObjectConst'&&n.Value?.ObjectPath)classes.add(n.Value.ObjectPath);
        if(n.Token==='EX_InstanceVariable')variables.add(n.Variable?.Property?.Name);
      });
      calls.push({function:v.Function.ObjectName,classes:[...classes],variables:[...variables]});
    }
    if(v.ObjectPath&&/\/BP_NPC_/i.test(v.ObjectPath))npcReferences.add(v.ObjectPath);
  });
  if(calls.length)spawnPackages.push({source:pkg.Source,package:pkg.Package,sha256:hashes[pkg.Package],calls,npcReferences:[...npcReferences]});
}
const report={steamBuild:s.manifest.steamBuild,catalogManifestSha256:sha(fs.readFileSync(gamePlannerRoot+'/manifest.json')),blueprints:candidates.length,exported:Object.keys(hashes).length,errors,hashes,files,spawnPackages,
  limitations:['Discovery follows references available in the planner export; native spawn code and missing dynamic references require separate review.',
    'NPC references can be owners, casts or targets. Each rule needs an assigned parent ability and an actual spawn-class link.',
    'A cast rule does not prove the ability is enabled in every AI phase or difficulty.']};
fs.mkdirSync('private/reports',{recursive:true});fs.writeFileSync('private/reports/summon-discovery.json',JSON.stringify(report,null,2)+'\n');
console.log(`${report.exported}/${report.blueprints} Blueprints, ${spawnPackages.length} spawn candidates, ${errors.length} export errors. See private/reports/summon-discovery.json.`);
if(errors.length)process.exitCode=1;
