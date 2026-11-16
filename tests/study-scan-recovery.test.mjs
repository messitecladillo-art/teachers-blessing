import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, copyFile, access, rm } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { createStudyStore } from '../learning/store.mjs';
import { createLearningService, readImageDimensions } from '../learning/services.mjs';

// All pixels and PDF objects are generated here; no student or external files.
function scanJpeg(width, height, label = 'SYNTHETIC WATER CYCLE') {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000'; ctx.font = `${Math.round(width / 22)}px sans-serif`;
  ctx.fillText(label, width / 12, height / 5);
  ctx.font = `${Math.round(width / 30)}px sans-serif`;
  ctx.fillText('Water evaporates and condenses.', width / 12, height / 3);
  ctx.fillText('This page is a self-authored test.', width / 12, height / 2);
  return canvas.toBuffer('image/jpeg');
}
function scanPdf(pages) {
  const objects = [null, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`)];
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  pages.forEach(({ width, height, jpeg, mediaWidth = 612, mediaHeight = 842 }, i) => {
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mediaWidth} ${mediaHeight}] /Resources << /XObject << /Scan ${5 + i * 3} 0 R >> >> /Contents ${4 + i * 3} 0 R >>`));
    objects.push(stream('', Buffer.from(`q ${mediaWidth} 0 0 ${mediaHeight} 0 0 cm /Scan Do Q`)));
    objects.push(stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg));
  });
  const buffers = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = buffers[0].length;
  for (let i = 1; i < objects.length; i++) { offsets.push(length); const value = Buffer.concat([Buffer.from(`${i} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')]); buffers.push(value); length += value.length; }
  buffers.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(buffers);
}
async function harness(t, { withLanguage = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mentrix-scan-recovery-')), store = createStudyStore({ dataDir: directory });
  if (withLanguage) {
    const source = fileURLToPath(new URL('../.local/learning/ocr-langs/eng.traineddata', import.meta.url));
    try { await access(source); } catch { await rm(directory, { recursive: true, force: true }); t.skip('Explicit local eng.traineddata fixture is not installed; no network download'); return null; }
    await mkdir(path.join(directory, 'ocr-langs')); await copyFile(source, path.join(directory, 'ocr-langs/eng.traineddata'));
  }
  await store.mutate(state => state.textbooks.push({ id: 'scan-book', userId: 'owner', title: 'Synthetic scan', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  let starts = 0;
  const service = createLearningService({ store, dataDir: directory, onOcrWorkerStart: () => starts++ });
  const server = http.createServer(async (req, res) => {
    try { if (!await service.handle(req, res, new URL(req.url, 'http://local').pathname, { id: req.headers['x-user'] || 'owner' })) { res.writeHead(404); res.end(); } }
    catch (failure) { res.writeHead(failure.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error_code: failure.code, message: failure.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = async (route, { method = 'GET', body, raw, user } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${route}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'X-File-Name': 'synthetic-scan.pdf' } : {}), ...(user ? { 'X-User': user } : {}) }, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    return { status: response.status, ...await response.json() };
  };
  const wait = async id => { for (let attempt = 0; attempt < 2000; attempt++) { const response = await request('/jobs/' + id); if (!['queued', 'running', 'cancelling'].includes(response.data.status)) return response.data; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Synthetic parse did not settle'); };
  const upload = async raw => { const result = await request('/textbooks/scan-book/files', { method: 'POST', raw }); assert.equal(result.status, 201); return result.data; };
  const parse = async body => { const task = await request('/textbooks/scan-book/parse', { method: 'POST', body }); assert.equal(task.status, 202, JSON.stringify(task)); return wait(task.data.id); };
  t.after(async () => { await service.close(); await new Promise(resolve => server.close(resolve)); const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('mentrix-scan-recovery-')); await rm(resolved, { recursive: true, force: true }); });
  return { request, wait, parse, upload, store, get starts() { return starts; } };
}

test('textless scan keeps its actual page count and explicit private OCR recovery state', async t => {
  const h = await harness(t), jpeg = scanJpeg(600, 800);
  await h.upload(scanPdf(Array.from({ length: 7 }, () => ({ width: 600, height: 800, jpeg }))));
  const job = await h.parse({}); assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'NO_TEXT');
  assert.equal(job.result.pageCount, 7); assert.equal(job.result.needsOcr, true); assert.deepEqual(job.result.pendingPages, [1, 2, 3, 4, 5, 6, 7]);
  const file = (await h.request('/textbooks/scan-book/files')).data.items[0], outline = (await h.request('/textbooks/scan-book/outline')).data;
  assert.equal(file.status, 'needs-ocr'); assert.equal(file.pageCount, 7); assert.equal(outline.status, 'needs-ocr'); assert.equal(outline.pageCount, 7); assert.equal(outline.knowledgePoints.length, 0);
  assert.equal((await h.request('/files/' + file.id + '/content')).status, 409);
  assert.equal((await h.request('/textbooks/scan-book/files', { user: 'stranger' })).status, 404);
  assert.equal(h.starts, 0); assert.ok((await h.store.snapshot()).ledger.every(entry => entry.status === 'released'));
});

test('ordinary 12.17M-pixel scanned page really OCRs, sequential ranges retain earlier text', async t => {
  const h = await harness(t, { withLanguage: true }); if (!h) return;
  const width = 2952, height = 4124, jpeg = scanJpeg(width, height);
  await h.upload(scanPdf([{ width, height, jpeg }, { width: 600, height: 800, jpeg: scanJpeg(600, 800, 'SYNTHETIC SECOND PAGE') }]));
  const first = await h.parse({ ocr: true, ocrPages: 1, startPage: 1, endPage: 1, ocrLanguage: 'eng' });
  assert.equal(first.status, 'completed', JSON.stringify(first)); assert.equal(first.result.partial, true); assert.deepEqual(first.result.pendingPages, [2]);
  const file = (await h.request('/textbooks/scan-book/files')).data.items[0], earlier = (await h.request('/files/' + file.id + '/content?page=1')).data.page.text;
  assert.match(earlier, /evaporates|condenses/i);
  const second = await h.parse({ ocr: true, ocrPages: 1, startPage: 2, endPage: 2, ocrLanguage: 'eng' });
  assert.equal(second.status, 'completed'); assert.equal(second.result.partial, false); assert.deepEqual(second.result.pendingPages, []);
  assert.equal((await h.request('/files/' + file.id + '/content?page=1')).data.page.text, earlier);
  assert.match((await h.request('/files/' + file.id + '/content?page=2')).data.page.text, /SECOND PAGE/i); assert.equal(h.starts, 2);
  const plain = await h.parse({}); assert.equal(plain.status, 'completed'); assert.equal((await h.request('/files/' + file.id + '/content?page=1')).data.page.text, earlier);
});

test('over-16M PDF image is blocked before OCR, keeps pending page and releases failed work', async t => {
  const h = await harness(t), jpeg = scanJpeg(4001, 4000);
  // A genuine JPEG/PDF boundary, not inconsistent image dictionary metadata.
  await h.upload(scanPdf([{ width: 4001, height: 4000, jpeg }]));
  const job = await h.parse({ ocr: true, ocrPages: 1, ocrLanguage: 'eng' });
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'NO_TEXT'); assert.equal(job.result.pageCount, 1);
  assert.deepEqual(job.result.pendingPages, [1]); assert.equal(job.result.blockedPages[0].code, 'PDF_IMAGE_PIXELS'); assert.equal(job.result.blockedPages[0].page, 1);
  assert.equal(h.starts, 0); assert.ok((await h.store.snapshot()).ledger.every(entry => entry.status === 'released'));
});

test('large physical PDF page is rendered within bounded OCR pixels; direct-image limits remain strict', async t => {
  const h = await harness(t, { withLanguage: true }); if (!h) return;
  const jpeg = scanJpeg(1000, 1300);
  await h.upload(scanPdf([{ width: 1000, height: 1300, jpeg, mediaWidth: 6000, mediaHeight: 7800 }]));
  const job = await h.parse({ ocr: true, ocrPages: 1, ocrLanguage: 'eng' }); assert.equal(job.status, 'completed', JSON.stringify(job));
  const content = (await h.request('/files/' + job.result.fileId + '/content')).data; assert.match(content.page.text, /evaporates|condenses/i);
  assert.ok(content.page.ocrRender.width * content.page.ocrRender.height <= 12000000); assert.ok(content.page.ocrRender.width <= 4096 && content.page.ocrRender.height <= 4096);
  assert.throws(() => readImageDimensions(scanJpeg(2952, 4124), 'image/jpeg'), failure => failure.code === 'IMAGE_PIXELS');
});

test('seven scan pages recover as five then two without overwriting the first batch', async t => {
  const h = await harness(t, { withLanguage: true }); if (!h) return;
  const jpeg = scanJpeg(600, 800);
  await h.upload(scanPdf(Array.from({ length: 7 }, () => ({ width: 600, height: 800, jpeg }))));
  await h.parse({});
  const first = await h.parse({ ocr: true, ocrPages: 5, startPage: 1, endPage: 5, ocrLanguage: 'eng' });
  assert.equal(first.status, 'completed'); assert.deepEqual(first.result.pendingPages, [6, 7]);
  const earlier = (await h.store.snapshot()).fileRecords[0].pages.slice(0, 5);
  const second = await h.parse({ ocr: true, ocrPages: 2, startPage: 6, endPage: 7, ocrLanguage: 'eng' });
  assert.equal(second.status, 'completed'); assert.equal(second.result.needsOcr, false); assert.equal(second.result.partial, false);
  assert.deepEqual((await h.store.snapshot()).fileRecords[0].pages.slice(0, 5), earlier); assert.equal(h.starts, 7);
});

test('a blocked later range keeps usable earlier text, its failed reservation releases, and known OCR is never erased', async t => {
  const h = await harness(t, { withLanguage: true }); if (!h) return;
  const jpeg = scanJpeg(600, 800), huge = scanJpeg(4001, 4000);
  await h.upload(scanPdf([{ width: 600, height: 800, jpeg }, { width: 4001, height: 4000, jpeg: huge }, { width: 600, height: 800, jpeg }]));
  const first = await h.parse({ ocr: true, ocrPages: 1, startPage: 1, endPage: 1, ocrLanguage: 'eng' }); assert.equal(first.status, 'completed');
  const earlier = (await h.store.snapshot()).fileRecords[0].pages[0].text;
  const outlineRevision = (await h.request('/textbooks/scan-book/outline')).data.outlineRevision;
  const blocked = await h.parse({ ocr: true, ocrPages: 1, startPage: 2, endPage: 2, ocrLanguage: 'eng' });
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.error.code, 'NO_TEXT'); assert.equal(blocked.result.blockedPages[0].page, 2);
  let state = await h.store.snapshot(); assert.equal(state.fileRecords[0].status, 'partial'); assert.equal(state.fileRecords[0].pages[0].text, earlier); assert.equal(state.ledger.find(entry => entry.jobId === blocked.id).status, 'released');
  assert.equal((await h.request('/textbooks/scan-book/outline')).data.outlineRevision, outlineRevision);
  const later = await h.parse({ ocr: true, ocrPages: 1, startPage: 3, endPage: 3, ocrLanguage: 'eng' }); assert.equal(later.status, 'completed'); assert.deepEqual(later.result.pendingPages, [2]); assert.equal(later.result.blockedPages[0].page, 2);
  await h.store.mutate(value => { value.fileRecords[0].pages[1].text = 'Synthetic previously verified OCR text, retained unchanged.'; });
  const recovered = await h.parse({ ocr: true, ocrPages: 1, startPage: 2, endPage: 2, ocrLanguage: 'eng' }); assert.equal(recovered.status, 'completed'); assert.deepEqual(recovered.result.blockedPages, []); assert.equal(recovered.result.partial, false);
  state = await h.store.snapshot(); assert.equal(state.fileRecords[0].pages[1].text, 'Synthetic previously verified OCR text, retained unchanged.'); assert.equal(h.starts, 2);
});
