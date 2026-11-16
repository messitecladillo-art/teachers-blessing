import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createStudyStore } from '../learning/store.mjs';
import { createStudyHandler } from '../learning/api.mjs';
import { createLearningService } from '../learning/services.mjs';

function complete(input) {
  const ids=[input.allowedSourceIds[0]],refs=()=>[...ids],duration=input.teachingTask.durationMinutes;
  return {sourceIds:refs(),lessonPlan:{objectives:['能解释等分单位。'],steps:[{title:'解释与检验',minutes:duration,teacherMoves:'TEACHER_MOVE_SECRET',studentTask:'画图并解释。',check:'CHECK_SECRET',sourceIds:refs()}],sourceIds:refs()},diagram:{kind:'process',title:'等分解释图',nodes:[{id:'n1',label:'等分单位',sourceIds:refs()},{id:'n2',label:'解释相加',sourceIds:refs()}],edges:[{from:'n1',to:'n2',label:'保持相同单位',sourceIds:refs()}],sourceIds:refs()},worksheet:{title:'学生任务单',instructions:'请根据教材完成任务。',questions:[{id:'w1',stem:'如何解释分数表示的等分？',sourceIds:refs()}],sourceIds:refs()},assessment:{questions:[{id:'a1',stem:'请举一个等分单位保持相同的例子。',sourceIds:refs()}],criteria:['RUBRIC_SECRET'],sourceIds:refs()},teacherAnswers:[{questionId:'w1',answer:'TEACHER_SECRET_ANSWER',rationale:'TEACHER_SECRET_RATIONALE',sourceIds:refs()},{questionId:'a1',answer:'SECOND_SECRET_ANSWER',rationale:'SECOND_SECRET_RATIONALE',sourceIds:refs()}],reflection:{prompts:['REFLECTION_PROMPT_SECRET'],sourceIds:refs()}};
}
function syntheticPagePdf(texts) {
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${texts.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${texts.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  texts.forEach((text,i)=>{const stream='BT /F1 12 Tf 40 760 Td '+(text?`(${text.replace(/[\\()]/g,'\\$&')}) Tj`:'')+' ET';objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);});
  let pdf='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
async function fixture(t, options={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'study-teaching-')),inputs=[];
  const model=options.configured===false?undefined:async request=>{const input=request.messages.filter(m=>m.role==='user').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(v=>v?.task==='teaching-pack');inputs.push(input);return options.model?options.model(input,request):JSON.stringify(complete(input));};
  let store=createStudyStore({dataDir:directory}),service=createLearningService({store,dataDir:directory,model}),handler=createStudyHandler({store,dataDir:directory,model,service});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('study-teaching-'));await rm(resolved,{recursive:true,force:true});});
  async function request(route,{cookie,method='GET',body,raw,name='synthetic.md'}={}){const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(raw?{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)}:body!==undefined?{'Content-Type':'application/json'}:{})},body:raw||(body!==undefined?JSON.stringify(body):undefined)});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={text};}return{status:response.status,data:value.data,error:value.error,text:value.text,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function signup(name){const r=await request('/auth/register',{method:'POST',body:{email:name+'@example.invalid',password:'Synthetic-pass-123',nickname:name}});assert.equal(r.status,201);return r.cookie;}
  async function wait(id,cookie){for(let i=0;i<500;i++){const r=await request('/jobs/'+id,{cookie});assert.equal(r.status,200);if(!['queued','running','cancelling'].includes(r.data.status))return r.data;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Synthetic teaching job did not settle');}
  const cookie=await signup('teaching-a'),other=await signup('teaching-b');
  const book=(await request('/textbooks',{cookie,method:'POST',body:{title:'合成分数教材'}})).data;
  assert.equal((await request('/textbooks/'+book.id+'/files',{cookie,method:'POST',raw:options.sourceRaw||Buffer.from('# Fractions\nA fraction describes equal parts.\n\n# Addition\nUse the same unit when adding fractions.'),name:options.sourceName||'synthetic.md'})).status,201);
  const parse=await request('/textbooks/'+book.id+'/parse',{cookie,method:'POST',body:{}});assert.equal((await wait(parse.data.id,cookie)).status,'completed');
  const outline=(await request('/textbooks/'+book.id+'/outline',{cookie})).data;
  async function pack(){const r=await request('/textbooks/'+book.id+'/teaching-packs',{cookie,method:'POST',body:{title:'分数一课时',task:{grade:'初中',subject:'数学',durationMinutes:40,goal:'解释等分单位并检查理解',priorKnowledge:'本人提供：接触过分数表示'},scope:{chapterIds:[outline.chapters[0].id]}}});assert.equal(r.status,201,JSON.stringify(r));return r.data;}
  async function generate(packId){const r=await request('/teaching-packs/'+packId+'/generate',{cookie,method:'POST',body:{}});assert.equal(r.status,202,JSON.stringify(r));return wait(r.data.id,cookie);}
  async function restart(){await service.close();store=createStudyStore({dataDir:directory});service=createLearningService({store,dataDir:directory,model});handler=createStudyHandler({store,dataDir:directory,model,service});}
  return{request,wait,pack,generate,restart,cookie,other,book,outline,inputs,get store(){return store;}};
}
const route=(pack,version)=>'/teaching-packs/'+pack.id+'/versions'+(version?'/'+version.id:'');
const reviewBody=version=>({expectedRevision:version.revision,sourcesChecked:true,contentChecked:true,ageAppropriate:true,note:'REVIEW_NOTE_SECRET'});

test('page coverage describes the actual readable pages of a three-page source in model input, metadata and exports',async t=>{
  const h=await fixture(t,{sourceRaw:syntheticPagePdf(['','Equal parts of one whole use the same unit.','']),sourceName:'three-page-synthetic.pdf'}),p=await h.pack(),done=await h.generate(p.id);assert.equal(done.status,'completed',JSON.stringify(done));
  const v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data;
  const expected={totalPages:3,readablePageCount:1,missingPageCount:2,readablePages:[2],missingPages:[1,3],listTruncated:false,partial:true};
  assert.deepEqual(h.inputs[0].sources[0].pageCoverage,expected);assert.deepEqual(v.sourceVersions[0].pageCoverage,expected);assert.equal(v.coverage.partial,true);
  const revealed=(await h.request(route(p,v)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(revealed)});
  for(const format of ['md','html']){const exported=await h.request(route(p,v)+'/download?audience=student&format='+format,{cookie:h.cookie});assert.equal(exported.status,200);assert.match(exported.text,/该范围仅1\/3页有文字/);}
  await h.store.mutate(state=>{state.fileRecords.find(file=>file.textbookId===h.book.id).pages[0].text='New readable page in the selected range.';});
  assert.equal((await h.request(route(p,v),{cookie:h.cookie})).data.stale,true,'within-range page coverage is bound even if an old KP string/revision is unchanged');
});

test('page coverage denominator is the selected anchor and ignores blank pages outside it',async t=>{
  const h=await fixture(t,{sourceRaw:syntheticPagePdf(['','Equal parts source on the middle page.','']),sourceName:'selected-middle-synthetic.pdf'});
  // Explicit synthetic state fixture: normal partial-PDF outline editing is not claimed here.
  await h.store.mutate(state=>{const point=state.knowledgePoints.find(row=>row.id===h.outline.knowledgePoints[0].id),chapter=state.chapters.find(row=>row.id===point.chapterId);point.sourceAnchor.startPage=2;point.sourceAnchor.endPage=2;chapter.startPage=2;chapter.endPage=2;});
  const p=await h.pack(),done=await h.generate(p.id);assert.equal(done.status,'completed');const v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data;
  assert.deepEqual(v.sourceVersions[0].pageCoverage,{totalPages:1,readablePageCount:1,missingPageCount:0,readablePages:[2],missingPages:[],listTruncated:false,partial:false});assert.equal(v.coverage.partial,false);
  await h.store.mutate(state=>{const file=state.fileRecords.find(row=>row.textbookId===h.book.id);file.pages[0].text='Changed text outside the selected anchor.';file.pendingPages=[3];});
  assert.equal((await h.request(route(p,v),{cookie:h.cookie})).data.stale,false);
  await h.store.mutate(state=>{state.fileRecords.find(row=>row.textbookId===h.book.id).pages[1].text='  ';});
  const rejected=await h.request('/teaching-packs/'+p.id+'/generate',{cookie:h.cookie,method:'POST',body:{}});assert.equal(rejected.status,409);assert.equal(rejected.error.code,'TEACHING_SOURCE_EMPTY');assert.equal(h.inputs.length,1,'residual old KP text cannot trigger another model call when actual selected pages are empty');
});

test('page coverage lists are capped at twenty actual page numbers while counts retain the whole anchor',async t=>{
  const h=await fixture(t);
  // Isolated page-record fixture for the bounded metadata calculation; no real-user document.
  await h.store.mutate(state=>{const point=state.knowledgePoints.find(row=>row.id===h.outline.knowledgePoints[0].id),file=state.fileRecords.find(row=>row.id===point.sourceAnchor.fileId),chapter=state.chapters.find(row=>row.id===point.chapterId);file.pages=Array.from({length:45},(_,i)=>({number:i+1,text:i%2?'':'Synthetic readable text.'}));file.status='partial';point.sourceAnchor.startPage=1;point.sourceAnchor.endPage=45;chapter.startPage=1;chapter.endPage=45;});
  const p=await h.pack(),done=await h.generate(p.id);assert.equal(done.status,'completed');const coverage=h.inputs[0].sources[0].pageCoverage;
  assert.equal(coverage.totalPages,45);assert.equal(coverage.readablePageCount,23);assert.equal(coverage.missingPageCount,22);assert.deepEqual(coverage.readablePages,Array.from({length:20},(_,i)=>i*2+1));assert.deepEqual(coverage.missingPages,Array.from({length:20},(_,i)=>i*2+2));assert.equal(coverage.listTruncated,true);assert.equal(coverage.partial,true);
});

test('manual blank teaching pack is a persistent editable draft and needs no configured model',async t=>{
  const h=await fixture(t,{configured:false}),p=await h.pack();
  const draft=await h.request(route(p),{cookie:h.cookie,method:'POST',body:{}});assert.equal(draft.status,201);assert.equal(draft.data.origin,'human-created');assert.equal(draft.data.validation.complete,false);assert.equal(draft.data.content.lessonPlan.steps.length,1);assert.equal(draft.data.content.lessonPlan.steps[0].minutes,40);assert.equal(draft.data.content.diagram.nodes.length,2);assert.equal(draft.data.content.diagram.edges.length,1);assert.equal(draft.data.content.worksheet.questions.length,1);assert.equal(draft.data.content.assessment.questions.length,1);assert.equal(draft.data.content.teacherAnswers,undefined);
  assert.equal((await h.request(route(p,draft.data)+'/download',{cookie:h.cookie})).status,409);
  assert.equal((await h.request('/teaching-packs/'+p.id+'/generate',{cookie:h.cookie,method:'POST',body:{}})).status,503);
  await h.restart();const restored=await h.request(route(p,draft.data),{cookie:h.cookie});assert.equal(restored.status,200);assert.equal(restored.data.validation.complete,false);assert.equal(h.inputs.length,0);
});

test('AI pack citations, teacher reveal, review and safe student HTML form one owned durable workflow',async t=>{
  const h=await fixture(t),p=await h.pack(),done=await h.generate(p.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.result.collection,'teachingPackVersions');
  const v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data;assert.equal(v.validation.complete,true);assert.equal(v.content.teacherAnswers,undefined);assert.equal(v.sourceVersions[0].id,h.outline.knowledgePoints[0].id);assert.equal(h.inputs[0].teachingTask.durationMinutes,40);
  assert.equal((await h.request(route(p,v)+'?audience=teacher',{cookie:h.cookie})).status,403);
  const beforeReview=await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(v)});assert.equal(beforeReview.error.code,'TEACHER_REVIEW_REQUIRED');
  const revealed=(await h.request(route(p,v)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;assert.equal(revealed.content.teacherAnswers[0].answer,'TEACHER_SECRET_ANSWER');
  const reviewed=(await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(revealed)})).data;assert.equal(reviewed.reviewValid,true);assert.equal(reviewed.teacherAnswersNeedReview,false);
  const student=await h.request(route(p,v)+'?audience=student',{cookie:h.cookie});assert.equal(student.status,200);assert.deepEqual(Object.keys(student.data.content).sort(),['assessment','diagram','sourceIds','worksheet']);assert.doesNotMatch(JSON.stringify(student.data),/TEACHER_|RUBRIC_SECRET|CHECK_SECRET|REFLECTION_PROMPT_SECRET|REVIEW_NOTE_SECRET/);
  for(const format of ['md','html']){const exported=await h.request(route(p,v)+'/download?audience=student&format='+format,{cookie:h.cookie});assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.match(exported.text,/<svg\b/);assert.match(exported.text,/填写1/);assert.doesNotMatch(exported.text,/TEACHER_|RUBRIC_SECRET|CHECK_SECRET|REFLECTION_PROMPT_SECRET|REVIEW_NOTE_SECRET/);}
  for(const suffix of ['', '?audience=teacher','/download?audience=teacher&format=html','/download?audience=student&format=md'])assert.equal((await h.request(route(p,v)+suffix,{cookie:h.other})).status,404);
  assert.equal((await h.request('/textbooks/'+h.book.id+'/teaching-packs',{cookie:h.other})).status,404);
  await h.restart();assert.equal((await h.request(route(p,v)+'?audience=teacher',{cookie:h.cookie})).data.content.teacherAnswers[0].answer,'TEACHER_SECRET_ANSWER');assert.equal((await h.request(route(p,v),{cookie:h.cookie})).data.reviewValid,true);
});

test('partial block edits preserve hidden answers but publish a new unreviewed and unrevealed content version',async t=>{
  const h=await fixture(t),p=await h.pack(),done=await h.generate(p.id),v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data;
  const revealed=(await h.request(route(p,v)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;
  const checked=(await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(revealed)})).data;
  const edit=await h.request(route(p,v),{cookie:h.cookie,method:'PATCH',body:{expectedRevision:checked.revision,content:{worksheet:{title:'本人修订任务单'}}}});assert.equal(edit.status,201);const newer=edit.data;assert.notEqual(newer.id,v.id);assert.equal(newer.version,2);assert.equal(newer.content.worksheet.title,'本人修订任务单');assert.deepEqual(newer.content.lessonPlan,v.content.lessonPlan);assert.equal(newer.reviewValid,false);assert.equal(newer.review,null);assert.equal(newer.teacherRevealedAt,null);assert.equal(newer.teacherAnswersNeedReview,true);
  assert.equal((await h.request(route(p,newer)+'?audience=teacher',{cookie:h.cookie})).status,403);
  assert.equal((await h.request(route(p,newer),{cookie:h.cookie,method:'PATCH',body:{expectedRevision:newer.revision,content:{teacherAnswers:[]}}})).status,403);
  const newReveal=(await h.request(route(p,newer)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;assert.equal(newReveal.content.teacherAnswers[0].answer,'TEACHER_SECRET_ANSWER');
  assert.equal((await h.request(route(p,v),{cookie:h.cookie,method:'PATCH',body:{expectedRevision:checked.revision,content:{worksheet:{title:'迟到编辑'}}}})).status,409);
  assert.equal((await h.request(route(p,v),{cookie:h.cookie})).data.content.worksheet.title,v.content.worksheet.title);
});

test('understanding and reflection are labeled user inputs, do not certify ability or invalidate unchanged reviewed content',async t=>{
  const h=await fixture(t),p=await h.pack(),done=await h.generate(p.id),v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data;
  const revealed=(await h.request(route(p,v)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(revealed)});
  const record=await h.request(route(p,v)+'/records',{cookie:h.cookie,method:'POST',body:{kind:'misconception-correction',statement:'本人更正了把不同单位直接相加的误解。',evidenceText:'RECORD_PRIVATE_EVIDENCE'}});assert.equal(record.status,201);assert.equal(record.data.records[0].abilityCertified,false);assert.equal(record.data.records[0].classification,'user-provided-unverified');assert.equal(record.data.reviewValid,true);
  const reflection=await h.request(route(p,v)+'/reflections',{cookie:h.cookie,method:'POST',body:{kind:'classroom-observation',classification:'synthetic',text:'REFLECTION_PRIVATE_SYNTHETIC',evidence:'合成观察，不是真实班级'}});assert.equal(reflection.status,201);assert.equal(reflection.data.reflections[0].classification,'synthetic');assert.equal(reflection.data.reviewValid,true);
  assert.equal((await h.request(route(p,v)+'/records',{cookie:h.cookie,method:'POST',body:{kind:'demonstration',statement:'我已掌握'}})).status,400);
  const exported=await h.request(route(p,v)+'/download?format=html&audience=student',{cookie:h.cookie});assert.doesNotMatch(exported.text,/RECORD_PRIVATE|REFLECTION_PRIVATE|REVIEW_NOTE_SECRET/);
  const changed=await h.request('/teaching-packs/'+p.id,{cookie:h.cookie,method:'PATCH',body:{expectedRevision:p.revision,task:{goal:'新的教学目标'}}});assert.equal(changed.status,200);
  const stale=(await h.request(route(p,v),{cookie:h.cookie})).data;assert.equal(stale.stale,true);assert.equal(stale.reviewValid,false);assert.equal((await h.request(route(p,v)+'/review',{cookie:h.cookie,method:'POST',body:reviewBody(stale)})).status,409);assert.equal((await h.request(route(p,v)+'/download?format=html',{cookie:h.cookie})).status,409);
});

test('adding or removing student questions reconciles hidden references without inventing new answers',async t=>{
  const h=await fixture(t),p=await h.pack(),done=await h.generate(p.id),v=(await h.request(route(p,{id:done.result.id}),{cookie:h.cookie})).data,sourceIds=v.content.sourceIds;
  const changed=await h.request(route(p,v),{cookie:h.cookie,method:'PATCH',body:{expectedRevision:v.revision,content:{worksheet:{questions:[{id:'new-question',stem:'本人新增的问题',sourceIds}]}}}});assert.equal(changed.status,201);assert.equal(changed.data.validation.complete,false);assert.equal(changed.data.content.teacherAnswers,undefined);
  const guide=(await h.request(route(p,changed.data)+'/reveal-teacher',{cookie:h.cookie,method:'POST',body:{}})).data;
  assert.equal(guide.content.teacherAnswers.find(answer=>answer.questionId==='new-question').answer,'');assert.ok(!guide.content.teacherAnswers.some(answer=>answer.questionId==='w1'));assert.equal(guide.content.teacherAnswers.find(answer=>answer.questionId==='a1').answer,'SECOND_SECRET_ANSWER');
  const corrected=await h.request(route(p,guide),{cookie:h.cookie,method:'PATCH',body:{expectedRevision:guide.revision,content:{teacherAnswers:guide.content.teacherAnswers.map(answer=>answer.questionId==='new-question'?{...answer,answer:'本人填写教师参考',rationale:'本人核对教材后的解释'}:answer)}}});assert.equal(corrected.status,201);assert.equal(corrected.data.validation.complete,true);assert.equal(corrected.data.reviewValid,false);assert.equal(corrected.data.teacherRevealedAt,null);
});

test('schema failures and foreign source scopes do not create successful teaching versions',async t=>{
  for(const mode of ['bad-json','foreign-citation','bad-minutes','raw-svg'])await t.test(mode,async t=>{
    const h=await fixture(t,{model:input=>{if(mode==='bad-json')return'not-json';const content=complete(input);if(mode==='foreign-citation')content.diagram.edges[0].sourceIds=['foreign-source'];if(mode==='bad-minutes')content.lessonPlan.steps[0].minutes=39;if(mode==='raw-svg')content.diagram.svg='<svg onload=x/>';return JSON.stringify(content);}}),p=await h.pack(),done=await h.generate(p.id);assert.equal(done.status,'failed');assert.equal((await h.request(route(p),{cookie:h.cookie})).data.items.length,0);assert.equal((await h.request('/credits/ledger',{cookie:h.cookie})).data.items.find(row=>row.jobId===done.id).status,'released');
  });
});

test('late generation cannot overwrite a manually published current content version',async t=>{
  let entered,release;const waiting=new Promise(resolve=>{entered=resolve;});
  const h=await fixture(t,{model:input=>{entered();return new Promise(resolve=>{release=()=>resolve(JSON.stringify(complete(input)));});}}),p=await h.pack();
  const job=await h.request('/teaching-packs/'+p.id+'/generate',{cookie:h.cookie,method:'POST',body:{}});assert.equal(job.status,202);await waiting;
  const manual=(await h.request(route(p),{cookie:h.cookie,method:'POST',body:{}})).data;release();const done=await h.wait(job.data.id,h.cookie);assert.equal(done.status,'failed');assert.equal((await h.request('/teaching-packs/'+p.id,{cookie:h.cookie})).data.currentVersionId,manual.id);assert.equal((await h.request(route(p),{cookie:h.cookie})).data.items.length,1);
});

test('cancel and source mutation reject delayed generated teaching content',async t=>{
  for(const mode of ['cancel','source-change'])await t.test(mode,async t=>{
    let entered,release;const waiting=new Promise(resolve=>{entered=resolve;});const h=await fixture(t,{model:input=>{entered();return new Promise(resolve=>{release=()=>resolve(JSON.stringify(complete(input)));});}}),p=await h.pack();
    const task=await h.request('/teaching-packs/'+p.id+'/generate',{cookie:h.cookie,method:'POST',body:{}});await waiting;
    if(mode==='cancel')await h.request('/jobs/'+task.data.id+'/cancel',{cookie:h.cookie,method:'POST',body:{}});
    else{const c=h.outline.chapters[0],point=h.outline.knowledgePoints[0];assert.equal((await h.request('/textbooks/'+h.book.id+'/outline',{cookie:h.cookie,method:'PATCH',body:{chapters:[{id:c.id,title:'修订章节',startPage:c.startPage,endPage:c.endPage,knowledgePoints:[{id:point.id,title:point.title,startPage:point.sourceAnchor.startPage,endPage:point.sourceAnchor.endPage}]}]}})).status,200);}
    release();const done=await h.wait(task.data.id,h.cookie);assert.equal(done.status,mode==='cancel'?'cancelled':'failed');assert.equal((await h.request(route(p),{cookie:h.cookie})).data.items.length,0);
  });
});
