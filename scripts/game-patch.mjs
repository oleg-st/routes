import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {captureGameState,compareGameStates,patchReportText,sha} from './game-patch-state.mjs';
import {backupFiles,restoreFiles,freshExtraction,inside,filesUnder} from './game-patch-files.mjs';

const root=process.cwd(),patchRoot=inside(root,'private/patches');
const [command='help',...args]=process.argv.slice(2);
const option=name=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const configFile=path.join(patchRoot,'config.json');
const localConfig=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile)):{};
const python=option('python')??process.env.PLANNER_PYTHON??localConfig.python??'python';
for(const arg of args)if(!/^--(?:baseline|python)=.+$/.test(arg))throw Error('Unknown argument: '+arg);
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
const run=(script,extra=[])=>{
  const r=spawnSync(process.execPath,[script,...extra],{cwd:root,stdio:'inherit',windowsHide:true});
  if(r.error)throw r.error;if(r.status!==0)throw Error(script+' failed ('+r.status+')');
};
const runDir=kind=>{fs.mkdirSync(patchRoot,{recursive:true});return fs.mkdtempSync(path.join(patchRoot,kind+'-'));};
function baselineDirectory(){
  const requested=option('baseline');
  if(requested)return path.resolve(requested);
  const pointer=path.join(patchRoot,'baseline.json');
  if(!fs.existsSync(pointer))throw Error('Create a pre-patch baseline first: npm run patch:baseline');
  return JSON.parse(fs.readFileSync(pointer)).directory;
}
function readBaseline(){
  const dir=baselineDirectory(),bytes=fs.readFileSync(path.join(dir,'state.json'));
  if(sha(bytes)!==fs.readFileSync(path.join(dir,'state.sha256'),'utf8').trim())throw Error('Baseline snapshot hash mismatch');
  return JSON.parse(bytes);
}
function report(before,after,dir){
  const result=compareGameStates(before,after);
  write(path.join(dir,'report.json'),result);
  fs.writeFileSync(path.join(dir,'report.txt'),patchReportText(result));
  console.log(patchReportText(result));console.log('Full report: '+path.join(dir,'report.json'));
  return result;
}
const extractionSteps=[['private/game-data/run-all-dungeons.mjs',['--planner','--python='+python]],['scripts/export-game-difficulty.mjs',[]],['scripts/export-game-summon-sources.mjs',[]]];
function extractionPreflight(){
  for(const file of ['private/game-data/run-all-dungeons.mjs','private/game-data/run-planner-export.mjs','private/game-data/extractor/Extractor.csproj','private/game-data/extractor/Program.cs'])
    if(!fs.existsSync(file))throw Error('Missing local extraction tool: '+file+'; restore tools from the baseline/tools backup');
  for(const [exe,argv]of [['dotnet',['--version']],[python,['-c','from PIL import Image; print("Pillow ready")']]]){
    const r=spawnSync(exe,argv,{encoding:'utf8',windowsHide:true});
    if(r.error||r.status!==0)throw Error('Extraction prerequisite failed: '+exe+' '+(r.error?.message??r.stderr));
    console.log(exe+': '+r.stdout.trim());
  }
}
if(command==='baseline'){
  const state=captureGameState();
  if(state.issues.length)throw Error('Cannot snapshot inconsistent sources:\n'+state.issues.join('\n'));
  const dir=runDir('baseline-'+state.build);
  write(path.join(dir,'state.json'),state);
  fs.writeFileSync(path.join(dir,'state.sha256'),sha(fs.readFileSync(path.join(dir,'state.json')))+'\n');
  backupFiles(root,path.join(dir,'published'),['data','images','scripts/game-source-registry.json','scripts/difficulty-source.json','scripts/game-service-semantics.json','scripts/game-summon-semantics.json','scripts/map-area-selection.json']);
  const sources=fs.readdirSync('private/game-data').filter(name=>/\.(?:mjs|py)$/.test(name)).map(name=>'private/game-data/'+name);
  sources.push(...filesUnder(root,'private/game-data/extractor').filter(file=>/\.(?:cs|csproj)$/.test(file)&&!/[\\/](?:obj|bin)[\\/]/.test(file)));
  backupFiles(root,path.join(dir,'tools'),sources);
  write(path.join(patchRoot,'baseline.json'),{build:state.build,directory:dir});
  console.log('Baseline saved: '+dir+'\n'+Object.keys(state.dungeons).length+' dungeons; current published data and local extraction source code backed up.');
}else if(command==='plan'){
  extractionPreflight();
  console.log('Baseline: '+baselineDirectory());readBaseline();
  console.log('Fresh extraction (old private inputs archived; restored on failure):');
  for(const [script,argv]of extractionSteps)console.log(process.execPath+' '+script+' '+argv.join(' '));
  console.log('Then compare against the baseline. Public datasets are only changed by patch:build.');
  if(option('python'))write(configFile,{...localConfig,python});
}else if(command==='extract'){
  const before=readBaseline();extractionPreflight();const dir=runDir('extract');
  write(path.join(dir,'run.json'),{status:'running',baseline:baselineDirectory(),startedAt:new Date().toISOString()});
  try{
    await freshExtraction(root,dir,async()=>{
      for(const [script,argv]of extractionSteps)run(script,argv);
      const state=captureGameState();write(path.join(dir,'candidate.json'),state);report(before,state,dir);
      if(state.issues.length)throw Error('Candidate sources are inconsistent; see report.json');
    });
    write(path.join(dir,'run.json'),{status:'extracted',baseline:baselineDirectory(),finishedAt:new Date().toISOString()});
  }catch(error){write(path.join(dir,'run.json'),{status:'failed',error:error.message,previousInputsRestored:true});throw error;}
}else if(command==='report'){
  const result=report(readBaseline(),captureGameState(),runDir('report'));
  if(result.issues.length||result.guards.length)process.exitCode=1;
}else if(command==='build'){
  const state=captureGameState(),dir=runDir('build');report(readBaseline(),state,dir);
  if(state.issues.length||state.guards.length)throw Error('Resolve source issues and reviewed-rule guards before building');
  const {fullMapBuildId}=await import(pathToFileURL(path.join(root,'data/full-maps.js')));
  if(String(fullMapBuildId)!==state.build)throw Error('Review reference map calibration for the new build before updating fullMapBuildId. See scripts/GAME-PATCHES.md');
  const {recipes}=await import('./combined-maps/index.mjs');
  for(const [id,d]of Object.entries(state.dungeons)){
    const areas=state.mapAreas.filter(o=>o.source.match(/(?:dungeons|Adventures)\/([^/]+)\//i)?.[1]===d.key);
    if(areas.length>1&&!recipes.some(r=>'Level.ID.'+r.key===id))throw Error('Author a Combined recipe for '+id+' with npm run maps:editor');
  }
  const backup=path.join(dir,'published-before');
  backupFiles(root,backup,['data','images','scripts/game-source-registry.json','scripts/difficulty-source.json','local.html']);
  try{
    run('scripts/prepare-data.mjs');run('scripts/verify-data.mjs');run('scripts/update-route-mapping.mjs',['--check']);
    run('scripts/build-local.mjs');run('scripts/build-local.mjs',['--check']);
    const tests=fs.readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f);
    const r=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit',windowsHide:true});
    if(r.error)throw r.error;if(r.status!==0)throw Error('Tests failed');
    write(path.join(dir,'run.json'),{status:'built',build:state.build});
  }catch(error){restoreFiles(root,backup);write(path.join(dir,'run.json'),{status:'failed',error:error.message,publishedFilesRestored:true});throw error;}
}else if(command==='help'){
  console.log('Before update: npm run patch:baseline\nRehearse prerequisites: npm run patch:plan\nAfter client update: npm run patch:extract -- --python=python\nRepeat comparison: npm run patch:report\nAfter reviewing rules/maps: npm run patch:build\nOptional: --baseline=private/patches/baseline-...\nWorkflow: scripts/GAME-PATCHES.md');
}else throw Error('Unknown patch command: '+command);
