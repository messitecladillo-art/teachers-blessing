import {createHash} from 'node:crypto';
import {resolveAnnotationTarget} from './annotations.mjs';

export const COURSE_TOOL_LIMITS=Object.freeze({chapters:100,atlasKnowledgePoints:1000,sources:48,sourceChars:24000,traceChars:10000,envelopeChars:52000,goalChars:1000,notesScanned:500,summaryChars:20000});
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
const rows=(state,key)=>Array.isArray(state?.[key])?state[key]:[];
const idOK=value=>typeof value==='string'&&value.length>0&&value.length<=100;
const short=(value,length)=>typeof value==='string'?value.slice(0,length):'';
const ordered=(a,b)=>(Number.isFinite(a.order)?a.order:0)-(Number.isFinite(b.order)?b.order:0)||String(a.id).localeCompare(String(b.id),'en');
const latest=(a,b)=>(Number.isSafeInteger(b.version)?b.version:0)-(Number.isSafeInteger(a.version)?a.version:0)||String(b.createdAt||'').localeCompare(String(a.createdAt||''),'en')||String(a.id).localeCompare(String(b.id),'en');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,canonical(value[key])])):value;
const stable=value=>JSON.stringify(canonical(value));
const digest=value=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const progress=point=>['not-started','learning','mastered'].includes(point.progress)?point.progress:'not-started';

function context(state,user,bookId,chapterIds=[]){
  if(!user||!idOK(user.id))throw fail(401,'AUTH_REQUIRED','请先登录');
  const book=rows(state,'textbooks').find(row=>row.id===bookId&&row.userId===user.id);if(!book)throw fail(404,'NOT_FOUND','教材不存在或无权访问');
  if(!Array.isArray(chapterIds)||chapterIds.length>COURSE_TOOL_LIMITS.chapters||chapterIds.some(id=>!idOK(id))||new Set(chapterIds).size!==chapterIds.length)throw fail(400,'COURSE_SCOPE','请选择至多100个不重复的合法章节ID');
  const all=rows(state,'chapters').filter(row=>row.userId===user.id&&row.textbookId===book.id&&!row.archived&&idOK(row.id)).sort(ordered);
  for(const id of chapterIds)if(!all.some(row=>row.id===id))throw fail(404,'NOT_FOUND','章节不存在、已移除或不属于当前教材');
  const chosen=(chapterIds.length?all.filter(row=>chapterIds.includes(row.id)):all).slice(0,COURSE_TOOL_LIMITS.chapters),chapterSet=new Set(chosen.map(row=>row.id));
  const points=rows(state,'knowledgePoints').filter(row=>row.userId===user.id&&row.textbookId===book.id&&chapterSet.has(row.chapterId)&&!row.archived&&idOK(row.id)).sort((a,b)=>chosen.findIndex(row=>row.id===a.chapterId)-chosen.findIndex(row=>row.id===b.chapterId)||ordered(a,b));
  return{state,user,book,chapters:chosen,points,allChapterCount:all.length,chapterScopeTruncated:!chapterIds.length&&all.length>chosen.length};
}
function anchorOf(ctx,point){
  const anchor=point.sourceAnchor,file=anchor&&rows(ctx.state,'fileRecords').find(row=>row.id===anchor.fileId&&row.userId===ctx.user.id&&row.textbookId===ctx.book.id&&['ready','partial'].includes(row.status));
  if(!file||!Number.isSafeInteger(point.revision)||point.revision<1||!Number.isSafeInteger(anchor.startPage)||!Number.isSafeInteger(anchor.endPage)||anchor.startPage<1||anchor.endPage<anchor.startPage)return null;
  const pageCount=Array.isArray(file.pages)?file.pages.length:Number.isSafeInteger(file.pageCount)?file.pageCount:0;
  if(!pageCount||anchor.endPage>pageCount||(anchor.sha256&&file.sha256&&anchor.sha256!==file.sha256))return null;
  return{fileId:file.id,...(typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)?{sha256:file.sha256}:{}),startPage:anchor.startPage,endPage:anchor.endPage};
}
function currentExercises(ctx,pointSet){return rows(ctx.state,'exercises').filter(row=>row.userId===ctx.user.id&&row.textbookId===ctx.book.id&&pointSet.has(row.knowledgePointId)&&row.sourceRevision===pointSet.get(row.knowledgePointId).revision&&idOK(row.id)&&Array.isArray(row.questions));}
function noteInfos(ctx,pointSet,{protectedNotes=false}={}){
  const candidates=rows(ctx.state,'highlights').filter(note=>note.userId===ctx.user.id&&(pointSet.has(note.knowledgePointId)||pointSet.has(note.sourceId))).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''),'en')||String(a.id).localeCompare(String(b.id),'en'));
  const result=[];let protectedOmitted=0,staleOmitted=0;
  for(const note of candidates.slice(0,COURSE_TOOL_LIMITS.notesScanned)){
    if(!protectedNotes&&note.sourceKind==='exercise'&&['reference_answer','solution'].includes(note.block)){protectedOmitted++;continue;}
    try{
      const target=resolveAnnotationTarget(ctx.state,note,ctx.user,{mode:'read'}),point=pointSet.get(target.fields.knowledgePointId);
      if(!point||typeof note.exact!=='string'||!note.exact||!target.content.includes(note.exact)){staleOmitted++;continue;}
      const workshopId=target.fields.workshopId||note.workshopId;
      if(workshopId){
        const workshop=rows(ctx.state,'workshops').find(row=>row.id===workshopId&&row.userId===ctx.user.id),links=Array.isArray(workshop?.linkedTextbookIds)?[...new Set(workshop.linkedTextbookIds)].sort():[];
        if(!workshop||!links.includes(ctx.book.id)){staleOmitted++;continue;}
        if(target.fields.sourceKind==='conversation'){
          const message=rows(ctx.state,'messages').find(row=>row.id===target.fields.messageId&&row.userId===ctx.user.id),bound=message?.workshopScope;
          if(bound&&(bound.workshopId!==workshop.id||bound.scopeRevision!==(workshop.scopeRevision||1)||!Array.isArray(bound.linkedTextbookIds)||stable([...new Set(bound.linkedTextbookIds)].sort())!==stable(links))){staleOmitted++;continue;}
          const outside=message?.sourceVersions?.some(ref=>ref.collection==='knowledgePoints'&&!rows(ctx.state,'knowledgePoints').some(point=>point.id===ref.id&&point.userId===ctx.user.id&&links.includes(point.textbookId)));
          if(outside){staleOmitted++;continue;}
        }
      }
      result.push({note,point,fields:target.fields});
    }catch{staleOmitted++;}
  }
  return{items:result,protectedOmitted,staleOmitted,scanTruncated:candidates.length>COURSE_TOOL_LIMITS.notesScanned};
}
function countFor(points,notes,attempts){const ids=new Set(points.map(point=>point.id));return{chapters:0,knowledgePoints:points.length,notes:notes.filter(item=>ids.has(item.point.id)).length,attempts:attempts.filter(item=>ids.has(item.knowledgePointId)).length,selfMarkedMastered:points.filter(point=>progress(point)==='mastered').length};}

export function buildKnowledgeAtlas(state,user,bookId,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='chapterId'))throw fail(400,'COURSE_SCOPE','目录筛选须为chapterId对象');const{chapterId}=options;
  if(chapterId!==undefined&&!idOK(chapterId))throw fail(400,'COURSE_SCOPE','章节ID不合法');
  const ctx=context(state,user,bookId,chapterId?[chapterId]:[]),points=ctx.points.slice(0,COURSE_TOOL_LIMITS.atlasKnowledgePoints),pointSet=new Map(points.map(point=>[point.id,point])),notes=noteInfos(ctx,pointSet,{protectedNotes:true}),exercises=currentExercises(ctx,pointSet),exerciseSet=new Map(exercises.map(item=>[item.id,item]));
  const attempts=rows(state,'attempts').filter(item=>item.userId===user.id&&exerciseSet.has(item.exerciseId)).map(item=>({knowledgePointId:exerciseSet.get(item.exerciseId).knowledgePointId})),counts={...countFor(points,notes.items,attempts),chapters:ctx.chapters.length};
  const nodes=[{id:ctx.book.id,kind:'textbook',title:short(ctx.book.title,200),textbookId:ctx.book.id,counts}],edges=[],ids=new Set([ctx.book.id]);
  for(const chapter of ctx.chapters){
    if(ids.has(chapter.id))throw fail(409,'COURSE_ID_COLLISION','目录中的持久ID存在冲突');ids.add(chapter.id);const children=points.filter(point=>point.chapterId===chapter.id);
    nodes.push({id:chapter.id,kind:'chapter',title:short(chapter.title,200),textbookId:ctx.book.id,parentId:ctx.book.id,chapterId:chapter.id,order:Number.isFinite(chapter.order)?chapter.order:0,counts:{...countFor(children,notes.items,attempts),chapters:1}});edges.push({source:ctx.book.id,target:chapter.id,kind:'contains'});
    for(const point of children){if(ids.has(point.id))throw fail(409,'COURSE_ID_COLLISION','目录中的持久ID存在冲突');ids.add(point.id);const anchor=anchorOf(ctx,point);nodes.push({id:point.id,kind:'knowledgePoint',title:short(point.title,200),textbookId:ctx.book.id,chapterId:chapter.id,parentId:chapter.id,order:Number.isFinite(point.order)?point.order:0,...(anchor?{sourceAnchor:anchor}:{}),sourceAvailable:!!anchor&&typeof point.sourceText==='string'&&!!point.sourceText.trim(),progress:progress(point),progressIsSelfReported:true,counts:countFor([point],notes.items,attempts)});edges.push({source:chapter.id,target:point.id,kind:'contains'});}
  }
  const omittedKnowledgePoints=ctx.points.length-points.length;
  return{schema:'knowledge-atlas/v1',textbook:{id:ctx.book.id,title:short(ctx.book.title,200)},nodes,edges,counts,scope:{textbookId:ctx.book.id,chapterIds:ctx.chapters.map(row=>row.id)},coverage:{partial:ctx.chapterScopeTruncated||omittedKnowledgePoints>0||notes.scanTruncated,selectedChapterCount:ctx.chapters.length,candidateKnowledgePointCount:ctx.points.length,includedKnowledgePointCount:points.length,omittedKnowledgePointCount:omittedKnowledgePoints,noteScanTruncated:notes.scanTruncated,relationKind:'outline-contains-only'}};
}

function prefixWithin(value,rawLimit,encodedLimit=Infinity){let low=0,high=Math.min(value.length,rawLimit);while(low<high){const middle=Math.ceil((low+high)/2);if(JSON.stringify(value.slice(0,middle)).length-2<=encodedLimit)low=middle;else high=middle-1;}return value.slice(0,low);}
function addWithin(items,budget){const chosen=[];for(const item of items){if(JSON.stringify([...chosen,item.dto]).length<=budget)chosen.push(item.dto);}const ids=new Set(chosen.map(item=>item.id));return{items:chosen,bindings:items.filter(item=>ids.has(item.dto.id)).map(item=>item.binding),omitted:items.length-chosen.length};}
function tracesFor(ctx,sources){
  const pointSet=new Map(sources.map(source=>[source.id,ctx.points.find(point=>point.id===source.id)])),notes=noteInfos(ctx,pointSet),progressItems=sources.map(source=>{const point=pointSet.get(source.id),dto={id:point.id,knowledgePointId:point.id,selfReportedStatus:progress(point),recorded:['not-started','learning','mastered'].includes(point.progress)};return{dto,binding:digest({id:point.id,progress:point.progress??null})};});
  const noteItems=notes.items.map(({note,point,fields})=>({dto:{id:note.id,knowledgePointId:point.id,sourceKind:fields.sourceKind,sourceId:fields.sourceId,...(fields.block?{block:fields.block}:{}),text:short(note.note,800),quote:short(note.exact,200),truncated:(typeof note.note==='string'&&note.note.length>800)||note.exact.length>200},binding:digest({id:note.id,pointId:point.id,revision:point.revision,note:note.note??'',exact:note.exact,updatedAt:note.updatedAt??null,color:note.color??null,fields})}));
  const allExercises=currentExercises(ctx,pointSet),latestSets=[];
  for(const source of sources){const exercise=allExercises.filter(item=>item.knowledgePointId===source.id).sort(latest)[0];if(exercise)latestSets.push(exercise);}
  const exerciseItems=latestSets.map(exercise=>{const questions=exercise.questions.filter(question=>idOK(question.id)&&['choice','short'].includes(question.type)&&typeof question.stem==='string').slice(0,2).map(question=>({id:question.id,type:question.type,stem:short(question.stem,200),...(Array.isArray(question.options)?{options:question.options.slice(0,6).map(option=>({id:short(option.id,10),text:short(option.text,60)}))}:{}),truncated:question.stem.length>200||question.options?.some(option=>typeof option.text==='string'&&option.text.length>60)||false}));return{dto:{id:exercise.id,knowledgePointId:exercise.knowledgePointId,sourceRevision:exercise.sourceRevision,version:exercise.version||1,questions,omittedQuestionCount:Math.max(0,exercise.questions.length-questions.length)},binding:digest({id:exercise.id,sourceRevision:exercise.sourceRevision,version:exercise.version,questions:exercise.questions.map(question=>({id:question.id,type:question.type,stem:question.stem,options:question.options?.map(option=>({id:option.id,text:option.text}))}))})};});
  const chosenExercises=addWithin(exerciseItems,2500);
  chosenExercises.omitted+=Math.max(0,allExercises.length-latestSets.length);
  const attemptItems=[];let olderAttemptsOmitted=0;
  for(const exerciseDto of chosenExercises.items){const exercise=latestSets.find(item=>item.id===exerciseDto.id),questionIds=new Set(exerciseDto.questions.map(question=>question.id)),allAttempts=rows(ctx.state,'attempts').filter(item=>item.userId===ctx.user.id&&item.exerciseId===exercise.id&&idOK(item.id)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''),'en')||String(a.id).localeCompare(String(b.id),'en')),attempts=allAttempts.slice(0,2);olderAttemptsOmitted+=Math.max(0,allAttempts.length-attempts.length);
    for(const attempt of attempts){const submittedAnswers=exerciseDto.questions.filter(question=>typeof attempt.answers?.[question.id]==='string').map(question=>({questionId:question.id,value:short(attempt.answers[question.id],150),truncated:attempt.answers[question.id].length>150})),dto={id:attempt.id,exerciseId:exercise.id,knowledgePointId:exercise.knowledgePointId,status:short(attempt.status,50),submittedAnswers,referenceWasRevealed:!!attempt.revealedAt};
      const grade=attempt.grading,validGrade=attempt.status==='graded'&&grade?.sourceRevision===exercise.sourceRevision&&Number.isSafeInteger(attempt.gradingVersion)&&attempt.gradingVersion>0&&Number.isFinite(grade.score)&&Number.isFinite(grade.maxScore)&&grade.score>=0&&grade.maxScore>0&&grade.score<=grade.maxScore&&Array.isArray(grade.questions)&&grade.questions.every(q=>exercise.questions.some(question=>question.id===q.questionId)&&(!Array.isArray(q.sourceIds)||q.sourceIds.every(id=>id===exercise.knowledgePointId)));
      if(validGrade)dto.grading={version:attempt.gradingVersion,score:grade.score,maxScore:grade.maxScore,method:short(grade.method,50),requiresHumanReview:grade.requiresHumanReview!==false,feedback:short(grade.feedback,300),questions:grade.questions.filter(question=>questionIds.has(question.questionId)&&Number.isFinite(question.score)&&Number.isFinite(question.maxScore)&&question.score>=0&&question.score<=question.maxScore).map(question=>({questionId:question.questionId,score:question.score,maxScore:question.maxScore,feedback:short(question.feedback,180)}))};
      dto.truncated=submittedAnswers.some(answer=>answer.truncated)||(attempt.status==='graded'&&!validGrade)||(validGrade&&(short(grade.feedback,300).length!==(typeof grade.feedback==='string'?grade.feedback.length:0)||grade.questions.some(question=>!questionIds.has(question.questionId)||short(question.feedback,180).length!==(typeof question.feedback==='string'?question.feedback.length:0))));
      const binding=digest({id:attempt.id,exerciseId:exercise.id,status:attempt.status,answers:exercise.questions.map(question=>({questionId:question.id,value:typeof attempt.answers?.[question.id]==='string'?attempt.answers[question.id]:null})),referenceWasRevealed:!!attempt.revealedAt,grading:validGrade?{version:attempt.gradingVersion,score:grade.score,maxScore:grade.maxScore,method:grade.method,requiresHumanReview:grade.requiresHumanReview,feedback:grade.feedback,questions:grade.questions.map(question=>({questionId:question.questionId,score:question.score,maxScore:question.maxScore,feedback:question.feedback}))}:null});attemptItems.push({dto,binding});
    }
  }
  const groups={notes:addWithin(noteItems,2600),progress:addWithin(progressItems,1800),exercises:chosenExercises,attempts:addWithin(attemptItems,2800)},personalTraces=Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,value.items]));
  groups.attempts.omitted+=olderAttemptsOmitted;
  if(JSON.stringify(personalTraces).length>COURSE_TOOL_LIMITS.traceChars)throw fail(413,'SUMMARY_TRACE_BUDGET','个人学习记录超过本机输入预算');
  const truncated={notes:groups.notes.items.filter(item=>item.truncated).length,exercises:groups.exercises.items.filter(item=>item.omittedQuestionCount>0||item.questions.some(question=>question.truncated)).length,attempts:groups.attempts.items.filter(item=>item.truncated).length};
  return{personalTraces,bindings:Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,value.bindings])),coverage:{included:Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,value.items.length])),omitted:Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,value.omitted])),truncated,selection:{exerciseSets:'latest-current-per-knowledge-point',attempts:'latest-two-per-included-exercise',questionsPerExercise:2},protectedNotesOmitted:notes.protectedOmitted,staleNotesOmitted:notes.staleOmitted,noteScanTruncated:notes.scanTruncated,partial:Object.values(groups).some(value=>value.omitted>0)||Object.values(truncated).some(value=>value>0)||notes.scanTruncated}};
}

export function createCourseSnapshot(state,user,bookId,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['chapterIds','goal'].includes(key)))throw fail(400,'COURSE_SCOPE','摘要范围须为chapterIds和goal对象');
  const goal=options.goal===undefined?'':options.goal;if(typeof goal!=='string'||goal.length>COURSE_TOOL_LIMITS.goalChars)throw fail(400,'SUMMARY_GOAL','复习目标须为不超过1000字符的文本');
  const ctx=context(state,user,bookId,options.chapterIds===undefined?[]:options.chapterIds),candidates=ctx.points.map(point=>({point,anchor:anchorOf(ctx,point)})).filter(({point,anchor})=>anchor&&typeof point.sourceText==='string'&&!!point.sourceText.trim());
  if(!candidates.length)throw fail(409,'SUMMARY_SOURCE_EMPTY','所选范围没有可验证的当前正文来源，请先解析教材或调整章节');
  let chosen=candidates.slice(0,COURSE_TOOL_LIMITS.sources),draft,traces,baseLength;
  do{
    const sources=chosen.map(({point,anchor})=>({id:point.id,chapterId:point.chapterId,title:short(point.title,160),revision:point.revision,sourceAnchor:anchor,text:'',sourceChars:point.sourceText.length,providedChars:0,truncated:!!point.sourceTruncated}));traces=tracesFor(ctx,sources);
    draft={schema:'personal-course-snapshot/v1',textbook:{id:ctx.book.id,title:short(ctx.book.title,200)},scope:{textbookId:ctx.book.id,chapterIds:ctx.chapters.map(chapter=>chapter.id),goal:goal.trim()},sources,personalTraces:traces.personalTraces,coverage:{partial:false,selectedChapterCount:ctx.chapters.length,candidateKnowledgePointCount:ctx.points.length,includedSourceCount:sources.length,omittedSourceCount:candidates.length-sources.length,unavailableSourceCount:ctx.points.length-candidates.length,providedSourceChars:0,sourceTextTruncated:false,chapterScopeTruncated:ctx.chapterScopeTruncated,personalTraces:traces.coverage},fingerprint:'0'.repeat(64)};baseLength=JSON.stringify(draft).length;
    if(baseLength>42000&&chosen.length>1)chosen=chosen.slice(0,-1);else break;
  }while(chosen.length);
  if(baseLength>49000)throw fail(413,'SUMMARY_SCOPE_TOO_LARGE','摘要范围元数据超过预算，请选择更少章节');
  const perRaw=Math.floor(COURSE_TOOL_LIMITS.sourceChars/chosen.length),perEncoded=Math.max(0,Math.floor((COURSE_TOOL_LIMITS.envelopeChars-baseLength-1500)/chosen.length));
  draft.sources.forEach((source,index)=>{const point=chosen[index].point;source.text=prefixWithin(point.sourceText,perRaw,perEncoded);source.providedChars=source.text.length;source.truncated=!!point.sourceTruncated||source.text.length<point.sourceText.length;});
  draft.coverage.providedSourceChars=draft.sources.reduce((sum,source)=>sum+source.text.length,0);draft.coverage.sourceTextTruncated=draft.sources.some(source=>source.truncated);draft.coverage.partial=ctx.chapterScopeTruncated||draft.coverage.omittedSourceCount>0||draft.coverage.unavailableSourceCount>0||draft.coverage.sourceTextTruncated||traces.coverage.partial||chosen.some(({point})=>rows(state,'fileRecords').find(file=>file.id===point.sourceAnchor.fileId&&file.userId===user.id)?.status==='partial');
  if(draft.sources.some(source=>!source.text))throw fail(413,'SUMMARY_SCOPE_TOO_LARGE','来源输入预算不足，请选择更少章节');
  draft.fingerprint=digest({snapshot:{...draft,fingerprint:undefined},sourceBindings:chosen.map(({point})=>({id:point.id,title:point.title,order:point.order,chapterId:point.chapterId,chapterTitle:ctx.chapters.find(chapter=>chapter.id===point.chapterId)?.title,revision:point.revision,sourceDigest:digest(point.sourceText)})),personalBindings:traces.bindings});
  if(JSON.stringify(draft).length>=COURSE_TOOL_LIMITS.envelopeChars)throw fail(413,'SUMMARY_SCOPE_TOO_LARGE','摘要输入超过52000字符预算，请缩小章节范围');return draft;
}

export function validateSummaryOutput(raw,snapshot){
  const invalid=()=>fail(502,'MODEL_SUMMARY_SCHEMA','摘要必须返回合法title/content/sourceIds JSON并等待人工复核');
  if(typeof raw!=='string'||raw.length>60000)throw invalid();let value;
  try{const fenced=raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);value=JSON.parse(fenced?fenced[1]:raw);}catch{throw invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['title','content','sourceIds'].includes(key))||typeof value.title!=='string'||!value.title.trim()||value.title.length>160||typeof value.content!=='string'||!value.content.trim()||value.content.length>COURSE_TOOL_LIMITS.summaryChars||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.title+value.content))throw invalid();
  const allowed=new Set(Array.isArray(snapshot?.sources)?snapshot.sources.map(source=>source.id):[]);
  if(!/^[a-f0-9]{64}$/.test(snapshot?.fingerprint||'')||!Array.isArray(value.sourceIds)||!value.sourceIds.length||value.sourceIds.length>allowed.size||new Set(value.sourceIds).size!==value.sourceIds.length||value.sourceIds.some(id=>typeof id!=='string'||!allowed.has(id)))throw fail(502,'MODEL_SUMMARY_SOURCES','摘要引用必须逐字使用本次已提供的知识点ID');
  return{title:value.title.trim(),content:value.content.trim(),sourceIds:[...value.sourceIds],requiresHumanReview:true};
}
