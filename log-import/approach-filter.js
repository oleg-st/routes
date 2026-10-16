import {createPackDistance} from './placement-geometry.js';
import {requiresPlayerContact} from './activation.js';
import {matchingConfig} from './matching-config.js';

// Necessary proximity evidence, not navigation/pathfinding. All coordinates and
// ranges must use the same world units. A missing witness means "unsupported
// under these ranges/samples", not proof that unlogged movement was impossible.
export function createApproachFilter({packs,observations,attacks=[],playerRadius,chainRadius,buriedRadius=matchingConfig.buriedRadius,
  maxPlayerRadius=playerRadius,maxChainRadius=chainRadius}) {
  if(![playerRadius,chainRadius,buriedRadius,maxPlayerRadius,maxChainRadius].every(n=>Number.isFinite(n)&&n>=0)||maxPlayerRadius<playerRadius||maxChainRadius<chainRadius)throw new Error('Finite nonnegative approach radii are required.');
  const index=new Map();
  const ordered=observations.filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.x)&&Number.isFinite(p.y)).toSorted((a,b)=>a.t-b.t);
  for(const pack of packs){
    const distance=createPackDistance(pack.placements);
    const contactOnly=pack.placements.length>0&&pack.placements.every(requiresPlayerContact);
    const player=[],npc=[];let packAttack=null;const byTarget=new Map();
    // Only established member identities can broadcast targeted aggro to the
    // whole pack. Merely sharing an NPC type is not membership evidence.
    const memberKeys=new Set(pack.memberKeys??[]);
    for(const p of ordered){
      const isPlayer=p.type==='Player';
      if(contactOnly&&!isPlayer)continue;
      if(isPlayer&&p.hp<=0)continue;
      if(isPlayer&&['invisible','unknown'].includes(p.visibility))continue;
      if(!isPlayer&&(p.type!=='NPC'||!Number.isFinite(p.activeSince)||p.t<p.activeSince||p.t>(p.deathTime??Infinity)))continue;
      const evidence=isPlayer?player:npc,previous=evidence.at(-1);
      const minimum=contactOnly?buriedRadius:isPlayer?playerRadius:chainRadius;
      if(previous?.distance<=minimum)continue;
      const limit=contactOnly?buriedRadius:isPlayer?maxPlayerRadius:maxChainRadius,d=distance(p,limit);
      if(d>limit)continue;
      // Time-ordered distance minima retain the first witness for every radius.
      // Reusing this small frontier avoids rescanning all movement on each retry.
      if(previous&&previous.distance<=d)continue;
      const witness={kind:contactOnly?'player-contact':isPlayer?'player-approach':'npc-chain',key:p.key,t:p.t,distance:d,range:limit};
      evidence.push(witness);
    }
    for(const attack of attacks){
      // Buried enemies cannot be targeted until a player has uncovered them.
      if(contactOnly)continue;
      if(!attack.targetKey||!Number.isFinite(attack.t)||!Number.isFinite(attack.range)||attack.range<0)continue;
      if(byTarget.get(attack.targetKey)?.t<=attack.t)continue;
      const d=distance(attack,attack.range);if(!Number.isFinite(d)||d>attack.range)continue;
      const witness={kind:'player-attack-or-cast',key:attack.key,targetKey:attack.targetKey,
        t:attack.t,distance:d,range:attack.range,abilityGameID:attack.abilityGameID};
      byTarget.set(attack.targetKey,witness);
      if(memberKeys.has(attack.targetKey)&&(!packAttack||attack.t<packAttack.t))packAttack={...witness,scope:'established-pack-member'};
    }
    index.set(pack.id,{player,npc,byTarget,packAttack,contactOnly});
  }
  return {
    check(packID,firstEventTime,targetKey,radii={playerRadius,chainRadius}){
      if(!Number.isFinite(radii.playerRadius)||!Number.isFinite(radii.chainRadius)||radii.playerRadius<playerRadius||radii.playerRadius>maxPlayerRadius||radii.chainRadius<chainRadius||radii.chainRadius>maxChainRadius)throw new Error('Approach radius is outside the prepared range.');
      const entry=index.get(packID);if(!entry||!Number.isFinite(firstEventTime))return {supported:false,reason:'missing-pack-or-time'};
      const direct=entry.byTarget.get(targetKey);
      const playerRange=entry.contactOnly?buriedRadius:radii.playerRadius;
      const player=entry.player.find(p=>p.distance<=playerRange),npc=entry.npc.find(p=>p.distance<=radii.chainRadius);
      // NPC evidence must precede the target's first event strictly. This avoids
      // the target justifying its own pull, or a same-timestamp cycle of packs.
      const witnesses=[player?.t<=firstEventTime?{...player,range:playerRange}:null,
        npc?.t<firstEventTime?{...npc,range:radii.chainRadius}:null,direct?.t<=firstEventTime?direct:null,
        entry.packAttack?.t<=firstEventTime?entry.packAttack:null].filter(Boolean);
      witnesses.sort((a,b)=>a.t-b.t);
      return witnesses.length?{supported:true,witness:witnesses[0]}:entry.contactOnly?
        {supported:false,reason:'no-prior-player-contact'}:
        {supported:false,reason:'no-prior-approach-or-in-range-attack'};
    }
  };
}
