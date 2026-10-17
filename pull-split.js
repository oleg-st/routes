import {pullOutline} from './map-geometry.js';

const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const center=points=>[0,1].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/points.length);

// Clip a finite segment against the counterclockwise convex outline used by the map.
export function outlineIntersection(a,b,outline){
  if(outline.length<3)return 0;
  let enter=0,exit=1;
  for(let i=0;i<outline.length;i++){
    const p=outline[i],q=outline[(i+1)%outline.length],start=cross(p,q,a),end=cross(p,q,b),delta=end-start;
    if(Math.abs(delta)<1e-9){if(start<0)return 0;continue;}
    const t=-start/delta;
    if(delta>0)enter=Math.max(enter,t);else exit=Math.min(exit,t);
    if(enter>=exit)return 0;
  }
  return (exit-enter)*distance(a,b);
}

// Points are projected onto the current map. Unmapped members stay in the original pull.
export function planPullSplit({pulls,points,padding,start=null,bosses=[]},line){
  let [a,b]=line;
  if(!a||!b||distance(a,b)<1e-9)return null;
  // Canonical direction makes ties independent of the drawing direction.
  if(a[0]>b[0]||(a[0]===b[0]&&a[1]>b[1]))[a,b]=[b,a];
  const mapped=pull=>pull?.enemies.filter(id=>points.has(id))||[];
  let target=null,best=1e-7;
  for(const [index,pull] of pulls.entries()){
    const ids=mapped(pull),outline=pullOutline(ids.map(id=>points.get(id)),padding);
    const overlap=outlineIntersection(a,b,outline);
    if(overlap>best){best=overlap;target={pull,index,ids};}
  }
  if(!target)return null;
  const {pull,index,ids}=target,negative=[],positive=[];
  for(const id of ids){
    // A straight line covers more than half a circular icon exactly when its center
    // is on that side, even when the line also crosses neighboring icons.
    const side=cross(a,b,points.get(id))/distance(a,b);
    if(Math.abs(side)>=1e-7)(side<0?negative:positive).push(id);
  }
  if(!negative.length||!positive.length)return null;
  const previous=mapped(pulls[index-1]),next=mapped(pulls[index+1]);
  const entrance=previous.length?center(previous.map(id=>points.get(id))):start;
  const origin=center(ids.map(id=>points.get(id)));
  const futureBosses=bosses.filter(id=>points.has(id)&&!pulls.slice(0,index+1).some(p=>p.enemies.includes(id)));
  const nearestBoss=futureBosses.sort((x,y)=>distance(points.get(x),origin)-distance(points.get(y),origin))[0];
  const exit=next.length?center(next.map(id=>points.get(id))):points.get(nearestBoss);
  const cost=(first,second)=>(entrance?distance(center(first.map(id=>points.get(id))),entrance):0)+(exit?distance(center(second.map(id=>points.get(id))),exit):0);
  const moved=cost(negative,positive)<=cost(positive,negative)?positive:negative;
  const movedSet=new Set(moved);
  return {pullId:pull.id,index,keep:pull.enemies.filter(id=>!movedSet.has(id)),move:moved};
}
