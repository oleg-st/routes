// These abilities have separate granted-effect or monitor records in the data.
// Show each cast once, keeping its interruptibility and timing metadata.
// Keep an explicit list: matching names or an unknown live status alone do not
// establish a duplicate (other records represent separate attacks or phases).
const effectAliases={
  GA_DD_WitheringMagiPeriodicDamage_Granted:'GA_DD_WitheringMagiPeriodicDamage',
  GA_FK_Elf_Guard_ShatteringBarrier_Monitor:'GA_FK_Elf_Guard_ShatteringBarrier',
  GA_MF_BossNecrolord_DispellableSoakDot_Monitor:'GA_MF_BossNecrolord_DispellableSoakDot',
  GA_NP_Stormscreamer_PeriodicDamage_Granted:'GA_NP_Stormscreamer_PeriodicDamage'
};

export function enemyAbilities(abilities,parentId){
  const visible=abilities.filter(a=>a.parentId===parentId&&a.name&&a.liveStatus!=='inactive');
  return visible.filter(a=>!visible.some(cast=>cast.id===effectAliases[a.id]&&cast.name===a.name));
}
