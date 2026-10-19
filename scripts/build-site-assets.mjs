import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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
  // Keep the library and its binary independent of application/data changes.
  // Await initialization here so every importer can immediately create a LoroDoc.
  const loroEntry=fileURLToPath(import.meta.resolve('loro-crdt/web'));
  const wasmURL=emit('loro.wasm',fs.readFileSync(path.join(path.dirname(loroEntry),'loro_wasm_bg.wasm')));
  const loro=await build({...options,stdin:{
    contents:`import init from 'loro-crdt/web';\nexport * from 'loro-crdt/web';\nawait init({module_or_path:new URL(${JSON.stringify('./'+path.basename(wasmURL))},import.meta.url)});`,
    resolveDir:path.dirname(loroEntry),sourcefile:'loro-entry.js',loader:'js',
  }});
  const loroURL=emit('loro.js',loro.outputFiles[0].contents);
  // Bundle the worker too: versioning only its entry would leave imported modules cached.
  const worker=await build({...options,entryPoints:['log-import/matcher-worker.js']});
  const workerURL=emit('matcher-worker.js',worker.outputFiles[0].contents);
  const app=await build({...options,entryPoints:['app.js'],plugins:[{
    name:'external-loro',setup(builder){
      builder.onResolve({filter:/^loro-crdt$/},()=>({path:'./'+path.basename(loroURL),external:true}));
    },
  }],define:{
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
  fs.writeFileSync(path.join(destination,'app.js'),`import ${JSON.stringify('./'+appURL)};\n`);
  return {appURL,cssURL,workerURL,dataURLs,loroURL,wasmURL};
}
