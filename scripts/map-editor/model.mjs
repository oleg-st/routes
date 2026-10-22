export const rectangle=()=>[[0,0],[1024,0],[1024,512],[0,512]];
export function createDraft(dungeon,frames={}){
  const base=frames[dungeon.mapImages[0]?.id]?.calibration;
  return {schemaVersion:1,dungeonId:dungeon.id,key:dungeon.id.replace(/^Level\.ID\./,''),
    slug:dungeon.id.replace(/^Level\.ID\./,'').toLowerCase()+'-editor',version:1,
    layers:dungeon.mapImages.map((map,i)=>{
      const c=frames[map.id]?.calibration,uniform=c&&base&&Math.abs(c.sx/base.sx-c.sy/base.sy)<1e-5;
      return {suffix:map.id.slice(dungeon.id.length+1),at:uniform?[(c.ox-base.ox)/base.sx*1024,(c.oy-base.oy)/base.sy*512].map(v=>v||0):[i*850,0],
        scale:uniform?Math.abs(c.sx/base.sx):1,outline:rectangle(),exclude:[]};
    })};
}
export function validateMapPolygon(polygon,label='Contour'){
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=1024&&p[1]>=0&&p[1]<=512;
  if(!Array.isArray(polygon)||polygon.length<3||polygon.length>500||!polygon.every(point))throw Error(label+': mark at least three points inside the image');
  const area=polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  if(Math.abs(area)<1)throw Error(label+' has zero area');
}
export function validateDraft(draft,dungeon){
  if(draft?.schemaVersion!==1||draft.dungeonId!==dungeon.id||draft.key!==dungeon.id.replace(/^Level\.ID\./,''))throw Error('Wrong dungeon');
  if(!/^[a-z0-9-]{1,80}$/.test(draft.slug)||!Number.isInteger(draft.version)||draft.version<1)throw Error('Invalid slug/version');
  const expected=new Set(dungeon.mapImages.map(m=>m.id.slice(dungeon.id.length+1)));
  if(!Array.isArray(draft.layers)||draft.layers.length!==expected.size)throw Error('Every map layer is required');
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=100000);
  for(const layer of draft.layers){
    if(!expected.delete(layer.suffix)||!point(layer.at)||!Number.isFinite(layer.scale)||layer.scale<.01||layer.scale>20)throw Error('Invalid layer transform');
    validateMapPolygon(layer.outline);
    if(layer.exclude!==undefined){
      if(!Array.isArray(layer.exclude)||layer.exclude.length>100)throw Error('Too many cutouts');
      for(const polygon of layer.exclude)validateMapPolygon(polygon,'Cutout');
    }
  }
  return draft;
}
export function draftRecipe(draft,dungeon){
  validateDraft(draft,dungeon);
  // Geometry and artwork share one frame. No Method coordinates are needed.
  return {key:draft.key,slug:draft.slug,version:draft.version,caption:false,layers:draft.layers.map(l=>({suffix:l.suffix,at:[...l.at],scale:l.scale,outline:l.outline.map(p=>[...p]),...(l.exclude?.length?{exclude:l.exclude.map(polygon=>polygon.map(p=>[...p])),seamFeather:0,contextSeamFeather:0}:{}),context:{expand:0,feather:4}}))};
}
export function recipeModule(draft,dungeon){return 'export default '+JSON.stringify(draftRecipe(draft,dungeon),null,2)+';\n';}
export function draftBounds(draft){
  const points=draft.layers.flatMap(l=>[[l.at[0],l.at[1]],[l.at[0]+1024*l.scale,l.at[1]+512*l.scale]]);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return [Math.min(...xs)-60,Math.min(...ys)-60,Math.max(...xs)-Math.min(...xs)+120,Math.max(...ys)-Math.min(...ys)+120];
}
