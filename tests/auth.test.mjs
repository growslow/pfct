import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicConfig,readConnection,writeConnection,clearConnection,backend} from '../web/auth.mjs';
test('browser config accepts only public keys and valid project origins',()=>{
 assert.equal(validatePublicConfig('https://example.supabase.co','sb_publishable_test').url,'https://example.supabase.co');
 assert.throws(()=>validatePublicConfig('https://example.supabase.co','sb_secret_test'));
 const jwt='header.'+btoa(JSON.stringify({role:'service_role'}))+'.signature';
 assert.throws(()=>validatePublicConfig('https://example.supabase.co',jwt));
 assert.throws(()=>validatePublicConfig('http://remote.example','sb_publishable_test'));
 assert.throws(()=>validatePublicConfig('https://user:password@example.supabase.co','sb_publishable_test'));
});
test('tab session supports page navigation; expired tokens refresh before protected calls',async()=>{
 const data=new Map();globalThis.location={search:''};globalThis.sessionStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const c={mode:'live',url:'https://example.supabase.co',key:'sb_publishable_test',portal:'admin',session:{access:'expired',refresh:'refresh-test',expires:0}};
 writeConnection(c);assert.equal(readConnection().portal,'admin');
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('refresh_token')?{access_token:'fresh',refresh_token:'rotated',expires_in:3600}:true),{headers:{'Content-Type':'application/json'}});};
 try{assert.equal(await backend(c,'/rest/v1/rpc/is_admin',{body:{}}),true);assert.equal(calls.length,2);assert.equal(calls[1].options.headers.Authorization,'Bearer fresh');assert.equal(readConnection().session.refresh,'rotated');}finally{globalThis.fetch=original;clearConnection();}
 assert.equal(readConnection(),null);
});
