import {CURSOR_INTERVAL} from './cursor-presence.js';

export const CURSOR_RETRY=1500, CURSOR_MAX_BYTES=2048;
// Trystero owns the default reliable channel. Reserve a separate negotiated
// stream so its ondatachannel handler never receives our unreliable channel.
// Connections can outlive rooms and be shared by several rooms in one page.
const channels=new WeakMap(),encoder=new TextEncoder();
function cursorChannel(connection){
  let shared=channels.get(connection);
  if(shared)return shared;
  const channel=connection.createDataChannel('rt-cursor-v2',{negotiated:true,id:42,ordered:false,maxRetransmits:0});
  const rooms=new Map();shared={channel,rooms};channels.set(connection,shared);
  channel.onmessage=({data})=>{
    if(typeof data!=='string'||data.length>CURSOR_MAX_BYTES||encoder.encode(data).byteLength>CURSOR_MAX_BYTES)return;
    try{
      const packet=JSON.parse(data);
      if(packet?.version!==2||typeof packet.roomId!=='string'||typeof packet.stream!=='string'||packet.stream.length>64||!Number.isSafeInteger(packet.sequence)||packet.sequence<1)return;
      rooms.get(packet.roomId)?.(packet);
    }catch{} // Malformed presence traffic must never break route synchronization.
  };
  return shared;
}

export function createCursorTransport({roomId,onPresence=()=>{},now=()=>performance.now(),intervalMs=CURSOR_INTERVAL}){
  const peers=new Map();let closed=false;
  function write(peer,packet){
    const channel=peer.shared.channel;
    // Even a timeout must not add more cursor traffic to a backed-up channel.
    if(channel.readyState!=='open'||channel.bufferedAmount>0)return false;
    const data=JSON.stringify({version:2,roomId,...packet});
    if(encoder.encode(data).byteLength>CURSOR_MAX_BYTES)return false;
    try{channel.send(data);return true;}catch{return false;}
  }
  function flush(peer){
    const time=now();
    if(time-peer.lastSent<CURSOR_INTERVAL||peer.flight&&time-peer.lastSent<CURSOR_RETRY)return;
    if(!peer.dirty&&!peer.flight)return;
    const sequence=peer.sequence+1;
    if(write(peer,{stream:peer.stream,sequence,payload:peer.latest})){
      peer.sequence=sequence;peer.flight=sequence;peer.lastSent=time;peer.dirty=false;
    }
  }
  function tick(){if(!closed)for(const peer of peers.values())flush(peer);}
  const timer=intervalMs>0?setInterval(tick,intervalMs):null;
  function remove(peerId){
    const peer=peers.get(peerId);if(!peer)return;
    if(peer.shared.rooms.get(roomId)===peer.receive)peer.shared.rooms.delete(roomId);
    peers.delete(peerId);
    // Do not close a channel on a pooled RTCPeerConnection: another room or
    // a later rejoin may still use it. The connection owns its lifetime.
  }
  return {
    tick,
    add(peerId,connection){
      if(closed||!connection||peers.get(peerId)?.connection===connection)return;
      remove(peerId);
      let shared;try{shared=cursorChannel(connection);}catch{return;}
      const peer={connection,shared,stream:crypto.randomUUID(),latest:null,dirty:false,sequence:0,flight:null,lastSent:-Infinity};
      peer.receive=packet=>{
        if(closed)return;
        if(packet.ack===true){
          if(packet.stream===peer.stream&&packet.sequence===peer.flight){peer.flight=null;flush(peer);}
        }else if(packet.ack===undefined&&packet.payload&&typeof packet.payload==='object'){
          onPresence(peerId,packet.payload);
          write(peer,{stream:packet.stream,sequence:packet.sequence,ack:true});
        }
      };
      peers.set(peerId,peer);shared.rooms.set(roomId,peer.receive);
    },
    send(peerId,payload){
      const peer=peers.get(peerId);if(closed||!peer)return;
      peer.latest=payload;peer.dirty=true;flush(peer);
    },
    remove,
    close(){closed=true;clearInterval(timer);for(const peerId of peers.keys())remove(peerId);},
  };
}
