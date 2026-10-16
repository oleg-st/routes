// Public client identifier; no client secret is used by the browser.
export const CLIENT_ID='01a143aa-9e56-72b2-842e-07efccacef9c';
export const REDIRECT_URI='http://localhost:4173/';
const origin='https://www.fellowshiplogs.com';
const transactionKey='fellowship-log-probe-pkce';
const maxAge=10*60*1000;
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function pkceChallenge(verifier){
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}
export async function beginAuthorization(storage,now=Date.now(),redirectURI=REDIRECT_URI){
  if(![REDIRECT_URI,'https://oleg-st.github.io/routes/'].includes(redirectURI))throw new Error('Open the published Routes site or http://localhost:4173/ to connect Fellowship Logs.');
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=await pkceChallenge(verifier);
  storage.setItem(transactionKey,JSON.stringify({verifier,state,createdAt:now,redirectURI}));
  const url=new URL('/oauth/authorize',origin);
  url.search=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:redirectURI,response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256'});
  return url.href;
}
export function consumeCallback(search,storage,now=Date.now()){
  const params=new URLSearchParams(search);
  if(!params.has('code')&&!params.has('error'))return null;
  const raw=storage.getItem(transactionKey);storage.removeItem(transactionKey);
  let transaction;
  try{transaction=JSON.parse(raw);}catch{}
  if(!transaction||!Number.isFinite(transaction.createdAt)||now<transaction.createdAt||now-transaction.createdAt>maxAge||
    !transaction.state||params.getAll('state').length!==1||params.get('state')!==transaction.state||
    typeof transaction.verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(transaction.verifier)){
    throw new Error('Authorization expired or state did not match. Start again in this tab.');
  }
  if(params.has('error'))throw new Error('Authorization was declined or failed.');
  if(params.getAll('code').length!==1||!params.get('code'))throw new Error('Missing or invalid authorization code.');
  return {code:params.get('code'),verifier:transaction.verifier,redirectURI:transaction.redirectURI??REDIRECT_URI};
}
export async function exchangeCode(callback,fetcher=fetch){
  let response;
  try{
    response=await fetcher(`${origin}/oauth/token`,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
      body:new URLSearchParams({client_id:CLIENT_ID,grant_type:'authorization_code',redirect_uri:callback.redirectURI??REDIRECT_URI,code:callback.code,code_verifier:callback.verifier})});
  }catch{throw new Error('Token request could not reach Fellowship Logs. Check network access and browser CORS errors.');}
  if(!response.ok)throw new Error(`Token exchange failed (HTTP ${response.status}). Check the client type and exact redirect URL.`);
  let result;try{result=await response.json();}catch{throw new Error('Token endpoint did not return JSON.');}
  if(typeof result.access_token!=='string'||!result.access_token||String(result.token_type).toLowerCase()!=='bearer')throw new Error('Token endpoint did not return a Bearer token.');
  // Discard refresh tokens. Access token stays in this page's memory only.
  return result.access_token;
}
