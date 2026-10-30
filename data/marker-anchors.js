import {fullMaps} from './full-maps.js';

// Vexira's native spawn projects north of the arena, into the part cropped
// from our overview. Keep the encounter portrait on the lair's skull artwork.
// Original layers and world/log coordinates retain the actual game spawn.
const referenceAnchors={
  'placement-custom-silken-vexira':{dungeonId:'Level.ID.SpiderForest',point:[3257.1428571428573,271.2365388960006]},
};
export function markerAnchor(position,view){
  const {dungeonId,point}=referenceAnchors[position.placementId]??{},reference=fullMaps[dungeonId];
  if(!reference||view.id!==reference.id&&view.referenceId!==dungeonId)return null;
  return point?[...point]:null;
}
