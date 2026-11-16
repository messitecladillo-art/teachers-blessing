const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {sessionState}=require('../study-student.js');
const code=fs.readFileSync(path.join(__dirname,'../study-student.js'),'utf8');
// DOM/API seam: tests persistent operations and view ownership, not browser pixels.
class Element{
  constructor(tag){this.nodeType=1;this.tagName=tag;this.children=[];this.events={};this.attrs={};this.dataset={};this.parentElement=null;this._text='';this.value='';this.scrollHeight=0;this.scrollTop=0;this.clientHeight=0;}
  get isConnected(){return this.root||!!this.parentElement?.isConnected;}
  append(...items){for(const n of items){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);n.parentElement=this;this.children.push(n);}}
  replaceChildren(...items){for(const n of this.children)n.parentElement=null;this.children=[];this._text='';this.append(...items);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  walk(){return this.children.flatMap(n=>[n,...n.walk()]);}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  addEventListener(k,f){(this.events[k]??=[]).push(f);}
}
const clone=structuredClone;
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function harness({existing=[],override,renderer}={}){
  const body=new Element('body');body.root=true;const calls=[],timers=new Map(),created=[],sessions=clone(existing),jobs=new Map(),createKeys=new Map(),messageKeys=new Map();let timerSerial=0,sessionSerial=existing.length,jobSerial=0;
  const ctx={userId:'user',epoch:1,book:{id:'book',title:'Synthetic course'},config:{modelConfigured:true}};
  const pack={id:'pack',title:'Synthetic lesson',currentVersionId:'version'},version={id:'version',version:1,stale:false,validation:{complete:true},content:{teacherAnswers:['HIDDEN_KEY_SENTINEL']}};
  const request=async(url,options)=>{
    calls.push({url,options});const other=await override?.(url,options,{sessions,jobs});if(other!==undefined)return other;
    if(url==='/teaching-packs/pack')return clone(pack);
    if(url==='/teaching-packs/pack/versions/version?audience=student')return clone(version);
    if(url==='/teaching-packs/pack/versions/version/student-simulations'){
      if(!options?.method)return{items:clone(sessions)};
      const key=options.data.clientRequestId;if(createKeys.has(key))return clone(createKeys.get(key));
      const session={id:'session-'+(++sessionSerial),packId:'pack',versionId:'version',profile:options.data.profile,messages:[],turnCount:0,maxTurns:12,activeJobId:null,lastJobId:null,stale:false,classification:'simulated',abilityCertified:false,createdAt:new Date().toISOString()};sessions.push(session);createKeys.set(key,session);return clone(session);
    }
    let match=/^\/student-simulations\/([^/]+)(\/messages)?$/.exec(url);
    if(match){const s=sessions.find(x=>x.id===match[1]);assert.ok(s,'session exists');if(!match[2])return clone(s);assert.equal(options.method,'POST');const key=options.data.clientRequestId;if(messageKeys.has(key))return clone(messageKeys.get(key));const j={id:'job-'+(++jobSerial),type:'student-simulation',status:'queued',payload:{sessionId:s.id,teacherMessageId:'teacher-'+jobSerial}};s.messages.push({id:'teacher-'+jobSerial,role:'teacher',content:options.data.content,classification:'simulated',createdAt:new Date().toISOString()});s.turnCount++;s.activeJobId=j.id;s.lastJobId=j.id;jobs.set(j.id,j);messageKeys.set(key,j);return clone(j);}
    match=/^\/jobs\/([^/]+)(?:\/(cancel|resume))?$/.exec(url);
    if(match){const j=jobs.get(match[1]);assert.ok(j,'job exists');if(match[2]){j.status=match[2]==='cancel'?'cancelled':'running';sessions.find(x=>x.id===j.payload.sessionId).activeJobId=match[2]==='cancel'?null:j.id;}return clone(j);}
    throw new Error('Unexpected URL '+url);
  };
  const doc={body,createElement:tag=>{const n=new Element(tag);created.push(n);return n;}};
  const win={document:doc,crypto:require('node:crypto').webcrypto,StudyRender:renderer,addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(code,{window:win,document:doc,console,setTimeout:(fn,ms)=>{const id=++timerSerial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)},{filename:'study-student.js'});
  const app=win.StudyStudent.install({api:request,getContext:()=>ctx});
  const host=()=>{const n=new Element('div');body.append(n);return n;};
  const one=cls=>body.walk().find(n=>n.className?.split(' ').includes(cls));
  const action=name=>body.walk().find(n=>n.dataset.studentAction===name);
  const click=async name=>{const n=action(name);assert.ok(n,name);assert.equal(!!n.disabled,false,name+' enabled');n.closest=()=>n;one('student-simulation').events.click[0]({target:n});await flush();};
  const send=async text=>{const input=one('student-composer').walk().find(n=>n.tagName==='textarea');input.value=text;input.events.input[0]({target:input});one('student-composer').events.submit[0]({preventDefault(){}});await flush();};
  const finish=async()=>{const j=[...jobs.values()].at(-1),s=sessions.find(s=>s.id===j.payload.sessionId);j.status='completed';s.activeJobId=null;s.messages.push({id:'student-'+j.id,role:'student',content:'SAVED_AI_REPLY: 为什么每份大小不变？',classification:'simulated',createdAt:new Date().toISOString()});for(const [id,t]of [...timers]){timers.delete(id);await t.fn();}await flush();};
  return{app,ctx,pack,version,body,created,calls,timers,sessions,jobs,createKeys,messageKeys,host,one,action,click,send,finish};
}
test('12-turn limit blocks a new turn but not recovery of its existing failed job',()=>{const state=sessionState({turnCount:12,maxTurns:12,versionId:'v'},{versionId:'v',currentVersionId:'v'});assert.equal(state.canSend,false);assert.equal(state.canResume,true);assert.equal(state.limitReached,true);assert.equal(sessionState({turnCount:0,versionId:'old'},{versionId:'new'}).canResume,false);});

test('mount is read-only, uses student audience, and displays no invented reply or hidden content',async()=>{
  const t=harness();await t.app.mount(t.host(),{packId:'pack',versionId:'version'});assert.equal(t.calls.some(c=>c.options?.method==='POST'),false);assert.ok(t.calls.some(c=>c.url.endsWith('?audience=student')));assert.ok(!t.body.textContent.includes('HIDDEN_KEY_SENTINEL'));assert.ok(!t.body.textContent.includes('SAVED_AI_REPLY'));assert.match(t.body.textContent,/不自动评定/);t.app.dispose();
});

test('explicit start creates session then saves a teacher instruction; only poll reads saved AI reply',async()=>{
  const t=harness();await t.app.mount(t.host(),{packId:'pack',versionId:'version'});await t.click('start');const writes=t.calls.filter(c=>c.options?.method==='POST');assert.equal(writes.length,2);assert.match(writes[0].url,/versions\/version\/student-simulations$/);assert.match(writes[1].url,/student-simulations\/session-1\/messages$/);assert.match(writes[1].options.data.content,/请作为模拟学生/);assert.match(writes[0].options.data.clientRequestId,/^[a-f0-9-]{36}$/);assert.match(writes[1].options.data.clientRequestId,/^[a-f0-9-]{36}$/);assert.ok(!t.body.textContent.includes('SAVED_AI_REPLY'));await t.finish();assert.match(t.body.textContent,/AI学生 · 模拟/);assert.match(t.body.textContent,/SAVED_AI_REPLY/);assert.match(t.body.textContent,/本人讲解/);t.app.dispose();
});

test('acknowledged repeat explanation gets a new request UUID and new turn',async()=>{
  const t=harness();await t.app.mount(t.host(),{packId:'pack',versionId:'version'});await t.click('start');await t.finish();await t.send('相同的讲解');await t.finish();await t.send('相同的讲解');const writes=t.calls.filter(c=>c.options?.data?.content==='相同的讲解');assert.equal(writes.length,2);assert.notEqual(writes[0].options.data.clientRequestId,writes[1].options.data.clientRequestId);assert.equal(t.sessions[0].turnCount,3);t.app.dispose();
});

test('uncertain message transport retry keeps UUID and visible draft',async()=>{
  let failed=false;const t=harness({override:(url,options)=>{if(url.endsWith('/messages')&&!failed){failed=true;throw new Error('synthetic transport interruption');}}});await t.app.mount(t.host(),{packId:'pack',versionId:'version'});await t.click('start');const first=t.calls.find(c=>c.url.endsWith('/messages'));const input=t.one('student-composer').walk().find(n=>n.tagName==='textarea');assert.equal(input.value,first.options.data.content);await t.send(input.value);const writes=t.calls.filter(c=>c.url.endsWith('/messages'));assert.equal(writes.length,2);assert.equal(writes[0].options.data.clientRequestId,writes[1].options.data.clientRequestId);assert.equal(t.sessions.length,1);t.app.dispose();
});

test('uncertain session creation retries its UUID instead of creating another session',async()=>{
  let saved,key;const t=harness({override:(url,options,{sessions})=>{if(url.endsWith('/student-simulations')&&options?.method==='POST'){if(!saved){key=options.data.clientRequestId;saved={id:'saved-session',packId:'pack',versionId:'version',profile:options.data.profile,messages:[],turnCount:0,maxTurns:12,stale:false};sessions.push(saved);throw new Error('uncertain creation receipt');}assert.equal(options.data.clientRequestId,key);return clone(saved);}}});await t.app.mount(t.host(),{packId:'pack',versionId:'version'});await t.click('start');assert.equal(t.sessions.length,1);await t.click('start');assert.equal(t.sessions.length,1);assert.equal(t.sessions[0].turnCount,1);t.app.dispose();
});

test('stale/current-version mismatch keeps history but prevents new model work',async()=>{
  const s={id:'history',packId:'pack',versionId:'version',profile:'quiet',turnCount:1,maxTurns:12,stale:true,messages:[{id:'m',role:'student',content:'HISTORICAL_REPLY',classification:'simulated'}]};const t=harness({existing:[s]});t.pack.currentVersionId='new-version';await t.app.mount(t.host(),{packId:'pack',versionId:'version'});assert.match(t.body.textContent,/HISTORICAL_REPLY/);assert.match(t.body.textContent,/仅可回看/);assert.equal(t.one('student-composer').walk().find(n=>n.tagName==='textarea').disabled,true);assert.equal(t.calls.some(c=>c.options?.method==='POST'),false);t.app.dispose();
});

test('unconfigured model leaves saved history readable, and renderer failure falls back to text',async()=>{
  const raw='<script>MODEL_HTML_MUST_BE_TEXT</script>',s={id:'history',packId:'pack',versionId:'version',profile:'quiet',turnCount:1,maxTurns:12,stale:false,messages:[{id:'m',role:'student',content:raw}]};const t=harness({existing:[s],renderer:{markdown(){throw new Error('synthetic missing renderer');}}});t.ctx.config.modelConfigured=false;await t.app.mount(t.host(),{packId:'pack',versionId:'version'});assert.match(t.body.textContent,/模型未配置/);assert.equal(t.one('student-plain').textContent,raw);assert.equal(t.created.some(n=>n.tagName==='script'),false);assert.equal(t.calls.some(c=>c.options?.method==='POST'),false);assert.equal(t.action('new').disabled,true);t.app.dispose();
});

test('terminal lastJobId loads recovery at turn12 and resume reuses existing turn',async()=>{
  const s={id:'history',packId:'pack',versionId:'version',profile:'curious',turnCount:12,maxTurns:12,stale:false,lastJobId:'failed-job',activeJobId:null,messages:[]};const t=harness({existing:[s],override:url=>url==='/jobs/failed-job'?{id:'failed-job',type:'student-simulation',status:'failed',payload:{sessionId:'history'}}:url==='/jobs/failed-job/resume'?{id:'failed-job',type:'student-simulation',status:'running',payload:{sessionId:'history'}}:undefined});await t.app.mount(t.host(),{packId:'pack',versionId:'version'});assert.equal(t.action('resume').disabled,false);assert.equal(t.one('student-composer').walk().find(n=>n.tagName==='textarea').disabled,true);await t.click('resume');assert.ok(t.calls.some(c=>c.url==='/jobs/failed-job/resume'));assert.equal(t.calls.some(c=>c.url.endsWith('/messages')),false);assert.equal(t.sessions[0].turnCount,12);t.app.dispose();
});

test('a cancelled unanswered turn requires its original resume rather than a new teacher message',async()=>{
  const s={id:'history',packId:'pack',versionId:'version',profile:'curious',turnCount:1,maxTurns:12,stale:false,lastJobId:'cancelled-job',messages:[{id:'t',role:'teacher',content:'Previous saved explanation'}]};const t=harness({existing:[s],override:url=>url==='/jobs/cancelled-job'?{id:'cancelled-job',type:'student-simulation',status:'cancelled',payload:{sessionId:'history'}}:undefined});await t.app.mount(t.host(),{packId:'pack',versionId:'version'});assert.equal(t.one('student-composer').walk().find(n=>n.tagName==='textarea').disabled,true);assert.equal(t.action('resume').disabled,false);assert.match(t.body.textContent,/恢复不会新增轮次/);assert.equal(t.calls.some(c=>c.url.endsWith('/messages')),false);t.app.dispose();
});

test('unmount clears poll timer without cancelling persisted task, and remount reads history',async()=>{
  const t=harness();const host=t.host();await t.app.mount(host,{packId:'pack',versionId:'version'});await t.click('start');assert.ok(t.timers.size);t.app.unmount();assert.equal(t.timers.size,0);assert.equal(host.children.length,0);assert.equal(t.calls.some(c=>c.url.endsWith('/cancel')),false);await t.app.mount(host,{packId:'pack',versionId:'version'});assert.equal(t.sessions.length,1);assert.match(t.body.textContent,/请作为模拟学生/);assert.ok(t.timers.size);t.app.dispose();
});

test('old mount result and user change cannot populate a new owner host',async()=>{
  let resolveOld,count=0;const t=harness({override:url=>url==='/teaching-packs/pack'&&++count===1?new Promise(r=>resolveOld=r):undefined});const old=t.host(),fresh=t.host();const pending=t.app.mount(old,{packId:'pack',versionId:'version'});await flush();t.ctx.epoch++;await t.app.mount(fresh,{packId:'pack',versionId:'version'});resolveOld({id:'pack',title:'OLD_RESPONSE_SENTINEL',currentVersionId:'version'});await pending;assert.equal(old.children.length,0);assert.ok(!t.body.textContent.includes('OLD_RESPONSE_SENTINEL'));assert.equal(fresh.children.length,1);t.ctx.userId='other';t.app.contextChanged();assert.equal(fresh.children.length,0);t.app.dispose();
});
