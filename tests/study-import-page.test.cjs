const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../study-import.js'),'utf8');
// A DOM/API seam for lifecycle and submitted contracts; not browser/layout QA.
class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.events={};this.attrs={};this.parentElement=null;this.open=false;this._text='';}
  get isConnected(){return this.root||!!this.parentElement?.isConnected;}
  append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children.forEach(c=>c.parentElement=null);this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  set textContent(v){this.replaceChildren();this._text=String(v);}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
  walk(){return this.children.flatMap(c=>[c,...c.walk()]);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  querySelectorAll(s){return this.walk().filter(n=>s.startsWith('#')?n.id===s.slice(1):s==='[type=submit]'?n.type==='submit':n.tagName===s);}
  setAttribute(k,v){this.attrs[k]=String(v);}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  showModal(){this.open=true;}
  close(){this.open=false;(this.events.close||[]).forEach(fn=>fn({}));}
  focus(){}
}
const completed={id:'job',userId:'user',type:'book-import',status:'completed',payload:{textbookId:'book',options:{scope:'all',prepareLessons:'all',ocrLanguage:'chi_sim',maxModelCalls:100,externalResearch:'auto'}},import:{phase:'ready',counts:{totalPages:20,readablePages:20,totalChapters:2,structuredChapters:2,readyChapters:2,modelCalls:6},chapters:[{id:'chapter-1',title:'第一章 一个整体',startPage:1,endPage:10,status:'ready',knowledgePointCount:2,lessonCount:2,learnable:true},{id:'chapter-2',title:'第二章 等分单位',startPage:11,endPage:20,status:'ready',knowledgePointCount:2,lessonCount:2,learnable:true}]}};
function setup({job=completed,override}={}){
  const body=new Node('body');body.root=true;const calls=[],notices=[],routes=[],timers=new Map(),created=[];let timerId=0;
  const context={userId:'user',epoch:1,book:{id:'book',title:'Synthetic fractions',coverAvailable:false}};
  const document={body,activeElement:null,createElement:tag=>{const e=new Node(tag);created.push(e);return e;}};
  const window={document,location:{hash:'#/textbook/book/import'},addEventListener(){},removeEventListener(){}};
  const api=async(url,options)=>{calls.push({url,options});const value=await override?.(url,options);if(value!==undefined)return value;if(url==='/config/public')return{webResearchConfigured:false};if(url.endsWith('/outline'))return{chapters:completed.import.chapters};if(url.endsWith('/import'))return options?.method==='POST'?structuredClone(job):{job:structuredClone(job)};if(url==='/textbooks/book')return{...context.book};if(url.endsWith('/cancel'))return{...structuredClone(job),status:'cancelled'};if(url.endsWith('/resume'))return{...structuredClone(job),status:'running'};throw new Error('Unexpected URL '+url);};
  class Data {constructor(form){this.fields=form.walk().filter(x=>x.name&&(!(x.type==='checkbox')||x.checked));}get(name){return this.fields.find(x=>x.name===name)?.value??null;}getAll(name){return this.fields.filter(x=>x.name===name).map(x=>x.value);}}
  vm.runInNewContext(code,{window,document,console,FormData:Data,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)},{filename:'study-import.js'});
  const app=window.StudyImport.install({api,getContext:()=>context,notify:(...a)=>notices.push(a),navigate:(...a)=>routes.push(a)});
  const host=()=>{const h=new Node('main');body.append(h);return h;};
  return{app,body,created,context,calls,notices,routes,timers,host,outlet:()=>created.find(x=>x.className?.includes('import-outlet')),slot:id=>body.querySelector('#'+id)};
}
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
async function click(t,action,extra={}){const n={dataset:{importAction:action,...extra}};n.closest=()=>n;t.outlet().events.click[0]({target:n});await flush();}

test('native mount and legacy open move one outlet without duplicate import IDs',async()=>{
  const t=setup(),a=t.host(),b=t.host();await t.app.mount(a,'book');const outlet=t.outlet();assert.equal(outlet.parentElement,a);assert.equal(t.slot('import-dialog').open,false);assert.equal(t.slot('import-stages').children.length,3);assert.equal(t.body.walk().filter(n=>n.id==='import-title').length,1);assert.match(t.slot('import-book-panel').textContent,/第一章 一个整体/);
  await t.app.open('book');assert.equal(outlet.parentElement.id,'import-dialog');assert.equal(outlet.parentElement.open,true);assert.equal(a.children.length,0);assert.equal(t.slot('import-stages').children.length,4);await t.app.mount(b,'book');assert.equal(outlet.parentElement,b);assert.equal(t.slot('import-dialog').open,false);assert.equal(t.body.walk().filter(n=>n.id==='import-options-form').length,1);t.app.dispose();
});

test('page form submits externalResearch off and retains its native outlet',async()=>{
  const t=setup(),host=t.host();await t.app.mount(host,'book');const form=t.slot('import-options-form'),fields=form.walk();fields.find(x=>x.name==='externalResearch').value='off';fields.find(x=>x.name==='maxModelCalls').value='150';t.outlet().events.submit[0]({target:form,preventDefault(){}});await flush();const post=t.calls.find(c=>c.options?.method==='POST'&&c.url.endsWith('/import'));assert.equal(post.options.data.externalResearch,'off');assert.equal(post.options.data.maxModelCalls,150);assert.equal(t.outlet().parentElement,host);assert.equal(t.slot('import-dialog').open,false);assert.match(t.body.textContent,/当前未配置公开检索服务/);t.app.dispose();
});

test('saved options are echoed including chapter scope, checks and external research',async()=>{
  const job=structuredClone(completed);job.payload.options={...job.payload.options,scope:'chapters',chapterIds:['chapter-2'],externalResearch:'off',maxModelCalls:180};const t=setup({job});await t.app.mount(t.host(),'book');const fields=t.slot('import-options-form').walk();assert.equal(fields.find(x=>x.name==='scope').value,'chapters');assert.equal(t.slot('import-scope').hidden,false);assert.equal(fields.find(x=>x.name==='chapterIds'&&x.value==='chapter-2').checked,true);assert.equal(fields.find(x=>x.name==='externalResearch').value,'off');assert.equal(fields.find(x=>x.name==='maxModelCalls').value,'180');t.app.dispose();
});

test('close/unmount leaves active server work intact, while dispose releases local polling',async()=>{
  const job={...structuredClone(completed),status:'running'};job.import.phase='lessons';const t=setup({job});await t.app.mount(t.host(),'book');assert.ok(t.timers.size);t.app.unmount();assert.equal(t.body.walk().filter(n=>n.id==='import-title').length,0);assert.equal(t.calls.some(c=>c.url.endsWith('/cancel')),false);assert.ok(t.timers.size,'background status polling is retained by the installed controller');t.app.dispose();assert.equal(t.timers.size,0);
});

test('old metadata after a same-book epoch remount cannot paint the new host',async()=>{
  let resolveOld,metadataCount=0;const t=setup({override:url=>url==='/textbooks/book'&&++metadataCount===1?new Promise(r=>resolveOld=r):undefined}),a=t.host(),b=t.host();const first=t.app.mount(a,'book');await flush();t.context.epoch++;t.context.book={id:'book',title:'NEW_CONTEXT_TITLE'};await t.app.mount(b,'book');resolveOld({id:'book',title:'OLD_METADATA_SENTINEL'});await first;assert.equal(t.outlet().parentElement,b);assert.ok(!t.body.textContent.includes('OLD_METADATA_SENTINEL'));assert.match(t.body.textContent,/NEW_CONTEXT_TITLE/);t.app.dispose();
});

test('late old poll is invalidated on remount instead of repainting the new page',async()=>{
  let resolveOld,count=0;const t=setup({override:url=>url==='/textbooks/book/import'&&++count===1?new Promise(r=>resolveOld=r):undefined}),a=t.host(),b=t.host();const first=t.app.mount(a,'book');await flush();t.context.epoch++;await t.app.mount(b,'book');const old=structuredClone(completed);old.import.current={title:'OLD_POLL_SENTINEL'};resolveOld({job:old});await first;assert.equal(t.outlet().parentElement,b);assert.ok(!t.body.textContent.includes('OLD_POLL_SENTINEL'));t.app.dispose();
});

test('an old native network rejection after remount cannot put its error on a new page',async()=>{
  let deferNext=false,rejectOld;const t=setup({override:(url,options)=>{if(url.endsWith('/import')&&!options&&deferNext){deferNext=false;return new Promise((_,reject)=>rejectOld=reject);}}});await t.app.mount(t.host(),'book');deferNext=true;await click(t,'refresh');assert.equal(typeof rejectOld,'function');t.app.unmount();const host=t.host();await t.app.mount(host,'book');rejectOld(new TypeError('OLD_FETCH_FAILURE'));await flush();assert.ok(!host.textContent.includes('OLD_FETCH_FAILURE'));t.app.dispose();
});

test('outline review and first available chapter route to real existing capabilities',async()=>{
  const interrupted={...structuredClone(completed),status:'interrupted'};interrupted.import.phase='awaiting-outline-review';const t=setup({job:interrupted});await t.app.mount(t.host(),'book');assert.match(t.slot('import-summary').textContent,/待核对/);await click(t,'outline');assert.equal(t.routes[0][0],'/textbook/book');assert.equal(t.routes[0][1].outlineReview,true);assert.equal(t.calls.some(c=>c.url.endsWith('/cancel')),false);await t.app.mount(t.host(),'book');await click(t,'learn',{importChapter:'chapter-1'});assert.equal(t.routes[1][0],'/textbook/book/chapter/chapter-1');t.app.dispose();
});

test('cover is the owned current PDF endpoint, and user switch clears the old view',async()=>{
  const t=setup();t.context.book.coverAvailable=true;await t.app.mount(t.host(),'book');const image=t.slot('import-book-panel').walk().find(x=>x.tagName==='img');assert.equal(image.src,'/api/v1/textbooks/book/cover');assert.match(image.alt,/PDF物理第一页/);t.context.userId='other';t.context.epoch++;t.app.contextChanged();assert.equal(t.body.walk().filter(n=>n.id==='import-title').length,0);assert.equal(t.timers.size,0);t.app.dispose();
});

test('public start stays a modal API for existing upload callers',async()=>{
  const t=setup();await t.app.start('book',{externalResearch:'off',prepareLessons:'none'});assert.equal(t.outlet().parentElement.id,'import-dialog');assert.equal(t.slot('import-dialog').open,true);assert.deepEqual(t.calls.find(c=>c.options?.method==='POST').options.data,{externalResearch:'off',prepareLessons:'none'});t.app.dispose();
});
