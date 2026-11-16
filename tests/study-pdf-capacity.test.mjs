import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStudyStore} from '../learning/store.mjs';
import {createStudyHandler} from '../learning/api.mjs';
import {createLearningService} from '../learning/services.mjs';

// A self-authored PDF. Optional valid, unreferenced stream makes the file exceed
// the previous upload limit without fabricating page count or parser output.
function capacityPdf(pageCount,paddingBytes=0){
  const objects=[null,Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from(`<< /Type /Pages /Kids [${Array.from({length:pageCount},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pageCount} >>`),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
  for(let index=0;index<pageCount;index++){const stream=`BT /F1 12 Tf 40 800 Td (CAPACITY_PAGE_${index+1}) Tj ET`;objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`),Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));}
  if(paddingBytes)objects.push(Buffer.concat([Buffer.from(`<< /Length ${paddingBytes} >>\nstream\n`),Buffer.alloc(paddingBytes,32),Buffer.from('\nendstream')]));
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
  for(let index=1;index<objects.length;index++){offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${index} 0 obj\n`),objects[index],Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;}
  chunks.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return Buffer.concat(chunks);
}
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'study-capacity-')),store=createStudyStore({dataDir:directory}),service=createLearningService({store,dataDir:directory}),handler=createStudyHandler({store,dataDir:directory,service});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let cookie='';
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('study-capacity-'));await rm(resolved,{recursive:true,force:true});});
  async function request(route,{method='GET',body,raw}={}){const response=await fetch(origin+'/api/v1'+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(raw?{'Content-Type':'application/pdf','X-File-Name':'self-authored.pdf'}:body!==undefined?{'Content-Type':'application/json'}:{})},body:raw||(body!==undefined?JSON.stringify(body):undefined)});const received=response.headers.get('set-cookie');if(received)cookie=received.split(';')[0];const value=await response.json();return {status:response.status,...value};}
  async function parse(bytes){const book=(await request('/textbooks',{method:'POST',body:{title:'Synthetic capacity course'}})).data,file=await request('/textbooks/'+book.id+'/files',{method:'POST',raw:bytes});assert.equal(file.status,201,JSON.stringify(file));const started=await request('/textbooks/'+book.id+'/parse',{method:'POST',body:{}});assert.equal(started.status,202);const deadline=Date.now()+175000;while(Date.now()<deadline){const job=(await request('/jobs/'+started.data.id)).data;if(!['queued','running','cancelling'].includes(job.status))return {book,file:file.data,job};await new Promise(resolve=>setTimeout(resolve,35));}throw new Error('Capacity extraction did not finish');}
  await request('/auth/register',{method:'POST',body:{email:'capacity@example.test',nickname:'Synthetic capacity',password:'synthetic-capacity-password'}});return {request,parse,server};
}

test('public capacity distinguishes 300 MiB textbook PDF from the 30 MiB workshop and 5 MiB Markdown budgets',async t=>{const h=await fixture(t),limits=(await h.request('/config/public')).data.learningLimits;assert.equal(limits.textbookBytes,314572800);assert.equal(limits.pages,3000);assert.equal(limits.workshopBytes,31457280);assert.equal(limits.markdownBytes,5242880);assert.equal(limits.ocrPages,5);assert.equal(limits.structurePages,20);});
test('an actual 3000-page PDF extracts its final page and receives a bounded editable outline', {timeout:180000},async t=>{const h=await fixture(t),result=await h.parse(capacityPdf(3000));assert.equal(result.job.status,'completed',JSON.stringify(result.job));assert.equal(result.job.result.pageCount,3000);const page=await h.request('/files/'+result.file.id+'/content?page=3000');assert.equal(page.status,200);assert.match(page.data.page.text,/CAPACITY_PAGE_3000/);const outline=(await h.request('/textbooks/'+result.book.id+'/outline')).data;assert.ok(outline.chapters.length>0&&outline.chapters.length<=100);assert.equal(outline.chapters[0].startPage,1);assert.equal(outline.chapters.at(-1).endPage,3000);});
test('a valid PDF larger than 30 MiB passes upload and the separate extraction worker', {timeout:90000},async t=>{const h=await fixture(t),bytes=capacityPdf(1,31*1024**2);assert.ok(bytes.length>31457280&&bytes.length<314572800);const result=await h.parse(bytes);assert.equal(result.file.bytes,bytes.length);assert.equal(result.job.status,'completed',JSON.stringify(result.job));const page=await h.request('/files/'+result.file.id+'/content?page=1');assert.match(page.data.page.text,/CAPACITY_PAGE_1/);});
