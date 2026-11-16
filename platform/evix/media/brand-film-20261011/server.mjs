import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.join(root,'outputs/evix-brand-film-20261011');
const runs=path.join(out,'renders');
const port=Number(process.env.EVIX_FILM_PORT||3191);
await fs.mkdir(runs,{recursive:true});
const sessions=new Map();
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.mp4':'video/mp4','.wav':'audio/wav','.png':'image/png','.md':'text/plain; charset=utf-8'};
async function body(req,max=20*1024*1024){let n=0;const a=[];for await(const b of req){n+=b.length;if(n>max)throw Error('Request too large');a.push(b);}return Buffer.concat(a);}
function reply(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
function safeJoin(base,rel){const p=path.resolve(base,rel);if(p!==base&&!p.startsWith(base+path.sep))throw Error('Outside allowed directory');return p;}
const server=http.createServer(async(req,res)=>{
 try{
  if(!['127.0.0.1','localhost'].includes((req.headers.host||'').split(':')[0]))return reply(res,403,{error:'Loopback only'});
  const u=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='POST'){
   if(req.headers.origin!==`http://127.0.0.1:${port}`&&req.headers.origin!==`http://localhost:${port}`)return reply(res,403,{error:'Origin mismatch'});
   if(u.pathname==='/api/start'){
    const spec=JSON.parse((await body(req,8192)).toString());
    if(!Number.isInteger(spec.frames)||spec.frames<1||spec.frames>7200||spec.fps!==24||spec.width!==1920||spec.height!==1080)throw Error('Invalid render contract');
    const id=randomUUID();const dir=path.join(runs,id);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'render.json'),JSON.stringify({id,...spec,startedAt:new Date().toISOString()},null,2));
    sessions.set(id,{dir,next:0,bytes:0,spec});return reply(res,200,{id});
   }
   const id=u.searchParams.get('id'),s=sessions.get(id);if(!s)throw Error('Unknown render session');
   if(u.pathname==='/api/chunk'){
    const seq=Number(u.searchParams.get('seq'));if(seq!==s.next)throw Error('Chunk out of order');const data=await body(req);if(s.bytes+data.length>3*1024**3)throw Error('Render size limit');
    await fs.appendFile(path.join(s.dir,'video.h264'),data);s.bytes+=data.length;s.next++;return reply(res,200,{seq,bytes:s.bytes});
   }
   if(u.pathname==='/api/still'){
    const frame=Number(u.searchParams.get('frame'));if(!Number.isInteger(frame)||frame<0||frame>5760)throw Error('Invalid frame');const data=await body(req);
    if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('PNG required');await fs.writeFile(path.join(s.dir,`frame-${String(frame).padStart(5,'0')}.png`),data);return reply(res,200,{frame});
   }
   if(u.pathname==='/api/finish'){
    const report=JSON.parse((await body(req,512*1024)).toString());if(report.encodedFrames!==s.spec.frames||!s.bytes)throw Error('Incomplete frame receipt');await fs.writeFile(path.join(s.dir,'complete.json'),JSON.stringify({...report,bytes:s.bytes,completeAt:new Date().toISOString()},null,2));console.log(JSON.stringify({event:'render_complete',id,...report,bytes:s.bytes}));sessions.delete(id);return reply(res,200,{id,path:`outputs/evix-brand-film-20261011/renders/${id}`});
   }
   if(u.pathname==='/api/cancel'){await fs.writeFile(path.join(s.dir,'cancelled.json'),JSON.stringify({at:new Date().toISOString()}));sessions.delete(id);return reply(res,200,{cancelled:true});}
   return reply(res,404,{error:'Unknown endpoint'});
  }
  if(req.method!=='GET')return reply(res,405,{error:'GET/POST only'});
  let target;
  if(u.pathname==='/api/status')return reply(res,200,{sessions:[...sessions.entries()].map(([id,s])=>({id,bytes:s.bytes,chunks:s.next,frames:s.spec.frames}))});
  if(u.pathname.startsWith('/vendor/three/'))target=safeJoin(path.join(here,'vendor/three'),decodeURIComponent(u.pathname.slice('/vendor/three/'.length)));
  else if(u.pathname.startsWith('/outputs/'))target=safeJoin(out,decodeURIComponent(u.pathname.slice('/outputs/'.length)));
  else target=safeJoin(here,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1)));
  const stat=await fs.stat(target);if(!stat.isFile())return reply(res,404,{error:'Not a file'});
  const headers={'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes'};
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m)return reply(res,416,{error:'Invalid range'});const start=+m[1],end=m[2]?Math.min(+m[2],stat.size-1):stat.size-1;if(start>end||start>=stat.size)return reply(res,416,{error:'Range outside file'});res.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${stat.size}`});createReadStream(target,{start,end}).pipe(res);}
  else{res.writeHead(200,{...headers,'content-length':stat.size});createReadStream(target).pipe(res);}
 }catch(e){if(!res.headersSent)reply(res,e.code==='ENOENT'?404:400,{error:e.message});else res.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log(`EVI-X film studio http://127.0.0.1:${port}`));
