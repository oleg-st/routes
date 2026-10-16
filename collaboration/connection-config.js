import {invariant} from './route-schema.js';
export function connectionConfig({urls='',username='',credential='',relayOnly=false,automatic=false}={}) {
  const list=urls.split(/[\s,]+/).filter(Boolean);
  invariant(list.length<=8&&list.every(url=>/^turns?:[^\s/@]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(url)), 'Enter TURN URLs, for example turns:turn.example.com:443?transport=tcp.');
  invariant(!relayOnly||list.length||automatic,'Relay-only mode needs a TURN server.');
  invariant(!list.length||(username.trim()&&credential),'TURN username and password are required.');
  return {...(list.length?{turnConfig:[{urls:list,username:username.trim(),credential}]}:{}),...(relayOnly?{rtcConfig:{iceTransportPolicy:'relay'}}:{})};
}
