import {gameServiceRules} from './game-service-rules.js';
// Game Polymorph tiers use default base-health multipliers. Pixel scale and
// the separate boss size are our presentation policy, not in-game dimensions.
const factors={small:1,medium:1.3,large:1.65,boss:3};
export function enemyMarkerTier(enemy){
  if(enemy?.isBoss)return 'boss';
  const multiplier=Math.fround(Math.fround(enemy?.baseHealth)/Math.fround(gameServiceRules.markerDefaultBaseHealth)),thresholds=gameServiceRules.markerHealthThresholds;
  return multiplier>=Math.fround(thresholds.large)?'large':multiplier>=Math.fround(thresholds.medium)?'medium':'small';
}
export function enemyMarkerScale(enemy){
  const tier=enemyMarkerTier(enemy);
  return tier==='boss'?factors.boss:.75*factors[tier];
}

// Screen-space base radius: preserve the overview size at zoom=1 and keep
// growing at close range, more slowly than the map, without a size ceiling.
export function enemyMarkerRadius(size,zoom,portraits=true){
  const zoomScale=Math.sqrt(zoom);
  return (size+(portraits?3:0))*zoomScale;
}
