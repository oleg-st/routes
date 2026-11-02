// R5: schema-specific fields and immutable build-scoped defaults. All fallbacks
// are lossless. Game-build identity is reconstructed before normal validation.
import {binaryIO} from './route-binary.js';
import {routeCodebooks} from './data/route-codebooks.js';
const {Writer,Reader,metadataWriter,metadataReader,writeMembers,readMembers,
  writeAssignments,readAssignments,writeOrder,readOrder,placementsOf}=binaryIO;
const LIMIT=3_000_000,MAX_MEMBERS=4096;
const invalid=()=>new Error('Invalid dense route.');
const trim=row=>{while(row.at(-1)==null&&row.length)row.pop();return row;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const zig=n=>n<0?-2*n-1:n*2;
const unzig=n=>n%2?-(n+1)/2:n/2;
const defaults=['New route','Imported route'];
// Frozen wire defaults, matching the editor's initial drawing colors.
const drawingColors=['#ff0000','#70d9ff','#bb86fc',null];

// Enumerative subset coding spends ceil(log2(C(n,k))) bits, instead of an
// integer for every member. Decode takes O(n), including adversarial ranks.
function choose(n,k){
  if(k<0||k>n)return 0n;
  let value=1n;
  for(let i=1;i<=Math.min(k,n-k);i++)value=value*BigInt(n-i+1)/BigInt(i);
  return value;
}
const widthOf=n=>n<=1n?0:(n-1n).toString(2).length;
function writeSubset(w,indices,n,order=0,offset=0){
  w.golomb(indices.length-offset,order);
  let rank=0n;
  indices.forEach((index,i)=>rank+=choose(index,i+1));
  const width=widthOf(choose(n,indices.length));
  for(let i=width-1;i>=0;i--)w.uint(Number(rank>>BigInt(i)&1n),1);
}
function readSubset(r,n,order=0,offset=0){
  const k=r.golomb(order)+offset;if(k>n)throw invalid();
  const range=choose(n,k),width=widthOf(range);
  if(width>r.remaining)throw invalid();
  let rank=0n;for(let i=0;i<width;i++)rank=rank*2n+BigInt(r.uint(1));
  if(rank>=range)throw invalid();
  const result=[];let x=n-1,left=k,c=choose(x,left);
  while(left){
    if(c<=rank){
      result.push(x);rank-=c;
      c=x?c*BigInt(left)/BigInt(x):0n;left--;x--;
    }else{c=c*BigInt(x-left)/BigInt(x);x--;}
  }
  return result.reverse();
}
function writeCombinations(w,pulls,size){
  let order=0,cost=Infinity;
  for(let k=0;k<4;k++){
    const bits=pulls.reduce((sum,p)=>sum+2*Math.floor(Math.log2(p.length+2**k))+1-k,0);
    if(bits<cost){cost=bits;order=k;}
  }
  w.uint(order,2);
  const remaining=Array.from({length:size},(_,i)=>i);
  for(const members of pulls){
    const selected=new Set(members),indices=[];
    remaining.forEach((id,i)=>{if(selected.has(id))indices.push(i);});
    if(indices.length!==members.length)throw invalid();
    writeSubset(w,indices,remaining.length,order);
    for(let i=indices.length-1;i>=0;i--)remaining.splice(indices[i],1);
  }
}
function readCombinations(r,count,size){
  const order=r.uint(2);
  const remaining=Array.from({length:size},(_,i)=>i),pulls=[];
  for(let i=0;i<count;i++){
    const indices=readSubset(r,remaining.length,order);pulls.push(indices.map(i=>remaining[i]));
    for(let j=indices.length-1;j>=0;j--)remaining.splice(indices[j],1);
  }
  return pulls;
}

function groupedMembers(members,book){
  const remaining=new Set(members),tokens=[];
  // Longest complete compositions first. Unlike R3, members need not be
  // adjacent in the user's list; the separate permutation keeps that order.
  const groups=book.groups.map((members,index)=>({members,index})).sort((a,b)=>b.members.length-a.members.length||a.index-b.index);
  for(const group of groups)if(group.members.every(id=>remaining.has(id))){
    tokens.push(group.index);for(const id of group.members)remaining.delete(id);
  }
  for(const id of remaining)tokens.push(book.groups.length+id);
  return tokens.sort((a,b)=>a-b);
}
function writeGroups(w,pulls,book){
  for(const members of pulls)writeSubset(w,groupedMembers(members,book),book.groups.length+book.size);
}
function readGroups(r,count,book){
  const pulls=[],seen=new Set();
  for(let i=0;i<count;i++){
    const tokens=readSubset(r,book.groups.length+book.size),members=[];
    for(const token of tokens)for(const id of token<book.groups.length?book.groups[token]:[token-book.groups.length]){
      if(seen.has(id))throw invalid();seen.add(id);members.push(id);
    }
    pulls.push(members.sort((a,b)=>a-b));
  }
  return pulls;
}

// Distinguish packs from single placements and shrink both alphabets after
// each pull. This exploits the fact that a mob can be assigned only once.
function writeRemainingGroups(w,pulls,book){
  const remaining=new Set(Array.from({length:book.size},(_,i)=>i));
  for(const members of pulls){
    const eligible=book.groups.map((g,i)=>g.every(id=>remaining.has(id))?i:-1).filter(i=>i>=0);
    const tokens=groupedMembers(members,book),groups=tokens.filter(t=>t<book.groups.length),singles=tokens.filter(t=>t>=book.groups.length).map(t=>t-book.groups.length);
    w.uint((groups.length?1:0)|(singles.length?2:0),2);
    if(groups.length)writeSubset(w,groups.map(g=>eligible.indexOf(g)),eligible.length,0,1);
    for(const g of groups)for(const id of book.groups[g])remaining.delete(id);
    const pool=[...remaining];
    if(singles.length)writeSubset(w,singles.map(id=>pool.indexOf(id)),pool.length,0,1);
    for(const id of singles)remaining.delete(id);
  }
}
function readRemainingGroups(r,count,book){
  const remaining=new Set(Array.from({length:book.size},(_,i)=>i)),pulls=[];
  for(let i=0;i<count;i++){
    const eligible=book.groups.filter(g=>g.every(id=>remaining.has(id))),kind=r.uint(2),members=[];
    const groups=kind&1?readSubset(r,eligible.length,0,1).map(i=>eligible[i]):[];
    for(const group of groups)for(const id of group){
      if(!remaining.delete(id))throw invalid();members.push(id);
    }
    const pool=[...remaining],singles=kind&2?readSubset(r,pool.length,0,1).map(i=>pool[i]):[];
    for(const id of singles){remaining.delete(id);members.push(id);}
    pulls.push(members.sort((a,b)=>a-b));
  }
  return pulls;
}

function writeName(w,write,name,book){
  const logPrefix=`${book.name} · #`,log=name.startsWith(logPrefix)?name.slice(logPrefix.length):'';
  const route=/^Route ([1-9]\d*)$/.exec(name)?.[1];
  if(/^[1-9]\d*$/.test(log)&&Number(log)<=0xffffffff){w.uint(0,2);w.golomb(Number(log)-1);}
  else if(route&&Number(route)<=0xffffffff){w.uint(1,2);w.golomb(Number(route)-1);}
  else if(defaults.includes(name)){w.uint(2,2);w.uint(defaults.indexOf(name),1);}
  else{w.uint(3,2);write(name);}
}
function readName(r,read,book){
  switch(r.uint(2)){
    case 0:return `${book.name} · #${r.golomb()+1}`;
    case 1:return `Route ${r.golomb()+1}`;
    case 2:return defaults[r.uint(1)];
    default:return read();
  }
}
function writePullMetadata(w,write,pulls){
  let mask=0;for(let i=1;i<5;i++)if(pulls.some(row=>row[i]!=null))mask|=1<<(i-1);
  w.uint(mask,4);
  for(let i=1;i<5;i++)if(mask&(1<<(i-1))){
    const rows=pulls.filter(row=>row[i]!=null),all=rows.length===pulls.length;
    w.uint(all?1:0,1);if(!all)for(const row of pulls)w.uint(row[i]!=null?1:0,1);
    if(i===4){if(rows.some(row=>row[i]!==1))throw invalid();continue;}
    if(i===3){
      const numbers=rows.map(row=>/^Log segment-([1-9]\d*)\.$/.exec(row[i])?.[1]);
      const templated=numbers.every(n=>n&&Number(n)<=0xffffffff);
      w.uint(templated?1:0,1);
      if(templated){
        const consecutive=numbers.every((n,i)=>Number(n)===i+1);w.uint(consecutive?1:0,1);
        if(!consecutive)for(const n of numbers)w.golomb(Number(n)-1);
        continue;
      }
    }
    for(const row of rows)write(row[i]);
  }
}
function readPullMetadata(r,read,pulls){
  const mask=r.uint(4);
  for(let i=1;i<5;i++)if(mask&(1<<(i-1))){
    const all=r.uint(1),rows=pulls.filter(()=>all||r.uint(1));
    const templated=i===3&&r.uint(1),consecutive=templated&&r.uint(1);
    rows.forEach((row,j)=>{
      while(row.length<i)row.push(null);
      row[i]=i===4?1:templated?`Log segment-${consecutive?j+1:r.golomb()+1}.`:read();
    });
  }
}
function writeMods(w,write,mods,book){
  const presets=Array.from({length:3},(_,i)=>same((mods?.[i]??[]).slice(1),(book.mods[i]??[]).slice(1))).every(Boolean);
  w.uint(presets?1:0,1);
  if(presets){for(let i=0;i<3;i++)w.uint(mods?.[i]?.[0]===1?1:0,1);return;}
  for(let i=0;i<3;i++){
    const row=mods?.[i]??[],tail=row.slice(1),preset=(book.mods[i]??[]).slice(1);
    w.uint(row[0]===1?1:0,1);
    const kind=!tail.length?0:same(tail,preset)?1:2;w.uint(kind,2);
    if(kind===2)write(tail);
  }
}
function readMods(r,read,book){
  if(r.uint(1))return trim(Array.from({length:3},(_,i)=>{const row=trim([r.uint(1)?1:null,...structuredClone((book.mods[i]??[]).slice(1))]);return row.length?row:null;}));
  const mods=[];
  for(let i=0;i<3;i++){
    const active=r.uint(1)?1:null,kind=r.uint(2);if(kind===3)throw invalid();
    const tail=kind===0?[]:kind===1?structuredClone((book.mods[i]??[]).slice(1)):read();
    if(!Array.isArray(tail)||tail.length>(i?2:1))throw invalid();
    const row=trim([active,...tail]);mods.push(row.length?row:null);
  }
  return trim(mods);
}
function writePoints(w,write,points){
  const exact=points.every(p=>p.every(n=>Math.round(n*100)/100===n));
  w.uint(exact?1:0,1);
  if(!exact){write(points);return;}
  w.golomb(points.length-1);
  const previous=[0,0],values=[];
  for(const point of points)point.forEach((n,i)=>{const v=Math.round(n*100);values.push(zig(v-previous[i]));previous[i]=v;});
  let order=0,cost=Infinity;
  for(let k=0;k<32;k++){
    const size=values.reduce((sum,n)=>sum+2*Math.floor(Math.log2(n+2**k))+1-k,0);
    if(size<cost){cost=size;order=k;}
  }
  w.uint(order,5);for(const n of values)w.golomb(n,order);
}
function readPoints(r,read){
  if(!r.uint(1))return read();
  const length=r.golomb()+1,order=r.uint(5);
  if(length>5000||length>Math.floor(r.remaining/2))throw invalid();
  const previous=[0,0],points=[];
  for(let i=0;i<length;i++){
    const point=[];for(let axis=0;axis<2;axis++){
      previous[axis]+=unzig(r.golomb(order));
      if(!Number.isSafeInteger(previous[axis]))throw invalid();point.push(previous[axis]/100);
    }
    points.push(point);
  }
  return points;
}
function writeDrawings(w,write,drawings,book){
  w.golomb(drawings.length);let map=book.maps[0];const colors=[...drawingColors];
  for(const row of drawings){
    w.uint(row[0]===map?0:1,1);
    if(row[0]!==map){const index=book.maps.indexOf(row[0])+1;w.golomb(index);if(!index)write(row[0]);map=row[0];}
    w.uint(row[1],2);writePoints(w,write,row[2]);
    w.uint((row[3]??null)===colors[row[1]]?0:1,1);if((row[3]??null)!==colors[row[1]]){colors[row[1]]=row[3]??null;write(colors[row[1]]);}
    let mask=0;for(let i=4;i<7;i++)if(row[i]!=null)mask|=1<<(i-4);
    w.uint(mask,3);for(let i=4;i<7;i++)if(mask&(1<<(i-4)))write(row[i]);
  }
}
function readDrawings(r,read,book){
  const count=r.golomb();if(count>10000||count>r.remaining)throw invalid();
  let map=book.maps[0],expanded=0;const drawings=[],colors=[...drawingColors];
  for(let i=0;i<count;i++){
    if(r.uint(1)){const index=r.golomb();if(index>book.maps.length)throw invalid();map=index?book.maps[index-1]:read();}
    const kind=r.uint(2),points=readPoints(r,read);
    if(r.uint(1))colors[kind]=read();
    const mask=r.uint(3),row=[map,kind,points,colors[kind]];
    for(let j=0;j<3;j++)row.push(mask&(1<<j)?read():null);
    trim(row);expanded+=new TextEncoder().encode(JSON.stringify(row)).length;
    if(expanded>LIMIT)throw new Error('Route is too large (maximum 3 MB).');
    drawings.push(row);
  }
  return drawings;
}

function append(w,source){const bytes=source.bytes();for(let i=0;i<source.length;i++)w.uint((bytes[i>>3]>>(7-i%8))&1,1);}
function writeSelection(w,tokens,dictionary){
  const ordinary=new Writer();writeMembers(ordinary,tokens);
  const members=placementsOf(tokens,dictionary),sorted=[...members].sort((a,b)=>a-b),set=new Writer();
  set.golomb(sorted.length);let previous=-1;
  for(const id of sorted){set.golomb(id-previous-1);previous=id;}
  writeOrder(set,members);
  const compact=set.length<ordinary.length;w.uint(compact?1:0,1);append(w,compact?set:ordinary);
}
function readSelection(r){
  if(!r.uint(1))return readMembers(r);
  const count=r.golomb();if(count>10000||count>r.remaining)throw invalid();
  const members=[];let previous=-1;
  for(let i=0;i<count;i++){previous+=r.golomb()+1;if(!Number.isSafeInteger(previous))throw invalid();members.push(previous);}
  return readOrder(r,members);
}

function encode(payload,dictionary,bookIndex,dungeonIndex,mode){
  const book=routeCodebooks[bookIndex].dungeons[dungeonIndex],w=new Writer(),write=metadataWriter(w);
  w.golomb(bookIndex);w.golomb(dungeonIndex);writeName(w,write,payload[3],book);
  const pulls=payload[4],placements=pulls.map(row=>placementsOf(row[0],dictionary));
  w.golomb(pulls.length);w.uint(Math.min(mode,3),2);
  if(mode===1)writeAssignments(w,placements);
  if(mode===2)writeCombinations(w,placements,book.size);
  if(mode>=3){w.uint(mode===4?1:0,1);if(mode===4)writeRemainingGroups(w,placements,book);else writeGroups(w,placements,book);}
  for(let i=0;i<pulls.length;i++){
    if(mode===0)writeMembers(w,pulls[i][0]);else writeOrder(w,placements[i]);
  }
  writePullMetadata(w,write,pulls);
  const length=payload.length-5;w.uint(length,3);
  let mask=0;for(let i=0;i<length;i++)if(payload[i+5]!=null)mask|=1<<i;
  w.uint(mask,length);
  for(let i=0;i<length;i++)if(mask&(1<<i)){
    const value=payload[i+5];
    if(i===0)writeDrawings(w,write,value,book);
    else if(i===1||i===6)writeSelection(w,value,dictionary);
    else if(i===2)writeMods(w,write,value,book);
    else if(i===3){if(value!==1)throw invalid();}
    else if(i===5){const small=Number.isInteger(value)&&value>=0&&value<128;w.uint(small?1:0,1);if(small)w.uint(value,7);else write(value);}
    else write(value);
  }
  return w.bytes();
}
// Return candidates so the caller compares actual URL sizes after compression,
// rather than assuming the smallest raw representation compresses best.
export function denseRouteCandidates(payload,dictionary){
  const bookIndex=routeCodebooks.findIndex(book=>book.build===payload[1]);
  if(bookIndex<0||!dictionary)return [];
  const dungeonIndex=routeCodebooks[bookIndex].dungeons.findIndex(d=>d.id===payload[0]);
  if(dungeonIndex<0)return [];
  const book=routeCodebooks[bookIndex].dungeons[dungeonIndex];
  const modes=[0,1];
  if(book.size<=MAX_MEMBERS&&payload[4].every(row=>placementsOf(row[0],dictionary).every(id=>id<book.size)))modes.push(2,3,4);
  return modes.map(mode=>encode(payload,dictionary,bookIndex,dungeonIndex,mode));
}
export function decodeDenseRoute(bytes){
  if(bytes.length>LIMIT)throw invalid();
  const r=new Reader(bytes),bookIndex=r.golomb(),dungeonIndex=r.golomb();
  const root=routeCodebooks[bookIndex],book=root?.dungeons[dungeonIndex];
  if(!book)throw new Error('Unknown route codebook. Update the planner to import this route.');
  const read=metadataReader(r),name=readName(r,read,book),count=r.golomb(),mode=r.uint(2);
  if(typeof name!=='string'||count>10000||count>r.remaining)throw invalid();
  if(mode>=2&&book.size>MAX_MEMBERS)throw invalid();
  const assignments=mode===1?readAssignments(r,count):mode===2?readCombinations(r,count,book.size):mode===3?(r.uint(1)?readRemainingGroups:readGroups)(r,count,book):null;
  const pulls=[];let total=0;
  for(let i=0;i<count;i++){
    const members=assignments?readOrder(r,assignments[i]):readMembers(r);total+=members.length;
    if(total>10000)throw invalid();pulls.push([members]);
  }
  readPullMetadata(r,read,pulls);
  const length=r.uint(3),mask=r.uint(length),tail=[];
  for(let i=0;i<length;i++){
    if(!(mask&(1<<i))){tail.push(null);continue;}
    tail.push(i===0?readDrawings(r,read,book):i===1||i===6?readSelection(r):i===2?readMods(r,read,book):i===3?1:i===5&&r.uint(1)?r.uint(7):read());
  }
  r.end();const payload=[book.id,root.build,'m1',name,pulls,...tail];
  if(new TextEncoder().encode(JSON.stringify(payload)).length>LIMIT)throw new Error('Route is too large (maximum 3 MB).');
  return payload;
}
