const CURRENT_BUILD=JSON.parse(fs.readFileSync(new URL('../data/manifest.json',import.meta.url))).buildId;
import test from 'node:test';
import {PROTOCOL_VERSION} from '../collaboration/room-protocol.js';
import {connectionConfig} from '../collaboration/connection-config.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRouteDocument,restoreRouteDocument} from '../collaboration/route-document.js';
import {createRoomSession} from '../collaboration/room-manager.js';
import {decodeMessage,encodeMessage,envelope,newRoomCode,roomCode,displayCode,MAX_BYTES} from '../collaboration/room-protocol.js';
const dungeons=JSON.parse(fs.readFileSync('data/dungeons.json')),enemies=new Map(JSON.parse(fs.readFileSync('data/enemies.json')).map(e=>[e.id,e]));
const dungeon=dungeons.find(d=>d.mapImages.length===1),options={dungeon,enemies,role:'player'};
const resolveOptions=i=>{assert.equal(i.dungeonId,dungeon.id);assert.equal(i.buildId,CURRENT_BUILD);return options;};
function seed(){const doc=createRouteDocument({name:'Room route',buildId:CURRENT_BUILD,dungeonId:dungeon.id},options);doc.execute({type:'add-pull',id:'first'});const packet=doc.exportSnapshot();doc.dispose();return packet;}
function storage(){const packets=new Map(),rooms=new Map();return {
  async load(id){return packets.get(id);},async loadRoom(id){return rooms.get(id);},async saveRoom(id,value){rooms.set(id,structuredClone(value));},
  bind(doc){packets.set(doc.identity.routeId,doc.exportSnapshot());const stop=doc.subscribeUpdates(()=>packets.set(doc.identity.routeId,doc.exportSnapshot()));return {async flush(){},async dispose(){stop();}};},
};}
function network(){const endpoints=new Map();let serial=0,drop=()=>false;const sent=[];return {sent,deliver(from,to,frame){endpoints.get(to)?.onMessage(from,frame);},
  setDrop(fn){drop=fn;},
  factory:async callbacks=>{
    const id=String(++serial),others=[...endpoints.entries()];endpoints.set(id,callbacks);
    queueMicrotask(()=>{for(const [peer,cb]of others){callbacks.onPeerJoin(peer);cb.onPeerJoin(id);}});
    return {async send(target,frame){sent.push({from:id,to:target,frame:structuredClone(frame)});if(drop(id,target,decodeMessage(frame)))return;const cb=endpoints.get(target);if(cb)queueMicrotask(()=>{if(endpoints.has(id)&&endpoints.has(target))cb.onMessage(id,structuredClone(frame));});},sendPresence(target,payload){const cb=endpoints.get(target);if(cb)queueMicrotask(()=>cb.onPresence(id,structuredClone(payload)));},async close(){endpoints.delete(id);for(const cb of endpoints.values())cb.onPeerLeave(id);}};
  },
};}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'Timed out waiting for room state');}
async function member(t,net,config={}){const session=await createRoomSession({code:'ABCDEFGH2345',storage:storage(),resolveOptions,transportFactory:net.factory,intervalMs:0,cursorIntervalMs:0,...config});t.after(()=>session.leave());await session.start();return session;}

test('Joining and switching rooms wait for the selected dungeon geometry',async t=>{
  const net=network(),loaded=new Set(),waiting=new Map();
  const resolve=i=>({dungeon:dungeons.find(d=>d.id===i.dungeonId),enemies,role:'player'});
  const host=await member(t,net,{initialPacket:seed(),resolveOptions:resolve});
  const guest=await member(t,net,{
    resolveOptions:i=>loaded.has(i.dungeonId)?resolve(i):{dungeon:{id:i.dungeonId},enemies},
    prepareOptions:async i=>{
      if(loaded.has(i.dungeonId))return;
      await new Promise(done=>waiting.set(i.dungeonId,()=>{loaded.add(i.dungeonId);done();}));
    },
  });
  await until(()=>waiting.has(dungeon.id));assert.equal(guest.document,undefined);
  waiting.get(dungeon.id)();await until(()=>guest.document);
  assert.equal(guest.document.canonical(),host.document.canonical());
  const other=dungeons.find(d=>d.id!==dungeon.id);
  const next=createRouteDocument({name:'Other dungeon',buildId:CURRENT_BUILD,dungeonId:other.id},{dungeon:other,enemies,role:'player'});
  const packet=next.exportSnapshot();next.dispose();
  await host.switchDocument(packet);
  await until(()=>waiting.has(other.id));assert.equal(guest.document.identity.dungeonId,dungeon.id);
  waiting.get(other.id)();await until(()=>guest.document.identity.dungeonId===other.id);
  assert.equal(guest.document.canonical(),host.document.canonical());
});

test('Peer ping refreshes at most every five seconds and unavailable or stale peers have no ping',async t=>{
  let clock=0,pingMs=42,calls=0;const net=network(),factory=net.factory;
  net.factory=async callbacks=>({...await factory(callbacks),async connectionStats(){calls++;return {connection:'direct',pingMs};}});
  const host=await member(t,net,{initialPacket:seed(),now:()=>clock});
  const guest=await member(t,net,{role:'spectator',now:()=>clock});
  await until(()=>host.state().sessions.find(s=>!s.self)?.pingMs===42&&guest.state().sessions.find(s=>!s.self)?.pingMs===42);
  const firstCalls=calls;clock=4999;host.tick();guest.tick();await new Promise(r=>setTimeout(r,10));assert.equal(calls,firstCalls);
  pingMs=80;clock=5000;host.tick();guest.tick();await until(()=>host.state().sessions.find(s=>!s.self)?.pingMs===80);
  pingMs=null;clock=10000;host.tick();guest.tick();await until(()=>host.state().sessions.find(s=>!s.self)?.pingMs===null);
  pingMs=25;clock=15000;host.tick();guest.tick();await until(()=>host.state().sessions.find(s=>!s.self)?.pingMs===25);
  clock=31000;assert.equal(host.state().sessions.find(s=>!s.self)?.pingMs,null);
});

test('Room code and binary protocol validate lengths, versions and identity',()=>{
  const code=newRoomCode();assert.equal(code.length,12);assert.equal(roomCode('https://example.org/route/#room='+displayCode(code)),code);
  assert.throws(()=>roomCode('bad'),/12-character/);
  const h=envelope(code,'session','HELLO',null,{role:'spectator',name:'Viewer',classId:'',participantId:'viewer',profileVersion:0,leaderId:null,order:null,roster:[],hasDocument:false}),frame=encodeMessage(h);
  assert.deepEqual(decodeMessage(frame).header,h);
  assert.throws(()=>encodeMessage({...h,protocolVersion:99}),/protocol/);
  assert.throws(()=>decodeMessage(new Uint8Array([255,255,255,255])),/header/);
  assert.throws(()=>encodeMessage(h,new Uint8Array(MAX_BYTES+1)),/large/);
});

test('New joiner waits without inventing a route, then receives all types; spectator cannot edit',async t=>{
  const net=network(),guest=await member(t,net,{role:'spectator'});assert.equal(guest.document,undefined);assert.equal(guest.state().status,'waiting');
  const packet=seed(),host=await member(t,net,{initialPacket:packet});
  await until(()=>guest.document&&host.state().connected===1);
  assert.equal(guest.document.canonical(),host.document.canonical());assert.throws(()=>guest.document.execute({type:'clear-route'}),/Spectator/);
  host.document.executeBatch([{type:'add-marker',mapId:dungeon.mapImages[0].id,position:[1,2],label:'Marker'}, {type:'add-drawing',mapId:dungeon.mapImages[0].id,kind:'note',points:[[4,5]],text:'Note'}]);
  await until(()=>guest.document.canonical()===host.document.canonical());assert.equal(guest.state().sessions.length,2);
});

test('Missed live updates heal via version vectors; offline edits merge on reconnect',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),guest=await member(t,net);
  await until(()=>guest.document&&host.state().connected===1);
  net.setDrop((a,b,m)=>m.header.type==='DELTA'&&!m.header.replyTo);
  host.document.execute({type:'set-meta',patch:{name:'Missed'}});assert.notEqual(guest.document.snapshot().name,'Missed');
  guest.tick();await until(()=>guest.document.snapshot().name==='Missed');
  net.setDrop(()=>true);host.document.execute({type:'add-pull',id:'offline-a'});guest.document.execute({type:'add-pull',id:'offline-b'});
  net.setDrop(()=>false);await guest.reconnect();host.tick();
  await until(()=>host.document.canonical()===guest.document.canonical());assert.equal(host.document.snapshot().pulls.length,3);
});

test('Local copy survives everyone leaving; unknown room stays waiting; returner serves without original creator',async t=>{
  const net=network(),guestStorage=storage(),host=await member(t,net,{initialPacket:seed()}),guest=await member(t,net,{storage:guestStorage});
  await until(()=>guest.document);await guest.leave();await host.leave();
  const restored=await member(t,net,{storage:guestStorage});assert.ok(restored.document);assert.equal(restored.state().status,'alone');
  const late=await member(t,net);await until(()=>late.document);assert.equal(late.document.canonical(),restored.document.canonical());
});

test('Four sessions include spectators; fifth is full and a departed session frees a place',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),sessions=[host];
  for(let n=0;n<3;n++){const s=await member(t,net,{name:'Same name',role:n%2?'spectator':'player'});sessions.push(s);await until(()=>s.document);}
  await until(()=>sessions.every(s=>s.state().sessions.length===4));
  const fifth=await member(t,net);await until(()=>fifth.state().full);assert.equal(fifth.document,undefined);assert.equal(host.state().sessions.length,4);
  await sessions[3].leave();await fifth.reconnect();await until(()=>fifth.document);assert.equal(fifth.state().sessions.length,4);
});

test('Different routes or lineages in the same room are rejected without merging',async t=>{
  const net=network(),a=await member(t,net,{initialPacket:seed()}),b=await member(t,net,{initialPacket:seed()}),beforeA=a.document.canonical(),beforeB=b.document.canonical();
  await until(()=>a.state().error||b.state().error);assert.equal(a.document.canonical(),beforeA);assert.equal(b.document.canonical(),beforeB);
  assert.match(a.state().error||b.state().error,/Conflicting route/);
});


test('Simultaneous arrivals converge to four admitted sessions',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()});
  const arrivals=await Promise.all(Array.from({length:7},()=>member(t,net)));
  await until(()=>arrivals.filter(s=>s.state().full).length===4);
  const admitted=[host,...arrivals.filter(s=>!s.state().full)];
  await until(()=>admitted.every(s=>s.document&&s.state().sessions.length===4));
  const ids=admitted.map(s=>s.sessionId).sort();
  for(const s of admitted)assert.deepEqual(s.state().sessions.map(m=>m.sessionId).sort(),ids);
});

test('Two cached returners can reopen a room after all peers leave',async t=>{
  const net=network(),aStore=storage(),bStore=storage();
  const a=await member(t,net,{initialPacket:seed(),storage:aStore}),b=await member(t,net,{storage:bStore});
  await until(()=>b.document);await a.leave();await b.leave();
  const [a2,b2]=await Promise.all([member(t,net,{storage:aStore}),member(t,net,{storage:bStore})]);
  await until(()=>a2.state().connected===1&&b2.state().connected===1);
  b2.document.execute({type:'add-pull',id:'returned'});
  await until(()=>a2.document.canonical()===b2.document.canonical());
});


test('TURN is optional; relay-only requires explicit credentials',()=>{
  assert.deepEqual(connectionConfig(),{});
  assert.throws(()=>connectionConfig({relayOnly:true}),/TURN server/);
  assert.throws(()=>connectionConfig({urls:'turns:relay.example:443?transport=tcp'}),/username and password/);
  assert.throws(()=>connectionConfig({urls:'https://example.org',username:'user',credential:'password'}),/TURN URLs/);
  assert.deepEqual(connectionConfig({urls:'turns:relay.example:443?transport=tcp',username:' user ',credential:'password',relayOnly:true}),{turnConfig:[{urls:['turns:relay.example:443?transport=tcp'],username:'user',credential:'password'}],rtcConfig:{iceTransportPolicy:'relay'}});
});


test('Creator identity survives reload and is not transferred to remaining peers',async t=>{
  const net=network(),store=storage(),host=await member(t,net,{initialPacket:seed(),storage:store}),guest=await member(t,net);
  await until(()=>guest.document&&guest.state().sessions.some(s=>s.leader));const leader=host.state().leaderId;
  await host.leave();assert.equal(guest.state().sessions.some(s=>s.leader),false);
  const restored=await member(t,net,{storage:store});await until(()=>guest.state().sessions.some(s=>s.leader));
  assert.equal(restored.state().leaderId,leader);assert.ok(restored.state().sessions.find(s=>s.self).leader);assert.notEqual(restored.sessionId,host.sessionId);
});

test('Profile changes preserve session identity and ignore late profile revisions',async t=>{
  const net=network(),classes=[{id:'hero'}],host=await member(t,net,{initialPacket:seed(),classes}),guest=await member(t,net,{classes});
  await until(()=>guest.document&&host.state().connected===1);
  const old=net.sent.find(m=>{const h=decodeMessage(m.frame).header;return h.type==='HELLO'&&h.senderSessionId===host.sessionId&&h.order!==null;});
  host.updateProfile({name:'Updated <name>',classId:'hero'});
  await until(()=>guest.state().sessions.find(s=>s.sessionId===host.sessionId)?.name==='Updated <name>');
  const decoded=decodeMessage(old.frame);decoded.header.messageId=crypto.randomUUID();net.deliver(old.from,old.to,encodeMessage(decoded.header));
  await new Promise(r=>setTimeout(r,10));const row=guest.state().sessions.find(s=>s.sessionId===host.sessionId);assert.equal(row.classId,'hero');assert.equal(row.name,'Updated <name>');assert.equal(guest.state().sessions.length,2);
  assert.throws(()=>host.updateProfile({name:'Valid',classId:'unknown'}),/Unknown hero/);
});

test('Live update acknowledgments clear syncing without the periodic timer',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),guest=await member(t,net);
  await until(()=>host.state().connected===1&&guest.state().connected===1);
  net.setDrop((a,b,m)=>m.header.type==='ACK');host.document.execute({type:'set-meta',patch:{name:'Fast edit'}});
  await until(()=>guest.document.snapshot().name==='Fast edit');assert.equal(host.state().status,'syncing');
  net.setDrop(()=>false);host.document.execute({type:'add-pull',id:'next'});
  await until(()=>guest.document.snapshot().pulls.length===2);assert.equal(host.state().status,'syncing','An older unacknowledged edit must remain pending');
  host.tick();await until(()=>host.state().status==='connected');
  host.document.execute({type:'set-meta',patch:{name:'Immediate ack'}});await until(()=>host.state().status==='connected');assert.equal(guest.document.snapshot().name,'Immediate ack');
});

test('Cursors are transient, bound to the peer and suppressed for spectators',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),guest=await member(t,net),viewer=await member(t,net,{role:'spectator'});
  await until(()=>guest.document&&viewer.document&&host.state().connected===2);
  const versions=[host,guest,viewer].map(s=>s.document.version().bytes),mapId=dungeon.mapImages[0].id;
  host.setCursor({mapId,x:10,y:20});await until(()=>guest.cursors().length===1&&viewer.cursors().length===1);
  assert.equal(guest.cursors()[0].sessionId,host.sessionId);viewer.setCursor({mapId,x:30,y:40});assert.equal(host.cursors().length,0);
  for(const [i,s]of [host,guest,viewer].entries())assert.deepEqual(s.document.version().bytes,versions[i]);
  await host.leave();assert.equal(guest.cursors().length,0);assert.equal(viewer.cursors().length,0);
});

function dungeonSwitchOptions(identity){assert.equal(identity.buildId,CURRENT_BUILD);return {dungeon:dungeons.find(d=>d.id===identity.dungeonId),enemies,role:'player'};}
function nextDungeonPacket(){const target=dungeons.find(d=>d.id!==dungeon.id),doc=createRouteDocument({name:'Another dungeon',buildId:CURRENT_BUILD,dungeonId:target.id},{dungeon:target,enemies,role:'player'});doc.execute({type:'add-pull',id:'new-first'});const packet=doc.exportSnapshot();doc.dispose();return packet;}
test('Only the creator switches dungeons; sessions persist, spectators follow, old routes and edits are isolated',async t=>{
  const net=network(),hostStore=storage(),guestStore=storage(),archives=[],host=await member(t,net,{initialPacket:seed(),storage:hostStore,resolveOptions:dungeonSwitchOptions,onArchive:async view=>archives.push(view)}),guest=await member(t,net,{storage:guestStore,resolveOptions:dungeonSwitchOptions}),viewer=await member(t,net,{role:'spectator',resolveOptions:dungeonSwitchOptions});
  await until(()=>guest.document&&viewer.document&&host.state().connected===2);
  host.document.execute({type:'set-meta',patch:{name:'Saved first dungeon'}});await until(()=>guest.document.snapshot().name==='Saved first dungeon');
  const old=host.document.exportSnapshot(),sessions=[host,guest,viewer].map(s=>s.sessionId),delayed=net.sent.findLast(m=>decodeMessage(m.frame).header.type==='DELTA'),oldHello=net.sent.findLast(m=>decodeMessage(m.frame).header.type==='HELLO'),next=nextDungeonPacket();
  await assert.rejects(guest.switchDocument(next),/Only the room creator/);await assert.rejects(viewer.switchDocument(next),/Only the room creator/);
  await host.switchDocument(next);await until(()=>[guest,viewer].every(s=>s.state().identity.dungeonId===next.identity.dungeonId&&s.document));
  assert.deepEqual([host,guest,viewer].map(s=>s.sessionId),sessions);assert.equal(host.state().roomEpoch,2);assert.equal(viewer.document.role,'spectator');assert.equal(archives[0].name,'Saved first dungeon');
  assert.equal((await guestStore.load(old.identity.routeId)).identity.documentId,old.identity.documentId);
  const oldHeader=decodeMessage(oldHello.frame).header;oldHeader.messageId=crypto.randomUUID();net.deliver(oldHello.from,oldHello.to,encodeMessage(oldHeader));
  net.deliver(delayed.from,delayed.to,delayed.frame);guest.document.execute({type:'set-meta',patch:{name:'New dungeon edit'}});await until(()=>host.document.snapshot().name==='New dungeon edit');
  await host.switchDocument(await host.savedRoute(old.identity.dungeonId));await until(()=>[guest,viewer].every(s=>s.state().roomEpoch===3));
  assert.equal(guest.document.snapshot().name,'Saved first dungeon');assert.equal(host.document.identity.documentId,old.identity.documentId);
});
test('Lost dungeon announcements recover; cached and late joiners follow the selected dungeon without the creator',async t=>{
  const net=network(),cachedStore=storage(),host=await member(t,net,{initialPacket:seed(),resolveOptions:dungeonSwitchOptions}),guest=await member(t,net,{resolveOptions:dungeonSwitchOptions}),returner=await member(t,net,{storage:cachedStore,resolveOptions:dungeonSwitchOptions});
  await until(()=>guest.document&&returner.document&&host.state().connected===2);await returner.leave();
  net.setDrop((a,b,m)=>m.header.roomEpoch===2);const next=nextDungeonPacket();await host.switchDocument(next);assert.notEqual(guest.state().identity.dungeonId,next.identity.dungeonId);
  net.setDrop(()=>false);host.tick();await until(()=>guest.state().roomEpoch===2);await host.leave();
  const late=await member(t,net,{resolveOptions:dungeonSwitchOptions}),restored=await member(t,net,{storage:cachedStore,resolveOptions:dungeonSwitchOptions});
  await until(()=>[late,restored].every(s=>s.state().roomEpoch===2&&s.document));assert.equal(restored.document.identity.dungeonId,next.identity.dungeonId);assert.equal(restored.state().canChangeDungeon,false);
});
test('A failed archive keeps the current dungeon and can be retried',async t=>{
  let fail=true;const net=network(),host=await member(t,net,{initialPacket:seed(),resolveOptions:dungeonSwitchOptions,onArchive:async()=>{if(fail)throw Error('Archive failed');}}),before=host.document.identity,next=nextDungeonPacket();
  await assert.rejects(host.switchDocument(next),/Archive failed/);assert.deepEqual(host.document.identity,before);assert.equal(host.state().roomEpoch,1);assert.equal(host.state().canChangeDungeon,true);
  fail=false;await host.switchDocument(next);assert.equal(host.state().roomEpoch,2);
});

test('Late edits update their original route after the creator switches the active dungeon',async t=>{
  const net=network(),hostStore=storage(),host=await member(t,net,{initialPacket:seed(),storage:hostStore,resolveOptions:dungeonSwitchOptions}),guest=await member(t,net,{resolveOptions:dungeonSwitchOptions});
  await until(()=>guest.document&&host.state().connected===1);const oldIdentity=host.document.identity;
  net.setDrop((a,b,m)=>m.header.type==='DELTA'&&!m.header.replyTo);guest.document.execute({type:'set-meta',patch:{name:'Late old-map edit'}});
  const delayed=net.sent.findLast(m=>decodeMessage(m.frame).header.type==='DELTA');await host.switchDocument(nextDungeonPacket());await until(()=>guest.state().roomEpoch===2);
  net.setDrop(()=>false);net.deliver(delayed.from,delayed.to,delayed.frame);
  await until(()=>net.sent.some(m=>{const h=decodeMessage(m.frame).header;return h.type==='ACK'&&h.replyTo===decodeMessage(delayed.frame).header.messageId;}));
  assert.equal(host.document.snapshot().name,'Another dungeon');const archived=restoreRouteDocument(await hostStore.load(oldIdentity.routeId),dungeonSwitchOptions(oldIdentity));assert.equal(archived.snapshot().name,'Late old-map edit');archived.dispose();
  await host.switchDocument(await host.savedRoute(oldIdentity.dungeonId));await until(()=>guest.state().roomEpoch===3);assert.equal(host.document.snapshot().name,'Late old-map edit');
});
test('An offline editor reconciles its previous route while following a new active dungeon',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed(),resolveOptions:dungeonSwitchOptions}),guest=await member(t,net,{resolveOptions:dungeonSwitchOptions});
  await until(()=>guest.document&&host.state().connected===1);const previous=host.document.identity;
  net.setDrop(()=>true);guest.document.execute({type:'add-pull',id:'offline-old-map'});await host.switchDocument(nextDungeonPacket());
  net.setDrop(()=>false);await guest.reconnect();await until(()=>guest.state().roomEpoch===2&&host.state().connected===1);
  await host.switchDocument(await host.savedRoute(previous.dungeonId));await until(()=>guest.state().roomEpoch===3&&host.document.snapshot().pulls.some(p=>p.id==='offline-old-map'));
  assert.equal(host.document.identity.documentId,previous.documentId);
});


test('Equality checks verify content, invalidate after edits, recover loss, and expire offline',async t=>{
  let clock=1000;const net=network(),host=await member(t,net,{initialPacket:seed(),now:()=>clock}),guest=await member(t,net,{now:()=>clock});
  await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
  net.setDrop((a,b,m)=>m.header.type==='DELTA'&&!m.header.replyTo);
  host.document.execute({type:'add-pull',id:'diagnostic-edit'});assert.notEqual(host.state().syncStatus,'synced');
  await until(()=>guest.state().syncStatus==='syncing');assert.notEqual(guest.state().syncStatus,'mismatch');
  net.setDrop(()=>false);host.tick();guest.tick();await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
  net.setDrop(()=>true);clock+=16000;assert.equal(host.state().syncStatus,'offline');assert.equal(guest.state().syncStatus,'offline');
  net.setDrop(()=>false);await guest.reconnect();host.tick();await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
});

test('Same-version content mismatch is visible; older checks cannot overwrite newer evidence',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),guest=await member(t,net);
  await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
  const latest=net.sent.findLast(m=>{const h=decodeMessage(m.frame).header;return h.type==='CHECK'&&h.senderSessionId===host.sessionId;});
  const original=decodeMessage(latest.frame).header;
  const bad={...original,messageId:crypto.randomUUID(),checkSequence:original.checkSequence+1,contentHash:'0'.repeat(64),replyTo:crypto.randomUUID()};
  net.deliver(latest.from,latest.to,encodeMessage(bad));await until(()=>guest.state().syncStatus==='mismatch');
  net.deliver(latest.from,latest.to,encodeMessage({...original,messageId:crypto.randomUUID()}));await new Promise(r=>setTimeout(r,15));assert.equal(guest.state().syncStatus,'mismatch');
  host.tick();guest.tick();await until(()=>guest.state().syncStatus==='synced');assert.equal(guest.document.canonical(),host.document.canonical());
});

test('Rapid dungeon changes ignore delayed checks and converge at the final selection',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed(),resolveOptions:dungeonSwitchOptions}),guest=await member(t,net,{resolveOptions:dungeonSwitchOptions});
  await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
  const stale=net.sent.filter(m=>decodeMessage(m.frame).header.type==='CHECK'),first=host.document.identity;
  for(let n=0;n<4;n++){await host.switchDocument(n%2?await host.savedRoute(first.dungeonId):await host.savedRoute(dungeons.find(d=>d.id!==dungeon.id).id)||nextDungeonPacket());}
  await until(()=>guest.state().roomEpoch===5);for(const m of stale)net.deliver(m.from,m.to,m.frame);
  host.tick();guest.tick();await until(()=>[host,guest].every(s=>s.state().syncStatus==='synced'));
  assert.equal(guest.document.canonical(),host.document.canonical());assert.equal(guest.document.identity.documentId,first.documentId);
});

test('Only the creator can kick; the target leaves once, keeps a copy, and may rejoin the same room',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),saved=storage();let notices=0,copy;
  const guest=await member(t,net,{storage:saved,onKicked:()=>{notices++;copy=guest.document.exportSnapshot();}}),viewer=await member(t,net,{role:'spectator'});
  await until(()=>[host,guest,viewer].every(s=>s.state().syncStatus==='synced'));
  await assert.rejects(guest.kick(host.sessionId),/Only the room creator/);await assert.rejects(viewer.kick(guest.sessionId),/Only the room creator/);await assert.rejects(host.kick(host.sessionId),/no longer/);
  const fromGuest=net.sent.find(m=>decodeMessage(m.frame).header.senderSessionId===guest.sessionId&&m.to==='1');
  net.deliver(fromGuest.from,fromGuest.to,encodeMessage(envelope(host.state().roomId,guest.sessionId,'KICK',host.document.identity,{targetSessionId:host.sessionId})));
  await new Promise(r=>setTimeout(r,15));assert.equal(host.state().kicked,false);
  const room=host.state().roomId;await host.kick(guest.sessionId);await until(()=>guest.state().status==='left'&&host.state().sessions.length===2&&viewer.state().sessions.length===2);
  assert.equal(notices,1);assert.ok(copy);assert.equal(host.state().roomId,room);assert.equal(viewer.state().roomId,room);
  await guest.reconnect();assert.equal(guest.state().status,'left');
  const returned=await member(t,net,{storage:saved});await until(()=>returned.state().syncStatus==='synced');assert.equal(returned.state().roomId,room);
  await host.kick(viewer.sessionId);await until(()=>viewer.state().status==='left');
});


test('Four sessions converge after concurrent edits, reordered duplicate delivery, and repair',async t=>{
  const net=network(),host=await member(t,net,{initialPacket:seed()}),a=await member(t,net),b=await member(t,net),viewer=await member(t,net,{role:'spectator'}),all=[host,a,b,viewer];
  await until(()=>all.every(s=>s.state().syncStatus==='synced'));
  const start=net.sent.length;net.setDrop(()=>true);
  host.document.execute({type:'add-pull',id:'parallel-host'});a.document.execute({type:'add-pull',id:'parallel-a'});b.document.execute({type:'add-pull',id:'parallel-b'});
  host.document.execute({type:'set-meta',patch:{name:'Concurrent room'}});a.document.execute({type:'set-meta',patch:{shadow:true}});
  b.document.execute({type:'add-marker',mapId:dungeon.mapImages[0].id,position:[15,20],label:'Parallel marker'});
  const delayed=net.sent.slice(start).filter(m=>decodeMessage(m.frame).header.type==='DELTA').reverse();net.setDrop(()=>false);
  for(const m of delayed.slice(2)){net.deliver(m.from,m.to,m.frame);net.deliver(m.from,m.to,m.frame);}
  for(const s of all)s.tick();await until(()=>all.every(s=>s.state().syncStatus==='synced'));
  for(const s of all){assert.equal(s.document.canonical(),host.document.canonical());assert.equal(s.document.snapshot().pulls.length,4);assert.equal(s.document.snapshot().markers.length,1);assert.equal(s.document.snapshot().shadow,true);}
});


test('A lone creator remains visible after reload before any peer handshake',async t=>{
  const net=network(),saved=storage(),classes=[{id:'rime'}];
  const host=await member(t,net,{initialPacket:seed(),storage:saved,name:'Solo creator',classId:'rime',classes});
  const original=host.state();await host.leave();
  const restored=await member(t,net,{storage:saved,name:'Solo creator',classId:'rime',classes});
  const state=restored.state();assert.equal(state.status,'alone');assert.equal(state.sessions.length,1);
  const self=state.sessions[0];assert.equal(self.self,true);assert.equal(self.leader,true);assert.equal(self.name,'Solo creator');assert.equal(self.classId,'rime');
  assert.equal(self.participantId,original.participantId);assert.notEqual(self.sessionId,original.sessionId);assert.equal(state.canChangeDungeon,true);
  assert.equal(net.sent.length,0,'Restoring the visible profile must not require network traffic');
  const guest=await member(t,net,{classes});await until(()=>[restored,guest].every(s=>s.state().syncStatus==='synced'));
  assert.equal(restored.state().sessions.length,2);assert.equal(guest.state().sessions.filter(s=>s.leader).length,1);
});
