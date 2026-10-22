import {createDraft,rectangle,draftBounds,recipeModule,validateDraft,validateMapPolygon} from './model.mjs';
const $=id=>document.getElementById(id),catalog=await fetch('/api/catalog').then(r=>r.json());
if(catalog.error)throw Error(catalog.error);
let dungeon,draft,selected=0,tracing=false,cutMode=null,cutPoints=[],camera,drag,history=[],future=[];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const current=()=>draft.layers[selected];
const remember=()=>{history.push(JSON.stringify(draft));if(history.length>80)history.shift();future=[];};
const persist=()=>localStorage.setItem('map-editor:'+catalog.build+':'+dungeon.id,JSON.stringify(draft));
function changed(){persist();render();status('Есть изменения · черновик в этом браузере');}
function view(){const box=$('stage').getBoundingClientRect(),ratio=box.width/box.height;let [x,y,w,h]=camera;if(w/h<ratio){x-=(h*ratio-w)/2;w=h*ratio;}else{y-=(w/ratio-h)/2;h=w/ratio;}$('stage').setAttribute('viewBox',[x,y,w,h].join(' '));}
function fit(){camera=draftBounds(draft);view();}
function point(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform($('stage').getScreenCTM().inverse());}
function layerPoint(event,clamp=false){const p=point(event),l=current(),xy=[(p.x-l.at[0])/l.scale,(p.y-l.at[1])/l.scale];return clamp?xy.map((v,i)=>Math.round(Math.max(0,Math.min(i?512:1024,v)))):xy.map(Math.round);}
function stopCut(){cutMode=null;cutPoints=[];drag=null;}
function commitCut(){
  try{validateMapPolygon(cutPoints,'Вырез');}catch{status('Для выреза нужна область: протяните прямоугольник или отметьте минимум три точки.',true);return false;}
  remember();(current().exclude??=[]).push(cutPoints.map(p=>[...p]));cutPoints=[];changed();return true;
}
function render(){
  const layer=current();
  $('layers').innerHTML=draft.layers.map((l,i)=>`<button data-select="${i}" aria-pressed="${i===selected}">${esc(dungeon.mapImages.find(m=>m.id.endsWith(':'+l.suffix))?.name??l.suffix)}<small>${esc(l.suffix)}</small></button>`).join('');
  $('x').value=Number(layer.at[0].toFixed(2));$('y').value=Number(layer.at[1].toFixed(2));$('scale').value=Number(layer.scale.toFixed(4));
  $('slug').value=draft.slug;$('version').value=draft.version;$('undo').disabled=!history.length;$('redo').disabled=!future.length;
  $('trace').setAttribute('aria-pressed',tracing);$('stage').classList.toggle('tracing',tracing||!!cutMode);
  $('cut-rectangle').setAttribute('aria-pressed',cutMode==='rectangle');$('cut').setAttribute('aria-pressed',cutMode==='polygon');$('cut').textContent=cutMode==='polygon'?'Завершить вырез':'Вырезать по точкам';
  $('cut-point-undo').disabled=cutMode!=='polygon'||!cutPoints.length;$('cut-cancel').disabled=!cutMode;$('cut-remove').disabled=!layer.exclude?.length;
  $('cut-count').textContent='Вырезов в слое: '+(layer.exclude?.length??0);
  $('mode').textContent=cutMode==='rectangle'?'Вырез: протяните прямоугольник · Esc — выйти':cutMode==='polygon'?'Вырез: отметьте точки и нажмите «Завершить вырез»':tracing?'Контур: нажмите по краям территории':'Перемещение слоёв';
  $('stage').innerHTML=draft.layers.map((l,i)=>{
    const id=dungeon.id+':'+l.suffix,image='/api/image?'+new URLSearchParams({dungeon:dungeon.id,map:id});
    const poly=l.outline.map(p=>p.join(',')).join(' '),color=i===selected?'#6de7bf':'#5d7f90',clipped=l.outline.length>=3;
    const markers=$('markers').checked?dungeon.enemies.filter(p=>p.mapImageId===id&&p.mapPosition).map(p=>`<circle cx="${p.mapPosition.x*1024}" cy="${p.mapPosition.y*512}" r="${p.encounterPhase?6:3}" fill="#fff5b5" stroke="#342f21" stroke-width="1"/>`).join(''):'';
    const holes=(l.exclude??[]).map(polygon=>`<polygon points="${polygon.map(p=>p.join(',')).join(' ')}" fill="black"/>`).join('');
    return `<g data-layer="${i}" transform="translate(${l.at.join(' ')}) scale(${l.scale})"><defs><clipPath id="clip-${i}"><polygon points="${poly}"/></clipPath><mask id="cut-mask-${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="512" style="mask-type:luminance"><rect width="1024" height="512" fill="white"/>${holes}</mask></defs><g${clipped?` clip-path="url(#clip-${i})"`:''} mask="url(#cut-mask-${i})" opacity="${$('opacity').value}"><image href="${esc(image)}" width="1024" height="512" preserveAspectRatio="none"/>${markers}</g><rect width="1024" height="512" fill="transparent" stroke="${color}" stroke-width="${i===selected?2:1}" stroke-dasharray="8 5" vector-effect="non-scaling-stroke"/><polyline points="${poly}${clipped?' '+l.outline[0].join(','):''}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>${i===selected&&tracing?l.outline.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#6de7bf"/>`).join(''):''}<text x="8" y="-10" fill="${color}" font-size="14">${esc(l.suffix)}</text></g>`;
  }).join('');
  if(cutMode&&cutPoints.length){const l=current(),points=cutPoints.map(p=>p.join(',')).join(' ');$('stage').insertAdjacentHTML('beforeend',`<g pointer-events="none" transform="translate(${l.at.join(' ')}) scale(${l.scale})"><polygon points="${points}" fill="#ff6d592a" stroke="#ff957c" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>${cutPoints.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#ff957c"/>`).join('')}</g>`);}
  view();
}
async function load(){
  dungeon=catalog.dungeons.find(d=>d.id===$('dungeon').value);selected=0;tracing=false;stopCut();history=[];future=[];
  const saved=await fetch('/api/draft?'+new URLSearchParams({dungeon:dungeon.id})).then(r=>r.json());
  const local=localStorage.getItem('map-editor:'+catalog.build+':'+dungeon.id);
  try{draft=local?JSON.parse(local):saved??createDraft(dungeon,catalog.frames[dungeon.id]);validateDraft(draft,dungeon);}catch{draft=createDraft(dungeon,catalog.frames[dungeon.id]);}
  camera=draftBounds(draft);render();status(saved?'Загружен сохранённый черновик':'Слои расположены по координатам клиента');
}
$('dungeon').innerHTML=catalog.dungeons.filter(d=>d.mapImages.length).map(d=>`<option value="${esc(d.id)}">${esc(d.name)} · ${d.mapImages.length} сл.</option>`).join('');
$('build').textContent='Клиент '+catalog.build;
$('dungeon').value=catalog.dungeons.find(d=>d.id==='Level.ID.IceCave')?.id??$('dungeon').value;
$('dungeon').onchange=()=>load().catch(e=>status(e.message,true));
$('layers').onclick=e=>{const button=e.target.closest('[data-select]');if(button){selected=Number(button.dataset.select);tracing=false;stopCut();render();}};
for(const id of ['x','y','scale','slug','version'])$(id).onchange=()=>{
  remember();if(id==='slug')draft.slug=$('slug').value;else if(id==='version')draft.version=Number($('version').value);else if(id==='scale')current().scale=Math.max(.01,Math.min(20,Number($('scale').value)||1));else current().at[id==='x'?0:1]=Number($(id).value)||0;changed();
};
$('opacity').oninput=render;$('markers').onchange=render;$('fit').onclick=fit;
$('trace').onclick=()=>{stopCut();if(!tracing){remember();current().outline=[];persist();}tracing=!tracing;render();};
$('cut-rectangle').onclick=()=>{const active=cutMode==='rectangle';stopCut();tracing=false;cutMode=active?null:'rectangle';render();};
$('cut').onclick=()=>{if(cutMode==='polygon'){if(!commitCut())return;stopCut();}else{stopCut();tracing=false;cutMode='polygon';}render();};
$('cut-point-undo').onclick=()=>{cutPoints.pop();render();};
$('cut-cancel').onclick=()=>{stopCut();render();};
$('cut-remove').onclick=()=>{if(current().exclude?.length){remember();current().exclude.pop();changed();}};
window.addEventListener('keydown',event=>{if(event.key==='Escape'){stopCut();tracing=false;render();}});
$('rectangle').onclick=()=>{remember();current().outline=rectangle();tracing=false;changed();};
$('point-undo').onclick=()=>{remember();current().outline.pop();changed();};
$('reset').onclick=()=>{remember();draft=createDraft(dungeon,catalog.frames[dungeon.id]);selected=0;tracing=false;stopCut();fit();changed();};
for(const [id,offset]of [['back',-1],['front',1]])$(id).onclick=()=>{const next=selected+offset;if(next<0||next>=draft.layers.length)return;remember();[draft.layers[selected],draft.layers[next]]=[draft.layers[next],draft.layers[selected]];selected=next;changed();};
$('undo').onclick=()=>{if(!history.length)return;future.push(JSON.stringify(draft));draft=JSON.parse(history.pop());selected=Math.min(selected,draft.layers.length-1);tracing=false;stopCut();changed();};
$('redo').onclick=()=>{if(!future.length)return;history.push(JSON.stringify(draft));draft=JSON.parse(future.pop());tracing=false;stopCut();changed();};
$('stage').onpointerdown=event=>{
  if(event.button!==0)return;const p=point(event),target=event.target.closest('[data-layer]');
  if(cutMode){
    const xy=layerPoint(event);if(xy[0]<0||xy[0]>1024||xy[1]<0||xy[1]>512)return;
    if(cutMode==='polygon'){cutPoints.push(xy);render();return;}
    cutPoints=[xy,xy,xy,xy];drag={cut:true,start:xy};$('stage').setPointerCapture(event.pointerId);render();return;
  }
  if(tracing){if(!target||Number(target.dataset.layer)!==selected)return;const l=current(),xy=[(p.x-l.at[0])/l.scale,(p.y-l.at[1])/l.scale];if(xy[0]<0||xy[0]>1024||xy[1]<0||xy[1]>512)return;remember();l.outline.push(xy.map(v=>Math.round(v)));changed();return;}
  if(target){selected=Number(target.dataset.layer);remember();drag={start:p,at:[...current().at],layer:true};render();}
  else drag={client:[event.clientX,event.clientY],camera:[...camera],layer:false};
  $('stage').setPointerCapture(event.pointerId);
};
$('stage').onpointermove=event=>{
  if(!drag)return;
  if(drag.cut){const xy=layerPoint(event,true),a=drag.start;cutPoints=[a,[xy[0],a[1]],xy,[a[0],xy[1]]];render();return;}
  if(drag.layer){const p=point(event);current().at=[drag.at[0]+p.x-drag.start.x,drag.at[1]+p.y-drag.start.y];render();}
  else{const box=$('stage').getBoundingClientRect(),vb=$('stage').viewBox.baseVal;camera=[drag.camera[0]-(event.clientX-drag.client[0])*vb.width/box.width,drag.camera[1]-(event.clientY-drag.client[1])*vb.height/box.height,...drag.camera.slice(2)];view();}
};
$('stage').onpointerup=event=>{if(drag){const moved=drag.layer,cut=drag.cut;drag=null;if($('stage').hasPointerCapture(event.pointerId))$('stage').releasePointerCapture(event.pointerId);if(cut){if(!commitCut()){cutPoints=[];render();}}else if(moved)changed();}};
$('stage').onpointercancel=()=>{drag=null;cutPoints=[];render();};
$('stage').addEventListener('wheel',event=>{event.preventDefault();const p=point(event),factor=event.deltaY>0?1.12:1/1.12;if(camera[2]*factor<50||camera[2]*factor>100000)return;camera=[p.x+(camera[0]-p.x)*factor,p.y+(camera[1]-p.y)*factor,camera[2]*factor,camera[3]*factor];view();},{passive:false});
window.addEventListener('resize',view);
$('save').onclick=async()=>{try{validateDraft(draft,dungeon);const response=await fetch('/api/draft?'+new URLSearchParams({dungeon:dungeon.id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}),result=await response.json();if(!response.ok)throw Error(result.error);status('Сохранено: '+result.saved);}catch(e){status(e.message,true);}};
$('export').onclick=()=>{try{const blob=new Blob([recipeModule(draft,dungeon)],{type:'text/javascript'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=draft.slug+'.mjs';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Рецепт скачан · сборка: npm run maps -- --recipe=путь --preview');}catch(e){status(e.message,true);}};
await load();
