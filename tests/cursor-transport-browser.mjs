// Real SCTP data channels; only packet loss/ACK delay and the sender clock are controlled.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cursor transport test</title>');return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async()=>{
    const {createCursorTransport}=await import('/collaboration/cursor-transport.js');
    const {peerConnectionStats}=await import('/collaboration/peer-connection-stats.js');
    const until=async fn=>{const start=performance.now();while(!fn()){if(performance.now()-start>10000)throw new Error('WebRTC wait timed out');await new Promise(r=>setTimeout(r,10));}};
    const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});
    // Keep the normal reliable channel, as Trystero does. Use loopback for this
    // same-machine test because isolated browser profiles may not resolve mDNS.
    const forward=(destination,e)=>{if(e.candidate){const c=e.candidate.toJSON();c.candidate=c.candidate.replace(/ (\S+\.local) (\d+) typ host/g,' 127.0.0.1 $2 typ host');destination.addIceCandidate(c);}};
    a.onicecandidate=e=>forward(b,e);b.onicecandidate=e=>forward(a,e);
    const reliable=a.createDataChannel('data');let remoteReliable,routeMessage;
    b.ondatachannel=e=>{remoteReliable=e.channel;remoteReliable.onmessage=e=>routeMessage=e.data;};
    let time=0,ca,cb,drop=true,hold=true;const held=[],sent=[],received=[];
    const createA=a.createDataChannel.bind(a),createB=b.createDataChannel.bind(b);
    a.createDataChannel=(...args)=>{ca=createA(...args);const send=ca.send.bind(ca);ca.send=data=>{sent.push(JSON.parse(data));if(drop){drop=false;return;}send(data);};return ca;};
    b.createDataChannel=(...args)=>{cb=createB(...args);const send=cb.send.bind(cb);cb.send=data=>{if(hold)held.push(()=>send(data));else send(data);};return cb;};
    const sender=createCursorTransport({roomId:'test',now:()=>time,intervalMs:0});
    const receiver=createCursorTransport({roomId:'test',onPresence:(_,p)=>received.push(p),intervalMs:0});
    try{
      await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);
      await until(()=>reliable.readyState==='open'&&remoteReliable?.readyState==='open');
      sender.add('b',a);receiver.add('a',b);await until(()=>ca.readyState==='open'&&cb.readyState==='open');
      sender.send('b',{x:1});time=100;sender.send('b',{x:2});time=1499;sender.tick();const beforeRetry=sent.length;
      time=1500;sender.tick();await until(()=>received.length===1&&held.length===1);
      time=1600;sender.send('b',{x:3});const beforeAck=sent.length;
      reliable.send('route update');await until(()=>routeMessage==='route update');
      time=1800;hold=false;held.shift()();await until(()=>received.length===2);
      await until(()=>ca.bufferedAmount===0&&cb.bufferedAmount===0);
      const stats=await peerConnectionStats(a);
      return {options:{ordered:ca.ordered,maxRetransmits:ca.maxRetransmits,negotiated:ca.negotiated},beforeRetry,beforeAck,positions:received.map(p=>p.x),sent:sent.length,routeMessage,stats};
    }finally{sender.close();receiver.close();a.close();b.close();}
  });
  assert.deepEqual(result.options,{ordered:false,maxRetransmits:0,negotiated:true});
  assert.equal(result.beforeRetry,1);assert.equal(result.beforeAck,2);assert.deepEqual(result.positions,[2,3]);assert.equal(result.sent,3);
  assert.equal(result.routeMessage,'route update');assert.equal(result.stats.connection,'direct');assert.ok(Number.isFinite(result.stats.pingMs));
  console.log('Native WebRTC: unreliable cursor channel, packet loss, delayed ACK, latest position, independent reliable route channel and RTT passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
