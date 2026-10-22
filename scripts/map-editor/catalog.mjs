import fs from 'node:fs';
import path from 'node:path';

export function loadEditorCatalog(root){
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
  // Raw export is available before a public data rebuild, including NEW maps.
  const planner=path.join(root,'private/game-data/planner');
  if(fs.existsSync(path.join(planner,'dungeons.json'))&&fs.existsSync(path.join(planner,'map-objects.json'))){
    const registry=read('private/game-data/planner/dungeons.json'),objects=read('private/game-data/planner/map-objects.json'),images=read('private/game-data/planner/images.json').images;
    const bySource=new Map(images.map(i=>[i.source.toLowerCase(),i])),byPackage=new Map();
    for(const result of read('private/game-data/planner/textures-manifest.json').results){
      if(result.Output){const texture=read('private/game-data/planner/'+result.Output);byPackage.set(texture.Package.toLowerCase(),bySource.get(result.Source.toLowerCase()));}
    }
    const strings=new Map(read('private/game-data/planner/localization.json').flatMap(t=>t.rows.map(([key,value])=>[t.table+':'+key,value])));
    const frames={},dungeons=registry.playable.map(d=>{
      frames[d.id]={};
      const mapImages=objects.filter(o=>o.type==='BP_DungeonMapAreaBox_C'&&o.source.match(/(?:dungeons|Adventures)\/([^/]+)\//i)?.[1]===d.key).map(o=>{
        const texture=o.properties.DungeonAreaTexture,asset=texture.ObjectPath.split('.')[0],match=byPackage.get(asset.toLowerCase());
        if(!match?.output)throw Error('Missing decoded map texture: '+asset);
        const suffix=texture.ObjectName.split("'")[1],id=d.id+':'+suffix,p=o.rootComponent.properties,c=p.RelativeLocation,scale=p.RelativeScale3D??{X:1,Y:1,Z:1};
        if(p.AttachParent||Object.values(p.RelativeRotation??{}).some(v=>Math.abs(v)>1e-6))throw Error('Attached/rotated map area requires transform support: '+id);
        const ex=p.BoxExtent.X*scale.X,ey=p.BoxExtent.Y*scale.Y;
        frames[d.id][id]={calibration:{sx:2*ey,sy:-2*ex,ox:c.Y-ey,oy:c.X+ex}};
        const sourcePath='private/game-data/planner/'+match.output;
        return {id,name:o.properties.DungeonAreaName??suffix,path:sourcePath,sourcePath,sourceSha256:match.sha256,sha256:match.sha256,width:match.width,height:match.height};
      });
      const title=d.info.DisplayName;
      return {id:d.id,name:title?.LocalizedString||title?.SourceString||strings.get(title?.TableId+':'+title?.Key)||d.key,mapImages,enemies:[]};
    });
    // Current prepared markers are useful while tracing; never show stale markers on a new build.
    const published=read('data/manifest.json');
    if(String(published.buildId)===String(registry.steamBuild)){
      const current=read('data/dungeons.json');for(const d of dungeons)d.enemies=current.find(c=>c.id===d.id)?.enemies??[];
    }
    return {build:registry.steamBuild,dungeons,frames};
  }
  return {build:read('data/manifest.json').buildId,dungeons:read('data/dungeons.json'),frames:read('data/game-map-frames.json')};
}
