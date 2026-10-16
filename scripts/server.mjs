import {build} from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fullMaps} from '../data/full-maps.js';
const root = path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const referencedImages=new Set(Object.values(fullMaps).map(map=>'/'+map.path));
const dungeons=JSON.parse(fs.readFileSync(path.join(root,'data/dungeons.json'),'utf8'));
for(const dungeon of dungeons)for(const map of dungeon.mapImages)referencedImages.add('/'+map.path);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.avif':'image/avif','.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch {res.writeHead(400).end();return;}
  if(pathname.includes('\\')||pathname.split('/').includes('..')){res.writeHead(403).end('Forbidden');return;}
  const allowed=pathname==='/'||['/index.html','/app.js','/route-model.js','/map-geometry.js','/map-views.js','/styles.css'].includes(pathname)||/^\/log-import\/[a-z-]+\.js$/.test(pathname)&&!pathname.endsWith('/probe.js')||pathname.startsWith('/data/')||pathname.startsWith('/images/')||referencedImages.has(pathname);
  const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!allowed||!filename.startsWith(root+path.sep)){res.writeHead(403).end('Forbidden');return;}
  if(pathname==='/app.js'){
    try{const bundle=await build({absWorkingDir:root,entryPoints:['app.js'],bundle:true,format:'esm',write:false,alias:{'loro-crdt':'loro-crdt/base64'}});res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bundle.outputFiles[0].text);}catch(error){res.writeHead(500).end('Application build failed.');console.error(error);}return;
  }
  fs.stat(filename,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    if(req.method==='HEAD')res.end();else fs.createReadStream(filename).pipe(res);
  });
});
server.listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${server.address().port}`));
