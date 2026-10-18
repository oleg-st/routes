import {fullMaps} from './full-maps.js';

// The stitched Temple of Sinnari artwork is offset from the fitted world
// transform. Use its existing centered portrait anchor for display only.
// Original layers and world/log coordinates keep their game positions.
const referenceAnchors={
  'placement-2f08a0644a58616a92aee8c52e26e64e6160054dba296541b472deed07cee715':'Level.ID.DesertDunes',
};
export function markerAnchor(position,view){
  const dungeonId=referenceAnchors[position.placementId],reference=fullMaps[dungeonId];
  if(!reference||view.id!==reference.id&&view.referenceId!==dungeonId)return null;
  const point=reference.placements?.[position.placementId];
  return point?[...point]:null;
}
