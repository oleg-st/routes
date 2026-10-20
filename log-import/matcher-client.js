// Keep matching off the UI thread; cancellation terminates CPU work immediately.
export function runLogMatching(log,{signal,onProgress,...options}){
  return runWorker({log,options},{signal,onProgress});
}
export function runPriorityDetection(log,state,options={}){
  return runWorker({task:'priority',log,state},options);
}
function runWorker(data,{signal,onProgress}){
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const workerURL=typeof __SITE_MATCHER_URL__==='undefined'?'log-import/matcher-worker.js':__SITE_MATCHER_URL__;
    const worker=new Worker(new URL(workerURL,document.baseURI),{type:'module'});
    const finish=(error,result)=>{worker.terminate();signal?.removeEventListener('abort',abort);clearTimeout(timeout);error?reject(error):resolve(result);};
    const abort=()=>finish(new DOMException('Import cancelled.','AbortError'));
    const timeout=setTimeout(()=>finish(Object.assign(new Error('Matching took too long. No route was created.'),{diagnostics:{code:'matching-timeout'}})),120000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.progress)onProgress?.(data.progress);else finish(data.error?Object.assign(new Error(data.error),{diagnostics:data.diagnostics}):null,data.result);};
    worker.onerror=()=>finish(new Error('Unable to start route matching. Reload the page and try again.'));
    worker.postMessage(data);
  });
}
