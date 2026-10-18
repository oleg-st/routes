// Reviewed spawn actions, not a scan for arbitrary NPC references. Raw Blueprint
// bodies stay private; only IDs and conservative detector bounds enter runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGameCatalogSource,gamePlannerRoot,sha} from './game-catalog-source.mjs';
import {parseCsv} from '../private/game-data/planner-export-lib.mjs';

const s=loadGameCatalogSource(),semantics=JSON.parse(fs.readFileSync('scripts/game-summon-semantics.json'));
assert.equal(s.manifest.steamBuild,semantics.steamBuild,'Review summon bytecode after a game update');
const packages=new Map(),sourceHashes={};
for(const entry of semantics.sources){
  const bytes=fs.readFileSync(entry.file);assert.equal(sha(bytes),entry.sha256,'Review changed summon Blueprint: '+entry.source);
  const pkg=JSON.parse(bytes);assert.equal(pkg.Source,entry.source);packages.set(entry.source.toLowerCase(),pkg);sourceHashes[entry.file]=entry.sha256;
}
const constants=new Map();
for(const raw of s.manifest.results.filter(r=>r.Kind==='raw'&&/\/AbilityConstants\/.*\.csv$/i.test(r.Source))){
  const file=gamePlannerRoot+'/'+raw.Output,bytes=fs.readFileSync(file);assert.equal(sha(bytes),raw.Sha256,'Stale constants: '+raw.Source);sourceHashes[file]=sha(bytes);
  for(const [key,value]of parseCsv(bytes.toString())){
    const token=value?.split(';')[0].trim();if(!token||!Number.isFinite(Number(token)))continue;
    const k=key.trim().toLowerCase();if(!constants.has(k))constants.set(k,[]);
    constants.get(k).push({value:Number(token),source:raw.Source});
  }
}
const packageOf=ref=>(typeof ref==='string'?ref:ref?.ObjectPath)?.replace(/\.[^.]+$/,'').toLowerCase();
const npcByPackage=new Map(s.npcs.map(n=>[packageOf(n.ref),n]));
const defaults=p=>p.Objects.find(o=>o.Name.startsWith('Default__'))?.Properties;
const field=(p,name)=>name.split('.').reduce((v,k)=>v?.[k],p);
function walk(v,visit){if(!v||typeof v!=='object')return;visit(v);for(const c of Object.values(v))walk(c,visit);}
const details=[];
function value(properties,name,evidence){
  const v=field(properties,name);if(typeof v==='number')return v;
  assert.ok(v&&Number.isFinite(v.Value),'Missing scalar '+name);
  if(!v.Curve?.RowName||v.Curve.RowName==='None')return v.Value;
  const candidates=constants.get(v.Curve.RowName.toLowerCase());
  if(v.RegistryType?.Name==='AbilityConstants'){
    assert.equal(candidates?.length,1,'Ambiguous/missing registry constant '+v.Curve.RowName);
    evidence.push({field:name,row:v.Curve.RowName,...candidates[0]});return v.Value*candidates[0].value;
  }
  const result=s.scalable(v);assert.ok(Number.isFinite(result),'Unresolved curve '+name);return result;
}
const rules=semantics.rules.map(spec=>{
  const ability=s.abilities.find(a=>a.blueprint===spec.ability);assert.ok(ability,spec.ability);
  const pkg=packages.get(packageOf(ability.ref));assert.ok(pkg,'Missing script '+spec.ability);
  const parent=s.npcs.find(n=>n.blueprint===spec.parent);assert.ok(parent,spec.parent);
  const ai=packages.get(packageOf(parent.properties.BehaviorComponentClass));assert.ok(ai,'Missing parent AI '+spec.parent);
  // The assignment must be in an AbilityClass slot, not a class used as a target.
  const assignments=[];walk(defaults(ai),v=>{if(packageOf(v.AbilityClass)===packageOf(ability.ref))assignments.push(v);});
  assert.ok(assignments.length,'Ability not assigned to '+spec.parent);
  if(spec.trigger==='death')assert.ok(assignments.some(a=>a.EnabledByDefault&&a.ActivationType?.endsWith('::OnDeath')),
    'Missing enabled OnDeath assignment: '+spec.ability);
  const calls=[];for(const o of pkg.Objects)walk(o.ScriptBytecode,n=>{
    if(n.Function?.ObjectName?.includes(':SpawnActorFromAbility'))calls.push(n);
  });assert.ok(calls.length,'No spawn action '+spec.ability);
  const childRefs=[];
  for(const name of spec.childFields??[]){
    assert.ok(field(ability.properties,name)!==undefined,'Missing child property '+name);
    walk(field(ability.properties,name),v=>{if(npcByPackage.has(packageOf(v)))childRefs.push(v);});
  }
  for(const name of spec.childLiterals??[]){
    const scriptPkg=spec.helper?packages.get(spec.helper.toLowerCase()):pkg;assert.ok(scriptPkg,'Missing helper');
    let found=false;
    for(const o of scriptPkg.Objects)walk(o.ScriptBytecode,n=>{
      if(!/:(?:BeginDeferredActorSpawn|SpawnActorFromAbility)'/.test(n.Function?.ObjectName??''))return;
      walk(n.Parameters,v=>{if(v.Token==='EX_ObjectConst'&&npcByPackage.get(packageOf(v.Value))?.blueprint===name){childRefs.push(v.Value);found=true;}});
    });assert.ok(found,'Child is not used by a spawn action: '+name);
  }
  for(const name of spec.spawnFields??[]){
    assert.ok(calls.some(c=>c.Parameters.some(v=>v.Token==='EX_InstanceVariable'&&v.Variable.Property?.Name===name)),name+' not passed to spawn action');
  }
  if(spec.helper)assert.ok(JSON.stringify(pkg).toLowerCase().includes(spec.helper.toLowerCase()),'Unlinked helper');
  const childGameIDs=[...new Set(childRefs.map(ref=>npcByPackage.get(packageOf(ref)).gameId))].sort((a,b)=>a-b);
  assert.ok(childGameIDs.length,'No resolved NPC children '+spec.id);
  const proof=(spec.proof??[]).map(item=>{
    const source=item.asset??pkg.Source,script=packages.get(source.toLowerCase());assert.ok(script,'Missing proof asset '+source);
    for(const fn of script.Objects)for(const node of fn.ScriptBytecode??[]){
      const text=JSON.stringify(node);if(item.terms.every(term=>text.includes(term)))return {asset:source,function:fn.Name,statement:node.StatementIndex,terms:item.terms};
    }
    throw Error('Spawn link changed: '+source+' '+item.terms.join(', '));
  });
  const evidence=[],p=ability.properties;
  const sum=names=>names.reduce((n,f)=>n+value(p,f,evidence),0);
  const rule={id:spec.id,trigger:spec.trigger,parentGameID:parent.gameId,abilityGameID:ability.gameId,childGameIDs,
    windowMs:Math.ceil((sum(spec.windowFields??[])+(spec.observationGraceSeconds??3))*1000),
    minSpawnDistance:spec.minSpawnDistance??1000};
  if(spec.radiusFields)rule.maxDistance=sum(spec.radiusFields)+(spec.positionGrace??1000);
  if(spec.maxDistance)rule.maxDistance=spec.maxDistance;
  if(spec.minCountField)rule.minCount=value(p,spec.minCountField,evidence);
  if(spec.maxCountField)rule.maxCount=value(p,spec.maxCountField,evidence);
  assert.ok(rule.windowMs>0&&(!rule.minCount||rule.maxCount>=rule.minCount));
  details.push({rule,parent:parent.name,ability:ability.source,constants:evidence,proof,notes:spec.notes});return rule;
});
const code='// Generated by scripts/prepare-game-summons.mjs. Bounds include observation grace.\n'+
  `export const gameSummonBuild=${JSON.stringify(s.manifest.steamBuild)};\nexport const gameSummonRules=Object.freeze(${JSON.stringify(rules,null,2)});\n`;
const target='data/game-summon-rules.js';
if(process.argv.includes('--check'))assert.equal(fs.readFileSync(target,'utf8'),code,'Regenerate game summon rules');
else fs.writeFileSync(target,code);
fs.mkdirSync('private/reports',{recursive:true});
fs.writeFileSync('private/reports/game-summon-rules.json',JSON.stringify({steamBuild:s.manifest.steamBuild,rules:details,sourceHashes,
  npcNames:Object.fromEntries(s.npcs.map(n=>[n.gameId,n.name])),
  excluded:[{ability:'GA_DD_NightboundMagi_ChanneledFriendlyBuff',reason:'NPC reference is a buff target; no spawn action'},
    {ability:'GA_SH_CarrionHorror_OnDeathExplosion',reason:'Current AbilityConstants spawn count is 0..0'},
    {ability:'GA_RelicPower_PolymorphTargetWithSharedCharges',reason:'Transformation, not an NPC summon'}],
  limitations:['Windows and radii include detector tolerance; first logged observation is not exact spawn time.',
    'NPCs at static placements are retained. Missing/ambiguous parents, stale coordinates and incomplete death waves are not excluded.',
    'Encounter wave difficulty/phase execution is not simulated; cast evidence is required. User-confirmed rules and generic fallbacks remain available.']},null,2)+'\n');
console.log(`${rules.length} game summon rules (${s.manifest.steamBuild})`);
