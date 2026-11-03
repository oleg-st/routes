// The resolved custom idle phase belongs to an individual game actor.
// Blindness, Dormant spawn state and unburrow animations do not imply sleep.
export function isSleeping(mob){
  return /\/Shared\/Idle\/Sleep\/DA_Phase_Idle_Sleep\.\d+$/i.test(mob.behavior?.customIdlePhase??'');
}
