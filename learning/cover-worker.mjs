import path from 'node:path';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const MAX_BYTES=300*1024**2,MAX_PIXELS=320*480,MAX_IMAGE_BYTES=2*1024**2;
const invalid=(code,message,status=422)=>Object.assign(new Error(message),{status,code});

/** Render only physical PDF page 1; this does not locate an internal book cover. */
export async function renderPdfFirstPage({dataDir,file}){
  if(!file||file.mime!=='application/pdf'||!/^[a-f0-9]{64}$/.test(file.sha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(file.storedName)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX_BYTES)throw invalid('COVER_SOURCE_INVALID','封面来源无效');
  const directory=await realpath(path.resolve(dataDir,'learning-files')),location=path.join(directory,file.storedName),info=await lstat(location);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==file.bytes)throw invalid('COVER_SOURCE_CHANGED','PDF文件已改变',409);
  const resolved=await realpath(location);if(path.dirname(resolved).toLowerCase()!==directory.toLowerCase())throw invalid('COVER_SOURCE_INVALID','封面来源路径无效');
  const bytes=await readFile(resolved);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw invalid('COVER_SOURCE_CHANGED','PDF指纹已改变',409);
  const canvas=await import('@napi-rs/canvas');for(const key of ['DOMMatrix','ImageData','Path2D'])if(!globalThis[key]&&canvas[key])globalThis[key]=canvas[key];
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,maxImageSize:16000000,stopAtErrors:true,verbosity:pdf.VerbosityLevel.WARNINGS,useSystemFonts:true,disableFontFace:true,standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replace(/\\/g,'/')});
  let surface,document;const original=console.log;let blocked=false;
  console.log=(...args)=>{if(args.length===1&&args[0]==='Warning: Image exceeded maximum allowed size and was removed.'){blocked=true;return;}original(...args);};
  try{
    document=await task.promise;if(document.numPages<1)throw invalid('COVER_RENDER_FAILED','PDF没有可渲染的第一页');
    const page=await document.getPage(1),base=page.getViewport({scale:1});
    if(![base.width,base.height].every(v=>Number.isFinite(v)&&v>0))throw invalid('COVER_GEOMETRY','PDF首页尺寸无效');
    const scale=Math.min(1,320/base.width,480/base.height),viewport=page.getViewport({scale}),width=Math.max(1,Math.ceil(viewport.width)),height=Math.max(1,Math.ceil(viewport.height));
    if(width>320||height>480||width*height>MAX_PIXELS)throw invalid('COVER_GEOMETRY','封面像素超过安全预算');
    surface=canvas.createCanvas(width,height);await page.render({canvasContext:surface.getContext('2d'),viewport,canvas:surface,background:'white'}).promise;
    if(blocked)throw invalid('COVER_IMAGE_LIMIT','PDF首页含超大图片，未生成不完整封面');
    const png=surface.toBuffer('image/png');if(png.length>MAX_IMAGE_BYTES)throw invalid('COVER_OUTPUT_LIMIT','封面输出超过安全预算');page.cleanup();return{png,width,height};
  }finally{console.log=original;if(surface){surface.width=1;surface.height=1;}await task.destroy().catch(()=>{});}
}

if(process.send&&process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let started=false;
  process.on('message',async message=>{if(started||message?.type!=='cover')return;started=true;try{const {png,width,height}=await renderPdfFirstPage(message);process.send({type:'result',png,width,height},()=>process.exit(0));}catch(error){const known=Number.isInteger(error.status)&&error.status>=400&&error.status<=599;process.send({type:'error',status:known?error.status:422,code:known?error.code:'COVER_RENDER_FAILED',message:known?error.message:'PDF首页缩略图生成失败'},()=>process.exit(1));}});
  process.on('disconnect',()=>process.exit(1));
}
