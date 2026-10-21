import {beginAuthorization,consumeCallback,exchangeCode} from './oauth.js';
import {parseReportURL} from './report-url.js';
import {loadLog,loadReportFights} from './live-api.js';
import {runLogMatching} from './matcher-client.js';
import {correctDungeon} from '../data/placement-corrections.js';
import {matchingConfig} from './matching-config.js';
import {recoverableMatchingProblems,routeImportIssues} from './import-issues.js';
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
export function createLiveImport({data,dungeonData,persist,callback,storage=sessionStorage,location=window.location,matchLog=runLogMatching}){
  let token=null,diagnostics=null,recoveryResult=null;
  const canContinue=()=>Boolean(recoveryResult);
  const canFindMissing=()=>Boolean(diagnostics?.log.complete&&diagnostics.matching&&!diagnostics.recovery&&!diagnostics.expandedSearch&&diagnostics.details?.code==='no-compatible-route');
  const markExpanded=(result,search)=>({...result,expandedSearch:search,assumption:[
    `Additional search near confirmed pulled packs (radius ${search.maxRadius}). Nearby packs may not have been pulled.`,
    result.matching.aggroRadius>matchingConfig.aggroRadius?
      `Approach radius increased from ${matchingConfig.aggroRadius} to ${result.matching.aggroRadius} for this recovery. Review the additional packs.`:null,
    result.assumption].filter(Boolean).join(' ')});
  function prepareResult(saved,result,code){
    saved.importIssues=routeImportIssues(result,code);
    saved.skippedRelics=result.skippedRelics;
    saved.recoveryPreview=result.partial;
    recoveryResult=saved.importIssues.length?result:null;
    return recoveryResult?null:result;
  }
  async function prepareRecovery(saved,options,neighborRadius=0){
    recoveryResult=null;
    try{
      const result=await matchLog(saved.log,{...options,...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e])),allowPartial:true,neighborRadius});
      options?.signal?.throwIfAborted();
      prepareResult(saved,neighborRadius?markExpanded(result,saved.expandedSearch):result,saved.expandedSearch?.details?.code??saved.details?.code);
    }catch(error){
      if(options?.signal?.aborted)throw error;
      saved.recoveryError=error.message;
    }
  }
  return {
    connected:()=>Boolean(token),
    disconnect(){token=null;diagnostics=null;recoveryResult=null;},
    cancelImport(){diagnostics=null;recoveryResult=null;},
    diagnostics:()=>diagnostics,
    canContinue,
    canFindMissing,
    issues:()=>canContinue()?diagnostics.importIssues:[],
    missingEnemies:()=>diagnostics?.recoveryPreview?.skipped??null,
    async expandSearch(url,options){
      const selection=parseReportURL(url),saved=diagnostics,maxRadius=6000;
      if(!canFindMissing()||selection.reportCode!==saved.log.reportCode||selection.fightID!==saved.log.fight.id)throw new Error('Import this log first before searching for missing enemies.');
      if(dungeonData()!==saved.matching.dungeonData)throw new Error('Dungeon data changed. Import the log again.');
      recoveryResult=null;
      try{
        const result=await matchLog(saved.log,{...options,...saved.matching,catalog:new Map(saved.matching.catalog.map(e=>[e.id,e])),
          neighborRadius:maxRadius,adaptiveRadius:true});
        options?.signal?.throwIfAborted();
        saved.expandedSearch={maxRadius,matching:result.matching,neighborHypotheses:result.neighborHypotheses};
        return prepareResult(saved,markExpanded(result,saved.expandedSearch));
      }catch(error){
        if(options?.signal?.aborted)throw error;
        saved.expandedSearch={maxRadius,error:error.message,details:error.diagnostics};
        const config={...matchingConfig,...options?.config,aggroRadius:error.diagnostics?.aggroRadius??options?.config?.aggroRadius??matchingConfig.aggroRadius};
        if(recoverableMatchingProblems[error.diagnostics?.code])await prepareRecovery(saved,{...options,config},maxRadius);
        if(!canContinue())throw error;
        return null;
      }
    },
    async continueImport(url,options){
      const selection=parseReportURL(url),saved=diagnostics;
      if(!canContinue()||selection.reportCode!==saved.log.reportCode||selection.fightID!==saved.log.fight.id)throw new Error('Import this log first before continuing after an error.');
      if(dungeonData()!==saved.matching.dungeonData)throw new Error('Dungeon data changed. Import the log again.');
      options?.signal?.throwIfAborted();
      const result=recoveryResult;
      saved.recovery=result.partial;saved.acceptedIssues=saved.importIssues;recoveryResult=null;
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
      const mode=dungeonData();let dungeon,loadedLog,matchingOptions;diagnostics=null;recoveryResult=null;
      try{
        const log=await loadLog(url,{...options,token,validateFight(fight){
          const raw=data.dungeons.find(d=>d.name===fight.name);
          if(!raw)throw new Error('This dungeon is not available in the selected game data.');
          dungeon=raw;
        }});
        dungeon=correctDungeon(data.loadDungeon?await data.loadDungeon(dungeon.id):dungeon,mode);
        options?.signal?.throwIfAborted();
        loadedLog=log;
        matchingOptions={dungeon,dungeonData:mode,catalog:data.enemies,presets:data['modifier-placements'].dungeons[dungeon.id]};
        const result=await matchLog(log,{...options,...matchingOptions,catalog:new Map(data.enemies.map(e=>[e.id,e]))});
        options?.signal?.throwIfAborted();
        diagnostics={version:1,buildId:data.manifest?.buildId,log:loadedLog,matching:matchingOptions,...(result.skippedRelics?{skippedRelics:result.skippedRelics}:{})};
        return prepareResult(diagnostics,result);
      }catch(error){
        if(error.status===401)token=null;
        // Only compact game events and matching inputs; never credentials, API
        // responses, browser storage or OAuth parameters. Keep the last import in memory.
        if(loadedLog&&!options?.signal?.aborted){
          diagnostics={version:1,buildId:data.manifest?.buildId,error:error.message,details:error.diagnostics,log:loadedLog,matching:matchingOptions};
          if(recoverableMatchingProblems[error.diagnostics?.code])await prepareRecovery(diagnostics,options);
          if(canContinue())return null;
        }
        throw error;
      }
    }
  };
}
