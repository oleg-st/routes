// All changing catalog and geometry inputs come from our installed-game export.
import {spawnSync} from 'node:child_process';
for(const script of ['build-game-planner-overlay','prepare-game-catalogs','prepare-game-data','prepare-game-services','prepare-difficulty-data','prepare-game-summons','update-route-mapping','prepare-game-images','prepare-combined-maps']){
 const result=spawnSync(process.execPath,['scripts/'+script+'.mjs'],{stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
