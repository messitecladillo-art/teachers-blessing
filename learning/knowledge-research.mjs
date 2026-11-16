import {randomUUID,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {LEARNING_LIMITS as L} from './limits.mjs';

const now=()=>new Date().toISOString();
const active=j=>['queued','running','cancelling'].includes(j.status);
const fault=(status,code,message)=>Object.assign(new Error(message),{status,code,researchPublic:true});
const entity=(userId,value)=>({id:randomUUID(),userId,createdAt:now(),updatedAt:now(),...value});
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const title=v=>{if(typeof v!=='string'||!v.trim()||v.length>200)throw fault(409,'RESEARCH_TITLE','请先核对不超过200字符的教材、章节和知识点名称');return v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();};
const own=(s,c,id,user)=>{const value=s[c].find(v=>v.id===id&&v.userId===user.id);if(!value)throw fault(404,'NOT_FOUND','内容不存在或无权访问');return value;};
function base(s,user,kpId){const kp=own(s,'knowledgePoints',kpId,user);if(kp.archived)throw fault(404,'NOT_FOUND','知识点已归档');const book=own(s,'textbooks',kp.textbookId,user),chapter=own(s,'chapters',kp.chapterId,user);if(chapter.archived||chapter.textbookId!==book.id)throw fault(404,'NOT_FOUND','章节不属于当前教材');return{kp,book,chapter};}
function binding(s,user,kpId){
  const {kp,book,chapter}=base(s,user,kpId),a=kp.sourceAnchor,file=own(s,'fileRecords',a?.fileId,user);
  const latest=s.fileRecords.filter(f=>f.userId===user.id&&f.textbookId===book.id&&f.status!=='deleted').at(-1);
  if(file.status==='deleted'||file.textbookId!==book.id||latest?.id!==file.id||book.activeFileId!==file.id||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(file.sha256)||file.sha256!==a.sha256||!Number.isSafeInteger(kp.revision)||kp.revision<0||!Number.isSafeInteger(a.startPage)||a.startPage<1||!Number.isSafeInteger(a.endPage)||a.endPage<a.startPage)throw fault(409,'RESEARCH_SOURCE_CHANGED','来源文件或知识点已改变，请在当前教材重新发起检索');
  const anchor={fileId:file.id,sha256:file.sha256,startPage:a.startPage,endPage:a.endPage};for(const k of ['startOffset','endOffset'])if(Number.isSafeInteger(a[k])&&a[k]>=0)anchor[k]=a[k];
  const titles={bookTitle:title(book.title),chapterTitle:title(chapter.title),knowledgePointTitle:title(kp.title)};
  return{knowledgePointId:kp.id,textbookId:book.id,chapterId:chapter.id,fileId:file.id,fileSha256:file.sha256,sourceRevision:kp.revision,sourceAnchor:anchor,titles};
}
function current(s,user,kpId,saved){try{return hash(binding(s,user,kpId))===hash(saved);}catch{return false;}}
export function isCurrentKnowledgeResearch(state,user,artifact){return artifact?.type==='knowledge-research'&&artifact.userId===user?.id&&current(state,user,artifact.knowledgePointId,artifact.sourceBinding);}
function safeUrl(raw){
  if(typeof raw!=='string'||raw.length>2048)throw fault(502,'RESEARCH_SOURCE_URL','检索来源链接不合法');let url;try{url=new URL(raw);}catch{throw fault(502,'RESEARCH_SOURCE_URL','检索来源链接不合法');}
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host==='localhost'||/\.(?:localhost|local|internal|test|invalid)$/.test(host))throw fault(502,'RESEARCH_SOURCE_URL','检索来源须为可核验的公开HTTPS网页');
  url.hash='';return url.href;
}
const platform=url=>{const h=new URL(url).hostname;return /(^|\.)zhihu\.com$/i.test(h)?'zhihu':/(^|\.)(bilibili\.com|b23\.tv)$/i.test(h)?'bilibili':'web';};
export function validateKnowledgeResearch(raw){
  if(!plain(raw)||!Array.isArray(raw.sources)||raw.sources.length>20||!Number.isSafeInteger(raw.toolCalls)||raw.toolCalls<1||raw.toolCalls>10||raw.search&&raw.search.executed!==true)throw fault(502,'RESEARCH_OUTPUT','检索未返回可核验的执行记录');
  const searchedAt=new Date(raw.searchedAt);if(!Number.isFinite(searchedAt.getTime()))throw fault(502,'RESEARCH_OUTPUT','检索时间缺失或无效');
  const sources=[],ids=new Set();for(const item of raw.sources){if(!plain(item)||item.access!=='search-index'||typeof item.title!=='string'||!item.title.trim()||item.title.length>300)throw fault(502,'RESEARCH_OUTPUT','检索来源字段或访问层级无效');const url=safeUrl(item.url);if(sources.some(s=>s.url===url))continue;const id=item.id===undefined?'S'+(sources.length+1):item.id;if(typeof id!=='string'||!id||id.length>100||ids.has(id))throw fault(502,'RESEARCH_OUTPUT','来源标识无效');ids.add(id);sources.push({id,url,title:item.title.trim(),domain:new URL(url).hostname,platform:platform(url),access:'search-index'});}
  const noResults=sources.length===0;
  if(!noResults&&(typeof raw.content!=='string'||!raw.content.trim()||raw.content.length>30000))throw fault(502,'RESEARCH_OUTPUT','检索综合内容为空或超出预算');
  const content=noResults?'未获得可核验的公开检索来源，未生成外部解析。可调整知识点名称后重试；这不表示已完成调研。':raw.content;
  const result={status:noResults?'no-results':'generated-review-required',content,sources,searchedAt:searchedAt.toISOString(),toolCalls:raw.toolCalls,requiresHumanReview:true,access:'search-index',evidenceNotice:'仅基于公开检索索引与可核验链接，不等于已读取网页或视频全文。'};
  if(raw.search)result.search={executed:true,toolCalls:raw.toolCalls,method:typeof raw.search.method==='string'?raw.search.method.slice(0,80):'provider-web-search'};
  if(plain(raw.usage)){const usage={};for(const k of ['inputTokens','outputTokens','totalTokens','webSearchCalls'])if(Number.isSafeInteger(raw.usage[k])&&raw.usage[k]>=0)usage[k]=raw.usage[k];if(Object.keys(usage).length)result.usage=usage;}
  if(raw.annotations!==undefined){if(!Array.isArray(raw.annotations)||raw.annotations.length>100)throw fault(502,'RESEARCH_OUTPUT','来源注释超出预算');result.annotations=raw.annotations.map(a=>{if(!plain(a))throw fault(502,'RESEARCH_OUTPUT','来源注释无效');const url=safeUrl(a.url),source=sources.find(s=>s.url===url);if(!source||a.sourceId!==undefined&&a.sourceId!==source.id)throw fault(502,'RESEARCH_OUTPUT','来源注释不在真实来源集合');const v={sourceId:source.id,url,title:source.title};if(['provider-url-citation','explicit-tool-url'].includes(a.citationKind))v.citationKind=a.citationKind;if(a.indexBasis==='provider-output-text')v.indexBasis=a.indexBasis;for(const k of ['startIndex','endIndex'])if(a[k]!==undefined){if(!Number.isSafeInteger(a[k])||a[k]<0||a[k]>content.length)throw fault(502,'RESEARCH_OUTPUT','来源注释位置无效');v[k]=a[k];}if(v.startIndex!==undefined&&v.endIndex!==undefined&&v.endIndex<v.startIndex)throw fault(502,'RESEARCH_OUTPUT','来源注释位置无效');return v;});}
  return result;
}
function abortable(work,signal){signal.throwIfAborted();return new Promise((resolve,reject)=>{let done=false;const finish=(error,value)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>finish(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}Promise.resolve().then(work).then(v=>finish(null,v),e=>finish(e));});}

/** Only public title metadata reaches provider. Source text, notes and answers never do. */
export function createKnowledgeResearch({store,provider,maxDailyUnits=L.dailyUnits,jobTimeoutMs=90000}={}){
  if(!store?.snapshot||!store?.mutate)throw new TypeError('A study store is required');
  if(!Number.isSafeInteger(maxDailyUnits)||maxDailyUnits<0||!Number.isSafeInteger(jobTimeoutMs)||jobTimeoutMs<1||jobTimeoutMs>180000)throw new TypeError('Invalid research budgets');
  const running=new Map(),importRuns=new Map();let closed=false;
  const configured=()=>typeof provider==='function'&&provider.configured!==false;
  const ready=store.mutate(s=>{for(const job of s.jobs)if(job.type==='knowledge-research'&&active(job)){job.status='interrupted';job.error={code:'RESEARCH_INTERRUPTED',message:'服务重启，未自动重发检索；可显式继续。'};job.updatedAt=now();for(const row of s.ledger)if(row.jobId===job.id&&row.status==='reserved')row.status=row.providerAttempted?'settled':'released';}});
  function enabled(){if(!configured())throw fault(503,'RESEARCH_NOT_CONFIGURED','公开资料检索尚未配置；可继续阅读已保存结果。');if(closed)throw fault(503,'RESEARCH_CLOSED','检索服务正在关闭');}
  function view(s,user,item){return{...item,stale:!isCurrentKnowledgeResearch(s,user,item)};}
  async function executeResearch({kpId,user,signal,ownJobId}={}){
    await ready;enabled();const initial=await store.snapshot();if(initial.jobs.some(j=>j.type==='knowledge-research'&&j.userId===user.id&&j.id!==ownJobId&&j.payload.knowledgePointId===kpId&&active(j)))throw fault(409,'RESEARCH_BUSY','该知识点已有进行中的检索');const saved=binding(initial,user,kpId),controller=new AbortController();let timedOut=false;
    const abort=()=>controller.abort(fault(499,'JOB_CANCELLED','检索已取消，迟到结果不会写入'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>{timedOut=true;controller.abort(fault(504,'RESEARCH_TIMEOUT','公开资料检索超时，未保存新结果'));},jobTimeoutMs);
    try{const raw=await abortable(()=>provider({...saved.titles,signal:controller.signal}),controller.signal);controller.signal.throwIfAborted();const validated=validateKnowledgeResearch(raw);if(!current(await store.snapshot(),user,kpId,saved))throw fault(409,'RESEARCH_SOURCE_CHANGED','教材来源或知识点在检索时发生变化，未保存旧结果');return{...validated,resultId:randomUUID(),sourceBinding:saved};}
    catch(error){if(controller.signal.aborted)throw fault(timedOut?504:499,timedOut?'RESEARCH_TIMEOUT':'JOB_CANCELLED',timedOut?'公开资料检索超时，未保存新结果':'检索已取消，迟到结果不会写入');if(error.researchPublic)throw error;throw fault(Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:502,'RESEARCH_PROVIDER_FAILED','公开资料检索未完成，历史结果保留；可稍后重试。');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function runForImport({kpId,user,signal}={}){
    await ready;enabled();const key=user.id+':'+kpId;if(importRuns.has(key))throw fault(409,'RESEARCH_BUSY','该知识点已有进行中的检索');const controller=new AbortController(),abort=()=>controller.abort(fault(499,'JOB_CANCELLED','检索已取消'));importRuns.set(key,controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{return await executeResearch({kpId,user,signal:controller.signal});}finally{signal?.removeEventListener('abort',abort);importRuns.delete(key);}
  }
  function publishForImport(s,{kpId,user,result,jobId,importJobId}={}){
    if(!plain(result)||typeof result.resultId!=='string'||!current(s,user,kpId,result.sourceBinding))throw fault(409,'RESEARCH_SOURCE_CHANGED','来源已经变化，不能保存旧检索结果');
    const previous=s.artifacts.find(a=>a.userId===user.id&&a.type==='knowledge-research'&&a.knowledgePointId===kpId&&a.researchResultId===result.resultId);if(previous)return view(s,user,previous);
    const validated=validateKnowledgeResearch(result),b=result.sourceBinding,version=1+Math.max(0,...s.artifacts.filter(a=>a.userId===user.id&&a.type==='knowledge-research'&&a.knowledgePointId===kpId).map(a=>Number.isSafeInteger(a.version)?a.version:0));
    const item=entity(user.id,{type:'knowledge-research',format:'markdown',title:(b.titles.knowledgePointTitle+' · 公开资料解析').slice(0,200),...validated,knowledgePointId:kpId,textbookId:b.textbookId,chapterId:b.chapterId,sourceRevision:b.sourceRevision,sourceAnchor:b.sourceAnchor,fileId:b.fileId,fileSha256:b.fileSha256,sourceBinding:b,researchResultId:result.resultId,version,...(jobId?{jobId}:{}),...(importJobId?{importJobId}:{}),origin:'public-title-web-search'});s.artifacts.push(item);return view(s,user,item);
  }
  function admission(s,user,exclude){
    const jobs=s.jobs.filter(j=>j.type!=='book-import'&&j.id!==exclude&&active(j));if(jobs.length>=4||jobs.filter(j=>j.userId===user.id).length>=L.concurrentPerUser)throw fault(429,'RESEARCH_CONCURRENT','当前任务较多，请等待已有任务完成');
    const day=now().slice(0,10),used=s.ledger.filter(r=>r.userId===user.id&&r.status!=='released'&&typeof r.createdAt==='string'&&r.createdAt.startsWith(day)).reduce((n,r)=>n+(Number.isSafeInteger(r.units)&&r.units>0?r.units:0),0);if(used>=maxDailyUnits)throw fault(429,'RESEARCH_DAILY_BUDGET','今日检索与模型任务预算不足');
  }
  function reserve(s,job,user){s.ledger.push(entity(user.id,{jobId:job.id,attempt:job.attempt,units:1,status:'reserved',unit:'local-research-attempt',providerAttempted:false,note:'本机检索尝试单位，不是供应商金额；已发起检索的失败/取消仍计一次尝试'}));}
  function settle(s,job){for(const row of s.ledger)if(row.jobId===job.id&&row.attempt===job.attempt&&row.status==='reserved')row.status=row.providerAttempted?'settled':'released';}
  async function run(id){
    await ready;if(closed||running.has(id))return;const first=(await store.snapshot()).jobs.find(j=>j.id===id);if(!first||first.status!=='queued')return;
    const user={id:first.userId},controller=new AbortController();running.set(id,controller);
    try{await store.mutate(s=>{const job=own(s,'jobs',id,user);if(job.status!=='queued'||!current(s,user,job.payload.knowledgePointId,job.sourceBinding))throw fault(409,'RESEARCH_SOURCE_CHANGED','开始前来源已改变');job.status='running';job.updatedAt=now();for(const row of s.ledger)if(row.jobId===id&&row.attempt===job.attempt)row.providerAttempted=true;});
      const result=await executeResearch({kpId:first.payload.knowledgePointId,user,signal:controller.signal,ownJobId:id});controller.signal.throwIfAborted();
      await store.mutate(s=>{const job=own(s,'jobs',id,user);if(job.status!=='running'||controller.signal.aborted||!current(s,user,job.payload.knowledgePointId,job.sourceBinding)||hash(result.sourceBinding)!==hash(job.sourceBinding))throw fault(409,'RESEARCH_SOURCE_CHANGED','检索结果来源已失效');const item=publishForImport(s,{kpId:job.payload.knowledgePointId,user,result,jobId:id});job.status='completed';job.progress=1;job.result={artifactId:item.id,status:item.status};job.updatedAt=now();settle(s,job);});
    }catch(error){await store.mutate(s=>{const job=s.jobs.find(j=>j.id===id&&j.userId===user.id);if(!job)return;job.status=controller.signal.aborted?(closed?'interrupted':'cancelled'):'failed';job.error={status:error.researchPublic?error.status:502,code:error.researchPublic?error.code:'RESEARCH_FAILED',message:error.researchPublic?error.message:'检索未完成，历史结果保留'};job.outcomeUnknown=controller.signal.aborted;job.updatedAt=now();settle(s,job);}).catch(()=>{});}
    finally{running.delete(id);}
  }
  async function handle(req,res,pathname,user,{json,send}){
    const point=/^\/api\/v1\/knowledge-points\/([^/]+)\/research$/.exec(pathname),jobRoute=/^\/api\/v1\/jobs\/([^/]+)(?:\/(cancel|resume))?$/.exec(pathname);
    if(!point&&!jobRoute)return false;await ready;const method=req.method;
    if(point){const kpId=decodeURIComponent(point[1]),snapshot=await store.snapshot();base(snapshot,user,kpId);
      if(method==='GET'){send(res,200,{items:snapshot.artifacts.filter(a=>a.userId===user.id&&a.type==='knowledge-research'&&a.knowledgePointId===kpId).slice(-100).map(a=>view(snapshot,user,a)),job:snapshot.jobs.filter(j=>j.userId===user.id&&j.type==='knowledge-research'&&j.payload.knowledgePointId===kpId).at(-1)||null,configured:configured()});return true;}
      if(method!=='POST')throw fault(405,'METHOD','研究操作不支持');const body=await json(req);if(!plain(body)||Object.keys(body).length)throw fault(400,'RESEARCH_OPTIONS','研究请求仅接受空对象；只使用公开标题检索');enabled();
      const job=await store.mutate(s=>{const saved=binding(s,user,kpId);if(importRuns.has(user.id+':'+kpId)||s.jobs.some(j=>j.userId===user.id&&j.type==='knowledge-research'&&j.payload.knowledgePointId===kpId&&active(j)))throw fault(409,'RESEARCH_BUSY','该知识点已有进行中的检索');admission(s,user);const j=entity(user.id,{type:'knowledge-research',status:'queued',progress:0,attempt:1,units:1,payload:{knowledgePointId:kpId,textbookId:saved.textbookId},sourceBinding:saved});s.jobs.push(j);reserve(s,j,user);return j;});setImmediate(()=>run(job.id));send(res,202,job);return true;
    }
    const snapshot=await store.snapshot(),old=snapshot.jobs.find(j=>j.id===jobRoute[1]&&j.type==='knowledge-research');if(!old)return false;own(snapshot,'jobs',old.id,user);base(snapshot,user,old.payload.knowledgePointId);
    if(!jobRoute[2]){if(method!=='GET')return false;send(res,200,old);return true;}
    if(method!=='POST')throw fault(405,'METHOD','任务控制仅支持POST');const body=await json(req);if(!plain(body)||Object.keys(body).length)throw fault(400,'RESEARCH_OPTIONS','任务控制仅接受空对象');
    if(jobRoute[2]==='cancel'){const value=await store.mutate(s=>{const job=own(s,'jobs',old.id,user);if(active(job)){job.status=running.has(job.id)?'cancelling':'cancelled';job.updatedAt=now();if(job.status==='cancelled')settle(s,job);}return job;});running.get(old.id)?.abort(fault(499,'JOB_CANCELLED','用户取消检索'));send(res,200,value);return true;}
    enabled();const value=await store.mutate(s=>{const job=own(s,'jobs',old.id,user);if(!['failed','cancelled','interrupted'].includes(job.status)||running.has(job.id))throw fault(409,'JOB_STATE','等待当前检索停止后再继续');if(!current(s,user,job.payload.knowledgePointId,job.sourceBinding))throw fault(409,'RESEARCH_SOURCE_CHANGED','来源已改变，请发起当前版本的新检索');if(importRuns.has(user.id+':'+job.payload.knowledgePointId)||s.jobs.some(j=>j.id!==job.id&&j.userId===user.id&&j.type==='knowledge-research'&&j.payload.knowledgePointId===job.payload.knowledgePointId&&active(j)))throw fault(409,'RESEARCH_BUSY','该知识点已有进行中的检索');admission(s,user,job.id);job.status='queued';job.progress=0;job.attempt=(job.attempt||0)+1;delete job.result;delete job.error;delete job.outcomeUnknown;job.updatedAt=now();reserve(s,job,user);return job;});setImmediate(()=>run(value.id));send(res,202,value);return true;
  }
  async function close(){await ready;closed=true;for(const c of [...running.values(),...importRuns.values()])c.abort(fault(499,'SHUTDOWN','服务关闭，未自动重发检索'));while(running.size||importRuns.size)await new Promise(r=>setTimeout(r,10));await store.mutate(s=>{for(const job of s.jobs)if(job.type==='knowledge-research'&&active(job)){job.status='interrupted';job.updatedAt=now();settle(s,job);}});}
  return{handle,close,runForImport,publishForImport,configured};
}
