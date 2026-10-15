import {combinedLayouts} from './combined-layouts.js';
import {legacyStitchedLayouts} from './combined-legacy-layouts.js';
// The former grid layout is retained only to migrate saved drawing coordinates.
const cache = new WeakMap();
export function legacyCombinedMap(dungeon) {
  if (dungeon.mapImages.length < 2) return null;
  if (cache.has(dungeon)) return cache.get(dungeon);
  const maps = dungeon.mapImages.map((map, index) => ({map, index}));
  // Entrance/overview first; otherwise preserve the dataset's layer order.
  const priority = map => /^Start/i.test(map.name || '') ? 0 : map.name === 'Global' ? 1 : 2;
  maps.sort((a, b) => priority(a.map) - priority(b.map) || a.index - b.index);
  const gap = 48, heading = 64, imageHeight = 1024, columns = 2;
  const cellWidth = Math.max(...maps.map(({map}) => map.width / map.height * imageHeight));
  const cellHeight = imageHeight + heading;
  const rows = Math.ceil(maps.length / columns);
  const width = columns * cellWidth + (columns + 1) * gap;
  const height = rows * cellHeight + (rows + 1) * gap;
  const sources = {};
  for (const [index, {map, index: originalIndex}] of maps.entries()) {
    const row = Math.floor(index / columns), column = index % columns;
    const rowCount = Math.min(columns, maps.length - row * columns);
    const layerWidth = map.width / map.height * imageHeight;
    const x = gap + column * (cellWidth + gap) + (columns - rowCount) * (cellWidth + gap) / 2 + (cellWidth - layerWidth) / 2;
    const y = gap + row * (cellHeight + gap) + heading;
    let name = map.name || `Layer ${originalIndex + 1}`;
    if (map.name && maps.filter(({map: other}) => other.name === map.name).length > 1) name += ` ${originalIndex + 1}`;
    sources[map.id] = {x, y, width: layerWidth, height: imageHeight, path: map.path, name};
  }
  const view = {id: `${dungeon.id}:Combined-v1`, name: 'Combined', kind: 'combined', width, height, sources};
  cache.set(dungeon, view);
  return view;
}

export function combinedMap(dungeon) {
  return combinedLayouts[dungeon.id] || null;
}

export function migrateCombinedDrawing(drawing,dungeon) {
  const previous=drawing?.mapId===`${dungeon.id}:Combined-v1`?legacyCombinedMap(dungeon):legacyStitchedLayouts[drawing?.mapId];
  const next=combinedMap(dungeon);
  if(!previous||!next)return drawing;
  if(!previous.id.startsWith(`${dungeon.id}:`))return drawing;
  const entries=Object.entries(previous.sources);
  return {...drawing,mapId:next.id,points:drawing.points.map(([x,y])=>{
    // An annotation in an old panel gutter follows its nearest source layer.
    // Stitched sources overlap as rectangles; use their visible terrain contours
    // instead, preferring the last painted layer when contours overlap.
    const distance=t=>{
      if(!t.outline)return Math.hypot(Math.max(t.x-x,0,x-t.x-t.width),Math.max(t.y-y,0,y-t.y-t.height));
      const polygon=t.outline.map(([px,py])=>[t.x+px/1024*t.width,t.y+py/512*t.height]);
      let inside=false,nearest=Infinity;
      for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
        const [ax,ay]=polygon[j],[bx,by]=polygon[i];
        if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
        const dx=bx-ax,dy=by-ay,u=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
        nearest=Math.min(nearest,Math.hypot(x-ax-u*dx,y-ay-u*dy));
      }
      return inside?0:nearest;
    };
    const [id,old]=entries.reduce((a,b)=>distance(a[1])<distance(b[1])?a:b);
    const current=next.sources[id];
    return [current.x+(x-old.x)/old.width*current.width,current.y+(y-old.y)/old.height*current.height];
  })};
}
