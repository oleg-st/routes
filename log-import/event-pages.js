// Keep API pages intact: same-timestamp events can be distinct valid records.
export async function collectEventPages({fetchPage,startTime,endTime,maxPages=100,onPage=()=>{},signal}){
  const result={startTime,endTime,pages:[],eventCount:0,complete:false,nextPageTimestamp:startTime};
  let cursor=startTime;
  try{
    if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime>endTime)throw new Error('Invalid event time range.');
    for(let index=0;index<maxPages;index++){
      if(signal?.aborted)throw new Error('Event download cancelled.');
      const page=await fetchPage(cursor,endTime);
      if(!page||!Array.isArray(page.data))throw new Error('API returned an invalid event page.');
      result.pages.push({requestedStartTime:cursor,data:page.data,nextPageTimestamp:page.nextPageTimestamp});
      result.eventCount+=page.data.length;
      result.nextPageTimestamp=page.nextPageTimestamp;
      onPage(result);
      // A missing cursor is not treated as successful exhaustion.
      if(!Object.hasOwn(page,'nextPageTimestamp'))throw new Error('API omitted its pagination cursor.');
      if(page.nextPageTimestamp===null){result.complete=true;return result;}
      if(!Number.isFinite(page.nextPageTimestamp)||page.nextPageTimestamp<=cursor||page.nextPageTimestamp>endTime)throw new Error('API returned an invalid or non-advancing event cursor.');
      cursor=page.nextPageTimestamp;
    }
    throw new Error(`Stopped at the ${maxPages}-page research limit; event data is incomplete.`);
  }catch(error){result.error=error.message;return result;}
}

export function summarizeEventStream(stream){
  const types={},fields=new Set();
  for(const page of stream.pages)for(const event of page.data){
    if(!event||typeof event!=='object')continue;
    const name=String(event.type??'(no type)');
    const row=types[name]??={count:0,samples:[]};row.count++;
    if(row.samples.length<2)row.samples.push(event);
    for(const key of Object.keys(event))fields.add(key);
  }
  return {hostility:stream.hostility,eventCount:stream.eventCount,pageCount:stream.pages.length,complete:stream.complete,
    nextPageTimestamp:stream.nextPageTimestamp,error:stream.error,fields:[...fields].sort(),types};
}
