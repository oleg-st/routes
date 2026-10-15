import {expandDungeons} from './compact-data.js';
export const dataNames=['dungeons','enemies','abilities','manifest','shadow-reference','modifier-placements'];

export async function loadData(){
  const payload=await Promise.all(dataNames.map(async name=>{
    const response=await fetch(`data/${name}.json`);
    if(!response.ok)throw new Error(`Unable to load ${name}. Run npm run data.`);
    return response.json();
  }));
  const data=Object.fromEntries(dataNames.map((name,i)=>[name,payload[i]]));
  data.dungeons=expandDungeons(data.dungeons);
  return data;
}
