// A lossless raw recovery archive, not the compact route sharing format.
export function serializeStorageBackup(backup) {
  return JSON.stringify(backup, (key, value) => {
    if(value instanceof Uint8Array || value instanceof ArrayBuffer){
      const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
      let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {type:value instanceof Uint8Array?'Uint8Array':'ArrayBuffer',base64:btoa(binary)};
    }
    return value;
  }, 2);
}
