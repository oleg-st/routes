import {mapViews as baseMapViews} from './map-views.js';

export function retouchedMapPath(dungeonId){
  return `private/images-combined/${dungeonId.split('.').at(-1).toLowerCase()}-background-user.avif`;
}

// Background variants share the existing coordinate-frame ID so routes created
// locally remain usable on the public map, including drawings and live cursors.
export function mapViews(dungeon){
  const views=baseMapViews(dungeon);
  if(views[0]?.kind!=='combined')return views;
  const [ours,...others]=views;
  return [
    ours,
    {...ours,name:'Full map · Retouched',path:retouchedMapPath(dungeon.id)},
    ...others,
  ];
}
