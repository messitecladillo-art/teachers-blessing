import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createStudyHandler} from '../learning/api.mjs';
import {createLearningService} from '../learning/services.mjs';
import {renderCoverIsolated} from '../learning/cover-service.mjs';

function pdf(colors=['1 0 0','0 0 1']){
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${colors.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${colors.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  colors.forEach((color,i)=>{const content=`${color} rg 0 0 60 90 re f 0 0 0 rg BT /F1 7 Tf 5 75 Td (Synthetic ${i+1}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 90] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);});
  let value='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(value));value+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(value);value+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(value);
}
async function fixture(t,opts={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'study-cover-')),store=createStudyStore({dataDir:directory}),service=createLearningService({store,dataDir:directory});
  let calls=0,handler=createStudyHandler({dataDir:directory,store,service,secureCookies:false,coverRenderer:async(file,options)=>{calls++;return opts.render?opts.render(file,options):renderCoverIsolated(file,options);}});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://test').pathname)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,cookies={};
  const request=async(route,{method='GET',body,raw,name='selfauthored.pdf',account='a'}={})=>{const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(cookies[account]?{Cookie:cookies[account]}:{}),...(raw?{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)}:body!==undefined?{'Content-Type':'application/json'}:{})},body:raw||(body!==undefined?JSON.stringify(body):undefined)});if(response.headers.get('set-cookie'))cookies[account]=response.headers.get('set-cookie').split(';')[0];const bytes=Buffer.from(await response.arrayBuffer());let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{value={};}return{status:response.status,headers:response.headers,bytes,...value};};
  for(const account of ['a','b'])assert.equal((await request('/auth/register',{method:'POST',account,body:{email:account+'-cover@example.invalid',password:'Synthetic-Cover-123',nickname:'Synthetic '+account}})).status,201);
  const book=(await request('/textbooks',{method:'POST',body:{title:'Self-authored cover fixture'}})).data;
  const wait=async id=>{for(let n=0;n<500;n++){const job=(await request('/jobs/'+id)).data;if(!['running','queued'].includes(job.status)){assert.equal(job.status,'completed',JSON.stringify(job.error));return;}await new Promise(r=>setTimeout(r,10));}throw new Error('Synthetic parse did not settle');};
  const upload=async(raw=pdf(),name='selfauthored.pdf')=>{const file=(await request('/textbooks/'+book.id+'/files',{method:'POST',raw,name})).data;const job=await request('/textbooks/'+book.id+'/parse',{method:'POST',body:{}});await wait(job.data.id);return file;};
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('study-cover-'));await rm(target,{recursive:true,force:true});});
  return{directory,store,book,request,upload,get calls(){return calls;},restart:()=>{handler=createStudyHandler({dataDir:directory,store,service,secureCookies:false,coverRenderer:async()=>{throw new Error('Cache should persist without re-render');}});}};
}

test('actual PDF first page renders a bounded PNG, preserves color and reuses private SHA cache',async t=>{
  const h=await fixture(t),file=await h.upload(),route='/textbooks/'+h.book.id+'/cover',image=await h.request(route);assert.equal(image.status,200,JSON.stringify(image));assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.equal(image.headers.get('x-cover-source'),'pdf-first-page');assert.equal(image.headers.get('x-cover-source-sha256'),file.sha256);assert.equal(image.bytes.readUInt32BE(16),60);assert.equal(image.bytes.readUInt32BE(20),90);
  const {loadImage,createCanvas}=await import('@napi-rs/canvas'),decoded=await loadImage(image.bytes),canvas=createCanvas(60,90),ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);assert.deepEqual([...ctx.getImageData(30,45,1,1).data],[255,0,0,255]);
  const again=await h.request(route);assert.deepEqual(again.bytes,image.bytes);assert.equal(h.calls,1);h.restart();assert.equal((await h.request(route)).status,200);assert.equal((await readdir(path.join(h.directory,'learning-covers'))).length,1);assert.equal((await h.store.snapshot()).fileRecords.length,1);assert.ok(!JSON.stringify((await h.store.snapshot()).textbooks).includes('data:image'));
});

test('ownership, login and missing/Markdown sources never expose cached PDF images',async t=>{
  const h=await fixture(t),route='/textbooks/'+h.book.id+'/cover';assert.equal((await h.request(route)).status,404);await h.upload();assert.equal((await h.request(route)).status,200);assert.equal((await h.request(route,{account:'b'})).status,404);assert.equal((await h.request(route,{account:'anonymous'})).status,401);assert.equal((await h.request(route,{method:'POST',body:{}})).status,405);
  await h.upload(Buffer.from('# Self-authored Markdown\nA text source has no fabricated image.'),'selfauthored.md');const md=await h.request(route);assert.equal(md.status,404);assert.equal(md.error.code,'COVER_UNAVAILABLE');assert.equal(h.calls,1);
});

test('a new active file uses a different cache and tombstones reject even previously cached images',async t=>{
  const h=await fixture(t),first=await h.upload(),route='/textbooks/'+h.book.id+'/cover',red=await h.request(route),second=await h.upload(pdf(['0 0 1']),'second.pdf'),blue=await h.request(route);assert.equal(blue.status,200);assert.notEqual(second.sha256,first.sha256);assert.notDeepEqual(blue.bytes,red.bytes);assert.equal(blue.headers.get('x-cover-source-sha256'),second.sha256);assert.equal(h.calls,2);assert.equal((await h.request('/files/'+second.id,{method:'DELETE'})).status,200);assert.equal((await h.request(route)).status,404);
});

test('same-length on-disk corruption cannot serve a formerly cached cover',async t=>{
  const h=await fixture(t),file=await h.upload(),route='/textbooks/'+h.book.id+'/cover';assert.equal((await h.request(route)).status,200);const record=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id),location=path.join(h.directory,'learning-files',record.storedName),bytes=await readFile(location);await new Promise(r=>setTimeout(r,8));const changed=Buffer.from(bytes.toString().replace('1 0 0 rg','0 1 0 rg'));assert.equal(changed.length,bytes.length);await writeFile(location,changed);const rejected=await h.request(route);assert.equal(rejected.status,409);assert.equal(rejected.error.code,'COVER_SOURCE_CHANGED');assert.equal(h.calls,1);
});

test('a source switch during thumbnail rendering rejects the late old cover',async t=>{
  let announce,release;const entered=new Promise(r=>announce=r),h=await fixture(t,{render:async(file,options)=>{announce();await new Promise(r=>release=r);return renderCoverIsolated(file,options);}});await h.upload();const pending=h.request('/textbooks/'+h.book.id+'/cover');await entered;await h.upload(pdf(['0 1 0']),'replacement.pdf');release();const late=await pending;assert.equal(late.status,409);assert.equal(late.error.code,'COVER_SOURCE_CHANGED');
});

test('untrusted source path metadata and an unavailable original fail without rendering',async t=>{
  const h=await fixture(t),file=await h.upload(),record=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id);await h.store.mutate(s=>{s.fileRecords.find(v=>v.id===file.id).storedName='../unrelated-secret.pdf';});assert.equal((await h.request('/textbooks/'+h.book.id+'/cover')).status,422);assert.equal(h.calls,0);await h.store.mutate(s=>{s.fileRecords.find(v=>v.id===file.id).storedName=record.storedName;});await unlink(path.join(h.directory,'learning-files',record.storedName));assert.equal((await h.request('/textbooks/'+h.book.id+'/cover')).status,404);
});

test('fixed isolated worker observes its timeout rather than blocking the API process',async t=>{
  const h=await fixture(t),file=await h.upload(),record=(await h.store.snapshot()).fileRecords.find(v=>v.id===file.id);await assert.rejects(renderCoverIsolated(record,{dataDir:h.directory,timeoutMs:1}),error=>error.status===504&&error.code==='COVER_TIMEOUT');assert.equal((await h.request('/users/me')).status,200);
});
