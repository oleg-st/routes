import {record,invariant,id} from './route-schema.js';
import {drawingMap,drawingOnMap} from '../map-views.js';
export const CURSOR_INTERVAL=50, CURSOR_HEARTBEAT=1000;
export function validCursor(value,dungeon){
  record(value,['sequence','visible','mapId','x','y']);
  invariant(Number.isSafeInteger(value.sequence)&&value.sequence>=0&&typeof value.visible==='boolean','Invalid cursor.');
  if(!value.visible)return value;
  id(value.mapId);const source=drawingMap(dungeon,value.mapId);
  invariant(source&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.y>=0&&value.x<=source.width&&value.y<=source.height,'Invalid cursor coordinates.');
  return value;
}
export function projectCursor(cursor,view,dungeon){
  const source=drawingMap(dungeon,cursor.mapId);
  if(!source||!cursor.visible||source.id!==view.id&&!source.sources&&!view.sources)return null;
  return drawingOnMap({mapId:cursor.mapId,kind:'note',points:[[cursor.x,cursor.y]]},view,dungeon)?.points[0]??null;
}
export function sessionColor(sessionId){let hash=0;for(const char of sessionId)hash=(hash*31+char.charCodeAt(0))>>>0;return 'hsl('+hash%360+' 80% 72%)';}
// Keep the last position until explicit hiding, peer removal, or room cleanup.
// Ephemeral state has no reference to a CRDT document or storage binding.
export function createCursorPresence({send,onChange=()=>{},now=()=>Date.now(),intervalMs=CURSOR_INTERVAL}){
  const remote=new Map();let local=null,dirty=false,sequence=0,lastSent=-Infinity,timer,closed=false;
  const values=()=>[...remote].filter(([,r])=>r.cursor.visible).map(([sessionId,r])=>({sessionId,...r.cursor}));
  const emit=()=>onChange(values());
  function tick(){
    if(closed)return;
    if(now()-lastSent>=CURSOR_INTERVAL&&(dirty||local&&now()-lastSent>=CURSOR_HEARTBEAT)){
      dirty=false;lastSent=now();send({sequence:++sequence,visible:Boolean(local),...(local||{})});
    }
  }
  return {
    start(){if(!timer&&intervalMs>0)timer=setInterval(tick,intervalMs);},tick,values,
    set(value){if(closed)return;const next=value?{mapId:value.mapId,x:value.x,y:value.y}:null;if(JSON.stringify(next)===JSON.stringify(local))return;local=next;dirty=true;tick();},
    receive(sessionId,cursor){const old=remote.get(sessionId);if(closed||old&&cursor.sequence<=old.cursor.sequence)return false;remote.set(sessionId,{cursor:{...cursor}});emit();return true;},
    remove(sessionId){if(remote.delete(sessionId))emit();},
    clear(){local=null;dirty=false;remote.clear();emit();},
    dispose(){closed=true;clearInterval(timer);remote.clear();local=null;emit();},
  };
}
