import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {draftRecipe,validateDraft} from './map-editor/model.mjs';
import {inside} from './game-patch-files.mjs';
import {loadEditorCatalog} from './map-editor/catalog.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const data=loadEditorCatalog(root),draftRoot=inside(root,process.env.MAP_EDITOR_DRAFT_ROOT??'private/combined-map-drafts');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.avif':'image/avif'};
const server=http.createServer(async(req,res)=>{
  const respond=(code,value,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(value):value);};
  try{
    const url=new URL(req.url,'http://127.0.0.1'),origin=req.headers.origin;
    if(req.headers.host!==`127.0.0.1:${server.address().port}`&&req.headers.host!==`localhost:${server.address().port}`)return respond(403,{error:'Invalid host'});
    if(origin&&origin!==`http://${req.headers.host}`)return respond(403,{error:'Invalid origin'});
    if(req.method==='GET'&&url.pathname==='/api/catalog')return respond(200,data);
    if(url.pathname==='/api/draft'){
      const d=data.dungeons.find(d=>d.id===url.searchParams.get('dungeon'));if(!d)return respond(404,{error:'Unknown dungeon'});
      const file=inside(draftRoot,d.id.replace(/^Level\.ID\./,'')+'.json');
      if(req.method==='GET'){
        const saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
        return respond(200,saved&&String(saved.sourceBuild)===String(data.build)?saved:null);
      }
      if(req.method==='POST'){
        if(req.headers['content-type']!=='application/json')return respond(415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>1024*1024)return respond(413,{error:'Draft too large'});}
        const draft=validateDraft(JSON.parse(body),d);fs.mkdirSync(draftRoot,{recursive:true});
        // Store only the reviewed recipe fields, excluding any client-supplied paths.
        const recipe=draftRecipe(draft,d),clean={schemaVersion:1,sourceBuild:String(data.build),dungeonId:d.id,key:recipe.key,slug:recipe.slug,version:recipe.version,layers:recipe.layers.map(({context,...l})=>l)};
        fs.writeFileSync(file,JSON.stringify(clean,null,2)+'\n');
        fs.writeFileSync(file.replace(/\.json$/,'.mjs'),'export default '+JSON.stringify(recipe,null,2)+';\n');
        return respond(200,{saved:path.relative(root,file).replaceAll('\\','/')});
      }
    }
    if(req.method!=='GET')return respond(405,{error:'Method not allowed'});
    let file;
    if(url.pathname==='/api/image'){
      const d=data.dungeons.find(d=>d.id===url.searchParams.get('dungeon')),m=d?.mapImages.find(m=>m.id===url.searchParams.get('map'));
      if(!m)return respond(404,{error:'Unknown map'});file=inside(root,m.path);
    }else{
      const files={'/':'index.html','/editor.mjs':'editor.mjs','/model.mjs':'model.mjs','/style.css':'style.css'};
      if(!files[url.pathname])return respond(404,{error:'Not found'});file=path.join(root,'scripts/map-editor',files[url.pathname]);
    }
    respond(200,fs.readFileSync(file),types[path.extname(file)]??'application/octet-stream');
  }catch(error){respond(400,{error:error.message});}
});
server.listen(Number(process.env.PORT??4180),'127.0.0.1',()=>console.log('Map editor: http://127.0.0.1:'+server.address().port));
