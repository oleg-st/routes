import {matchLiveLog} from './live-matcher.js';
import {detectSelectedRoutePriority} from './priority-targets.js';
self.onmessage=async({data})=>{
  try{
    const result=data.task==='priority'?detectSelectedRoutePriority(data.log,data.state):
      await matchLiveLog(data.log,{...data.options,onProgress:message=>self.postMessage({progress:message})});
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message,diagnostics:error.diagnostics});}
};
