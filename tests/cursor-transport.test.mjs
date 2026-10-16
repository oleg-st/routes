import test from 'node:test';
import assert from 'node:assert/strict';
import {createCursorTransport,CURSOR_RETRY} from '../collaboration/cursor-transport.js';

function connection(){
  const sent=[],channel={readyState:'open',bufferedAmount:0,send(data){sent.push(JSON.parse(data));}};
  const pc={calls:0,createDataChannel(label,options){this.calls++;this.label=label;this.options=options;return channel;}};
  return {pc,channel,sent,receive:packet=>channel.onmessage({data:JSON.stringify(packet)})};
}
function fixture(t){
  let clock=0;const received=[],wire=connection();
  const transport=createCursorTransport({roomId:'room',onPresence:(id,payload)=>received.push({id,payload}),now:()=>clock,intervalMs:0});
  t.after(()=>transport.close());transport.add('peer',wire.pc);
  const ack=(packet=wire.sent.at(-1),patch={})=>wire.receive({...packet,payload:undefined,ack:true,...patch});
  return {transport,wire,received,ack,at(time){clock=time;transport.tick();}};
}

test('Cursor channel is unreliable; immediate ACKs still limit sending to 20 Hz',t=>{
  const {transport,wire,ack,at}=fixture(t);
  assert.deepEqual(wire.pc.options,{negotiated:true,id:42,ordered:false,maxRetransmits:0});
  for(let time=0;time<1000;time++){at(time);transport.send('peer',{x:time});ack();}
  assert.equal(wire.sent.length,20);at(1000);assert.equal(wire.sent.at(-1).payload.x,999);
});

test('Slow delivery coalesces samples and ACK arrival releases only the latest position',t=>{
  const {transport,wire,ack,at}=fixture(t);
  transport.send('peer',{x:0});const first=wire.sent[0];
  for(let time=50;time<=400;time+=50){at(time);transport.send('peer',{x:time});}
  assert.equal(wire.sent.length,1);ack(first);
  assert.equal(wire.sent.length,2);assert.equal(wire.sent[1].payload.x,400);
  at(800);transport.send('peer',{x:800});ack(first);
  assert.equal(wire.sent.length,2,'An old ACK must not release a newer in-flight packet');
  ack(wire.sent[1],{stream:'previous-session'});assert.equal(wire.sent.length,2);
  ack(wire.sent[1],{roomId:'another-room'});assert.equal(wire.sent.length,2);
  ack(wire.sent[1]);assert.equal(wire.sent.at(-1).payload.x,800);
});

test('Lost packets or ACKs retry current state after 1.5 s, including final hidden state',t=>{
  const {transport,wire,ack,at}=fixture(t);
  transport.send('peer',{x:1});at(500);transport.send('peer',{visible:false});
  at(CURSOR_RETRY-1);assert.equal(wire.sent.length,1);
  at(CURSOR_RETRY);assert.deepEqual(wire.sent[1].payload,{visible:false});
  at(2*CURSOR_RETRY);assert.deepEqual(wire.sent[2].payload,{visible:false});
  assert.notEqual(wire.sent[1].sequence,wire.sent[2].sequence);
  ack();at(3*CURSOR_RETRY);assert.equal(wire.sent.length,3,'Acknowledged idle state must stop retrying');
});

test('Full buffers and unavailable channels never accumulate cursor packets, even after timeout',t=>{
  const {transport,wire,at}=fixture(t);
  transport.send('peer',{x:1});wire.channel.bufferedAmount=1;
  at(2000);transport.send('peer',{x:2});at(4000);assert.equal(wire.sent.length,1);
  wire.channel.bufferedAmount=0;wire.channel.readyState='connecting';at(4050);assert.equal(wire.sent.length,1);
  wire.channel.readyState='open';at(4100);assert.equal(wire.sent.at(-1).payload.x,2);
  wire.channel.send=()=>{throw new Error('Queue full');};at(6000);
  wire.channel.send=data=>wire.sent.push(JSON.parse(data));at(6050);assert.equal(wire.sent.length,3);
});

test('Each recipient waits independently; peer removal and transport close stop retries',t=>{
  const {transport,wire,at}=fixture(t),fast=connection();transport.add('fast',fast.pc);
  for(let time=0;time<500;time+=50){
    at(time);transport.send('peer',{x:time});transport.send('fast',{x:time});
    fast.receive({...fast.sent.at(-1),payload:undefined,ack:true});
  }
  assert.equal(wire.sent.length,1);assert.equal(fast.sent.length,10);
  transport.remove('peer');at(2000);transport.send('peer',{x:999});assert.equal(wire.sent.length,1);
  transport.close();transport.send('fast',{x:999});at(4000);assert.equal(fast.sent.length,10);
});

test('Reception acknowledges data, rejects malformed/oversized packets and never acknowledges ACKs',t=>{
  const {wire,received}=fixture(t);
  const packet={version:2,roomId:'room',stream:'remote-session',sequence:1,payload:{x:2}};
  wire.receive(packet);assert.deepEqual(received,[{id:'peer',payload:{x:2}}]);assert.equal(wire.sent[0].ack,true);
  assert.equal(wire.sent[0].stream,packet.stream);assert.equal(wire.sent[0].sequence,1);
  wire.receive({...packet,payload:undefined,ack:true});
  for(const patch of [{sequence:0},{sequence:NaN},{version:1},{roomId:'wrong'},{stream:null},{payload:null},{payload:{x:'я'.repeat(1100)}}])wire.receive({...packet,...patch});
  wire.channel.onmessage({data:'{'});wire.channel.onmessage({data:new ArrayBuffer(10)});wire.receive(null);
  assert.equal(received.length,1);assert.equal(wire.sent.length,1);
  wire.channel.bufferedAmount=100;wire.receive({...packet,sequence:2});assert.equal(received.length,2);assert.equal(wire.sent.length,1,'ACKs also respect buffer pressure');
});

test('Pooled connections multiplex rooms and survive room leave/rejoin without channel duplication',t=>{
  const {transport,wire,received,at}=fixture(t),otherReceived=[];
  const other=createCursorTransport({roomId:'other',onPresence:(_,p)=>otherReceived.push(p),intervalMs:0});t.after(()=>other.close());
  other.add('peer',wire.pc);assert.equal(wire.pc.calls,1);
  const packet={version:2,roomId:'other',stream:'remote',sequence:1,payload:{x:4}};
  wire.receive(packet);assert.equal(received.length,0);assert.equal(otherReceived.length,1);
  transport.remove('peer');wire.receive({...packet,roomId:'room'});assert.equal(received.length,0);
  transport.add('peer',wire.pc);assert.equal(wire.pc.calls,1);wire.receive({...packet,roomId:'room'});assert.equal(received.length,1);
  transport.close();wire.receive(packet);assert.equal(otherReceived.length,2);
  at(5000);assert.equal(wire.channel.readyState,'open');
});

test('ACK from before a peer rejoin cannot release the new stream',t=>{
  const {transport,wire,ack,at}=fixture(t);
  transport.send('peer',{x:1});const old=wire.sent[0];
  transport.remove('peer');transport.add('peer',wire.pc);transport.send('peer',{x:2});
  at(100);transport.send('peer',{x:3});ack(old);assert.equal(wire.sent.length,2);
  ack(wire.sent[1]);assert.equal(wire.sent.at(-1).payload.x,3);
});
