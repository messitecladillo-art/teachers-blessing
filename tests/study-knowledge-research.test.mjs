import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createKnowledgeResearch,validateKnowledgeResearch} from '../learning/knowledge-research.mjs';

const SHA='a'.repeat(64);
const output=()=>({content:'Synthetic synthesis from public search-index snippets; not a full-page or video review.',sources:[{id:'z1',url:'https://www.zhihu.com/question/100/answer/200',title:'Synthetic public explanation',access:'search-index'},{id:'b1',url:'https://www.bilibili.com/video/BV1000000001',title:'Synthetic video search result',access:'search-index'}],searchedAt:new Date().toISOString(),toolCalls:1,search:{executed:true,toolCalls:1,method:'provider-web-search'},usage:{inputTokens:10,outputTokens:20,webSearchCalls:1}});
function deferred(){let finish;const v={done:false,promise:new Promise(r=>finish=r),resolve:x=>{v.done=true;finish(x);}};return v;}
async function fixture(t,{provider=async()=>output(),maxDailyUnits=100,jobTimeoutMs=3000}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'study-research-'));let store=createStudyStore({dataDir:dir}),module;
  await store.mutate(s=>{for(const owner of ['a','b']){s.textbooks.push({id:'book-'+owner,userId:owner,title:'Public textbook '+owner,activeFileId:'file-'+owner});s.chapters.push({id:'chapter-'+owner,userId:owner,textbookId:'book-'+owner,title:'Public chapter '+owner});s.fileRecords.push({id:'file-'+owner,userId:owner,textbookId:'book-'+owner,sha256:SHA,status:'ready',storedName:'private-file-location',pages:[{number:1,text:'PRIVATE_SOURCE_NOT_FOR_WEB'}]});for(let n=1;n<=3;n++)s.knowledgePoints.push({id:'kp-'+owner+n,userId:owner,textbookId:'book-'+owner,chapterId:'chapter-'+owner,title:'Public concept '+owner+n,sourceText:'PRIVATE_SOURCE_NOT_FOR_WEB',revision:1,sourceAnchor:{fileId:'file-'+owner,sha256:SHA,startPage:1,endPage:1}});}s.highlights.push({id:'private-note',userId:'a',note:'PRIVATE_NOTE_NOT_FOR_WEB'});});
  function setup(){module=createKnowledgeResearch({store,provider,maxDailyUnits,jobTimeoutMs});}setup();
  const server=http.createServer(async(req,res)=>{try{const json=async()=>{const parts=[];for await(const part of req){parts.push(part);if(parts.reduce((n,p)=>n+p.length,0)>8192)throw Object.assign(new Error('too large'),{status:413});}return JSON.parse(Buffer.concat(parts).toString()||'{}');},send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,data}));};if(!await module.handle(req,res,new URL(req.url,'http://local').pathname,{id:req.headers['x-owner']||'a'},{json,send})){res.writeHead(404);res.end('{}');}}catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:{code:error.code,message:error.researchPublic?error.message:'Request failed'}}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await module.close();server.closeAllConnections();await new Promise(r=>server.close(r));const target=path.resolve(dir);assert.equal(path.dirname(target).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(target).startsWith('study-research-'));await rm(target,{recursive:true,force:true});});
  async function request(route,{method='GET',body,owner='a'}={}){const r=await fetch(origin+'/api/v1'+route,{method,headers:{'X-Owner':owner,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,...await r.json()};}
  async function until(fn){const end=Date.now()+5000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw new Error('Synthetic research did not settle');}
  const wait=id=>until(async()=>{const j=(await store.snapshot()).jobs.find(j=>j.id===id);return j&&!['queued','running','cancelling'].includes(j.status)?j:null;});
  const start=async(kp='kp-a1')=>{const r=await request('/knowledge-points/'+kp+'/research',{method:'POST',body:{}});assert.equal(r.status,202,JSON.stringify(r));return r.data;};
  return{request,wait,until,start,get store(){return store;},get module(){return module;},async restart(){await module.close();store=createStudyStore({dataDir:dir});setup();},provider};
}

test('public-title research sends no private source or notebook and saves explicit indexed evidence',async t=>{
  let captured;const h=await fixture(t,{provider:async args=>{captured=args;return output();}}),job=await h.start(),done=await h.wait(job.id);assert.equal(done.status,'completed');assert.equal(done.result.status,'generated-review-required');assert.deepEqual(Object.keys(captured).sort(),['bookTitle','chapterTitle','knowledgePointTitle','signal']);assert.equal(captured.bookTitle,'Public textbook a');assert.ok(!JSON.stringify(captured).includes('PRIVATE_'));
  const response=await h.request('/knowledge-points/kp-a1/research');assert.equal(response.status,200);assert.equal(response.data.configured,true);const item=response.data.items[0];assert.equal(item.id,done.result.artifactId);assert.equal(item.type,'knowledge-research');assert.equal(item.stale,false);assert.equal(item.requiresHumanReview,true);assert.equal(item.sources[0].platform,'zhihu');assert.equal(item.sources[1].platform,'bilibili');assert.ok(item.sources.every(s=>s.access==='search-index'));assert.equal(item.fileSha256,SHA);assert.equal(item.sourceRevision,1);assert.ok(!JSON.stringify(item).includes('private-file-location'));
  await h.store.mutate(s=>{s.knowledgePoints.find(k=>k.id==='kp-a1').revision++;});const stale=await h.request('/knowledge-points/kp-a1/research');assert.equal(stale.data.items[0].stale,true);assert.equal(stale.data.items[0].content,item.content);
});

test('empty executed search persists no-results and cannot retain unsupported synthesis',async t=>{
  const h=await fixture(t,{provider:async()=>({...output(),content:'UNSUPPORTED_CLAIM_MUST_NOT_BE_PUBLISHED',sources:[]})}),done=await h.wait((await h.start()).id);assert.equal(done.status,'completed');assert.equal(done.result.status,'no-results');const item=(await h.request('/knowledge-points/kp-a1/research')).data.items[0];assert.equal(item.status,'no-results');assert.deepEqual(item.sources,[]);assert.ok(!item.content.includes('UNSUPPORTED_CLAIM'));assert.match(item.content,/未获得可核验/);
});

test('unconfigured provider keeps history readable but creates no new jobs or reservations',async t=>{
  const provider=async()=>output(),h=await fixture(t,{provider});await h.wait((await h.start()).id);provider.configured=false;const before=await h.store.snapshot(),history=await h.request('/knowledge-points/kp-a1/research');assert.equal(history.data.configured,false);assert.equal(history.data.items.length,1);const denied=await h.request('/knowledge-points/kp-a1/research',{method:'POST',body:{}});assert.equal(denied.status,503);const after=await h.store.snapshot();assert.equal(after.jobs.length,before.jobs.length);assert.equal(after.ledger.length,before.ledger.length);await assert.rejects(h.module.runForImport({kpId:'kp-a1',user:{id:'a'}}),e=>e.status===503);
});

test('same-point mutex, owner chain, cancel late result and hard daily attempt budget',async t=>{
  const gate=deferred(),entered=[];t.after(()=>gate.resolve());const h=await fixture(t,{maxDailyUnits:2,provider:async args=>{entered.push(args.knowledgePointTitle);await gate.promise;return output();}}),a=await h.start();await h.until(()=>entered.length===1);
  assert.equal((await h.request('/knowledge-points/kp-a1/research',{method:'POST',body:{}})).status,409);for(const route of ['/knowledge-points/kp-a1/research','/jobs/'+a.id])assert.equal((await h.request(route,{owner:'b'})).status,404);for(const action of ['cancel','resume'])assert.equal((await h.request('/jobs/'+a.id+'/'+action,{owner:'b',method:'POST',body:{}})).status,404);assert.equal((await h.request('/knowledge-points/kp-a1/research',{owner:'b',method:'POST',body:{}})).status,404);
  const b=await h.start('kp-a2');await h.until(()=>entered.length===2);const before=await h.store.snapshot(),third=await h.request('/knowledge-points/kp-a3/research',{method:'POST',body:{}});assert.equal(third.status,429);assert.equal((await h.store.snapshot()).jobs.length,before.jobs.length);
  await h.request('/jobs/'+a.id+'/cancel',{method:'POST',body:{}});assert.equal((await h.wait(a.id)).status,'cancelled');gate.resolve();assert.equal((await h.wait(b.id)).status,'completed');assert.equal((await h.request('/knowledge-points/kp-a1/research')).data.items.length,0);assert.equal((await h.request('/knowledge-points/kp-a3/research',{method:'POST',body:{}})).status,429);const state=await h.store.snapshot();assert.ok(state.ledger.every(r=>r.status==='settled'));
});

test('revision, file replacement, deletion and archived parent all reject late research publication',async t=>{
  for(const mutate of [s=>{s.knowledgePoints.find(k=>k.id==='kp-a1').revision++;},s=>{s.fileRecords.push({id:'new-file-id',userId:'a',textbookId:'book-a',sha256:'b'.repeat(64),status:'uploaded'});},s=>{s.fileRecords.find(f=>f.id==='file-a').status='deleted';},s=>{s.chapters.find(c=>c.id==='chapter-a').archived=true;},s=>{s.textbooks=s.textbooks.filter(b=>b.id!=='book-a');}]){
    const gate=deferred(),entered=deferred();t.after(()=>gate.resolve());const h=await fixture(t,{provider:async()=>{entered.resolve();await gate.promise;return output();}}),job=await h.start();await h.until(()=>entered.done);await h.store.mutate(mutate);gate.resolve();const done=await h.wait(job.id);assert.equal(done.status,'failed');assert.equal((await h.store.snapshot()).artifacts.length,0);
  }
});

test('bad URL, fake execution, invalid annotation and oversized output cannot become saved research',async t=>{
  for(const bad of [()=>({...output(),sources:[{url:'http://www.zhihu.com/question/1',title:'x',access:'search-index'}]}),()=>({...output(),sources:[{url:'https://name:synthetic-secret@example.org/path',title:'x',access:'search-index'}]}),()=>({...output(),sources:[{url:'https://127.0.0.1/internal',title:'x',access:'search-index'}]}),()=>({...output(),toolCalls:0}),()=>({...output(),annotations:[{url:'https://example.org/fabricated',sourceId:'z1'}]}),()=>({...output(),content:'x'.repeat(30001)})]){
    const h=await fixture(t,{provider:async()=>bad()}),done=await h.wait((await h.start()).id);assert.equal(done.status,'failed');assert.equal((await h.store.snapshot()).artifacts.length,0);assert.ok(!JSON.stringify(done.error).includes('synthetic-secret'));
  }
});

test('normal service restart preserves history and requires explicit resume without automatic search',async t=>{
  const entered=deferred();let calls=0,block=true;const h=await fixture(t,{provider:async()=>{calls++;entered.resolve();if(block)await new Promise(()=>{});return output();}}),job=await h.start();await h.until(()=>entered.done);await h.restart();block=false;const stopped=(await h.request('/jobs/'+job.id)).data;assert.equal(stopped.status,'interrupted');assert.equal(calls,1);const resumed=await h.request('/jobs/'+job.id+'/resume',{method:'POST',body:{}});assert.equal(resumed.status,202);assert.equal(resumed.data.id,job.id);const done=await h.wait(job.id);assert.equal(done.status,'completed');assert.equal(calls,2);assert.equal((await h.request('/knowledge-points/kp-a1/research')).data.items.length,1);assert.equal((await h.store.snapshot()).ledger.filter(r=>r.status==='settled').length,2);
});

test('import seam spends no duplicate job budget and publishes atomically with idempotent result ID',async t=>{
  const h=await fixture(t),before=await h.store.snapshot(),result=await h.module.runForImport({kpId:'kp-a1',user:{id:'a'},signal:new AbortController().signal}),after=await h.store.snapshot();assert.equal(after.jobs.length,before.jobs.length);assert.equal(after.ledger.length,before.ledger.length);const first=await h.store.mutate(s=>h.module.publishForImport(s,{kpId:'kp-a1',user:{id:'a'},result,importJobId:'synthetic-import'})),again=await h.store.mutate(s=>h.module.publishForImport(s,{kpId:'kp-a1',user:{id:'a'},result}));assert.equal(again.id,first.id);assert.equal((await h.store.snapshot()).artifacts.length,1);await h.store.mutate(s=>{s.knowledgePoints.find(k=>k.id==='kp-a1').revision++;});await assert.rejects(h.store.mutate(s=>h.module.publishForImport(s,{kpId:'kp-a1',user:{id:'a'},result})),e=>e.code==='RESEARCH_SOURCE_CHANGED');assert.equal((await h.store.snapshot()).artifacts.length,1);
});

test('import and interactive research share the same-point mutex without adding an import ledger',async t=>{
  const entered=deferred(),gate=deferred();t.after(()=>gate.resolve());const h=await fixture(t,{provider:async()=>{entered.resolve();await gate.promise;return output();}}),pending=h.module.runForImport({kpId:'kp-a1',user:{id:'a'},signal:new AbortController().signal});await h.until(()=>entered.done);const before=await h.store.snapshot();assert.equal((await h.request('/knowledge-points/kp-a1/research',{method:'POST',body:{}})).status,409);await assert.rejects(h.module.runForImport({kpId:'kp-a1',user:{id:'a'}}),e=>e.status===409);assert.equal((await h.store.snapshot()).jobs.length,before.jobs.length);assert.equal((await h.store.snapshot()).ledger.length,before.ledger.length);gate.resolve();await pending;
});

test('timeout and unknown upstream errors return bounded failures without private diagnostics',async t=>{
  const h=await fixture(t,{jobTimeoutMs:40,provider:async()=>new Promise(()=>{})}),timeout=await h.wait((await h.start()).id);assert.equal(timeout.status,'failed');assert.equal(timeout.error.code,'RESEARCH_TIMEOUT');const second=await fixture(t,{provider:async()=>{throw new Error('SYNTHETIC_SECRET_IN_PRIVATE_PATH C:/private/example');}}),failed=await second.wait((await second.start()).id);assert.equal(failed.status,'failed');assert.ok(!JSON.stringify(failed.error).includes('SYNTHETIC_SECRET'));assert.ok(!JSON.stringify(failed.error).includes('C:/private'));
});

test('requests cannot inject private body fields or change a pinned failed job to another source',async t=>{
  const h=await fixture(t,{provider:async()=>{throw new Error('Synthetic upstream failure');}});for(const body of [{notes:'PRIVATE_NOTE'},[],null,{url:'https://example.org'}])assert.equal((await h.request('/knowledge-points/kp-a1/research',{method:'POST',body})).status,400);assert.equal((await h.store.snapshot()).jobs.length,0);const job=await h.start();await h.wait(job.id);await h.store.mutate(s=>{s.knowledgePoints.find(k=>k.id==='kp-a1').revision++;});assert.equal((await h.request('/jobs/'+job.id+'/resume',{method:'POST',body:{}})).status,409);
});

test('indexed-result validator fixes platform labels and never upgrades access to full text',()=>{
  const raw=output();raw.sources[0].platform='certified-full-text';const result=validateKnowledgeResearch(raw);assert.equal(result.sources[0].platform,'zhihu');assert.equal(result.access,'search-index');assert.equal(result.requiresHumanReview,true);assert.throws(()=>validateKnowledgeResearch({...output(),sources:[{url:'https://example.org/x',title:'x',access:'full-text'}]}));
  const indexed={...output(),content:'  keep original offsets  ',annotations:[{sourceId:'z1',url:output().sources[0].url,startIndex:2,endIndex:6}]};assert.equal(validateKnowledgeResearch(indexed).content,indexed.content);assert.throws(()=>validateKnowledgeResearch({...indexed,annotations:[{...indexed.annotations[0],startIndex:6,endIndex:2}]}));
});

test('frozen B07 adapter and B08 persistence compose with real-shaped tool evidence and zero external fetch',async t=>{
  const {createWebResearchProvider}=await import('../learning/web-research-provider.mjs');let requests=0;const url='https://www.zhihu.com/question/123456',content='合成公开检索线索，尚未核对教材原文。',provider=createWebResearchProvider({apiUrl:'https://operator.example/v1/chat/completions',apiKey:'synthetic-composition-key-not-real',model:'synthetic-web-model',fetch:async()=>{requests++;return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',id:'synthetic-search',status:'completed',action:{type:'search',sources:[{url,title:'合成公开解释'}]}},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:content,annotations:[{type:'url_citation',url,title:'合成公开解释',start_index:0,end_index:8}]}]}]}),{headers:{'Content-Type':'application/json'}});}}),h=await fixture(t,{provider}),done=await h.wait((await h.start()).id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(requests,1);const item=(await h.request('/knowledge-points/kp-a1/research')).data.items[0];assert.equal(item.content,content);assert.equal(item.sources[0].url,url);assert.equal(item.annotations[0].sourceId,item.sources[0].id);assert.equal(item.access,'search-index');
});
