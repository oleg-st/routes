import {classColor} from './class-picker.js';
import {projectCursor,sessionColor} from './cursor-presence.js';
const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs,text){const el=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;return el;}
export function createCursorOverlay({map,getContext,onCursor,classes=[]}){
  const root=svg('g',{id:'remote-cursors','pointer-events':'none','aria-hidden':'true'});map.append(root);
  let remote=[],pointer=null;
  function pause(){pointer=null;}
  function publish(){
    const context=getContext();if(!context||!pointer||document.hidden||!document.elementFromPoint(pointer.clientX,pointer.clientY)?.closest('#map'))return;
    const matrix=map.getScreenCTM();if(!matrix)return;const point=map.createSVGPoint();point.x=pointer.clientX;point.y=pointer.clientY;const p=point.matrixTransform(matrix.inverse());
    const layer=context.mapLayer;if(p.x>=0&&p.y>=0&&p.x<=layer.width&&p.y<=layer.height)onCursor({mapId:layer.id,x:p.x,y:p.y});
  }
  function render(){
    root.replaceChildren();const context=getContext(),matrix=map.getScreenCTM();if(!context||!matrix)return;
    const unit=1/Math.hypot(matrix.a,matrix.b);
    const defs=svg('defs',{}),clip=svg('clipPath',{id:'remote-cursor-portrait'});clip.append(svg('circle',{cx:25,cy:21,r:9}));defs.append(clip);root.append(defs);
    for(const cursor of remote){const position=projectCursor(cursor,context.mapLayer,context.dungeon);if(!position)continue;
      const hero=classes.find(c=>c.id===cursor.classId),portrait=hero?.images?.[0]?.path,color=classColor(hero)||sessionColor(cursor.sessionId),group=svg('g',{'data-cursor-session':cursor.sessionId,'data-map-x':position[0],'data-map-y':position[1],transform:'translate('+position.join(' ')+') scale('+unit+')'});
      group.append(svg('path',{d:'M0 0 L4 18 L8 12 L16 10 Z',fill:color,stroke:'#10161b','stroke-width':1.2}),svg('rect',{x:14,y:10,width:cursor.name.length*6.5+(portrait?34:16),height:22,rx:11,fill:'#171719ed'}));
      if(portrait){group.append(svg('circle',{cx:25,cy:21,r:10,fill:color}),svg('image',{href:portrait,x:16,y:12,width:18,height:18,preserveAspectRatio:'xMidYMid slice','clip-path':'url(#remote-cursor-portrait)'}));}
      group.append(svg('text',{x:portrait?40:22,y:25,fill:color,style:'fill:color-mix(in srgb, '+color+' 65%, white)','font-size':11,'font-weight':600,'font-family':'Segoe UI,sans-serif'},cursor.name));root.append(group);group.querySelector('rect').setAttribute('width',group.querySelector('text').getComputedTextLength()+(portrait?34:16));
    }
  }
  map.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;pointer={clientX:event.clientX,clientY:event.clientY};publish();});
  map.addEventListener('pointerleave',pause);map.addEventListener('pointercancel',pause);
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  return {pause,refresh(){render();publish();},setRemote(value){remote=value;render();},clear(){remote=[];pause();onCursor(null);render();}};
}
