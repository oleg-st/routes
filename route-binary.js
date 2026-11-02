// R5 generic binary profile of the R3 tuple schema. Keep permanent member tokens
// and their order, including whole packs; no game data is embedded in the link.
const LIMIT=3_000_000,MAX=0xffffffff,MAX_MEMBERS=10000;
const invalid=()=>new Error('Invalid binary route.');
// Generic profile wire IDs: never reorder or reuse these entries across builds.
// Unknown/future dungeons use ID zero followed by their full name.
const DUNGEONS=['DesertDunes','ElfMines','FrozenKingdom','MoorCastle','NightPatrol','PirateRaid',
  'SnowPeak','SpiderForest','TreeVillage','UrrakMarkets','SandTomb'];
const initialStrings=id=>['New route','Imported route',`Level.ID.${id}:T_${id}_Global`];
const zig=n=>n<0?-2*n-1:2*n;
const unzig=n=>n%2?-(n+1)/2:n/2;
const bits=(n,k=0)=>2*Math.floor(Math.log2(n+2**k))+1-k;

class Writer{
  data=[];length=0;
  uint(n,width){
    for(let i=width-1;i>=0;i--){
      const offset=this.length++;
      if(offset%8===0){if(this.data.length>=LIMIT)throw new Error('Route is too large (maximum 3 MB).');this.data.push(0);}
      if(Math.floor(n/2**i)%2)this.data[offset>>3]|=128>>(offset%8);
    }
  }
  golomb(n,k=0){
    if(!Number.isSafeInteger(n)||n<0||n>MAX)throw invalid();
    const value=n+2**k,width=Math.floor(Math.log2(value))+1;
    this.uint(0,width-k-1);this.uint(value,width);
  }
  bytes(){return Uint8Array.from(this.data);}
  align(){this.uint(0,(8-this.length%8)%8);}
}
class Reader{
  position=0;
  constructor(data){this.data=data;}
  get remaining(){return this.data.length*8-this.position;}
  uint(width){
    if(width>this.remaining)throw invalid();
    let n=0;
    for(let i=0;i<width;i++){const offset=this.position++;n=n*2+((this.data[offset>>3]>>(7-offset%8))&1);}
    return n;
  }
  golomb(k=0){
    let zeros=0;
    while(!this.uint(1))if(++zeros>32)throw invalid();
    const n=2**(zeros+k)+this.uint(zeros+k)-2**k;
    if(n>MAX)throw invalid();
    return n;
  }
  end(){if(this.remaining>=8||this.uint(this.remaining)!==0)throw invalid();}
  align(){if(this.uint((8-this.position%8)%8)!==0)throw invalid();}
}

// Signed deltas use an adaptive Exp-Golomb order. Unlike sorting the members,
// this also preserves arbitrary selection order and mixed pack/placement tokens.
function writeMembers(writer,values){
  writer.golomb(values.length);
  if(!values.length)return;
  let previous=0;
  const deltas=values.map(value=>{const delta=zig(value-previous);previous=value;return delta;});
  let order=0,cost=Infinity;
  for(let k=0;k<16;k++){
    const size=deltas.reduce((sum,n)=>sum+bits(n,k),0);
    if(size<cost){cost=size;order=k;}
  }
  writer.uint(order,4);
  for(const delta of deltas)writer.golomb(delta,order);
}
function readMembers(reader){
  const length=reader.golomb();
  if(length>MAX_MEMBERS||length>reader.remaining)throw invalid();
  if(!length)return [];
  const order=reader.uint(4),values=[];
  let previous=0;
  for(let i=0;i<length;i++){
    previous+=unzig(reader.golomb(order));
    if(!Number.isSafeInteger(previous))throw invalid();
    values.push(previous);
  }
  return values;
}

// Metadata tags: null, signed integer, hundredths, UTF-8, string reference,
// array, float64, RGB. Exact float64 fallback preserves legacy geometry at the bounds.
// Repeated strings share dictionary references; byte alignment also lets
// optional DEFLATE compress common substrings in names and notes.
function metadataWriter(writer,initial=[]){
  const strings=new Map(initial.map((value,index)=>[value,index])),encoder=new TextEncoder();
  return function write(value,depth=0){
    if(depth>32)throw invalid();
    if(value==null){writer.uint(0,3);return;}
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw invalid();
      if(Number.isInteger(value)&&zig(value)<=MAX){writer.uint(1,3);writer.golomb(zig(value));}
      else if(Math.round(value*100)/100===value&&zig(Math.round(value*100))<=MAX){writer.uint(2,3);writer.golomb(zig(Math.round(value*100)),8);}
      else{writer.uint(6,3);writer.align();const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value);for(const byte of bytes)writer.uint(byte,8);}
      return;
    }
    if(typeof value==='string'){
      if(/^#[0-9a-f]{6}$/.test(value)){writer.uint(7,3);writer.uint(parseInt(value.slice(1),16),24);return;}
      if(strings.has(value)){writer.uint(4,3);writer.golomb(strings.get(value));return;}
      const bytes=encoder.encode(value);strings.set(value,strings.size);
      writer.uint(3,3);writer.golomb(bytes.length);writer.align();for(const byte of bytes)writer.uint(byte,8);
      return;
    }
    if(!Array.isArray(value))throw invalid();
    writer.uint(5,3);writer.golomb(value.length);
    for(const entry of value)write(entry,depth+1);
  };
}
function metadataReader(reader,initial=[]){
  const strings=[...initial],decoder=new TextDecoder('utf-8',{fatal:true});
  let budget=LIMIT;
  return function read(depth=0){
    if(depth>32||--budget<0)throw invalid();
    switch(reader.uint(3)){
      case 0:return null;
      case 1:return unzig(reader.golomb());
      case 2:return unzig(reader.golomb(8))/100;
      case 3:{
        const length=reader.golomb();reader.align();
        if(length>Math.floor(reader.remaining/8)||length>budget)throw invalid();
        budget-=length;
        const bytes=new Uint8Array(length);
        for(let i=0;i<length;i++)bytes[i]=reader.uint(8);
        const value=decoder.decode(bytes);strings.push(value);return value;
      }
      case 4:{const index=reader.golomb();if(index>=strings.length)throw invalid();const value=strings[index];budget-=value.length;if(budget<0)throw invalid();return value;}
      case 5:{
        const length=reader.golomb();
        if(length>Math.floor(reader.remaining/3)||length>budget)throw invalid();
        return Array.from({length},()=>read(depth+1));
      }
      case 6:{reader.align();const bytes=new Uint8Array(8);for(let i=0;i<8;i++)bytes[i]=reader.uint(8);const value=new DataView(bytes.buffer).getFloat64(0);if(!Number.isFinite(value))throw invalid();return value;}
      case 7:return '#'+reader.uint(24).toString(16).padStart(6,'0');
      default:throw invalid();
    }
  };
}

function placementsOf(tokens,dictionary){
  return tokens.flatMap(token=>token<0?[-token-1]:dictionary.packs[token].members);
}
function writeAssignments(writer,pulls){
  const entries=pulls.flatMap((members,pull)=>members.map(id=>({id,pull}))).sort((a,b)=>a.id-b.id);
  if(new Set(entries.map(e=>e.id)).size!==entries.length)throw invalid();
  writer.golomb(entries.length);
  const width=Math.ceil(Math.log2(pulls.length||1));
  let previous=-1;
  for(const {id,pull} of entries){writer.golomb(id-previous-1);writer.uint(pull,width);previous=id;}
}
function readAssignments(reader,count){
  const length=reader.golomb(),width=Math.ceil(Math.log2(count||1));
  if(length>MAX_MEMBERS||length>Math.floor(reader.remaining/(width+1))||length&&!count)throw invalid();
  const pulls=Array.from({length:count},()=>[]);
  let previous=-1;
  for(let i=0;i<length;i++){
    previous+=reader.golomb()+1;
    const pull=reader.uint(width);
    if(pull>=count||!Number.isSafeInteger(previous))throw invalid();
    pulls[pull].push(previous);
  }
  return pulls;
}
// Most selections already follow placement order. Store only deviations using
// ranks among the remaining members, so even an out-of-order mob is lossless.
function writeOrder(writer,members){
  const remaining=[...members].sort((a,b)=>a-b),changes=[];
  members.forEach((id,position)=>{const rank=remaining.indexOf(id);if(rank)changes.push([position,rank]);remaining.splice(rank,1);});
  writer.golomb(changes.length);
  let previous=-1;
  for(const [position,rank] of changes){writer.golomb(position-previous-1);writer.golomb(rank-1);previous=position;}
}
function readOrder(reader,members){
  const count=reader.golomb();
  if(count>members.length||count>Math.floor(reader.remaining/2))throw invalid();
  const changes=new Map();let previous=-1;
  for(let i=0;i<count;i++){
    previous+=reader.golomb()+1;
    const rank=reader.golomb()+1;
    if(previous>=members.length||rank>=members.length-previous)throw invalid();
    changes.set(previous,rank);
  }
  const remaining=[...members];
  return members.map((_,position)=>-remaining.splice(changes.get(position)??0,1)[0]-1);
}

function encodePayload(payload,dictionary,assignments){
  const writer=new Writer(),id=DUNGEONS.indexOf(payload[0])+1;
  writer.golomb(id);
  if(!id)metadataWriter(writer)(payload[0]);
  const numericBuild=/^(0|[1-9]\d*)$/.test(payload[1])&&Number(payload[1])<=MAX;
  writer.uint(numericBuild?1:0,1);
  if(numericBuild)writer.golomb(Number(payload[1]),16);else metadataWriter(writer)(payload[1]);
  const write=metadataWriter(writer,initialStrings(payload[0]));
  // m1 is implicit in R5. Build identity remains explicit and is checked on import.
  write(payload[3]);
  writer.golomb(payload[4].length);
  writer.uint(assignments?1:0,1);
  const placements=assignments?payload[4].map(row=>placementsOf(row[0],dictionary)):null;
  if(assignments)writeAssignments(writer,placements);
  payload[4].forEach(([members,...metadata],index)=>{
    if(assignments)writeOrder(writer,placements[index]);else writeMembers(writer,members);
    write(metadata);
  });
  write(payload.slice(5));
  return writer.bytes();
}
export function encodeBinaryRoute(payload,dictionary){
  const tokens=encodePayload(payload,dictionary,false);
  if(!dictionary)return tokens;
  const assignments=encodePayload(payload,dictionary,true);
  return assignments.length<tokens.length?assignments:tokens;
}
export function decodeBinaryRoute(bytes){
  if(bytes.length>LIMIT)throw new Error('Route is too large (maximum 3 MB).');
  const reader=new Reader(bytes),number=reader.golomb();
  if(number>DUNGEONS.length)throw invalid();
  const id=number?DUNGEONS[number-1]:metadataReader(reader)();
  const build=reader.uint(1)?String(reader.golomb(16)):metadataReader(reader)();
  const read=metadataReader(reader,initialStrings(id)),name=read(),length=reader.golomb();
  if(typeof id!=='string'||typeof build!=='string'||typeof name!=='string'||length>10000||length>reader.remaining)throw invalid();
  const assignments=reader.uint(1)?readAssignments(reader,length):null;
  const pulls=[];let totalMembers=0;
  for(let i=0;i<length;i++){
    const members=assignments?readOrder(reader,assignments[i]):readMembers(reader),metadata=read();
    totalMembers+=members.length;
    if(totalMembers>MAX_MEMBERS)throw invalid();
    if(!Array.isArray(metadata)||metadata.length>4)throw invalid();
    pulls.push([members,...metadata]);
  }
  const tail=read();
  if(!Array.isArray(tail)||tail.length>7)throw invalid();
  reader.end();
  const payload=[id,build,'m1',name,pulls,...tail];
  if(new TextEncoder().encode(JSON.stringify(payload)).length>LIMIT)throw new Error('Route is too large (maximum 3 MB).');
  return payload;
}

// Mechanics shared with R5's dense profile.
export const binaryIO={Writer,Reader,metadataWriter,metadataReader,writeMembers,readMembers,
  writeAssignments,readAssignments,writeOrder,readOrder,placementsOf};
