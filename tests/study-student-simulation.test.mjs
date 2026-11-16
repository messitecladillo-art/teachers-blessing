import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudentReply } from '../learning/student-simulation.mjs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createStudyHandler} from '../learning/api.mjs';
import {createLearningService} from '../learning/services.mjs';
import {createTeachingService} from '../learning/teaching-service.mjs';

test('student output is bounded cited JSON, never an objective score or an unknown source',()=>{
  assert.deepEqual(validateStudentReply('{"reply":"我觉得应该先统一单位。","sourceIds":["kp"]}',['kp']),{reply:'我觉得应该先统一单位。',sourceIds:['kp']});
  for(const raw of ['no-json','{}',JSON.stringify({reply:'x',sourceIds:['foreign']}),JSON.stringify({reply:'x',sourceIds:['kp'],score:100}),JSON.stringify({reply:'x'.repeat(2001),sourceIds:['kp']})])assert.throws(()=>validateStudentReply(raw,['kp']));
});

async function fixture(t,options={}){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'student-simulation-')),inputs=[];
  let store=createStudyStore({dataDir}),model=options.configured===false?undefined:async request=>{const input=JSON.parse(request.messages[1].content);inputs.push({input,messages:request.messages});return options.model?options.model(input,request):JSON.stringify({reply:'我先尝试用相同的等分单位说明。',sourceIds:input.allowedSourceIds});};
  let service=createLearningService({store,dataDir,model,...(options.maxDailyUnits!==undefined?{maxDailyUnits:options.maxDailyUnits}:{})}),handler=createStudyHandler({store,dataDir,model,service});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dataDir);assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('student-simulation-'));await rm(resolved,{recursive:true,force:true});});
  async function request(route,{cookie,method='GET',body}={}){const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();return{status:response.status,data:value.data,error:value.error,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function signup(name){const r=await request('/auth/register',{method:'POST',body:{email:name+'@example.invalid',nickname:name,password:'synthetic-pass-123'}});assert.equal(r.status,201);return{user:r.data.user,cookie:r.cookie};}
  const a=await signup('simulation-a'),b=await signup('simulation-b');
  const bookId=randomUUID(),chapterId=randomUUID(),kpId=randomUUID(),fileId=randomUUID(),packId=randomUUID(),versionId=randomUUID(),time=new Date().toISOString(),stamp={userId:a.user.id,createdAt:time,updatedAt:time};
  await store.mutate(s=>{
    const sourceAnchor={fileId,sha256:'synthetic-sha',startPage:1,endPage:1};
    s.textbooks.push({...stamp,id:bookId,title:'自编分数教材',revision:1,outlineRevision:1,activeFileId:fileId});
    s.chapters.push({...stamp,id:chapterId,textbookId:bookId,title:'等分',startPage:1,endPage:1,order:0,archived:false});
    s.knowledgePoints.push({...stamp,id:kpId,textbookId:bookId,chapterId,title:'相同等分单位',revision:1,sourceText:'Fractions use equal parts of the same whole.',sourceAnchor,order:0,archived:false});
    s.fileRecords.push({...stamp,id:fileId,textbookId:bookId,name:'synthetic.md',mime:'text/markdown',status:'ready',sha256:'synthetic-sha',pages:[{number:1,text:'Fractions use equal parts of the same whole.'}]});
    const pack={...stamp,id:packId,textbookId:bookId,title:'分数一课',revision:1,scope:{chapterIds:[chapterId]},task:{grade:'初中',subject:'数学',durationMinutes:40,goal:'解释等分单位',priorKnowledge:'见过分数'},currentVersionId:null};s.teachingPacks.push(pack);
    const bound=createTeachingService({store}).prepare(s,a.user,{packId});
    s.teachingPackVersions.push({...stamp,id:versionId,packId,textbookId:bookId,version:1,revision:1,packRevision:1,sourceFingerprint:bound.sourceFingerprint,sourceVersions:[{id:kpId,title:'相同等分单位',textbookId:bookId,chapterId,revision:1,sourceAnchor}],coverage:{partial:false},validation:{complete:true},content:{sourceIds:[kpId],lessonPlan:{objectives:['解释等分'],steps:[{title:'画图',minutes:40,teacherMoves:'TEACHER_MOVE_SECRET',check:'CHECK_SECRET',studentTask:'画图解释',sourceIds:[kpId]}]},worksheet:{title:'分数任务单',instructions:'尝试解释',questions:[{id:'w1',stem:'为什么需要相同单位？',sourceIds:[kpId]}]},teacherAnswers:[{answer:'HIDDEN_ANSWER_SECRET',rationale:'HIDDEN_RATIONALE_SECRET',rubric:'HIDDEN_RUBRIC_SECRET'}],assessment:{criteria:['PRIVATE_CRITERIA_SECRET']},reflection:{prompts:['REFLECTION_PROMPT_SECRET']}},records:[{statement:'PRIVATE_RECORD_SECRET'}],reflections:[{text:'PRIVATE_REFLECTION_SECRET'}]});pack.currentVersionId=versionId;
  });
  async function wait(id){for(let i=0;i<300;i++){const r=await request('/jobs/'+id,{cookie:a.cookie});assert.equal(r.status,200);if(!['queued','running','cancelling'].includes(r.data.status))return r.data;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Synthetic student job timed out');}
  const list='/teaching-packs/'+packId+'/versions/'+versionId+'/student-simulations';
  async function session(profile='curious'){const r=await request(list,{cookie:a.cookie,method:'POST',body:{profile,clientRequestId:randomUUID()}});assert.equal(r.status,201,JSON.stringify(r));return r.data;}
  async function send(sessionId,content='你认为怎样解释等分？',clientRequestId=randomUUID()){return request('/student-simulations/'+sessionId+'/messages',{cookie:a.cookie,method:'POST',body:{content,clientRequestId}});}
  async function restart(){await service.close();store=createStudyStore({dataDir});service=createLearningService({store,dataDir,model});handler=createStudyHandler({store,dataDir,model,service});}
  return{request,wait,session,send,restart,list,a,b,bookId,kpId,chapterId,fileId,packId,versionId,inputs,get store(){return store;}};
}

test('normal authenticated simulation persists real mock turns, source refs and no hidden teacher/private input',async t=>{
  const h=await fixture(t),s=await h.session(),created=await h.send(s.id);assert.equal(created.status,202,JSON.stringify(created));assert.equal(created.data.type,'student-simulation');const done=await h.wait(created.data.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.result.sessionId,s.id);
  const r=await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie});assert.equal(r.status,200);assert.deepEqual(r.data.messages.map(m=>m.role),['teacher','student']);assert.equal(r.data.turnCount,1);assert.equal(r.data.maxTurns,12);assert.equal(r.data.lastJobId,done.id);assert.equal(r.data.activeJobId,null);assert.equal(r.data.stale,false);assert.equal(r.data.abilityCertified,false);assert.equal(r.data.messages[1].classification,'simulated');
  assert.equal(h.inputs[0].input.task,'student-simulation');assert.equal(h.inputs[0].input.sources[0].id,h.kpId);assert.doesNotMatch(JSON.stringify(h.inputs),/SECRET/);assert.doesNotMatch(h.inputs[0].messages[0].content,/Fractions use/);
  await h.restart();const after=await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie});assert.deepEqual(after.data.messages,r.data.messages);assert.equal((await h.request(h.list,{cookie:h.a.cookie})).data.items[0].id,s.id);
});

test('sessions/messages enforce auth, own parents, profiles and request idempotency',async t=>{
  const h=await fixture(t),key=randomUUID(),body={profile:'quiet',clientRequestId:key};const first=await h.request(h.list,{cookie:h.a.cookie,method:'POST',body});const same=await h.request(h.list,{cookie:h.a.cookie,method:'POST',body});assert.equal(first.status,201);assert.equal(same.status,200);assert.equal(first.data.id,same.data.id);
  assert.equal((await h.request(h.list,{cookie:h.a.cookie,method:'POST',body:{...body,profile:'curious'}})).status,409);assert.equal((await h.request(h.list,{cookie:h.a.cookie,method:'POST',body:{profile:'actual-student'}})).status,400);
  const sessionId=first.data.id;for(const route of [h.list,'/student-simulations/'+sessionId]){assert.equal((await h.request(route)).status,401);assert.equal((await h.request(route,{cookie:h.b.cookie})).status,404);}
  assert.equal((await h.request('/student-simulations/'+sessionId+'/messages',{cookie:h.b.cookie,method:'POST',body:{content:'foreign',clientRequestId:randomUUID()}})).status,404);
  const messageId=randomUUID(),a=await h.send(sessionId,'如何说明？',messageId),b=await h.send(sessionId,'如何说明？',messageId);assert.equal(a.status,202);assert.equal(b.status,202);assert.equal(a.data.id,b.data.id);await h.wait(a.data.id);assert.equal(h.inputs.length,1);assert.equal((await h.send(sessionId,'换了内容',messageId)).status,409);assert.equal((await h.send(sessionId,'x'.repeat(3001))).status,400);
  assert.equal((await h.request('/student-simulations/'+sessionId,{cookie:h.a.cookie})).data.turnCount,1);
});

test('cancel ignores an abort-insensitive late model and resume uses the same teacher turn',async t=>{
  let release,started;const seen=new Promise(resolve=>started=resolve);let calls=0;
  const h=await fixture(t,{model:input=>{calls++;if(calls===1){started();return new Promise(resolve=>{release=()=>resolve(JSON.stringify({reply:'迟到回复',sourceIds:input.allowedSourceIds}));});}return JSON.stringify({reply:'恢复后的模拟回复',sourceIds:input.allowedSourceIds});}}),s=await h.session('misconception'),r=await h.send(s.id);await seen;
  assert.equal((await h.request('/jobs/'+r.data.id+'/cancel',{cookie:h.a.cookie,method:'POST',body:{}})).status,200);const cancelled=await h.wait(r.data.id);assert.equal(cancelled.status,'cancelled');release();await new Promise(resolve=>setTimeout(resolve,20));let current=(await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie})).data;assert.equal(current.messages.length,1);assert.equal(current.activeJobId,null);assert.equal(current.lastJobId,r.data.id);
  const retry=await h.request('/jobs/'+r.data.id+'/resume',{cookie:h.a.cookie,method:'POST',body:{}});assert.equal(retry.status,202,JSON.stringify(retry));assert.equal((await h.wait(retry.data.id)).status,'completed');current=(await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie})).data;assert.equal(current.turnCount,1);assert.equal(current.messages.length,2);assert.equal(current.messages[1].content,'恢复后的模拟回复');
});

test('source or current version changes invalidate reads and reject late completion/resume',async t=>{
  for(const change of ['source','version','task','parent'])await t.test(change,async t=>{
    let release,started;const seen=new Promise(resolve=>started=resolve),h=await fixture(t,{model:input=>{started();return new Promise(resolve=>{release=()=>resolve(JSON.stringify({reply:'不能保存的迟到回复',sourceIds:input.allowedSourceIds}));});}}),s=await h.session(),r=await h.send(s.id);await seen;
    await h.store.mutate(state=>{if(change==='source')state.knowledgePoints.find(p=>p.id===h.kpId).revision++;if(change==='version')state.teachingPacks.find(p=>p.id===h.packId).currentVersionId=randomUUID();if(change==='task')state.teachingPacks.find(p=>p.id===h.packId).revision++;if(change==='parent')state.teachingPacks=state.teachingPacks.filter(p=>p.id!==h.packId);});release();assert.equal((await h.wait(r.data.id)).status,'failed');
    const read=await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie});if(change==='parent')assert.equal(read.status,404);else{assert.equal(read.data.stale,true);assert.equal(read.data.messages.length,1);assert.equal((await h.request('/jobs/'+r.data.id+'/resume',{cookie:h.a.cookie,method:'POST',body:{}})).status,409);}
    assert.equal((await h.store.snapshot()).ledger.find(e=>e.jobId===r.data.id).status,'released');
  });
});

test('missing model, exhausted budget and malformed output never invent a student response',async t=>{
  for(const mode of ['missing','budget','bad-json'])await t.test(mode,async t=>{
    const h=await fixture(t,{configured:mode!=='missing',...(mode==='budget'?{maxDailyUnits:0}:{}),...(mode==='bad-json'?{model:()=>'{"reply":"x","sourceIds":["foreign"]}'}:{})}),s=await h.session(),r=await h.send(s.id);
    if(mode==='bad-json'){assert.equal(r.status,202);assert.equal((await h.wait(r.data.id)).status,'failed');assert.equal((await h.store.snapshot()).ledger.find(e=>e.jobId===r.data.id).status,'released');}else{assert.equal(r.status,mode==='missing'?503:429);assert.equal((await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie})).data.messages.length,0);assert.equal((await h.store.snapshot()).jobs.length,0);}
    assert.ok(!(await h.request('/student-simulations/'+s.id,{cookie:h.a.cookie})).data.messages.some(m=>m.role==='student'));
  });
});

test('twelve teacher turns is a server bound, and restarted pending jobs require explicit resume',async t=>{
  const h=await fixture(t),s=await h.session();for(let i=0;i<12;i++){const r=await h.send(s.id,'第'+(i+1)+'轮');assert.equal(r.status,202);assert.equal((await h.wait(r.data.id)).status,'completed');}assert.equal((await h.send(s.id)).status,409);assert.equal(h.inputs.length,12);assert.ok(h.inputs.every(item=>item.input.history.length<=9));
  const second=await h.session(),pendingId=randomUUID(),teacherId=randomUUID();await h.store.mutate(state=>{const row=state.artifacts.find(a=>a.id===second.id);row.messages.push({id:teacherId,role:'teacher',content:'服务重启前发言',clientRequestId:randomUUID(),classification:'simulated',createdAt:new Date().toISOString()});row.activeJobId=pendingId;row.lastJobId=pendingId;state.jobs.push({id:pendingId,userId:h.a.user.id,type:'student-simulation',status:'queued',payload:{sessionId:row.id,teacherMessageId:teacherId,sourceFingerprint:row.sourceFingerprint},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),units:1});state.ledger.push({id:randomUUID(),userId:h.a.user.id,jobId:pendingId,units:1,status:'reserved',createdAt:new Date().toISOString()});});
  await h.restart();const interrupted=(await h.request('/jobs/'+pendingId,{cookie:h.a.cookie})).data;assert.equal(interrupted.status,'interrupted');assert.equal(h.inputs.length,12);const restored=(await h.request('/student-simulations/'+second.id,{cookie:h.a.cookie})).data;assert.equal(restored.activeJobId,null);assert.equal(restored.lastJobId,pendingId);const resumed=await h.request('/jobs/'+pendingId+'/resume',{cookie:h.a.cookie,method:'POST',body:{}});assert.equal(resumed.status,202);assert.equal((await h.wait(resumed.data.id)).status,'completed');assert.equal((await h.request('/student-simulations/'+second.id,{cookie:h.a.cookie})).data.turnCount,1);
});
