import fs from 'node:fs';
import path from 'node:path';

export function inside(root,relative){
  const base=path.resolve(root),target=path.resolve(base,relative);
  if(target===base||!target.startsWith(base+path.sep))throw Error('Path must stay inside '+base);
  return target;
}
export function filesUnder(root,entry){
  const file=inside(root,entry);
  if(!fs.existsSync(file))return [];
  if(fs.lstatSync(file).isSymbolicLink())throw Error('Symlinks are not supported in patch backups: '+entry);
  if(fs.statSync(file).isFile())return [entry];
  return fs.readdirSync(file).flatMap(name=>filesUnder(root,path.join(entry,name)));
}
export function backupFiles(root,destination,entries){
  if(fs.existsSync(destination))throw Error('Backup already exists: '+destination);
  fs.mkdirSync(destination,{recursive:true});
  const files=entries.flatMap(entry=>filesUnder(root,entry));
  for(const file of files){
    const target=inside(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(inside(root,file),target);
  }
  const manifest={entries,files};
  fs.writeFileSync(path.join(destination,'backup.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
export function restoreFiles(root,backup){
  const {entries,files}=JSON.parse(fs.readFileSync(path.join(backup,'backup.json'))),original=new Set(files);
  for(const file of entries.flatMap(entry=>filesUnder(root,entry)))if(!original.has(file))fs.unlinkSync(inside(root,file));
  for(const file of files){const target=inside(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(inside(backup,file),target);}
}
// Fresh export directories prevent removed maps/packages from surviving in a new build.
// On failure keep the failed export for diagnosis, then restore the previous inputs.
export async function freshExtraction(root,archive,run){
  const entries=['private/game-data/all-dungeons','private/game-data/planner'];
  const backup=path.join(archive,'native-before');
  backupFiles(root,backup,['private/game-data/native-mappings.json','private/game-data/native-aggro-defaults.json','private/game-data/native-patrol-defaults.json','private/game-data/provider-files.txt']);
  const moved=[],prepared=[];
  try{
    for(const entry of entries){
      const source=inside(root,entry),target=inside(archive,'raw-before/'+entry);
      if(fs.existsSync(source)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(source,target);moved.push(entry);}
      prepared.push(entry);
      fs.mkdirSync(source,{recursive:true});
    }
    return await run();
  }catch(error){
    for(const entry of prepared){
      const source=inside(root,entry),failed=inside(archive,'failed/'+entry);
      if(fs.existsSync(source)){fs.mkdirSync(path.dirname(failed),{recursive:true});fs.renameSync(source,failed);}
      if(moved.includes(entry))fs.renameSync(inside(archive,'raw-before/'+entry),source);
    }
    restoreFiles(root,backup);
    throw error;
  }
}
