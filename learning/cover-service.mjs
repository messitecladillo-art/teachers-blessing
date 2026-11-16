import path from 'node:path';
import {mkdir,lstat,realpath,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const MAX_BYTES=300*1024**2,MAX_OUTPUT=2*1024**2;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const fault=(status,code,message)=>Object.assign(new Error(message),{status,code});
const pngValid=bytes=>Buffer.isBuffer(bytes)&&bytes.length>=24&&bytes.length<=MAX_OUTPUT&&bytes.subarray(0,8).equals(PNG)&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(16)<=320&&bytes.readUInt32BE(20)>0&&bytes.readUInt32BE(20)<=480;

export function renderCoverIsolated(file,{dataDir,timeoutMs=30000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new RangeError('Cover timeout must be 1..30000ms');
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
    const child=fork(fileURLToPath(new URL('./cover-worker.mjs',import.meta.url)),[],{execArgv:['--max-old-space-size=256'],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env});let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);child.removeAllListeners();if(!child.killed)child.kill();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(fault(504,'COVER_TIMEOUT','PDF首页渲染超时，请保留书架占位')),timeoutMs);
    child.once('error',()=>finish(fault(422,'COVER_RENDER_FAILED','封面处理进程失败')));child.once('exit',()=>{if(!settled)finish(fault(422,'COVER_RENDER_FAILED','封面处理进程未完成'));});
    child.on('message',message=>{if(message?.type==='error'){const known=Number.isInteger(message.status)&&message.status>=400&&message.status<=599;finish(fault(known?message.status:422,known?message.code:'COVER_RENDER_FAILED',known?String(message.message).slice(0,200):'封面处理失败'));}else if(message?.type==='result'){const bytes=Buffer.from(message.png||[]);if(!pngValid(bytes))finish(fault(422,'COVER_OUTPUT_INVALID','封面图像输出无效'));else finish(null,bytes);}});
    child.send({type:'cover',dataDir,file:{storedName:file.storedName,sha256:file.sha256,bytes:file.bytes,mime:file.mime}},error=>{if(error)finish(fault(422,'COVER_RENDER_FAILED','无法启动封面进程'));});
  });
}

/** Private cache stores only derived PNG files keyed by source SHA and render profile. */
export function createCoverService({store,dataDir,render=renderCoverIsolated}){
  const cacheDir=path.resolve(dataDir,'learning-covers'),fileDir=path.resolve(dataDir,'learning-files'),inflight=new Map(),verified=new Map();let active=0;const waiting=[];
  async function slot(){if(active<2){active++;return;}if(waiting.length>=32)throw fault(429,'COVER_BUSY','封面生成请求较多，请稍后刷新');await new Promise((resolve,reject)=>{const item={resolve:()=>{clearTimeout(item.timer);resolve();},timer:null};item.timer=setTimeout(()=>{const index=waiting.indexOf(item);if(index>=0)waiting.splice(index,1);reject(fault(429,'COVER_BUSY','封面生成等待超时，请稍后刷新'));},30000);waiting.push(item);});}
  function release(){const next=waiting.shift();if(next)next.resolve();else active--;}
  function source(state,bookId,user){const book=state.textbooks.find(v=>v.id===bookId&&v.userId===user.id);if(!book)throw fault(404,'not_found','教材不存在或无权访问');const file=state.fileRecords.find(v=>v.id===book.activeFileId&&v.userId===user.id&&v.textbookId===book.id&&v.status!=='deleted');if(!file||file.mime!=='application/pdf')throw fault(404,'COVER_UNAVAILABLE','当前教材没有PDF首页封面');if(!/^[a-f0-9]{64}$/.test(file.sha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(file.storedName)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX_BYTES)throw fault(422,'COVER_SOURCE_INVALID','封面文件元数据无效');return file;}
  async function sourceInfo(file){const directory=await realpath(fileDir),location=path.join(directory,file.storedName),info=await lstat(location);if(!info.isFile()||info.isSymbolicLink()||info.size!==file.bytes)throw fault(409,'COVER_SOURCE_CHANGED','当前PDF文件已改变');const resolved=await realpath(location);if(path.dirname(resolved).toLowerCase()!==directory.toLowerCase())throw fault(422,'COVER_SOURCE_INVALID','封面来源路径无效');return{location:resolved,stamp:[info.size,info.mtimeMs,info.ctimeMs,info.ino].join(':')};}
  async function verify(file){const info=await sourceInfo(file),key=file.sha256+':'+file.storedName;if(verified.get(key)!==info.stamp){const hash=createHash('sha256');for await(const bytes of createReadStream(info.location))hash.update(bytes);const after=await sourceInfo(file);if(info.stamp!==after.stamp||hash.digest('hex')!==file.sha256)throw fault(409,'COVER_SOURCE_CHANGED','PDF内容指纹已改变');if(verified.size>=128)verified.delete(verified.keys().next().value);verified.set(key,info.stamp);}return info;}
  async function cached(filename){try{const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_OUTPUT)throw fault(422,'COVER_CACHE_INVALID','封面缓存无效');const resolved=await realpath(filename),directory=await realpath(cacheDir);if(path.dirname(resolved).toLowerCase()!==directory.toLowerCase())throw fault(422,'COVER_CACHE_INVALID','封面缓存路径无效');const bytes=await readFile(resolved);if(!pngValid(bytes))throw fault(422,'COVER_CACHE_INVALID','封面缓存图像无效');return bytes;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function image(file){const filename=path.join(cacheDir,file.sha256+'-first-page-v1.png'),hit=await cached(filename);if(hit)return hit;if(inflight.has(file.sha256))return inflight.get(file.sha256);
    const pending=(async()=>{await slot();let temporary;try{const existing=await cached(filename);if(existing)return existing;const output=await render(file,{dataDir});const bytes=Buffer.from(output?.png||output);if(!pngValid(bytes))throw fault(422,'COVER_OUTPUT_INVALID','封面输出不是受限PNG');await mkdir(cacheDir,{recursive:true,mode:0o700});temporary=path.join(cacheDir,'.'+randomUUID()+'.tmp');await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,filename);temporary=null;return bytes;}finally{if(temporary)await unlink(temporary).catch(()=>{});release();}})();inflight.set(file.sha256,pending);try{return await pending;}finally{inflight.delete(file.sha256);}
  }
  return{async get(bookId,user){const file=source(await store.snapshot(),bookId,user);let before;try{before=await verify(file);}catch(error){if(error.code==='ENOENT')throw fault(404,'COVER_UNAVAILABLE','PDF原件不存在');throw error;}const bytes=await image(file);const current=source(await store.snapshot(),bookId,user);if(current.id!==file.id||current.sha256!==file.sha256||current.storedName!==file.storedName||current.bytes!==file.bytes||(await sourceInfo(file)).stamp!==before.stamp)throw fault(409,'COVER_SOURCE_CHANGED','教材来源已更新，旧封面未返回');return{bytes,sourceSha256:file.sha256};}};
}
