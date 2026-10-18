// Reproducible SVG composition from extracted game artwork plus documented local repairs. Recipes may
// opt into Full map's coordinate frame; its background image is never read.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {recipes} from './combined-maps/index.mjs';
import {fullMaps} from '../data/full-maps.js';
import {mapCoordinates} from '../map-views.js';
import {warpedArtwork} from './combined-maps/art-warp.mjs';
import {originalFor, compressImages, hashFile, combinedRasterSize} from './avif-assets.mjs';
const read=name=>JSON.parse(fs.readFileSync(`data/${name}.json`,'utf8'));
const dungeons=read('dungeons'),buildId=read('manifest').buildId;
const args=process.argv.slice(2),requested=args.find(a=>!a.startsWith('--'));
if(args.some(a=>a.startsWith('--')&&a!=='--guides')||args.filter(a=>!a.startsWith('--')).length>1)throw new Error('Usage: npm run maps -- [map-slug] [--guides]');
if(requested&&!recipes.some(r=>r.slug===requested||r.key===requested))throw new Error(`Unknown map ${requested}. Choose: ${recipes.map(r=>r.slug).join(', ')}`);
const selected=recipes.filter(r=>!requested||r.slug===requested||r.key===requested);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const n=value=>Number(value.toFixed(4));
fs.mkdirSync('images/dungeons/combined',{recursive:true});
fs.mkdirSync('private/images-combined',{recursive:true});
let result={};
if(requested){
  const previous=await import('../data/combined-layouts.js');
  if(previous.combinedBuildId!==buildId)throw new Error('Data build changed; rebuild all maps first.');
  result={...previous.combinedLayouts};
}
for(const config of selected){
  const key=config.key,d=dungeons.find(d=>d.id===`Level.ID.${key}`);
  if(!d)throw new Error(`Unknown dungeon recipe: ${key}`);
  const reference=config.referenceFrame==='Full'?fullMaps[d.id]:null;
  if(config.referenceFrame&&!reference)throw new Error(`Missing Full coordinate reference: ${key}`);
  if(!config||config.layers.length!==d.mapImages.length)throw new Error(`Missing authoring: ${key}`);
  const parts=[],extent=[],transitions=[];
  for(const [index,layer] of config.layers.entries()){
    const map=d.mapImages.find(m=>m.id===`${d.id}:${layer.suffix}`);
    if(!map)throw new Error(`Unknown source: ${layer.suffix}`);
    let scale=layer.scale;
    let [x,y]=layer.at||[0,0];
    if(reference){
      const t=reference.sources[map.id],c=t?.calibration;
      if(!c){
        const fallback=layer.coordinateTransform;
        if(!fallback||!(fallback.scale>0)||!Number.isFinite(fallback.x)||!Number.isFinite(fallback.y))throw new Error(`Missing coordinate reference for ${map.id}`);
        scale=fallback.scale/2;x=fallback.x/2;y=fallback.y/2;
      }else{
      const sx=c.sx/1024*t.factor,sy=-c.sy/512*t.factor;
      if(Math.abs(sx-sy)>1e-6||sx<=0)throw new Error(`Unsupported nonuniform source reference: ${map.id}`);
      scale=sx/2;x=((c.ox-t.left)*t.factor+t.x)/2;y=(reference.height-((c.oy-t.bottom)*t.factor+t.y))/2;
      }
    }else if(layer.join){
      const [other,ax,ay,bx,by]=layer.join,previous=parts[other];
      if(!previous)throw new Error(`Invalid join in ${key}`);
      const from=[previous.x+ax*previous.scale,previous.y+ay*previous.scale];
      x=from[0]-bx*layer.scale+(layer.offset?.[0]||0);y=from[1]-by*layer.scale+(layer.offset?.[1]||0);
      if(layer.transition)transitions.push({from,to:[x+bx*layer.scale,y+by*layer.scale]});
    }
    const width=1024*scale,height=512*scale;
    // Include every supplied enemy and patrol point, even where the game's
    // drawn terrain and coordinate metadata disagree slightly.
    const points=d.enemies.flatMap(p=>[p,...(p.mapPatrolPath||[])])
      .filter(p=>p.mapImageId===map.id&&p.mapPosition).map(p=>[p.mapPosition.x*1024,p.mapPosition.y*512]);
    const outline=layer.outline;
    for(const [px,py] of [...outline,...points])extent.push([x+px*scale,y+py*scale]);
    const original=originalFor(map.path),bytes=fs.readFileSync(original);
    if(hash(bytes)!==(map.sourceSha256||map.sha256))throw new Error(`Source image hash differs: ${original}`);
    parts.push({map,x,y,width,height,scale,outline,points,bytes,index,layer});
  }
  const padding=64,minX=reference?0:Math.min(...extent.map(p=>p[0]))-padding,minY=reference?0:Math.min(...extent.map(p=>p[1]))-padding;
  const width=reference?.width||Math.ceil((Math.max(...extent.map(p=>p[0]))-minX+padding)*2);
  const height=reference?.height||Math.ceil((Math.max(...extent.map(p=>p[1]))-minY+padding)*2);
  const sources={},artworkSources={};
  const defs=[`<linearGradient id="trim-edges" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="black"/><stop offset=".025" stop-color="black"/><stop offset=".045" stop-color="white"/><stop offset=".955" stop-color="white"/><stop offset=".975" stop-color="black"/><stop offset="1" stop-color="black"/></linearGradient><mask id="trim" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="url(#trim-edges)"/></mask><linearGradient id="context-edge-y" x1="0" y1="0" x2="0" y2="1"><stop offset=".03" stop-color="black"/><stop offset=".12" stop-color="white"/><stop offset=".83" stop-color="white"/><stop offset=".91" stop-color="black"/></linearGradient><linearGradient id="context-edge-x"><stop offset="0" stop-color="black"/><stop offset=".08" stop-color="white"/><stop offset=".92" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient><mask id="context-trim-x" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="url(#context-edge-x)"/></mask><mask id="context-trim" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="url(#context-edge-y)" mask="url(#context-trim-x)"/></mask>`],images=[],surroundings=[];
  for(const part of parts){
    const {map,x,y,outline,points,index,scale,layer}=part;
    const transform={x:n((x-minX)*2),y:n((y-minY)*2),width:n(part.width*2),height:n(part.height*2),path:map.path,sha256:map.sha256,sourceSha256:map.sourceSha256||map.sha256};
    sources[map.id]=transform;
    const artTransform=layer.artworkTransform;
    if(artTransform&&(!reference||!Number.isFinite(artTransform.x)||!Number.isFinite(artTransform.y)||!(artTransform.scale>0)))throw new Error(`Invalid artwork transform: ${map.id}`);
    const artScale=artTransform?.scale??scale*2;
    artworkSources[map.id]=artTransform?{...transform,x:artTransform.x,y:artTransform.y,width:artScale*1024,height:artScale*512}:transform;
    // Feather a contour, not a rectangular tile. Preserve full opacity over
    // playable areas; only the outer 12 reference pixels blend into parchment.
    const polygon=(layer.terrainOutline||outline).map(p=>p.join(',')).join(' ');
    const context={expand:250,feather:34,...layer.context};
    // Per-map edge fades can retain original landscape closer to the border,
    // without changing the terrain masks or exposing the source frame.
    let contextTrim='context-trim';
    if(context.edgeFade){
      const {x:xs,y:ys}=context.edgeFade;
      const gradient=(id,stops,vertical)=>`<linearGradient id="${id}" x1="0" y1="0" x2="${vertical?0:1}" y2="${vertical?1:0}">${stops.map((offset,i)=>`<stop offset="${offset}" stop-color="${i===0||i===3?'black':'white'}"/>`).join('')}</linearGradient>`;
      contextTrim=`context-trim-${index}`;
      defs.push(`${gradient(`edge-x-${index}`,xs,false)}${gradient(`edge-y-${index}`,ys,true)}<mask id="${contextTrim}-x" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="url(#edge-x-${index})"/></mask><mask id="${contextTrim}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="url(#edge-y-${index})" mask="url(#${contextTrim}-x)"/></mask>`);
    }
    const contextPolygon=(context.outline||outline).map(p=>p.join(',')).join(' ');
    const contextExcludeFilter=`context-exclude-blur-${index}`;
    defs.push(`<filter id="${contextExcludeFilter}" x="-50%" y="-50%" width="200%" height="200%">${context.excludeExpand?`<feMorphology operator="dilate" radius="${context.excludeExpand}"/>`:''}<feGaussianBlur stdDeviation="${context.excludeFeather??5}"/></filter>`);
    // Surroundings are painted first, under every playable layer. Expanding
    // the source contour reveals the original dunes/forest/cliffs without
    // letting a later background cover another layer's playable geometry.
    defs.push(`<image id="source-${index}" width="1024" height="512" preserveAspectRatio="none" xlink:href="data:${part.bytes[0]===137?'image/png':'image/webp'};base64,${part.bytes.toString('base64')}"/><filter id="context-blur-${index}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${context.feather}"/></filter><mask id="context-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><polygon points="${contextPolygon}" fill="white" stroke="white" stroke-width="${context.expand}" stroke-linejoin="round" filter="url(#context-blur-${index})"/>${(context.exclude||[]).map(p=>`<polygon points="${p.map(p=>p.join(',')).join(' ')}" fill="black" filter="url(#${contextExcludeFilter})"/>`).join('')}</mask>`);
    defs.push(`<mask id="terrain-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><g fill="white" stroke="white" stroke-width="18" stroke-linejoin="round" filter="url(#feather)"><polygon points="${polygon}"/>${points.map(([px,py])=>`<circle cx="${n(px)}" cy="${n(py)}" r="12"/>`).join('')}</g></mask>`);
    // Local text repairs stay in source coordinates so every existing mask and
    // artwork transform applies identically; native source assets stay intact.
    if(layer.artworkRepairs?.length){
      if(layer.artWarp)throw new Error(`Repair plus warp is unsupported: ${map.id}`);
      const patches=layer.artworkRepairs.map(({path,sha256,region})=>{
        if(!/^private\/images-combined\/patches\/[a-z0-9-]+\.png$/.test(path)||region?.length!==4||!region.every(Number.isFinite)||region[0]<0||region[1]<0||region[2]<=0||region[3]<=0||region[0]+region[2]>1024||region[1]+region[3]>512)throw new Error(`Invalid artwork repair: ${map.id}`);
        const bytes=fs.readFileSync(path);
        if(hash(bytes)!==sha256)throw new Error(`Artwork repair hash differs: ${path}`);
        const [x,y,w,h]=region;
        return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${bytes.toString('base64')}"/>`;
      }).join('');
      defs.push(`<g id="repaired-source-${index}"><use xlink:href="#source-${index}"/>${patches}</g>`);
    }
    const artPosition=artworkSources[map.id];
    const placement=`translate(${artPosition.x} ${artPosition.y}) scale(${n(artScale)})`;
    if(layer.artWarp)defs.push(warpedArtwork(index,layer.artWarp));
    const art=layer.artWarp?`art-${index}`:layer.artworkRepairs?.length?`repaired-source-${index}`:`source-${index}`;
    const exclusions=layer.exclude||[];
    if(exclusions.length)defs.push(`<filter id="seam-blur-${index}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${layer.seamFeather??5}"/></filter><mask id="seam-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="white"/>${exclusions.map(p=>`<polygon points="${p.map(p=>p.join(',')).join(' ')}" fill="black" filter="url(#seam-blur-${index})"/>`).join('')}</mask>`);
    const seam=exclusions.length?` mask="url(#seam-${index})"`:'';
    if(exclusions.length&&layer.contextSeamFeather!==undefined)defs.push(`<filter id="context-seam-blur-${index}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${layer.contextSeamFeather}"/></filter><mask id="context-seam-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><rect width="1024" height="512" fill="white"/>${exclusions.map(p=>`<polygon points="${p.map(p=>p.join(',')).join(' ')}" fill="black" filter="url(#context-seam-blur-${index})"/>`).join('')}</mask>`);
    const contextSeam=exclusions.length&&layer.contextSeamFeather!==undefined?` mask="url(#context-seam-${index})"`:seam;
    surroundings.push(`<g transform="${placement}"><g${contextSeam}><g mask="url(#${contextTrim})"><use xlink:href="#${art}" mask="url(#context-${index})"/></g></g></g>`);
    images.push(`<g transform="${placement}"><g${seam}><g mask="url(#trim)"><use xlink:href="#${art}" mask="url(#terrain-${index})"/></g></g></g>`);
  }
  const paths=transitions.map(({from,to})=>{
    const a=from.map((v,i)=>(v-[minX,minY][i])*2),b=to.map((v,i)=>(v-[minX,minY][i])*2);
    return `<path d="M ${a.join(' ')} Q ${(a[0]+b[0])/2} ${Math.min(a[1],b[1])-80} ${b.join(' ')}" fill="none" stroke="#685f48" stroke-width="5" stroke-dasharray="12 12"/>`;
  }).join('');
  // Nine-slice the decorative border from an original image, rather than
  // borrowing Method's frame. The center is deliberately not copied.
  const slice=(sx,sy,sw,sh,x,y,w,h)=>`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sx} ${sy} ${sw} ${sh}" preserveAspectRatio="none" overflow="hidden"><use xlink:href="#source-0"/></svg>`;
  const corner=config.frame?.corner??52,edge=config.frame?.edge??20;
  let frame=[slice(0,0,36,36,0,0,corner,corner),slice(988,0,36,36,width-corner,0,corner,corner),slice(0,476,36,36,0,height-corner,corner,corner),slice(988,476,36,36,width-corner,height-corner,corner,corner),slice(36,0,952,12,corner,0,width-corner*2,edge),slice(36,500,952,12,corner,height-edge,width-corner*2,edge),slice(0,36,12,440,0,corner,edge,height-corner*2),slice(1012,36,12,440,width-edge,corner,edge,height-corner*2)].join('');
  if(config.frame?.featherCorners){
    // The complete flourish extends past the old 36px square. Blend its inner
    // diagonal, keep the frame strips opaque, and mirror the clean top-left
    // original so bottom corners cannot pick up fragments of the source title.
    defs.push('<linearGradient id="frame-fade-x"><stop offset=".72" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><linearGradient id="frame-fade-y" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><mask id="frame-horizontal" maskUnits="userSpaceOnUse" style="mask-type:alpha" x="0" y="0" width="1024" height="512"><rect width="1024" height="12" fill="url(#frame-fade-y)"/></mask><mask id="frame-vertical" maskUnits="userSpaceOnUse" style="mask-type:alpha" x="0" y="0" width="1024" height="512"><rect width="12" height="512" fill="url(#frame-fade-x)"/></mask><filter id="corner-soft"><feGaussianBlur stdDeviation="3"/></filter><mask id="corner-mask" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><polygon points="0,0 60,0 0,60" fill="white" filter="url(#corner-soft)"/><rect width="64" height="12" fill="url(#frame-fade-y)"/><rect width="12" height="64" fill="url(#frame-fade-x)"/></mask>');
    const ornament=`<svg width="${corner}" height="${corner}" viewBox="0 0 64 64" overflow="hidden"><use xlink:href="#source-0" mask="url(#corner-mask)"/></svg>`;
    const top=slice(63,0,2,12,corner,0,width-corner*2,edge).replace('xlink:href="#source-0"','xlink:href="#source-0" mask="url(#frame-horizontal)"');
    const left=slice(0,63,12,2,0,corner,edge,height-corner*2).replace('xlink:href="#source-0"','xlink:href="#source-0" mask="url(#frame-vertical)"');
    frame=[top,`<g transform="translate(0 ${height}) scale(1 -1)">${top}</g>`,left,`<g transform="translate(${width} 0) scale(-1 1)">${left}</g>`,ornament,`<g transform="translate(${width} 0) scale(-1 1)">${ornament}</g>`,`<g transform="translate(0 ${height}) scale(1 -1)">${ornament}</g>`,`<g transform="translate(${width} ${height}) scale(-1 -1)">${ornament}</g>`].join('');
  }
  // Decorative patches and restored labels are authored separately from route
  // geometry. A label restore copies its original pixels at the same transform.
  const decorate=(items,prefix)=>items.map(({source=0,crop,at,size,feather=12,shape='rect',ink=false,inkThreshold=5.7,soften,maskPolygon,wideFeather=false},i)=>{
    const [x,y]=at,[w,h]=size,id=`${prefix}-${i}`;
    const shapeMarkup=maskPolygon?`<polygon points="${maskPolygon.map(([px,py])=>[x+px*w,y+py*h].join(',')).join(' ')}"`:shape==='ellipse'?`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2-feather}" ry="${h/2-feather}"`:`<rect x="${x+feather*2}" y="${y+feather*2}" width="${w-feather*4}" height="${h-feather*4}" rx="${feather*2}"`;
    defs.push(`<filter id="${id}-blur"${wideFeather?' x="-100%" y="-100%" width="300%" height="300%"':''}><feGaussianBlur stdDeviation="${feather}"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">${shapeMarkup} fill="white" filter="url(#${id}-blur)"/></mask>`);
    if(ink==='contrast')defs.push(`<filter id="${id}-ink" color-interpolation-filters="sRGB"><feColorMatrix type="luminanceToAlpha" result="luminance"/><feGaussianBlur in="luminance" stdDeviation="3" result="paper"/><feComposite in="paper" in2="luminance" operator="arithmetic" k2="5" k3="-5" result="lettering"/><feComposite in="SourceGraphic" in2="lettering" operator="in"/></filter>`);
    else if(ink)defs.push(`<filter id="${id}-ink" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -2.126 -7.152 -.722 0 ${inkThreshold}"/></filter>`);
    if(soften)defs.push(`<filter id="${id}-soften" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${soften}"/></filter>`);
    const fragment=`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${crop.join(' ')}" preserveAspectRatio="none" overflow="hidden"><use xlink:href="#source-${source}"${ink?` filter="url(#${id}-ink)"`: ''}/></svg>`;
    return `<g mask="url(#${id})">${soften?`<g filter="url(#${id}-soften)">${fragment}</g>`:fragment}</g>`;
  }).join('');
  const backgroundDecorations=decorate((config.decorations||[]).filter(item=>item.underContext),'background-decoration');
  // Native texture fills bridge decorative water/paper only; their masks are
  // authored in canvas coordinates and always sit below every source layer.
  const textureFills=(config.textureFills||[]).map(({source,crop,scale,outline,feather=60,irregularity=0},i)=>{
    const id=`texture-fill-${i}`,w=crop[2]*scale,h=crop[3]*scale;
    const tile=`<svg width="${w+2}" height="${h+2}" viewBox="${crop.join(' ')}" preserveAspectRatio="none"><use xlink:href="#source-${source}"/></svg>`;
    defs.push(`<pattern id="${id}-pattern" patternUnits="userSpaceOnUse" width="${w*2}" height="${h*2}">${tile}<g transform="translate(${w*2} 0) scale(-1 1)">${tile}</g><g transform="translate(0 ${h*2}) scale(1 -1)">${tile}</g><g transform="translate(${w*2} ${h*2}) scale(-1 -1)">${tile}</g></pattern><filter id="${id}-blur"><feGaussianBlur stdDeviation="${feather}"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><polygon points="${outline.map(p=>p.join(',')).join(' ')}" fill="white" filter="url(#${id}-blur)"/></mask>`);
    if(irregularity)defs.push(`<filter id="${id}-surface" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".008 .011" numOctaves="3" seed="29" result="variation"/><feDisplacementMap in="SourceGraphic" in2="variation" scale="${irregularity}" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="7"/></filter>`);
    return `<g mask="url(#${id})"><rect width="${width}" height="${height}" fill="url(#${id}-pattern)"${irregularity?` filter="url(#${id}-surface)"`:''}/></g>`;
  }).join('');
  const decorations=decorate((config.decorations||[]).filter(item=>!item.underContext),'decoration');
  const canvasRepairs=(config.canvasRepairs||[]).map(({path,sha256,region})=>{
    if(!/^private\/images-combined\/patches\/[a-z0-9-]+\.png$/.test(path)||region?.length!==4||!region.every(Number.isFinite)||region[0]<0||region[1]<0||region[2]<=0||region[3]<=0||region[0]+region[2]>width||region[1]+region[3]>height)throw new Error(`Invalid canvas repair: ${key}`);
    const bytes=fs.readFileSync(path);
    if(hash(bytes)!==sha256)throw new Error(`Canvas repair hash differs: ${path}`);
    const [x,y,w,h]=region;
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${bytes.toString('base64')}"/>`;
  }).join('');
  const overlays=decorate(config.overlays||[],'overlay')+canvasRepairs;
  const titleArtwork=decorate(config.titleArtwork?[config.titleArtwork]:[],'title-artwork');
  const restorations=parts.flatMap(part=>(part.layer.restore||[]).map(([x,y,w,h],i)=>{
    const id=`restore-${part.index}-${i}`,t=artworkSources[part.map.id];
    defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${x-8}" y="${y-8}" width="${w+16}" height="${h+16}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" filter="url(#feather)"/></mask>`);
    return `<g transform="translate(${t.x} ${t.y}) scale(${n(t.width/1024)})"><use xlink:href="#source-${part.index}" mask="url(#${id})"/></g>`;
  })).join('');
  const preservedContours=parts.flatMap(part=>(part.layer.preserveContours||[]).map((region,i)=>{
    const id=`preserve-${part.index}-${i}`,t=sources[part.map.id];
    defs.push(`<filter id="${id}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${region.feather}"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512"><polyline points="${region.points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="white" stroke-width="${region.radius*2}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-blur)"/></mask>`);
    return `<g transform="translate(${t.x} ${t.y}) scale(${n(part.scale*2)})"><use xlink:href="#source-${part.index}" mask="url(#${id})"/></g>`;
  })).join('');
  const arrows=(config.arrows||[]).map(({from,to,width=6,head=35})=>{
    if(!Array.isArray(from)||!Array.isArray(to)||from.length!==2||to.length!==2||![...from,...to,width,head].every(Number.isFinite)||!(width>0)||!(head>0)||from.every((v,i)=>v===to[i]))throw new Error('Invalid map arrow: '+key);
    const dx=to[0]-from[0],dy=to[1]-from[1],length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
    return '<g fill="none" stroke="#34382e" stroke-width="'+width+'" stroke-linecap="round" stroke-linejoin="round"><path d="M '+from.join(' ')+' L '+to.join(' ')+' M '+[to[0]-ux*head-uy*head*.65,to[1]-uy*head+ux*head*.65].join(' ')+' L '+to.join(' ')+' L '+[to[0]-ux*head+uy*head*.65,to[1]-uy*head-ux*head*.65].join(' ')+'"/></g>';
  }).join('');
  const foregroundOrder=config.foregroundOrder||images.map((_,i)=>i);
  if(foregroundOrder.length!==images.length||new Set(foregroundOrder).size!==images.length||foregroundOrder.some(i=>!Number.isInteger(i)||i<0||i>=images.length))throw new Error('Invalid foreground order: '+key);
  const foreground=foregroundOrder.map(i=>images[i]).join('');
  const caption=config.caption===false?'':`<text x="${width-(config.captionInset||64)}" y="${height-48}" text-anchor="end" font-family="Georgia,serif" font-size="${n(Math.min(42,width/38))}" font-weight="bold" letter-spacing="2" fill="#3d4238" stroke="#c4b99e" stroke-width="2" paint-order="stroke">${esc(d.name.toUpperCase())}</text>`;
  const labels=(config.labels||[]).map(label=>{
    const part=parts[label.source],t=sources[part.map.id];
    return `<text x="${n(t.x+label.at[0]*t.width/1024)}" y="${n(t.y+label.at[1]*t.height/512)}" font-family="Georgia,serif" font-size="${label.size*t.width/1024}" fill="#30352d">${esc(label.text)}</text>`;
  }).join('');
  let paperBackground='<rect width="100%" height="100%" fill="#b9ad91" filter="url(#paper)"/>';
  if(config.backgroundTexture){
    const {source,crop,scale}=config.backgroundTexture,sw=crop[2],sh=crop[3],w=sw*scale,h=sh*scale;
    const tile=`<svg x="-4" y="-4" width="${w+8}" height="${h+8}" viewBox="${crop.join(' ')}" preserveAspectRatio="none" overflow="hidden"><use xlink:href="#source-${source}"/></svg>`;
    defs.push(`<pattern id="original-paper" patternUnits="userSpaceOnUse" width="${w*2}" height="${h*2}">${tile}<g transform="translate(${w*2} 0) scale(-1 1)">${tile}</g><g transform="translate(0 ${h*2}) scale(1 -1)">${tile}</g><g transform="translate(${w*2} ${h*2}) scale(-1 -1)">${tile}</g></pattern>`);
    if(config.backgroundTexture.soften){
      // A subdued native-paper wash retains its colour without turning a small
      // clean sample into conspicuous mirrored motifs across a large canvas.
      defs.push(`<filter id="paper-wash"${config.backgroundTexture.irregularity?' x="0" y="0" width="100%" height="100%"':''}>${config.backgroundTexture.irregularity?`<feTurbulence type="fractalNoise" baseFrequency=".008 .011" numOctaves="3" seed="47" result="variation"/><feDisplacementMap in="SourceGraphic" in2="variation" scale="${config.backgroundTexture.irregularity}" xChannelSelector="R" yChannelSelector="G"/>`:""}<feGaussianBlur stdDeviation="${config.backgroundTexture.soften}"/></filter>`);
      paperBackground+=`<rect ${config.backgroundTexture.irregularity?`x="-500" y="-500" width="${width+1000}" height="${height+1000}"`:'width="100%" height="100%"'} fill="url(#original-paper)" opacity="${config.backgroundTexture.opacity??'.24'}" filter="url(#paper-wash)"/>`;
    }else paperBackground='<rect width="100%" height="100%" fill="url(#original-paper)"/>';
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${esc(d.name)}</title><desc>Composed locally from extracted game textures with independently traced terrain contours and their surrounding landscape.</desc><defs><filter id="feather" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="5"/></filter><filter id="crest-feather" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter><filter id="context-feather" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="34"/></filter><filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006 .009" numOctaves="4" seed="17"/><feColorMatrix type="saturate" values="0"/><feColorMatrix type="matrix" values=".22 0 0 0 .62  .21 0 0 0 .58  .18 0 0 0 .48  0 0 0 0 1"/></filter><radialGradient id="edge-shade"><stop offset=".6" stop-color="#55432b" stop-opacity="0"/><stop offset="1" stop-color="#55432b" stop-opacity=".18"/></radialGradient>${defs.join('')}</defs>${paperBackground}${textureFills}${backgroundDecorations}${surroundings.join('')}${decorations}${paths}${foreground}${restorations}${overlays}${preservedContours}${labels}${titleArtwork}${arrows}<rect width="100%" height="100%" fill="url(#edge-shade)"/>${caption}${frame}</svg>`;
  const svgPath=`private/images-combined/${key.toLowerCase()}.svg`;
  const path=`images/dungeons/combined/${key.toLowerCase()}.avif`;
  fs.writeFileSync(svgPath,svg);
  const rasterSize=combinedRasterSize({width,height,artworkSources},d);
  await compressImages([{source:svgPath,destination:path,rasterSize}]);
  if(args.includes('--guides')){
    fs.mkdirSync('tmp/combined-guides',{recursive:true});
    const colors=['#00e5ff','#ff4fbe','#7dff67','#ffca28'];
    const guides=parts.map(p=>{
      const t=artworkSources[p.map.id],color=colors[p.index%colors.length];
      const anchor=reference?null:p.layer.join?.slice(3),cross=anchor?`<path d="M ${anchor[0]-12} ${anchor[1]} h 24 M ${anchor[0]} ${anchor[1]-12} v 24"/>`:'';
      const [lx,ly]=p.outline[0];
      return `<g transform="translate(${t.x} ${t.y}) scale(${n(t.width/1024)})" fill="none" stroke="${color}" stroke-width="2"><polygon points="${(p.layer.terrainOutline||p.outline).map(p=>p.join(',')).join(' ')}" stroke-dasharray="7 4"/>${cross}<text x="${lx}" y="${ly-8}" fill="${color}" stroke="#111" stroke-width=".6" paint-order="stroke" font-size="12">${p.index}: ${esc(p.layer.suffix)}</text></g>`;
    }).join('');
    fs.writeFileSync(`tmp/combined-guides/${config.slug}.svg`,svg.replace(/<\/svg>$/,`${guides}</svg>`));
  }
  const placements={},patrols={},placementPatrols={};
  const project=(point,source)=>[n(source.x+point[0]/1024*source.width),n(source.y+point[1]/512*source.height)];
  for(const adjustment of config.placementAdjustments||[]){
    const part=parts[adjustment.source],t=sources[part.map.id];
    const members=d.enemies.filter(p=>p.groupId===adjustment.groupId&&p.mapImageId===part.map.id);
    if(!members.length)throw new Error(`No placements match correction in ${key}: ${adjustment.groupId}`);
    const correct=([x,y])=>{
      const dx=(x-adjustment.anchor[0])*adjustment.scale[0];
      return [adjustment.target[0]+dx,adjustment.target[1]+(y-adjustment.anchor[1])*adjustment.scale[1]+dx*(adjustment.slope||0)];
    };
    for(const p of members){
      placements[p.placementId]=project(correct([p.mapPosition.x*1024,p.mapPosition.y*512]),t);
      const route=p.mapPatrolPath;
      // Move the near end with the corrected pack, tapering to the unchanged far
      // endpoint. Preserve curve detail and do not stretch it past the gate.
      if(route?.length>1&&route.every(pt=>pt.mapImageId===part.map.id)){
        const points=route.map(pt=>[pt.mapPosition.x*1024,pt.mapPosition.y*512]);
        const first=points[0],corrected=correct(first),lengths=[0];
        for(let i=1;i<points.length;i++)lengths[i]=lengths[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
        const total=lengths.at(-1)||1,id=`manual:${p.placementId}`;
        patrols[id]=points.map((xy,i)=>project(xy.map((v,k)=>v+(corrected[k]-first[k])*(1-lengths[i]/total)),t));
        placementPatrols[p.placementId]=id;
      }
    }
  }
  if(reference){
    for(const p of d.enemies.filter(p=>p.mapPosition))placements[p.placementId]=mapCoordinates(p,reference);
    Object.assign(patrols,reference.patrols);Object.assign(placementPatrols,reference.placementPatrols);
  }
  result[d.id]={id:`${d.id}:Combined-v${config.version||2}`,name:'Full map',kind:'combined',path,width,height,pixelWidth:rasterSize.width,pixelHeight:rasterSize.height,sha256:hashFile(path),recipeSha256:hash(JSON.stringify(config)),sources,artworkSources,...(reference?{referenceId:d.id,referenceSha256:hash(JSON.stringify(reference))}:{}),...(Object.keys(placements).length?{placements,patrols,placementPatrols}:{})};
  console.log(`${d.name}: ${parts.length} source contours, ${width} x ${height}`);
}
fs.writeFileSync('data/combined-layouts.js',`// Generated by scripts/prepare-combined-maps.mjs from extracted game textures and our own authoring.\nexport const combinedBuildId=${JSON.stringify(buildId)};\nexport const combinedLayouts=${JSON.stringify(result,null,2)};\n`);
