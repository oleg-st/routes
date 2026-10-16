import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {dataNames} from '../data/runtime-loader.js';

// Publish immutable URLs after data compaction. Hash the worker before the app
// so a change anywhere in the worker's module graph also changes the app URL.
export async function buildSiteAssets(destination){
  const emit=(name,contents)=>{
    const extension=path.extname(name);
    const hash=createHash('sha256').update(contents).digest('hex').slice(0,16);
    const url=`assets/${path.basename(name,extension)}.${hash}${extension}`;
    fs.writeFileSync(path.join(destination,url),contents);
    return url;
  };
  fs.mkdirSync(path.join(destination,'assets'),{recursive:true});
  const dataURLs=Object.fromEntries(dataNames.map(name=>[
    name,emit(`${name}.json`,fs.readFileSync(path.join(destination,`data/${name}.json`))),
  ]));
  const options={absWorkingDir:destination,bundle:true,format:'esm',write:false,minify:true,target:['es2022']};
  // Bundle the worker too: versioning only its entry would leave imported modules cached.
  const worker=await build({...options,entryPoints:['log-import/matcher-worker.js']});
  const workerURL=emit('matcher-worker.js',worker.outputFiles[0].contents);
  const app=await build({...options,entryPoints:['app.js'],alias:{'loro-crdt':'loro-crdt/base64'},define:{
    __SITE_DATA_URLS__:JSON.stringify(dataURLs),
    __SITE_MATCHER_URL__:JSON.stringify(workerURL),
  }});
  const appURL=emit('app.js',app.outputFiles[0].contents);
  const cssURL=emit('styles.css',fs.readFileSync(path.join(destination,'styles.css')));
  const htmlPath=path.join(destination,'index.html');
  const html=fs.readFileSync(htmlPath,'utf8');
  if(!html.includes('src="app.js"')||!html.includes('href="styles.css"'))throw new Error('Missing site asset references in index.html.');
  fs.writeFileSync(htmlPath,html.replace('src="app.js"',`src="${appURL}"`).replace('href="styles.css"',`href="${cssURL}"`));
  // Keep the old entry usable for HTML cached before hashed URLs were introduced.
  fs.writeFileSync(path.join(destination,'app.js'),app.outputFiles[0].contents);
  return {appURL,cssURL,workerURL,dataURLs};
}
