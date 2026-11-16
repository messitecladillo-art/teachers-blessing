const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../study-teaching.js'),'utf8');

// This small DOM seam checks outlet ownership and API/audience lifecycle. It is
// deliberately not a rendering, keyboard, browser-layout or sanitizer test.
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.events={};this.attrs={};this.dataset={};this._html='';this.open=false;const classes=new Set();this.classList={toggle:(c,on)=>on===undefined?(classes.has(c)?classes.delete(c):classes.add(c)):on?classes.add(c):classes.delete(c),add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)};}
  get isConnected(){return this.connectedRoot||!!this.parentElement?.isConnected;}
  append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){for(const c of this.children)c.parentElement=null;this.children=[];this._html='';this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}
  set innerHTML(value){this.replaceChildren();this._html=String(value);for(const m of this._html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){const e=new Element(m[1]);e.id=m[2];this.append(e);}}
  get innerHTML(){return this._html;}
  set textContent(value){this.replaceChildren();this.text=String(value);}
  get textContent(){return this.text||'';}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  querySelector(selector){if(selector.startsWith('#')){const id=selector.slice(1);return this.walk().find(e=>e.id===id)||null;}return null;}
  querySelectorAll(){return [];}
  walk(){return this.children.flatMap(c=>[c,...c.walk()]);}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  showModal(){this.open=true;}
  close(){this.open=false;for(const fn of this.events.close||[])fn({});}
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const content={sourceIds:['kp'],lessonPlan:{objectives:['Explain a fraction'],steps:[{title:'Observe',minutes:40,teacherMoves:'TEACHER_MOVE_SENTINEL',studentTask:'Draw five equal parts',check:'TEACHER_CHECK_SENTINEL',sourceIds:['kp']}],sourceIds:['kp']},worksheet:{title:'Draw and explain',instructions:'Use the same whole.',questions:[{id:'w1',stem:'Draw one fifth',sourceIds:['kp']}],sourceIds:['kp']},assessment:{questions:[{id:'a1',stem:'Explain your drawing',sourceIds:['kp']}],criteria:['TEACHER_CRITERIA_SENTINEL'],sourceIds:['kp']},diagram:{title:'Flow',kind:'process',nodes:[{id:'a',label:'Start',sourceIds:['kp']},{id:'b',label:'Finish',sourceIds:['kp']}],edges:[{from:'a',to:'b',label:'then',sourceIds:['kp']}],sourceIds:['kp']},teacherAnswers:[{questionId:'w1',answer:'TEACHER_ANSWER_SENTINEL'}],reflection:{prompts:['Check the whole'],sourceIds:['kp']}};
const pack={id:'pack',title:'One lesson',currentVersionId:'version',revision:1,task:{grade:'4',subject:'Math',durationMinutes:40,goal:'Explain the unit',priorKnowledge:'SELF_PRIOR'},scope:{chapterIds:['chapter']}};
const version={id:'version',version:1,revision:1,packId:'pack',origin:'human-edited',validation:{complete:true},reviewValid:true,stale:false,sourceVersions:[{id:'kp',title:'Fraction source',anchor:{startPage:1,endPage:1}}],content,records:[{statement:'RECORD_PRIVATE_SENTINEL'}],reflections:[{classification:'synthetic',text:'SYNTHETIC_RECORD'},{classification:'self-reported',text:'OWN_REHEARSAL'}]};
function setup({apiOverride,jobs=[]}={}){
  const body=new Element('body');body.connectedRoot=true;const created=[],events={},timers=new Set(),calls=[],notices=[];
  const ctx={userId:'user',epoch:1,book:{id:'book',title:'Synthetic fractions'},outline:{chapters:[{id:'chapter',title:'Fractions'}]}};
  const document={body,createElement:tag=>{const e=new Element(tag);created.push(e);return e;},createElementNS:(_,tag)=>{const e=new Element(tag);created.push(e);return e;}};
  const window={location:{hash:'#/textbook/book/teaching'},TeachingAI:{escapeHtml:escape},StudyRender:{markdown:escape,paint:()=>{}},addEventListener:(n,f)=>(events[n]??=[]).push(f),removeEventListener:(n,f)=>events[n]=events[n]?.filter(x=>x!==f)};window.history={replaceState:(_,__,hash)=>window.location.hash=hash};
  const api=async(url,options)=>{calls.push({url,options});const override=await apiOverride?.(url,options);if(override!==undefined)return override;if(url==='/jobs')return jobs;if(url.endsWith('/teaching-packs'))return{items:[structuredClone(pack)]};if(url==='/teaching-packs/pack')return structuredClone(pack);if(/\/versions(?:\?|$)/.test(url))return{items:[{id:'version',version:1,origin:'human-edited'}]};if(url.includes('/versions/version'))return structuredClone(version);throw new Error('Unexpected API '+url);};
  const runtime={window,document,structuredClone,console,URL,Blob,XMLSerializer:class{},crypto:require('node:crypto').webcrypto,setTimeout:(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;},clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);}};
  vm.runInNewContext(code,runtime,{filename:'study-teaching.js'});
  const instance=window.StudyTeaching.install({api,getContext:()=>ctx,notify:(...args)=>notices.push(args)});
  const host=()=>{const n=new Element('main');body.append(n);return n;};
  return{instance,body,created,ctx,window,calls,timers,notices,host,outlet:()=>created.find(e=>e.className?.includes('teaching-outlet')),content:()=>body.walk().map(e=>e.innerHTML+' '+e.textContent).join('\n')};
}

test('one outlet moves between native editor, student host and legacy dialog',async()=>{
  const t=setup(),a=t.host(),b=t.host();await t.instance.mount(a,{view:'editor'});const outlet=t.outlet();assert.equal(outlet.parentElement,a);assert.match(t.content(),/教学流程图/);assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,1);
  t.window.location.hash='#/textbook/book/teaching/student';await t.instance.mount(b,{view:'student'});assert.equal(outlet.parentElement,b);assert.equal(a.children.length,0);assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,1);
  await t.instance.open();assert.equal(outlet.parentElement.id,'teaching-dialog');assert.equal(outlet.parentElement.open,true);assert.equal(b.children.length,0);t.instance.dispose();assert.equal(t.body.walk().filter(e=>e.id==='teaching-dialog').length,0);
});

test('student mode requests whitelist audience for list/detail and never renders teacher or record fields',async()=>{
  const t=setup();await t.instance.mount(t.host(),{view:'student'});const versionCalls=t.calls.filter(c=>c.url.includes('/versions'));assert.equal(versionCalls.length,2);assert.ok(versionCalls.every(c=>c.url.endsWith('?audience=student')));assert.match(t.content(),/Draw one fifth/);assert.match(t.content(),/Explain your drawing/);for(const hidden of ['TEACHER_ANSWER_SENTINEL','TEACHER_MOVE_SENTINEL','TEACHER_CHECK_SENTINEL','TEACHER_CRITERIA_SENTINEL','RECORD_PRIVATE_SENTINEL','OWN_REHEARSAL','SYNTHETIC_RECORD'])assert.ok(!t.content().includes(hidden),hidden);assert.equal(t.calls.some(c=>c.url.includes('reveal-teacher')),false);t.instance.dispose();
});

test('student outlet does not fetch jobs or dispatch hidden teacher/generation actions',async()=>{
  const t=setup();await t.instance.mount(t.host(),{view:'student'});assert.equal(t.calls.some(c=>c.url==='/jobs'),false);const before=t.calls.length;
  for(const action of ['reveal','generate','blank','edit']){const button={dataset:{teaching:action,section:'teacherAnswers'}};button.closest=()=>button;await t.outlet().events.click[0]({target:button,preventDefault(){},stopPropagation(){}});}
  assert.equal(t.calls.length,before);t.instance.dispose();
});

test('student stale/incomplete version has preview warning and no download URL',async()=>{
  const t=setup({apiOverride:url=>url.includes('/versions/version')?{...structuredClone(version),stale:true,reviewValid:false,validation:{complete:false}}:undefined});await t.instance.mount(t.host(),{view:'student'});assert.match(t.content(),/历史预览/);assert.match(t.content(),/尚未填写完整/);assert.equal(t.content().includes('/download?audience=student'),false);t.instance.dispose();
});

test('remount discards a deferred older book result and leaves one current outlet',async()=>{
  let resolveOld;const t=setup({apiOverride:url=>url==='/textbooks/book/teaching-packs'?new Promise(r=>resolveOld=r):undefined});const oldHost=t.host(),freshHost=t.host();const pending=t.instance.mount(oldHost,{view:'editor'});await Promise.resolve();t.ctx.book={id:'book-new',title:'New synthetic book'};t.ctx.epoch++;t.window.location.hash='#/textbook/book-new/teaching/student';await t.instance.mount(freshHost,{view:'student'});resolveOld({items:[{...pack,title:'OLD_RESPONSE_SENTINEL'}]});await pending;assert.equal(t.outlet().parentElement,freshHost);assert.equal(oldHost.children.length,0);assert.ok(!t.content().includes('OLD_RESPONSE_SENTINEL'));assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,1);t.instance.dispose();
});

test('unmount ends the active poll sleep and stale job completion cannot repaint a new page',async()=>{
  const job={id:'job',type:'teaching-pack',status:'running',payload:{packId:'pack'}};const t=setup({jobs:[job]});await t.instance.mount(t.host(),{view:'editor'});assert.equal(t.timers.size,1);t.instance.unmount();assert.equal(t.timers.size,0);await Promise.resolve();assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,0);assert.equal(t.calls.filter(c=>c.url==='/jobs/job').length,0);t.instance.dispose();
});

test('reflection page uses actual saved duration and records, and simulation switch is explicit',async()=>{
  const t=setup();await t.instance.mount(t.host(),{view:'reflection'});assert.match(t.content(),/0′–40′/);assert.match(t.content(),/OWN_REHEARSAL/);assert.ok(!t.content().includes('SYNTHETIC_RECORD'));const button={dataset:{teaching:'reflection-mode',mode:'synthetic'}};button.closest=()=>button;await t.outlet().events.click[0]({target:button,preventDefault(){},stopPropagation(){}});assert.match(t.content(),/SYNTHETIC_RECORD/);assert.ok(!t.content().includes('OWN_REHEARSAL'));assert.match(t.content(),/没有启动AI学生聊天/);t.instance.dispose();
});

test('contextChanged on user/route switch unmounts and clears private teaching content',async()=>{
  const t=setup();await t.instance.mount(t.host(),{view:'reflection'});assert.match(t.content(),/OWN_REHEARSAL/);t.ctx.userId='other';t.ctx.epoch++;t.instance.contextChanged();assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,0);assert.ok(!t.content().includes('OWN_REHEARSAL'));t.instance.dispose();
});

test('native page navigation preserves an unsaved form instead of routing away',async()=>{
  const t=setup(),host=t.host();await t.instance.mount(host,{view:'editor'});t.outlet().events.input[0]({target:{closest:selector=>selector==='form'?{}:null}});let prevented=false,stopped=false;const button={dataset:{teaching:'view-route'},getAttribute:()=>'#/textbook/book/teaching/student'};button.closest=()=>button;await t.outlet().events.click[0]({target:button,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(t.outlet().parentElement,host);assert.match(t.notices.at(-1)[0],/请先保存修订/);assert.equal(t.window.location.hash,'#/textbook/book/teaching');t.instance.dispose();
});

test('global route guard refuses a dirty editor while account changes still clear it',async()=>{
  const t=setup(),host=t.host();await t.instance.mount(host,{view:'editor'});t.outlet().events.input[0]({target:{closest:selector=>selector==='form'?{}:null}});assert.equal(t.instance.requestClose(),false);t.window.location.hash='#/textbooks';t.instance.contextChanged();assert.equal(t.window.location.hash,'#/textbook/book/teaching');assert.equal(t.outlet().parentElement,host);t.ctx.userId='other';t.ctx.epoch++;t.instance.contextChanged();assert.equal(t.body.walk().filter(e=>e.id==='teaching-body').length,0);t.instance.dispose();
});

test('nested AI student form events remain owned by the student component',async()=>{
  const t=setup();await t.instance.mount(t.host(),{view:'reflection'});const child={closest:selector=>selector==='.student-simulation'?{}:null};let prevented=false;t.outlet().events.input[0]({target:child});await t.outlet().events.submit[0]({target:child,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(t.instance.requestClose(),true);t.instance.dispose();
});
