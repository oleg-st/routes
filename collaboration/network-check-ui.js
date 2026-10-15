import {networkProbeSettings,runNetworkProbe,networkVerdict} from './network-check.js';

export function mountNetworkCheck(root,{getSessions=()=>[],loadSettings=networkProbeSettings,probe=runNetworkProbe}={}){
  root.innerHTML='<div class="network-check-heading"><strong data-network-title></strong><button type="button" data-network-retry>Check again</button></div><p data-network-detail></p><small data-network-components></small>';
  const title=root.querySelector('[data-network-title]'),detail=root.querySelector('[data-network-detail]'),components=root.querySelector('[data-network-components]');
  let controller,result,disposed=false;
  const labels={checking:'checking…',reachable:'responded',unconfirmed:'not confirmed',unavailable:'unavailable',unsupported:'unsupported',skipped:'not tested',cancelled:'cancelled'};
  function refresh(){if(disposed||!root.isConnected)return;const verdict=networkVerdict(result,getSessions());root.dataset.state=verdict.state;title.textContent=verdict.title;detail.textContent=verdict.detail;components.textContent=result?`WebRTC: ${result.webrtc?'available':'unavailable'} · STUN: ${labels[result.stun]||'not tested'} · Signaling: ${labels[result.relay]||'not tested'}`:'';}
  async function start(){
    controller?.abort();controller=new AbortController();const active=controller;result=null;refresh();
    try{const settings=await loadSettings();if(disposed||active.signal.aborted)return;
      await probe({...settings,signal:active.signal,onUpdate:value=>{if(!disposed&&!active.signal.aborted){result=value;refresh();}}});
    }catch{if(!disposed&&!active.signal.aborted){result={online:true,webrtc:typeof RTCPeerConnection!=='undefined',stun:'unavailable',relay:'unconfirmed'};refresh();}}
  }
  root.querySelector('[data-network-retry]').onclick=()=>void start();void start();
  return {refresh,dispose(){disposed=true;controller?.abort();}};
}
