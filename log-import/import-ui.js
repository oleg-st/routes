import {createReviewSession} from './review-session.js';
import {parseReportURL} from './report-url.js';
import {fightLabel} from './fight-label.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fightStatus=f=>f?.inProgress?'progress':f?.kill===true?'clear':f?.kill===false?'wipe':'unknown';
const proximityLabel=o=>{
  if(!o.proximity)return '';
  const p=o.proximity,low=Math.round(p.minDistance),high=Math.round(p.maxDistance);
  return `${o.closestToPath?'Closest to path · ':''}${p.estimated?'Estimated across log gap · ':''}Path distance: ≈${low===high?low:`${low}–${high}`} · ${p.sources.join(' / ')}${p.patrol?' · patrol path':''}`;
};
export function createLogImportUI({panel,showDialog,closeDialog,preview,commit,cancel,highlight,focus,describe,onError,live}){
  let fixture,session,busy=false,lastURL='',lastReport=null,lastFightID=null;
  const invoke=fn=>async()=>{
    if(busy)return;busy=true;
    try{await fn();}catch(error){onError(error.message);}finally{busy=false;}
  };
  const ids=groups=>groups.flatMap(id=>fixture.groups[id].enemies);
  function hide(){highlight([]);panel.hidden=true;panel.replaceChildren();session=null;}
  async function advance(){
    await preview(fixture,session.state());
    closeDialog();
    if(!session.state().complete){draw();return;}
    try{await commit();hide();}catch(error){draw();throw error;}
  }
  function draw(){
    const s=session.state();panel.hidden=false;
    panel.innerHTML=`<div class="log-review-heading"><span class="eyebrow">IMPORT FROM LOG</span><div class="log-review-actions">${s.canBack?'<button data-log-back>← Back</button>':''}<button data-log-cancel>Cancel import</button></div></div>
      <div class="log-review-prompt" role="status" aria-live="polite"><span class="log-review-step">Pull ${s.pullIndex+1}</span><div><strong>${s.complete?'Could not save the imported route':'Choose a pack to add'}</strong><span>${s.complete?'Retry saving or cancel the import.':`${s.remaining} compatible routes remain · Select an option below to continue`}</span></div></div>
      ${fixture.assumption?`<p class="muted">${esc(fixture.assumption)}</p>`:''}
      <div class="log-options">${s.options.map((o,i)=>`<div class="log-option"><button data-log-choice="${esc(o.id)}"><span class="log-option-number">${i+1}</span><span><strong>${esc(o.label)}</strong><small>${esc(o.groups.length?describe(ids(o.groups)):'Continue with the enemies already selected')}</small>${o.proximity?`<small class="log-proximity" title="Closest approach before engagement, in world units. Estimates across log gaps and patrol paths are possible positions, not observed contact or a probability.">${esc(proximityLabel(o))}</small>`:''}</span><span class="log-option-add" aria-hidden="true">＋</span></button>${o.groups.length?`<button class="log-locate" data-log-focus="${esc(o.id)}" title="Show on map" aria-label="Show ${esc(o.label)} on map">⌖</button>`:''}</div>`).join('')}</div>
      ${s.complete?'<button class="primary" data-log-retry>Retry saving</button>':''}`;
    for(const b of panel.querySelectorAll('[data-log-choice]')){
      const option=s.options.find(o=>o.id===b.dataset.logChoice);
      b.onpointerenter=b.onfocus=()=>highlight(ids(option.groups));
      b.onpointerleave=b.onblur=()=>highlight([]);
      b.onclick=invoke(async()=>{session.choose(option.id);highlight([]);await advance();panel.querySelector('[data-log-choice], [data-log-retry]')?.focus();});
    }
    for(const b of panel.querySelectorAll('[data-log-focus]'))b.onclick=()=>focus(ids(s.options.find(o=>o.id===b.dataset.logFocus).groups));
    const back=panel.querySelector('[data-log-back]');if(back)back.onclick=invoke(async()=>{session.back();highlight([]);await preview(fixture,session.state());draw();});
    panel.querySelector('[data-log-cancel]').onclick=invoke(async()=>{await cancel();hide();});
    const retry=panel.querySelector('[data-log-retry]');if(retry)retry.onclick=invoke(async()=>{await commit();hide();});
  }
  const api={open(url){
    const restoring=url===undefined;
    url??=lastURL;
    showDialog('Import from log',`<form id="log-live-form"><label for="log-url">Fellowship Logs report link</label><input id="log-url" type="url" required placeholder="https://www.fellowshiplogs.com/reports/…" value="${esc(url)}"><div id="log-fight-field" hidden><label for="log-fight">Fight</label><select id="log-fight"></select></div><div class="log-review-actions"><button class="primary" id="log-load" type="submit"></button><button id="log-stop" type="button" hidden>Cancel</button>${live.connected()?'<button id="log-disconnect" type="button">Disconnect</button>':''}</div><p id="log-live-status" role="status" aria-live="polite"></p><p id="log-live-error" role="alert" hidden></p></form>`);
    if(live){
      const form=document.getElementById('log-live-form'),input=document.getElementById('log-url'),load=document.getElementById('log-load'),stop=document.getElementById('log-stop'),status=document.getElementById('log-live-status'),error=document.getElementById('log-live-error');
      const select=document.getElementById('log-fight'),field=document.getElementById('log-fight-field');
      const download=document.createElement('button');download.type='button';download.textContent='Download import diagnostics';download.hidden=true;form.append(download);
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
      function controls(){
        let explicit=false;try{explicit=Boolean(parseReportURL(input.value.trim(),{requireFight:false}).fightID);}catch{}
        const chosen=report?.fights.find(f=>String(f.id)===select.value);
        select.dataset.status=fightStatus(chosen);
        load.textContent=live.connected()?(report||explicit?'Import':'Load fights'):'Connect and continue';
        input.disabled=select.disabled=busy;load.disabled=busy||Boolean(live.connected()&&report&&(!chosen||chosen.inProgress));
        stop.hidden=!busy;if(disconnect)disconnect.disabled=busy;
        another.hidden=!report;another.disabled=busy;
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
        showFights(list,selectedID);select.focus();
      }
      form.onsubmit=async event=>{
        event.preventDefault();if(busy)return;busy=true;controller=new AbortController();
        controls();
        error.hidden=true;download.hidden=true;status.textContent=live.connected()?'Reading the log…':'Opening Fellowship Logs…';
        try{
          const selection=parseReportURL(selectedURL(),{requireFight:false});
          if(!live.connected()){await live.connect(selectedURL(),{signal:controller.signal});return;}
          if(!selection.fightID){
            await loadFights();return;
          }
          remember();lastFightID=selection.fightID;
          const result=await live.load(selectedURL(),{signal:controller.signal,onProgress:text=>status.textContent=text});
          controller.signal.throwIfAborted();fixture=result;session=createReviewSession(fixture);await advance();
        }catch(e){
          status.textContent=controller.signal.aborted?'Import cancelled.':'';
          if(!controller.signal.aborted){error.textContent=e.message;error.hidden=false;download.hidden=!live.diagnostics?.();}
        }finally{
          busy=false;controls();
        }
      };
      if(report)showFights(report,lastFightID);
      controls();(report?select:input).focus();
      // Direct fight links skip the list on first import. Fetch that small list
      // only when reopening, then reuse it for subsequent visits to this dialog.
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
