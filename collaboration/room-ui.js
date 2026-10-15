import {classPicker,mountClassPicker,classColor} from './class-picker.js';
import {mountNetworkCheck} from './network-check-ui.js';
import {displayCode,roomCode,MAX_SESSIONS} from './room-protocol.js';
import {sessionColor} from './cursor-presence.js';
import {connectionConfig} from './connection-config.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createRoomUI({showDialog,copyText,onCreate,onJoin,onLeave,onReconnect,onError,onProfile,onKick,classes=[]}) {
  let state=null,networkCheck,invitationCode='';
  function attachNetworkCheck(){networkCheck=mountNetworkCheck($('#room-network-check'),{getSessions:()=>state?.sessions||[]});}
  function stopNetworkCheck(){networkCheck?.dispose();networkCheck=null;}
  $('#dialog').addEventListener('close',()=>{
    stopNetworkCheck();
    if(invitationCode&&!state){const url=new URL(location.href);try{if(roomCode(url.hash)===invitationCode){url.hash='';window.history.replaceState(null,'',url);}}catch{}}
    invitationCode='';
  });
  const participantColor=member=>classColor(classes.find(c=>c.id===member.classId))||sessionColor(member.sessionId);
  const classLabel=id=>classes.find(c=>c.id===id)?.name||'Not selected';
  const profileFields=(name='',classId='')=>'<div class="room-profile-fields"><label>Your name<input id="room-name" maxlength="40" value="'+esc(name)+'" placeholder="Player"></label>'+classPicker(classes,classId)+'</div>';
  function remember(name,classId){try{localStorage.setItem('rt-name',name);localStorage.setItem('rt-class',classId);}catch{}}
  function savedProfile(){let name='',classId='';try{name=localStorage.getItem('rt-name')??sessionStorage.getItem('rt-name')??'';classId=localStorage.getItem('rt-class')??sessionStorage.getItem('rt-class')??'';}catch{}return {name,classId:classes.some(c=>c.id===classId)?classId:''};}
  function rememberFields(){mountClassPicker($('.room-form'),classes);for(const field of ['#room-name','#room-class'])$(field)?.addEventListener('input',()=>remember($('#room-name').value,$('#room-class').value));}
  function profileForm(){
    if(!state)return;stopNetworkCheck();showDialog('Your profile','<div class="room-form"><section id="room-network-check" class="network-check" role="status" aria-live="polite"></section>'+profileFields(state.name,state.classId)+'<p>Your editing role stays '+esc(state.role)+'. Leave and rejoin to change it.</p><p id="room-form-error" role="alert" hidden></p><button id="room-profile-save" class="primary">Save profile</button></div>');
    attachNetworkCheck();rememberFields();
    $('#room-profile-save').onclick=()=>{try{const profile={name:$('#room-name').value.trim(),classId:$('#room-class').value};onProfile(profile);remember(profile.name,profile.classId);$('#dialog').close();}catch(error){$('#room-form-error').textContent=error.message;$('#room-form-error').hidden=false;}};
  }
  const run=fn=>async()=>{try{await fn();}catch(error){onError(error.message);}};
  function form(code=''){
    stopNetworkCheck();
    invitationCode=code&&!state?roomCode(code):'';
    const {name:lastName,classId:lastClass}=savedProfile(),invited=Boolean(invitationCode);
    showDialog(invited?'Join Route Together':'Route Together',`<div class="room-form"><section id="room-network-check" class="network-check" role="status" aria-live="polite"></section>${state?'<p>Connection settings for this session.</p>':`<p>${invited?'You have been invited to a shared route. Choose your profile and role to join.':'Share the current route or join a room.'} Up to ${MAX_SESSIONS} sessions, including spectators.</p>${profileFields(lastName,lastClass)}${invited?'':'<div class="room-create-section"><button id="room-create" class="primary">Create room from current route</button></div>'}<label>${invited?'Invitation code':'Room code or invitation'}<input ${invited?'readonly':''} id="room-code" value="${esc(code)}" autocomplete="off" placeholder="XXXX-XXXX-XXXX"></label><label>Join as<select id="room-role"><option value="player">Player — can edit</option><option value="spectator">Spectator — view only</option></select></label>`}
      <details id="room-network"><summary>Network / TURN (optional)</summary><p>Direct WebRTC works through many NATs. Restrictive networks may require a TURN relay. Use credentials from your TURN provider; they stay in this page's memory.</p><label>TURN server URLs<textarea id="turn-urls" placeholder="turns:turn.example.com:443?transport=tcp"></textarea></label><label>Username<input id="turn-username" autocomplete="off"></label><label>Password<input id="turn-password" type="password" autocomplete="off"></label><label class="room-checkbox"><input type="checkbox" id="turn-only"> Force TURN relay (connection test)</label><p>Reloading clears these credentials. Re-enter them here if your network needs TURN.</p></details>
      <p id="room-form-error" role="alert" hidden></p><div class="room-form-actions">${invited?'<button id="room-decline">Decline invitation</button>':''}<button id="room-join" class="primary">${state?'Apply and reconnect':'Join room'}</button></div></div>`);
    attachNetworkCheck();rememberFields();
    const act=async(create)=>{
      const button=create?$('#room-create'):$('#room-join');button.disabled=true;
      try{
        const config=connectionConfig({urls:$('#turn-urls').value,username:$('#turn-username').value,credential:$('#turn-password').value,relayOnly:$('#turn-only').checked});
        if(state)await onReconnect(config);
        else{const name=$('#room-name').value.trim()||'Player',classId=$('#room-class').value;remember(name,classId);if(create)await onCreate({name,classId,config});else await onJoin({code:roomCode($('#room-code').value),name,classId,role:$('#room-role').value,config});}
        $('#dialog').close();
      }catch(error){$('#room-form-error').textContent=error.message;$('#room-form-error').hidden=false;}finally{button.disabled=false;}
    };
    if($('#room-decline'))$('#room-decline').onclick=()=>$('#dialog').close();
    if($('#room-create'))$('#room-create').onclick=()=>act(true);$('#room-join').onclick=()=>act(false);
  }
  $('#together').onclick=()=>state?profileForm():form();$('#room-profile').onclick=profileForm;$('#room-settings').onclick=()=>form();
  $('#room-avatars').onclick=event=>{
    const button=event.target.closest('[data-kick-session]');if(!button||!state?.canKick)return;
    const member=state.sessions.find(s=>s.sessionId===button.dataset.kickSession&&!s.self);if(!member)return;
    stopNetworkCheck();showDialog('Remove participant?', '<div class="room-form"><p>Disconnect <strong>'+esc(member.name)+'</strong> from this room?</p><p>They can join again using the same invitation.</p><div class="room-form-actions"><button id="room-kick-cancel">Cancel</button><button id="room-kick-confirm" class="primary">Remove participant</button></div></div>');
    $('#room-kick-cancel').onclick=()=>$('#dialog').close();
    $('#room-kick-confirm').onclick=run(async()=>{await onKick(member.sessionId);$('#dialog').close();});
  };
  $('#room-leave').onclick=run(onLeave);$('#room-reconnect').onclick=run(()=>onReconnect());
  $('#room-copy-code').onclick=run(()=>copyText(displayCode(state.roomId),'Room code','Room code copied.'));
  $('#room-copy-link').onclick=run(()=>{if(location.protocol==='file:')return copyText(displayCode(state.roomId),'Room code','Share this code from the hosted planner.');const url=new URL(location.href);url.hash='room='+displayCode(state.roomId);return copyText(url.href,'Room invitation','Room invitation copied.');});
  return {
    form,
    update(next){
      state=next;networkCheck?.refresh();document.body.classList.toggle('in-room',Boolean(state));$('#room-bar').hidden=!state;$('#room-avatars').hidden=!state;if(!state)$('#room-avatars').replaceChildren();
      $('#room-waiting').hidden=!state||state.hasDocument&&!state.full;$('#workspace').hidden=Boolean(state&&(!state.hasDocument||state.full));
      if(!state)return;
      $('#room-code-display').textContent=displayCode(state.roomId);
      const avatars=state.sessions.map(member=>{
        const hero=classes.find(c=>c.id===member.classId),icon=hero?.images?.[0]?.path,color=participantColor(member);
        const title=member.name+(member.self?' (you)':'')+' · '+classLabel(member.classId)+' · '+member.role+(member.leader?' · Leader':'')+' · '+member.status;
        return '<li data-avatar-session="'+esc(member.sessionId)+'" title="'+esc(title)+'" aria-label="'+esc(title)+'" style="--class-color:'+color+'"><span class="room-avatar">'+(icon?'<img src="'+esc(icon)+'" alt="">':'<span class="room-avatar-fallback" aria-hidden="true">'+esc(member.name.slice(0,1).toUpperCase())+'</span>')+(member.leader?'<svg class="room-crown" viewBox="0 0 20 16" aria-hidden="true"><path d="M2 3 6 7 10 1 14 7 18 3 16 13H4Z M4 15H16"/></svg>':'')+'</span><span class="room-avatar-name">'+esc(member.name)+(member.role==='spectator'?'<small>Spectator</small>':'')+'</span>'+(state.canKick&&!member.self?'<button class="room-kick" data-kick-session="'+esc(member.sessionId)+'" aria-label="Remove '+esc(member.name)+'" title="Remove participant">×</button>':'')+'</li>';
      }).join('')+Array.from({length:Math.max(0,state.capacity-state.sessions.length)},()=>'<li class="room-empty-slot" aria-hidden="true"></li>').join('');
      if($('#room-avatars').innerHTML!==avatars)$('#room-avatars').innerHTML=avatars;
      const labels={switching:'Changing dungeon…',connecting:'Connecting…',waiting:'Waiting for route',alone:'No connected peers · local copy',syncing:'Synchronizing…',connected:'Connected',full:'Room full',left:'Left room'};
      const syncLabels={synced:'Synced',syncing:'Syncing…',offline:'Offline · local copy',mismatch:'Mismatch · route data differs'};
      $('#room-status').textContent=['connected','syncing','alone'].includes(state.status)?syncLabels[state.syncStatus]:labels[state.status];$('#room-status').dataset.state=state.status;$('#room-status').dataset.sync=state.syncStatus;
      $('#room-status').title='Synced means matching route content at the same CRDT version for all connected sessions. Offline keeps your local copy.';
      $('#room-session-count').textContent=`Sessions ${state.sessions.length}/${state.capacity}`;
      $('#room-session-list').innerHTML=state.sessions.map(s=>`<li data-session="${esc(s.sessionId)}" data-leader="${Boolean(s.leader)}" style="--session-color:${participantColor(s)}"><strong>${esc(s.name)}${s.self?' (you)':''}${s.leader?' · Leader':''}</strong><span>${esc(classLabel(s.classId))} · ${esc(s.role)} · ${esc(s.self?s.status:s.syncStatus)}${s.connection&&s.connection!=='unknown'?' · '+esc(s.connection):''}</span><small>Session ${esc(s.sessionId.slice(0,8))}</small></li>`).join('')||'<li>Waiting for sessions…</li>';
      $('#room-leader-status').textContent=state.leaderId?(state.sessions.some(s=>s.leader)?'':'Creator offline · editing continues'):'Creator identity unavailable';
      const diagnostic=state.error||(state.syncStatus==='mismatch'?'Route content differs at the same version. Reconnect to check again; your local copy is retained.':'');$('#room-diagnostic').textContent=diagnostic;$('#room-diagnostic').hidden=!diagnostic;
      $('#room-waiting-title').textContent=state.full?'Room is full':'Waiting for route';
      $('#room-waiting-text').textContent=state.full?'This room allows '+MAX_SESSIONS+' sessions, including spectators. Retry after someone leaves.':'No shared route is available yet. Keep this page open until a participant with a copy connects. Your solo routes remain saved.';
    },
  };
}
