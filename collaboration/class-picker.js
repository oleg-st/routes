const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const classColor=hero=>/^#[0-9a-f]{6}$/i.test(hero?.classColor)?hero.classColor:null;
function content(hero){return hero?'<img src="'+esc(hero.images?.[0]?.path||'')+'" alt=""><span>'+esc(hero.name)+'</span>':'<span class="class-placeholder" aria-hidden="true">?</span><span>Not selected</span>';}
export function classPicker(classes,value=''){
  const hero=classes.find(c=>c.id===value),items=[null,...classes];
  return '<div class="room-class-field"><label id="room-class-label" for="room-class-button">Class</label><div class="class-picker"><input type="hidden" id="room-class" value="'+esc(hero?.id||'')+'"><button type="button" id="room-class-button" role="combobox" aria-labelledby="room-class-label" aria-controls="room-class-options" aria-expanded="false" aria-haspopup="listbox" style="--class-color:'+(classColor(hero)||'#abb7c0')+'">'+content(hero)+'<span class="class-chevron" aria-hidden="true">⌄</span></button><div id="room-class-options" role="listbox" aria-labelledby="room-class-label" hidden>'+items.map((c,i)=>'<button type="button" role="option" tabindex="-1" id="room-class-option-'+i+'" data-class-id="'+esc(c?.id||'')+'" aria-selected="'+((c?.id||'')===(hero?.id||''))+'" style="--class-color:'+(classColor(c)||'#abb7c0')+'">'+content(c)+'</button>').join('')+'</div></div></div>';
}
export function mountClassPicker(root,classes){
  const button=root.querySelector('#room-class-button');if(!button)return;
  const list=root.querySelector('#room-class-options'),input=root.querySelector('#room-class'),options=[...list.children];let active=0;
  function highlight(index){active=(index+options.length)%options.length;options.forEach((option,i)=>option.dataset.active=String(i===active));button.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
  function close(){list.hidden=true;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');}
  function open(){list.hidden=false;button.setAttribute('aria-expanded','true');highlight(Math.max(0,options.findIndex(o=>o.dataset.classId===input.value)));}
  function choose(index){const value=options[index].dataset.classId,hero=classes.find(c=>c.id===value);input.value=value;button.innerHTML=content(hero)+'<span class="class-chevron" aria-hidden="true">⌄</span>';button.style.setProperty('--class-color',classColor(hero)||'#abb7c0');options.forEach(o=>o.setAttribute('aria-selected',String(o.dataset.classId===value)));input.dispatchEvent(new Event('input',{bubbles:true}));close();button.focus();}
  button.onclick=()=>list.hidden?open():close();
  options.forEach((option,i)=>{option.onpointerdown=e=>e.preventDefault();option.onclick=()=>choose(i);});
  button.onkeydown=event=>{
    const key=event.key;
    if(key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();return;}
    if(key==='Tab'){close();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(key)){event.preventDefault();const wasClosed=list.hidden;if(wasClosed)open();if(key==='Home')highlight(0);else if(key==='End')highlight(options.length-1);else if(!wasClosed)highlight(active+(key==='ArrowDown'?1:-1));return;}
    if((key==='Enter'||key===' ')&&!list.hidden){event.preventDefault();choose(active);return;}
    if(key.length===1&&!event.ctrlKey&&!event.metaKey&&key!==' '){event.preventDefault();if(list.hidden)open();const start=active;for(let i=1;i<=options.length;i++){const index=(start+i)%options.length;if(options[index].textContent.trim().toLowerCase().startsWith(key.toLowerCase())){highlight(index);break;}}}
  };
  root.addEventListener('click',event=>{if(!event.target.closest('.class-picker'))close();});
  button.addEventListener('blur',()=>close());
}
