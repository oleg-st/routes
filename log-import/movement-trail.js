export const movementPlayerColor=(player,heroes=[])=>{
  const color=heroes.find(h=>h.name===player.className)?.classColor;
  return /^#[0-9a-f]{6}$/i.test(color)?color:'#60c7ff';
};

import {mapViews,worldMapCoordinates,drawingOnMap} from '../map-views.js';

// Preview evidence only: never treat straight lines between samples as navmesh
// paths or save them as route annotations.
export function buildMovementTrail({fight,actors,events},trajectories,dungeon){
  const view=mapViews(dungeon)[0],changes=events.filter(e=>e.type==='mapchange').toSorted((a,b)=>a.timestamp-b.timestamp);
  if(!view)return {mapId:null,players:[]};
  const players=[];
  for(const row of trajectories.filter(r=>r.type==='Player'&&(!fight.friendlyPlayers||fight.friendlyPlayers.includes(r.actorID)))){
    const breaks=events.filter(e=>e.targetID===row.actorID&&
      (e.type==='death'&&!e.fake||e.type==='resurrect'||e.type==='respawn'||e.type==='applydebuff'&&e.abilityGameID===1002176)).map(e=>e.timestamp);
    const segments=[];let segment=null,previous=null,changeIndex=-1,lastKept=-Infinity;
    for(const p of row.positions){
      while(changeIndex+1<changes.length&&changes[changeIndex+1].timestamp<=p.t)changeIndex++;
      const map=dungeon.mapImages.find(m=>m.name===(changes[changeIndex]?.mapName??'Start'))??dungeon.mapImages[0];
      const point=worldMapCoordinates({x:p.y,y:p.x},map.id,view,dungeon);
      if(p.hp<=0||!point?.every(Number.isFinite)){segment=null;previous=null;continue;}
      const dt=p.t-(previous?.t??p.t),distance=previous?Math.hypot(p.x-previous.x,p.y-previous.y):0;
      const interrupted=!previous||dt>15000||distance>Math.max(100,dt*3)||
        changes.some(e=>e.timestamp>previous.t&&e.timestamp<=p.t)||breaks.some(t=>t>=previous.t&&t<=p.t);
      if(interrupted){segment=[];segments.push(segment);lastKept=-Infinity;}
      const sample=[(p.t-fight.startTime)/1000,...point];
      // Retain endpoints while reducing dense combat samples to ~5 per second.
      if(p.t-lastKept>=200||segment.length<2){segment.push(sample);lastKept=p.t;}
      else segment[segment.length-1]=sample;
      previous=p;
    }
    const actor=actors.find(a=>a.id===row.actorID);
    if(segments.some(s=>s.length>1))players.push({id:row.key,className:actor?.subType,name:actor?.name??actor?.subType??`Player ${row.actorID}`,segments:segments.filter(s=>s.length>1)});
  }
  return {mapId:view.id,players};
}

export function movementTrailLines(trail,state,view,dungeon,heroes=[]){
  if(!trail||state.complete)return [];
  const pull=state.pulls.at(-1),start=Math.max(0,(state.pulls.at(-2)?.end??0)-5),end=pull?.end;
  if(!Number.isFinite(end))return [];
  const lines=[];
  for(const actor of trail.players){
    for(const segment of actor.segments){
      let line=null;
      for(let i=1;i<segment.length;i++){
        const a=segment[i-1],b=segment[i];
        if(a[0]<start||b[0]>end)continue;
        const estimated=b[0]-a[0]>2,inCombat=b[0]>=pull.start,key=`${estimated}:${inCombat}`;
        if(!line||line.key!==key){line={key,estimated,inCombat,color:movementPlayerColor(actor,heroes),player:actor.name,points:[a.slice(1)]};lines.push(line);}
        line.points.push(b.slice(1));
      }
    }
  }
  return lines.flatMap(line=>{
    const projected=drawingOnMap({kind:'line',mapId:trail.mapId,points:line.points},view,dungeon);
    return projected?[{...line,points:projected.points}]:[];
  });
}
