// Original SVG silhouettes inspired by the marker meanings, not game artwork.
// Order and default colors follow the user's in-game reference (markers 1–5).
export const markerSymbols = [
  {id:'number', label:'Number'},
  {id:'marker-1', label:'Marker 1', name:'Arrow', color:'#22e628', path:'M8 2H16V13H22L12 23 2 13H8Z'},
  {id:'marker-2', label:'Marker 2', name:'Eye', color:'#ffff00', fillRule:'evenodd', path:'M1 12C4 6 8 4 12 4S20 6 23 12C20 18 16 20 12 20S4 18 1 12ZM4 12C6.5 16 9 17.5 12 17.5S17.5 16 20 12C17.5 8 15 6.5 12 6.5S6.5 8 4 12ZM16 12A4 4 0 1 1 8 12A4 4 0 1 1 16 12Z'},
  {id:'marker-3', label:'Marker 3', name:'Shield', color:'#329dff', path:'M12 1 21 5V11C21 17 17 21 12 23C7 21 3 17 3 11V5ZM12 4V20C16 18 18 15 18 11V7Z'},
  {id:'marker-4', label:'Marker 4', name:'Swords', color:'#ff0000', path:'M2 1 7 3 17 14 19 12 21 14 18 17 22 21 20 23 16 19 13 22 11 20 13 18 3 7ZM22 1 21 7 11 18 13 20 11 22 8 19 4 23 2 21 6 17 3 14 5 12 7 14 17 3Z'},
  {id:'marker-5', label:'Marker 5', name:'Swirl', color:'#b45cff', stroke:true, path:'M21 11C21 5 16 2 11 3C5 4 2 9 4 15C6 21 13 23 18 19C22 16 20 10 16 8C12 6 8 8 8 12C8 16 13 18 15 15C17 12 14 10 12 12'},
];
export const markerColors = [
  ['#ff0000','Red'],['#329dff','Blue'],['#ffa500','Orange'],['#ffff00','Yellow'],
  ['#22e628','Green'],['#b45cff','Purple'],['#ffffff','White'],['#000000','Black'],
];
export const markerIcon = item => item.kind === 'note' ? item.icon || 'number' : item.icon || 'pin';
export const numberedAnnotations = route => [
  ...route.drawings.filter(d => d.kind === 'note' && markerIcon(d) === 'number'),
  ...(route.markers || []).filter(m => m.icon === 'number'),
];
export const markerSymbol = icon => markerSymbols.find(symbol => symbol.id === icon);
export const legacyMarkerGlyph = icon => ({pin:'◆',star:'★',flag:'⚑'}[icon] || '◆');
