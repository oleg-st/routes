// Provisional world-unit distances. Body and chain aggro can be tuned together;
// targeted abilities use a separate bound until per-ability ranges are mapped.
// Normal imports use a fixed radius. Explicit diagnostic runs can retry
// ordinary approach/chain checks in steps, stopping at the first match.
// The ceiling bounds the heuristic; it is not a measured in-game aggro range.
export const matchingConfig = Object.freeze({
  aggroRadius: 1500,
  aggroRadiusStep: 100,
  maxAggroRadius: 3000,
  buriedRadius: 100,
  attackRange: 6000,
  bossAddRadius: 3000,
});
