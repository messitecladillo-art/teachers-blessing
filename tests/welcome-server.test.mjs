import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from '../server.mjs';
test('welcome has isolated rendering policy and public local SPZ files while private files stay hidden',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'book-garden-http-'));await mkdir(path.join(root,'assets/world/book-garden'),{recursive:true});await writeFile(path.join(root,'welcome.html'),'<!doctype html><title>Self-authored world fixture</title>');await writeFile(path.join(root,'study.html'),'<!doctype html><title>Study fixture</title>');await writeFile(path.join(root,'assets/world/book-garden/world.spz'),'SYNTHETIC_HTTP_BYTES_NOT_A_REAL_SCENE');
 const server=createServer({root,config:{apiKey:'',model:'',allowedModels:[]}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(root)).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(root).startsWith('book-garden-http-'));await rm(root,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port;for(const route of ['/welcome','/welcome/','/welcome.html']){const response=await fetch(origin+route);assert.equal(response.status,200);const csp=response.headers.get('content-security-policy');assert.match(csp,/script-src 'self' 'wasm-unsafe-eval'/);assert.match(csp,/worker-src 'self' blob:/);assert.ok(!csp.includes("'unsafe-eval'"));assert.ok(!csp.includes("'unsafe-inline'"));}
 const study=await fetch(origin+'/study');assert.equal(study.status,200);assert.equal(study.headers.get('content-security-policy'),null);const asset=await fetch(origin+'/assets/world/book-garden/world.spz');assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'application/octet-stream');assert.equal((await fetch(origin+'/.env')).status,404);assert.equal((await fetch(origin+'/.local/learning/study.json')).status,404);
});
