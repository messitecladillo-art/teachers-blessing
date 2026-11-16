import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createLearningService} from '../learning/services.mjs';
import {createStudyHandler} from '../learning/api.mjs';
import {identifyImportChapters,importChapterChunks} from '../learning/import-service.mjs';

function modelOutput(input){
  if(input.task==='book-import-knowledge')return JSON.stringify({knowledgePoints:[{title:input.chapter.title+' concept '+input.sourcePages[0].page,sourcePages:[...new Set(input.sourcePages.map(p=>p.page))]}]});
  if(input.task==='lesson')return JSON.stringify({title:'Synthetic lesson',content:'Synthetic source explanation; requires human review.',sourceIds:input.allowedSourceIds});
  throw new Error('Unexpected synthetic task');
}
async function fixture(t,opts={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'book-import-')),inputs=[],extractions=[];
  const model=async request=>{const input=request.messages.filter(m=>m.role==='user').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(v=>v?.task);inputs.push(input);return opts.model?opts.model(input,request):modelOutput(input);};
  const extract=opts.document?async(file,location,options,context)=>{extractions.push(options);return opts.extract?opts.extract(file,options,context):structuredClone(opts.document);}:undefined;
  let store=createStudyStore({dataDir:directory}),service=createLearningService({store,dataDir:directory,model,importExtractDocument:extract,maxDailyUnits:opts.maxDailyUnits??100}),handler=createStudyHandler({store,dataDir:directory,model,service,secureCookies:false});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let cookie='';
  async function request(route,{method='GET',body,raw,name='synthetic.pdf',other=false}={}){const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(!other&&cookie?{Cookie:cookie}:{}),...(raw?{'Content-Type':'application/octet-stream','X-File-Name':name}:body!==undefined?{'Content-Type':'application/json'}:{})},body:raw||(body!==undefined?JSON.stringify(body):undefined)});if(response.headers.get('set-cookie')&&!other)cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();return{status:response.status,...value};}
  const registered=await request('/auth/register',{method:'POST',body:{email:'synthetic-import@example.invalid',password:'Synthetic-Import-123',nickname:'Synthetic'}});assert.equal(registered.status,201);
  const book=(await request('/textbooks',{method:'POST',body:{title:'Synthetic textbook'}})).data;
  const upload=await request('/textbooks/'+book.id+'/files',{method:'POST',raw:opts.raw||Buffer.from('%PDF-Synthetic mock-extractor input'),name:opts.name||'synthetic.pdf'});assert.equal(upload.status,201);
  const wait=async id=>{for(let n=0;n<2000;n++){const result=await request('/jobs/'+id);if(!['queued','running','cancelling'].includes(result.data.status))return result.data;await new Promise(r=>setTimeout(r,10));}throw new Error('Import did not settle');};
  const start=body=>request('/textbooks/'+book.id+'/import',{method:'POST',body:body||{}});
  const restart=async()=>{await service.close();store=createStudyStore({dataDir:directory});service=createLearningService({store,dataDir:directory,model,importExtractDocument:extract,maxDailyUnits:opts.maxDailyUnits??100});handler=createStudyHandler({store,dataDir:directory,model,service,secureCookies:false});};
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('book-import-'));await rm(resolved,{recursive:true,force:true});});
  return{request,start,wait,book,inputs,extractions,restart,get store(){return store;}};
}
const document=(count=60,chapters=[{title:'Chapter 1: One real chapter',startPage:1,endPage:count,depth:0}])=>({pages:Array.from({length:count},(_,i)=>({number:i+1,text:(i===0?chapters[0].title+'\n':'')+'Synthetic source '+(i+1)+' '+('evidence '.repeat(60))})),outline:chapters,outlineMethod:'pdf-bookmarks',method:'pdf-text',partial:false,pendingPages:[],blockedPages:[],pageCount:count});

test('a sixty-page real chapter remains one chapter; chunks conserve every character',async t=>{
  const doc=document(),h=await fixture(t,{document:doc}),started=await h.start({prepareLessons:'none'});assert.equal(started.status,202);const done=await h.wait(started.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.chapters.length,1);assert.deepEqual([done.import.chapters[0].startPage,done.import.chapters[0].endPage],[1,60]);assert.ok(h.inputs.length>=3);const given=h.inputs.flatMap(v=>v.sourcePages);assert.equal(given.reduce((sum,p)=>sum+p.text.length,0),doc.pages.reduce((sum,p)=>sum+p.text.length,0));assert.deepEqual([...new Set(given.map(v=>v.page))],doc.pages.map(v=>v.number));
  const outline=(await h.request('/textbooks/'+h.book.id+'/outline')).data;assert.equal(outline.chapters.length,1);assert.equal(outline.outlineMethod,'pdf-bookmarks');assert.equal(outline.directoryNeedsReview,false);assert.equal(outline.requiresReview,true);
});

test('two chapters inside twenty pages remain separate and full-book lessons make each learnable',async t=>{
  const doc=document(20,[{title:'Chapter 1: First',startPage:1,endPage:10,depth:0},{title:'Chapter 2: Second',startPage:11,endPage:20,depth:0}]),h=await fixture(t,{document:doc}),start=await h.start();const done=await h.wait(start.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.chapters.length,2);assert.ok(done.import.chapters.every(c=>c.status==='ready'&&c.learnable&&c.lessonCount));assert.equal(done.result.fullCourseReady,true);assert.equal(h.inputs.filter(v=>v.task==='book-import-knowledge').length,2);assert.ok(h.inputs.every(v=>v.task!=='book-import-knowledge'||v.sourcePages.every(p=>p.page>=v.chapter.startPage&&p.page<=v.chapter.endPage)));
});

test('OCR advances automatically across batches without consuming page count as model units',async t=>{
  const doc=document(12);doc.pages.forEach(p=>p.text='');doc.partial=true;doc.pendingPages=doc.pages.map(p=>p.number);
  const h=await fixture(t,{document:doc,extract:async(file,options)=>{const value=structuredClone(doc);if(options.ocr){value.pages=structuredClone(file.pages);for(let p=options.startPage;p<=options.endPage;p++)value.pages[p-1].text='Synthetic OCR source page '+p;}value.partial=value.pages.some(p=>!p.text);value.pendingPages=value.pages.filter(p=>!p.text).map(p=>p.number);return value;}}),start=await h.start({prepareLessons:'none'}),done=await h.wait(start.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.counts.ocrAttemptedPages,12);assert.equal(done.import.counts.readablePages,12);assert.equal(h.extractions.filter(v=>v.ocr).length,3);assert.ok(h.extractions.filter(v=>v.ocr).every(v=>v.ocrPages<=5&&v.importOcrOnly));const ledger=(await h.store.snapshot()).ledger;assert.equal(ledger.filter(v=>v.unit==='local-import-ocr-pages').reduce((sum,v)=>sum+v.units,0),0);assert.equal(done.import.counts.modelCalls,1);
});

test('budget pause and disk restart resume only unfinished model fragments',async t=>{
  const h=await fixture(t,{document:document()}),started=await h.start({prepareLessons:'none',maxModelCalls:1}),paused=await h.wait(started.data.id);assert.equal(paused.status,'interrupted');assert.equal(paused.import.phase,'budget-paused');assert.equal(h.inputs.length,1);await h.restart();const resumed=await h.request('/jobs/'+started.data.id+'/resume',{method:'POST',body:{maxModelCalls:10}});assert.equal(resumed.status,202);const done=await h.wait(started.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));const keys=h.inputs.map(v=>v.chapter.id+':'+v.sourcePages.map(p=>[p.page,p.startOffset,p.endOffset].join('-')).join(','));assert.equal(new Set(keys).size,keys.length);assert.equal(h.extractions.length,1);
});

test('no reliable directory blocks instead of making page groups; manual review resumes',async t=>{
  const doc=document(12);doc.outlineMethod='page-groups';doc.outline=[{title:'Pages 1-10 pending revision',startPage:1,endPage:10}];doc.pages.forEach(p=>p.text='Plain body with no real chapter heading.');const h=await fixture(t,{document:doc}),start=await h.start({prepareLessons:'none'}),paused=await h.wait(start.data.id);assert.equal(paused.status,'interrupted');assert.equal(paused.import.phase,'awaiting-outline-review');assert.equal(paused.import.chapters.length,0);assert.equal(h.inputs.length,0);assert.equal((await h.request('/textbooks/'+h.book.id+'/outline')).data.directoryNeedsReview,true);const edited=await h.request('/textbooks/'+h.book.id+'/outline',{method:'PATCH',body:{chapters:[{title:'User verified real chapter',startPage:1,endPage:12,knowledgePoints:[{title:'Verified unit'}]}]}});assert.equal(edited.status,200);assert.equal((await h.request('/jobs/'+start.data.id+'/resume',{method:'POST',body:{}})).status,202);const done=await h.wait(start.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.chapters[0].title,'User verified real chapter');
});

test('cancellation preserves completed source chunks and rejects late model output',async t=>{
  let entered,release;const gate=new Promise(r=>entered=r);let calls=0;const h=await fixture(t,{document:document(),model:async input=>{if(++calls===2){entered();await new Promise(r=>release=r);}return modelOutput(input);}}),start=await h.start({prepareLessons:'none'});await gate;assert.equal((await h.request('/jobs/'+start.data.id+'/cancel',{method:'POST',body:{}})).status,200);release();const done=await h.wait(start.data.id);assert.equal(done.status,'cancelled');const state=await h.store.snapshot();assert.equal(Object.values(done.import.steps).filter(v=>v.status==='done').length,2);assert.equal(state.jobs.filter(j=>j.payload?.parentImportId===done.id&&j.status==='completed').length,2);assert.equal(state.knowledgePoints.length,0);assert.equal((await h.request('/textbooks/'+h.book.id+'/import',{other:true})).status,401);
});

test('manual outline mutation prevents delayed AI structure from overwriting current course',async t=>{
  let entered,release;const gate=new Promise(r=>entered=r),h=await fixture(t,{document:document(4),model:async input=>{entered();await new Promise(r=>release=r);return modelOutput(input);}}),start=await h.start({prepareLessons:'none'});await gate;const edited=await h.request('/textbooks/'+h.book.id+'/outline',{method:'PATCH',body:{chapters:[{title:'Manual change',startPage:1,endPage:4,knowledgePoints:[{title:'Human preserved'}]}]}});assert.equal(edited.status,200);release();const done=await h.wait(start.data.id);assert.equal(done.status,'failed');assert.equal(done.error.code,'IMPORT_OUTLINE_CONFLICT');assert.equal((await h.request('/textbooks/'+h.book.id+'/outline')).data.chapters[0].title,'Manual change');
});

test('physical heading alignment corrects printed TOC offsets and excludes nested/book-like page groups',()=>{
  const pages=Array.from({length:16},(_,i)=>({number:i+1,text:i===0?'Contents\nChapter 1: First .... 1\nChapter 2: Second .... 7':i===4?'Chapter 1: First\nBody':i===10?'Chapter 2: Second\nBody':'Plain body'}));const result=identifyImportChapters({pages,outlineMethod:'visible-toc',method:'pdf-text',outline:[{title:'Chapter 1: First',startPage:1},{title:'Chapter 2: Second',startPage:7}]});assert.deepEqual(result.chapters.map(v=>v.startPage),[5,11]);const nested=identifyImportChapters({pages,outlineMethod:'pdf-bookmarks',outline:[{title:'Chapter 1: First',startPage:5},{title:'1.1 Subheading',startPage:6},{title:'Chapter 2: Second',startPage:11}]});assert.equal(nested.chapters.length,2);assert.equal(identifyImportChapters({pages:[{number:1,text:'目录\n第 一 章 分数\n第 二 章 相加'}],method:'pdf-text'}).chapters.length,0);assert.equal(identifyImportChapters({pages:[{number:1,text:'第 一 章 分数\n正文'}],method:'pdf-text'}).chapters.length,1);
});

test('actual self-authored Markdown passes isolated extraction and one-action structure/lessons',async t=>{
  const h=await fixture(t,{raw:Buffer.from('# 第一章 等分\n平均分使单位相等。\n\n# 第二章 相加\n同分母相加合并单位个数。'),name:'selfauthored.md'}),start=await h.start(),done=await h.wait(start.data.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.chapters.length,2);assert.equal(done.import.counts.readyChapters,2);assert.equal(done.import.outlineMethod,'markdown-headings');
});

test('a partial scan prefix never becomes a complete one-chapter directory and OCR small-summary noise is excluded',()=>{
  const pages=Array.from({length:20},(_,i)=>({number:i+1,text:i===8?'目录\n第 一 章 分数 .... 1\n第 二 章 相加 .... 7':i===9?'第四章小缚seesesese 271':i===10?'第 一 章 分数\n真实正文':''}));
  assert.equal(identifyImportChapters({pages,method:'pdf-text'},[],{attemptedPages:Array.from({length:11},(_,i)=>i+1)}).chapters.length,0);
  pages[16].text='第 二 章 相加\n真实正文';const found=identifyImportChapters({pages,method:'pdf-text'},[],{attemptedPages:pages.map(p=>p.number)});assert.deepEqual(found.chapters.map(c=>c.startPage),[11,17]);assert.equal(found.chapters.length,2);
});

test('starting and cancelling a replacement import preserves existing course and lessons',async t=>{
  let hold=false,entered,release;const gate=new Promise(r=>entered=r),h=await fixture(t,{document:document(4),model:async input=>{if(hold){entered();await new Promise(r=>release=r);}return modelOutput(input);}});
  const first=await h.start();assert.equal((await h.wait(first.data.id)).status,'completed');const old=(await h.request('/textbooks/'+h.book.id+'/outline')).data.knowledgePoints[0];assert.equal((await h.request('/knowledge-points/'+old.id+'/lesson')).data.items.length,1);
  hold=true;const next=await h.start();await gate;assert.ok((await h.request('/textbooks/'+h.book.id+'/outline')).data.knowledgePoints.some(p=>p.id===old.id));await h.request('/jobs/'+next.data.id+'/cancel',{method:'POST',body:{}});const cancelled=await h.wait(next.data.id);assert.equal(cancelled.status,'cancelled');assert.equal((await h.request('/knowledge-points/'+old.id+'/lesson')).data.items.length,1);release();
});

test('a newly uploaded file prevents an old in-flight import from publishing',async t=>{
  let entered,release;const gate=new Promise(r=>entered=r),h=await fixture(t,{document:document(4),model:async input=>{entered();await new Promise(r=>release=r);return modelOutput(input);}}),start=await h.start({prepareLessons:'none'});await gate;
  const replacement=await h.request('/textbooks/'+h.book.id+'/files',{method:'POST',raw:Buffer.from('%PDF-New synthetic replacement'),name:'replacement.pdf'});assert.equal(replacement.status,201);release();const done=await h.wait(start.data.id);assert.equal(done.status,'failed');assert.equal(done.error.code,'IMPORT_SOURCE_CONFLICT');assert.equal((await h.store.snapshot()).knowledgePoints.length,0);
});

test('timed-out OCR batches shrink automatically and blank attempted pages terminate honestly',async t=>{
  const doc=document(7);doc.pages.forEach(p=>p.text='');let timeout=true;
  const h=await fixture(t,{document:doc,extract:async(file,options)=>{if(options.ocr&&timeout){timeout=false;throw Object.assign(new Error('Synthetic deadline'),{status:504,code:'DOCUMENT_TIMEOUT'});}const value=structuredClone(doc);if(options.ocr){value.pages=structuredClone(file.pages);for(let p=options.startPage;p<=options.endPage;p++)if(p!==7)value.pages[p-1].text='Synthetic recognized source '+p;}return value;}}),start=await h.start({prepareLessons:'none'}),done=await h.wait(start.data.id);
  assert.equal(done.status,'completed');assert.equal(done.import.ocrBatchSize,2);assert.equal(done.import.counts.ocrAttemptedPages,7);assert.equal(done.import.phase,'partial');assert.equal(done.result.partial,true);assert.equal(done.result.fullCourseReady,false);assert.equal(done.import.counts.readablePages,6);assert.ok(done.import.warnings.some(v=>v.includes('未取得')||v.includes('无文字')));
});

test('full import also accounts for pending frontmatter outside trustworthy chapter bookmarks',async t=>{
  const doc=document(10,[{title:'Chapter 1: Real content',startPage:5,endPage:10,depth:0}]);doc.pages.forEach(p=>p.text='');
  const h=await fixture(t,{document:doc,extract:async(file,options)=>{const value=structuredClone(doc);if(options.ocr){value.pages=structuredClone(file.pages);for(let page=options.startPage;page<=options.endPage;page++)value.pages[page-1].text='Synthetic page '+page;}return value;}}),started=await h.start({prepareLessons:'none'}),done=await h.wait(started.data.id);
  assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.import.counts.ocrAttemptedPages,10);assert.equal(done.import.counts.readablePages,10);assert.deepEqual(done.import.nonChapterPages.pages,[1,2,3,4]);assert.equal(done.import.chapters.length,1);assert.equal(done.import.chapters[0].startPage,5);assert.equal(done.result.partial,false);assert.ok(h.inputs.every(input=>input.task!=='book-import-knowledge'||input.sourcePages.every(page=>page.page>=5)));
});
