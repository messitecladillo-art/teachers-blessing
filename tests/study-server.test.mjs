import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.mjs';

async function fixture(t, {modelFetch,timeoutMs=60}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'study-integrated-'));
  await writeFile(path.join(root,'index.html'),'original-portal');
  await writeFile(path.join(root,'study.html'),'textbook-learning');
  const config={apiKey:modelFetch?'SYNTHETIC_TEST_KEY_42':'',model:modelFetch?'synthetic-model':'',apiUrl:'https://model.invalid/chat/completions',allowedModels:modelFetch?['synthetic-model']:[],timeoutMs,maxConcurrent:1};
  const server=createServer({root,config,fetch:modelFetch,studyDataDir:path.join(root,'private')});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  let cookie='';
  async function request(route,{method='GET',data,body,headers={}}={}) {
    const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?body:JSON.stringify(data)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {response,value:await response.json()};
  }
  async function signup(){const r=await request('/auth/register',{method:'POST',data:{email:'synthetic@example.test',password:'synthetic-only-password',nickname:'Synthetic'}});assert.equal(r.response.status,201);}
  async function textbook(content='# Fractions\nA fraction represents part of a whole.\n'){
    await signup();const book=(await request('/textbooks',{method:'POST',data:{title:'Synthetic fractions'}})).value.data;
    assert.equal((await request(`/textbooks/${book.id}/files`,{method:'POST',body:content,headers:{'X-File-Name':'synthetic.md','Content-Type':'text/markdown'}})).response.status,201);
    const job=(await request(`/textbooks/${book.id}/parse`,{method:'POST',data:{}})).value.data;assert.equal((await waitJob(job.id)).status,'completed');
    const outline=(await request(`/textbooks/${book.id}/outline`)).value.data;const kp=(await request('/knowledge-points/'+outline.knowledgePoints[0].id)).value.data;return {book,kp};
  }
  async function waitJob(id){for(let i=0;i<100;i++){const job=(await request('/jobs/'+id)).value.data;if(['completed','failed','cancelled','interrupted'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('job did not reach a terminal state');}
  return {root,origin,request,signup,textbook,waitJob};
}

test('study entry is served while original portal and private static isolation are preserved',async t=>{
  const f=await fixture(t);
  assert.equal(await (await fetch(f.origin+'/')).text(),'original-portal');
  assert.equal(await (await fetch(f.origin+'/study')).text(),'textbook-learning');
  assert.equal(await (await fetch(f.origin+'/study/textbook/example')).text(),'textbook-learning');
  for(const route of ['/learning/api.mjs','/private/study.json','/node_modules/pdfjs-dist/package.json','/.local/learning/study.json'])assert.equal((await fetch(f.origin+route)).status,404);
});

test('study mutations inherit the same-origin check before registration or persistent work',async t=>{
  const f=await fixture(t);
  const result=await f.request('/auth/register',{method:'POST',data:{email:'synthetic@example.test',password:'synthetic-only-password'},headers:{Origin:'https://foreign.invalid'}});
  assert.equal(result.response.status,403);
  const missing=await fetch(f.origin+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(missing.status,403);
  await f.signup();assert.equal((await f.request('/users/me')).response.status,200);
});

test('unconfigured model preserves actual parsed course and reports unavailable generation',async t=>{
  const f=await fixture(t),{kp}=await f.textbook();
  assert.match(kp.sourceText,/part of a whole/);
  assert.equal((await f.request('/config/public')).value.data.modelConfigured,false);
  assert.equal((await f.request(`/knowledge-points/${kp.id}/lesson`,{method:'POST',data:{}})).response.status,503);
  assert.deepEqual((await f.request(`/knowledge-points/${kp.id}/lesson`)).value.data.items,[]);
});

test('configured study model uses server-only credentials and persists only validated cited content',async t=>{
  let calls=0;
  const f=await fixture(t,{modelFetch:async(_url,init)=>{
    calls++;assert.equal(init.headers.Authorization,'Bearer SYNTHETIC_TEST_KEY_42');
    const input=JSON.parse(init.body),task=JSON.parse(input.messages.find(message=>message.role==='user').content);
    const content=JSON.stringify({title:'Fractions',content:'A fraction is part of a whole.',sourceIds:[task.sources[0].id]});
    return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const {kp}=await f.textbook();
  const job=(await f.request(`/knowledge-points/${kp.id}/lesson`,{method:'POST',data:{}})).value.data;
  assert.equal((await f.waitJob(job.id)).status,'completed');assert.equal(calls,1);
  const lesson=(await f.request(`/knowledge-points/${kp.id}/lesson`)).value.data.items[0];assert.match(lesson.content,/part of a whole/);assert.deepEqual(lesson.sourceIds,[kp.id]);
  assert.equal(JSON.stringify(lesson).includes('SYNTHETIC_TEST_KEY_42'),false);
});

test('study model overall deadline bounds a stalled provider and releases the generation slot',async t=>{
  let calls=0;
  const f=await fixture(t,{timeoutMs:30,modelFetch:async()=>{calls++;return new Promise(()=>{});}}),{kp}=await f.textbook();
  for(let i=0;i<2;i++){
    const started=Date.now(),job=(await f.request(`/knowledge-points/${kp.id}/lesson`,{method:'POST',data:{}})).value.data;
    const terminal=await f.waitJob(job.id);assert.equal(terminal.status,'failed');assert(Date.now()-started<1500);
    assert.deepEqual((await f.request(`/knowledge-points/${kp.id}/lesson`)).value.data.items,[]);
  }
  assert.equal(calls,2,'the first timed-out provider must not retain the shared active slot');
});

test('bounded internal course context includes its citation envelope without weakening public chat limits',async t=>{
  let sentLength=0;
  const f=await fixture(t,{modelFetch:async(_url,init)=>{
    const input=JSON.parse(init.body);sentLength=input.messages[1].content.length;assert(sentLength>24000&&sentLength<60000);
    const data=JSON.parse(input.messages[1].content);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'Long synthetic source',content:'A source-bound explanation.',sourceIds:[data.sources[0].id]})}}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const {kp}=await f.textbook('# Long source\n'+'A synthetic sentence about equal fractions. '.repeat(800));
  const job=(await f.request(`/knowledge-points/${kp.id}/lesson`,{method:'POST',data:{}})).value.data;
  assert.equal((await f.waitJob(job.id)).status,'completed');assert(sentLength>24000);
  const publicResponse=await fetch(f.origin+'/api/ai/chat',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'x'.repeat(24001)}]})});
  assert.equal(publicResponse.status,400);
});
