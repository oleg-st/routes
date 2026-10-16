import {roomTransportConfig,roomAppId} from './room-config.js';
import {MAX_BYTES,MAX_HEADER} from './room-protocol.js';
import {turnServiceConfig} from './turn-service-config.js';
import {createTurnCredentials} from './turn-credentials.js';
import {verifyTurnstile} from './turn-verification.js';
import {createCursorTransport} from './cursor-transport.js';
import {peerConnectionStats} from './peer-connection-stats.js';
const prepareTurn=createTurnCredentials({settings:turnServiceConfig,verify:verifyTurnstile});
export async function createTrysteroTransport({roomId,connectionConfig={},signal,onPeerJoin,onPeerLeave,onMessage,onPresence=()=>{},onError}) {
  // Importing/joining happens only after an explicit create/join (or resuming that tab's room).
  connectionConfig=await prepareTurn(connectionConfig,signal);signal?.throwIfAborted();
  const {joinRoom}=await import('trystero');
  signal?.throwIfAborted();
  const room=joinRoom({...roomTransportConfig,...connectionConfig,rtcConfig:{...roomTransportConfig.rtcConfig,...connectionConfig.rtcConfig},appId:roomAppId,maxReceiveBytes:MAX_BYTES+MAX_HEADER+4},roomId,{onJoinError:({error})=>onError(new Error(String(error)))});
  const cursors=createCursorTransport({roomId,onPresence});
  const action=room.makeAction('rt-v1');let closed=false,pendingBytes=0;
  action.onReceive=({byteLength})=>!closed&&byteLength<=MAX_BYTES+MAX_HEADER+4;
  action.onMessage=(data,{peerId})=>{if(!closed)onMessage(peerId,data);};
  const joinPeer=peerId=>{if(closed)return;cursors.add(peerId,room.getPeers()[peerId]);onPeerJoin(peerId);};
  room.onPeerJoin=joinPeer;room.onPeerLeave=peerId=>{cursors.remove(peerId);onPeerLeave(peerId);};
  for(const peerId of Object.keys(room.getPeers()))queueMicrotask(()=>joinPeer(peerId));
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
    sendPresence(peerId,data){if(!closed)cursors.send(peerId,data);},
    connectionStats(peerId){return peerConnectionStats(room.getPeers()[peerId]);},
    async close(){if(closed)return;closed=true;clearTimeout(expiryTimer);room.onPeerJoin=null;room.onPeerLeave=null;action.onMessage=null;cursors.close();for(const c of controllers)c.abort();await room.leave();},
  };
}
