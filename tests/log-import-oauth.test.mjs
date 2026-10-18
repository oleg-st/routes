import test from 'node:test';
import assert from 'node:assert/strict';
import {pkceChallenge,beginAuthorization,consumeCallback,exchangeCode,CLIENT_ID,REDIRECT_URI,PUBLISHED_REDIRECT_URI} from '../log-import/oauth.js';
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
test('PKCE matches the RFC 7636 S256 test vector',async()=>{
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('Authorization binds a single-use callback to a random verifier and exact redirect',async()=>{
  const store=storage(),url=new URL(await beginAuthorization(store,1000));
  assert.equal(url.origin,'https://www.fellowshiplogs.com');assert.equal(url.searchParams.get('client_id'),CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'),REDIRECT_URI);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const search=new URLSearchParams({code:'sample-code',state:url.searchParams.get('state')}).toString();
  const callback=consumeCallback(search,store,2000);
  assert.equal(await pkceChallenge(callback.verifier),url.searchParams.get('code_challenge'));
  assert.equal(callback.code,'sample-code');assert.throws(()=>consumeCallback(search,store,2000),/state/);
});
test('Rejects mismatched, expired, duplicated and cancelled callbacks',async()=>{
  for(const mode of ['mismatch','expired','duplicate','cancel']){
    const store=storage(),url=new URL(await beginAuthorization(store,1000));
    const params=new URLSearchParams({state:mode==='mismatch'?'wrong':url.searchParams.get('state'),code:'code'});
    if(mode==='duplicate')params.append('state',params.get('state'));
    if(mode==='cancel')params.set('error','access_denied');
    assert.throws(()=>consumeCallback(params.toString(),store,mode==='expired'?601001:2000));
  }
});
test('Custom domain callback keeps the exact redirect through authorization and token exchange',async()=>{
  const store=storage(),url=new URL(await beginAuthorization(store,1000,PUBLISHED_REDIRECT_URI));
  assert.equal(url.searchParams.get('redirect_uri'),'https://olegfellow.dev/');
  const callback=consumeCallback(new URLSearchParams({code:'code',state:url.searchParams.get('state')}).toString(),store,2000);
  assert.equal(callback.redirectURI,'https://olegfellow.dev/');
  await exchangeCode(callback,async(url,options)=>{
    assert.equal(options.body.get('redirect_uri'),'https://olegfellow.dev/');
    assert.equal(options.body.get('code_verifier'),callback.verifier);
    return {ok:true,json:async()=>({access_token:'test-token',token_type:'Bearer'})};
  });
});
test('Authorization only accepts exact registered redirect URLs',async()=>{
  for(const redirect of ['https://olegfellow.dev','http://olegfellow.dev/','https://olegfellow.dev.evil.example/','https://olegfellow.dev/routes/']){
    await assert.rejects(()=>beginAuthorization(storage(),1000,redirect),/Open https:\/\/olegfellow\.dev\//);
  }
  const legacy=new URL(await beginAuthorization(storage(),1000,'https://oleg-st.github.io/routes/'));
  assert.equal(legacy.searchParams.get('redirect_uri'),'https://oleg-st.github.io/routes/');
});
test('Token exchange uses PKCE without client secret and discards refresh token',async()=>{
  const token=await exchangeCode({code:'code',verifier:'verifier'},async(url,options)=>{
    assert.equal(url,'https://www.fellowshiplogs.com/oauth/token');
    assert.equal(options.credentials,'omit');assert.equal(options.body.get('code_verifier'),'verifier');
    assert.equal(options.body.get('redirect_uri'),REDIRECT_URI);assert.equal(options.body.has('client_secret'),false);
    return {ok:true,json:async()=>({access_token:'test-token',token_type:'Bearer',refresh_token:'discard'})};
  });
  assert.equal(token,'test-token');
});
test('Token endpoint errors never echo response bodies or network exception details',async()=>{
  await assert.rejects(()=>exchangeCode({},async()=>({ok:false,status:400,json:async()=>({secret:'do-not-show'})})),/^Error: Token exchange failed \(HTTP 400\)/);
  await assert.rejects(()=>exchangeCode({},async()=>{throw new Error('secret');}),error=>!error.message.includes('secret')&&error.message.includes('CORS'));
});
