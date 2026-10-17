// Temporary vector symbols. Replace these paths with verified Fellowship artwork.
export const markerSymbols = [
  {id:'number', label:'Number'},
  {id:'marker-1', label:'Marker 1', path:'M12 2 22 12 12 22 2 12Z'},
  {id:'marker-2', label:'Marker 2', path:'M9 2H15V9H22V15H15V22H9V15H2V9H9Z'},
  {id:'marker-3', label:'Marker 3', path:'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2Z'},
  {id:'marker-4', label:'Marker 4', path:'M3 3H21V21H3Z'},
  {id:'marker-5', label:'Marker 5', path:'M12 2 23 21H1Z'},
];
export const markerColors = [
  ['#ff0000','Red'],['#5146ff','Blue'],['#ffa500','Orange'],['#ffff00','Yellow'],
  ['#22e628','Green'],['#9000ff','Purple'],['#ffffff','White'],['#000000','Black'],
];
export const markerIcon = item => item.kind === 'note' ? item.icon || 'number' : item.icon || 'pin';
export const numberedAnnotations = route => [
  ...route.drawings.filter(d => d.kind === 'note' && markerIcon(d) === 'number'),
  ...(route.markers || []).filter(m => m.icon === 'number'),
];
export const markerSymbol = icon => markerSymbols.find(symbol => symbol.id === icon);
export const legacyMarkerGlyph = icon => ({pin:'◆',star:'★',flag:'⚑'}[icon] || '◆');
