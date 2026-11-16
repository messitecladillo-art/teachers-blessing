import {randomUUID} from 'node:crypto';

const TYPE='knowledge-bookmark';
const FORMAT='bookmark';
const rows=(state,name)=>Array.isArray(state[name])?state[name]:[];
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\s\u0000-\u001f\u007f/\\?#]/.test(value);
const metadata=value=>typeof value==='string'?value.slice(0,200):'';
const anchorView=anchor=>anchor&&typeof anchor==='object'?{fileId:anchor.fileId,...(typeof anchor.sha256==='string'?{sha256:anchor.sha256}:{}),startPage:anchor.startPage,endPage:anchor.endPage}:null;

function chain(state,knowledgePointId,user){
  const point=rows(state,'knowledgePoints').find(value=>value.id===knowledgePointId&&value.userId===user.id);
  const book=point&&rows(state,'textbooks').find(value=>value.id===point.textbookId&&value.userId===user.id);
  const chapter=point&&book&&rows(state,'chapters').find(value=>value.id===point.chapterId&&value.userId===user.id&&value.textbookId===book.id);
  if(!point||!book||!chapter)throw fail(404,'NOT_FOUND','知识点不存在或无访问权限');
  return{point,book,chapter};
}
function sourceStatus(state,{point,book,chapter},user){
  const reasons=[];
  if(point.archived)reasons.push('knowledge-point-archived');
  if(chapter.archived)reasons.push('chapter-archived');
  const anchor=point.sourceAnchor;
  const file=anchor&&rows(state,'fileRecords').find(value=>value.id===anchor.fileId&&value.userId===user.id&&value.textbookId===book.id&&value.status!=='deleted');
  if(!file)reasons.push('source-file-unavailable');
  else{
    if(!['ready','partial'].includes(file.status))reasons.push('source-not-ready');
    if(book.activeFileId!==file.id)reasons.push('active-file-changed');
    if(typeof anchor.sha256!=='string'||!anchor.sha256||anchor.sha256!==file.sha256)reasons.push('source-file-changed');
    const pageCount=Array.isArray(file.pages)?file.pages.length:file.pageCount;
    if(!Number.isSafeInteger(pageCount)||!Number.isSafeInteger(anchor.startPage)||!Number.isSafeInteger(anchor.endPage)||anchor.startPage<1||anchor.endPage<anchor.startPage||anchor.endPage>pageCount)reasons.push('source-range-invalid');
  }
  if(!Number.isSafeInteger(point.revision)||point.revision<1)reasons.push('source-revision-invalid');
  return{reasons,file};
}
function dto(state,record,user){
  let current;
  try{current=chain(state,record.knowledgePointId,user);}catch{return null;}
  if(record.textbookId!==current.book.id||record.chapterId!==current.chapter.id)return null;
  const status=sourceStatus(state,current,user), reasons=[...status.reasons];
  if(record.sourceRevision!==current.point.revision)reasons.push('source-revision-changed');
  const oldAnchor=record.sourceAnchor, currentAnchor=current.point.sourceAnchor;
  if(!oldAnchor||!currentAnchor||oldAnchor.fileId!==currentAnchor.fileId||oldAnchor.sha256!==currentAnchor.sha256||oldAnchor.startPage!==currentAnchor.startPage||oldAnchor.endPage!==currentAnchor.endPage)reasons.push('source-anchor-changed');
  const canOpen=status.reasons.length===0;
  return{id:record.id,type:TYPE,format:FORMAT,knowledgePointId:current.point.id,textbookId:current.book.id,chapterId:current.chapter.id,title:metadata(record.title),currentTitle:metadata(current.point.title),textbookTitle:metadata(current.book.title),chapterTitle:metadata(current.chapter.title),sourceRevision:record.sourceRevision,currentRevision:current.point.revision,sourceAnchor:anchorView(record.sourceAnchor),createdAt:record.createdAt,updatedAt:record.updatedAt,stale:reasons.length>0,staleReasons:[...new Set(reasons)],canOpen,route:canOpen?'/textbook/'+encodeURIComponent(current.book.id)+'/kp/'+encodeURIComponent(current.point.id):null};
}

/** Authenticated HTTP seam. Helpers are supplied by the existing learning API. */
export function createBookmarkService({store}={}){
  if(!store||typeof store.snapshot!=='function'||typeof store.mutate!=='function')throw new TypeError('Bookmark service requires the shared study store');
  async function handle(req,res,pathname,user,{json,send}={}){
    const match=/^\/api\/v1\/bookmarks(?:\/([^/]+))?$/.exec(pathname);
    if(!match)return false;
    if(!user||!validId(user.id))throw fail(401,'AUTH_REQUIRED','请先登录');
    if(typeof send!=='function')throw new TypeError('Bookmark response helper is required');
    let pointId;
    if(match[1]){try{pointId=decodeURIComponent(match[1]);}catch{throw fail(400,'BOOKMARK_INPUT','知识点ID格式无效');}if(!validId(pointId))throw fail(400,'BOOKMARK_INPUT','知识点ID格式无效');}
    if(req.method==='GET'&&!pointId){
      const state=await store.snapshot();
      const items=rows(state,'artifacts').filter(value=>value.userId===user.id&&value.type===TYPE&&value.format===FORMAT).map(value=>dto(state,value,user)).filter(Boolean).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||a.id.localeCompare(b.id));
      send(res,200,{items});return true;
    }
    if(req.method==='POST'&&!pointId){
      if(typeof json!=='function')throw new TypeError('Bookmark JSON helper is required');
      const body=await json(req,4096);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='knowledgePointId')||!validId(body.knowledgePointId))throw fail(400,'BOOKMARK_INPUT','收藏只接受合法的knowledgePointId');
      const result=await store.mutate(state=>{
        const current=chain(state,body.knowledgePointId,user),status=sourceStatus(state,current,user);
        if(status.reasons.length)throw fail(409,'STALE_SOURCE','知识点或教材来源已失效，请先使用当前有效来源');
        const records=rows(state,'artifacts').filter(value=>value.userId===user.id&&value.type===TYPE&&value.knowledgePointId===current.point.id);
        const timestamp=new Date().toISOString(),existing=records[0];
        const snapshot={type:TYPE,format:FORMAT,knowledgePointId:current.point.id,textbookId:current.book.id,chapterId:current.chapter.id,title:metadata(current.point.title),sourceRevision:current.point.revision,sourceAnchor:anchorView(current.point.sourceAnchor)};
        let record=existing;
        if(!record){record={id:randomUUID(),userId:user.id,...snapshot,createdAt:timestamp,updatedAt:timestamp};state.artifacts.push(record);}
        else{
          const differs=Object.entries(snapshot).some(([key,value])=>JSON.stringify(record[key])!==JSON.stringify(value));
          if(differs)Object.assign(record,snapshot,{updatedAt:timestamp});
          if(records.length>1){const duplicateIds=new Set(records.slice(1).map(value=>value.id));state.artifacts=state.artifacts.filter(value=>!duplicateIds.has(value.id));}
        }
        return{created:!existing,value:dto(state,record,user)};
      });
      send(res,result.created?201:200,result.value);return true;
    }
    if(req.method==='DELETE'&&pointId){
      const result=await store.mutate(state=>{
        chain(state,pointId,user);const before=state.artifacts.length;
        state.artifacts=state.artifacts.filter(value=>!(value.userId===user.id&&value.type===TYPE&&value.knowledgePointId===pointId));
        return{deleted:before!==state.artifacts.length,knowledgePointId:pointId};
      });
      send(res,200,result);return true;
    }
    throw fail(405,'METHOD_NOT_ALLOWED','收藏接口不支持此操作');
  }
  return Object.freeze({handle});
}
