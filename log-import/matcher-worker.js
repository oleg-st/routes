import {matchLiveLog} from './live-matcher.js';
self.onmessage=async({data})=>{
  try{
    const result=await matchLiveLog(data.log,{...data.options,onProgress:message=>self.postMessage({progress:message})});
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message,diagnostics:error.diagnostics});}
};
