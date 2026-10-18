import {fullMaps} from './full-maps.js';

// These encounters' stitched artwork is offset from the fitted world
// transform. Use their existing in-arena portrait anchors for display only.
// Original layers and world/log coordinates keep their game positions.
const referenceAnchors={
  'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715':'Level.ID.DesertDunes',
  // The legacy lair transform puts Vexira's game spawn below the arena.
  'placement-custom-silken-vexira':'Level.ID.SpiderForest',
};
export function markerAnchor(position,view){
  const dungeonId=referenceAnchors[position.placementId],reference=fullMaps[dungeonId];
  if(!reference||view.id!==reference.id&&view.referenceId!==dungeonId)return null;
  const point=reference.placements?.[position.placementId];
  return point?[...point]:null;
}
