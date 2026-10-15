import {SCHEMA_VERSION, invariant, record, id, string, role, uuid} from './route-schema.js';
export const PROTOCOL_VERSION = 4;
export const MAX_SESSIONS = 4;
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_HEADER = 16 * 1024;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode() {return Array.from(crypto.getRandomValues(new Uint8Array(12)), n => alphabet[n & 31]).join('');}
export function roomCode(value) {
  invariant(typeof value === 'string', 'Enter a room code.');
  let code=value.trim();
  if(code.includes('#room=')){const hash=code.slice(code.indexOf('#room=')+6);code=decodeURIComponent(hash.split('&')[0]);}
  code=code.replace(/[\s-]/g,'').toUpperCase();
  invariant(code.length===12&&[...code].every(c=>alphabet.includes(c)), 'Use the 12-character room code or invitation link.');return code;
}
export const displayCode = code => roomCode(code).match(/.{4}/g).join('-');
export function identityKey(value) {return JSON.stringify([value.schemaVersion,value.routeId,value.documentId,value.dungeonId,value.buildId]);}
export function checkIdentity(value) {
  record(value,['schemaVersion','routeId','documentId','dungeonId','buildId']);
  invariant(value.schemaVersion===SCHEMA_VERSION,'Incompatible route schema.');
  for(const k of ['routeId','documentId','dungeonId'])id(value[k]);string(value.buildId);return value;
}
export function checkProfile(value){
  id(value.participantId);string(value.name,40);string(value.classId,80);
  invariant(Number.isSafeInteger(value.profileVersion)&&value.profileVersion>=0,'Invalid profile version.');
}
export function checkMember(value) {
  record(value,['sessionId','order','name','role','participantId','classId','profileVersion']);id(value.sessionId);role(value.role);checkProfile(value);
  invariant(Number.isSafeInteger(value.order)&&value.order>=0,'Invalid admission order.');return value;
}
export const compareMembers = (a,b) => a.order-b.order || (a.sessionId<b.sessionId?-1:a.sessionId>b.sessionId?1:0);
export function checkHeader(h,bytes) {
  record(h,['protocolVersion','roomId','roomEpoch','senderSessionId','messageId','type','identity','role','name','order','roster','hasDocument','replyTo','participantId','classId','profileVersion','leaderId','vectorHash','contentHash','checkSequence','targetSessionId']);
  invariant(h.protocolVersion===PROTOCOL_VERSION,'Incompatible room protocol.');invariant(roomCode(h.roomId)===h.roomId,'Invalid room code.');
  invariant(Number.isSafeInteger(h.roomEpoch)&&h.roomEpoch>=1,'Invalid room generation.');id(h.senderSessionId);id(h.messageId);
  invariant(['HELLO','REQUEST','SNAPSHOT','DELTA','FULL','LEAVE','ACK','CHECK','KICK'].includes(h.type),'Unknown room message.');
  if(h.type==='CHECK'){
    invariant(/^[a-f0-9]{64}$/.test(h.vectorHash)&&/^[a-f0-9]{64}$/.test(h.contentHash),'Invalid route fingerprint.');
    invariant(Number.isSafeInteger(h.checkSequence)&&h.checkSequence>=0,'Invalid check sequence.');
  }
  if(h.type==='KICK')id(h.targetSessionId);
  if(h.identity!==null)checkIdentity(h.identity);
  if(h.type==='HELLO'||h.type==='FULL'){
    role(h.role);checkProfile(h);if(h.leaderId!==null)id(h.leaderId);invariant(h.order===null||Number.isSafeInteger(h.order)&&h.order>=0,'Invalid admission order.');
    invariant(Array.isArray(h.roster)&&h.roster.length<=MAX_SESSIONS,'Invalid session roster.');h.roster.forEach(checkMember);
    invariant(new Set(h.roster.map(m=>m.sessionId)).size===h.roster.length,'Duplicate sessions.');
    invariant(typeof h.hasDocument==='boolean'&&(!h.hasDocument||h.identity!==null),'Invalid document availability.');
  }
  if(['REQUEST','SNAPSHOT','DELTA','ACK','CHECK'].includes(h.type))invariant(h.identity!==null,'Missing route identity.');
  if(h.replyTo!==undefined)id(h.replyTo);
  if(['SNAPSHOT','ACK'].includes(h.type))invariant(h.replyTo,'Unsolicited snapshot.');
  invariant(bytes instanceof Uint8Array&&bytes.length<=MAX_BYTES,'Room packet too large.');
  if(['HELLO','FULL','LEAVE','ACK','CHECK','KICK'].includes(h.type))invariant(bytes.length===0,'Unexpected message body.');
  if(['SNAPSHOT','DELTA'].includes(h.type))invariant(bytes.length>0,'Missing document bytes.');
  if(h.type==='REQUEST')invariant(bytes.length<=65536,'Version vector too large.');return h;
}
export function encodeMessage(header, bytes=new Uint8Array()) {
  checkHeader(header,bytes);const json=new TextEncoder().encode(JSON.stringify(header));invariant(json.length<=MAX_HEADER,'Message header too large.');
  const frame=new Uint8Array(4+json.length+bytes.length);new DataView(frame.buffer).setUint32(0,json.length);frame.set(json,4);frame.set(bytes,4+json.length);return frame;
}
export function decodeMessage(frame) {
  if(frame instanceof ArrayBuffer)frame=new Uint8Array(frame);
  invariant(frame instanceof Uint8Array&&frame.length>=4&&frame.length<=MAX_BYTES+MAX_HEADER+4,'Invalid room frame.');
  const size=new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getUint32(0);
  invariant(size>0&&size<=MAX_HEADER&&4+size<=frame.length,'Invalid message header.');
  const h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame.subarray(4,4+size))),bytes=frame.subarray(4+size);
  return {header:checkHeader(h,bytes),bytes};
}
export function envelope(roomId,sessionId,type,identity,extra={}) {return {protocolVersion:PROTOCOL_VERSION,roomId,roomEpoch:1,senderSessionId:sessionId,messageId:uuid(),type,identity,...extra};}
