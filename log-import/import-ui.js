import {movementPlayerColor} from './movement-trail.js';
import {createReviewSession} from './review-session.js';
import {parseReportURL} from './report-url.js';
import {fightLabel} from './fight-label.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fightStatus=f=>f?.inProgress?'progress':f?.kill===true?'clear':f?.kill===false?'wipe':'unknown';
const proximityLabel=o=>{
  if(!o.proximity)return '';
  const p=o.proximity,low=Math.round(p.minDistance),high=Math.round(p.maxDistance);
  if(p.basis==='neighbor')return `Possible neighbor · Pack distance: ≈${low===high?low:`${low}–${high}`} · from ${p.sources.join(' / ')}`;
  return `${o.closestToPath?'Closest to path · ':''}${p.estimated?'Estimated across log gap · ':''}Path distance: ≈${low===high?low:`${low}–${high}`} · ${p.sources.join(' / ')}${p.patrol?' · patrol path':''}`;
};
export function createLogImportUI({panel,showDialog,closeDialog,preview,commit,cancel,highlight,focus,frame,describe,onError,live,movement,heroes=[]}){
  let fixture,session,busy=false,lastURL='',lastReport=null,lastFightID=null;
  let movementVisible=true;
  const invoke=fn=>async(...args)=>{
    if(busy)return;busy=true;
    try{await fn(...args);}catch(error){onError(error.message);}finally{busy=false;}
  };
  const ids=groups=>groups.flatMap(id=>fixture.groups[id].enemies);
  async function chooseOption(id){
    session.choose(id);highlight([]);await advance();
  }
  function hide(){highlight([]);panel.hidden=true;panel.replaceChildren();session=null;}
  async function advance(){
    await preview(fixture,session.state());
    movement?.(movementVisible);
    closeDialog();
    if(!session.state().complete){draw();return;}
    try{await commit();hide();if(fixture.partial)onError(fixture.assumption);}catch(error){draw();throw error;}
  }
  function draw(){
    const s=session.state();panel.hidden=false;
    // The same pack can have different Chicken/Empowered assignments across
    // compatible routes. Show those differences instead of identical cards.
    const modifiers=[['excluded','Chickenized'],['empowered','Empowered']]
      .filter(([key])=>s.options.some(o=>o.groups.some(id=>fixture.groups[id][key]?.length)));
    const modifierDetails=o=>o.groups.length?modifiers.map(([key,label])=>{
      const members=o.groups.flatMap(id=>fixture.groups[id][key]??[]);
      return `<small>${esc(label)}: ${esc(members.length?describe(members):'None')}</small>`;
    }).join(''):'';
    panel.innerHTML=`<div class="log-review-heading"><span class="eyebrow">IMPORT FROM LOG</span><div class="log-review-actions">${s.canBack?'<button data-log-back>← Back</button>':''}<button data-log-cancel>Cancel import</button></div></div>
      <div class="log-review-prompt" role="status" aria-live="polite"><span class="log-review-step">Pull ${s.pullIndex+1}</span><div><strong>${s.complete?'Could not save the imported route':'Choose a pack to add'}</strong><span>${s.complete?'Retry saving or cancel the import.':`${s.remaining} compatible routes remain · Select an option below or click its enemy on the map`}</span></div></div>
      ${fixture.assumption?`<p class="muted">${esc(fixture.assumption)}</p>`:''}
      ${fixture.movementTrail?.players.length?`<div class="log-review-actions"><label title="Approximate recorded movement for the approach and this pull. Dotted lines connect sparse samples; long gaps and teleports are omitted."><input type="checkbox" data-log-movement ${movementVisible?'checked':''}> Party movement · approximate</label><span class="log-movement-legend">${fixture.movementTrail.players.map(p=>`<span><i style="background:${movementPlayerColor(p,heroes)}"></i>${esc(p.name)}</span>`).join('')}</span></div>`:''}
      <div class="log-options">${s.options.map((o,i)=>`<div class="log-option${o.aggro?' log-option-likely':''}"><button data-log-choice="${esc(o.id)}"><span class="log-option-number">${i+1}</span><span><span class="log-option-heading"><strong>${esc(o.label)}</strong>${o.aggro?`<span class="log-aggro-badge" title="Recorded ${esc(o.aggro.sources.join(' / '))} approach before engagement: ≈${Math.round(o.aggro.distance)} / ${o.aggro.range} world units. Supported in every remaining assignment for this option. Model evidence, not a measured probability; height and line of sight are unknown.">within aggro</span>`:''}</span><small>${esc(o.groups.length?describe(ids(o.groups)):'Continue with the enemies already selected')}</small>${modifierDetails(o)}${o.proximity?`<small class="log-proximity" title="Closest approach before engagement, in world units. Estimates across log gaps and patrol paths are possible positions, not observed contact or a probability.">${esc(proximityLabel(o))}</small>`:''}</span><span class="log-option-add" aria-hidden="true">＋</span></button>${o.groups.length?`<button class="log-locate" data-log-focus="${esc(o.id)}" title="Show on map" aria-label="Show ${esc(o.label)} on map">⌖</button>`:''}</div>`).join('')}</div>
      ${s.complete?'<button class="primary" data-log-retry>Retry saving</button>':''}`;
    for(const b of panel.querySelectorAll('[data-log-choice]')){
      const option=s.options.find(o=>o.id===b.dataset.logChoice);
      b.onpointerenter=b.onfocus=()=>highlight(ids(option.groups),{excluded:option.groups.flatMap(id=>fixture.groups[id].excluded??[])});
      b.onpointerleave=b.onblur=()=>highlight([]);
      b.onclick=invoke(()=>chooseOption(option.id));
    }
    for(const b of panel.querySelectorAll('[data-log-focus]')){
      const option=s.options.find(o=>o.id===b.dataset.logFocus),modifiers={excluded:option.groups.flatMap(id=>fixture.groups[id].excluded??[])};
      b.onpointerenter=b.onfocus=()=>highlight(ids(option.groups),modifiers);
      b.onpointerleave=b.onblur=()=>highlight([]);
      b.onclick=()=>focus(ids(option.groups),modifiers);
    }
    const trail=panel.querySelector('[data-log-movement]');
    if(trail)trail.onchange=()=>{movementVisible=trail.checked;movement?.(movementVisible);};
    const back=panel.querySelector('[data-log-back]');if(back)back.onclick=invoke(async()=>{session.back();highlight([]);await preview(fixture,session.state());draw();});
    panel.querySelector('[data-log-cancel]').onclick=invoke(async()=>{await cancel();hide();});
    const retry=panel.querySelector('[data-log-retry]');if(retry)retry.onclick=invoke(async()=>{await commit();hide();});
    // The panel must be laid out first: it changes the map's visible height.
    if(!s.complete&&s.options.length)frame?.([...new Set(ids([...s.pulls.at(-1).groups,...s.options.flatMap(o=>o.groups)]))]);
  }
  const api={choosePlacement:invoke(async placementID=>{
    if(!session)return;
    const options=session.state().options.filter(o=>ids(o.groups).includes(placementID));
    if(options.length===1){await chooseOption(options[0].id);return;}
    if(!options.length)return;
    highlight([]);
    showDialog('Choose pack variant',`<div class="log-options">${options.map(o=>`<div class="log-option"><button data-log-map-choice="${esc(o.id)}"><span><strong>${esc(o.label)}</strong>${[['excluded','Chicken'],['empowered','Empowered']].map(([key,label])=>{
      const members=o.groups.flatMap(id=>fixture.groups[id][key]??[]);
      return `<small>${label}: ${esc(members.length?describe(members):'None')}</small>`;
    }).join('')}</span></button></div>`).join('')}</div>`);
    for(const b of document.querySelectorAll('[data-log-map-choice]'))b.onclick=invoke(()=>chooseOption(b.dataset.logMapChoice));
  }),open(url){
    const restoring=url===undefined;
    url??=lastURL;
    showDialog('Import from log',`<form id="log-live-form"><label for="log-url">Fellowship Logs report link</label><input id="log-url" type="url" required placeholder="https://www.fellowshiplogs.com/reports/…" value="${esc(url)}"><div id="log-fight-field" hidden><label for="log-fight">Fight</label><select id="log-fight"></select></div><div class="log-review-actions"><button class="primary" id="log-load" type="submit"></button><button id="log-stop" type="button" hidden>Cancel</button>${live.connected()?'<button id="log-disconnect" type="button">Disconnect</button>':''}</div><p id="log-live-status" role="status" aria-live="polite"></p><p id="log-live-error" role="alert" hidden></p></form>`);
    if(live){
      const form=document.getElementById('log-live-form'),input=document.getElementById('log-url'),load=document.getElementById('log-load'),stop=document.getElementById('log-stop'),status=document.getElementById('log-live-status'),error=document.getElementById('log-live-error');
      const select=document.getElementById('log-fight'),field=document.getElementById('log-fight-field');
      const diagnosticActions=document.createElement('div');diagnosticActions.className='log-review-actions';form.append(diagnosticActions);
      const download=document.createElement('button');download.type='button';download.textContent='Download import diagnostics';download.hidden=true;diagnosticActions.append(download);
      const expand=document.createElement('button');expand.id='log-expand';expand.type='button';expand.hidden=true;diagnosticActions.append(expand);
      const proceed=document.createElement('button');proceed.id='log-continue';proceed.type='button';proceed.textContent='Import without missing mobs';proceed.hidden=true;
      const dismiss=document.createElement('button');dismiss.id='log-dismiss';dismiss.type='button';dismiss.textContent='Cancel import';dismiss.hidden=true;
      diagnosticActions.append(expand,proceed,download,dismiss);
      const missing=document.createElement('div');missing.id='log-missing-enemies';missing.hidden=true;diagnosticActions.before(missing);
      download.onclick=()=>{
        const diagnostic=live.diagnostics?.();if(!diagnostic)return;
        const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`route-import-${diagnostic.log.reportCode}-${diagnostic.log.fight.id}.json`;
        link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      const dialog=form.closest('dialog');let controller,report=restoring?lastReport:null;
      const another=document.createElement('button');another.id='log-another';another.type='button';another.textContent='Choose another log';load.after(another);
      const abort=()=>controller?.abort();dialog?.addEventListener('close',abort,{once:true});
      stop.onclick=abort;
      const remember=()=>{lastURL=input.value;lastReport=report;lastFightID=report?Number(select.value):null;};
      const disconnect=document.getElementById('log-disconnect');if(disconnect)disconnect.onclick=()=>{remember();live.disconnect();api.open();};
      const selectedURL=()=>report?`https://www.fellowshiplogs.com/reports/${report.reportCode}?fight=${select.value}`:input.value.trim();
      dismiss.onclick=()=>{
        if(busy)return;
        live.cancelImport();status.textContent='';error.textContent='';error.hidden=true;
        controls();load.focus();
      };
      function controls(){
        let explicit=false;try{explicit=Boolean(parseReportURL(input.value.trim(),{requireFight:false}).fightID);}catch{}
        const chosen=report?.fights.find(f=>String(f.id)===select.value);
        select.dataset.status=fightStatus(chosen);
        load.textContent=live.connected()?(report||explicit?'Import':'Load fights'):'Connect and continue';
        input.disabled=select.disabled=busy;load.disabled=busy||Boolean(live.connected()&&report&&(!chosen||chosen.inProgress));
        stop.hidden=!busy;if(disconnect)disconnect.disabled=busy;
        another.hidden=!report;another.disabled=busy;
        let sameLog=false;
        try{const selected=parseReportURL(selectedURL()),saved=live.diagnostics?.();sameLog=selected.reportCode===saved?.log.reportCode&&selected.fightID===saved?.log.fight.id;}catch{}
        download.hidden=busy||!sameLog;
        const recommendSearch=Boolean(sameLog&&live.canFindMissing?.());
        expand.hidden=busy||!recommendSearch;expand.disabled=busy;
        expand.classList.toggle('primary',recommendSearch);
        load.classList.toggle('primary',!recommendSearch);
        expand.textContent='Find missing mobs';
        expand.title='Look for matching mobs in packs near confirmed packs pulled earlier. Newly found packs do not extend the search. Nearby packs may not have been pulled.';
        proceed.hidden=busy||!sameLog||!live.canContinue?.();proceed.disabled=busy;
        dismiss.hidden=busy||!sameLog||!(live.canFindMissing?.()||live.canContinue?.());dismiss.disabled=busy;
        diagnosticActions.hidden=[expand,proceed,download,dismiss].every(button=>button.hidden);
        const skipped=sameLog?live.missingEnemies?.():null;
        missing.hidden=busy||!skipped?.length;
        missing.innerHTML=skipped?.length?[...Map.groupBy(skipped,r=>r.pull??1)].sort(([a],[b])=>a-b).map(([pull,rows])=>
          `<p><strong>Pull ${esc(pull)}</strong><br>${[...Map.groupBy(rows,r=>r.name)].map(([name,rs])=>`${esc(name)} ×${rs.length}`).join('<br>')}</p>`).join(''):'';
      }
      function showFailure(message){
        const skipped=live.missingEnemies?.();
        error.textContent=skipped?.length?'This run contains unmatched mobs.':message;error.hidden=false;
      }
      input.oninput=()=>{report=null;select.replaceChildren();field.hidden=true;status.textContent='';error.hidden=true;download.hidden=true;remember();controls();};
      another.onclick=()=>{input.value='';input.oninput();input.focus();};
      select.onchange=()=>{status.textContent=report?.fights.find(f=>String(f.id)===select.value)?.inProgress?'This run is still in progress. Select a completed run.':'';error.hidden=true;download.hidden=true;remember();controls();};
      function showFights(list,selectedID){
        report=list;select.innerHTML=list.fights.map(f=>`<option value="${f.id}" data-status="${fightStatus(f)}">${esc(fightLabel(f))}</option>`).join('');
        select.value=String(list.fights.some(f=>f.id===selectedID)?selectedID:list.selectedFightID);
        field.hidden=false;select.onchange();
      }
      async function loadFights(selectedID){
        status.textContent='Loading fights…';
        const list=await live.fights(input.value.trim(),{signal:controller.signal});controller.signal.throwIfAborted();
        if(typeof selectedID==='number'&&!list.fights.some(f=>f.id===selectedID))throw new Error('The selected fight is not available in this report. Check the link.');
        showFights(list,selectedID);select.focus();
      }
      async function importLog(mode='normal'){
        if(busy)return;busy=true;controller=new AbortController();
        controls();
        error.hidden=true;download.hidden=true;status.textContent=live.connected()?'Reading the log…':'Opening Fellowship Logs…';
        try{
          const selection=parseReportURL(selectedURL(),{requireFight:false});
          if(!live.connected()){await live.connect(selectedURL(),{signal:controller.signal});return;}
          if(!selection.fightID){
            await loadFights();return;
          }
          // Direct links use the same selected-fight view while events load.
          // Continue automatically after fetching the small report summary.
          if(!report&&mode==='normal'&&live.fights)await loadFights(selection.fightID);
          remember();lastFightID=report?Number(select.value):selection.fightID;
          const options={signal:controller.signal,onProgress:text=>status.textContent=text,
            fightSummary:report?.fights.find(f=>f.id===lastFightID)};
          const result=await (mode==='expand'?live.expandSearch(selectedURL(),options):mode==='recover'?live.continueImport(selectedURL(),options):live.load(selectedURL(),options));
          if(!result){status.textContent='Additional search finished. The mobs below still could not be matched.';showFailure('Could not match complete packs. You can import the matched mobs.');return;}
          controller.signal.throwIfAborted();fixture=result;
          session=createReviewSession(fixture);await advance();
        }catch(e){
          status.textContent=controller.signal.aborted?'Import cancelled.':'';
          if(!controller.signal.aborted){showFailure(e.message);download.hidden=!live.diagnostics?.();}
        }finally{
          busy=false;controls();
        }
      }
      form.onsubmit=event=>{event.preventDefault();return importLog();};
      proceed.onclick=()=>importLog('recover');
      expand.onclick=()=>importLog('expand');
      if(report)showFights(report,lastFightID);
      controls();(report?select:input).focus();
      // Reuse the report summary on reopening; older sessions may lack it.
      if(restoring&&!report&&lastFightID&&live.connected()&&live.fights){
        busy=true;controller=new AbortController();controls();
        loadFights(lastFightID).catch(e=>{
          status.textContent=controller.signal.aborted?'Import cancelled.':'';
          if(!controller.signal.aborted){error.textContent=e.message;error.hidden=false;}
        }).finally(()=>{busy=false;controls();});
      }
    }

  },async resume(){try{const url=await live?.resume();if(url){api.open(url);document.getElementById('log-live-form').requestSubmit();}}catch(error){api.open();const message=document.getElementById('log-live-error');if(message){message.textContent=error.message;message.hidden=false;}else onError(error.message);}}};
  return api;
}
