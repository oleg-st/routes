// `burried` is the spelling used by the current custom dungeon dataset.
export const requiresPlayerContact=placement=>placement.activation==='player-contact'||
  (placement.gameGuid?placement.dormant===true:placement.burried===true||placement.buried===true);
