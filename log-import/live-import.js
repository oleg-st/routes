import {beginAuthorization,consumeCallback,exchangeCode} from './oauth.js';
import {parseReportURL} from './report-url.js';
import {loadLog,loadReportFights} from './live-api.js';
import {runLogMatching} from './matcher-client.js';
import {correctDungeon} from '../data/placement-corrections.js';
const pendingKey='fellowship-route-import-pending';

// Called at app startup, before any navigation or room connection. The code is
// single-use and is removed from the address bar even if state validation fails.
export function captureLogCallback(location,history,storage){
  const params=new URLSearchParams(location.search);
  if(!params.has('code')&&!params.has('error'))return null;
  let result;
  try{result={callback:consumeCallback(location.search,storage),pending:JSON.parse(storage.getItem(pendingKey))};}
  catch(error){result={error};}
  finally{
    storage.removeItem(pendingKey);
    for(const key of ['code','state','error','error_description','error_uri'])params.delete(key);
    history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);
  }
  return result;
}
export function createLiveImport({data,dungeonData,persist,callback,storage=sessionStorage,location=window.location}){
  let token=null,diagnostics=null;
  const canContinue=()=>Boolean(diagnostics?.log.complete&&diagnostics.matching&&!diagnostics.recovery&&['no-compatible-route','unknown-chicken-target','matching-limit','matching-timeout'].includes(diagnostics.details?.code));
  return {
    connected:()=>Boolean(token),
    disconnect(){token=null;diagnostics=null;},
    diagnostics:()=>diagnostics,
    canContinue,
    async continueImport(url,options){
      const selection=parseReportURL(url),saved=diagnostics;
      if(!canContinue()||selection.reportCode!==saved.log.reportCode||selection.fightID!==saved.log.fight.id)throw new Error('Import this log first before continuing after an error.');
      if(dungeonData()!==saved.matching.dungeonData)throw new Error('Dungeon data changed. Import the log again.');
      const result=await runLogMatching(saved.log,{...options,...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e])),allowPartial:true});
      options?.signal?.throwIfAborted();saved.recovery=result.partial;
      return result;
    },
    async connect(url,{signal}={}){
      parseReportURL(url,{requireFight:false});await persist();signal?.throwIfAborted();
      const redirectURI=new URL('.',location.href).href;
      const authorize=await beginAuthorization(storage,Date.now(),redirectURI);
      signal?.throwIfAborted();
      storage.setItem(pendingKey,JSON.stringify({url,dungeonData:dungeonData()}));
      location.assign(authorize);
    },
    async resume(){
      if(!callback)return null;
      const captured=callback;callback=null;
      if(captured.error)throw captured.error;
      token=await exchangeCode(captured.callback);
      if(captured.pending?.dungeonData!==dungeonData())throw new Error('Dungeon data changed during login. Open Import from log again.');
      return captured.pending?.url??null;
    },
    async fights(url,options){
      if(!token)throw new Error('Connect to Fellowship Logs first.');
      try{return await loadReportFights(url,{...options,token});}
      catch(error){if(error.status===401)token=null;throw error;}
    },
    async load(url,options){
      if(!token)throw new Error('Connect to Fellowship Logs first.');
      const mode=dungeonData();let dungeon,loadedLog,matchingOptions;diagnostics=null;
      try{
        const log=await loadLog(url,{...options,token,validateFight(fight){
          const raw=data.dungeons.find(d=>d.name===fight.name);
          if(!raw)throw new Error('This dungeon is not available in the selected game data.');
          dungeon=correctDungeon(raw,mode);
        }});
        loadedLog=log;
        matchingOptions={dungeon,dungeonData:mode,catalog:data.enemies,presets:data['modifier-placements'].dungeons[dungeon.id]};
        const result=await runLogMatching(log,{...options,...matchingOptions,catalog:new Map(data.enemies.map(e=>[e.id,e]))});
        options?.signal?.throwIfAborted();
        diagnostics={version:1,buildId:data.manifest?.buildId,log:loadedLog,matching:matchingOptions};
        return result;
      }catch(error){
        if(error.status===401)token=null;
        // Only compact game events and matching inputs; never credentials, API
        // responses, browser storage or OAuth parameters. Keep the last import in memory.
        if(loadedLog&&!options?.signal?.aborted)diagnostics={version:1,buildId:data.manifest?.buildId,error:error.message,details:error.diagnostics,log:loadedLog,matching:matchingOptions};
        throw error;
      }
    }
  };
}
