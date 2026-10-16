import {roomTransportConfig,roomAppId} from './room-config.js';
import {MAX_BYTES,MAX_HEADER} from './room-protocol.js';
import {turnServiceConfig} from './turn-service-config.js';
import {createTurnCredentials} from './turn-credentials.js';
import {verifyTurnstile} from './turn-verification.js';
const prepareTurn=createTurnCredentials({settings:turnServiceConfig,verify:verifyTurnstile});
export async function createTrysteroTransport({roomId,connectionConfig={},signal,onPeerJoin,onPeerLeave,onMessage,onPresence=()=>{},onError}) {
  // Importing/joining happens only after an explicit create/join (or resuming that tab's room).
  connectionConfig=await prepareTurn(connectionConfig,signal);signal?.throwIfAborted();
  const {joinRoom}=await import('trystero');
  signal?.throwIfAborted();
  const room=joinRoom({...roomTransportConfig,...connectionConfig,rtcConfig:{...roomTransportConfig.rtcConfig,...connectionConfig.rtcConfig},appId:roomAppId,maxReceiveBytes:MAX_BYTES+MAX_HEADER+4},roomId,{onJoinError:({error})=>onError(new Error(String(error)))});
  const presence=room.makeAction('rt-cursor');
  presence.onReceive=({byteLength})=>!closed&&byteLength<=2048;
  presence.onMessage=(data,{peerId})=>{if(!closed)onPresence(peerId,data);};
  const cursorPending=new Map(),cursorBusy=new Set();
  async function drainCursor(peerId){
    if(closed||cursorBusy.has(peerId)||!cursorPending.has(peerId))return;
    const data=cursorPending.get(peerId);cursorPending.delete(peerId);cursorBusy.add(peerId);
    const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),500);
    try{await presence.send(data,{target:peerId,signal:controller.signal});}catch{}finally{clearTimeout(timeout);controllers.delete(controller);cursorBusy.delete(peerId);if(!closed)void drainCursor(peerId);}
  }
  const action=room.makeAction('rt-v1');let closed=false,pendingBytes=0;
  action.onReceive=({byteLength})=>!closed&&byteLength<=MAX_BYTES+MAX_HEADER+4;
  action.onMessage=(data,{peerId})=>{if(!closed)onMessage(peerId,data);};
  room.onPeerJoin=onPeerJoin;room.onPeerLeave=onPeerLeave;
  for(const peerId of Object.keys(room.getPeers()))queueMicrotask(()=>{if(!closed)onPeerJoin(peerId);});
  const controllers=new Set();
  const expiryTimer=connectionConfig.turnExpiresAt?setTimeout(()=>{if(!closed)onError(new Error('Relay access is expiring. Reconnect to renew it.'));},Math.max(0,connectionConfig.turnExpiresAt-Date.now()-60000)):null;
  return {
    async send(peerId,frame){
      if(closed)throw new Error('Room transport is closed.');
      if(pendingBytes+frame.byteLength>2*MAX_BYTES)throw new Error('Connection is busy; changes will be retried.');
      pendingBytes+=frame.byteLength;const controller=new AbortController();controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(new Error('Peer transfer timed out.')),30000);
      try{await action.send(frame,{target:peerId,signal:controller.signal});}finally{clearTimeout(timer);controllers.delete(controller);pendingBytes-=frame.byteLength;}
    },
    sendPresence(peerId,data){if(closed)return;cursorPending.set(peerId,data);void drainCursor(peerId);},
    async connectionType(peerId){
      const pc=room.getPeers()[peerId];if(!pc)return 'unknown';const stats=await pc.getStats();
      let pair;for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId)pair=stats.get(row.selectedCandidatePairId);
      if(!pair)for(const row of stats.values())if(row.type==='candidate-pair'&&row.nominated&&row.state==='succeeded')pair=row;
      if(!pair)return 'unknown';return [stats.get(pair.localCandidateId),stats.get(pair.remoteCandidateId)].some(c=>c?.candidateType==='relay')?'relay':'direct';
    },
    async close(){if(closed)return;closed=true;clearTimeout(expiryTimer);room.onPeerJoin=null;room.onPeerLeave=null;action.onMessage=null;presence.onMessage=null;cursorPending.clear();for(const c of controllers)c.abort();await room.leave();},
  };
}
