import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractLearningDocument,LEARNING_LIMITS} from './services.mjs';

// Fixed entrypoint; only its authenticated parent selects a private file. No
// model provider, credentials, arbitrary scripts or shell commands are accepted.
let started=false,sequence=0;
const waiting=new Map();
process.on('message',async message=>{
  if(message?.type==='progress-ack'){waiting.get(message.sequence)?.();waiting.delete(message.sequence);return;}
  if(started||message?.type!=='extract')return;started=true;
  const send=(value,exit)=>{if(!process.connected)return process.exit(exit||0);process.send(value,()=>{if(exit!==undefined)process.exit(exit);});};
  try{
    const{file,location,options,dataDir,previousPages}=message;
    const maximum=file.mime==='text/markdown'?LEARNING_LIMITS.markdownBytes:LEARNING_LIMITS.workshopBytes,info=await stat(location);
    if(!info.isFile()||info.size>maximum||info.size!==file.bytes)throw Object.assign(new Error('私有文件大小已改变或超过解析预算'),{status:413,code:'FILE_LIMIT'});
    const bytes=await readFile(location);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Object.assign(new Error('私有文件指纹已改变'),{status:409,code:'STALE_SOURCE'});
    const controller=new AbortController();const context={signal:controller.signal,dataDir,previousPages,onOcrStart:()=>send({type:'ocr-start'}),setCleanup:()=>{},progress:value=>new Promise(resolve=>{const current=++sequence;waiting.set(current,resolve);send({type:'progress',sequence:current,value});})};
    const document=await extractLearningDocument(bytes,file,context,options);
    if(document.pages.reduce((sum,page)=>sum+page.text.length,0)>LEARNING_LIMITS.textChars||Buffer.byteLength(JSON.stringify(document))>16*1024**2)throw Object.assign(new Error('提取文本超过本机输出预算，请分拆文档'),{status:413,code:'TEXT_BUDGET'});
    send({type:'result',document},0);
  }catch(failure){const known=Number.isInteger(failure.status)&&failure.status>=400&&failure.status<=599;send({type:'error',status:known?failure.status:422,code:known?failure.code:'DOCUMENT_PROCESS_FAILED',message:known?failure.message:'文档解析失败，文件可能损坏、加密或不受支持'},1);}
});
process.on('disconnect',()=>process.exit(1));
