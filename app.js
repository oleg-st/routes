import {uid,enemyHealth,newRoute,hasRouteChanges,newPull,pullColor,scorePull,scoreRoute,placementScore,dungeonPackEfficiencies,packEfficiencyColor,englishDefaultLabel,effectivePositions,shadowTimeline,shadowTarget,orbCount,applyModifierPresets,encodeRoute,decodeRoute} from './route-model.js';
import {pullOutline,separateMarkerCenters} from './map-geometry.js';
import {planPullSplit} from './pull-split.js';
import {markerSymbols,markerColors,markerIcon,numberedAnnotations,markerSymbol,legacyMarkerGlyph} from './marker-symbols.js';
import {onMap,mapCoordinates,drawingOnMap,drawingPointFromMap,mapStart,mapCampfires,mapPatrols} from './map-views.js';
import {mapViews} from './local-map-views.js';
import {correctDungeon,placementName} from './data/placement-corrections.js';
import {enemyAbilities} from './data/ability-corrections.js';
import {enemyMarkerScale,enemyMarkerRadius} from './data/enemy-marker-sizes.js';
import {modifierStats} from './data/game-modifier-stats.js';
import {replacementMembers} from './data/route-dictionary.js';
import {gameServiceRules} from './data/game-service-rules.js';
import {modifierAvailable} from './game-scoring.js';
import {difficultyOptions,difficultyChoice,applyDifficulty,formatHealth} from './difficulty.js';
import {placementHealth,positionsHealth,routeHealth,shadowHealth} from './route-model.js';
import {markerAnchor} from './data/marker-anchors.js';
import {fullMapBuildId} from './data/full-maps.js';
import {combinedBuildId} from './data/combined-layouts.js';
import {loadData} from './data/runtime-loader.js';
import {createDungeonLoader} from './data/dungeon-loader.js';
import {createCursorOverlay} from './collaboration/cursor-overlay.js';
import {createRoomSession} from './collaboration/room-manager.js';
import {createRoomUI} from './collaboration/room-ui.js';
import {newRoomCode,roomCode} from './collaboration/room-protocol.js';
import {createRouteDocument,restoreRouteDocument} from './collaboration/route-document.js';
import {openRouteStorage} from './collaboration/route-storage.js';
import {migrateLegacyLibrary} from './collaboration/route-library.js';
import {createLogImportUI} from './log-import/import-ui.js';
import {movementTrailLines} from './log-import/movement-trail.js';
import {captureLogCallback,createLiveImport} from './log-import/live-import.js';
let logCallback;
try{logCallback=captureLogCallback(location,history,sessionStorage);}catch(error){logCallback={error};}
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=n=>n==null?'—':n.toFixed(2)+'%';
const hp=(value,heart=true)=>`<span class="health-value" title="${value==null?'Health unavailable':fmt(Math.round(value))+' HP'}">${heart?'<span class="health-heart" aria-hidden="true">♥</span> ':''}${formatHealth(value)}</span>`;
const showHealth=()=>route.difficulty!==undefined;
const showMapHealth=()=>showHealth()&&$('#show-hp').checked;
const NS='http://www.w3.org/2000/svg';
const relicColors={portal:'#70d9ff',invis:'#bb86fc'};
const empoweredIcon='images/modifiers/empowered-minions.avif';
const chickenIcon='images/relics/ga-relicpower-polymorphtargetwithsharedcharges-relic-200.avif';
const relicIcons={portal:'images/hero-items/relic-b-crit-portal-hero-item-200.avif',invis:'images/hero-items/relic-b-expertise-groupinvisibility-hero-item-200.avif'};
const failedMobImages=new Set();
const svg=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;return e;};
let data,dungeon,route,activePull,mapLayer,positions,enemies,packNumbers,view,baseView,tool='select',draft=[],inspected=null;
let drag=null,toastTimer,suppressClick=false;
let routeDocument,routeBinding,routeStorage,stopRoute,routeBusy=false,selectionQueue=Promise.resolve();
let roomSession=null,roomUI,cursorUI,roomTransition=false,roomResume=null;
let hoveredPack=null;
let enemyMarkerCenters=new Map();
let enemyMarkerLayoutKey='';
let logImportUI,logPreview=null,logHighlights=new Set(),logChickenPreview=new Set();
let focusedEnemies=new Set(),enemyFocusUntil=0,enemyFocusTimer,enemyHoverTimer;
let modifierHighlightKey='';
const enemyFocusDuration=1000;
const enemyHoverDelay=200;
let arrowColor='#ff0000',arrowWidth=3;
const storageKey='fellowship-atlas-v1';
const dungeonDataMode='custom';
let store={drafts:{},saved:[],lastDungeon:null};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function canEdit(){return !logPreview&&!routeBusy&&!roomTransition&&(!roomSession||roomSession.document&&!roomSession.state().full&&!roomSession.state().kicked&&!roomSession.state().switching)&&routeDocument?.role==='player';}
function storageStatus({state,error}){const label=$('#storage-status');label.textContent=state==='saved'?'':state==='saving'?'Saving…':'Save failed · click to retry';label.dataset.state=state;label.title=error?.message||'Route Together · browser storage';}
async function persist(){try{await routeBinding?.flush();}catch(error){toast('Unable to save: '+error.message);throw error;}}
function refreshRoute(){route=routeDocument.snapshot();repairSelection();render();}
function change(commands){if(!canEdit())return false;if(Array.isArray(commands)&&!commands.length)return true;try{Array.isArray(commands)?routeDocument.executeBatch(commands):routeDocument.execute(commands);refreshRoute();return true;}catch(error){toast(error.message);return false;}}
function undo(){if(canEdit()&&routeDocument.canUndo()){routeDocument.undo();refreshRoute();}}
function redo(){if(canEdit()&&routeDocument.canRedo()){routeDocument.redo();refreshRoute();}}
function run(action){return (...args)=>Promise.resolve().then(()=>action(...args)).catch(error=>toast(error.message));}
function repairSelection(){if(!route.pulls.some(p=>p.id===activePull))activePull=route.pulls[0]?.id??null;}
function active(){return route.pulls.find(p=>p.id===activePull)||route.pulls[0];}
function assigned(){return new Map(route.pulls.flatMap((p,i)=>p.enemies.map(id=>[id,{pull:p,index:i}])));}
function currentPositions(){return effectivePositions(route,dungeon).filter(e=>onMap(e,mapLayer));}
function refreshPositions(){positions=new Map(effectivePositions(route,dungeon).map(p=>[p.placementId,p]));}
function pointScore(p){return placementScore(p,enemies.get(p.id),route);}
function positionsPercent(members){
  const scores=members.map(pointScore);
  return dungeon.requiredScore>0&&!scores.some(score=>score==null)?scores.reduce((sum,score)=>sum+score,0)/dungeon.requiredScore*100:null;
}
function isEmpowered(p){return route.modifiers.empowered.active&&route.modifiers.empowered.enemies.includes(p.placementId)&&!enemies.get(p.id)?.isBoss;}
function coordinates(e){return mapCoordinates(e,mapLayer);}
function markerCoordinates(e){return enemyMarkerCenters.get(e.placementId)||coordinates(e);}
function availableImage(e){return e?.images?.find(i=>i.size==='200')?.path||e?.images?.[0]?.path;}
function floorName(m,i){
  if(!m.sources)i=mapViews(dungeon).filter(view=>!view.sources).findIndex(view=>view.id===m.id);
  const names={Global:'Overview',Start:'Start',End:'End',Ending:'End','Lower floor':'Lower floor',Interior:'Interior',Chamber:'Chamber',Jungle:'Jungle','Start + village':'Start · village','Ship interior':'Ship interior','Upper island':'Upper island',Upper:'Upper level',Lower:'Lower level'};
  const title=names[m.name]||m.name||`Layer ${i+1}`;
  return dungeon.mapImages.filter(v=>v.name===m.name).length>1&&m.name?`${title} ${i+1}`:title;
}
async function createRoute(target=dungeon){const fresh=newRoute(target,data.manifest.buildId,await routeStorage.nextName(Math.max(0,...[...store.saved,route].filter(Boolean).map(r=>Number(/^Route (\d+)$/.exec(r.name)?.[1])||0))+1));applyModifierPresets(fresh,target,data['modifier-placements']);return fresh;}
function selectDungeon(id,imported){
  if(logPreview)return Promise.reject(new Error('Finish or cancel the log import first.'));
  if(roomSession||roomTransition)return Promise.reject(new Error('Leave the room before opening another route.'));
  const operation=selectionQueue.then(()=>loadDungeon(id,imported));selectionQueue=operation.catch(()=>{});return operation;
}
async function loadDungeon(id,imported){
  routeBusy=true;drag=null;draft=[];
  try{
    await persist();
    const selected=data.dungeons.find(d=>d.id===id)||data.dungeons[0];
    const target=await data.loadDungeon(selected.id);
    const options={dungeon:target,enemies,role:'player'};
    const packet=typeof imported==='string'?await routeStorage.load(imported):!imported&&store.drafts[target.id]?await routeStorage.load(store.drafts[target.id]):null;
    if(typeof imported==='string'&&!packet)throw new Error('Saved route data is missing.');
    const next=packet?restoreRouteDocument(packet,options):createRouteDocument(imported||await createRoute(target),options);
    const binding=routeStorage.bind(next,storageStatus);
    try{await binding.flush();await routeStorage.setDraft(target.id,next.identity.routeId);}catch(error){await binding.dispose().catch(()=>{});next.dispose();throw error;}
    await routeBinding?.dispose();stopRoute?.();routeDocument?.dispose();
    displayRouteDocument(next,binding);
  }finally{routeBusy=false;if(dungeon)$('#dungeon').value=dungeon.id;}
}
function displayRouteDocument(next,binding,{preserveMap=false}={}){
    const camera=preserveMap&&dungeon?.id===next.identity.dungeonId&&mapLayer?{id:mapLayer.id,path:mapLayer.path,view:{...view}}:null;
    routeDocument=next;routeBinding=binding;route=next.snapshot();dungeon=data.dungeons.find(d=>d.id===next.identity.dungeonId);
    store.drafts[dungeon.id]=route.id;store.lastDungeon=dungeon.id;
    stopRoute=next.subscribe(event=>{if(event.origin==='import')queueMicrotask(()=>{if(routeDocument===next)refreshRoute();});});
    positions=new Map(dungeon.enemies.map(e=>[e.placementId,e]));packNumbers=new Map([...new Set(dungeon.enemies.map(e=>e.packId))].map((id,i)=>[id,i+1]));
    routeBusy=false;
    packNumbers.set('modifier:ghorn','Ghorn');packNumbers.set('modifier:witch','Witch');
    activePull=route.pulls[0]?.id??null;inspected=null;$('#inspector').hidden=true;$('#dungeon').value=dungeon.id;$('#search').value='';$('#search-results').hidden=true;
    const views=mapViews(dungeon);
    if($('#floors'))$('#floors').innerHTML=views.map((m,i)=>`<button data-floor="${i}">${esc(floorName(m,i))}</button>`).join('');
    updateFloorPanel();
    const start=views.findIndex(m=>m.name?.startsWith('Start'));
    const global=views.findIndex(m=>m.name==='Global');
    const previousFloor=camera?views.findIndex(m=>m.id===camera.id&&m.path===camera.path):-1;
    chooseFloor(previousFloor>=0?previousFloor:views[0].sources?0:start>=0?start:global>=0?global:0);
    if(previousFloor>=0)view=camera.view;
    render();$('#pulls').scrollTop=0;
  if(roomSession)roomUI.update(roomSession.state());
}
async function startRoom({code,name,classId='',role='player',config={},create=false}){
  if(logPreview)throw new Error('Finish or cancel the log import first.');
  if(roomSession||roomTransition)throw new Error('Leave your current room first.');
  roomTransition=true;const previous={dungeonId:dungeon.id,routeId:route.id},packet=create?routeDocument.exportSnapshot():undefined;
  try{
    await persist();await routeBinding.dispose();stopRoute?.();routeDocument.dispose();routeDocument=null;routeBinding=null;
    let session;
    session=await createRoomSession({code,role,name,classId,classes:data.heroes,initialPacket:packet,storage:routeStorage,connectionConfig:config,
      resolveOptions:identity=>{const target=data.dungeons.find(d=>d.id===identity.dungeonId);if(!target||identity.buildId!==data.manifest.buildId)throw new Error('This room uses an incompatible dungeon or game data build.');return {dungeon:target,enemies};},
      prepareOptions:identity=>data.loadDungeon(identity.dungeonId),
      onArchive:async saved=>{await routeStorage.saveBookmark(saved);const i=store.saved.findIndex(r=>r.id===saved.id);if(i>=0)store.saved[i]=saved;else store.saved.push(saved);},
      onKicked:async()=>{if(roomSession===session){$('#dialog').close();await leaveRoom();toast('You were disconnected by the room creator.');}},
      onStorage:storageStatus,onPresence:cursors=>cursorUI?.setRemote(cursors),
      onDocument:(doc,binding)=>{if(session&&roomSession===session){stopRoute?.();cursorUI?.clear();displayRouteDocument(doc,binding);}},
      onState:state=>{if(session&&roomSession===session){roomUI.update(state);if(routeDocument)updateRoomControls();}},
    });
    roomSession=session;roomTransition=false;roomResume={code,role,name,classId};try{sessionStorage.setItem('rt-room',JSON.stringify(roomResume));}catch{}
    const url=new URL(location.href);url.hash='room='+code;window.history.replaceState(null,'',url);
    if(session.document)displayRouteDocument(session.document,session.binding);roomUI.update(session.state());updateRoomControls();await session.start();
  }catch(error){
    if(roomSession){stopRoute?.();await roomSession.leave().catch(()=>{});routeDocument=null;routeBinding=null;}roomSession=null;roomTransition=false;roomResume=null;try{sessionStorage.removeItem('rt-room');}catch{}roomUI.update(null);cursorUI?.clear();
    if(!routeDocument)await selectDungeon(previous.dungeonId,previous.routeId);throw error;
  }
}
async function changeDungeon(id){
  if(!roomSession)return selectDungeon(id);
  if(id===dungeon.id)return;
  if(!data.dungeons.some(d=>d.id===id))throw new Error('Unknown dungeon.');
  if(!roomSession.state().canChangeDungeon){$('#dungeon').value=dungeon.id;throw new Error('Only the room creator can change the dungeon.');}
  roomTransition=true;updateRoomControls();
  try{
    const target=await data.loadDungeon(id);
    let packet=await roomSession.savedRoute(id);
    if(!packet){const next=createRouteDocument(await createRoute(target),{dungeon:target,enemies,role:'player'});try{packet=next.exportSnapshot();}finally{next.dispose();}}
    await roomSession.switchDocument(packet);toast('Dungeon changed for everyone. The previous route was saved locally.');
  }finally{roomTransition=false;$('#dungeon').value=dungeon.id;if(routeDocument)render();updateRoomControls();}
}
function updateRoomControls(){
  $('#dungeon').disabled=Boolean(logPreview||roomTransition||roomSession&&!roomSession.state().canChangeDungeon);
  $('#dungeon').title=roomSession?'Only the room creator can change the dungeon. The current route is saved locally.':'';
  for(const el of $$('#library,#new-route,#import,#import-log-button'))el.disabled=Boolean(logPreview||roomSession||roomTransition);
  for(const el of $$('#export,#share'))el.disabled=Boolean(logPreview||roomTransition||roomSession&&(!roomSession.document||roomSession.state().full));
  if(routeDocument){updateSaveButton();$('#route-name').disabled=!canEdit();$('#undo').disabled=!canEdit()||!routeDocument.canUndo();$('#redo').disabled=!canEdit()||!routeDocument.canRedo();}
}
async function leaveRoom(){
  if(!roomSession||roomTransition&&!roomSession.state().kicked)return;roomTransition=true;
  const session=roomSession,packet=session.document?.exportSnapshot(),fallback=store.lastDungeon||dungeon.id;
  try{await session.binding?.flush();}catch(error){if(!session.state().kicked){roomTransition=false;throw error;}}
  stopRoute?.();routeDocument=null;routeBinding=null;let leaveError;try{await session.leave();}catch(error){leaveError=error;}roomSession=null;roomTransition=false;roomResume=null;
  try{sessionStorage.removeItem('rt-room');}catch{}const url=new URL(location.href);url.hash='';window.history.replaceState(null,'',url);roomUI.update(null);
  if(packet)await selectDungeon(packet.identity.dungeonId,packet.identity.routeId);else await selectDungeon(fallback);updateRoomControls();if(leaveError)throw leaveError;
}
function setupRooms(){
  cursorUI=createCursorOverlay({classes:data.heroes,map:$('#map'),getContext:()=>mapLayer&&roomSession?.document&&!roomSession.state().full?{mapLayer,dungeon}:null,onCursor:cursor=>roomSession?.setCursor(cursor)});
  roomUI=createRoomUI({showDialog,copyText:copyRouteText,onError:toast,
    classes:data.heroes,onProfile:profile=>{roomSession.updateProfile(profile);roomResume={...roomResume,...profile};try{sessionStorage.setItem('rt-room',JSON.stringify(roomResume));}catch{}},
    onCreate:({name,classId,config})=>startRoom({code:newRoomCode(),name,classId,role:'player',config,create:true}),
    onJoin:args=>startRoom(args),onLeave:leaveRoom,onKick:id=>roomSession?.kick(id),onReconnect:config=>roomSession?.reconnect(config)});
  window.addEventListener('online',()=>{if(roomSession)roomSession.reconnect().catch(error=>toast(error.message));});
}
function openRoomHash(){if(!location.hash.startsWith('#room='))return;try{const code=roomCode(location.hash);if(roomSession){if(roomSession.state().roomId!==code)toast('Leave this room before joining another.');return;}roomUI.form(code);}catch(error){toast(error.message);}}
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
  cursorUI?.pause();
  drag=null;
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
function mapMarkerRadius(unit){
  const bounds=$('#map').getBoundingClientRect();
  // SVG fits both axes. A tall focus frame can be height-limited even when
  // its narrow viewBox width suggests a much larger zoom.
  const baseUnit=Math.max(baseView.w/Math.max(bounds.width,1),baseView.h/Math.max(bounds.height,1));
  return enemyMarkerRadius(Number($('#marker-size').value),baseUnit/unit,$('#show-mob-icons').checked)*unit;
}
function render(){
  hideChickenTooltip();
  hidePullTooltip();
  refreshPositions();
  if(document.activeElement!==$('#route-name'))$('#route-name').value=route.name;const totals=scoreRoute(route,dungeon,enemies);
  $('#total-percent').innerHTML=`${totals.percent==null?'—':totals.percent.toFixed(2)}<span>%</span>`;
  $('#total-score').textContent=`${fmt(totals.score)} / ${fmt(dungeon.requiredScore)} points`;
  $('#progress-fill').style.width=`${Math.min(100,totals.percent||0)}%`;
  $('#progress-fill').style.background=totals.percent>=100?'var(--green)':'var(--gold)';
  const timeline=shadowTimeline(route,dungeon,enemies),orbs=orbCount(totals.orbScore,dungeon);
  if(route.shadow){$('#total-percent').innerHTML=`${orbs}<span> / ${shadowTarget(dungeon)} orbs</span>`;$('#progress-fill').style.width=`${Math.min(100,orbs/shadowTarget(dungeon)*100)}%`;$('#progress-fill').style.background=orbs>=shadowTarget(dungeon)?'var(--green)':'var(--gold)';}
  const remaining=dungeon.requiredScore-totals.score;
  $('#score-remaining').textContent=totals.unknown?`(unknown: ${totals.unknown} enemies)` : remaining>0?`(${fmt(remaining)} left)`: `(${fmt(Math.max(0,-remaining))} extra)`;
  if(route.shadow){
    const orbsLeft=Math.max(0,shadowTarget(dungeon)-orbs);
    $('#total-score').textContent=`${fmt(totals.score)} KS · ${pct(totals.percent)}`;
    $('#score-remaining').textContent=orbsLeft>0?`${orbsLeft} orbs left`:'';
  }
  $('#shadow').setAttribute('aria-pressed',String(route.shadow));
  for(const kind of ['shadow','empowered','ghorn','witch']){
    const button=$('#'+kind),available=modifierAvailable(dungeon.id,kind);
    const placed=kind==='shadow'||(kind==='empowered'?(route.modifiers.empowered.enemies.length||data['modifier-placements'].dungeons[dungeon.id]?.empowered?.length):route.modifiers[kind].packId);
    button.setAttribute('aria-pressed',String(kind==='shadow'?route.shadow:route.modifiers[kind].active));
    button.disabled=route.difficulty!==undefined||!canEdit()||!available||!placed;
    button.hidden=button.disabled&&button.getAttribute('aria-pressed')!=='true';
    const detail=!available?'Unavailable in this dungeon':!canEdit()?'Read-only route':!placed?'No recorded placements in this dungeon':kind==='shadow'?'Show estimated Shadow Orbs':kind==='empowered'?`${route.modifiers.empowered.enemies.length} marked enemies`:`${packNumbers.has(route.modifiers[kind].packId)?'G'+packNumbers.get(route.modifiers[kind].packId):(route.modifiers[kind].replacedEnemies?.length??0)+' replacement enemies'}`;
    button.title=button.getAttribute('aria-label')+' · '+(route.difficulty===undefined?detail:'Determined by '+difficultyChoice(dungeon.id,route.difficulty)?.label);
  }
  $('.modifiers').hidden=$$('.modifiers button').every(button=>button.hidden);
  const health=route.difficulty===undefined?null:routeHealth(route,dungeon,enemies),choices=difficultyOptions(dungeon.id);
  $('#difficulty').innerHTML='<option value="">Not selected</option>'+choices.map(c=>'<option value="'+c.value+'">'+c.label+'</option>').join('');
  $('#difficulty').value=route.difficulty??'';$('#difficulty').disabled=!canEdit();
  $('#show-hp').disabled=!showHealth();$('#show-hp').parentElement.title=showHealth()?'Show HP on the map':'Select a difficulty to show HP on the map';
  $('#route-health').hidden=!health;
  $('#route-health').innerHTML=health?'<div>HP '+hp(health.total,false)+'</div><div title="Total route HP divided by the full dungeon timer; combined group DPS, without travel time."><strong>'+formatHealth(health.dps)+'</strong> DPS</div>':'';
  $('#pull-count').textContent=route.pulls.length;$('#undo').disabled=!canEdit()||!routeDocument.canUndo();$('#redo').disabled=!canEdit()||!routeDocument.canRedo();
  for(const el of $$('#dungeon,#library,#together,#export,#share,#delete-route'))el.disabled=!!logPreview;
  for(const el of $$('#route-name,#add-pull,#clear-route,#new-route,#import,[data-tool]'))el.disabled=!canEdit()&&el.dataset.tool!=='select';
  const chickens=chickenPositions().length;
  const invis=route.drawings.filter(d=>d.kind==='invis').length;
  $('#route-relics').innerHTML=relicSummary(chickens,invis);
  $('#pulls').innerHTML=route.pulls.map((p,i)=>{
    const score=scorePull(p,dungeon,enemies,route);
    const members=p.enemies.map(id=>positions.get(id)).filter(Boolean);
    const pending=logPreview?.pendingPullID===p.id;
    return `<article class="pull-card ${p.id===activePull?'selected':''}" style="--pull-color:${p.color}" data-pull="${p.id}" draggable="true" tabindex="0" role="button" aria-label="Select ${esc(p.name)}" aria-describedby="pull-tooltip"><div class="pull-top"><span class="pull-number">${String(i+1).padStart(2,'0')}</span><span class="pull-name">${esc(p.name)}</span><span class="pull-percent">${pct(score.percent)}</span></div><div class="pull-summary"><div class="pull-mob-count">${members.length} ${members.length===1?'mob':'mobs'}${showHealth()?' · '+hp(health.pulls[i].mobs):''}</div><button class="pull-delete" data-action="delete" aria-label="Delete pull" title="Delete · can be undone">×</button></div>${pending?'<div class="pull-import-status" title="Choose a pack above to finish this pull.">Pending import</div>':''}${route.shadow?`<div class="pull-detail">${timeline[i].orbs} orbs · ${timeline[i].total} total orbs${timeline[i].spawns?' · Emissary'+(timeline[i].spawns>1?' ×'+timeline[i].spawns:'')+(showHealth()?' '+hp(health.pulls[i].shadow):''):''}</div>`:''}${p.id===activePull?`<div class="pull-actions"><button data-action="rename" title="Name and color" aria-label="Edit pull">✎</button><button data-action="focus" aria-label="Show pull on map">⌖</button><button data-action="up" ${i===0?'disabled':''} aria-label="Move pull up">↑</button><button data-action="down" ${i===route.pulls.length-1?'disabled':''} aria-label="Move pull down">↓</button></div>`:''}</article>`;
  }).join('');
  if(!canEdit())for(const button of $$('#pulls [data-action]:not([data-action=focus])'))button.disabled=true;
  updateRoomControls();updateSaveButton();renderMap();if(inspected)renderInspector(inspected);
}
function matchesSearch(pos){const q=$('#search').value.trim().toLowerCase();if(!q)return true;return placementName(pos,enemies.get(pos.id)).toLowerCase().includes(q)||`g${packNumbers.get(pos.packId)}`===q;}
function visiblePositions(){const owners=assigned();return currentPositions().filter(p=>logHighlights.has(p.placementId)||!$('#hide-unselected').checked||owners.has(p.placementId));}
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
  const withoutChicken={...route,excluded:[]};
  const groups=[...route.pulls.map(p=>({name:p.name,id:p.id})),{name:'Not in a pull',id:null}];
  tip.innerHTML=`<strong>Chicken · ${chickens.length}</strong>${chickens.length?groups.map(group=>{
    const members=chickens.filter(p=>(owners.get(p.placementId)?.pull.id??null)===group.id);if(!members.length)return '';
    return `<div class="tip-pack-heading">${esc(group.name)}</div><ul class="tip-pack">${members.map(p=>{const enemy=enemies.get(p.id),icon=availableImage(enemy),score=placementScore(p,enemy,withoutChicken),percent=score!=null&&dungeon.requiredScore>0?score/dungeon.requiredScore*100:null;return `<li class="tip-focus-row"><button type="button" data-focus-enemies="${esc(JSON.stringify([p.placementId]))}">${icon?`<img src="${icon}" alt="">`:''}<span>${esc(enemy.name)}</span><span class="tip-pack-status"><span class="tip-pack-percent" title="Contribution without Chicken">${pct(percent)}</span></span></button></li>`;}).join('')}</ul>`;
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
  const tip=$('#pull-tooltip'),score=scorePull(pull,dungeon,enemies,route),health=showHealth()?routeHealth(route,dungeon,enemies).pulls[route.pulls.indexOf(pull)]:null;
  tip.dataset.pull=pull.id;
  tip.innerHTML=`<strong>${esc(pull.name)}</strong><div class="tip-score">${pct(score.percent)} · ${members.length} ${members.length===1?'mob':'mobs'}${showHealth()?' · '+hp(health.mobs):''}</div>${showHealth()&&health.shadow?'<div class="tip-shadow-health">Emissary '+hp(health.shadow)+'</div>':''}${rows.length?`<ul class="tip-pack">${rows.map(({p,count,ids,empowered,chicken})=>{
    const enemy=enemies.get(p.id),icon=availableImage(enemy);
    return `<li class="tip-focus-row"><button type="button" data-focus-enemies="${esc(JSON.stringify(ids))}">${icon?`<img src="${icon}" alt="">`:''}<span>${esc(enemy.name)}${count>1?` ×${count}`:''}</span><span class="tip-pack-status">${empowered?`<img src="${empoweredIcon}" alt="Empowered" title="Empowered">`:''}${chicken?`<img src="${chickenIcon}" alt="Chicken" title="Chicken">`:''}<span class="tip-pack-percent">${pct(positionsPercent(ids.map(id=>positions.get(id))))}</span>${showHealth()?hp(positionsHealth(ids.map(id=>positions.get(id)),enemies,route)):''}</span></button></li>`;
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
  for(const marker of $$('#markers > [data-placement]')){
    marker.classList.toggle('pack-hover',packId!=null&&positions.get(marker.dataset.placement)?.packId===packId);
  }
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
  change({type:'set-excluded',mobId:id,excluded:!route.excluded.includes(id)});
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
function showDrawingMenu(id,event,vertex){
  const drawing=annotation(id);if(!drawing||!canEdit())return;const endpoint=vertex??Number(event.target?.closest('[data-endpoint]')?.dataset.endpoint);
  hideHover();const menu=$('#enemy-menu'),name=['note','marker'].includes(drawing.kind)?(markerIcon(drawing)==='number'?'note':'marker'):{line:'arrow',portal:'portal',invis:'invis'}[drawing.kind];
  menu.setAttribute('aria-label','Drawing actions');
  menu.innerHTML=`${['note','marker'].includes(drawing.kind)?'<button role="menuitem" data-drawing-action="edit">Edit '+name+'</button>':''}${drawing.kind==='line'?'<button role="menuitem" data-drawing-action="insert">Add vertex after this point</button>':''}${drawing.kind==='line'&&drawing.points.length>2&&Number.isInteger(endpoint)?'<button role="menuitem" data-drawing-action="vertex">Remove vertex</button>':''}<button role="menuitem" data-drawing-action="delete">Delete ${name}</button>`;
  menu.onclick=e=>{const action=e.target.closest('[data-drawing-action]')?.dataset.drawingAction;if(!action)return;menu.hidden=true;if(action==='edit'){editMarker(drawing);}else if(action==='insert'){const index=Number.isInteger(endpoint)?Math.min(endpoint,drawing.points.length-2):0;change({type:'insert-point',drawingId:id,afterId:drawing.pointIds[index],position:drawing.points[index].map((n,i)=>(n+drawing.points[index+1][i])/2)});}else if(action==='vertex'){change({type:'delete-point',drawingId:id,pointId:drawing.pointIds[endpoint]});}else{change(drawing.kind==='marker'?{type:'delete-marker',markerId:id}:{type:'delete-drawing',drawingId:id});$('#map').focus();}};
  positionPopover(menu,event);menu.querySelector('button').focus({preventScroll:true});
}
function annotation(id){return route.drawings.find(d=>d.id===id)||markerAnnotation(route.markers.find(m=>m.id===id));}
function markerAnnotation(marker){return marker&&{...marker,kind:'marker',points:[marker.position],text:marker.label};}
function editMarker(marker,pos){
  if(!canEdit())return;
  const legacy=marker?.kind==='note',originalText=marker?(legacy?marker.text:marker.label):'',originalIcon=marker?markerIcon(marker):'number';
  let icon=originalIcon,color=marker?.color||'#ffffff',automaticColor=!marker;
  const palette=markerColors.some(([value])=>value===color)?markerColors:[...markerColors,[color,'Saved color']];
  const symbols=markerSymbol(icon)?markerSymbols:[...markerSymbols,{id:icon,label:'Saved symbol'}];
  const number=()=>{const notes=numberedAnnotations(route),index=notes.findIndex(n=>n.id===marker?.id);return index>=0?index+1:legacy?notes.filter(n=>n.kind==='note'&&route.drawings.indexOf(n)<route.drawings.findIndex(d=>d.id===marker.id)).length+1:notes.length+1;};
  const glyph=(value,tint)=>{const symbol=markerSymbol(value);return symbol?.path?`<svg viewBox="0 0 24 24" aria-hidden="true"${tint?` style="color:${tint}"`:""}><path d="${symbol.path}" fill="${symbol.stroke?'none':'currentColor'}" fill-rule="${symbol.fillRule||'nonzero'}"${symbol.stroke?' stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"':''}/></svg>`:`<span aria-hidden="true">${value==='number'?number():legacyMarkerGlyph(value)}</span>`;};
  showDialog(marker?'Edit marker / note':'Add marker / note',`<div class="marker-editor"><fieldset><legend>Symbol</legend><div class="marker-symbols" role="group" aria-label="Marker symbol">${symbols.map(s=>`<button type="button" data-marker-icon="${esc(s.id)}" aria-label="${esc(s.label)}" title="${esc(s.name?`${s.label} · ${s.name}`:s.label)}" aria-pressed="${icon===s.id}">${glyph(s.id,s.color)}<small>${esc(s.label)}</small></button>`).join('')}</div></fieldset><label for="marker-label">Text <span class="muted">· optional</span></label><textarea id="marker-label" aria-label="Marker text" placeholder="For example: stack here, then interrupt…" maxlength="${Math.max(4000,originalText.length)}">${esc(originalText)}</textarea><fieldset><legend>Color</legend><div class="marker-colors" role="group" aria-label="Marker color">${palette.map(([value,name])=>`<button type="button" data-marker-color="${value}" style="--swatch:${value}" aria-label="${name}" aria-pressed="${value===color}" title="${name}"></button>`).join('')}</div></fieldset><div class="marker-preview"><div id="marker-preview-symbol"></div><div><strong id="marker-preview-title"></strong><span id="marker-preview-text"></span></div></div><div class="marker-editor-footer"><button type="button" id="cancel-marker">Cancel</button><button type="button" id="place-marker" class="primary">${marker?'Save':'Add'}</button></div></div>`);
  const refresh=()=>{$$('.marker-symbols [data-marker-icon]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.markerIcon===icon)));$$('.marker-colors button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.markerColor===color)));$('#marker-preview-symbol').innerHTML=glyph(icon);$('#marker-preview-symbol').style.color=color;$('#marker-preview-symbol').style.backgroundColor=color==='#000000'?'#e4e7ea':'';$('#marker-preview-title').textContent=icon==='number'?`Note ${number()}`:markerSymbol(icon)?.label||'Marker';$('#marker-preview-text').textContent=$('#marker-label').value||'Text appears on hover';};
  $$('.marker-symbols button').forEach(b=>b.onclick=()=>{icon=b.dataset.markerIcon;if(automaticColor)color=markerSymbol(icon)?.color||'#ffffff';refresh();});
  $$('.marker-colors button').forEach(b=>b.onclick=()=>{color=b.dataset.markerColor;automaticColor=false;refresh();});
  $('#marker-label').oninput=refresh;$('#cancel-marker').onclick=()=>$('#dialog').close();refresh();
  const input=$('#marker-label');input.focus();input.setSelectionRange(input.value.length,input.value.length);input.scrollTop=input.scrollHeight;
  // Capture the document: a room transition must not save a draft into another route.
  const document=routeDocument,routeId=route.id;
  $('#place-marker').onclick=()=>{
    if(route.id!==routeId||routeDocument!==document){toast('The route changed. Reopen the editor.');return;}
    const label=$('#marker-label').value,commands=marker?[]:{type:'add-marker',mapId:mapLayer.id,position:pos,label,color,icon};
    if(marker){const current=(legacy?route.drawings:route.markers).find(m=>m.id===marker.id),patch={};if(!current){toast('This marker was deleted.');return;}
      if(label!==originalText){if(!unchangedText(legacy?current.text:current.label,originalText))return;commands.push({type:'set-text',group:legacy?'drawings':'markers',id:marker.id,text:label});}
      if(color!==marker.color)patch.color=color;if(icon!==originalIcon)patch.icon=icon;
      if(Object.keys(patch).length)commands.push(legacy?{type:'update-drawing',drawingId:marker.id,patch}:{type:'update-marker',markerId:marker.id,patch});
    }
    if(change(commands)){$('#dialog').close();setTool('select');}
  };
}
function unchangedText(current,original){if(current===original)return true;toast('This text changed in another tab. Copy your draft, then reopen the editor to see the latest version.');return false;}
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
  const unit=scale(),radius=mapMarkerRadius(unit),owners=assigned();
  // Lay out every placement, even when filtered, so selection and search do not
  // make neighbors jump. Recompute from source points at the current zoom.
  const layoutMarkers=currentPositions().map(p=>{
    const r=radius*enemyMarkerScale(enemies.get(p.id));
    return {id:p.placementId,point:markerAnchor(p,mapLayer)||coordinates(p),radius:r,maxDisplacement:Math.max(40*unit,r*2)};
  });
  const layoutKey=JSON.stringify([unit,layoutMarkers]);
  if(layoutKey!==enemyMarkerLayoutKey){
    enemyMarkerCenters=separateMarkerCenters(layoutMarkers,0,.25,{tolerance:.02*unit});enemyMarkerLayoutKey=layoutKey;
  }
  renderMapStart(unit);
  renderCampfires();
  let trailRoot=$('#log-movement');
  if(!trailRoot){trailRoot=svg('g',{id:'log-movement','pointer-events':'none','aria-label':'Approximate party movement'});$('#markers').before(trailRoot);}
  trailRoot.replaceChildren();
  if(logPreview?.movementVisible){
    for(const line of movementTrailLines(logPreview.movementTrail,logPreview.reviewState,mapLayer,dungeon,data.heroes)){
      const attrs={points:line.points.map(p=>p.join(',')).join(' '),fill:'none',opacity:line.inCombat?.65:1,
        'stroke-dasharray':line.estimated?'2 8':'8 5','stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'};
      trailRoot.append(svg('polyline',{...attrs,stroke:'#10171b','stroke-width':line.inCombat?4:5}),svg('polyline',{...attrs,stroke:line.color,'stroke-width':line.inCombat?2:3}));

    }
  }
  const markerRoot=$('#markers');markerRoot.replaceChildren();$('#patrols').replaceChildren();$('#pack-labels').replaceChildren();$('#pack-efficiency').replaceChildren();$('#pack-health').replaceChildren();$('#status-badges').replaceChildren();
  const visible=visiblePositions();const sorted=[...visible].sort((a,b)=>Number(enemies.get(a.id)?.isBoss)-Number(enemies.get(b.id)?.isBoss));
  $('#pull-outlines').replaceChildren();$('#pull-labels').replaceChildren();
  for(const [i,pull] of route.pulls.entries()){
    const members=visible.filter(p=>owners.get(p.placementId)?.pull.id===pull.id);if(!members.length)continue;
    const points=members.map(markerCoordinates),padding=radius*Math.max(...members.map(p=>enemyMarkerScale(enemies.get(p.id))))+9*unit,hull=pullOutline(points,padding),selected=pull.id===activePull;
    const g=svg('g',{'data-pull-outline':pull.id,'pointer-events':'none'});
    g.append(svg('polygon',{points:hull.map(p=>p.join(',')).join(' '),fill:pull.color,'fill-opacity':selected?.28:.2,stroke:pull.color,'stroke-width':selected?3.5:2.5,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));
    $('#pull-outlines').append(g);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const singlePack=new Set(pull.enemies.map(id=>positions.get(id)?.packId).filter(Boolean)).size===1;
    const right=Math.max(...xs)+padding+15*unit;
    const x=singlePack?(right+11*unit>view.x+view.w?Math.min(...xs)-padding-15*unit:right):(Math.min(...xs)+Math.max(...xs))/2,y=(Math.min(...ys)+Math.max(...ys))/2;
    const label=svg('g',{'data-pull-label':pull.id});
    label.append(svg('circle',{cx:x,cy:y,r:11*unit,fill:pull.color,stroke:'#111820','stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('text',{x,y,'text-anchor':'middle','dominant-baseline':'central','font-size':12*unit,'font-weight':700,fill:'#fff'},i+1));
    $('#pull-labels').append(label);
  }
  const visiblePacks=new Set(visible.map(p=>p.packId));
  for(const {packId,points} of mapPatrols(currentPositions().filter(p=>visiblePacks.has(p.packId)),mapLayer)){
    $('#patrols').append(svg('polyline',{'data-pack':packId,class:'patrol-path',points:points.map(xy=>xy.join(',')).join(' '),fill:'none',stroke:'#ffffff','stroke-width':1.8,'stroke-dasharray':'5 4','vector-effect':'non-scaling-stroke',opacity:.85}));
  }
  for(const p of sorted){
    const enemy=enemies.get(p.id),own=owners.get(p.placementId),chicken=!enemy?.isBoss&&(route.excluded.includes(p.placementId)||logPreview&&logChickenPreview.has(p.placementId)),[x,y]=markerCoordinates(p),r=radius*enemyMarkerScale(enemy);
    const portrait=chicken?chickenIcon:showIcons&&availableImage(enemy),hasPortrait=portrait&&!failedMobImages.has(portrait);
    const empowered=isEmpowered(p);
    const color=own?.pull.color||(enemy?.isBoss?'#df858c':'#879eab');
    const group=svg('g',{'data-placement':p.placementId,role:'button',tabindex:0,'aria-label':`${placementName(p,enemy)}, ${p.modifier?enemies.get(p.id).name:'G'+packNumbers.get(p.packId)}, ${fmt(pointScore(p))} points`,opacity:matchesSearch(p)?1:.14});
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
    group.append(svg('circle',{cx:x,cy:y,r:r+unit*(enemy?.isBoss?2:.75),fill:enemy?.isBoss?'#10161bcc':'#10161b99'}));
    group.append(svg('circle',{cx:x,cy:y,r,fill:own?color:'#263640'}));
    if(hasPortrait){
      const image=svg('image',{href:portrait,x:x-r,y:y-r,width:r*2,height:r*2,preserveAspectRatio:'xMidYMid slice','clip-path':'url(#mob-portrait-clip)','pointer-events':'none'});
      image.addEventListener('error',()=>{failedMobImages.add(portrait);renderMap();},{once:true});
      group.append(image);
      if(own)group.append(svg('circle',{cx:x,cy:y,r,fill:color,'fill-opacity':.3,'pointer-events':'none',class:'mob-pull-tint'}));
    }
    group.append(svg('circle',{cx:x,cy:y,r,fill:'none',stroke:chicken?'#ffcd70':color,class:'mob-ring'+(enemy?.isBoss?' boss-ring':'')+(own?' assigned-ring':'')+(chicken?' chicken-ring':'')}));
    appendEnemyFocus(group);
    markerRoot.append(group);
  }
  setHoveredPack(hoveredPack);
  renderModifierHighlight();
  for(const group of $$('#markers > g'))if(logHighlights.has(group.dataset.placement)){
    const ring=group.querySelector('.mob-ring');if(!ring)continue;
    group.style.opacity='1';group.append(svg('circle',{cx:ring.getAttribute('cx'),cy:ring.getAttribute('cy'),r:Number(ring.getAttribute('r'))+6*scale(),class:'log-choice-ring','pointer-events':'none'}));
  }
  if($('#show-pack-efficiency').checked){
    const packs=new Map(),efficiency=dungeonPackEfficiencies(dungeon,enemies,route);
    for(const p of visible){
      if(!matchesSearch(p))continue;
      if(!packs.has(p.packId))packs.set(p.packId,[]);
      packs.get(p.packId).push(p);
    }
    for(const [id,ps] of packs){
      // Search and floor visibility affect placement, never the pack's value.
      const value=efficiency.values.get(id);
      if(value==null)continue;
      const points=ps.map(markerCoordinates),x=points.reduce((sum,p)=>sum+p[0],0)/points.length;
      const y=Math.max(...points.map((p,i)=>p[1]+radius*enemyMarkerScale(enemies.get(ps[i].id))))+11*unit;
      const label=value.toFixed(2),width=(label.length*6.2+6)*unit;
      const badge=svg('g',{'data-pack-efficiency':id,'aria-label':`Pack efficiency ${label}`});
      badge.append(svg('rect',{x:x-width/2,y:y-8*unit,width,height:16*unit,rx:2*unit,fill:packEfficiencyColor(value,efficiency.range)}),svg('text',{x,y,'text-anchor':'middle','dominant-baseline':'central','font-size':11*unit,'font-family':'Segoe UI,sans-serif','font-weight':700,fill:'#fff'},label));
      $('#pack-efficiency').append(badge);
    }
  }
  if(showMapHealth()){
    const packs=new Map();
    for(const p of visible){if(!matchesSearch(p))continue;if(!packs.has(p.packId))packs.set(p.packId,[]);packs.get(p.packId).push(p);}
    const healthLabels=[],ordered=[...packs].sort((a,b)=>Number(b[1].some(p=>owners.has(p.placementId)))-Number(a[1].some(p=>owners.has(p.placementId))));
    for(const [id,members] of ordered){
      const points=members.map(markerCoordinates),x=points.reduce((sum,p)=>sum+p[0],0)/points.length;
      const y=Math.max(...points.map((p,i)=>p[1]+radius*enemyMarkerScale(enemies.get(members[i].id))))+($('#show-pack-efficiency').checked?29:12)*unit;
      const allMembers=[...positions.values()].filter(p=>p.packId===id),label='♥ '+formatHealth(positionsHealth(allMembers,enemies,route));
      const width=(label.length*6+8)*unit,box={x:x-width/2,y:y-11*unit,w:width,h:17*unit};
      if(healthLabels.some(r=>box.x<r.x+r.w&&box.x+box.w>r.x&&box.y<r.y+r.h&&box.y+box.h>r.y))continue;
      healthLabels.push(box);
      $('#pack-health').append(svg('text',{x,y,'data-pack-health':id,'text-anchor':'middle','font-size':10*unit,'font-family':'Segoe UI,sans-serif',fill:'#ffc1cb',stroke:'#0a1119','stroke-width':3*unit,'paint-order':'stroke','stroke-linejoin':'round'},label));
    }
  }
  if($('#show-packs').checked){
    const packs=new Map();for(const p of visible){if(!matchesSearch(p))continue;if(!packs.has(p.packId))packs.set(p.packId,[]);packs.get(p.packId).push(p);}
    const placedLabels=[];
    const orderedPacks=[...packs].sort((a,b)=>Number(b[1].some(p=>owners.get(p.placementId)?.pull.id===activePull))-Number(a[1].some(p=>owners.get(p.placementId)?.pull.id===activePull)));
    for(const [id,ps]of orderedPacks){
      // Keep room for status badges without moving the label when a status changes.
      const points=ps.map(markerCoordinates),x=points.reduce((s,p)=>s+p[0],0)/ps.length,y=Math.min(...points.map((p,i)=>p[1]-radius*enemyMarkerScale(enemies.get(ps[i].id))))-30*unit;
      const score=ps.reduce((s,p)=>s+(pointScore(p)||0),0);
      const label=pct(score/dungeon.requiredScore*100);
      const width=label.length*5.7*unit,box={x:x-width/2,y:y-11*unit,w:width,h:15*unit};
      if(placedLabels.some(r=>box.x<r.x+r.w&&box.x+box.w>r.x&&box.y<r.y+r.h&&box.y+box.h>r.y))continue;
      placedLabels.push(box);
      $('#pack-labels').append(svg('text',{x,y,'text-anchor':'middle','font-size':10*unit,'font-family':'Segoe UI,sans-serif',fill:'#e6e4dc',stroke:'#0a1119','stroke-width':3*unit,'paint-order':'stroke','stroke-linejoin':'round'},label));
    }
  }
  $('#drawings').replaceChildren();for(const d of [...route.drawings,...route.markers.map(markerAnnotation)]){const projected=drawingOnMap(drag?.edit?.id===d.id?drag.edit:d,mapLayer,dungeon);if(projected)drawAnnotation(projected,$('#drawings'),unit);}
  renderDraft();cursorUI?.refresh();
}
function drawAnnotation(d,root,unit){
  const color=relicColors[d.kind]||d.color;
  const isDraft=d.id==='draft',width=d.kind==='line'?(d.width||3):3;
  const g=svg('g',{'data-drawing':d.id,class:`annotation${drag?.edit?.id===d.id?' editing':''}`,...(!isDraft?{tabindex:0,role:'group','aria-label':d.kind==='line'?'Arrow':d.kind==='note'?'Note: '+d.text:d.kind}:{'pointer-events':'none'})});
  if(['marker','note'].includes(d.kind)){
    if(!isDraft){g.setAttribute('data-endpoint','0');g.classList.add('annotation-handle');}
    const icon=markerIcon(d),symbol=markerSymbol(icon),number=numberedAnnotations(route).findIndex(item=>item.id===d.id)+1;
    const [x,y]=d.points[0],radius=Math.max(12,5+String(number).length*3)*unit;
    g.append(svg('circle',{cx:x,cy:y,r:radius+unit,fill:'none',stroke:'#ffffff','stroke-opacity':.65,'stroke-width':1,'vector-effect':'non-scaling-stroke'}),svg('circle',{cx:x,cy:y,r:radius,fill:color==='#000000'?'#e4e7ea':'#11171b',stroke:color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    if(symbol?.path)g.append(svg('path',{d:symbol.path,transform:`translate(${x-8*unit} ${y-8*unit}) scale(${16*unit/24})`,fill:symbol.stroke?'none':color,'fill-rule':symbol.fillRule||'nonzero',...(symbol.stroke?{stroke:color,'stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'}:{})}));
    else g.append(svg('text',{x,y:y+4*unit,'text-anchor':'middle','font-size':12*unit,'font-weight':700,fill:color},icon==='number'?number:legacyMarkerGlyph(icon)));
    const text=d.text||d.label||'';if(text.trim())g.append(svg('title',{},text));
  }else{
    const points=d.points.map(p=>p.join(',')).join(' ');
    if(!isDraft)g.append(svg('polyline',{points,fill:'none',stroke:'transparent','stroke-width':Math.max(16,width*6),'vector-effect':'non-scaling-stroke','pointer-events':'stroke','stroke-linecap':'round'}));
    g.append(svg('polyline',{class:'annotation-line',points,fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke','stroke-linecap':'round','stroke-linejoin':'round','stroke-dasharray':d.kind==='invis'?'7 6':d.kind==='portal'?'3 7':'none','marker-end':d.kind==='line'&&d.points.length>=2?'url(#arrowhead)':'none'}));
    if(d.kind==='line'&&!isDraft)for(const [i,[x,y]]of d.points.entries())g.append(svg('circle',{class:'arrow-handle','data-endpoint':i,cx:x,cy:y,r:6*unit,fill:color,stroke:'#fff','stroke-width':1.5,'vector-effect':'non-scaling-stroke'}));
    if(relicIcons[d.kind])for(const [i,[x,y]] of d.points.entries()){
      const endpoint=svg('g',isDraft?{}:{class:'annotation-handle','data-endpoint':i});
      endpoint.append(svg('rect',{x:x-14*unit,y:y-14*unit,width:28*unit,height:28*unit,rx:4*unit,fill:'#1a2330',stroke:color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}),svg('image',{href:relicIcons[d.kind],x:x-12*unit,y:y-12*unit,width:24*unit,height:24*unit,'pointer-events':'none'}));g.append(endpoint);
    }
  }
  root.append(g);
}
function splitColor(){let index=route.pulls.length;while(route.pulls.some(p=>p.color===pullColor(index)))index++;return pullColor(index);}
function splitPlan(line){
  const unit=scale(),radius=mapMarkerRadius(unit);
  const visible=currentPositions();
  return planPullSplit({pulls:route.pulls,points:new Map(visible.map(p=>[p.placementId,markerCoordinates(p)])),padding:ids=>radius*Math.max(...ids.map(id=>enemyMarkerScale(enemies.get(positions.get(id)?.id))))+9*unit,start:mapStart(dungeon,mapLayer),bosses:visible.filter(p=>enemies.get(p.id)?.isBoss).map(p=>p.placementId)},line);
}
function renderSplitDraft(line){
  const root=$('#draft');root.replaceChildren();
  if(line.length!==2)return;
  const plan=splitPlan(line),unit=scale();
  if(plan){
    const moved=new Set(plan.move),kept=new Set(plan.keep),color=route.pulls[plan.index].color,nextColor=route.pulls[plan.index+1]?.color||splitColor();
    const rings=new Map($$('#markers .mob-ring').map(el=>[el.parentElement.dataset.placement,Number(el.getAttribute('r'))]));
    for(const p of currentPositions())if(moved.has(p.placementId)||kept.has(p.placementId)){
      const [cx,cy]=markerCoordinates(p);
      root.append(svg('circle',{cx,cy,r:(rings.get(p.placementId)||10*unit)+4*unit,fill:'none',stroke:moved.has(p.placementId)?nextColor:color,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    }
    root.append(svg('text',{x:line[1][0]+12*unit,y:line[1][1]-12*unit,fill:'#fff',stroke:'#111820','stroke-width':3*unit,'paint-order':'stroke','font-size':12*unit},`${plan.keep.length} / ${plan.move.length} mobs`));
  }
  root.append(svg('polyline',{class:'split-line',points:line.map(p=>p.join(',')).join(' '),fill:'none',stroke:plan?'#70d9ff':'#ffb366','stroke-width':2,'stroke-dasharray':'6 4','vector-effect':'non-scaling-stroke'}));
}
function commitSplit(line){
  draft=[];
  if(!canEdit()){renderMap();return;}
  const plan=splitPlan(line);
  if(!plan){renderMap();toast('Draw through a pull with mobs on both sides.');return;}
  const id=uid();
  // Match adding a pull at the end and moving it: colors belong to list positions.
  if(change([{type:'add-pull',id,color:splitColor()},{type:'move-pull',pullId:id,afterId:plan.pullId},{type:'assign-mobs',pullId:id,mobIds:plan.move,toggle:false}])){
    activePull=plan.pullId;setTool('select');toast(`Pull split: ${plan.keep.length} + ${plan.move.length} mobs`);
  }
}
function renderDraft(preview){const root=$('#draft');root.replaceChildren();if(tool==='split'){renderSplitDraft(drag?.split&&drag.moved?[drag.start,drag.end||drag.start]:preview&&draft.length?[draft[0],preview]:draft);return;}if(draft.length)drawAnnotation({id:'draft',mapId:mapLayer.id,kind:tool,color:tool==='line'?arrowColor:(active()?.color||pullColor(0)),width:arrowWidth,points:preview?[draft[0],preview]:draft},root,scale());}
function point(event){const p=$('#map').createSVGPoint();p.x=event.clientX;p.y=event.clientY;const v=p.matrixTransform($('#map').getScreenCTM().inverse());return[v.x,v.y];}
function commitDrag(state){if(!state.edit||!state.moved)return;change(state.edit.kind==='marker'?{type:'update-marker',markerId:state.edit.id,patch:{position:state.edit.points[0]}}:{type:'move-point',drawingId:state.edit.id,pointId:state.edit.pointIds[state.endpoint],position:state.edit.points[state.endpoint]});}
function draggedDrawingPoint(event,state){const pos=point(event).map((v,i)=>v+state.offset[i]);return drawingPointFromMap(pos,state.edit,mapLayer,dungeon);}
function zoom(factor,at){const anchor=at||[view.x+view.w/2,view.y+view.h/2];factor=Math.max(baseView.w/24,Math.min(baseView.w*2.5,view.w*factor))/view.w;if(factor===1)return;view={x:anchor[0]+(view.x-anchor[0])*factor,y:anchor[1]+(view.y-anchor[1])*factor,w:view.w*factor,h:view.h*factor};renderMap();}
function setTool(value,{cancel=false}={}){
  if(value!=='line')closeArrowOptions();
  if(value!==tool||cancel){
    draft=[];if(drag?.split)drag=null;
  }
  tool=value;$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$('#map').style.cursor=['select'].includes(tool)?'grab':'crosshair';$$('[data-configure]').forEach(b=>b.classList.toggle('active',b.dataset.configure===tool));renderMap();
}
function choosePacks(ids,options){
  const available=effectivePositions(route,dungeon),selected=new Set(ids);
  const packs=new Set(available.filter(p=>selected.has(p.placementId)).map(p=>p.packId));
  const members=available.filter(p=>packs.has(p.packId)).map(p=>p.placementId);
  if(members.length){const commands=[];if(!active()){activePull=uid();commands.push({type:'add-pull',id:activePull});}commands.push({type:'assign-mobs',pullId:activePull,mobIds:members,toggle:options?.toggle??true});change(commands);}
}
function chooseEnemy(id){if(logPreview){logImportUI.choosePlacement(id);return;}choosePacks([id]);}
function commitDrawing(){if(draft.length!==2)return;const drawing={id:uid(),mapId:mapLayer.id,kind:tool,color:relicColors[tool]||arrowColor,...(tool==='line'?{width:arrowWidth}:{}),points:draft.map(p=>[...p])};draft=[];change({type:'add-drawing',...drawing});}
function showDialog(title,html){cursorUI?.pause();$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function showScoreInfo(){
  showDialog('Scoring',`<p>Kill score uses the game’s current values, rounded up per enemy after modifiers. Replaced enemies and Chicken targets contribute zero.</p><p>Empowered multiplies kill score by ${gameServiceRules.empoweredScoreMultiplier}. Its extra health scales only up to difficulty ${gameServiceRules.modifierDifficultyCap}; ordinary health continues scaling. The inspector, HP totals and pack efficiency use the selected difficulty. The cap corresponds to E${gameServiceRules.modifierDifficultyCap-20}.</p><p>Selected difficulty also applies Ultimatum to bosses and Stone Skin to eligible non-boss enemies. Stone Skin adds capped base health independently of Empowered. Its death explosions are not subtracted from route HP.</p><p>Shadow Lord uses cumulative kill score and the game’s rounded percentage thresholds. Ghorn and Witch contribute; Emissaries do not. Every ${gameServiceRules.shadowOrbsPerLord} collected orbs can summon an Emissary.</p><p class="muted">Orb totals predict the selected deaths. Pickup timing, unselected summons, resets and failed spawns are not simulated. Total route HP includes selected bosses and summoned Emissaries. Chicken targets use their size-specific chicken HP at the selected difficulty. The original enemy’s Empowered bonus is removed; affixes use the chicken’s own eligibility. Minimum group DPS is total HP divided by the full dungeon timer, with no allowance for travel. Kill score percentage is shown against the ordinary dungeon requirement; Shadow Lord completion requires defeating the summoned Emissaries.</p>`);
}
function showHelp(){showDialog('Start your route with a pull',`<div class="help-grid"><kbd>Click</kbd><span>Add or remove a whole pack in the active pull.</span><kbd>Right-click enemy</kbd><span>Add or remove Chicken, or choose Info for stats and abilities.</span><kbd>B / V</kbd><span>Box selection of whole packs / pack selection.</span><kbd>N</kbd><span>Create and select the next pull.</span><kbd>S</kbd><span>Split a pull: drag a line or click two points. The pull with the longest intersection is split; mobs closer to the previous pull or entrance stay first. The other part is inserted immediately after it. Preview rings show both groups; Esc cancels.</span><kbd>D · Esc</kbd><span>Draw an arrow with two clicks · cancel. Choose color and thickness beside the arrow tool. Hover an arrow and drag either endpoint.</span><kbd>Right-click drawing</kbd><span>Delete an arrow, portal or invisibility path; edit or delete a note. Hover a numbered note to read its text.</span><kbd>Scroll / F</kbd><span>Zoom / fit the map.</span><kbd>Drag</kbd><span>Pan the map. With other tools, drag using the right mouse button.</span><kbd>Ctrl + Z / Y</kbd><span>Undo / redo a change.</span></div><p>Drag pulls to reorder them. Selecting an enemy assigned to another pull moves its whole pack to the active pull without double-counting. Routes are stored in this browser; export a route string to keep a separate copy.</p><p>The counter uses the base kill scores of selected enemies. <button id="help-score" class="text-button">Shadow Lord calculations and limitations ↗</button></p>`);$('#help-score').onclick=showScoreInfo;}
function renderInspector(id){
  const p=positions.get(id);if(!p){inspected=null;$('#inspector').hidden=true;return;}inspected=id;const e=enemies.get(p.id),score=pointScore(p),abilities=enemyAbilities(data.abilities,p.id);
  $('#inspector').innerHTML=`<button class="close-inspector" aria-label="Close enemy details">×</button><div class="enemy-profile">${availableImage(e)?'<img src="'+availableImage(e)+'" alt="">':''}<div><h2>${esc(placementName(p,e))}</h2><small>${p.modifier?enemies.get(p.id).name:'G'+packNumbers.get(p.packId)} · ${e.isBoss?'Boss':e.canBeControlled?'Can be crowd-controlled':'Immune to crowd control'}</small></div></div><div class="enemy-facts"><div><span>Kill score</span>${fmt(score)} / ${pct(score/dungeon.requiredScore*100)}</div>${route.difficulty===undefined?'':`<div><span>Health · ${esc(difficultyChoice(dungeon.id,route.difficulty)?.label??'')}</span>${hp(placementHealth(p,e,route),false)}</div>`}</div>${route.modifiers.empowered.active&&route.modifiers.empowered.enemies.includes(id)?'<small class="empowered-label">Empowered</small>':''}<h3>ABILITIES · ${abilities.length}</h3>${abilities.length?abilities.map(a=>`<div class="ability"><strong>${esc(a.name)}</strong>${a.description?.replace(/<[^>]*>/g,'').trim()?'<p>'+esc(a.description.replace(/<[^>]*>/g,''))+'</p>':''}<small>${a.castInterruptibility==='always'?'Interruptible':a.castInterruptibility==='sometimes'?'Interruptibility depends on phase':a.castInterruptibility==='never'?'Not interruptible':''}${a.baseCooldownSeconds?' · CD '+fmt(a.baseCooldownSeconds)+' s':''}</small></div>`).join(''):'<p class="muted">No descriptions are available in the dataset.</p>'}`;
  $('#inspector').hidden=false;$('.close-inspector').onclick=()=>{$('#inspector').hidden=true;inspected=null;};
}
function renderModifierHighlight(){
  const button=$('.modifiers button:hover')||$('.modifiers button:focus-visible');
  const kind=button?.id,mod=route.modifiers[kind];
  if(!mod||button.disabled){modifierHighlightKey='';return;}
  const ids=new Set(kind==='empowered'
    ?[...mod.enemies,...(data['modifier-placements'].dungeons[dungeon.id]?.empowered??[])]
    :mod.active?['modifier:'+kind]:replacementMembers(dungeon,mod.packId,mod.replacedEnemies));
  const key=JSON.stringify([dungeon.id,kind,mod.active,[...ids]]);
  if(key===modifierHighlightKey)return;
  modifierHighlightKey=key;
  highlightEnemies([...ids].filter(id=>positions.has(id)&&!enemies.get(positions.get(id).id)?.isBoss));
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
function focusEnemies(ids,{preserveZoom=false,fit=false,highlight=true}={}){
  const ps=ids.map(id=>positions.get(id)).filter(Boolean),first=ps.find(p=>p.mapPosition);
  if(!first){toast('No map coordinates are available for these enemies.');return;}
  renderMap();
  if(!fit&&enemiesInViewport(ps.filter(p=>p.mapPosition))){if(highlight)highlightEnemies(ids);return;}
  const zoomRatio={w:view.w/baseView.w,h:view.h/baseView.h};
  const views=mapViews(dungeon),useFull=views[0].sources&&(mapLayer.sources||new Set(ps.filter(p=>p.mapPosition).map(p=>p.mapImageId)).size>1);
  const fullIndex=mapLayer.sources?views.findIndex(m=>m.id===mapLayer.id&&m.path===mapLayer.path):0;
  chooseFloor(useFull?fullIndex:views.findIndex(m=>m.id===first.mapImageId));
  const points=ps.filter(p=>onMap(p,mapLayer)).map(coordinates),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const w=preserveZoom?baseView.w*zoomRatio.w:Math.max(mapLayer.width*.12,Math.max(...xs)-Math.min(...xs)+mapLayer.width*.05),h=preserveZoom?baseView.h*zoomRatio.h:Math.max(mapLayer.height*.16,Math.max(...ys)-Math.min(...ys)+mapLayer.height*.05);
  view={x:cx-w/2,y:cy-h/2,w,h};renderMap();
  if(!preserveZoom){
    // Layout can displace portraits from their world positions. Fit the actual
    // circles, including boss radii, rather than clipping them at the edge.
    // Expanding the frame changes screen-space marker sizes, so refine it.
    for(let attempt=0;attempt<8;attempt++){
      const unit=scale(),radius=mapMarkerRadius(unit),bounds=ps.filter(p=>onMap(p,mapLayer)).map(p=>{
        const [x,y]=markerCoordinates(p),r=radius*enemyMarkerScale(enemies.get(p.id))+16*unit;
        return {left:x-r,right:x+r,top:y-r,bottom:y+r};
      });
      const left=Math.min(...bounds.map(b=>b.left)),right=Math.max(...bounds.map(b=>b.right));
      const top=Math.min(...bounds.map(b=>b.top)),bottom=Math.max(...bounds.map(b=>b.bottom));
      if(left>=view.x&&right<=view.x+view.w&&top>=view.y&&bottom<=view.y+view.h)break;
      const w=Math.max(view.w,right-left),h=Math.max(view.h,bottom-top);
      view={x:(left+right-w)/2,y:(top+bottom-h)/2,w,h};renderMap();
    }
  }
  if(highlight)highlightEnemies(ids);
}
function updateSaveButton(){
  let saved=store.saved.find(r=>r.id===route.id);
  const changed=hasRouteChanges({...route,name:$('#route-name').value.trim()||route.name},saved);
  $('#save-route').disabled=!canEdit()||!changed;
  $('#delete-route').hidden=!store.saved.some(r=>r.id===route.id);
  $('#save-route').title=changed?'Save changes to this browser’s library':saved?'No unsaved changes':'No changes to save';
}
async function saveNamed(){
  if(!canEdit())return;
  const name=$('#route-name').value.trim()||route.name;if(name!==route.name)change({type:'set-meta',patch:{name}});
  const saved=structuredClone(route);await persist();await routeStorage.saveBookmark(saved);
  const i=store.saved.findIndex(r=>r.id===saved.id);if(i>=0)store.saved[i]=saved;else store.saved.push(saved);updateSaveButton();toast('Route saved to this browser’s library.');
}
async function removeSavedRoute(i){
  if(i<0||!canEdit())return;
  const removed=store.saved[i];await routeStorage.removeBookmark(removed.id);store.saved.splice(i,1);updateSaveButton();
  showDialog('Route removed from the library',`<p>${esc(removed.name)}</p><button id="restore-saved" class="primary">Restore route</button>`);
  $('#restore-saved').onclick=run(async()=>{await routeStorage.saveBookmark(removed);store.saved.splice(i,0,removed);updateSaveButton();showLibrary();});
}
function showLibrary(){
  showDialog('Saved routes',store.saved.length?store.saved.map((r,i)=>`<div class="library-item"><div><strong>${esc(r.name)}</strong><small>${esc(data.dungeons.find(d=>d.id===r.dungeonId)?.name)} · ${r.pulls.length} pulls${r.shadow?' · Shadow Lord':''}</small></div><div><button data-load="${i}">Open</button><button data-remove="${i}" aria-label="Delete saved route">×</button></div></div>`).join(''):'<p class="empty-library">Your saved routes will appear here.<br>Click “Save route” below the pull list.</p>');
  $$('[data-load]').forEach(b=>b.onclick=run(async()=>{const r=store.saved[Number(b.dataset.load)];await selectDungeon(r.dungeonId,r.id);$('#dialog').close();}));
  $$('[data-remove]').forEach(b=>b.onclick=run(()=>removeSavedRoute(Number(b.dataset.remove))));
}
async function copyRouteText(text,title,message){
  try{await navigator.clipboard.writeText(text);toast(message);return;}catch{}
  // Local files and browsers without clipboard permission can still copy selected text.
  showDialog(title,'<p>Copy the selected text below.</p><textarea id="copy-route-text" aria-label="Text to copy" readonly spellcheck="false"></textarea><button id="copy-route-button" class="primary">Copy</button>');
  const field=$('#copy-route-text');field.value=text;field.focus();field.select();
  const copy=()=>{field.focus();field.select();try{if(document.execCommand('copy')){$('#dialog').close();toast(message);return true;}}catch{}return false;};
  $('#copy-route-button').onclick=copy;copy();
}
async function exportRoute(){
  try{return await copyRouteText(await encodeRoute(route,dungeon),'Export route','Route copied to clipboard.');}
  catch(err){toast('Export: '+err.message);}
}
async function shareRoute(){
  try{
    const url=new URL(location.href);url.hash='route='+await encodeRoute(route,dungeon);
    return await copyRouteText(url.href,'Share route','Route link copied to clipboard.');
  }catch(err){toast('Share: '+err.message);}
}
async function importRouteText(text){
  if(roomSession||roomTransition)throw new Error('Leave the room before importing a route.');
  const incoming=await decodeRoute(text,data.dungeons,enemies,data.loadDungeon);incoming.id=uid();
  if(!canEdit())throw new Error('Only players can import routes.');
  await selectDungeon(incoming.dungeonId,incoming);
  toast(incoming.buildId!==data.manifest.buildId?'Imported a route from another build. Check scores and pull contents.':'Route imported.');
}
function logPreviewRoute(fixture,state,id){
  if(fixture.dungeonData!==dungeonDataMode)throw new Error('Dungeon data changed. Reopen Import from log.');
  const target=data.dungeons.find(d=>d.id===fixture.dungeonID);
  if(!target)throw new Error('The log dungeon is not available in this game data.');
  const known=new Set(target.enemies.map(p=>p.placementId));
  if(Object.values(fixture.groups).some(g=>g.enemies.some(id=>!id.startsWith('modifier:')&&!known.has(id))))throw new Error('The imported route no longer matches this dungeon data. Import the log again.');
  const next=newRoute(target,data.manifest.buildId,`${fixture.title} · #${fixture.fightID}`);next.id=id;
  applyModifierPresets(next,target,data['modifier-placements']);next.shadow=fixture.shadow;
  const groups=state.pulls.flatMap(p=>p.groups.map(id=>fixture.groups[id]));
  next.modifiers.empowered={active:fixture.empowered,enemies:[...new Set([...next.modifiers.empowered.enemies,...groups.flatMap(g=>g.empowered)])]};
  for(const kind of ['ghorn','witch'])next.modifiers[kind].active=fixture.replacement[kind].active;
  // Use the exact level recorded by Fellowship Logs; affixes cannot identify a level.
  const importedDifficulty=difficultyChoice(target.id,fixture.difficulty);
  if(importedDifficulty){next.difficulty=importedDifficulty.value;applyDifficulty(next);}
  next.pulls=state.pulls.filter(p=>p.groups.length||!state.complete&&p===state.pulls.at(-1)).map((p,i)=>{
    const members=p.groups.flatMap(id=>fixture.groups[id].enemies),inferred=fixture.inferredPlacements?.filter(id=>members.includes(id))??[];
    return {...newPull(i),id:`log-pull-${i}`,enemies:members,note:`Log ${p.id}.${inferred.length||fixture.partial||fixture.expandedSearch?' '+fixture.assumption:''}`};
  });
  next.excluded=groups.flatMap(g=>g.excluded);
  next.drawings=fixture.drawings.filter(d=>state.complete||d.afterTime<=(state.pulls.at(-2)?.end??-Infinity)).map(({afterTime,...d})=>d);
  return {next,target};
}
async function previewLogRoute(fixture,state){
  if(!logPreview&&!canEdit())throw new Error('Leave the room before importing a log.');
  if(roomSession||roomTransition)throw new Error('Leave the room before importing a log.');
  await data.loadDungeon(fixture.dungeonID);
  const id=logPreview?.id??uid(),{next,target}=logPreviewRoute(fixture,state,id);
  const document=createRouteDocument(next,{dungeon:target,enemies,role:'player'});
  if(!logPreview){
    try{await persist();}catch(error){document.dispose();throw error;}
    logPreview={id,document:routeDocument,binding:routeBinding,store:structuredClone(store),snapshot:routeDocument.snapshot()};
    drag=null;draft=[];setTool('select',{cancel:true});
  }else{stopRoute?.();routeDocument.dispose();}
  logPreview.pendingPullID=state.complete?null:next.pulls.at(-1)?.id;
  logPreview.movementTrail=fixture.movementTrail;logPreview.reviewState=state;
  logPreview.movementVisible??=true;
  stopRoute?.();
  displayRouteDocument(document,null,{preserveMap:true});
  activePull=route.pulls.at(-1)?.id;render();
  $('#storage-status').textContent='Import preview · not saved yet';
}
async function cancelLogImport(){
  if(!logPreview)return;
  const previous=logPreview;stopRoute?.();routeDocument.dispose();logPreview=null;store=previous.store;
  displayRouteDocument(previous.document,previous.binding);storageStatus({state:'saved'});
}
async function commitLogImport(){
  if(!logPreview)return;
  const previous=logPreview,binding=routeStorage.bind(routeDocument,storageStatus);
  try{
    await binding.flush();
    // Keep a changed prior draft discoverable even when importing the same dungeon.
    if(hasRouteChanges(previous.snapshot,previous.store.saved.find(r=>r.id===previous.snapshot.id))){
      await routeStorage.saveBookmark(previous.snapshot);
      const index=store.saved.findIndex(r=>r.id===previous.snapshot.id);
      if(index<0)store.saved.push(previous.snapshot);else store.saved[index]=previous.snapshot;
    }
    await routeStorage.setDraft(dungeon.id,route.id);
  }catch(error){await binding.dispose().catch(()=>{});throw error;}
  await previous.binding?.dispose();previous.document.dispose();routeBinding=binding;logPreview=null;
  logHighlights.clear();logChickenPreview.clear();chooseFloor(0);render();
}
function setupLogImport(){
  logImportUI=createLogImportUI({panel:$('#log-review'),showDialog,closeDialog:()=>$('#dialog').close(),
    live:createLiveImport({data,dungeonData:()=>dungeonDataMode,persist,callback:logCallback}),
    dungeonData:()=>dungeonDataMode,
    preview:previewLogRoute,commit:commitLogImport,cancel:cancelLogImport,
    frame:ids=>{if(ids.length)focusEnemies(ids,{fit:true,highlight:false});},
    heroes:data.heroes,movement:visible=>{if(logPreview){logPreview.movementVisible=visible;renderMap();}},
    highlight:(ids,{excluded=[]}={})=>{logHighlights=new Set(ids);logChickenPreview=new Set(excluded);renderMap();},
    focus:(ids,{excluded=[]}={})=>{logHighlights=new Set(ids);logChickenPreview=new Set(excluded);focusEnemies(ids);renderMap();},
    describe:ids=>[...Map.groupBy(ids,id=>{const p=positions.get(id);return p?placementName(p,enemies.get(p.id)):id;})].map(([name,members])=>`${name} ×${members.length}`).join(', '),
    onError:message=>toast('Log import: '+message)});
}
function showImport(){
  showDialog('Import route','<label for="import-route-text">Paste a route string or Share link</label><textarea id="import-route-text" spellcheck="false" placeholder="Route string or Share link"></textarea><p id="import-error" role="alert" hidden></p><button id="import-route-button" class="primary">Import</button>');
  $('#import-route-text').focus();
  $('#import-route-button').onclick=async()=>{
    const button=$('#import-route-button');button.disabled=true;
    try{await importRouteText($('#import-route-text').value);$('#dialog').close();}
    catch(err){$('#import-error').textContent='Import: '+err.message;$('#import-error').hidden=false;}
    finally{button.disabled=false;}
  };
}
async function importRouteHash(){
  const hash=location.hash;
  if(!hash.startsWith('#route='))return;
  try{await importRouteText(hash);clearImportedRouteHash(hash);}catch(err){toast('Import: '+err.message);}
}
function clearImportedRouteHash(hash){
  // Consume the link only after the imported route is persisted. Do not remove
  // another link the user navigated to while the import was loading.
  if(location.hash!==hash||!hash.startsWith('#route='))return;
  const url=new URL(location.href);url.hash='';
  window.history.replaceState(window.history.state,'',url);
}
function search(){
  renderMap();const q=$('#search').value.trim();$('#search-results').hidden=!q;if(!q)return;
  const result=effectivePositions(route,dungeon).filter(matchesSearch);const groups=new Map();result.forEach(p=>{const key=p.id+':'+p.packId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
  $('#search-results').innerHTML=[...groups.values()].slice(0,35).map(ps=>`<button data-search-id="${ps[0].placementId}">${esc(placementName(ps[0],enemies.get(ps[0].id)))} <span class="muted">× ${ps.length} · G${packNumbers.get(ps[0].packId)}</span></button>`).join('')||'<p class="muted" style="padding:12px">No results found</p>';
}
function addPull(){const p=newPull(route.pulls.length);let index=route.pulls.length;while(route.pulls.some(pull=>pull.color===p.color))p.color=pullColor(++index);if(change({type:'add-pull',id:p.id,color:p.color})){activePull=p.id;render();$('#pulls').scrollTop=$('#pulls').scrollHeight;}}
function movePullTo(id,to){const from=route.pulls.findIndex(p=>p.id===id),target=route.pulls[to];if(!target||from===to)return;change({type:'move-pull',pullId:id,[from<to?'afterId':'beforeId']:target.id});}
function toggleRouteModifier(kind){
  if(!modifierAvailable(dungeon.id,kind))return;
  const mod=route.modifiers[kind],patch={active:!mod.active};
  // Restore fixed map markers even for routes saved by older log imports.
  if(kind==='empowered')patch.enemies=[...new Set([...mod.enemies,...(data['modifier-placements'].dungeons[dungeon.id]?.empowered??[])])];
  const commands=[{type:'set-modifier',kind,patch}];
  if(kind!=='empowered'&&patch.active){
    const other=kind==='ghorn'?'witch':'ghorn';
    if(route.modifiers[other].active)commands.push({type:'set-modifier',kind:other,patch:{active:false}});
  }
  if(kind!=='empowered'&&!mod.active&&!route.pulls.some(p=>p.enemies.includes('modifier:'+kind))){const pull=route.pulls.find(p=>p.enemies.some(id=>mod.replacedEnemies?.includes(id)));if(pull)commands.push({type:'assign-mobs',pullId:pull.id,mobIds:['modifier:'+kind]});}
  change(commands);
}
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
  $('#dungeon').onchange=run(e=>changeDungeon(e.target.value));if($('#floors'))$('#floors').onclick=e=>{const b=e.target.closest('[data-floor]');if(b)chooseFloor(Number(b.dataset.floor));};
  $('#difficulty').onchange=e=>{hideHover();hidePullTooltip();hideChickenTooltip();change({type:'set-difficulty',value:e.target.value===''?null:Number(e.target.value)});};
  try{$('#show-hp').checked=localStorage.getItem('fellowship-show-hp')==='true';}catch{}
  $('#show-hp').onchange=()=>{try{localStorage.setItem('fellowship-show-hp',String($('#show-hp').checked));}catch{}renderMap();};
  $('#route-name').oninput=updateSaveButton;
  $('#route-name').onchange=e=>change({type:'set-meta',patch:{name:e.target.value.trim()||route.name}});
  $('#shadow').onclick=()=>change({type:'set-meta',patch:{shadow:!route.shadow}});
  for(const kind of ['empowered','ghorn','witch']){
    const button=$('#'+kind);
    button.onclick=()=>toggleRouteModifier(kind);
    for(const event of ['pointerenter','pointerleave','focus','blur'])button.addEventListener(event,renderModifierHighlight);
  }
  $('#help').onclick=showHelp;$('#close-dialog').onclick=()=>$('#dialog').close();
  $('#add-pull').onclick=addPull;$('#undo').onclick=undo;$('#redo').onclick=redo;$('#save-route').onclick=run(saveNamed);$('#library').onclick=showLibrary;$('#export').onclick=exportRoute;
  $('#import').onclick=showImport;$('#share').onclick=shareRoute;
  $('#import-log-button').onclick=()=>logImportUI.open();
  window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#room='))openRoomHash();else importRouteHash();});
  $('#delete-route').onclick=run(()=>removeSavedRoute(store.saved.findIndex(r=>r.id===route.id)));
  $('#clear-route').onclick=()=>{drag=null;draft=[];hideHover();$('#enemy-menu').hidden=true;$('#inspector').hidden=true;inspected=null;$('#map').classList.remove('dragging');closeArrowOptions();const commands=[{type:'clear-route'}];if(route.difficulty===undefined){const preset=newRoute(dungeon,data.manifest.buildId);applyModifierPresets(preset,dungeon,data['modifier-placements']);commands.push(...['empowered','ghorn','witch'].map(kind=>({type:'set-modifier',kind,patch:preset.modifiers[kind]})));}change(commands);setTool('select',{cancel:true});toast('Route cleared. Undo to restore it.');};
  $('#new-route').onclick=run(async()=>{if(!canEdit())return;const changed=!$('#save-route').disabled;if(changed)await saveNamed();await selectDungeon(dungeon.id,await createRoute());toast(changed?'New route created. Your previous route was saved to the library.':'New route created.');});
  $('#layers').onclick=()=>setDisplayOptions($('#layers-panel').hidden);
  if($('#show-floor-panel')){
    $('#show-floor-panel').checked=true;
    try{$('#show-floor-panel').checked=localStorage.getItem('fellowship-map-layer-panel')!=='false';}catch{}
    $('#show-floor-panel').onchange=()=>{updateFloorPanel();try{localStorage.setItem('fellowship-map-layer-panel',String($('#show-floor-panel').checked));}catch{}};
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#layers, #layers-panel'))setDisplayOptions(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#layers-panel').hidden){setDisplayOptions(false);$('#layers').focus();}});
  ['show-packs','show-pack-efficiency','show-patrols','show-mob-icons','hide-unselected','marker-size'].forEach(id=>$('#'+id).oninput=renderMap);
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
      showDialog('Pull settings',`<label>Name<input id="edit-pull-name" value="${esc(p.name)}" maxlength="200"></label><label>Color<input id="edit-pull-color" type="color" value="${p.color}"></label><label>Note<textarea id="edit-pull-note" maxlength="4000">${esc(p.note)}</textarea></label><button id="apply-pull" class="primary">Done</button>`);
      $('#apply-pull').onclick=()=>{
        const name=$('#edit-pull-name').value.trim(),color=$('#edit-pull-color').value,text=$('#edit-pull-note').value,commands=[],patch={};
        const current=route.pulls.find(p=>p.id===id);if(!current){toast('This pull was deleted.');return;}
        if(name!==p.name)patch.name=name;if(color!==p.color)patch.color=color;
        if(text!==p.note){if(!unchangedText(current.note,p.note))return;commands.push({type:'set-text',group:'pulls',id,text});}
        if(Object.keys(patch).length)commands.push({type:'update-pull',pullId:id,patch});
        if(change(commands))$('#dialog').close();
      };return;
    }
    if(action==='delete'){const commands=[{type:'delete-pull',pullId:id}];if(route.pulls.length===1)commands.push({type:'add-pull'});change(commands);}else movePullTo(id,i+(action==='up'?-1:1));
  };

  $('#pulls').onkeydown=e=>{if(e.target.matches('.pull-card')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();activePull=e.target.dataset.pull;render();}};
  let draggedPull;
  $('#pulls').ondragstart=e=>{if(e.target.closest('textarea,input,button')){e.preventDefault();return;}draggedPull=e.target.closest('[data-pull]')?.dataset.pull;e.dataTransfer.effectAllowed='move';};
  $('#pulls').ondragover=e=>e.preventDefault();$('#pulls').ondrop=e=>{e.preventDefault();const target=e.target.closest('[data-pull]')?.dataset.pull;if(!target||!draggedPull||target===draggedPull)return;movePullTo(draggedPull,route.pulls.findIndex(p=>p.id===target));draggedPull=null;};
  const map=$('#map');
  map.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.12:1/1.12,point(e));},{passive:false});
  map.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==2)return;
    $('#enemy-menu').hidden=true;hideHover();
    suppressClick=false;
    const pan=e.button===2||tool==='select';
    drag={start:point(e),client:[e.clientX,e.clientY],view:{...view},pan,moved:false,box:tool==='box'&&e.button===0,target:e.target.closest('[data-placement]')?.dataset.placement,drawing:e.target.closest('[data-drawing]')?.dataset.drawing};
    const endpoint=e.target.closest('[data-endpoint]'),drawing=annotation(drag.drawing);drag.vertex=endpoint?Number(endpoint.dataset.endpoint):undefined;
    drag.split=tool==='split'&&e.button===0&&canEdit();
    if(canEdit()&&tool!=='split'&&e.button===0&&endpoint&&drawing){
      drag.edit=structuredClone(drawing);drag.endpoint=Number(endpoint.dataset.endpoint);drag.pan=false;drag.box=false;
      drag.offset=drawingOnMap(drawing,mapLayer,dungeon).points[drag.endpoint].map((v,i)=>v-drag.start[i]);
    }
    map.setPointerCapture(e.pointerId);if(drag.pan)map.classList.add('dragging');
  });
  map.addEventListener('pointermove',e=>{
    if(drag){
      if(Math.hypot(e.clientX-drag.client[0],e.clientY-drag.client[1])>4)drag.moved=true;
      if(drag.split&&drag.moved){drag.end=point(e);renderSplitDraft([drag.start,drag.end]);}
      else if(drag.edit&&drag.moved){const pos=draggedDrawingPoint(e,drag);if(pos){drag.edit.points[drag.endpoint]=pos;renderMap();}}
      else if(drag.pan&&drag.moved){const now=point(e);view.x+=drag.start[0]-now[0];view.y+=drag.start[1]-now[1];$('#map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);cursorUI?.refresh();$('#tooltip').hidden=true;}
      else if(drag.box&&drag.moved){const now=point(e);$('#draft').replaceChildren(svg('rect',{x:Math.min(drag.start[0],now[0]),y:Math.min(drag.start[1],now[1]),width:Math.abs(now[0]-drag.start[0]),height:Math.abs(now[1]-drag.start[1]),fill:'#e4b76b22',stroke:'#e4b76b','stroke-width':1,'vector-effect':'non-scaling-stroke'}));}
      return;
    }
    if(!$('#enemy-menu').hidden)return;
    if(draft.length===1&&['line','portal','invis','split'].includes(tool))renderDraft(point(e));
    if(tool==='split')return;
    const candidate=annotation(e.target.closest('[data-drawing]')?.dataset.drawing),note=['note','marker'].includes(candidate?.kind)?candidate:null;
    if(note){hideHover();if(!note.text?.trim())return;const tip=$('#tooltip');tip.dataset.placement='';tip.innerHTML=`<div class="note-tooltip-text">${esc(note.text)}</div>`;positionPopover(tip,e);return;}
    const id=e.target.closest('[data-placement]')?.dataset.placement;if(!id){hideHover();return;}
    const p=positions.get(id),enemy=enemies.get(p.id),score=pointScore(p),pack=effectivePositions(route,dungeon).filter(v=>v.packId===p.packId);
    setHoveredPack(p.packId);
    const tip=$('#tooltip');
    if(tip.hidden||tip.dataset.placement!==id){
      tip.dataset.placement=id;
      const packPercent=positionsPercent(pack);
      tip.innerHTML=`<strong>${esc(placementName(p,enemy))}</strong>${isEmpowered(p)?`<div class="tip-empowered"><img src="${empoweredIcon}" alt="">Empowered</div>`:''}<span class="tip-score">${fmt(score)} points · ${pct(positionsPercent([p]))}${showHealth()?' · '+hp(placementHealth(p,enemy,route)):''}</span>${!enemy.isBoss&&route.excluded.includes(id)?'<div>Chicken</div>':''}<div class="tip-pack-heading">${p.modifier?esc(enemy.name):'G'+packNumbers.get(p.packId)} · ${pack.length} enemies in pack · ${pct(packPercent)}${showHealth()?' · '+hp(positionsHealth(pack,enemies,route)):''}</div><ul class="tip-pack">${pack.map(member=>{const mob=enemies.get(member.id),icon=availableImage(mob);return `<li class="${member.placementId===id?'current':''}" ${member.placementId===id?'aria-current="true"':''}>${icon?`<img src="${icon}" alt="">`:''}<span>${esc(placementName(member,mob))}</span><span class="tip-pack-status">${isEmpowered(member)?`<img src="${empoweredIcon}" alt="Empowered" title="Empowered">`:''}${route.excluded.includes(member.placementId)?`<img class="tip-chicken" src="${chickenIcon}" alt="Chicken">`:''}<span class="tip-pack-percent">${pct(positionsPercent([member]))}</span></span></li>`;}).join('')}</ul>`;
    }
    positionPopover(tip,e);
  });
  map.addEventListener('pointerup',e=>{
    if(!drag)return;const state=drag;drag=null;map.classList.remove('dragging');map.releasePointerCapture(e.pointerId);suppressClick=state.moved;
    if(state.split&&state.moved){commitSplit([state.start,point(e)]);return;}
    if(state.edit){
      suppressClick=true;
      if(state.moved){const pos=draggedDrawingPoint(e,state);if(pos)state.edit.points[state.endpoint]=pos;commitDrag(state);}
      else renderMap();
      return;
    }
    if(state.box&&state.moved){const end=point(e),minX=Math.min(state.start[0],end[0]),maxX=Math.max(state.start[0],end[0]),minY=Math.min(state.start[1],end[1]),maxY=Math.max(state.start[1],end[1]);const ids=visiblePositions().filter(p=>{const[x,y]=markerCoordinates(p);return matchesSearch(p)&&x>=minX&&x<=maxX&&y>=minY&&y<=maxY;}).map(p=>p.placementId);choosePacks(ids,{toggle:false});$('#draft').replaceChildren();}
    if(e.button===0&&!state.moved&&tool==='select'&&state.target){chooseEnemy(state.target);suppressClick=true;}
    if(e.button===2&&!state.moved){if(state.drawing)showDrawingMenu(state.drawing,e,state.vertex);else if(state.target)showEnemyMenu(state.target,e);}
  });
  map.addEventListener('pointercancel',()=>{const state=drag;drag=null;if(state?.split)draft=[];if(state?.edit&&state.moved)commitDrag(state);suppressClick=true;map.classList.remove('dragging');renderMap();});
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
    if(!canEdit())return;
    if(tool==='marker'){editMarker(null,pos);return;}
    if(tool==='split'){draft.push(pos);if(draft.length===2)commitSplit(draft);else renderDraft();return;}
    draft.push(pos);if(['line','portal','invis'].includes(tool)&&draft.length===2){if(Math.hypot(pos[0]-draft[0][0],pos[1]-draft[0][1])<4*scale()){draft.pop();return;}commitDrawing();setTool('select');}else renderDraft();
  });
  map.addEventListener('keydown',e=>{const id=e.target.closest('[data-placement]')?.dataset.placement,drawing=e.target.closest('[data-drawing]')?.dataset.drawing;if(!id&&!drawing)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const rect=e.target.getBoundingClientRect();(drawing?showDrawingMenu:showEnemyMenu)(drawing||id,{clientX:rect.right,clientY:rect.top});}else if(id&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(tool==='select')chooseEnemy(id);}});
  document.addEventListener('keydown',e=>{
    if(e.target.closest('input,textarea,select')||$('#dialog').open||roomSession&&!roomSession.document||roomTransition)return;
    // Physical letter keys keep shortcuts independent of the active keyboard layout.
    const key=/^Key[A-Z]$/.test(e.code)?e.code.slice(3).toLowerCase():e.key.toLowerCase();
    if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if((e.ctrlKey||e.metaKey)&&key==='y'){e.preventDefault();redo();return;}
    if((e.ctrlKey||e.metaKey)&&key==='f'){e.preventDefault();$('#search').focus();return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(key==='n')addPull();if(key==='f')fitMap();if(key==='b')setTool('box');if(key==='v')setTool('select');if(key==='d')setTool('line');if(key==='s'&&canEdit())setTool('split');if(key==='escape'){if(drag?.split)suppressClick=true;drag=null;map.classList.remove('dragging');closeArrowOptions();setTool('select',{cancel:true});$('#inspector').hidden=true;inspected=null;$('#layers-panel').hidden=true;$('#search-results').hidden=true;}
  });
  new ResizeObserver(()=>{if(route)renderMap();}).observe($('#map-stage'));
  $('#storage-status').onclick=run(persist);
  window.addEventListener('blur',()=>{const state=drag;drag=null;if(state?.split){draft=[];suppressClick=true;renderMap();}if(state?.edit&&state.moved)commitDrag(state);map.classList.remove('dragging');});
  window.addEventListener('beforeunload',e=>{if(routeBinding?.pending){e.preventDefault();e.returnValue='';}});
}
async function init(){
  data=await loadData();enemies=new Map(data.enemies.map(e=>[e.id,e]));for(const [kind,name]of [['ghorn','Ghorn'],['witch','Witch']])enemies.set('modifier:'+kind,{...enemies.get(modifierStats[kind].sourceId),...modifierStats[kind],id:'modifier:'+kind,name,isBoss:false});
  if(data['modifier-placements'].buildId!==data.manifest.buildId)throw new Error('Modifier placements need updating for this game data build. Run node scripts/prepare-modifiers.mjs.');
  if(fullMapBuildId!==data.manifest.buildId)throw new Error('Full map coordinates need updating for this game data build. Run node scripts/prepare-full-maps.mjs.');
  if(combinedBuildId!==data.manifest.buildId)throw new Error('Combined maps need updating for this game data build. Run npm run maps.');
  data.loadDungeon=createDungeonLoader(data.dungeons,d=>correctDungeon(d,dungeonDataMode));
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&saved.drafts&&Array.isArray(saved.saved))store=saved;}catch{toast('Browser storage is corrupted. You can import a route string backup.');}
  for(const saved of [...Object.values(store.drafts),...store.saved]){
    if(!saved||typeof saved!=='object')continue;
    saved.name=englishDefaultLabel(saved.name);
    if(Array.isArray(saved.pulls))for(const pull of saved.pulls){if(pull)pull.name=englishDefaultLabel(pull.name);}
  }
  $('#dungeon').innerHTML=[...data.dungeons].sort((a,b)=>a.name.localeCompare(b.name)).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
  routeStorage=await openRouteStorage();
  if(!await routeStorage.isMigrated()){
    const ids=new Set([...Object.values(store.drafts),...store.saved].map(value=>value?.dungeonId));
    // Resolve only referenced legacy routes before migrating. A network failure
    // must not mark the library migrated and strand otherwise valid backups.
    await Promise.all([...ids].filter(id=>data.dungeons.some(d=>d.id===id)).map(id=>data.loadDungeon(id)));
  }
  const errors=await migrateLegacyLibrary(routeStorage,store,{dungeons:data.dungeons,enemies,presets:data['modifier-placements']});
  store=await routeStorage.library();
  let incoming;const initialRouteHash=location.hash;
  if(initialRouteHash.startsWith('#route=')){
    try{incoming=await decodeRoute(initialRouteHash,data.dungeons,enemies,data.loadDungeon);incoming.id=uid();}
    catch(error){toast('Import: '+error.message);}
  }
  bind();setupRooms();setupLogImport();await selectDungeon(incoming?.dungeonId||store.lastDungeon||'Level.ID.FrozenKingdom',incoming);
  if(incoming)clearImportedRouteHash(initialRouteHash);
  let resume;try{resume=JSON.parse(sessionStorage.getItem('rt-room'));}catch{}
  if(location.hash.startsWith('#room=')){const code=roomCode(location.hash);if(resume?.code===code)await startRoom({...resume,code});else openRoomHash();}
  setTool('select');
  if(errors.length)toast('Some older routes could not be migrated. Their original browser backup is preserved.');
  await logImportUI.resume();
}
init().catch(err=>{$('#map-loading').hidden=false;$('#map-loading').textContent=err.message;$('#map-loading').classList.add('fatal');console.error(err);});
