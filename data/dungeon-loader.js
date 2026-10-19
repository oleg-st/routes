import {expandDungeons} from './compact-data.js';

// The catalogue keeps names available before geometry is requested. Share pending
// requests and retain successful loads; a failed request can be retried normally.
export function createDungeonLoader(dungeons,transform=value=>value,fetcher=globalThis.fetch){
  const pending=new Map();
  return function loadDungeon(id){
    if(pending.has(id))return pending.get(id);
    const index=dungeons.findIndex(dungeon=>dungeon.id===id);
    if(index<0)return Promise.reject(new Error('This dungeon is not available in the current dataset.'));
    const task=Promise.resolve().then(async()=>{
      let dungeon=dungeons[index];
      if(dungeon.dataURL){
        const response=await fetcher(dungeon.dataURL);
        if(!response.ok)throw new Error(`Unable to load ${dungeon.name}. Try again.`);
        dungeon=await response.json();
        if(dungeon?.id!==id||!Array.isArray(dungeon.enemies)||!Array.isArray(dungeon.mapImages))throw new Error('Invalid dungeon data. Try again.');
      }
      const ready=transform(expandDungeons([dungeon])[0]);
      dungeons[index]=ready;
      return ready;
    }).catch(error=>{pending.delete(id);throw error;});
    pending.set(id,task);
    return task;
  };
}
