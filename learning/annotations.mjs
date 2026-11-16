import {createHash} from 'node:crypto';

const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
function owned(state,collection,id,user){const row=state[collection]?.find(value=>value.id===id&&value.userId===user.id);if(!row)throw failure(404,'NOT_FOUND','批注来源不存在或无权访问');return row;}
function pointOwned(state,id,user){const point=owned(state,'knowledgePoints',id,user);owned(state,'textbooks',point.textbookId,user);return point;}
function sourceCurrent(state,ref,user){
  if(ref.collection==='knowledgePoints'){const point=pointOwned(state,ref.id,user);if(point.archived||point.revision!==ref.revision)throw failure(409,'STALE_SOURCE','批注引用的知识点已修订');}
  else if(['fileRecords','materials'].includes(ref.collection)){const source=owned(state,ref.collection,ref.id,user);if(source.textbookId)owned(state,'textbooks',source.textbookId,user);if(source.workshopId)owned(state,'workshops',source.workshopId,user);if(source.status==='deleted'||source.updatedAt!==ref.updatedAt)throw failure(409,'STALE_SOURCE','批注引用的材料已改变');}
}
const hash=value=>createHash('sha256').update(value).digest('hex');

/** Resolve authorized canonical text; never trust parent IDs supplied by a client.
 * mode=parent checks ownership only, allowing management of an old own note.
 * read/create additionally enforce source and feedback versions.
 */
export function resolveAnnotationTarget(state,input,user,{mode='create'}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw failure(400,'INVALID_ANNOTATION','批注请求必须是JSON对象');
  const kind=input.sourceKind||'source',fields={sourceKind:kind,sourceId:input.sourceId};let point=null,content='',expectedRevision,attempt=null;
  if(kind==='source'||kind==='lesson'){
    point=pointOwned(state,input.sourceId,user);expectedRevision=point.revision;
    if(kind==='lesson'){const lesson=owned(state,'lessons',input.lessonId,user);if(lesson.knowledgePointId!==point.id||lesson.textbookId!==point.textbookId)throw failure(404,'NOT_FOUND','讲解不属于该知识点');fields.lessonId=lesson.id;fields.lessonVersion=lesson.version;if(mode!=='parent'&&(lesson.sourceRevision!==point.revision||(mode==='read'&&input.lessonVersion!==lesson.version)))throw failure(409,'STALE_SOURCE','讲解版本已失效');if(mode!=='parent')content=lesson.content;}
    else if(mode!=='parent')content=point.sourceText;
  }else if(kind==='conversation'){
    const message=owned(state,'messages',input.sourceId,user),conversation=owned(state,'conversations',message.conversationId,user);
    if(conversation.textbookId)owned(state,'textbooks',conversation.textbookId,user);if(conversation.workshopId)owned(state,'workshops',conversation.workshopId,user);
    const refs=Array.isArray(message.sourceVersions)?message.sourceVersions:[],single=refs.filter(ref=>ref.collection==='knowledgePoints');
    const pointId=message.knowledgePointId||conversation.knowledgePointId||(single.length===1?single[0].id:null);
    if(pointId){point=pointOwned(state,pointId,user);if(conversation.textbookId&&conversation.textbookId!==point.textbookId)throw failure(404,'NOT_FOUND','会话与知识点不属于同一教材');}
    Object.assign(fields,{messageId:message.id,conversationId:conversation.id,...(conversation.workshopId?{workshopId:conversation.workshopId}:{}),...(conversation.textbookId?{textbookId:conversation.textbookId}:{}),sourceVersionRefs:refs.map(({id,collection,revision,updatedAt})=>({id,collection,...(revision!==undefined?{revision}:{}),...(updatedAt!==undefined?{updatedAt}:{})}))});expectedRevision=1;
    if(mode!=='parent'){for(const ref of refs)sourceCurrent(state,ref,user);content=message.content;if(point){const ref=refs.find(value=>value.collection==='knowledgePoints'&&value.id===point.id),bound=ref?.revision??message.sourceRevision??(mode==='read'?input.knowledgePointRevision:point.revision);if(bound!==point.revision)throw failure(409,'STALE_SOURCE','会话引用的知识点已修订');}}
  }else if(kind==='exercise'){
    const exercise=owned(state,'exercises',input.sourceId,user);owned(state,'textbooks',exercise.textbookId,user);point=pointOwned(state,exercise.knowledgePointId,user);
    const question=exercise.questions?.find(value=>value.id===input.questionId);if(!question)throw failure(404,'NOT_FOUND','题目不属于该练习');
    if(!['stem','reference_answer','solution','feedback'].includes(input.block))throw failure(400,'ANNOTATION_BLOCK','题目批注区域不支持');
    Object.assign(fields,{exerciseId:exercise.id,questionId:question.id,block:input.block});expectedRevision=exercise.sourceRevision;
    if(input.block!=='stem'){
      if(!input.attemptId)throw failure(403,'REVEAL_REQUIRED','请先保存本人作答并显式揭示对应内容');
      attempt=owned(state,'attempts',input.attemptId,user);if(attempt.exerciseId!==exercise.id)throw failure(404,'NOT_FOUND','作答不属于该练习');fields.attemptId=attempt.id;
      // The reveal gate precedes reading any reference answer or solution text.
      if(mode!=='parent'&&['reference_answer','solution'].includes(input.block)&&!attempt.revealedAt)throw failure(403,'REVEAL_REQUIRED','请先显式查看该次作答的答案与解析');
    }
    if(input.block==='feedback'&&mode!=='parent'){
      const grading=attempt.grading,item=grading?.questions?.find(value=>value.questionId===question.id);
      if(attempt.status!=='graded'||!item)throw failure(409,'FEEDBACK_NOT_READY','此题尚无已提交的评分反馈');
      if(grading.sourceRevision!==undefined&&grading.sourceRevision!==exercise.sourceRevision)throw failure(409,'STALE_SOURCE','反馈引用的来源版本不匹配');
      const version=attempt.gradingVersion;if(!Number.isSafeInteger(version)||version<1)throw failure(409,'FEEDBACK_VERSION','反馈缺少可固定的评分版本');
      Object.assign(fields,{attemptGradingVersion:version,gradingJobId:attempt.gradingJobId||null,gradedAt:grading.gradedAt||null});
      if(mode==='read'&&(input.attemptGradingVersion!==version||(input.gradingJobId??null)!==fields.gradingJobId||(input.gradedAt??null)!==fields.gradedAt))throw failure(409,'STALE_FEEDBACK','评分版本已改变，旧批注不会重定位到新反馈');
      content=item.feedback;
    }else if(mode!=='parent'&&input.block==='stem')content=question.stem;
    else if(mode!=='parent'&&input.block==='reference_answer')content=String(question.answer);
    else if(mode!=='parent'&&input.block==='solution')content=String(question.explanation||'')+(question.rubric?.length?'\n\n'+question.rubric.join('\n'):'');
    if(mode!=='parent'&&exercise.sourceRevision!==point.revision)throw failure(409,'STALE_SOURCE','练习引用的来源已修订');
  }else throw failure(400,'ANCHOR_KIND','批注来源类型不支持');
  if(point){Object.assign(fields,{knowledgePointId:point.id,knowledgePointRevision:point.revision,textbookId:point.textbookId});if(mode!=='parent'&&point.archived)throw failure(409,'STALE_SOURCE','知识点已移除');if(mode==='read'&&input.knowledgePointRevision!==undefined&&input.knowledgePointRevision!==point.revision)throw failure(409,'STALE_SOURCE','知识点版本已变化');}
  fields.revision=expectedRevision;
  if(mode==='parent')return{fields,content:null};
  if(input.revision!==expectedRevision)throw failure(409,'STALE_SOURCE','批注来源版本已变化');
  if(typeof content!=='string'||!content)throw failure(409,'EMPTY_ANNOTATION_SOURCE','该来源没有可批注文本');
  fields.targetHash=hash(content);if(mode==='read'&&input.targetHash&&input.targetHash!==fields.targetHash)throw failure(409,'STALE_SOURCE','批注固定的文本已改变');
  return{fields,content};
}
