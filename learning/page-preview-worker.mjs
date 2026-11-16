import path from 'node:path';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const bad=(code,message,status=422)=>Object.assign(new Error(message),{status,code});
const MAX_PIXELS=2000000,MAX_PNG=6*1024**2;

/** Fixed isolated worker: renders one physical page without extracting/reflowing its text. */
export async function renderPdfPage({dataDir,file,pageNumber}){
  if(!file||file.mime!=='application/pdf'||!/^[a-f0-9]{64}$/.test(file.sha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(file.storedName)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>300*1024**2)throw bad('PAGE_SOURCE_INVALID','PDF页面来源无效');
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>3000)throw bad('PAGE_NUMBER_INVALID','物理页码无效',400);
  const directory=await realpath(path.resolve(dataDir,'learning-files')),location=path.join(directory,file.storedName),before=await lstat(location);
  if(!before.isFile()||before.isSymbolicLink()||before.size!==file.bytes)throw bad('PAGE_SOURCE_CHANGED','PDF原件已改变',409);
  const resolved=await realpath(location);if(path.dirname(resolved).toLowerCase()!==directory.toLowerCase())throw bad('PAGE_SOURCE_INVALID','PDF页面来源路径无效');
  const bytes=await readFile(resolved),after=await lstat(resolved);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw bad('PAGE_SOURCE_CHANGED','PDF原件指纹已改变',409);
  const canvas=await import('@napi-rs/canvas');for(const name of ['DOMMatrix','ImageData','Path2D'])if(!globalThis[name]&&canvas[name])globalThis[name]=canvas[name];
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs 5.4.149 can resolve an empty operator list before a stopAtErrors
  // rejection. Observe its fixed-version removal warning and reject the page.
  const task=pdf.getDocument({data:new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength),isEvalSupported:false,enableXfa:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,maxImageSize:16000000,stopAtErrors:false,verbosity:pdf.VerbosityLevel.WARNINGS,useSystemFonts:true,disableFontFace:true,standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replace(/\\/g,'/')});
  const original=console.log;let blocked=false,surface,page;
  console.log=(...args)=>{if(args.length===1&&args[0]==='Warning: Image exceeded maximum allowed size and was removed.'){blocked=true;return;}original(...args);};
  try{
    const document=await task.promise;if(pageNumber>document.numPages)throw bad('PAGE_NOT_FOUND','PDF中没有这一物理页',404);
    page=await document.getPage(pageNumber);const base=page.getViewport({scale:1});
    if(![base.width,base.height].every(value=>Number.isFinite(value)&&value>0))throw bad('PAGE_GEOMETRY','PDF页面尺寸无效');
    const scale=Math.min(1200/base.width,1800/base.height,Math.sqrt(MAX_PIXELS/(base.width*base.height))),viewport=page.getViewport({scale}),width=Math.max(1,Math.floor(viewport.width)),height=Math.max(1,Math.floor(viewport.height));
    if(width>1200||height>1800||width*height>MAX_PIXELS)throw bad('PAGE_GEOMETRY','PDF页面像素超过预算');
    await page.getOperatorList();if(blocked)throw bad('PAGE_IMAGE_LIMIT','该PDF页含超大图片，无法提供完整原页预览');
    surface=canvas.createCanvas(width,height);await page.render({canvasContext:surface.getContext('2d'),viewport,canvas:surface,background:'white'}).promise;
    if(blocked)throw bad('PAGE_IMAGE_LIMIT','该PDF页含超大图片，未返回不完整预览');
    const png=surface.toBuffer('image/png');if(png.length>MAX_PNG)throw bad('PAGE_OUTPUT_LIMIT','PDF页面输出超过6MiB预算');return{png,width,height};
  }finally{console.log=original;page?.cleanup();if(surface){surface.width=1;surface.height=1;}await task.destroy().catch(()=>{});}
}

if(process.send&&process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let started=false;process.on('message',async message=>{if(started||message?.type!=='page-preview')return;started=true;try{const result=await renderPdfPage(message);process.send({type:'result',...result},()=>process.exit(0));}catch(error){const safe=typeof error.code==='string'&&error.code.startsWith('PAGE_')&&Number.isInteger(error.status);process.send({type:'error',status:safe?error.status:422,code:safe?error.code:'PAGE_RENDER_FAILED',message:safe?error.message:'PDF原页预览生成失败'},()=>process.exit(1));}});
  process.on('disconnect',()=>process.exit(1));
}
