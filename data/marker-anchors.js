import {fullMaps} from './full-maps.js';

// These encounters' stitched artwork is offset from the fitted world
// transform. Use their existing in-arena portrait anchors for display only.
// Original layers and world/log coordinates keep their game positions.
const referenceAnchors={
  // Build 26122410: both native boss transforms and map artwork are unchanged.
  'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715':{dungeonId:'Level.ID.DesertDunes',point:[5146.222222222221,524.6797770358662]},
  // The legacy lair transform puts Vexira's game spawn below the arena.
  'placement-custom-silken-vexira':{dungeonId:'Level.ID.SpiderForest',point:[3257.1428571428573,271.2365388960006]},
};
export function markerAnchor(position,view){
  const {dungeonId,point}=referenceAnchors[position.placementId]??{},reference=fullMaps[dungeonId];
  if(!reference||view.id!==reference.id&&view.referenceId!==dungeonId)return null;
  return point?[...point]:null;
}
