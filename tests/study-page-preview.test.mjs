import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {mkdtemp,rm,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createStudyHandler} from '../learning/api.mjs';
import {createLearningService} from '../learning/services.mjs';
import {createPagePreviewService,renderPageIsolated,PAGE_PREVIEW_LIMITS} from '../learning/page-preview-service.mjs';

function pdf(colors=['1 0 0','0 1 0','0 0 1'],oversized=false){
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${colors.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${colors.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  colors.forEach((color,i)=>{const content=`${color} rg 0 0 60 90 re f 0 0 0 rg BT /F1 7 Tf 5 75 Td (Self-authored page ${i+1}) Tj ET`+(oversized?' q 60 0 0 90 0 0 cm /Im0 Do Q':'');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 90] /Resources << /Font << /F1 3 0 R >> ${oversized?'/XObject << /Im0 '+(4+colors.length*2)+' 0 R >>':''} >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);});
  if(oversized){const image=deflateSync(Buffer.alloc(6000*3000)).toString('hex')+'>';objects.push('<< /Type /XObject /Subtype /Image /Width 6000 /Height 3000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length '+image.length+' >>\nstream\n'+image+'\nendstream');}
  let value='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(value));value+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(value);value+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(value);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,opts={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'study-page-preview-')),store=createStudyStore({dataDir:directory}),learning=createLearningService({store,dataDir:directory});let calls=0,preview;
  const renderer=async(file,options)=>{calls++;return opts.render?opts.render(file,options):renderPageIsolated(file,options);};
  preview=createPagePreviewService({store,dataDir:directory,render:renderer,cacheLimits:opts.cacheLimits});
  const handler=createStudyHandler({dataDir:directory,store,secureCookies:false,service:learning,pagePreviewService:{handle:(...args)=>preview.handle(...args)}});
  const disconnectedRoutes=[];const server=http.createServer(async(req,res)=>{res.once('close',()=>{if(!res.writableEnded)disconnectedRoutes.push(req.url);});if(!await handler(req,res,new URL(req.url,'http://test').pathname)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,cookies={};
  const request=async(route,{method='GET',body,raw,name='synthetic-pages.pdf',account='a',signal}={})=>{const response=await fetch(origin+'/api/v1'+route,{method,signal,headers:{Origin:origin,...(cookies[account]?{Cookie:cookies[account]}:{}),...(raw?{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)}:body!==undefined?{'Content-Type':'application/json'}:{})},body:raw||(body!==undefined?JSON.stringify(body):undefined)});if(response.headers.get('set-cookie'))cookies[account]=response.headers.get('set-cookie').split(';')[0];const bytes=Buffer.from(await response.arrayBuffer());let json={};try{json=JSON.parse(bytes.toString('utf8'));}catch{}return{status:response.status,headers:response.headers,bytes,...json};};
  for(const account of ['a','b'])assert.equal((await request('/auth/register',{method:'POST',account,body:{email:account+'-page@example.invalid',password:'Synthetic-Page-123',nickname:'Synthetic '+account}})).status,201);
  const book=(await request('/textbooks',{method:'POST',body:{title:'Self-authored original-page fixture'}})).data;
  const upload=async(raw=pdf(),name='synthetic-pages.pdf',{parse=true}={})=>{const reply=await request('/textbooks/'+book.id+'/files',{method:'POST',raw,name});assert.equal(reply.status,201,JSON.stringify(reply));const file=reply.data;if(parse){const result=await request('/textbooks/'+book.id+'/parse',{method:'POST',body:{}});assert.equal(result.status,202);for(let n=0;n<500;n++){const job=(await request('/jobs/'+result.data.id)).data;if(!['running','queued'].includes(job.status)){assert.equal(job.status,'completed',JSON.stringify(job.error));return file;}await sleep(10);}throw new Error('Self-authored parse did not complete');}return file;};
  t.after(async()=>{await preview.close();await learning.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('study-page-preview-'));await rm(target,{recursive:true,force:true});});
  return{directory,store,book,request,upload,disconnectedRoutes,route:(file,page=2)=>'/textbooks/'+book.id+'/pages/'+page+'/preview?fileId='+file.id,get calls(){return calls;},get preview(){return preview;},restart:async options=>{await preview.close();preview=createPagePreviewService({store,dataDir:directory,render:options?.render||renderer,cacheLimits:options?.cacheLimits||opts.cacheLimits});}};
}
async function tinyPng(){const {createCanvas}=await import('@napi-rs/canvas');return createCanvas(10,10).toBuffer('image/png');}

test('normal HTTP renders physical page 2 green and page 3 blue instead of the cover, bounded and cached',async t=>{
  const h=await fixture(t),file=await h.upload(),image=await h.request(h.route(file));assert.equal(image.status,200,JSON.stringify(image));assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.equal(image.headers.get('x-page-number'),'2');assert.equal(image.headers.get('x-page-source'),'pdf-original-page');assert.equal(image.headers.get('x-page-source-sha256'),file.sha256);
  const {loadImage,createCanvas}=await import('@napi-rs/canvas');async function center(bytes){const image=await loadImage(bytes),surface=createCanvas(image.width,image.height),context=surface.getContext('2d');assert.ok(image.width<=1200&&image.height<=1800&&image.width*image.height<=2000000);context.drawImage(image,0,0);return[...context.getImageData(Math.floor(image.width/2),Math.floor(image.height/2),1,1).data];}
  assert.deepEqual(await center(image.bytes),[0,255,0,255]);assert.deepEqual(await center((await h.request(h.route(file,3))).bytes),[0,0,255,255]);assert.deepEqual(await center((await h.request(h.route(file,1))).bytes),[255,0,0,255]);assert.equal(h.calls,3);assert.deepEqual((await h.request(h.route(file))).bytes,image.bytes);assert.equal(h.calls,3);
  await h.restart({render:async()=>{throw new Error('Persistent cache should avoid renderer');}});assert.equal((await h.request(h.route(file))).status,200);assert.equal((await readdir(path.join(h.directory,'learning-page-previews'))).length,3);assert.ok(!JSON.stringify((await h.store.snapshot()).textbooks).includes('data:image'));
});

test('normal auth/owner, page bounds, file identity and Markdown errors never expose an old page',async t=>{
  const png=await tinyPng(),h=await fixture(t,{render:async()=>png}),file=await h.upload();assert.equal((await h.request(h.route(file))).status,200);assert.equal((await h.request(h.route(file),{account:'b'})).status,404);assert.equal((await h.request(h.route(file),{account:'anonymous'})).status,401);
  for(const page of ['0','-1','1.5','abc','3001'])assert.equal((await h.request(h.route(file,page))).status,400);assert.equal((await h.request(h.route(file,4))).status,404);assert.equal((await h.request('/textbooks/'+h.book.id+'/pages/1/preview')).status,400);assert.equal((await h.request(h.route({id:'wrong-source'}))).status,409);assert.equal((await h.request(h.route(file),{method:'POST',body:{}})).status,405);
  await h.upload(Buffer.from('# Self-authored text\nNo fabricated PDF page.'),'synthetic.md');assert.equal((await h.request(h.route(file))).status,404);
});

test('a newly uploaded source blocks old active pages immediately, even before replacement parsing',async t=>{
  const png=await tinyPng(),h=await fixture(t,{render:async()=>png}),first=await h.upload();assert.equal((await h.request(h.route(first))).status,200);const second=await h.upload(pdf(['0 0 1']),'replacement.pdf',{parse:false});assert.equal((await h.request(h.route(first))).status,409);assert.equal((await h.request(h.route(second,1))).status,409);
});

test('same-length original corruption rejects a cached image and unknown renderer errors stay private',async t=>{
  const png=await tinyPng(),h=await fixture(t,{render:async()=>png}),file=await h.upload();assert.equal((await h.request(h.route(file))).status,200);const record=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id),location=path.join(h.directory,'learning-files',record.storedName),bytes=await readFile(location),changed=Buffer.from(bytes.toString().replace('1 0 0 rg','0 1 0 rg'));assert.equal(changed.length,bytes.length);await sleep(5);await writeFile(location,changed);const reply=await h.request(h.route(file));assert.equal(reply.status,409);assert.equal(reply.error.code,'PAGE_SOURCE_CHANGED');assert.equal(h.calls,1);
  await h.upload(pdf(['0 0 1']),'new.pdf');await h.restart({render:async()=>{throw new Error('private-system-path and synthetic-key');}});const latest=(await h.store.snapshot()).fileRecords.at(-1),failure=await h.request(h.route(latest,1));assert.equal(failure.status,422);assert.ok(!failure.bytes.toString().includes('private-system-path'));
});

test('source replacement while rendering rejects the late PNG before caching',async t=>{
  let entered,release;const ready=new Promise(resolve=>entered=resolve),png=await tinyPng(),h=await fixture(t,{render:async()=>{entered();await new Promise(resolve=>release=resolve);return png;}}),file=await h.upload(),pending=h.request(h.route(file));await ready;await h.upload(pdf(['0 0 1']),'late-replacement.pdf');release();const result=await pending;assert.equal(result.status,409);assert.equal(result.error.code,'PAGE_SOURCE_CHANGED');assert.equal((await readdir(path.join(h.directory,'learning-page-previews'))).filter(v=>v.endsWith('.png')).length,0);
});

test('HTTP disconnect removes queued work and aborts active rendering without stranding slots',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve),signals=[],png=await tinyPng(),h=await fixture(t,{render:async(file,options)=>{signals.push({signal:options.signal,page:options.pageNumber});await gate;return png;}}),file=await h.upload(),a=new AbortController(),b=new AbortController(),c=new AbortController();
  const first=h.request(h.route(file,1),{signal:a.signal}),second=h.request(h.route(file,2),{signal:b.signal});for(let i=0;signals.length<2&&i<100;i++)await sleep(5);assert.equal(signals.length,2);const queued=h.request(h.route(file,3),{signal:c.signal});await sleep(30);c.abort();await assert.rejects(queued,e=>e.name==='AbortError');for(let i=0;!h.disconnectedRoutes.some(v=>v.includes('/pages/3/'))&&i<100;i++)await sleep(5);assert.ok(h.disconnectedRoutes.some(v=>v.includes('/pages/3/')));a.abort();await assert.rejects(first,e=>e.name==='AbortError');const firstSignal=signals.find(v=>v.page===1).signal;for(let i=0;!firstSignal.aborted&&i<100;i++)await sleep(5);assert.equal(firstSignal.aborted,true);
  const next=h.request(h.route(file,3));for(let i=0;signals.length<3&&i<100;i++)await sleep(5);assert.equal(signals.length,3);release();assert.equal((await second).status,200);assert.equal((await next).status,200);assert.equal(h.calls,3);
});

test('cache LRU is bounded in pages and bytes, survives restart and removes only its own temporary files',async t=>{
  const png=await tinyPng(),h=await fixture(t,{render:async()=>png,cacheLimits:{maxPages:2,maxBytes:png.length*2}}),file=await h.upload();await h.request(h.route(file,1));await h.request(h.route(file,2));await h.request(h.route(file,1));await h.request(h.route(file,3));let files=(await readdir(path.join(h.directory,'learning-page-previews'))).filter(v=>v.endsWith('.png'));assert.equal(files.length,2);assert.ok(files.some(v=>v.includes('-p1-')));assert.ok(files.some(v=>v.includes('-p3-')));assert.ok((await Promise.all(files.map(v=>stat(path.join(h.directory,'learning-page-previews',v))))).reduce((sum,v)=>sum+v.size,0)<=png.length*2);
  const directory=path.join(h.directory,'learning-page-previews'),temporary='.00000000-0000-4000-8000-000000000001.tmp';await writeFile(path.join(directory,temporary),'interrupted write');await writeFile(path.join(directory,'unrelated.txt'),'keep');await h.restart({cacheLimits:{maxPages:1,maxBytes:png.length}});assert.equal((await h.request(h.route(file,3))).status,200);files=await readdir(directory);assert.equal(files.filter(v=>v.endsWith('.png')).length,1);assert.ok(!files.includes(temporary));assert.ok(files.includes('unrelated.txt'));
});

test('metadata traversal, missing original and malformed PDF fail without exposing paths',async t=>{
  const h=await fixture(t),file=await h.upload(),original=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id);await h.store.mutate(s=>{s.fileRecords.find(v=>v.id===file.id).storedName='../private.pdf';});assert.equal((await h.request(h.route(file))).status,422);assert.equal(h.calls,0);await h.store.mutate(s=>{s.fileRecords.find(v=>v.id===file.id).storedName=original.storedName;});await unlink(path.join(h.directory,'learning-files',original.storedName));assert.equal((await h.request(h.route(file))).status,404);
  const malformed=await h.upload(Buffer.from('%PDF-1.4\nself-authored malformed PDF\n'),'malformed.pdf',{parse:false}),record=(await h.store.snapshot()).fileRecords.find(v=>v.id===malformed.id);await assert.rejects(renderPageIsolated(record,{dataDir:h.directory,pageNumber:1}),e=>e.status===422&&e.code==='PAGE_RENDER_FAILED');assert.equal((await h.request('/users/me')).status,200);
});

test('isolated rendering has a fixed timeout, cancels promptly and rejects over-budget embedded images',async t=>{
  const h=await fixture(t),file=await h.upload(),record=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id);await assert.rejects(renderPageIsolated(record,{dataDir:h.directory,pageNumber:2,timeoutMs:1}),e=>e.status===504&&e.code==='PAGE_TIMEOUT');const controller=new AbortController(),pending=renderPageIsolated(record,{dataDir:h.directory,pageNumber:2,signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.code==='PAGE_CANCELLED');
  const large=await h.upload(pdf(['1 0 0'],true),'oversized-image.pdf'),reply=await h.request(h.route(large,1));assert.equal(reply.status,422,JSON.stringify({status:reply.status,error:reply.error}));assert.equal(reply.error.code,'PAGE_IMAGE_LIMIT');assert.equal((await h.request('/users/me')).status,200);
});

test('two renderer slots and a bounded queue reject overflow, close aborts every pending request',async t=>{
  const png=await tinyPng(),h=await fixture(t,{render:async()=>new Promise(()=>{})}),file=await h.upload(),user=(await h.store.snapshot()).users.find(v=>v.email==='a-page@example.invalid');const pending=Array.from({length:PAGE_PREVIEW_LIMITS.concurrency+PAGE_PREVIEW_LIMITS.queue},(_,i)=>h.preview.get(h.book.id,i%3+1,user,{fileId:file.id}));for(let i=0;h.calls<2&&i<100;i++)await sleep(5);await sleep(30);await assert.rejects(h.preview.get(h.book.id,1,user,{fileId:file.id}),e=>e.status===429&&e.code==='PAGE_BUSY');await h.preview.close();const settled=await Promise.allSettled(pending);assert.ok(settled.every(v=>v.status==='rejected'&&v.reason.code==='PAGE_CANCELLED'));assert.equal(h.calls,2);assert.ok(png.length>0);
});
