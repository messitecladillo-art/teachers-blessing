const W=1920,H=1080,FPS=24,DURATION=240;
const $=id=>document.getElementById(id);
const canvas=$('frame'),ctx=canvas.getContext('2d',{alpha:false});
const stage=document.createElement('canvas');stage.width=W;stage.height=H;
let film,captions=[],playing=false,rendering=false,cancelled=false,time=0,raf,encoderConfig;
const uiErrors=[];const originalError=console.error;console.error=(...args)=>{uiErrors.push(args.map(String).join(' '));originalError(...args);};
const status=s=>$('status').textContent=s;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const smooth=(a,b,x)=>{const q=Math.max(0,Math.min(1,(x-a)/(b-a)));return q*q*(3-2*q);};
function lines(text,maxWidth){const result=[];for(const paragraph of String(text).split('\n')){let current='';const tokens=/[\u3400-\u9fff]/.test(paragraph)?[...paragraph]:paragraph.match(/\S+\s*/g)||[''];for(const ch of tokens){if(ctx.measureText(current+ch).width>maxWidth&&current){result.push(current.trimEnd());current=ch;}else current+=ch;}result.push(current.trimEnd());}return result;}
function drawText(text,y,{size=42,color='#F7F4ED',family='"Microsoft YaHei",sans-serif',weight=400,maxWidth=1560,lineHeight=size*1.5,align='center',x=W/2}={}){ctx.font=`${weight} ${size}px ${family}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';const a=lines(text,maxWidth);a.forEach((line,i)=>ctx.fillText(line,x,y+i*lineHeight));return a.length*lineHeight;}
function drawCaption(c,t){const duration=c.end-c.start,fade=Math.min(.85,duration*.15);const a=smooth(c.start,c.start+fade,t)*(1-smooth(c.end-fade,c.end,t));ctx.save();ctx.globalAlpha=a;
 const end=c.type==='end',title=c.type==='title',credit=c.type==='credit',flow=c.type==='workflow';
 const y=c.placement==='upper'?255:c.placement==='lower'?(String(c.zh).includes('\n')?740:835):end?350:505;
 if(end){ctx.fillStyle='rgba(2,8,15,.91)';ctx.fillRect(0,0,W,H);drawText('证见  EVI-X',235,{size:52,weight:500});const z=drawText(c.zh,350,{size:26,lineHeight:46,maxWidth:1450});drawText(c.en,350+z+42,{size:21,lineHeight:34,maxWidth:1400,color:'#9bb1c4',family:'Arial,sans-serif'});}
 else if(title&&t>218){
  ctx.fillStyle='rgba(1,8,14,.26)';ctx.fillRect(0,138,W,804);
  drawText('市场调查与分析工作台',325,{size:27,color:'#bdd8d8'});
  drawText('A WORKSPACE FOR MARKET RESEARCH',369,{size:17,color:'#bdd8d8',family:'Arial,sans-serif'});
  drawText('证见 EVI-X',495,{size:102,weight:500});
  drawText('让每个问题，都循证抵达行动。',625,{size:42});
  drawText('From questions, through evidence, to action.',696,{size:25,color:'#d7e2e5',family:'Arial,sans-serif'});
 }
 else{
  // A restrained dark veil preserves readability without turning scenes into slides.
  const g=ctx.createLinearGradient(0,y-120,0,y+190);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.4,'rgba(0,0,0,.34)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,y-120,W,310);
  ctx.shadowColor='#000';ctx.shadowBlur=20;const z=drawText(c.zh,y,{size:title?88:credit?28:flow?45:46,weight:title?500:400,lineHeight:title?110:68,maxWidth:1530});
  ctx.shadowBlur=12;drawText(c.en,y+z+9,{size:title?25:credit?17:24,color:credit?'#9bc0c8':'#d7e2e5',family:'Arial,sans-serif',maxWidth:1570,lineHeight:34});
 }
 ctx.restore();}
function draw(t){film.render(t);ctx.drawImage(stage,0,0,W,H);
 // Scope 2.39:1 within a 1080p delivery container.
 ctx.fillStyle='#020407';ctx.fillRect(0,0,W,138);ctx.fillRect(0,942,W,138);
 for(const c of captions)if(t>=c.start&&t<c.end)drawCaption(c,t);
 const f=1-smooth(0,2,t)+smooth(239.3,240,t);if(f>0){ctx.fillStyle=`rgba(0,0,0,${Math.min(1,f)})`;ctx.fillRect(0,0,W,H);}
 $('time').value=t.toFixed(1);$('seek').value=t;const sh=film.shotAt(t);$('shot').textContent=typeof sh==='string'?sh:sh?.name||sh?.id||'';
}
function stop(){playing=false;cancelAnimationFrame(raf);$('play').textContent='播放预览';$('audio').pause();}
function preview(){if(rendering)return;if(playing)return stop();playing=true;$('play').textContent='暂停预览';const started=performance.now(),from=time;const a=$('audio');a.currentTime=Math.min(time,239.99);a.play().catch(()=>{});function step(now){if(!playing)return;time=from+(now-started)/1000;if(time>=240){time=239.99;draw(time);stop();return;}draw(time);raf=requestAnimationFrame(step);}raf=requestAnimationFrame(step);}
async function post(route,data,extra=''){const r=await fetch(`/api/${route}${extra}`,{method:'POST',body:typeof data==='string'||data instanceof Blob||ArrayBuffer.isView(data)?data:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||r.statusText);return j;}
async function probe(){if(!('VideoEncoder'in window))throw Error('此浏览器没有 WebCodecs VideoEncoder，请在 Chrome 中打开本机地址。');for(const codec of ['avc1.640028','avc1.420028'])for(const hardwareAcceleration of ['prefer-hardware','prefer-software']){const candidate={codec,width:W,height:H,bitrate:16000000,framerate:FPS,avc:{format:'annexb'},hardwareAcceleration,latencyMode:'quality'};const r=await VideoEncoder.isConfigSupported(candidate);if(r.supported){encoderConfig=candidate;status(`编码器已就绪：${codec} / ${hardwareAcceleration}。逐帧导出 ${W}×${H}，${FPS} fps。`);return candidate;}}throw Error('没有可用的 H.264 编码配置');}
function lock(on){rendering=on;for(const id of ['play','sample','export','jump','seek','time','probe','stills'])$(id).disabled=on;$('cancel').disabled=!on;for(const b of $('shots').children)b.disabled=on;}
async function still(id,f){const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error('Still capture failed');await post('still',blob,`?id=${id}&frame=${f}`);}
const QA_TIMES=[3,8,18,29,39.2,46,52,61,69,76,86,95,103,110,115,121,129,138,146,154,162,170,178,186,194,201,208,215,222,228,234];
async function exportFilm(sample=false){if(rendering)return;stop();lock(true);cancelled=false;let enc,id,encError,pending=[],encoded=0,seq=0;const start=sample?Math.max(0,Math.min(232,time)):0;const frames=(sample?8:DURATION)*FPS;const t0=performance.now();const timings=[];
 try{const config=encoderConfig||await probe();const session=await post('start',{frames,fps:FPS,width:W,height:H,start,duration:frames/FPS,kind:sample?'sample':'full',config});id=session.id;
 enc=new VideoEncoder({output:chunk=>{const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);pending.push(b);encoded++;},error:e=>{encError=e;}});enc.configure(config);$('progress').max=frames;
 for(let f=0;f<frames;f++){
  if(cancelled)throw Error('已取消渲染');if(encError)throw encError;const t=start+f/FPS;const a=performance.now();draw(t);timings.push(performance.now()-a);
  const vf=new VideoFrame(canvas,{timestamp:Math.round(f*1000000/FPS),duration:Math.round(1000000/FPS)});enc.encode(vf,{keyFrame:f%48===0});vf.close();
  if(!sample&&QA_TIMES.some(s=>Math.round(s*FPS)===f))await still(id,f);
  if((f+1)%24===0||f===frames-1){await enc.flush();if(encError)throw encError;let bytes=pending.reduce((n,x)=>n+x.length,0);const packet=new Uint8Array(bytes);let offset=0;for(const b of pending){packet.set(b,offset);offset+=b.length;}pending=[];await post('chunk',packet,`?id=${id}&seq=${seq++}`);$('progress').value=f+1;status(`正在渲染 ${sample?'样片':'全片'}：${f+1} / ${frames} 帧\n影片 ${t.toFixed(1)} 秒 / ${start+frames/FPS} 秒；已用 ${((performance.now()-t0)/1000).toFixed(0)} 秒。`);await sleep(0);}
 }
 await enc.flush();if(encoded!==frames)throw Error(`编码帧数不一致：${encoded}/${frames}`);enc.close();enc=null;
 const sorted=[...timings].sort((a,b)=>a-b);const receipt={encodedFrames:encoded,expectedFrames:frames,start,duration:frames/FPS,fps:FPS,width:W,height:H,elapsedSeconds:(performance.now()-t0)/1000,renderMsMedian:sorted[Math.floor(sorted.length*.5)],renderMsP95:sorted[Math.floor(sorted.length*.95)],errors:uiErrors,config};
 const result=await post('finish',receipt,`?id=${id}`);status(`逐帧渲染完成：${encoded} 帧，${frames/FPS} 秒。\n渲染目录：${result.path}\n下一步：本机合成音轨并封装 MP4。`);
 }catch(e){if(enc&&enc.state!=='closed')enc.close();if(id)await post('cancel',{},`?id=${id}`).catch(()=>{});status(`渲染未完成：${e.message}`);console.error(e);}finally{lock(false);}
}
async function saveStills(){if(rendering)return;stop();lock(true);let id;try{({id}=await post('start',{frames:1,fps:24,width:W,height:H,start:0,duration:240,kind:'stills'}));for(const t of QA_TIMES){draw(t);await still(id,Math.round(t*24));status(`保存分镜：${t} 秒`);await sleep(0);}await post('cancel',{},`?id=${id}`);status(`分镜图已保存：outputs/evix-brand-film-20261011/renders/${id}`);}catch(e){status(e.message);}finally{lock(false);}}
$('play').onclick=preview;$('jump').onclick=()=>{stop();time=Math.min(239.99,Math.max(0,Number($('time').value)||0));draw(time);};$('seek').oninput=()=>{stop();time=Number($('seek').value);draw(time);};$('probe').onclick=()=>probe().catch(e=>status(e.message));$('sample').onclick=()=>exportFilm(true);$('export').onclick=()=>exportFilm(false);$('cancel').onclick=()=>{cancelled=true;};$('stills').onclick=saveStills;
for(const [t,label]of [[8,'序幕'],[30,'城市'],[65,'档案'],[102,'遗漏'],[135,'窗前'],[165,'回看'],[195,'证见'],[223,'黎明'],[233,'片尾']]){const b=document.createElement('button');b.textContent=`${label} ${t}s`;b.onclick=()=>{stop();time=t;draw(t);};$('shots').appendChild(b);}
try{await document.fonts.ready;const module=await import('./scene.mjs');film=module.createFilmScene(stage,{width:W,height:H});const response=await fetch('./captions.json');if(!response.ok)throw Error('字幕尚未就绪');captions=await response.json();draw(8);time=8;lock(false);status('场景已就绪。可预览、定位任意时刻，或先渲染 8 秒样片。');}catch(e){status(`加载失败：${e.message}`);console.error(e);}
window.addEventListener('beforeunload',()=>{stop();film?.dispose();});
