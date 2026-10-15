import {roomAppId,roomTransportConfig} from './room-config.js';

// Match the pinned Trystero 0.26 defaults; never include TURN credentials in this probe.
const defaultStunServers=[...Array.from({length:3},(_,i)=>({urls:`stun:stun${i||''}.l.google.com:19302`})),{urls:'stun:stun.cloudflare.com:3478'}];
export async function networkProbeSettings(config=roomTransportConfig){
  const [{defaultRelayUrls},{getRelays}]=await Promise.all([import('trystero'),import('@trystero-p2p/core')]);
  const iceServers=(config.rtcConfig?.iceServers??defaultStunServers).flatMap(server=>{
    const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(url=>/^stuns?:/i.test(url));
    return urls.length?[{urls}]:[];
  });
  return {iceServers,relayUrls:getRelays({...config,appId:roomAppId},defaultRelayUrls,5,true)};
}

export function probeStun({iceServers,signal,timeoutMs=6000,PeerConnection=globalThis.RTCPeerConnection}){
  if(!PeerConnection)return Promise.resolve('unsupported');
  if(signal?.aborted)return Promise.resolve('cancelled');
  return new Promise(resolve=>{
    let pc,timer,finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(pc){pc.onicecandidate=null;pc.onicegatheringstatechange=null;try{pc.close();}catch{}}resolve(value);};
    const abort=()=>finish('cancelled');signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish('unconfirmed'),timeoutMs);
    try{
      pc=new PeerConnection({iceServers,iceTransportPolicy:'all'});
      pc.onicecandidate=event=>{
        const type=event.candidate?.type??event.candidate?.candidate?.match(/ typ (\w+)/)?.[1];
        if(type==='srflx')finish('reachable');else if(!event.candidate)finish('unconfirmed');
      };
      pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')finish('unconfirmed');};
      pc.createDataChannel('network-check');
      void (async()=>{try{const offer=await pc.createOffer();if(finished)return;await pc.setLocalDescription(offer);}catch{finish('unavailable');}})();
    }catch{finish('unavailable');}
  });
}

export function probeRelay(url,{signal,timeoutMs=6000,Socket=globalThis.WebSocket}){
  if(!Socket)return Promise.resolve(false);
  if(signal?.aborted)return Promise.resolve(false);
  return new Promise(resolve=>{
    let socket,timer,finished=false;const subscription='rt-check-'+crypto.randomUUID();
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(socket){socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;try{if(socket.readyState===1)socket.send(JSON.stringify(['CLOSE',subscription]));socket.close();}catch{}}resolve(value);};
    const abort=()=>finish(false);signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(false),timeoutMs);
    try{
      socket=new Socket(url);
      // A read-only subscription tests Nostr access without publishing or joining a room.
      socket.onopen=()=>{try{socket.send(JSON.stringify(['REQ',subscription,{kinds:[20000],'#x':[subscription],limit:0}]));}catch{finish(false);}};
      socket.onmessage=event=>{try{const [type,id]=JSON.parse(event.data);if(id===subscription&&type==='EOSE')finish(true);else if(id===subscription&&type==='CLOSED')finish(false);}catch{}};
      socket.onerror=()=>finish(false);socket.onclose=()=>finish(false);
    }catch{finish(false);}
  });
}

export async function runNetworkProbe({signal,onUpdate=()=>{},online=globalThis.navigator?.onLine!==false,PeerConnection=globalThis.RTCPeerConnection,Socket=globalThis.WebSocket,iceServers,relayUrls,timeoutMs=6000}){
  const result={online,webrtc:Boolean(PeerConnection),stun:'checking',relay:'checking'};
  const emit=()=>{if(!signal?.aborted)onUpdate({...result});};
  if(!online||!PeerConnection){result.stun=result.relay='skipped';emit();return result;}
  emit();const relayAbort=new AbortController(),abort=()=>relayAbort.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
    await Promise.all([
      probeStun({iceServers,signal,timeoutMs,PeerConnection}).then(value=>{result.stun=value;emit();}),
      (async()=>{
        let reachable=false;
        await Promise.all(relayUrls.map(url=>probeRelay(url,{signal:relayAbort.signal,timeoutMs,Socket}).then(ok=>{if(ok&&!reachable){reachable=true;result.relay='reachable';emit();relayAbort.abort();}})));
        result.relay=reachable?'reachable':'unconfirmed';emit();
      })(),
    ]);
  }finally{signal?.removeEventListener('abort',abort);relayAbort.abort();}
  return {...result};
}

export function networkVerdict(result,sessions=[]){
  const peers=sessions.filter(s=>!s.self&&s.status==='connected'),direct=peers.filter(s=>s.connection==='direct').length,relay=peers.filter(s=>s.connection==='relay').length;
  if(relay)return {state:'relay',title:direct?'Some connections use TURN':'Connected through TURN',detail:`${direct} direct, ${relay} relayed. This describes current connections; it does not prove TURN is required for every peer.`};
  if(direct)return {state:'direct',title:'Working without TURN',detail:`Confirmed with ${direct} current peer${direct===1?'':'s'}. Other peers and networks may still need TURN.`};
  if(result?.online===false)return {state:'warning',title:'Browser reports offline',detail:'Connect to a network and check again. Local routes remain available.'};
  if(result?.webrtc===false)return {state:'error',title:'WebRTC is unavailable',detail:'This browser cannot run the connection check. Try a browser with WebRTC enabled; TURN cannot replace WebRTC.'};
  if(!result||result.stun==='checking'||result.relay==='checking')return {state:'checking',title:'Checking connection without TURN…',detail:'Checking this browser, STUN and a signaling relay. You can create or join a room while this runs.'};
  if(result.stun==='unavailable')return {state:'warning',title:'WebRTC check could not run',detail:'The browser could not gather connection candidates. Check browser permissions or policies and try again; this does not establish a need for TURN.'};
  if(result.relay!=='reachable')return {state:'warning',title:'Signaling access not confirmed',detail:'No tested relay responded in time. Try again or check your network. TURN alone does not fix signaling access.'};
  if(result.stun==='reachable')return {state:'possible',title:'Direct connection looks possible',detail:'STUN and a signaling relay responded. A connection to another participant is needed to confirm whether TURN is necessary.'};
  return {state:'warning',title:'TURN may be needed',detail:'A signaling relay responded, but STUN did not provide a public candidate. You can still try joining; direct connectivity depends on both networks.'};
}
