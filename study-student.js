/* Real model-backed student simulation. Saved records are not classroom evidence. */
(function(scope,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;if(scope?.document)scope.StudyStudent=value;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const PROFILES=Object.freeze({curious:{title:'好奇追问型',description:'围绕你的讲解追问理由、例子和适用条件。'},misconception:{title:'易混淆型',description:'呈现可能的概念混淆，检验你能否清楚解释。'},quiet:{title:'安静思考型',description:'以简短回应和必要提问参与模拟。'}});
  const ACTIVE=new Set(['queued','running','cancelling','cancel_requested']);
  const RESUMABLE=new Set(['failed','cancelled','interrupted']);
  const rows=value=>Array.isArray(value)?value:Array.isArray(value?.items)?value.items:[];
  const enc=value=>encodeURIComponent(String(value));
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  function sessionState(session,{versionId,currentVersionId,versionStale=false,configured=true}={}){
    const turns=count(session?.turnCount??session?.turnsCompleted),maxTurns=Number.isSafeInteger(session?.maxTurns)&&session.maxTurns>0?session.maxTurns:12;
    const stale=versionStale||!!session?.stale||!!(currentVersionId&&currentVersionId!==versionId)||!!(session?.versionId&&session.versionId!==versionId);
    return{turns,maxTurns,stale,limitReached:turns>=maxTurns,canSend:configured&&!stale&&turns<maxTurns,canResume:configured&&!stale};
  }
  function install({api,getContext,notify=()=>{}}={}){
    if(typeof api!=='function'||typeof getContext!=='function')throw new TypeError('Student simulation requires api and context');
    const doc=document;let view=null,disposed=false,sequence=0;
    const stamp=()=>JSON.stringify([getContext()?.userId,getContext()?.epoch,getContext()?.book?.id]);
    const current=v=>!disposed&&view===v&&v.stamp===stamp()&&v.node.isConnected&&!!getContext()?.userId;
    const bound=(v,token)=>current(v)&&v.selection===token;
    const listPath=v=>'/teaching-packs/'+enc(v.packId)+'/versions/'+enc(v.versionId)+'/student-simulations';
    const sessionPath=id=>'/student-simulations/'+enc(id);
    function el(tag,cls,text,parent){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);parent?.append(node);return node;}
    function button(label,action,parent,cls=''){const node=el('button',cls,label,parent);node.type='button';node.dataset.studentAction=action;return node;}
    function field(label,parent){const wrap=el('label','student-field',undefined,parent);el('span','',label,wrap);return wrap;}
    function state(v){return sessionState(v.session,{versionId:v.versionId,currentVersionId:v.pack?.currentVersionId,versionStale:v.version?.stale===true,configured:getContext()?.config?.modelConfigured===true});}
    function status(v,message,error=false){if(!current(v))return;v.status.textContent=message||'';v.status.hidden=!message;v.status.dataset.error=String(error);v.live.textContent=message||'';}
    function clear(){if(!view)return;view.selection++;view.request++;clearTimeout(view.timer);view.node.remove();view=null;}
    function markdown(host,content){
      try{if(window.StudyRender?.markdown){const template=doc.createElement('template');template.innerHTML=window.StudyRender.markdown(String(content||''));template.content.querySelectorAll('script,style,img,picture,iframe,object,embed,video,audio,link,form,input,button,svg').forEach(node=>node.remove());template.content.querySelectorAll('[data-student-action]').forEach(node=>node.removeAttribute('data-student-action'));host.append(template.content);window.StudyRender.paint?.(host);}else el('pre','student-plain',content||'',host);}
      catch{host.replaceChildren();el('pre','student-plain',content||'',host);}
    }
    function date(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN'):'时间未记录';}
    function sourceTitle(v){return v.pack?.title||'本课教学任务';}
    function messageText(message){return typeof message.content==='string'?message.content:'';}
    function renderMessages(v){
      if(!current(v))return;const box=v.messagesHost,wasBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;box.replaceChildren();
      if(v.loadingSession){el('div','student-empty','正在读取已保存的模拟对话…',box);return;}
      if(!v.messages.length){const empty=el('div','student-empty',undefined,box);el('span','student-empty-symbol','?',empty);el('h3','','把这一课，讲给一位模拟学生听',empty);el('p','','选择互动类型并点击“开始模拟”。模型将依据学生可见的本课任务与你交流。',empty);return;}
      for(const message of v.messages){const student=message.role==='assistant'||message.role==='student',article=el('article','student-message '+(student?'is-ai':'is-teacher'),undefined,box);article.dataset.messageId=message.id||'';const avatar=el('span','student-avatar',student?'学':'我',article);avatar.setAttribute('aria-hidden','true');const content=el('div','student-message-content',undefined,article),head=el('header','',undefined,content);el('strong','',student?'AI学生 · 模拟':'本人讲解',head);if(message.createdAt)el('time','',date(message.createdAt),head);markdown(el('div','prose student-message-text',undefined,content),messageText(message));}
      if(wasBottom)box.scrollTop=box.scrollHeight;
    }
    function render(v){
      if(!current(v))return;const s=state(v),working=ACTIVE.has(v.job?.status),locked=v.busy||v.loading||v.loadingSession,pendingTurn=v.messages.at(-1)?.role==='teacher';
      v.title.textContent=sourceTitle(v);v.versionLabel.textContent='内容版本 '+(v.version?.version??'—')+' · 学生可见任务';
      v.history.replaceChildren();const draft=el('option','','新建一次模拟',v.history);draft.value='';
      for(const session of v.sessions){const option=el('option','',`${date(session.createdAt)} · ${PROFILES[session.profile]?.title||'模拟学生'}${session.versionId!==v.versionId||session.stale?' · 历史 / 来源待核对':''}`,v.history);option.value=session.id;}v.history.value=v.session?.id||'';v.history.disabled=locked;
      v.profile.value=v.session?.profile||v.profileValue;v.profile.disabled=locked||!!v.session;v.profileHelp.textContent=PROFILES[v.profile.value]?.description||'';
      v.counter.textContent=v.session?'已发起 '+s.turns+' / '+s.maxTurns+' 轮模拟':'每个会话最多12轮模拟';
      v.warning.textContent=s.stale?'这份对话绑定历史或已变化的教学版本，仅可回看。请回到当前教学版本新建模拟。':getContext()?.config?.modelConfigured!==true?'模型未配置，当前只可读取已有模拟记录。':pendingTurn&&!working?'上一条讲解尚未得到回复。请恢复原任务，或新建一次模拟；恢复不会新增轮次。':s.limitReached?'本会话已达到轮次上限。可以回看记录，或新建一次模拟。':'';v.warning.hidden=!v.warning.textContent;
      v.start.hidden=!!v.session&&s.turns>0;v.start.disabled=locked||working||!s.canSend||!v.version;
      v.input.disabled=locked||working||pendingTurn||!s.canSend||!v.session;v.send.disabled=v.input.disabled||!v.input.value.trim();
      v.newButton.disabled=locked||working||s.stale||getContext()?.config?.modelConfigured!==true;
      v.jobHost.replaceChildren();if(v.job){const row=el('div','student-job',undefined,v.jobHost);row.dataset.state=v.job.status;el('span','',working?v.job.status==='queued'?'AI学生回复已排队':'AI学生正在回应，记录由服务端保存':v.job.status==='completed'?'本轮模拟回复已保存':v.job.status==='cancelled'?'本轮已取消，已有对话保留':v.job.status==='interrupted'?'本轮已中断，可核对后继续':'本轮回复未完成',row);if(v.job.error?.message)el('p','student-help',v.job.error.message,row);if(working){const cancel=button('取消本轮回复','cancel',row);cancel.disabled=v.busy;}else if(RESUMABLE.has(v.job.status)){const resume=button('继续此轮回复','resume',row);resume.disabled=locked||!s.canResume;}}
      renderMessages(v);
    }
    function acceptSession(v,session){
      if(!session||session.packId!==v.packId||session.userId&&session.userId!==getContext().userId)throw new Error('模拟会话不属于当前教学任务。');
      v.session=session;v.messages=rows(session.messages);const found=v.sessions.findIndex(item=>item.id===session.id);if(found<0)v.sessions.unshift(session);else v.sessions[found]={...v.sessions[found],...session};
    }
    async function selectSession(v,id){
      const token=++v.selection;clearTimeout(v.timer);v.request++;v.pollBlocked=false;v.loadingSession=!!id;v.session=null;v.messages=[];v.job=null;v.input.value=v.drafts.get(id||'new')||'';status(v,null);render(v);if(!id)return;
      try{const session=await api(sessionPath(id));if(!bound(v,token))return;acceptSession(v,session);const jobId=session.activeJobId||session.lastJobId;if(jobId){const job=await api('/jobs/'+enc(jobId));if(!bound(v,token))return;acceptJob(v,job);} }
      catch(error){if(bound(v,token)&&error?.code!=='STALE_VIEW')status(v,error.message||'模拟历史读取失败。',true);}
      finally{if(bound(v,token)){v.loadingSession=false;render(v);schedule(v);}}
    }
    function acceptJob(v,job){if(!job||job.type!=='student-simulation'||job.payload?.sessionId!==v.session?.id)throw new Error('模拟任务与当前会话不一致。');v.job=job;}
    function schedule(v){clearTimeout(v.timer);if(current(v)&&!v.pollBlocked&&ACTIVE.has(v.job?.status))v.timer=setTimeout(()=>poll(v),1400);}
    async function refreshBinding(v,token=v.selection){const data=await Promise.all([api('/teaching-packs/'+enc(v.packId)),api('/teaching-packs/'+enc(v.packId)+'/versions/'+enc(v.versionId)+'?audience=student')]);if(!bound(v,token))return false;v.pack=data[0];v.version=data[1];return true;}
    async function reloadSession(v,token){const id=v.session?.id;if(!id)return;const session=await api(sessionPath(id));if(!bound(v,token)||v.session?.id!==id)return;acceptSession(v,session);await refreshBinding(v,token);}
    async function poll(v){const token=v.selection,jobId=v.job?.id,request=++v.request;if(!current(v)||!jobId)return;try{const job=await api('/jobs/'+enc(jobId));if(!bound(v,token)||request!==v.request||v.job?.id!==jobId)return;acceptJob(v,job);if(!ACTIVE.has(job.status))await reloadSession(v,token);if(bound(v,token))render(v);}catch(error){if(bound(v,token)&&error?.code!=='STALE_VIEW'){if([401,403,404].includes(error.status))v.pollBlocked=true;status(v,error.message||'暂时无法读取模拟任务，可刷新历史。',true);}}finally{if(bound(v,token))schedule(v);}}
    async function send(v,initial=false){
      if(!current(v)||v.busy||ACTIVE.has(v.job?.status))return;const token=v.selection,content=initial?'我准备开始讲解这节课。请作为模拟学生，先提出一个与本课任务有关的问题。':v.input.value.trim();if(!content)return;
      v.busy=true;status(v,null);render(v);
      try{
        if(!await refreshBinding(v,token))return;if(!state(v).canSend)throw new Error(state(v).stale?'教学版本已变化，当前模拟只能回看。':'当前会话不可继续，请核对轮次及模型配置。');
        if(!v.session){if(!v.createKeys.has(v.profileValue))v.createKeys.set(v.profileValue,window.crypto.randomUUID());const session=await api(listPath(v),{method:'POST',data:{profile:v.profileValue,clientRequestId:v.createKeys.get(v.profileValue)}});if(!bound(v,token))return;acceptSession(v,session);v.createKeys.delete(v.profileValue);}
        const sessionId=v.session.id,key=sessionId+'\n'+content;if(!v.messageKeys.has(key))v.messageKeys.set(key,window.crypto.randomUUID());
        v.input.value=content;v.drafts.set(sessionId,content);
        const job=await api(sessionPath(sessionId)+'/messages',{method:'POST',data:{content,clientRequestId:v.messageKeys.get(key)}});if(!bound(v,token)||v.session?.id!==sessionId)return;acceptJob(v,job);v.messageKeys.delete(key);v.input.value='';v.drafts.delete(sessionId);await reloadSession(v,token);if(bound(v,token)){render(v);schedule(v);}
      }catch(error){if(bound(v,token)&&error?.code!=='STALE_VIEW'){status(v,error.message||'本轮未完成，已保存记录可重读。',true);if(error.status===409)await refreshBinding(v,token).catch(()=>{});}}
      finally{if(bound(v,token)){v.busy=false;render(v);}}
    }
    async function jobAction(v,name){if(!current(v)||v.busy||!v.job)return;const token=v.selection,id=v.job.id;if(name==='resume'&&!state(v).canResume)return;v.busy=true;clearTimeout(v.timer);render(v);try{const job=await api('/jobs/'+enc(id)+'/'+name,{method:'POST',data:{}});if(!bound(v,token)||v.job?.id!==id)return;acceptJob(v,job);await reloadSession(v,token);}catch(error){if(bound(v,token)&&error?.code!=='STALE_VIEW')status(v,error.message||'任务操作未完成。',true);}finally{if(bound(v,token)){v.busy=false;render(v);schedule(v);}}}
    async function mount(host,{packId,versionId}={}){
      if(disposed)throw new Error('Student simulation has been disposed');if(!host||host.nodeType!==1||!packId||!versionId)throw new TypeError('Student simulation requires host, packId and versionId');clear();if(!getContext()?.userId)throw new Error('请先登录。');
      const node=el('section','student-simulation',undefined,host),v={node,id:++sequence,stamp:stamp(),packId,versionId,selection:0,request:0,loading:true,busy:false,profileValue:'curious',session:null,sessions:[],messages:[],job:null,timer:null,drafts:new Map(),messageKeys:new Map(),createKeys:new Map()};view=v;
      const heading=el('header','student-heading',undefined,node),titleBox=el('div','',undefined,heading);el('p','student-eyebrow','SIMULATED STUDENT · TEACHING REHEARSAL',titleBox);v.title=el('h2','','AI学生模拟',titleBox);v.versionLabel=el('p','student-help','',titleBox);v.newButton=button('新建模拟','new',heading);
      const disclaimer=el('p','student-disclaimer','AI学生模拟不是实际学生或真实班级反馈。模型回应可能有误；本页不自动评定你的教学能力。',node);disclaimer.setAttribute('role','note');
      v.live=el('p','sr-only','',node);v.live.setAttribute('role','status');v.live.setAttribute('aria-live','polite');v.status=el('p','student-status','',node);v.status.hidden=true;v.warning=el('p','student-warning','',node);v.warning.hidden=true;
      const layout=el('div','student-layout',undefined,node),aside=el('aside','student-controls',undefined,layout);el('h3','','模拟设置',aside);v.profile=el('select','',undefined,field('AI学生互动类型',aside));v.profile.setAttribute('aria-label','AI学生互动类型');for(const [id,profile]of Object.entries(PROFILES)){const option=el('option','',profile.title,v.profile);option.value=id;}v.profileHelp=el('p','student-help','',aside);v.history=el('select','',undefined,field('已保存的模拟会话',aside));v.history.setAttribute('aria-label','已保存的模拟会话');button('刷新历史','refresh',aside,'student-refresh');v.counter=el('p','student-turns','',aside);el('p','student-help','依据当前版本的学生任务开展模拟。历史版本只读，原有记录不会因为离开页面而删除。',aside);v.start=button('开始模拟','start',aside,'primary student-start');
      const conversation=el('main','student-conversation',undefined,layout);v.jobHost=el('div','student-job-host','',conversation);v.messagesHost=el('div','student-messages',undefined,conversation);v.messagesHost.setAttribute('aria-label','已保存的模拟对话');const form=el('form','student-composer',undefined,conversation);v.input=el('textarea','',undefined,field('本人讲解 / 回应模拟学生',form));v.input.setAttribute('aria-label','本人讲解');v.input.maxLength=3000;v.input.rows=3;v.input.placeholder='试着把理由讲清楚，或回应刚才的问题…';const footer=el('div','student-composer-footer',undefined,form);el('span','student-help','Ctrl / ⌘ + Enter 发送 · 离开页面不取消后台任务',footer);v.send=el('button','primary','发送讲解',footer);v.send.type='submit';
      node.addEventListener('click',event=>{const target=event.target.closest('[data-student-action]');if(!target||target.disabled||!current(v))return;const name=target.dataset.studentAction;if(name==='start')send(v,true);else if(name==='new')selectSession(v,'');else if(name==='refresh')load(v,v.session?.id);else if(name==='cancel'||name==='resume')jobAction(v,name);});
      form.addEventListener('submit',event=>{event.preventDefault();send(v);});v.input.addEventListener('input',()=>{if(!current(v))return;v.drafts.set(v.session?.id||'new',v.input.value);v.send.disabled=v.input.disabled||!v.input.value.trim();});v.input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();if(!v.send.disabled)send(v);}});v.profile.addEventListener('change',()=>{if(current(v)&&!v.session){v.profileValue=v.profile.value;render(v);}});v.history.addEventListener('change',()=>{if(current(v)&&!v.busy)selectSession(v,v.history.value);});
      render(v);await load(v);return node;
    }
    async function load(v,preferred){const token=++v.selection;clearTimeout(v.timer);v.loading=true;status(v,null);render(v);try{const results=await Promise.all([api('/teaching-packs/'+enc(v.packId)),api('/teaching-packs/'+enc(v.packId)+'/versions/'+enc(v.versionId)+'?audience=student'),api(listPath(v))]);if(!bound(v,token))return;v.pack=results[0];v.version=results[1];v.sessions=rows(results[2]);v.loading=false;const chosen=v.sessions.find(s=>s.id===preferred)||v.sessions.find(s=>s.versionId===v.versionId)||v.sessions[0];if(chosen)await selectSession(v,chosen.id);else render(v);}catch(error){if(bound(v,token)&&error?.code!=='STALE_VIEW')status(v,error.message||'AI学生模拟暂不可读。',true);}finally{if(bound(v,token)){v.loading=false;render(v);}}}
    function contextChanged(){if(view&&(view.stamp!==stamp()||!view.node.isConnected))clear();}
    const ended=()=>clear();window.addEventListener('study-session-ended',ended);
    return Object.freeze({mount,contextChanged,unmount:clear,dispose(){if(disposed)return;clear();disposed=true;window.removeEventListener('study-session-ended',ended);}});
  }
  return Object.freeze({install,sessionState,profiles:PROFILES});
});
