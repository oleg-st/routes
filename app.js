import {uid,newRoute,clearRoute,hasRouteChanges,newPull,pullColor,renamePull,movePull,assignEnemies,scorePull,scoreRoute,placementScore,validateRoute,englishDefaultLabel,effectivePositions,shadowTimeline,shadowTarget,orbCount,applyModifierPresets,toggleModifier} from './route-model.js';
import {pullOutline} from './map-geometry.js';
import {mapViews,onMap,mapCoordinates,drawingOnMap,drawingPointFromMap,mapStart,mapCampfires} from './map-views.js';
import {correctDungeon} from './data/placement-corrections.js';
import {enemyAbilities} from './data/ability-corrections.js';
import {fullMapBuildId} from './data/full-maps.js';
import {combinedBuildId} from './data/combined-layouts.js';
import {loadData} from './data/runtime-loader.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=n=>n==null?'—':n.toFixed(2)+'%';
const NS='http://www.w3.org/2000/svg';
const relicColors={portal:'#70d9ff',invis:'#bb86fc'};
const empoweredIcon='images/modifiers/empowered-minions.avif';
const chickenIcon='images/relics/ga-relicpower-polymorphtargetwithsharedcharges-relic-200.avif';
const relicIcons={portal:'images/hero-items/relic-b-crit-portal-hero-item-200.avif',invis:'images/hero-items/relic-b-expertise-groupinvisibility-hero-item-200.avif'};
const failedMobImages=new Set();
const svg=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;return e;};
let data,dungeon,route,activePull,mapLayer,positions,enemies,packNumbers,view,baseView,tool='select',draft=[],inspected=null;
let history=[],future=[],drag=null,saveTimer,toastTimer,suppressClick=false;
let hoveredPack=null;
let focusedEnemies=new Set(),enemyFocusUntil=0,enemyFocusTimer,enemyHoverTimer;
const enemyFocusDuration=1000;
const enemyHoverDelay=200;
let arrowColor='#ff0000',arrowWidth=3;
const storageKey='fellowship-atlas-v1';
let store={drafts:{},saved:[],lastDungeon:null};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function persist(){
  if(!route)return;store.drafts[dungeon.id]=structuredClone(route);store.lastDungeon=dungeon.id;
  try{localStorage.setItem(storageKey,JSON.stringify(store));}catch{toast('Unable to save in this browser. Export your route as JSON.');}
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(persist,200);}
function change(fn){history.push(JSON.stringify(route));if(history.length>60)history.shift();future=[];fn();render();scheduleSave();}
function undo(){if(!history.length)return;future.push(JSON.stringify(route));route=JSON.parse(history.pop());repairSelection();render();scheduleSave();}
function redo(){if(!future.length)return;history.push(JSON.stringify(route));route=JSON.parse(future.pop());repairSelection();render();scheduleSave();}
function repairSelection(){if(!route.pulls.some(p=>p.id===activePull))activePull=route.pulls[0]?.id??null;}
function active(){return route.pulls.find(p=>p.id===activePull)||route.pulls[0];}
function assigned(){return new Map(route.pulls.flatMap((p,i)=>p.enemies.map(id=>[id,{pull:p,index:i}])));}
function currentPositions(){return effectivePositions(route,dungeon).filter(e=>onMap(e,mapLayer));}
function refreshPositions(){positions=new Map(effectivePositions(route,dungeon).map(p=>[p.placementId,p]));}
function pointScore(p){return placementScore(p,enemies.get(p.id),route,data.shadow);}
function isEmpowered(p){return route.modifiers.empowered.active&&route.modifiers.empowered.enemies.includes(p.placementId)&&!enemies.get(p.id)?.isBoss;}
function coordinates(e){return mapCoordinates(e,mapLayer);}
function availableImage(e){return e?.images?.find(i=>i.size==='200')?.path||e?.images?.[0]?.path;}
function floorName(m,i){
  if(!m.sources)i=mapViews(dungeon).filter(view=>!view.sources).findIndex(view=>view.id===m.id);
  const names={Global:'Overview',Start:'Start',End:'End',Ending:'End','Lower floor':'Lower floor',Interior:'Interior',Chamber:'Chamber',Jungle:'Jungle','Start + village':'Start · village','Ship interior':'Ship interior','Upper island':'Upper island',Upper:'Upper level',Lower:'Lower level'};
  const title=names[m.name]||m.name||`Layer ${i+1}`;
  return dungeon.mapImages.filter(v=>v.name===m.name).length>1&&m.name?`${title} ${i+1}`:title;
}
function createRoute(){
  const routes=[...store.saved,...Object.values(store.drafts),route].filter(Boolean);
  const highest=Math.max(0,...routes.map(r=>Number(/^Route ([1-9]\d*)$/.exec(r.name)?.[1])||0));
  const number=Math.max(highest+1,Number(store.nextRouteNumber)||1);
  store.nextRouteNumber=number+1;
  return newRoute(dungeon,data.manifest.buildId,`Route ${number}`);
}
function selectDungeon(id,imported){
  if(route)persist();dungeon=data.dungeons.find(d=>d.id===id)||data.dungeons[0];
  positions=new Map(dungeon.enemies.map(e=>[e.placementId,e]));packNumbers=new Map([...new Set(dungeon.enemies.map(e=>e.packId))].map((id,i)=>[id,i+1]));
  try{route=imported||validateRoute(store.drafts[dungeon.id],data.dungeons,enemies);}catch{route=createRoute();}
  applyModifierPresets(route,dungeon,data['modifier-placements']);
  packNumbers.set('modifier:ghorn','Ghorn');packNumbers.set('modifier:witch','Witch');
  activePull=route.pulls[0]?.id??null;history=[];future=[];inspected=null;$('#inspector').hidden=true;$('#dungeon').value=dungeon.id;$('#search').value='';$('#search-results').hidden=true;
  const views=mapViews(dungeon);
  if($('#floors'))$('#floors').innerHTML=views.map((m,i)=>`<button data-floor="${i}">${esc(floorName(m,i))}</button>`).join('');
  updateFloorPanel();
  const start=views.findIndex(m=>m.name?.startsWith('Start'));
  const global=views.findIndex(m=>m.name==='Global');
  chooseFloor(views[0].sources?0:start>=0?start:global>=0?global:0);render();$('#pulls').scrollTop=0;scheduleSave();
}
function updateFloorPanel(){
  const panel=$('#floor-panel'),option=$('#floor-panel-option');
  if(!panel)return;
  const available=mapViews(dungeon).length>1;
  option.hidden=!available;
  panel.hidden=!available||!$('#show-floor-panel').checked;
}
function setDisplayOptions(open){
  $('#layers-panel').hidden=!open;
  $('#layers').setAttribute('aria-expanded',String(open));
}
function setMapImage(layer){
  const previous=$('#map-image');
  if(previous.getAttribute('href')===layer.path)return;
  const map=$('#map'),loading=$('#map-loading');
  map.style.visibility='hidden';map.setAttribute('aria-busy','true');
  loading.textContent='Loading map…';loading.hidden=false;
  // A separate element keeps late events from an earlier selection isolated.
  const image=svg('image',{id:'map-image',width:layer.width,height:layer.height});
  image.addEventListener('load',()=>{
    if($('#map-image')!==image)return;
    map.style.visibility='';map.setAttribute('aria-busy','false');loading.hidden=true;
  },{once:true});
  image.addEventListener('error',()=>{
    if($('#map-image')!==image)return;
    map.setAttribute('aria-busy','false');
    loading.textContent='Unable to load map. Select another map or reload to retry.';
  },{once:true});
  previous.replaceWith(image);image.setAttribute('href',layer.path);
}
function chooseFloor(index){
  clearTimeout(enemyHoverTimer);
  clearEnemyFocus();
  mapLayer=mapViews(dungeon)[index];draft=[];hideHover();
  setMapImage(mapLayer);
  let drawingClip=$('#drawing-map-clip');
  if(!drawingClip){drawingClip=svg('clipPath',{id:'drawing-map-clip',clipPathUnits:'userSpaceOnUse'});$('#map defs').append(drawingClip);}
  drawingClip.replaceChildren(svg('rect',{x:0,y:0,width:mapLayer.width,height:mapLayer.height}));
  $('#drawings').setAttribute('clip-path','url(#drawing-map-clip)');
  $$('[data-floor]').forEach((e,i)=>e.classList.toggle('active',i===index));fitMap();
}
function fitMap(){
  baseView={x:0,y:0,w:mapLayer.width,h:mapLayer.height};view={...baseView};renderMap();
}
function scale(){const r=$('#map').getBoundingClientRect();return Math.max(view.w/Math.max(r.width,1),view.h/Math.max(r.height,1));}
function render(){
  hideChickenTooltip();
  hidePullTooltip();
  refreshPositions();
  $('#route-name').value=route.name;const totals=scoreRoute(route,dungeon,enemies,data.shadow);
  $('#total-percent').innerHTML=`${totals.percent==null?'—':totals.percent.toFixed(2)}<span>%</span>`;
  $('#total-score').textContent=`${fmt(totals.score)} / ${fmt(dungeon.requiredScore)} points`;
  $('#progress-fill').style.width=`${Math.min(100,totals.percent||0)}%`;
  $('#progress-fill').style.background=totals.percent>=100?'var(--green)':'var(--gold)';
  const timeline=shadowTimeline(route,dungeon,enemies,data.shadow),orbs=orbCount(totals.orbScore,dungeon);
  if(route.shadow){$('#total-percent').innerHTML=`${orbs}<span> / ${shadowTarget(dungeon)} orbs</span>`;$('#progress-fill').style.width=`${Math.min(100,orbs/shadowTarget(dungeon)*100)}%`;$('#progress-fill').style.background=orbs>=shadowTarget(dungeon)?'var(--green)':'var(--gold)';}
  const remaining=dungeon.requiredScore-totals.score;
  $('#score-remaining').textContent=totals.unknown?`Unknown scores: ${totals.unknown} enemies` : remaining>0?`${fmt(remaining)} points to reach 100%`: `${fmt(-remaining)} extra points`;
  if(route.shadow){$('#total-score').textContent=`${fmt(totals.score)} KS · ${pct(totals.percent)}`;$('#score-remaining').textContent=`${Math.max(0,shadowTarget(dungeon)-orbs)} orbs remaining · estimated`;}
  $('#shadow').setAttribute('aria-pressed',String(route.shadow));
  for(const kind of ['empowered','ghorn','witch']){$('#'+kind).setAttribute('aria-pressed',String(route.modifiers[kind].active));$('#'+kind).disabled=kind==='empowered'?!route.modifiers.empowered.enemies.length:!route.modifiers[kind].packId;$('#'+kind).title=$('#'+kind).disabled?'No recorded placements in this dungeon':kind==='empowered'?`${route.modifiers.empowered.enemies.length} marked enemies`:`${route.modifiers[kind].packId?'G'+packNumbers.get(route.modifiers[kind].packId):'Choose a pack'}`;}
  $('#pull-count').textContent=route.pulls.length;$('#undo').disabled=!history.length;$('#redo').disabled=!future.length;
  const chickens=chickenPositions().length;
  const invis=route.drawings.filter(d=>d.kind==='invis').length;
  $('#route-relics').innerHTML=relicSummary(chickens,invis);
  $('#pulls').innerHTML=route.pulls.map((p,i)=>{
    const score=scorePull(p,dungeon,enemies,route,data.shadow);
    const members=p.enemies.map(id=>positions.get(id)).filter(Boolean);
    return `<article class="pull-card ${p.id===activePull?'selected':''}" style="--pull-color:${p.color}" data-pull="${p.id}" draggable="true" tabindex="0" role="button" aria-label="Select ${esc(p.name)}" aria-describedby="pull-tooltip"><div class="pull-top"><span class="pull-number">${String(i+1).padStart(2,'0')}</span><span class="pull-name">${esc(p.name)}</span><span class="pull-percent">${pct(score.percent)}</span></div><div class="pull-mob-count">${members.length} ${members.length===1?'mob':'mobs'}</div>${route.shadow?`<div class="pull-detail">${timeline[i].orbs} orbs · ${timeline[i].total} total orbs${timeline[i].spawns?' · Emissary':''}</div>`:''}${p.id===activePull?`<div class="pull-actions"><button data-action="rename" title="Name and color" aria-label="Edit pull">✎</button><button data-action="focus" title="Show on map" aria-label="Show pull on map">⌖</button><button data-action="up" ${i===0?'disabled':''} aria-label="Move pull up">↑</button><button data-action="down" ${i===route.pulls.length-1?'disabled':''} aria-label="Move pull down">↓</button><button data-action="delete" aria-label="Delete pull" title="Delete · can be undone">×</button></div>`:''}</article>`;
  }).join('');
  updateSaveButton();renderMap();if(inspected)renderInspector(inspected);
}
function matchesSearch(pos){const q=$('#search').value.trim().toLowerCase();if(!q)return true;return (enemies.get(pos.id)?.name||'').toLowerCase().includes(q)||`g${packNumbers.get(pos.packId)}`===q;}
function visiblePositions(){const owners=assigned();return currentPositions().filter(p=>!$('#hide-unselected').checked||owners.has(p.placementId));}
function relicSummary(chickens,invis){
  return [[chickenIcon,'Chicken',chickens],[relicIcons.invis,'Invisibility',invis]].map(([icon,name,count])=>`<span class="route-relic ${count?'present':''}" ${name==='Chicken'?'data-route-chicken tabindex="0" aria-describedby="chicken-tooltip"':`title="${name}: ${count}"`}><img src="${icon}" alt=""><span>${name}</span><b>${count}</b></span>`).join('');
}
function chickenPositions(){return route.excluded.map(id=>positions.get(id)).filter(p=>p&&!enemies.get(p.id)?.isBoss);}
let chickenTooltipTimer;
function hideChickenTooltip(){clearTimeout(chickenTooltipTimer);$('#chicken-tooltip').hidden=true;}
function deferHideChickenTooltip(){clearTimeout(chickenTooltipTimer);chickenTooltipTimer=setTimeout(hideChickenTooltip,120);}
function showChickenTooltip(anchor){
  clearTimeout(chickenTooltipTimer);hideHover();hidePullTooltip();
  const tip=$('#chicken-tooltip'),chickens=chickenPositions(),owners=assigned();
  const groups=[...route.pulls.map(p=>({name:p.name,id:p.id})),{name:'Not in a pull',id:null}];
  tip.innerHTML=`<strong>Chicken · ${chickens.length}</strong>${chickens.length?groups.map(group=>{
    const members=chickens.filter(p=>(owners.get(p.placementId)?.pull.id??null)===group.id);if(!members.length)return '';
    return `<div class="tip-pack-heading">${esc(group.name)}</div><ul class="tip-pack">${members.map(p=>{const enemy=enemies.get(p.id),icon=availableImage(enemy);return `<li class="tip-focus-row"><button type="button" data-focus-enemies="${esc(JSON.stringify([p.placementId]))}" title="Show on map">${icon?`<img src="${icon}" alt="">`:''}<span>${esc(enemy.name)}</span></button></li>`;}).join('')}</ul>`;
  }).join(''):'<div class="muted">No Chicken mobs in this route.</div>'}`;
  positionSidebarTooltip(tip,anchor);
}
function positionSidebarTooltip(tip,anchor){
  tip.hidden=false;tip.style.maxHeight=Math.max(100,window.innerHeight-16)+'px';
  const rect=anchor.getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight;
  tip.style.left=Math.max(8,Math.min(rect.left-width-8>=8?rect.left-width-8:rect.left,window.innerWidth-width-8))+'px';
  tip.style.top=Math.max(8,Math.min(rect.left-width-8>=8?rect.top:rect.bottom+8,window.innerHeight-height-8))+'px';
}
let pullTooltipTimer;
function hidePullTooltip(){clearTimeout(pullTooltipTimer);$('#pull-tooltip').hidden=true;}
function deferHidePullTooltip(){clearTimeout(pullTooltipTimer);pullTooltipTimer=setTimeout(hidePullTooltip,120);}
function showPullTooltip(anchor){
  const pull=route.pulls.find(p=>p.id===anchor.dataset.pull);if(!pull)return;
  clearTimeout(pullTooltipTimer);hideChickenTooltip();hideHover();
  const members=pull.enemies.map(id=>positions.get(id)).filter(Boolean),rows=[],ordinary=new Map();
  for(const p of members){
    const empowered=isEmpowered(p),chicken=route.excluded.includes(p.placementId);
    if(!empowered&&!chicken&&ordinary.has(p.id)){const row=ordinary.get(p.id);row.count++;row.ids.push(p.placementId);continue;}
    const row={p,count:1,ids:[p.placementId],empowered,chicken};rows.push(row);
    if(!empowered&&!chicken)ordinary.set(p.id,row);
  }
  const tip=$('#pull-tooltip'),score=scorePull(pull,dungeon,enemies,route,data.shadow);
  tip.dataset.pull=pull.id;
  tip.innerHTML=`<strong>${esc(pull.name)}</strong><div class="tip-score">${pct(score.percent)} · ${members.length} ${members.length===1?'mob':'mobs'}</div>${rows.length?`<ul class="tip-pack">${rows.map(({p,count,ids,empowered,chicken})=>{
    const enemy=enemies.get(p.id),icon=availableImage(enemy);
    return `<li class="tip-focus-row"><button type="button" data-focus-enemies="${esc(JSON.stringify(ids))}" title="Show on map">${icon?`<img src="${icon}" alt="">`:''}<span>${esc(enemy.name)}${count>1?` ×${count}`:''}</span><span class="tip-pack-status">${empowered?`<img src="${empoweredIcon}" alt="Empowered" title="Empowered">`:''}${chicken?`<img src="${chickenIcon}" alt="Chicken" title="Chicken">`:''}</span></button></li>`;
  }).join('')}</ul>`:'<div class="muted">No mobs in this pull.</div>'}`;
  positionSidebarTooltip(tip,anchor);
}
function focusListedEnemies(ids){
  hidePullTooltip();hideChickenTooltip();
  if(ids.some(id=>positions.get(id)?.mapPosition)){
    $('#search').value='';$('#search-results').hidden=true;
    const owners=assigned();if(ids.some(id=>!owners.has(id)))$('#hide-unselected').checked=false;
  }
  focusEnemies(ids,{preserveZoom:true});$('#map').focus({preventScroll:true});
}
function setHoveredPack(packId){
  hoveredPack=packId;
  for(const path of $$('#patrols [data-pack]')){
    const highlighted=$('#show-patrols').checked&&packId===path.dataset.pack;
    path.classList.toggle('highlighted',highlighted);
    path.style.display=$('#show-patrols').checked?'':'none';
  }
}
function hideHover(){hoveredPack=null;$('#tooltip').hidden=true;setHoveredPack(null);}
function positionPopover(element,event){
  const rect=$('#map-stage').getBoundingClientRect();
  element.hidden=false;element.style.maxHeight=Math.max(100,rect.height-10)+'px';
  element.style.left=Math.max(5,Math.min(event.clientX-rect.left+17,rect.width-element.offsetWidth-5))+'px';
  element.style.top=Math.max(5,Math.min(event.clientY-rect.top+15,rect.height-element.offsetHeight-5))+'px';
}
function toggleChicken(id){
  const p=positions.get(id);if(!p||enemies.get(p.id)?.isBoss)return;
  change(()=>{route.excluded=route.excluded.includes(id)?route.excluded.filter(v=>v!==id):[...route.excluded,id];});
}
function showEnemyMenu(id,event){
  const p=positions.get(id);if(!p)return;
  hideHover();const menu=$('#enemy-menu'),enemy=enemies.get(p.id);
  menu.setAttribute('aria-label','Enemy actions');
  menu.innerHTML=`<div class="enemy-menu-name">${esc(enemy.name)}</div>${!enemy.isBoss?`<button role="menuitem" data-enemy-action="chicken">${route.excluded.includes(id)?'Remove Chicken':'Add Chicken'}</button>`:''}<button role="menuitem" data-enemy-action="info">Info</button>`;
  positionPopover(menu,event);
  menu.onclick=e=>{const action=e.target.closest('[data-enemy-action]')?.dataset.enemyAction;if(!action)return;menu.hidden=true;if(action==='chicken')toggleChicken(id);else renderInspector(id);};
  menu.querySelector('button').focus({preventScroll:true});
}
function showDrawingMenu(id,event){
  const drawing=route.drawings.find(d=>d.id===id);if(!drawing)return;
  hideHover();const menu=$('#enemy-menu'),name={line:'arrow',portal:'portal',invis:'invis',note:'note'}[drawing.kind];
  menu.setAttribute('aria-label','Drawing actions');
  menu.innerHTML=`${drawing.kind==='note'?'<button role="menuitem" data-drawing-action="edit">Edit note</button>':''}<button role="menuitem" data-drawing-action="delete">Delete ${name}</button>`;
  menu.onclick=e=>{const action=e.target.closest('[data-drawing-action]')?.dataset.drawingAction;if(!action)return;menu.hidden=true;if(action==='edit')editNote(drawing);else{change(()=>route.drawings=route.drawings.filter(d=>d.id!==id));$('#map').focus();}};
  positionPopover(menu,event);menu.querySelector('button').focus({preventScroll:true});
}
function editNote(drawing,pos){
  showDialog(drawing?'Edit note':'Map note',`<textarea id="map-note" placeholder="For example: portal after this pack…" maxlength="500" aria-label="Note text">${esc(drawing?.text||'')}</textarea><button id="place-note" class="primary">${drawing?'Save':'Add'}</button>`);
  const input=$('#map-note');input.focus();input.setSelectionRange(input.value.length,input.value.length);
  $('#place-note').onclick=()=>{const text=$('#map-note').value.trim();if(!text){$('#map-note').focus();return;}
    change(()=>{if(drawing){const note=route.drawings.find(d=>d.id===drawing.id);if(note)note.text=text;}else route.drawings.push({id:uid(),mapId:mapLayer.id,kind:'note',color:(active()?.color||pullColor(0)),text,points:[pos]});});
    $('#dialog').close();setTool('select');
  };
}
function setArrowOptions(open){$('#arrow-options').hidden=!open;$('[data-tool="line"]').setAttribute('aria-expanded',String(open));}
function closeArrowOptions(){setArrowOptions(false);}
function renderCampfires(){
  const root=$('#campfires');root.replaceChildren();
  // Fixed map units: both position and size follow the map's zoom and pan.
  const size=mapLayer.width*16/1400;
  for(const {id,point:[x,y]} of mapCampfires(dungeon,mapLayer)){
    const g=svg('g',{'data-campfire':id,transform:`translate(${x} ${y})`,role:'img','aria-label':'Campfire','pointer-events':'none'});
    g.append(svg('title',{},'Campfire'),svg('image',{href:'images/pois/bonfire.avif',x:-size/2,y:-size/2,width:size,height:size}));root.append(g);
  }
}
function renderMapStart(unit){
  const root=$('#map-start');root.replaceChildren();
  const point=mapStart(dungeon,mapLayer);if(!point)return;
  const [x,y]=point,marker=svg('g',{transform:`translate(${x} ${y}) scale(${unit})`,role:'img','aria-label':'Dungeon start'});
  marker.append(svg('title',{},'Dungeon start'),
    svg('circle',{r:14,fill:'#17231f',stroke:'#8dd7b5','stroke-width':2}),
    svg('path',{d:'M -4 8 V -8 M -4 -7 H 7 L 4 -3 L 7 1 H -4',fill:'none',stroke:'#c8f7df','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}),
    svg('text',{x:0,y:28,'text-anchor':'middle','font-family':'Segoe UI,sans-serif','font-size':11,'font-weight':800,'letter-spacing':1,fill:'#e3fff0',stroke:'#12231b','stroke-width':3,'stroke-linejoin':'round','paint-order':'stroke'},'START'));
  root.append(marker);
}
function renderMap(){
  if(!mapLayer||!view)return;
  $('#enemy-menu').hidden=true;$('#tooltip').hidden=true;
  $('#map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
  const showIcons=$('#show-mob-icons').checked;
  const iconPadding=showIcons?(baseView.w/view.w>=1.5?5:3):0;
  const unit=scale(),radius=(Number($('#marker-size').value)+iconPadding)*.75*unit,owners=assigned();
  renderMapStart(unit);
  renderCampfires();
  const markerRoot=$('#markers');markerRoot.replaceChildren();$('#patrols').replaceChildren();$('#pack-labels').replaceChildren();$('#status-badges').replaceChildren();
  const visible=visiblePositions();const sorted=[...visible].sort((a,b)=>Number(enemies.get(a.id)?.isBoss)-Number(enemies.get(b.id)?.isBoss));
  $('#pull-outlines').replaceChildren();$('#pull-labels').replaceChildren();
  for(const [i,pull] of route.pulls.entries()){
    const members=visible.filter(p=>owners.get(p.placementId)?.pull.id===pull.id);if(!members.length)continue;
    const points=members.map(coordinates),padding=radius*1.6+9*unit,hull=pullOutline(points,padding),selected=pull.id===activePull;
    const g=svg('g',{'data-pull-outline':pull.id,'pointer-events':'none'});
    g.append(svg('polygon',{points:hull.map(p=>p.join(',')).join(' '),fill:pull.color,'fill-opacity':selected?.18:.1,stroke:pull.color,'stroke-width':selected?3.5:2.5,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));
    $('#pull-outlines').append(g);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const singlePack=new Set(pull.enemies.map(id=>positions.get(id)?.packId).filter(Boolean)).size===1;
    const right=Math.max(...xs)+padding+15*unit;
    const x=singlePack?(right+11*unit>view.x+view.w?Math.min(...xs)-padding-15*unit:right):(Math.min(...xs)+Math.max(...xs))/2,y=(Math.min(...ys)+Math.max(...ys))/2;
    const label=svg('g',{'data-pull-label':pull.id});
    label.append(svg('circle',{cx:x,cy:y,r:11*unit,fill:pull.color,stroke:'#111820','stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('text',{x,y,'text-anchor':'middle','dominant-baseline':'central','font-size':12*unit,'font-weight':700,fill:'#fff'},i+1));
    $('#pull-labels').append(label);
  }
  const patrolPaths=new Set();
  for(const p of sorted){
    const enemy=enemies.get(p.id),own=owners.get(p.placementId),chicken=!enemy?.isBoss&&route.excluded.includes(p.placementId),[x,y]=coordinates(p),r=enemy?.isBoss?radius*1.6:radius;
    const portrait=chicken?chickenIcon:showIcons&&availableImage(enemy),hasPortrait=portrait&&!failedMobImages.has(portrait);
    const empowered=isEmpowered(p);
    const color=own?.pull.color||(enemy?.isBoss?'#df858c':'#a6bfcc');
    const group=svg('g',{'data-placement':p.placementId,role:'button',tabindex:0,'aria-label':`${enemy?.name||p.id}, ${p.modifier?enemies.get(p.id).name:'G'+packNumbers.get(p.packId)}, ${fmt(pointScore(p))} points`,opacity:matchesSearch(p)?1:.14});
    if(empowered){
      group.setAttribute('aria-label',group.getAttribute('aria-label')+', Empowered');
      group.append(svg('circle',{cx:x,cy:y,r:r+unit*3,fill:'none',stroke:'#171006','stroke-width':6,'vector-effect':'non-scaling-stroke'}),svg('circle',{cx:x,cy:y,r:r+unit*3,fill:'none',stroke:'#ffbb25','stroke-width':3,'vector-effect':'non-scaling-stroke'}));
    }
    if(chicken)group.setAttribute('aria-label',group.getAttribute('aria-label')+', Chicken');
    for(const status of [empowered&&{kind:'empowered',name:'Empowered',icon:empoweredIcon,side:-1}].filter(Boolean)){
      const bx=x+status.side*r*.85,by=y-r*.9,br=7*unit;
      const badge=svg('g',{['data-'+status.kind+'-badge']:p.placementId,'data-placement':p.placementId,opacity:matchesSearch(p)?1:.14,style:'cursor:pointer'});
      badge.append(svg('title',{},`${enemy.name} · ${status.name}`),svg('circle',{cx:bx,cy:by,r:br+2*unit,fill:'#1a1005',stroke:'#ffbb25','stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('image',{href:status.icon,x:bx-br,y:by-br,width:br*2,height:br*2,'clip-path':'url(#mob-portrait-clip)',preserveAspectRatio:'xMidYMid slice','pointer-events':'none'}));
      $('#status-badges').append(badge);
    }
    group.append(svg('circle',{cx:x,cy:y,r:r+unit*2,fill:'#10161bcc'}));
    group.append(svg('circle',{cx:x,cy:y,r,fill:own?color:'#263640'}));
    if(hasPortrait){
      const image=svg('image',{href:portrait,x:x-r,y:y-r,width:r*2,height:r*2,preserveAspectRatio:'xMidYMid slice','clip-path':'url(#mob-portrait-clip)','pointer-events':'none'});
      image.addEventListener('error',()=>{failedMobImages.add(portrait);renderMap();},{once:true});
      group.append(image);
    }
    group.append(svg('circle',{cx:x,cy:y,r,fill:'none',stroke:chicken?'#ffcd70':color,class:'mob-ring'+(chicken?' chicken-ring':'')}));
    if(enemy?.isBoss||p.modifier){
      const label=p.modifier?p.modifier[0].toUpperCase():'◆';
      const labelX=hasPortrait?x+r*.75:x,labelY=hasPortrait?y+r*.75:y;
      if(hasPortrait)group.append(svg('circle',{cx:labelX,cy:labelY,r:unit*Math.max(6,String(label).length*3+2),fill:color,stroke:'#10161b','stroke-width':1,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));
      group.append(svg('text',{x:labelX,y:labelY+unit*3.1,'text-anchor':'middle','font-size':unit*(enemy?.isBoss?10:8),'font-family':'Segoe UI,sans-serif','font-weight':700,fill:'#fff','pointer-events':'none'},label));
    }
    appendEnemyFocus(group);
    markerRoot.append(group);
    const referencePatrol=mapLayer.patrols?.[mapLayer.placementPatrols?.[p.placementId]];
    if(referencePatrol?.length>1||p.mapPatrolPath?.length>1){
      // Separate paths at floor transitions; never draw across unrelated layers.
      let segment=[];const flush=()=>{if(segment.length>1){const points=segment.join(' '),key=p.packId+'|'+points;if(!patrolPaths.has(key)){patrolPaths.add(key);$('#patrols').append(svg('polyline',{'data-pack':p.packId,class:'patrol-path',points,fill:'none',stroke:color,'stroke-width':1.8,'stroke-dasharray':'5 4','vector-effect':'non-scaling-stroke',opacity:.85}));}}segment=[];};
      if(referencePatrol)segment=referencePatrol.map(xy=>xy.join(','));
      else for(const [i,pt] of p.mapPatrolPath.entries()){if(i&&pt.mapImageId!==p.mapPatrolPath[i-1].mapImageId)flush();if(onMap(pt,mapLayer)){const xy=coordinates({...pt,worldPosition:p.patrolPath?.[i]});if(xy)segment.push(xy.join(','));else flush();}else flush();}flush();
    }
  }
  setHoveredPack(hoveredPack);
  if($('#show-packs').checked){
    const packs=new Map();for(const p of visible){if(!matchesSearch(p))continue;if(!packs.has(p.packId))packs.set(p.packId,[]);packs.get(p.packId).push(p);}
    const placedLabels=[];
    const orderedPacks=[...packs].sort((a,b)=>Number(b[1].some(p=>owners.get(p.placementId)?.pull.id===activePull))-Number(a[1].some(p=>owners.get(p.placementId)?.pull.id===activePull)));
    for(const [id,ps]of orderedPacks){
      // Keep room for status badges without moving the label when a status changes.
      const points=ps.map(coordinates),x=points.reduce((s,p)=>s+p[0],0)/ps.length,y=Math.min(...points.map(p=>p[1]))-radius-30*unit;
      const score=ps.reduce((s,p)=>s+(pointScore(p)||0),0);
      const label=`${ps[0].modifier?enemies.get(ps[0].id).name:'G'+packNumbers.get(id)} · ${pct(score/dungeon.requiredScore*100)}`;
      const width=label.length*5.7*unit,box={x:x-width/2,y:y-11*unit,w:width,h:15*unit};
      if(placedLabels.some(r=>box.x<r.x+r.w&&box.x+box.w>r.x&&box.y<r.y+r.h&&box.y+box.h>r.y))continue;
      placedLabels.push(box);
      $('#pack-labels').append(svg('text',{x,y,'text-anchor':'middle','font-size':10*unit,'font-family':'Segoe UI,sans-serif',fill:'#e6e4dc',stroke:'#0a1119','stroke-width':3*unit,'paint-order':'stroke','stroke-linejoin':'round'},label));
    }
  }
  $('#drawings').replaceChildren();for(const d of route.drawings){const projected=drawingOnMap(drag?.edit?.id===d.id?drag.edit:d,mapLayer,dungeon);if(projected)drawAnnotation(projected,$('#drawings'),unit);}
  renderDraft();
}
function drawAnnotation(d,root,unit){
  const color=relicColors[d.kind]||d.color;
  const isDraft=d.id==='draft',width=d.kind==='line'?(d.width||3):3;
  const g=svg('g',{'data-drawing':d.id,class:`annotation${drag?.edit?.id===d.id?' editing':''}`,...(!isDraft?{tabindex:0,role:'group','aria-label':d.kind==='line'?'Arrow':d.kind==='note'?'Note: '+d.text:d.kind}:{'pointer-events':'none'})});
  if(d.kind==='note'){
    if(!isDraft){g.setAttribute('data-endpoint','0');g.classList.add('annotation-handle');}
    const number=route.drawings.filter(item=>item.kind==='note').findIndex(item=>item.id===d.id)+1;
    const [x,y]=d.points[0];g.append(svg('circle',{cx:x,cy:y,r:Math.max(9,4+String(number).length*3)*unit,fill:'#11171b',stroke:'#ffffff','stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('text',{x,y:y+3.5*unit,'text-anchor':'middle','font-size':11*unit,'font-weight':700,fill:'#ffffff'},number));
  }else{
    const points=(d.kind==='line'?[d.points[0],d.points.at(-1)]:d.points).map(p=>p.join(',')).join(' ');
    if(!isDraft)g.append(svg('polyline',{points,fill:'none',stroke:'transparent','stroke-width':Math.max(16,width*6),'vector-effect':'non-scaling-stroke','pointer-events':'stroke','stroke-linecap':'round'}));
    g.append(svg('polyline',{class:'annotation-line',points,fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke','stroke-linecap':'round','stroke-linejoin':'round','stroke-dasharray':d.kind==='invis'?'7 6':d.kind==='portal'?'3 7':'none','marker-end':d.kind==='line'&&d.points.length===2?'url(#arrowhead)':'none'}));
    if(d.kind==='line'&&!isDraft)for(const [i,[x,y]]of d.points.entries())g.append(svg('circle',{class:'arrow-handle','data-endpoint':i,cx:x,cy:y,r:6*unit,fill:color,stroke:'#fff','stroke-width':1.5,'vector-effect':'non-scaling-stroke'}));
    if(relicIcons[d.kind])for(const [i,[x,y]] of d.points.entries()){
      const endpoint=svg('g',isDraft?{}:{class:'annotation-handle','data-endpoint':i});
      endpoint.append(svg('rect',{x:x-14*unit,y:y-14*unit,width:28*unit,height:28*unit,rx:4*unit,fill:'#1a2330',stroke:color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('image',{href:relicIcons[d.kind],x:x-12*unit,y:y-12*unit,width:24*unit,height:24*unit,'pointer-events':'none'}));g.append(endpoint);
    }
  }
  root.append(g);
}
function renderDraft(preview){const root=$('#draft');root.replaceChildren();if(draft.length)drawAnnotation({id:'draft',mapId:mapLayer.id,kind:tool,color:tool==='line'?arrowColor:(active()?.color||pullColor(0)),width:arrowWidth,points:preview?[draft[0],preview]:draft},root,scale());}
function point(event){const p=$('#map').createSVGPoint();p.x=event.clientX;p.y=event.clientY;const v=p.matrixTransform($('#map').getScreenCTM().inverse());return[v.x,v.y];}
function draggedDrawingPoint(event,state){const pos=point(event).map((v,i)=>v+state.offset[i]);return drawingPointFromMap(pos,state.edit,mapLayer,dungeon);}
function zoom(factor,at){const anchor=at||[view.x+view.w/2,view.y+view.h/2];if(view.w*factor<baseView.w/12||view.w*factor>baseView.w*2.5)return;view={x:anchor[0]+(view.x-anchor[0])*factor,y:anchor[1]+(view.y-anchor[1])*factor,w:view.w*factor,h:view.h*factor};renderMap();}
function setTool(value,{cancel=false}={}){
  if(value!=='line')closeArrowOptions();
  if(value!==tool||cancel){
    draft=[];
  }
  tool=value;$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$('#map').style.cursor=['select'].includes(tool)?'grab':'crosshair';$$('[data-configure]').forEach(b=>b.classList.toggle('active',b.dataset.configure===tool));renderMap();
}
function choosePacks(ids,options){
  const available=effectivePositions(route,dungeon),selected=new Set(ids);
  const packs=new Set(available.filter(p=>selected.has(p.placementId)).map(p=>p.packId));
  const members=available.filter(p=>packs.has(p.packId)).map(p=>p.placementId);
  if(members.length)change(()=>{if(!active()){const pull=newPull();route.pulls.push(pull);activePull=pull.id;}assignEnemies(route,activePull,members,options);});
}
function chooseEnemy(id){choosePacks([id]);}
function commitDrawing(){if(draft.length!==2)return;const drawing={id:uid(),mapId:mapLayer.id,kind:tool,color:relicColors[tool]||arrowColor,...(tool==='line'?{width:arrowWidth}:{}),points:draft.map(p=>[...p])};draft=[];change(()=>route.drawings.push(drawing));}
function showDialog(title,html){$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function showScoreInfo(){
  showDialog('Scoring',`<p>Kill score: selected mobs ÷ dungeon requirement. Replaced packs and Chicken mobs contribute zero.</p><p>Empowered: 3× raw score, 2× base health. Ghorn / Witch: 20 KS each.</p><p>Shadow Lord: estimated orbs from cumulative raw score; 30 orbs per Emissary. Miniboss replacements do not generate orbs in this model.</p><p class="muted">Modifier rules are historical and unverified for the current patch. Modifier targets are matched automatically by enemy name and world coordinates from reference data. Disabled modifiers have no recorded placements.</p>`);
}
function showHelp(){showDialog('Start your route with a pull',`<div class="help-grid"><kbd>Click</kbd><span>Add or remove a whole pack in the active pull.</span><kbd>Right-click enemy</kbd><span>Add or remove Chicken, or choose Info for stats and abilities.</span><kbd>B / V</kbd><span>Box selection of whole packs / pack selection.</span><kbd>N</kbd><span>Create and select the next pull.</span><kbd>D · Esc</kbd><span>Draw an arrow with two clicks · cancel. Choose color and thickness beside the arrow tool. Hover an arrow and drag either endpoint.</span><kbd>Right-click drawing</kbd><span>Delete an arrow, portal or invisibility path; edit or delete a note. Hover a numbered note to read its text.</span><kbd>Scroll / F</kbd><span>Zoom / fit the map.</span><kbd>Drag</kbd><span>Pan the map. With other tools, drag using the right mouse button.</span><kbd>Ctrl + Z / Y</kbd><span>Undo / redo a change.</span></div><p>Drag pulls to reorder them. Selecting an enemy assigned to another pull moves its whole pack to the active pull without double-counting. Routes are stored in this browser; export JSON to keep a separate copy.</p><p>The counter uses the base kill scores of selected enemies. <button id="help-score" class="text-button">Shadow Lord calculations and limitations ↗</button></p>`);$('#help-score').onclick=showScoreInfo;}
function renderInspector(id){
  const p=positions.get(id);if(!p){inspected=null;$('#inspector').hidden=true;return;}inspected=id;const e=enemies.get(p.id),score=pointScore(p),abilities=enemyAbilities(data.abilities,p.id);
  $('#inspector').innerHTML=`<button class="close-inspector" aria-label="Close enemy details">×</button><div class="enemy-profile">${availableImage(e)?'<img src="'+availableImage(e)+'" alt="">':''}<div><h2>${esc(e.name)}</h2><small>${p.modifier?enemies.get(p.id).name:'G'+packNumbers.get(p.packId)} · ${e.isBoss?'Boss':e.canBeControlled?'Can be crowd-controlled':'Immune to crowd control'}</small></div></div><div class="enemy-facts"><div><span>Score ${route.shadow?'· archived SL':''}</span>${fmt(score)} / ${pct(score/dungeon.requiredScore*100)}</div><div><span>Base health</span>${e.baseHealth?fmt(Math.round(e.baseHealth*(!e.isBoss&&route.modifiers.empowered.active&&route.modifiers.empowered.enemies.includes(id)?2:1))):'—'}</div></div>${route.modifiers.empowered.active&&route.modifiers.empowered.enemies.includes(id)?'<small class="empowered-label">Empowered</small>':''}<h3>ABILITIES · ${abilities.length}</h3>${abilities.length?abilities.map(a=>`<div class="ability"><strong>${esc(a.name)}</strong>${a.description?.replace(/<[^>]*>/g,'').trim()?'<p>'+esc(a.description.replace(/<[^>]*>/g,''))+'</p>':''}<small>${a.castInterruptibility==='always'?'Interruptible':a.castInterruptibility==='sometimes'?'Interruptibility depends on phase':a.castInterruptibility==='never'?'Not interruptible':''}${a.baseCooldownSeconds?' · CD '+fmt(a.baseCooldownSeconds)+' s':''}</small></div>`).join(''):'<p class="muted">No descriptions are available in the dataset.</p>'}`;
  $('#inspector').hidden=false;$('.close-inspector').onclick=()=>{$('#inspector').hidden=true;inspected=null;};
}
function clearEnemyFocus(){
  clearTimeout(enemyFocusTimer);focusedEnemies.clear();enemyFocusUntil=0;
  $$('.mob-focus-ring').forEach(ring=>ring.remove());
}
function appendEnemyFocus(group){
  if(!focusedEnemies.has(group.dataset.placement)||performance.now()>=enemyFocusUntil)return;
  const ring=group.querySelector('.mob-ring');
  group.append(svg('circle',{cx:ring.getAttribute('cx'),cy:ring.getAttribute('cy'),r:Number(ring.getAttribute('r'))+7*scale(),class:'mob-focus-ring','pointer-events':'none',style:`animation-duration:${enemyFocusDuration}ms;animation-delay:${Math.min(0,enemyFocusUntil-performance.now()-enemyFocusDuration)}ms`}));
}
function highlightEnemies(ids){
  clearTimeout(enemyHoverTimer);
  clearEnemyFocus();focusedEnemies=new Set(ids);enemyFocusUntil=performance.now()+enemyFocusDuration;
  for(const group of $$('#markers > g'))appendEnemyFocus(group);
  enemyFocusTimer=setTimeout(clearEnemyFocus,enemyFocusDuration);
}
function enemiesInViewport(ps){
  const bounds=$('#map').getBoundingClientRect(),margin=12;
  const markers=new Map($$('#markers > g').map(group=>[group.dataset.placement,group]));
  return ps.every(p=>{
    const ring=markers.get(p.placementId)?.querySelector('.mob-ring');if(!ring)return false;
    const rect=ring.getBoundingClientRect();
    return rect.left>=bounds.left+margin&&rect.right<=bounds.right-margin&&rect.top>=bounds.top+margin&&rect.bottom<=bounds.bottom-margin;
  });
}
function focusEnemies(ids,{preserveZoom=false}={}){
  const ps=ids.map(id=>positions.get(id)).filter(Boolean),first=ps.find(p=>p.mapPosition);
  if(!first){toast('No map coordinates are available for these enemies.');return;}
  renderMap();
  if(enemiesInViewport(ps.filter(p=>p.mapPosition))){highlightEnemies(ids);return;}
  const zoomRatio={w:view.w/baseView.w,h:view.h/baseView.h};
  const views=mapViews(dungeon),useFull=views[0].sources&&(mapLayer.sources||new Set(ps.filter(p=>p.mapPosition).map(p=>p.mapImageId)).size>1);
  const fullIndex=mapLayer.sources?views.findIndex(m=>m.id===mapLayer.id):0;
  chooseFloor(useFull?fullIndex:views.findIndex(m=>m.id===first.mapImageId));
  const points=ps.filter(p=>onMap(p,mapLayer)).map(coordinates),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const w=preserveZoom?baseView.w*zoomRatio.w:Math.max(mapLayer.width*.12,Math.max(...xs)-Math.min(...xs)+mapLayer.width*.05),h=preserveZoom?baseView.h*zoomRatio.h:Math.max(mapLayer.height*.16,Math.max(...ys)-Math.min(...ys)+mapLayer.height*.05);
  view={x:cx-w/2,y:cy-h/2,w,h};renderMap();
  highlightEnemies(ids);
}
function updateSaveButton(){
  let saved=store.saved.find(r=>r.id===route.id);
  if(saved){try{saved=validateRoute(saved,data.dungeons,enemies);applyModifierPresets(saved,dungeon,data['modifier-placements']);}catch{saved=null;}}
  const changed=hasRouteChanges({...route,name:$('#route-name').value.trim()||route.name},saved);
  $('#save-route').disabled=!changed;
  $('#delete-route').hidden=!store.saved.some(r=>r.id===route.id);
  $('#save-route').title=changed?'Save changes to this browser’s library':saved?'No unsaved changes':'No changes to save';
}
function saveNamed(){route.name=$('#route-name').value.trim()||route.name;const saved=structuredClone(route);const i=store.saved.findIndex(r=>r.id===saved.id);if(i>=0)store.saved[i]=saved;else store.saved.push(saved);persist();updateSaveButton();toast('Route saved to this browser’s library.');}
function removeSavedRoute(i){
  if(i<0)return;
  const removed=store.saved.splice(i,1)[0];persist();updateSaveButton();showDialog('Route removed from the library',`<p>${esc(removed.name)}</p><button id="restore-saved" class="primary">Restore route</button>`);$('#restore-saved').onclick=()=>{store.saved.splice(i,0,removed);persist();updateSaveButton();showLibrary();};
}
function showLibrary(){
  showDialog('Saved routes',store.saved.length?store.saved.map((r,i)=>`<div class="library-item"><div><strong>${esc(r.name)}</strong><small>${esc(data.dungeons.find(d=>d.id===r.dungeonId)?.name)} · ${r.pulls.length} pulls${r.shadow?' · Shadow Lord (archived)':''}</small></div><div><button data-load="${i}">Open</button><button data-remove="${i}" aria-label="Delete saved route">×</button></div></div>`).join(''):'<p class="empty-library">Your saved routes will appear here.<br>Click “Save route” below the pull list.</p>');
  $$('[data-load]').forEach(b=>b.onclick=()=>{try{const r=validateRoute(store.saved[Number(b.dataset.load)],data.dungeons,enemies);selectDungeon(r.dungeonId,r);$('#dialog').close();}catch(e){toast(e.message);}});
  $$('[data-remove]').forEach(b=>b.onclick=()=>removeSavedRoute(Number(b.dataset.remove)));
}
async function copyRouteText(text,title,message){
  try{await navigator.clipboard.writeText(text);toast(message);return;}catch{}
  // Local files and browsers without clipboard permission can still copy selected text.
  showDialog(title,'<p>Copy the selected text below.</p><textarea id="copy-route-text" aria-label="Text to copy" readonly spellcheck="false"></textarea><button id="copy-route-button" class="primary">Copy</button>');
  const field=$('#copy-route-text');field.value=text;field.focus();field.select();
  const copy=()=>{field.focus();field.select();try{if(document.execCommand('copy')){$('#dialog').close();toast(message);return true;}}catch{}return false;};
  $('#copy-route-button').onclick=copy;copy();
}
function exportRoute(){persist();return copyRouteText(JSON.stringify(route),'Export route','Route copied to clipboard.');}
function shareRoute(){
  persist();const url=new URL(location.href);url.hash='route='+encodeURIComponent(JSON.stringify(route));
  return copyRouteText(url.href,'Share route','Route link copied to clipboard.');
}
function importRouteText(text){
  text=text.trim();
  if(!text)throw new Error('Paste a route string first.');
  if(text.length>27_000_000)throw new Error('Route is too large (maximum 3 MB).');
  if(text.startsWith('#route='))text=decodeURIComponent(text.slice(7));
  else if(!text.startsWith('{')){
    let url;try{url=new URL(text);}catch{throw new Error('Paste a valid route JSON string or Share link.');}
    if(!url.hash.startsWith('#route='))throw new Error('This link does not contain a route.');
    text=decodeURIComponent(url.hash.slice(7));
  }
  if(new TextEncoder().encode(text).length>3_000_000)throw new Error('Route is too large (maximum 3 MB).');
  const incoming=validateRoute(JSON.parse(text),data.dungeons,enemies);incoming.id=uid();
  selectDungeon(incoming.dungeonId,incoming);
  toast(incoming.buildId!==data.manifest.buildId?'Imported a route from another build. Check scores and pull contents.':'Route imported.');
}
function showImport(){
  showDialog('Import route','<label for="import-route-text">Paste a route string or Share link</label><textarea id="import-route-text" spellcheck="false" placeholder="Paste exported JSON or a Share link"></textarea><p id="import-error" role="alert" hidden></p><button id="import-route-button" class="primary">Import</button>');
  $('#import-route-text').focus();
  $('#import-route-button').onclick=()=>{
    try{importRouteText($('#import-route-text').value);$('#dialog').close();}
    catch(err){$('#import-error').textContent='Import: '+err.message;$('#import-error').hidden=false;}
  };
}
function importRouteHash(){
  if(!location.hash.startsWith('#route='))return;
  try{importRouteText(location.hash);}catch(err){toast('Import: '+err.message);}
}
function search(){
  renderMap();const q=$('#search').value.trim();$('#search-results').hidden=!q;if(!q)return;
  const result=effectivePositions(route,dungeon).filter(matchesSearch);const groups=new Map();result.forEach(p=>{const key=p.id+':'+p.packId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
  $('#search-results').innerHTML=[...groups.values()].slice(0,35).map(ps=>`<button data-search-id="${ps[0].placementId}">${esc(enemies.get(ps[0].id)?.name)} <span class="muted">× ${ps.length} · G${packNumbers.get(ps[0].packId)}</span></button>`).join('')||'<p class="muted" style="padding:12px">No results found</p>';
}
function addPull(){change(()=>{const p=newPull(route.pulls.length);let index=route.pulls.length;while(route.pulls.some(pull=>pull.color===p.color))p.color=pullColor(++index);route.pulls.push(p);activePull=p.id;});$('#pulls').scrollTop=$('#pulls').scrollHeight;}
function bind(){
  const pullList=$('#pulls'),pullTip=$('#pull-tooltip');
  for(const list of [pullTip,$('#chicken-tooltip'),$('#search-results')]){
    const highlightRow=e=>{
      const button=e.target.closest('[data-focus-enemies],[data-search-id]');
      if(!button||button.contains(e.relatedTarget))return;
      clearTimeout(enemyHoverTimer);
      const ids=button.dataset.focusEnemies?JSON.parse(button.dataset.focusEnemies):[button.dataset.searchId];
      if(e.type==='focusin'){highlightEnemies(ids);return;}
      enemyHoverTimer=setTimeout(()=>{
        if(button.isConnected&&button.getClientRects().length&&button.matches(':hover'))highlightEnemies(ids);
      },enemyHoverDelay);
    };
    list.addEventListener('pointerover',highlightRow);
    list.addEventListener('pointerout',e=>{
      const button=e.target.closest('[data-focus-enemies],[data-search-id]');
      if(button&&!button.contains(e.relatedTarget))clearTimeout(enemyHoverTimer);
    });
    list.addEventListener('focusin',highlightRow);
  }
  pullList.addEventListener('pointerover',e=>{const card=e.target.closest('[data-pull]');if(e.target.closest('button')){hidePullTooltip();return;}if(card&&(pullTip.hidden||pullTip.dataset.pull!==card.dataset.pull))showPullTooltip(card);});
  pullList.addEventListener('pointerout',e=>{const card=e.target.closest('[data-pull]');if(card&&!card.contains(e.relatedTarget))deferHidePullTooltip();});
  pullList.addEventListener('focusin',e=>{if(e.target.matches('.pull-card'))showPullTooltip(e.target);});
  pullList.addEventListener('focusout',deferHidePullTooltip);
  pullList.addEventListener('scroll',hidePullTooltip);
  pullList.addEventListener('dragstart',hidePullTooltip);
  pullTip.addEventListener('pointerenter',()=>clearTimeout(pullTooltipTimer));
  pullTip.addEventListener('pointerleave',deferHidePullTooltip);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hidePullTooltip();});
  window.addEventListener('resize',hidePullTooltip);
  const relics=$('#route-relics'),chickenTip=$('#chicken-tooltip');
  relics.addEventListener('pointerover',e=>{const anchor=e.target.closest('[data-route-chicken]');if(anchor&&!anchor.contains(e.relatedTarget))showChickenTooltip(anchor);});
  relics.addEventListener('pointerout',e=>{const anchor=e.target.closest('[data-route-chicken]');if(anchor&&!anchor.contains(e.relatedTarget))deferHideChickenTooltip();});
  relics.addEventListener('focusin',e=>{const anchor=e.target.closest('[data-route-chicken]');if(anchor)showChickenTooltip(anchor);});
  relics.addEventListener('focusout',deferHideChickenTooltip);
  chickenTip.addEventListener('pointerenter',()=>clearTimeout(chickenTooltipTimer));
  chickenTip.addEventListener('pointerleave',deferHideChickenTooltip);
  for(const [tip,anchorRoot,cancelHide,deferHide] of [
    [pullTip,pullList,()=>clearTimeout(pullTooltipTimer),deferHidePullTooltip],
    [chickenTip,relics,()=>clearTimeout(chickenTooltipTimer),deferHideChickenTooltip]
  ]){
    tip.addEventListener('click',e=>{const button=e.target.closest('[data-focus-enemies]');if(button)focusListedEnemies(JSON.parse(button.dataset.focusEnemies));});
    tip.addEventListener('focusin',cancelHide);
    tip.addEventListener('focusout',e=>{if(!tip.contains(e.relatedTarget))deferHide();});
    anchorRoot.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!tip.hidden&&e.target.matches('.pull-card,[data-route-chicken]')){const first=tip.querySelector('button');if(first){e.preventDefault();first.focus();}}});
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideChickenTooltip();});
  window.addEventListener('resize',hideChickenTooltip);
  $('#dungeon').onchange=e=>selectDungeon(e.target.value);if($('#floors'))$('#floors').onclick=e=>{const b=e.target.closest('[data-floor]');if(b)chooseFloor(Number(b.dataset.floor));};
  $('#route-name').oninput=updateSaveButton;
  $('#route-name').onchange=e=>change(()=>route.name=e.target.value.trim()||route.name);
  $('#shadow').onclick=()=>change(()=>route.shadow=!route.shadow);
  for(const kind of ['empowered','ghorn','witch'])$('#'+kind).onclick=()=>change(()=>toggleModifier(route,kind));
  $('#help').onclick=showHelp;$('#close-dialog').onclick=()=>$('#dialog').close();
  $('#add-pull').onclick=addPull;$('#undo').onclick=undo;$('#redo').onclick=redo;$('#save-route').onclick=saveNamed;$('#library').onclick=showLibrary;$('#export').onclick=exportRoute;
  $('#import').onclick=showImport;$('#share').onclick=shareRoute;
  window.addEventListener('hashchange',importRouteHash);
  $('#delete-route').onclick=()=>removeSavedRoute(store.saved.findIndex(r=>r.id===route.id));
  $('#clear-route').onclick=()=>{drag=null;draft=[];hideHover();$('#enemy-menu').hidden=true;$('#inspector').hidden=true;inspected=null;$('#map').classList.remove('dragging');closeArrowOptions();change(()=>{clearRoute(route);applyModifierPresets(route,dungeon,data['modifier-placements']);repairSelection();});setTool('select',{cancel:true});toast('Route cleared. Undo to restore it.');};
  $('#new-route').onclick=()=>{const changed=!$('#save-route').disabled;if(changed)saveNamed();selectDungeon(dungeon.id,createRoute());toast(changed?'New route created. Your previous route was saved to the library.':'New route created.');};
  $('#layers').onclick=()=>setDisplayOptions($('#layers-panel').hidden);
  if($('#show-floor-panel')){
    $('#show-floor-panel').checked=true;
    try{$('#show-floor-panel').checked=localStorage.getItem('fellowship-map-layer-panel')!=='false';}catch{}
    $('#show-floor-panel').onchange=()=>{updateFloorPanel();try{localStorage.setItem('fellowship-map-layer-panel',String($('#show-floor-panel').checked));}catch{}};
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#layers, #layers-panel'))setDisplayOptions(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#layers-panel').hidden){setDisplayOptions(false);$('#layers').focus();}});
  ['show-packs','show-patrols','show-mob-icons','hide-unselected','marker-size'].forEach(id=>$('#'+id).oninput=renderMap);
  $$('[data-tool]').forEach(b=>b.onclick=()=>{const open=$('#arrow-options').hidden;setTool(b.dataset.tool);if(b.dataset.tool==='line')setArrowOptions(open);});
  const arrowColors=[['#ff0000','Red'],['#5146ff','Blue'],['#ffa500','Orange'],['#ffff00','Yellow'],['#22e628','Green'],['#9000ff','Purple'],['#ffffff','White'],['#000000','Black']];
  $('.arrow-colors').innerHTML=arrowColors.map(([color,name])=>`<button data-arrow-color="${color}" style="--swatch:${color}" aria-label="${name}" title="${name}" aria-pressed="${color===arrowColor}"></button>`).join('');
  $('.arrow-widths').innerHTML=[2,3,5].map((width,i)=>`<button data-arrow-width="${width}" aria-label="${['Thin','Medium','Thick'][i]}" title="${['Thin','Medium','Thick'][i]}" aria-pressed="${width===arrowWidth}"><i style="--dot:${6+i*4}px"></i></button>`).join('');
  $('#arrow-options').onclick=e=>{
    const color=e.target.closest('[data-arrow-color]')?.dataset.arrowColor,width=e.target.closest('[data-arrow-width]')?.dataset.arrowWidth;
    if(color)arrowColor=color;if(width)arrowWidth=Number(width);
    $$('[data-arrow-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.arrowColor===arrowColor)));
    $$('[data-arrow-width]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.arrowWidth)===arrowWidth)));
    if(color||width)setTool('line');
  };
  $('#search').oninput=search;$('#clear-search').onclick=()=>{$('#search').value='';search();};
  $('#search-results').onclick=e=>{const b=e.target.closest('[data-search-id]');if(b){focusEnemies([b.dataset.searchId]);renderInspector(b.dataset.searchId);$('#search-results').hidden=true;}};
  $('#pulls').onclick=e=>{
    if(e.target.closest('textarea'))return;
    const card=e.target.closest('[data-pull]');if(!card)return;const id=card.dataset.pull;const action=e.target.closest('[data-action]')?.dataset.action;
    if(!action){activePull=id;render();return;}
    const i=route.pulls.findIndex(p=>p.id===id),p=route.pulls[i];
    if(action==='focus'){focusEnemies(p.enemies);return;}
    if(action==='rename'){
      showDialog('Pull settings',`<label>Name<input id="edit-pull-name" value="${esc(p.name)}" maxlength="200"></label><label>Color<input id="edit-pull-color" type="color" value="${p.color}"></label><button id="apply-pull" class="primary">Done</button>`);
      $('#apply-pull').onclick=()=>{const name=$('#edit-pull-name').value.trim(),color=$('#edit-pull-color').value;change(()=>{renamePull(p,name,i);p.color=color;});$('#dialog').close();};return;
    }
    change(()=>{if(action==='delete'){route.pulls.splice(i,1);if(!route.pulls.length)route.pulls.push(newPull());repairSelection();}else{movePull(route,i,i+(action==='up'?-1:1));}});
  };

  $('#pulls').onkeydown=e=>{if(e.target.matches('.pull-card')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();activePull=e.target.dataset.pull;render();}};
  let draggedPull;
  $('#pulls').ondragstart=e=>{if(e.target.closest('textarea,input,button')){e.preventDefault();return;}draggedPull=e.target.closest('[data-pull]')?.dataset.pull;e.dataTransfer.effectAllowed='move';};
  $('#pulls').ondragover=e=>e.preventDefault();$('#pulls').ondrop=e=>{e.preventDefault();const target=e.target.closest('[data-pull]')?.dataset.pull;if(!target||!draggedPull||target===draggedPull)return;change(()=>{const from=route.pulls.findIndex(p=>p.id===draggedPull),to=route.pulls.findIndex(p=>p.id===target);movePull(route,from,to);});draggedPull=null;};
  const map=$('#map');
  map.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.12:1/1.12,point(e));},{passive:false});
  map.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==2)return;
    $('#enemy-menu').hidden=true;hideHover();
    suppressClick=false;
    const pan=e.button===2||tool==='select';
    drag={start:point(e),client:[e.clientX,e.clientY],view:{...view},pan,moved:false,box:tool==='box'&&e.button===0,target:e.target.closest('[data-placement]')?.dataset.placement,drawing:e.target.closest('[data-drawing]')?.dataset.drawing};
    const endpoint=e.target.closest('[data-endpoint]'),drawing=route.drawings.find(d=>d.id===drag.drawing);
    if(e.button===0&&endpoint&&drawing){
      drag.edit=structuredClone(drawing);drag.endpoint=Number(endpoint.dataset.endpoint);drag.pan=false;drag.box=false;
      drag.offset=drawingOnMap(drawing,mapLayer,dungeon).points[drag.endpoint].map((v,i)=>v-drag.start[i]);
    }
    map.setPointerCapture(e.pointerId);if(drag.pan)map.classList.add('dragging');
  });
  map.addEventListener('pointermove',e=>{
    if(drag){
      if(Math.hypot(e.clientX-drag.client[0],e.clientY-drag.client[1])>4)drag.moved=true;
      if(drag.edit&&drag.moved){const pos=draggedDrawingPoint(e,drag);if(pos){drag.edit.points[drag.endpoint]=pos;renderMap();}}
      else if(drag.pan&&drag.moved){const now=point(e);view.x+=drag.start[0]-now[0];view.y+=drag.start[1]-now[1];renderMap();$('#tooltip').hidden=true;}
      else if(drag.box&&drag.moved){const now=point(e);$('#draft').replaceChildren(svg('rect',{x:Math.min(drag.start[0],now[0]),y:Math.min(drag.start[1],now[1]),width:Math.abs(now[0]-drag.start[0]),height:Math.abs(now[1]-drag.start[1]),fill:'#e4b76b22',stroke:'#e4b76b','stroke-width':1,'vector-effect':'non-scaling-stroke'}));}
      return;
    }
    if(!$('#enemy-menu').hidden)return;
    if(draft.length===1&&['line','portal','invis'].includes(tool))renderDraft(point(e));
    const note=route.drawings.find(d=>d.id===e.target.closest('[data-drawing]')?.dataset.drawing&&d.kind==='note');
    if(note){hideHover();const tip=$('#tooltip');tip.dataset.placement='';tip.innerHTML=`<div class="note-tooltip-text">${esc(note.text)}</div>`;positionPopover(tip,e);return;}
    const id=e.target.closest('[data-placement]')?.dataset.placement;if(!id){hideHover();return;}
    const p=positions.get(id),enemy=enemies.get(p.id),score=pointScore(p),pack=effectivePositions(route,dungeon).filter(v=>v.packId===p.packId);
    setHoveredPack(p.packId);
    const tip=$('#tooltip');
    if(tip.hidden||tip.dataset.placement!==id){
      tip.dataset.placement=id;
      tip.innerHTML=`<strong>${esc(enemy.name)}</strong>${isEmpowered(p)?`<div class="tip-empowered"><img src="${empoweredIcon}" alt="">Empowered</div>`:''}<span class="tip-score">${fmt(score)} points · ${pct(score/dungeon.requiredScore*100)}</span>${!enemy.isBoss&&route.excluded.includes(id)?'<div>Chicken</div>':''}<div class="tip-pack-heading">${p.modifier?esc(enemy.name):'G'+packNumbers.get(p.packId)} · ${pack.length} enemies in pack</div><ul class="tip-pack">${pack.map(member=>{const mob=enemies.get(member.id),icon=availableImage(mob);return `<li class="${member.placementId===id?'current':''}" ${member.placementId===id?'aria-current="true"':''}>${icon?`<img src="${icon}" alt="">`:''}<span>${esc(mob.name)}</span><span class="tip-pack-status">${isEmpowered(member)?`<img src="${empoweredIcon}" alt="Empowered" title="Empowered">`:''}${route.excluded.includes(member.placementId)?`<img class="tip-chicken" src="${chickenIcon}" alt="Chicken">`:''}</span></li>`;}).join('')}</ul>`;
    }
    positionPopover(tip,e);
  });
  map.addEventListener('pointerup',e=>{
    if(!drag)return;const state=drag;drag=null;map.classList.remove('dragging');map.releasePointerCapture(e.pointerId);suppressClick=state.moved;
    if(state.edit){
      suppressClick=true;
      if(state.moved){const pos=draggedDrawingPoint(e,state);if(pos)state.edit.points[state.endpoint]=pos;change(()=>{const drawing=route.drawings.find(d=>d.id===state.edit.id);if(drawing)drawing.points=state.edit.points;});}
      else renderMap();
      return;
    }
    if(state.box&&state.moved){const end=point(e),minX=Math.min(state.start[0],end[0]),maxX=Math.max(state.start[0],end[0]),minY=Math.min(state.start[1],end[1]),maxY=Math.max(state.start[1],end[1]);const ids=visiblePositions().filter(p=>{const[x,y]=coordinates(p);return matchesSearch(p)&&x>=minX&&x<=maxX&&y>=minY&&y<=maxY;}).map(p=>p.placementId);choosePacks(ids,{toggle:false});$('#draft').replaceChildren();}
    if(e.button===0&&!state.moved&&tool==='select'&&state.target){chooseEnemy(state.target);suppressClick=true;}
    if(e.button===2&&!state.moved){if(state.drawing)showDrawingMenu(state.drawing,e);else if(state.target)showEnemyMenu(state.target,e);}
  });
  map.addEventListener('pointercancel',()=>{drag=null;suppressClick=true;map.classList.remove('dragging');renderMap();});
  map.addEventListener('contextmenu',e=>e.preventDefault());
  map.addEventListener('pointerleave',e=>{if(!$('#tooltip').contains(e.relatedTarget))hideHover();});
  $('#tooltip').addEventListener('pointerleave',hideHover);
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#enemy-menu'))$('#enemy-menu').hidden=true;if(!e.target.closest('.arrow-tool'))closeArrowOptions();});
  $('#enemy-menu').onkeydown=e=>{
    const buttons=[...e.currentTarget.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}
    if(e.key==='Escape'||e.key==='Tab'){$('#enemy-menu').hidden=true;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();map.focus();}}
  };
  map.addEventListener('click',e=>{
    if(suppressClick){suppressClick=false;return;}
    const mob=e.target.closest('[data-placement]')?.dataset.placement;
    if(tool==='select'){if(mob)chooseEnemy(mob);return;}
    if(['box','empowered','ghorn','witch'].includes(tool))return;
    const pos=point(e);
    if(tool==='note'){editNote(null,pos);return;}
    draft.push(pos);if(['line','portal','invis'].includes(tool)&&draft.length===2){if(Math.hypot(pos[0]-draft[0][0],pos[1]-draft[0][1])<4*scale()){draft.pop();return;}commitDrawing();setTool('select');}else renderDraft();
  });
  map.addEventListener('keydown',e=>{const id=e.target.closest('[data-placement]')?.dataset.placement,drawing=e.target.closest('[data-drawing]')?.dataset.drawing;if(!id&&!drawing)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const rect=e.target.getBoundingClientRect();(drawing?showDrawingMenu:showEnemyMenu)(drawing||id,{clientX:rect.right,clientY:rect.top});}else if(id&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(tool==='select')chooseEnemy(id);}});
  document.addEventListener('keydown',e=>{
    if(e.target.closest('input,textarea,select')||$('#dialog').open)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();$('#search').focus();return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toLowerCase();if(key==='n')addPull();if(key==='f')fitMap();if(key==='b')setTool('box');if(key==='v')setTool('select');if(key==='d')setTool('line');if(key==='escape'){drag=null;map.classList.remove('dragging');closeArrowOptions();setTool('select',{cancel:true});$('#inspector').hidden=true;inspected=null;$('#layers-panel').hidden=true;$('#search-results').hidden=true;}
  });
  new ResizeObserver(()=>{if(route)renderMap();}).observe($('#map-stage'));
  window.addEventListener('pagehide',persist);
}
async function init(){
  data=await loadData();data.shadow=data['shadow-reference'];enemies=new Map(data.enemies.map(e=>[e.id,e]));for(const [kind,name]of [['ghorn','Ghorn'],['witch','Witch']])enemies.set('modifier:'+kind,{id:'modifier:'+kind,name,dungeonScore:20,images:[],isBoss:false});
  if(data['modifier-placements'].buildId!==data.manifest.buildId)throw new Error('Modifier placements need updating for this game data build. Run node scripts/prepare-modifiers.mjs.');
  if(fullMapBuildId!==data.manifest.buildId)throw new Error('Full map coordinates need updating for this game data build. Run node scripts/prepare-full-maps.mjs.');
  if(combinedBuildId!==data.manifest.buildId)throw new Error('Combined maps need updating for this game data build. Run npm run maps.');
  data.dungeons=data.dungeons.map(correctDungeon);
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&saved.drafts&&Array.isArray(saved.saved))store=saved;}catch{toast('Browser storage is corrupted. You can import a JSON backup.');}
  for(const saved of [...Object.values(store.drafts),...store.saved]){
    if(!saved||typeof saved!=='object')continue;
    saved.name=englishDefaultLabel(saved.name);
    if(Array.isArray(saved.pulls))for(const pull of saved.pulls){if(pull)pull.name=englishDefaultLabel(pull.name);}
  }
  $('#dungeon').innerHTML=[...data.dungeons].sort((a,b)=>a.name.localeCompare(b.name)).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  bind();selectDungeon(store.lastDungeon||'Level.ID.FrozenKingdom');importRouteHash();setTool('select');
}
init().catch(err=>{$('#map-loading').textContent=err.message;$('#map-loading').classList.add('fatal');console.error(err);});
