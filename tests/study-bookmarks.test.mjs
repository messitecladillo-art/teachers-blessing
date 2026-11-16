import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createBookmarkService} from '../learning/bookmarks.mjs';

const sha='a'.repeat(64),sha2='b'.repeat(64);
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'study-bookmarks-synthetic-'));
  let store=createStudyStore({dataDir:directory});
  await store.mutate(state=>{for(const user of ['A','B']){state.textbooks.push({id:'book'+user,userId:user,title:'Synthetic '+user,activeFileId:'file'+user});state.chapters.push({id:'chapter'+user,userId:user,textbookId:'book'+user,title:'Chapter '+user});state.fileRecords.push({id:'file'+user,userId:user,textbookId:'book'+user,status:'ready',sha256:sha,pages:[{number:1,text:'PRIVATE_SOURCE_'+user}],storedName:'PRIVATE_PATH_'+user});state.knowledgePoints.push({id:'kp'+user,userId:user,textbookId:'book'+user,chapterId:'chapter'+user,title:'Point '+user,revision:1,sourceAnchor:{fileId:'file'+user,sha256:sha,startPage:1,endPage:1},sourceText:'PRIVATE_POINT_'+user});}});
  let service=createBookmarkService({store});
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,data}));};
  const json=async req=>{const chunks=[];for await(const part of req)chunks.push(part);return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
  const server=http.createServer(async(req,res)=>{try{const user={id:req.headers['x-synthetic-user']||'A'};if(!await service.handle(req,res,new URL(req.url,'http://local').pathname,user,{json,send})){res.writeHead(404);res.end();}}catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:{code:error.code,message:error.message}}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('study-bookmarks-synthetic-'));await rm(resolved,{recursive:true,force:true});});
  return{get store(){return store;},async restart(){store=createStudyStore({dataDir:directory});service=createBookmarkService({store});},async request(route='',{user='A',method='GET',body}={}){const response=await fetch(origin+'/api/v1/bookmarks'+route,{method,headers:{'X-Synthetic-User':user,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();return{status:response.status,...result};}};
}

test('HTTP bookmark is unique under duplicate/concurrent POST, persists and deletes idempotently',async t=>{
  const h=await fixture(t),first=await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}});assert.equal(first.status,201);assert.equal(first.data.stale,false);assert.equal(first.data.route,'/textbook/bookA/kp/kpA');
  const repeats=await Promise.all(Array.from({length:4},()=>h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})));
  for(const value of repeats){assert.equal(value.status,200);assert.equal(value.data.id,first.data.id);assert.equal(value.data.updatedAt,first.data.updatedAt);}
  assert.equal((await h.store.snapshot()).artifacts.length,1);await h.restart();assert.equal((await h.request()).data.items[0].id,first.data.id);
  assert.equal((await h.request('/kpA',{method:'DELETE'})).data.deleted,true);assert.equal((await h.request('/kpA',{method:'DELETE'})).data.deleted,false);assert.deepEqual((await h.request()).data.items,[]);
});
test('HTTP list/POST/DELETE isolate owners and expose only metadata, never copied private content',async t=>{
  const h=await fixture(t);await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}});
  assert.deepEqual((await h.request('',{user:'B'})).data.items,[]);
  for(const result of [await h.request('',{user:'B',method:'POST',body:{knowledgePointId:'kpA'}}),await h.request('/kpA',{user:'B',method:'DELETE'})]){assert.equal(result.status,404);assert.equal(result.error.code,'NOT_FOUND');}
  await h.store.mutate(state=>Object.assign(state.artifacts[0],{content:'PRIVATE_ARTIFACT',sourceText:'PRIVATE_COPIED_SOURCE',secret:'SECRET'}));
  const serialized=JSON.stringify((await h.request()).data);assert.doesNotMatch(serialized,/PRIVATE_|SECRET|sourceText|storedName|pages/);assert.equal((await h.store.snapshot()).artifacts.length,1);
});
test('request body rejects unsupported metadata, arrays, blank IDs and bad methods',async t=>{
  const h=await fixture(t);for(const body of [{knowledgePointId:'kpA',title:'override'},[],null,{}, {knowledgePointId:' '},{knowledgePointId:'kp/A'}])assert.equal((await h.request('',{method:'POST',body})).status,400);
  assert.equal((await h.request('',{method:'PATCH',body:{}})).status,405);assert.equal((await h.request('/kpA')).status,405);assert.equal((await h.store.snapshot()).artifacts.length,0);
});
test('source revisions are stale until explicit valid rebookmark refreshes the same record',async t=>{
  const h=await fixture(t),first=(await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})).data;
  await h.store.mutate(state=>{const point=state.knowledgePoints.find(value=>value.id==='kpA');point.revision=2;point.title='Current title';});
  const stale=(await h.request()).data.items[0];assert.equal(stale.stale,true);assert.ok(stale.staleReasons.includes('source-revision-changed'));assert.equal(stale.canOpen,true);assert.equal(stale.title,'Point A');assert.equal(stale.currentTitle,'Current title');
  const refreshed=(await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})).data;assert.equal(refreshed.id,first.id);assert.equal(refreshed.sourceRevision,2);assert.equal(refreshed.stale,false);assert.equal((await h.store.snapshot()).artifacts.length,1);
});
test('archived points remain honest stale metadata and can be removed but cannot be added',async t=>{
  const h=await fixture(t);await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}});await h.store.mutate(state=>{state.knowledgePoints.find(value=>value.id==='kpA').archived=true;});
  const value=(await h.request()).data.items[0];assert.equal(value.stale,true);assert.equal(value.canOpen,false);assert.equal(value.route,null);assert.equal((await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})).status,409);assert.equal((await h.request('/kpA',{method:'DELETE'})).status,200);
});
test('deleted or mismatched parent chain is omitted without leaking saved titles',async t=>{
  const h=await fixture(t);await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}});await h.store.mutate(state=>{state.chapters.find(value=>value.id==='chapterA').textbookId='bookB';});
  assert.deepEqual((await h.request()).data.items,[]);assert.equal((await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})).status,404);
  await h.store.mutate(state=>{state.chapters.find(value=>value.id==='chapterA').textbookId='bookA';state.textbooks=state.textbooks.filter(value=>value.id!=='bookA');});assert.deepEqual((await h.request()).data.items,[]);assert.equal((await h.request('/kpA',{method:'DELETE'})).status,404);
});
test('file replacement, hash change, deleted source and invalid page range cannot create current bookmarks',async t=>{
  const h=await fixture(t);await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}});
  const mutations=[state=>{state.textbooks.find(value=>value.id==='bookA').activeFileId='new-file';},state=>{state.textbooks.find(value=>value.id==='bookA').activeFileId='fileA';state.fileRecords.find(value=>value.id==='fileA').sha256=sha2;},state=>{const file=state.fileRecords.find(value=>value.id==='fileA');file.sha256=sha;file.status='deleted';},state=>{state.fileRecords.find(value=>value.id==='fileA').status='ready';state.knowledgePoints.find(value=>value.id==='kpA').sourceAnchor.endPage=2;}];
  for(const mutate of mutations){await h.store.mutate(mutate);const value=(await h.request()).data.items[0];assert.equal(value.stale,true);assert.equal(value.canOpen,false);assert.equal((await h.request('',{method:'POST',body:{knowledgePointId:'kpA'}})).status,409);}
});
test('transaction rechecks ownership/source after asynchronous body parsing and unrelated routes return false',async t=>{
  const h=await fixture(t),service=createBookmarkService({store:h.store});let release;const wait=new Promise(resolve=>{release=resolve;});
  const pending=service.handle({method:'POST'},{},'/api/v1/bookmarks',{id:'A'},{json:async()=>{await wait;return{knowledgePointId:'kpA'};},send:()=>assert.fail('stale request must not send success')});
  await h.store.mutate(state=>{state.knowledgePoints.find(value=>value.id==='kpA').archived=true;});release();await assert.rejects(pending,error=>error.status===409&&error.code==='STALE_SOURCE');assert.equal((await h.store.snapshot()).artifacts.length,0);
  assert.equal(await service.handle({method:'GET'},{},'/api/v1/not-bookmarks',{id:'A'},{}),false);
});
