import {routeFingerprint,compareFingerprints} from './route-diagnostics.js';
import {restoreRouteDocument} from './route-document.js';
import {invariant,record,role as checkRole,uuid} from './route-schema.js';
import {roomCode,identityKey,checkIdentity,MAX_SESSIONS,compareMembers,decodeMessage,encodeMessage,envelope} from './room-protocol.js';
import {createCursorPresence,validCursor} from './cursor-presence.js';
import {PROTOCOL_VERSION} from './room-protocol.js';
import {createTrysteroTransport} from './trystero-transport.js';

// Each session owns its document/binding. The editor only borrows them while joined.
export async function createRoomSession({code,role='player',name='Player',classId='',classes=[],initialPacket,storage,resolveOptions,
  prepareOptions=async()=>{},transportFactory=createTrysteroTransport,connectionConfig={},onDocument=()=>{},onArchive=async()=>{},onState=()=>{},onStorage=()=>{},onPresence=()=>{},onKicked=async()=>{},cursorIntervalMs=50,intervalMs=5000,now=()=>Date.now()}) {
  const roomId=roomCode(code),sessionId=uuid();checkRole(role);name=name.trim().slice(0,40)||'Player';
  const cached=await storage.loadRoom(roomId),participantId=cached?.participantId||uuid();
  let roomEpoch=initialPacket?1:cached?.roomEpoch||1,target=null,switching=false;
  const roomRoutes={...cached?.routes};
  let leaderId=initialPacket?participantId:cached?.leaderId||null,profileVersion=0;
  const checkClass=value=>invariant(value===''||classes.some(c=>c.id===value),'Unknown hero/class.');checkClass(classId);
  let document,binding,identity=null,transport,closed=false,full=false,connecting=false,generation=0,tail=Promise.resolve(),queued=0,timer,error;
  let kicked=false,checkTimer,checkRevision=0,checkSequence=0,localCheck=null,fingerprintTask=null;
  let localOrder=initialPacket?0:null,stopLocal,stopState,closing=Promise.resolve(),connectAbort;
  function disconnect(){connectAbort?.abort();const active=transport;transport=null;generation++;closing=closing.catch(()=>{}).then(()=>active?.close());return closing;}
  const peers=new Map(),hints=new Map(),departed=new Map();
  const localMember=()=>({sessionId,order:localOrder,name,role,participantId,classId,profileVersion});
  const self=()=>localOrder===null?null:localMember();
  const saveMetadata=(nextIdentity=identity,nextEpoch=roomEpoch)=>storage.saveRoom(roomId,{identity:nextIdentity,roomEpoch:nextEpoch,participantId,leaderId,routes:{...roomRoutes,[nextIdentity.dungeonId]:nextIdentity}});
  function emitPresence(){onPresence(cursors.values().flatMap(cursor=>{const p=[...peers.values()].find(p=>p.member?.sessionId===cursor.sessionId);return eligible(p)?[{...p.member,...cursor}]:[];}));}
  const cursors=createCursorPresence({now,intervalMs:cursorIntervalMs,onChange:emitPresence,send:cursor=>{
    if(closed||kicked||full||role!=='player'||!document)return;
    const payload={protocolVersion:PROTOCOL_VERSION,roomId,roomEpoch,sessionId,identity,cursor};
    for(const [peerId,p] of peers)if(eligible(p))transport?.sendPresence?.(peerId,payload);
  }});
  function receivePresence(peerId,payload){
    const p=peers.get(peerId);if(closed||full||!document||!eligible(p)||p.member.role!=='player')return;
    try{
      record(payload,['protocolVersion','roomId','roomEpoch','sessionId','identity','cursor']);
      if(payload.protocolVersion!==PROTOCOL_VERSION||payload.roomId!==roomId||payload.roomEpoch!==roomEpoch||payload.sessionId!==p.member.sessionId||identityKey(checkIdentity(payload.identity))!==identityKey(identity))return;
      validCursor(payload.cursor,resolveOptions(identity).dungeon);cursors.receive(payload.sessionId,payload.cursor);
    }catch{} // Malformed ephemeral traffic cannot disrupt document synchronization.
  }
  function roster(){
    const rows=new Map();for(const [sid,hint] of hints){if(hint.until>now()&&!departed.has(sid))rows.set(sid,hint.member);else hints.delete(sid);}
    for(const p of peers.values())if(p.member&&!p.rejected&&now()-p.seen<30000)rows.set(p.member.sessionId,p.member);
    if(self())rows.set(sessionId,self());return [...rows.values()].sort(compareMembers).slice(0,MAX_SESSIONS);
  }
  const admitted=sid=>roster().some(m=>m.sessionId===sid);
  function peerSync(p){return now()-p.seen>15000?'offline':!eligible(p)||p.pending.size||!p.check||now()-p.check.time>15000?'syncing':compareFingerprints(localCheck,p.check);}
  function state(){
    // Display the local profile even while network admission is waiting for another peer.
    const sessions=[{...localMember(),self:true,status:full?'full':'local'},...[...peers.entries()].filter(([,p])=>p.member&&!p.rejected&&admitted(p.member.sessionId)).map(([peerId,p])=>({...p.member,peerId,self:false,connection:p.connection??'unknown',pingMs:now()-p.seen>15000?null:p.pingMs??null,syncStatus:peerSync(p),status:now()-p.seen>15000?'reconnecting':p.synced?'connected':'syncing'}))];
    for(const member of sessions)member.leader=Boolean(leaderId&&member.participantId===leaderId);
    const connected=sessions.filter(s=>!s.self&&s.status==='connected').length;
    const remote=sessions.filter(s=>!s.self),syncStatus=closed||kicked||!remote.length||remote.every(s=>s.syncStatus==='offline')?'offline':target||switching||!document?'syncing':remote.some(s=>s.syncStatus==='mismatch')?'mismatch':remote.every(s=>s.syncStatus==='synced')?'synced':'syncing';
    return {syncStatus,kicked,turnUnavailable:Boolean(transport?.turnUnavailable),canKick:!closed&&!kicked&&!full&&participantId===leaderId,roomId,sessionId,role,name,classId,participantId,leaderId,hasDocument:Boolean(document),identity,roomEpoch,switching:Boolean(target||switching),canChangeDungeon:!closed&&!kicked&&!full&&!target&&!switching&&Boolean(document)&&role==='player'&&participantId===leaderId,full,sessions,error:error||[...peers.values()].find(p=>p.error)?.error,
      status:closed?'left':full?'full':target||switching?'switching':connecting?'connecting':!document?'waiting':!peers.size?'alone':connected&&sessions.every(s=>s.self||s.status==='connected')?'connected':'syncing',connected,capacity:MAX_SESSIONS};
  }
  function emit(){if(!closed){onState(state());emitPresence();}}
  function report(reason){error=reason instanceof Error?reason.message:String(reason);emit();}
  function queue(fn){if(closed||queued>=128)return;queued++;const operation=tail.then(()=>{if(!closed)return fn();});tail=operation.catch(report).finally(()=>queued--);return operation;}
  async function attach(packet,{replace=false,epoch=roomEpoch}={}){
    invariant(replace||!identity||identityKey(identity)===identityKey(packet.identity),'Conflicting route identities in this room.');
    resolveOptions(checkIdentity(packet.identity));
    await prepareOptions(packet.identity);if(closed)return;
    const options=resolveOptions(checkIdentity(packet.identity)),next=restoreRouteDocument(packet,{...options,role});
    const previous=document,previousBinding=binding,nextBinding=storage.bind(next,onStorage);let installed=false;
    try{
      await nextBinding.flush();
      if(replace&&previous){await previousBinding.flush();await onArchive(previous.snapshot());}
      if(closed)return;
      await saveMetadata(next.identity,epoch);if(closed)return;
      stopLocal?.();stopState?.();document=next;binding=nextBinding;identity=next.identity;roomEpoch=epoch;roomRoutes[identity.dungeonId]=identity;target=null;installed=true;
      if(replace){cursors.clear();for(const peer of peers.values()){peer.pending.clear();peer.request=null;peer.synced=false;peer.initialSynced=false;peer.check=null;}}
      stopLocal=next.subscribeLocalUpdates(packet=>{for(const [peerId,p] of peers)if(eligible(p))send(peerId,'DELTA',{},packet.bytes);});
      stopState=next.subscribeUpdates(()=>{invalidateCheck();emit();});invalidateCheck();
      onDocument(document,binding);emit();
      if(previous){await previousBinding.dispose().catch(report);previous.dispose();}
    }finally{if(!installed){await nextBinding.dispose().catch(()=>{});next.dispose();}}
  }
  function invalidateCheck(){
    checkRevision++;localCheck=null;fingerprintTask=null;clearTimeout(checkTimer);
    checkTimer=setTimeout(()=>broadcastCheck().catch(report),60);
  }
  async function fingerprint(){
    if(!document||closed||kicked)return null;
    if(localCheck)return localCheck;
    if(!fingerprintTask){const revision=checkRevision,doc=document;fingerprintTask=routeFingerprint(doc).then(value=>{if(revision!==checkRevision||doc!==document||closed||kicked)return null;localCheck=value;emit();return value;});}
    return fingerprintTask;
  }
  async function sendCheck(peerId,replyTo){
    const revision=checkRevision,epoch=roomEpoch,value=await fingerprint();
    if(!value||revision!==checkRevision||epoch!==roomEpoch||!eligible(peers.get(peerId)))return;
    send(peerId,'CHECK',{...value,checkSequence:++checkSequence,...(replyTo?{replyTo}:{})});
  }
  async function broadcastCheck(){await Promise.all([...peers.keys()].map(id=>sendCheck(id)));}
  const eligible=p=>p?.member&&!p.rejected&&admitted(p.member.sessionId)&&admitted(sessionId)&&p.epoch===roomEpoch&&identity&&p.identity&&identityKey(identity)===identityKey(p.identity);
  function header(type,extra={}){return envelope(roomId,sessionId,type,identity,{roomEpoch,...extra});}
  function send(peerId,type,extra={},bytes=new Uint8Array()){
    if(!transport||closed||(full||kicked)&&type!=='LEAVE')return;
    const h=header(type,extra),frame=encodeMessage(h,bytes),activeTransport=transport,currentGeneration=generation;
    if(type==='DELTA'&&!extra.replyTo){const p=peers.get(peerId);if(p){p.pending.add(h.messageId);if(p.pending.size>256)p.pending.delete(p.pending.values().next().value);p.synced=false;}}
    Promise.resolve(activeTransport.send(peerId,frame)).catch(reason=>{if(!closed&&generation===currentGeneration){const p=peers.get(peerId);if(p)p.synced=false;report(reason);}});
  }
  const helloFields=()=>({role,name,classId,participantId,profileVersion,leaderId,order:localOrder,roster:roster(),hasDocument:Boolean(document)});
  const hello=peerId=>send(peerId,'HELLO',helloFields());
  function request(peerId,p){
    const switchingPeer=target&&p.epoch===target.epoch&&p.identity&&identityKey(p.identity)===identityKey(target.identity)&&p.member&&!p.rejected&&admitted(p.member.sessionId)&&admitted(sessionId);
    if((!switchingPeer&&!eligible(p))||!p.hasDocument||p.request&&now()-p.request.time<10000)return;
    const selected=switchingPeer?target:{identity,epoch:roomEpoch};
    const h=header('REQUEST',{identity:selected.identity,roomEpoch:selected.epoch}),bytes=switchingPeer||!document?new Uint8Array():document.version().bytes;
    p.request={id:h.messageId,time:now(),pending:[...p.pending],identity:selected.identity,epoch:selected.epoch};
    const active=transport,current=generation;Promise.resolve(active?.send(peerId,encodeMessage(h,bytes))).catch(reason=>{if(!closed&&generation===current)report(reason);});
  }
  const knownRoute=selected=>selected&&roomRoutes[selected.dungeonId]&&identityKey(roomRoutes[selected.dungeonId])===identityKey(selected);
  const admittedPeer=p=>p?.member&&!p.rejected&&admitted(p.member.sessionId)&&admitted(sessionId);
  async function withRoute(selected,fn){
    if(identity&&identityKey(selected)===identityKey(identity)&&document)return fn(document,false);
    if(!knownRoute(selected))return;
    const packet=await storage.load(selected.routeId);if(!packet)return;
    invariant(identityKey(packet.identity)===identityKey(selected),'Saved room route identity changed.');
    resolveOptions(selected);await prepareOptions(selected);if(closed)return;
    const archived=restoreRouteDocument(packet,{...resolveOptions(selected),role});
    try{return await fn(archived,true);}finally{archived.dispose();}
  }
  async function requestArchive(peerId,p){
    if(!admittedPeer(p))return;
    const previous=p.archiveRequest;if(previous&&now()-previous.time<10000)return;
    const selected=previous||p.hasDocument&&p.epoch<roomEpoch&&knownRoute(p.identity)&&{identity:p.identity,epoch:p.epoch};if(!selected)return;
    await withRoute(selected.identity,doc=>{
      const h=header('REQUEST',{identity:selected.identity,roomEpoch:selected.epoch});p.archiveRequest={id:h.messageId,time:now(),identity:selected.identity,epoch:selected.epoch};
      Promise.resolve(transport?.send(peerId,encodeMessage(h,doc.version().bytes))).catch(report);
    });
  }
  async function routeHistoricalMessage(peerId,p,h,bytes){
    if(!admittedPeer(p)||!knownRoute(h.identity))return;
    if(h.type==='REQUEST'){
      await withRoute(h.identity,doc=>{const packet=bytes.length?doc.exportUpdate({identity:h.identity,kind:'version',bytes}):doc.exportSnapshot();send(peerId,packet.kind==='snapshot'?'SNAPSHOT':'DELTA',{identity:h.identity,roomEpoch:h.roomEpoch,replyTo:h.messageId},packet.bytes);});return;
    }
    if(!['DELTA','SNAPSHOT'].includes(h.type))return;
    if(h.replyTo){if(h.replyTo!==p.archiveRequest?.id||h.roomEpoch!==p.archiveRequest.epoch||identityKey(h.identity)!==identityKey(p.archiveRequest.identity))return;}
    else if(h.type!=='DELTA'||p.member.role!=='player')return;
    await withRoute(h.identity,async(doc,archived)=>{
      doc.import({identity:h.identity,kind:h.type==='SNAPSHOT'?'snapshot':'update',bytes});
      if(archived){const saved=storage.bind(doc);try{await saved.flush();await onArchive(doc.snapshot());}finally{await saved.dispose();}}
    });
    if(h.replyTo)p.archiveRequest=null;
    else send(peerId,'ACK',{identity:h.identity,roomEpoch:h.roomEpoch,replyTo:h.messageId});
  }
  async function stopForFull(){
    if(full)return;full=true;error='Room is full ('+MAX_SESSIONS+' sessions, including spectators).';emit();
    for(const peerId of peers.keys())send(peerId,'LEAVE');
    peers.clear();cursors.clear();await disconnect();emit();
  }
  function learnRoster(list){for(const member of list)if(member.sessionId!==sessionId&&!hints.has(member.sessionId)&&!departed.has(member.sessionId))hints.set(member.sessionId,{member,until:now()+15000});}
  async function receive(peerId,frame){
    const p=peers.get(peerId);if(!p||p.rejected||full||kicked)return;
    const {header:h,bytes}=decodeMessage(frame);
    invariant(h.roomId===roomId,'Wrong room.');
    if(p.seenMessages.has(h.messageId))return;
    p.seenMessages.add(h.messageId);if(p.seenMessages.size>256)p.seenMessages.delete(p.seenMessages.values().next().value);
    if(p.sessionId)invariant(p.sessionId===h.senderSessionId,'Peer changed session identity.');
    if(h.type==='KICK'){
      if(!admittedPeer(p)||p.member.participantId!==leaderId||h.targetSessionId!==sessionId)return;
      kicked=true;clearInterval(timer);clearTimeout(checkTimer);cursors.clear();emit();
      // Leave outside the receive queue: leave() waits for that queue to drain.
      Promise.resolve().then(async()=>{await disconnect();try{await onKicked();}catch(reason){report(reason);}finally{await api.leave();}}).catch(report);return;
    }
    if(h.type==='LEAVE'){leavePeer(peerId);return;}
    if(h.type==='HELLO'||h.type==='FULL'){
      if(p.epoch>h.roomEpoch)return;
      const first=!p.sessionId;p.sessionId=h.senderSessionId;p.seen=now();
      invariant(h.senderSessionId!==sessionId&&!Array.from(peers.values()).some(other=>other!==p&&other.sessionId===h.senderSessionId),'Duplicate peer session.');
      if(h.identity){resolveOptions(checkIdentity(h.identity));if(identity&&h.roomEpoch===roomEpoch)invariant(identityKey(identity)===identityKey(h.identity),'Conflicting route identities in this room.');}
      if(p.member&&h.order!==null)invariant(p.member.order===h.order&&p.member.role===h.role&&p.member.participantId===h.participantId,'Peer changed its admission or role.');
      checkClass(h.classId);
      if(leaderId&&h.leaderId)invariant(leaderId===h.leaderId,'Conflicting room creator identities.');
      if(!leaderId&&h.leaderId){leaderId=h.leaderId;if(document)await saveMetadata();}
      if(!p.member||h.profileVersion>p.member.profileVersion)p.member=h.order===null?null:{sessionId:h.senderSessionId,order:h.order,name:h.name,role:h.role,participantId:h.participantId,classId:h.classId,profileVersion:h.profileVersion};p.identity=h.identity;p.epoch=h.roomEpoch;p.hasDocument=h.hasDocument;
      departed.delete(h.senderSessionId);hints.delete(h.senderSessionId);learnRoster(h.roster);
      let assigned=false;if(localOrder===null&&document&&!h.roster.length&&(!h.hasDocument||sessionId<h.senderSessionId)){localOrder=0;assigned=true;}if(localOrder===null&&h.roster.length){localOrder=1+Math.max(...h.roster.map(m=>m.order));assigned=true;}
      if(localOrder!==null&&!admitted(sessionId)){await stopForFull();return;}
      if(p.member&&!admitted(p.member.sessionId)){send(peerId,'FULL',helloFields());emit();return;}
      if(h.roomEpoch>roomEpoch&&identity&&h.hasDocument){
        invariant(leaderId&&h.leaderId===leaderId&&h.hasDocument,'Missing creator selection checkpoint.');
        // A trusted replica can relay the creator's latest selection after the creator leaves.
        if(!target||h.roomEpoch>target.epoch){target={identity:h.identity,epoch:h.roomEpoch};cursors.clear();for(const peer of peers.values()){if(peer.request&&peer.request.epoch===roomEpoch)peer.archiveRequest=peer.request;peer.request=null;}}
        else if(h.roomEpoch===target.epoch)invariant(identityKey(target.identity)===identityKey(h.identity),'Conflicting dungeon selections.');
      }
      if(!identity&&h.identity){
        identity=h.identity;roomEpoch=h.roomEpoch;const saved=await storage.load(identity.routeId);if(closed||!peers.has(peerId))return;
        if(saved){invariant(identityKey(saved.identity)===identityKey(identity),'A different document already uses this route ID locally.');await attach(saved);}
        assigned=true;
      }
      if(first||assigned){for(const id of peers.keys())hello(id);}
      if(h.roomEpoch<roomEpoch){await requestArchive(peerId,p);hello(peerId);}request(peerId,p);emit();return;
    }
    if(target&&h.type==='SNAPSHOT'&&h.roomEpoch===target.epoch&&h.replyTo===p.request?.id&&h.identity&&identityKey(h.identity)===identityKey(target.identity)){
      invariant(p.member&&admitted(p.member.sessionId)&&admitted(sessionId),'Complete the room handshake first.');
      await attach({identity:target.identity,kind:'snapshot',bytes},{replace:true,epoch:target.epoch});if(closed)return;
      p.initialSynced=true;p.synced=true;error=undefined;for(const id of peers.keys())hello(id);emit();return;
    }
    // Route identity selects the document; room generation only selects the active view.
    if(h.roomEpoch<roomEpoch){await routeHistoricalMessage(peerId,p,h,bytes);hello(peerId);return;}
    if(h.roomEpoch>roomEpoch){hello(peerId);return;}
    if(p.epoch!==roomEpoch){await routeHistoricalMessage(peerId,p,h,bytes);return;}
    if(h.type==='REQUEST'&&!bytes.length&&document&&h.identity&&identityKey(h.identity)===identityKey(identity)&&p.member&&admitted(p.member.sessionId)&&admitted(sessionId)){
      const packet=document.exportSnapshot();send(peerId,'SNAPSHOT',{replyTo:h.messageId},packet.bytes);return;
    }
    invariant(p.sessionId===h.senderSessionId&&eligible(p),'Complete the room handshake first.');
    invariant(h.identity&&identityKey(h.identity)===identityKey(identity),'Different route or document lineage.');p.seen=now();
    if(h.type==='CHECK'){
      if(!p.check||h.checkSequence>p.check.sequence)p.check={vectorHash:h.vectorHash,contentHash:h.contentHash,sequence:h.checkSequence,time:now()};
      await fingerprint();if(!h.replyTo)await sendCheck(peerId,h.messageId);emit();return;
    }
    if(h.type==='ACK'){p.pending.delete(h.replyTo);p.synced=Boolean(p.initialSynced&&!p.pending.size);emit();return;}
    if(h.type==='REQUEST'){
      if(!document)return;
      const packet=bytes.length?document.exportUpdate({identity,kind:'version',bytes}):document.exportSnapshot();
      send(peerId,packet.kind==='snapshot'?'SNAPSHOT':'DELTA',{replyTo:h.messageId},packet.bytes);return;
    }
    if(h.replyTo&&h.replyTo!==p.request?.id)return; // Late responses to timed-out requests are recovered by the next vector exchange.
    if(!document){if(h.type!=='SNAPSHOT'||!h.replyTo)return;await attach({identity,kind:'snapshot',bytes});if(closed)return;for(const id of peers.keys())hello(id);}
    else {if(!h.replyTo)invariant(p.member.role==='player','Spectators cannot send edits.');document.import({identity,kind:h.type==='SNAPSHOT'?'snapshot':'update',bytes});}
    if(h.replyTo){for(const id of p.request?.pending||[])p.pending.delete(id);p.request=null;p.initialSynced=true;p.synced=!p.pending.size;}
    else if(h.type==='DELTA')send(peerId,'ACK',{replyTo:h.messageId});error=undefined;emit();
  }
  function refreshPeerStats(peerId,p){
    if(!transport?.connectionStats||p.statsBusy||now()-(p.statsAt??-Infinity)<5000)return;
    const active=transport,current=generation;p.statsBusy=true;p.statsAt=now();
    const apply=value=>{if(!closed&&current===generation&&peers.get(peerId)===p){p.connection=value.connection;p.pingMs=value.pingMs;emit();}};
    Promise.resolve().then(()=>active.connectionStats(peerId)).then(apply).catch(()=>apply({connection:'unknown',pingMs:null})).finally(()=>{p.statsBusy=false;});
  }
  function joinPeer(peerId){if(closed||full||peers.has(peerId))return;if(peers.size>=16)return;const p={seen:now(),synced:false,pending:new Set(),seenMessages:new Set()};peers.set(peerId,p);hello(peerId);refreshPeerStats(peerId,p);emit();}
  function leavePeer(peerId){const p=peers.get(peerId);if(p?.sessionId){cursors.remove(p.sessionId);hints.delete(p.sessionId);departed.set(p.sessionId,now()+30000);}peers.delete(peerId);for(const id of peers.keys())hello(id);emit();}
  function tick(){
    if(closed||full||kicked)return;broadcastCheck().catch(report);for(const [sid,until]of departed)if(until<now())departed.delete(sid);
    for(const [peerId,p]of peers){hello(peerId);request(peerId,p);if(p.archiveRequest)queue(()=>requestArchive(peerId,p));refreshPeerStats(peerId,p);}emit();
  }
  async function connect(){
    connectAbort?.abort();const controller=new AbortController();connectAbort=controller;
    const current=++generation;connecting=true;emit();
    try{
      const active=await transportFactory({roomId,connectionConfig,signal:controller.signal,
        onPeerJoin:peerId=>{if(current===generation)joinPeer(peerId);},
        onPeerLeave:peerId=>{if(current===generation)leavePeer(peerId);},
        onMessage:(peerId,frame)=>{if(current===generation)queue(async()=>{if(current!==generation)return;try{await receive(peerId,frame);}catch(reason){const p=peers.get(peerId);if(p){p.rejected=true;p.error=reason.message;}report(reason);}});},
        onPresence:(peerId,payload)=>{if(current===generation)receivePresence(peerId,payload);},
        onError:reason=>{if(current===generation)report(reason);},
      });
      if(closed||current!==generation){await active.close();return;}transport=active;connecting=false;tick();
    }catch(reason){if(!closed&&current===generation){connecting=false;report(reason);}}
  }
  try{
    if(initialPacket){identity=initialPacket.identity;await attach(initialPacket);}
    else {if(cached){checkIdentity(cached.identity);identity=cached.identity;const packet=await storage.load(identity.routeId);if(packet)await attach(packet);}}
  }catch(reason){await binding?.dispose().catch(()=>{});document?.dispose();throw reason;}
  const api={
    async kick(targetSessionId){
      invariant(state().canKick,'Only the room creator can remove participants.');
      const entry=[...peers.entries()].find(([,p])=>p.member?.sessionId===targetSessionId&&admittedPeer(p));
      invariant(entry&&targetSessionId!==sessionId,'This participant is no longer in the room.');
      const [peerId]=entry;await transport.send(peerId,encodeMessage(header('KICK',{targetSessionId})));
    },
    async savedRoute(dungeonId){const selected=roomRoutes[dungeonId];if(!selected)return null;const packet=await storage.load(selected.routeId);invariant(!packet||identityKey(packet.identity)===identityKey(selected),'Saved room route identity changed.');return packet;},
    async switchDocument(packet){
      invariant(state().canChangeDungeon,'Only the room creator can change the dungeon.');
      invariant(queued<128,'Room is busy. Try again.');
      return queue(async()=>{invariant(state().canChangeDungeon,'Only the room creator can change the dungeon.');invariant(packet.identity.dungeonId!==identity.dungeonId,'This dungeon is already selected.');invariant(roomEpoch<Number.MAX_SAFE_INTEGER,'Room generation limit reached.');switching=true;emit();try{await attach(packet,{replace:true,epoch:roomEpoch+1});error=undefined;for(const id of peers.keys())hello(id);}finally{switching=false;emit();}});
    },
    setCursor(value){if(closed||kicked||full||target||switching||role!=='player'||!document)return;const cursor={sequence:0,visible:Boolean(value),...(value||{})};validCursor(cursor,resolveOptions(identity).dungeon);cursors.set(value);},
    cursors:()=>cursors.values(),
    updateProfile(profile){invariant(!closed,'Room is closed.');checkClass(profile.classId);invariant(typeof profile.name==='string'&&profile.name.trim().length>0&&profile.name.trim().length<=40,'Enter a name up to 40 characters.');name=profile.name.trim();classId=profile.classId;profileVersion++;for(const id of peers.keys())hello(id);emit();},
    get document(){return document;},get binding(){return binding;},get sessionId(){return sessionId;},state,
    async start(){cursors.start();await connect();if(intervalMs>0&&!closed)timer=setInterval(tick,intervalMs);return api;},
    tick,
    async reconnect(config=connectionConfig){if(closed||kicked)return;connectionConfig=config;await disconnect();if(closed)return;peers.clear();hints.clear();cursors.clear();full=false;error=undefined;await connect();},
    async leave(){if(closed)return;for(const id of peers.keys())send(id,'LEAVE');closed=true;generation++;clearInterval(timer);clearTimeout(checkTimer);cursors.dispose();stopLocal?.();stopState?.();try{await disconnect();}finally{await tail;try{await binding?.dispose();}finally{document?.dispose();}}},
  };return api;
}
