import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {projectRoot, usedImages, publicMapPath} from './image-assets.mjs';
import {fullMaps, fullMapBuildId} from '../data/full-maps.js';
import {combinedLayouts} from '../data/combined-layouts.js';
import {compactPublicData} from './compact-public-data.mjs';

const check = spawnSync(process.execPath, ['scripts/verify-data.mjs', '--public'], {stdio: 'inherit'});
if (check.status !== 0) throw new Error('Image/data verification failed.');
// Explicit publication allowlist: private originals and build tooling never enter dist.
const files = ['index.html', 'app.js', 'route-model.js', 'map-geometry.js', 'map-views.js', 'styles.css',
  ...fs.readdirSync('collaboration').filter(file=>file.endsWith('.js')).map(file=>'collaboration/'+file),
  ...fs.readdirSync('data').filter(file => /\.(js|json|txt)$/.test(file)).map(file => 'data/' + file),
  ...usedImages()];
if (files.some(file => file.startsWith('private/') || file.includes('..'))) throw new Error('Private path in publication allowlist.');
const destination = path.resolve(projectRoot, 'dist');
if (destination !== path.join(path.resolve(projectRoot), 'dist')) throw new Error('Invalid publication directory.');
fs.rmSync(destination, {recursive: true, force: true});
for (const file of files) {
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(file, target);
}
// Keep only calibration needed by Full map; no Referenced view or private URLs.
const coordinates = Object.fromEntries(Object.entries(fullMaps).map(([id, map]) => {
  const {name, path, sha256, sourcePath, sourceSha256, ...calibration} = map;
  return [id, calibration];
}));
fs.writeFileSync(path.join(destination, 'data/full-maps.js'),
  `// Reference coordinates for Full map.\nexport const fullMapBuildId=${JSON.stringify(fullMapBuildId)};\nexport const fullMaps=${JSON.stringify(coordinates)};\n`);
// Source frames remain for route import/projection, but only the main map is offered.
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json','utf8'));
for(const dungeon of dungeons)for(const map of dungeon.mapImages){
  if(combinedLayouts[dungeon.id])delete map.path;
  else map.path=publicMapPath(map);
  delete map.sourcePath;
}
fs.writeFileSync(path.join(destination,'data/dungeons.json'),JSON.stringify(dungeons,null,2)+'\n');
for(const name of ['combined-layouts','combined-legacy-layouts']){
  const filename=path.join(destination,`data/${name}.js`);
  const source=fs.readFileSync(filename,'utf8').replace(/\s*"(?:path|sourcePath)":\s*"(?:private\/)?images\/dungeons\/maps\/[^"\n]+",?/g,'');
  fs.writeFileSync(filename,source);
}
const html=fs.readFileSync(path.join(destination,'index.html'),'utf8')
  .replace(/    <div id="floor-panel"[^\n]+\r?\n/,'')
  .replace(/<label id="floor-panel-option">.*?<\/label>/,'');
fs.writeFileSync(path.join(destination,'index.html'),html);
compactPublicData(destination);
const bundle=await build({absWorkingDir:destination,entryPoints:['app.js'],bundle:true,format:'esm',write:false,minify:true,target:['es2022'],alias:{'loro-crdt':'loro-crdt/base64'}});
fs.writeFileSync(path.join(destination,'app.js'),bundle.outputFiles[0].text);
console.log(`Prepared ${files.length} public files in dist/. Publish only this directory.`);
