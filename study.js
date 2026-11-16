/* Independent textbook learning client. Source documents and account data stay in the private service. */
(() => {
  'use strict';
  const root = document.getElementById('study-root');
  const dialog = document.getElementById('study-dialog');
  const S = {user:null,preferences:{},books:[],folders:[],workshops:[],config:{},epoch:0,tab:'lesson',book:null,kp:null,lesson:null,outline:null,conversation:null,job:null,signup:false,exercise:null,attempt:null};
  const esc = value => window.TeachingAI.escapeHtml(value);
  const arr = value => Array.isArray(value) ? value : value?.items || [];
  const latest = value => (Array.isArray(value)||Array.isArray(value?.items)) ? arr(value).at(-1)||null : value;
  const stamp = value => value ? new Date(value).toLocaleDateString('zh-CN') : '';
  const idPath = value => encodeURIComponent(String(value));
  const markdown = value => window.StudyRender.markdown(String(value || '')).trim();
  const styleNames = {default:'中文讲解',language_adaptive:'中文讲述 · 保留英文术语',english:'English'};
  const statusNames = {completed:'已完成',cancelling:'正在取消',empty:'待上传',uploaded:'待解析','needs-ocr':'扫描教材 · 待识别',partial:'部分页已识别',parsing:'正在解析',processing:'正在处理',ready:'可以学习',failed:'处理失败',queued:'等待处理',running:'正在处理',cancelled:'已取消',interrupted:'处理已中断',cancel_requested:'正在取消'};

  async function api(path, options={}) {
    const uiEpoch=S.epoch,userId=S.user?.id;
    const init = {...options,credentials:'same-origin',headers:{...options.headers}};
    if (options.data !== undefined) { init.body=JSON.stringify(options.data);init.headers['Content-Type']='application/json';delete init.data; }
    const response = await fetch('/api/v1'+path,init);
    const body = await response.json().catch(()=>({success:false,error:{message:'服务没有返回有效结果，请使用npm start打开学习空间。'}}));
    if(uiEpoch!==S.epoch||userId!==S.user?.id){const error=new Error('');error.code='STALE_VIEW';throw error;}
    if (!response.ok || body.success===false) { const error=new Error(body.error?.message || '操作失败');error.status=response.status;error.code=body.error?.code;throw error; }
    return body.data;
  }
  function toast(message,error=false) {
    if(!message)return;
    const node=document.createElement('div');node.className='study-toast'+(error?' error':'');node.textContent=message;
    document.getElementById('study-toast').appendChild(node);setTimeout(()=>node.remove(),6000);
  }
  const notesClient=window.StudyNotes.install({getContext:()=>({userId:S.user?.id,epoch:S.epoch,kp:S.kp,lesson:S.lesson,exercise:S.exercise,attempt:S.attempt,conversation:S.conversation}),api,notify:toast});
  const courseClient=window.StudyCourse.install({getContext:()=>({userId:S.user?.id,epoch:S.epoch,book:S.book,outline:S.outline}),api,notify:toast,navigate:(path,options={})=>{if(options.source)S.tab='source';if(location.hash==='#'+path)renderReader().catch(error=>toast(error.message,true));else link(path);}});
  const teachingClient=window.StudyTeaching.install({getContext:()=>({userId:S.user?.id,epoch:S.epoch,book:S.book,outline:S.outline}),api,notify:toast,navigate:(path,options={})=>{if(options.source)S.tab='source';if(location.hash==='#'+path)renderReader().catch(error=>toast(error.message,true));else link(path);}});
  function studyLimits(){return {textbookBytes:300*1024**2,pages:3000,workshopBytes:30*1024**2,markdownBytes:5*1024**2,...S.config.learningLimits};}
  function paintMath(scope=root) {
    window.StudyRender.paint(scope);
  }
  function applyPreferences() {
    let theme=S.preferences.theme||'light';if(theme==='system')theme=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
    document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--reader-scale',String(S.preferences.fontScale||1));
  }
  function route() { return (location.hash.slice(1)||'/textbooks').split('/').filter(Boolean).map(decodeURIComponent); }
  function link(path) { location.hash=path; }
  function modal(content) { document.getElementById('dialog-content').innerHTML=content;dialog.querySelectorAll('[data-page-bound]').forEach(input=>input.max=studyLimits().pages);if(!dialog.open)dialog.showModal();paintMath(dialog); }
  function outlinePoint(point={}) {
    return `<div class="outline-point" data-point-id="${esc(point.id||'')}"><input name="pointTitle" value="${esc(point.title||'')}" maxlength="200" placeholder="知识点名称" required aria-label="知识点名称"><div class="row"><label class="small">第 <input name="pointStart" type="number" min="1" data-page-bound max="3000" value="${esc(point.startPage||point.sourceAnchor?.startPage||'')}" placeholder="起始页" aria-label="知识点起始页" style="width:80px"> 页</label><label class="small">至 <input name="pointEnd" type="number" min="1" data-page-bound max="3000" value="${esc(point.endPage||point.sourceAnchor?.endPage||'')}" placeholder="结束页" aria-label="知识点结束页" style="width:80px"> 页</label><button class="quiet small danger" type="button" data-action="outline-remove-point">移除</button></div></div>`;
  }
  function outlineChapter(chapter={}) {
    return `<fieldset class="card outline-chapter" data-chapter-id="${esc(chapter.id||'')}"><legend class="small">章节</legend><label class="field-label">章节名称<input name="chapterTitle" maxlength="200" required value="${esc(chapter.title||'')}"></label><div class="form-columns" style="margin:15px 0"><label class="field-label">起始页<input name="chapterStart" type="number" min="1" data-page-bound max="3000" required value="${esc(chapter.startPage||1)}"></label><label class="field-label">结束页<input name="chapterEnd" type="number" min="1" data-page-bound max="3000" required value="${esc(chapter.endPage||chapter.startPage||1)}"></label></div><p class="small muted">这一章要理解哪些知识点？</p><div class="outline-points">${arr(chapter.knowledgePoints).map(outlinePoint).join('')}</div><div class="row"><button type="button" class="small" data-action="outline-add-point">＋ 知识点</button><button type="button" class="quiet small danger" data-action="outline-remove-chapter">移除此章</button></div></fieldset>`;
  }
  function currentOutline() {
    const points=arr(S.outline?.knowledgePoints);
    return arr(S.outline?.chapters).map(ch=>({...ch,knowledgePoints:points.length?points.filter(p=>p.chapterId===ch.id):arr(ch.knowledgePoints)}));
  }
  function openOutlineEditor(chapters=currentOutline(),notice='') {
    modal(`<h2>校正教材目录</h2><p class="small muted">对照教材核对章节、页码和知识点。保存后学习内容会绑定新的来源版本。</p>${notice?`<p class="hint">${esc(notice)}</p>`:''}<form id="study-outline-form"><div id="outline-chapters" class="stack">${chapters.map(outlineChapter).join('')}</div><button type="button" class="small" data-action="outline-add-chapter" style="margin-top:15px">＋ 添加章节</button><div class="form-actions"><button class="primary" type="submit">确认并保存目录</button></div></form>`);
  }
  function readOutlineForm(form) {
    return {chapters:[...form.querySelectorAll('.outline-chapter')].map(ch=>({...(ch.dataset.chapterId?{id:ch.dataset.chapterId}:{}),title:ch.querySelector('[name=chapterTitle]').value,startPage:Number(ch.querySelector('[name=chapterStart]').value),endPage:Number(ch.querySelector('[name=chapterEnd]').value),knowledgePoints:[...ch.querySelectorAll('.outline-point')].map(point=>({...(point.dataset.pointId?{id:point.dataset.pointId}:{}),title:point.querySelector('[name=pointTitle]').value,...(point.querySelector('[name=pointStart]').value?{startPage:Number(point.querySelector('[name=pointStart]').value)}:{}),...(point.querySelector('[name=pointEnd]').value?{endPage:Number(point.querySelector('[name=pointEnd]').value)}:{})}))}))};
  }
  function mergeCourseProposal(proposal) {
    if(!proposal.partial)return proposal.chapters;
    const chapters=currentOutline().map(ch=>({...ch,knowledgePoints:[...ch.knowledgePoints]}));
    const originalChapters=[...chapters],originalPoints=new Map(chapters.map(ch=>[ch,[...ch.knowledgePoints]])),updated=new Set();
    for(const incoming of proposal.chapters){
      const container=originalChapters.find(ch=>incoming.startPage>=ch.startPage&&incoming.endPage<=ch.endPage);
      if(!container){chapters.push(incoming);continue;}
      const old=originalPoints.get(container);
      const preserved=updated.has(container)?container.knowledgePoints:old.filter(point=>{const start=point.sourceAnchor?.startPage||point.startPage||container.startPage,end=point.sourceAnchor?.endPage||point.endPage||container.endPage;return start<proposal.startPage||end>proposal.endPage;});
      const additions=incoming.knowledgePoints.map(point=>{const previous=old.find(p=>p.title===point.title&&(p.sourceAnchor?.startPage||p.startPage||container.startPage)===point.startPage);return previous?{...point,id:previous.id}:point;});
      container.knowledgePoints=[...preserved,...additions].filter((point,index,all)=>all.findIndex(other=>(other.id&&other.id===point.id)||(!other.id&&!point.id&&other.title===point.title&&other.startPage===point.startPage))===index);
      updated.add(container);
    }
    return chapters.sort((a,b)=>a.startPage-b.startPage);
  }
  function shell(label,content) {
    const current=route()[0]||'textbooks';
    const navigation=[['textbooks','▤','我的教材'],['workshops','◇','课题研究'],['notes','▧','我的笔记'],['statistics','▥','学习记录'],['settings','⚙','学习偏好']];
    root.innerHTML=`<div class="app-shell"><aside class="side"><a class="brand" href="#/textbooks"><span class="brand-symbol">知</span><div><strong>教材学习</strong><small>LEARN WITH YOUR BOOK</small></div></a><nav class="nav" aria-label="学习导航">${navigation.map(([key,icon,title])=>`<a href="#/${key}" class="${current===key||(current==='textbook'&&key==='textbooks')?'active':''}"><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${title}</span></a>`).join('')}</nav><div class="side-bottom"><a class="small muted" href="/">← 师范生成长驿站</a><div class="user-line"><span class="avatar">${esc((S.user.nickname||S.user.email||'学').slice(0,1))}</span><div><strong class="small">${esc(S.user.nickname||'学习者')}</strong><div class="small muted">个人学习空间</div></div></div><div class="row"><button class="quiet small" data-action="membership">服务状态</button><button class="quiet small" data-action="logout">退出</button></div></div></aside><main class="main"><header class="topbar"><div class="row"><button class="mobile-nav-btn quiet" data-action="menu" aria-label="展开导航">☰</button><span class="breadcrumb">学习空间 / ${esc(label)}</span></div><div class="row"><span class="pill">${S.config.modelConfigured?'AI 已配置':'本机文档学习'}</span><button class="quiet small" data-action="feedback">反馈</button></div></header><div id="study-content">${content}</div></main></div>`;
    paintMath();
  }
  function showAuth() {
    S.epoch++;stopSpeech();dialog.close();document.getElementById('dialog-content').replaceChildren();S.pendingNote=null;S.book=null;S.kp=null;S.lesson=null;S.exercise=null;S.attempt=null;S.conversation=null;window.dispatchEvent(new Event('study-session-ended'));
    root.innerHTML=`<div class="auth-shell"><section class="auth-story"><p class="eyebrow">YOUR BOOK. YOUR PACE.</p><h1>让一本教材，<br>成为你的私人课程。</h1><p>逐个知识点理解，带着疑问追问。<br>把读过的内容，变成能解释、会运用的知识。</p><p class="small" style="margin-top:30px">教材 · 讲解 · 练习 · 笔记</p></section><section class="auth-form-wrap"><div class="auth-form"><h2>${S.signup?'建立你的学习空间':'欢迎回来'}</h2><p>${S.signup?'邮箱作为本地账户标识。上传有权使用的教材，开始你的第一门课。':'继续上次的理解，从一个知识点开始。'}</p><form id="study-auth-form">${S.signup?'<label class="field-label">昵称<input name="nickname" maxlength="40" autocomplete="nickname" required></label>':''}<label class="field-label">邮箱<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label class="field-label">密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${S.signup?'new-password':'current-password'}" required></label><div class="auth-error" id="auth-error" role="alert"></div><button class="primary" type="submit">${S.signup?'创建账户':'进入学习空间'}</button></form><div class="auth-toggle">${S.signup?'已有账户？':'第一次使用？'}<button class="quiet" data-action="auth-toggle">${S.signup?'登录':'注册本地账户'}</button></div><p class="footer-note">独立实现的教材学习系统。账号及文件保存在当前服务实例；邮箱尚未进行邮件验证。<a href="/">返回门户</a></p></div></section></div>`;
  }
  async function refreshLists() {
    const userId=S.user?.id;const [books,folders,workshops]=await Promise.all([api('/textbooks'),api('/folders'),api('/workshops')]);
    if(userId!==S.user?.id)return;S.books=arr(books);S.folders=arr(folders);S.workshops=arr(workshops);
  }
  function bookCard(book) {
    return `<article class="card book-card"><a href="#/textbook/${idPath(book.id)}"><div class="book-cover" aria-hidden="true">${esc(book.title.slice(0,16))}</div></a><div class="book-detail"><h3>${esc(book.title)}</h3><p>${esc(stamp(book.updatedAt))} · ${esc(statusNames[book.status]||book.status||'待处理')}</p><div class="book-footer"><span class="tag">${esc(book.chapterCount?book.chapterCount+'章':'个人教材')}</span><a href="#/textbook/${idPath(book.id)}">打开教材 ↗</a></div></div></article>`;
  }
  function library() {
    S.book=null;S.kp=null;S.conversation=null;
    shell('我的教材',`<section class="content"><div class="page-heading"><div><p class="eyebrow">A PLACE FOR UNDERSTANDING</p><h1>我的教材</h1><p>把你的教材，读成自己的知识。</p></div><button class="primary" data-action="upload">＋ 上传教材</button></div><div class="welcome-banner"><div><h2>从一本书，开始一门课</h2><p>上传 PDF，校正章节目录，再逐个知识点学习。讲解与追问始终围绕教材，练习和笔记帮助你把理解留下来。</p></div><div class="book-motif" aria-hidden="true"><span></span><span></span><span></span></div></div><div class="filterbar"><button class="quiet" data-action="folder-new">＋ 新建文件夹</button><select id="book-folder-filter" aria-label="筛选教材文件夹"><option value="">全部教材</option>${S.folders.map(f=>`<option value="${esc(f.id)}">${esc(f.title||f.name)}</option>`).join('')}</select><input class="search" id="book-search" type="search" placeholder="搜索教材…" aria-label="搜索教材"></div><div class="grid" id="book-grid">${S.books.map(bookCard).join('')}<button class="add-card" data-action="upload"><div><span class="add-plus">＋</span><strong>添加一本教材</strong><p>PDF 教材，最大${studyLimits().textbookBytes/1024**2} MiB<br>也支持 Markdown 文本资料</p></div></button></div><p class="footer-note">文件只对当前账户可见。AI 讲解与练习需服务端配置模型；没有配置时，仍可上传、解析、校正目录和记录笔记。</p></section>`);
  }
  function uploadModal() {
    modal(`<h2>从你的教材开始</h2><p class="small muted">请选择你有权使用的教材。文件传输与内容解析是两个独立步骤。</p><form id="study-upload-form" class="stack"><label class="field-label">教材名称<input name="title" maxlength="180" required placeholder="例如：初中生物 · 光合作用"></label><label class="drop-zone" id="study-drop-zone"><span><strong>选择 PDF 或 Markdown 文件</strong><br><span class="small muted">PDF ≤${studyLimits().textbookBytes/1024**2} MiB / ${studyLimits().pages}页；Markdown ≤${studyLimits().markdownBytes/1024**2} MiB</span></span><input type="file" name="file" accept="application/pdf,.pdf,.md,.markdown,text/markdown" required></label><label class="field-label">保存到<select name="folderId"><option value="">我的教材</option>${S.folders.map(f=>`<option value="${esc(f.id)}">${esc(f.title||f.name)}</option>`).join('')}</select></label><div class="upload-status" id="upload-status" role="status"></div><div class="form-actions"><button class="primary" type="submit">上传并解析</button></div></form>`);
    const zone=document.getElementById('study-drop-zone');
    zone.addEventListener('dragover',event=>{event.preventDefault();zone.classList.add('drag');});zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
    zone.addEventListener('drop',event=>{event.preventDefault();zone.classList.remove('drag');const files=event.dataTransfer.files;if(files.length){zone.querySelector('input').files=files;zone.querySelector('input').dispatchEvent(new Event('change',{bubbles:true}));}});
  }
  async function uploadFile(bookId,file,onProgress,container='textbooks') {
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();S.upload=xhr;const cleanup=()=>{if(S.upload===xhr)S.upload=null;};xhr.open('POST',`/api/v1/${container}/${idPath(bookId)}/files`);xhr.withCredentials=true;xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
      xhr.upload.onprogress=event=>onProgress(event.lengthComputable?`正在传输 ${Math.round(event.loaded/event.total*100)}%`:'正在传输文件…');
      xhr.onerror=()=>{cleanup();reject(new Error('文件传输中断，请重试。'));};xhr.onabort=()=>{cleanup();reject(new Error('上传已取消。'));};
      xhr.onload=()=>{cleanup();try{const data=JSON.parse(xhr.responseText);if(xhr.status>=400||data.success===false)reject(new Error(data.error?.message||'上传失败'));else resolve(data.data);}catch{reject(new Error('文件服务返回无效结果'));}};xhr.send(file);
    });
  }
  function jobHtml(job) {
    if(!job)return '';
    const scanRecovery=job.type==='parse'&&job.error?.code==='NO_TEXT'&&route()[0]==='textbook';
    return `<div class="job-box ${['failed','cancelled','interrupted'].includes(job.status)?'job-error':''}"><div><strong>${esc(scanRecovery?'扫描教材需要识别文字':statusNames[job.status]||job.status||'处理中')}</strong><div class="small">${esc(scanRecovery?'文件已收到，普通解析没有读到文字层。选择需要学习的页码，在本机识别后继续。':job.error?.message||job.error||job.message||job.phase||job.stage||'任务状态由服务端确认')}</div></div>${scanRecovery?'<button class="primary" data-action="parse-ocr">选择页码并识别</button>':['failed','cancelled','interrupted'].includes(job.status)?`<button data-action="resume-job" data-id="${esc(job.id)}">重新发起任务</button>`:''}${['queued','running','cancelling','cancel_requested'].includes(job.status)?`<button data-action="cancel-job" data-id="${esc(job.id)}">取消任务</button>`:''}</div>`;
  }
  function watchJob(job,done) {
    const epoch=S.epoch,key=epoch+':'+job.id;
    S.watchers ||= new Map();
    if(S.watchers.has(key))return S.watchers.get(key);
    const promise=runJobWatch(job,done,epoch).finally(()=>S.watchers.delete(key));S.watchers.set(key,promise);return promise;
  }
  async function runJobWatch(job,done,epoch) {
    S.job=job;
    let current=job;
    for(let count=0;count<1200;count++){
      if(epoch!==S.epoch)return;
      const slot=document.getElementById('active-job');if(slot)slot.innerHTML=jobHtml(current);
      if(['ready','completed','succeeded'].includes(current.status)){S.job=null;await done(current);return;}
      if(['failed','cancelled','interrupted'].includes(current.status)){S.job=current;throw new Error(current.error?.message||current.error||'任务没有完成，请检查后重试。');}
      await new Promise(resolve=>setTimeout(resolve,650));if(epoch!==S.epoch)return;
      current=await api('/jobs/'+idPath(job.id));if(epoch!==S.epoch)return;S.job=current;
    }
    throw new Error('任务仍在运行，请刷新查看服务端状态。');
  }
  async function course(bookId,kpId,epoch) {
    const [book,outline,jobs,files]=await Promise.all([api('/textbooks/'+idPath(bookId)),api('/textbooks/'+idPath(bookId)+'/outline'),api('/jobs'),api('/textbooks/'+idPath(bookId)+'/files')]);
    if(epoch!==S.epoch)return;
    const chapters=arr(outline.chapters);const points=arr(outline.knowledgePoints);
    const allPoints=points.length?points:chapters.flatMap(c=>arr(c.knowledgePoints));
    let kp=allPoints.find(p=>String(p.id)===String(kpId))||allPoints[0];
    let selectedPoint=null,selectedLesson=null,lessonVersions=[];
    if(kp){try{selectedPoint=await api('/knowledge-points/'+idPath(kp.id));}catch{selectedPoint=kp;}try{lessonVersions=arr(await api('/knowledge-points/'+idPath(kp.id)+'/lesson'));selectedLesson=(S.pendingNote?.sourceId===kp.id&&S.pendingNote?.lessonId?lessonVersions.find(l=>l.id===S.pendingNote.lessonId):null)||lessonVersions.at(-1)||null;}catch(error){if(epoch===S.epoch&&![404,202].includes(error.status))toast(error.message,true);}}
    if(epoch!==S.epoch)return;
    S.book=book;S.outline=outline;S.kp=selectedPoint;S.lesson=selectedLesson;S.lessonVersions=lessonVersions;S.conversation=null;S.exercise=null;S.attempt=null;
    const pointIds=new Set(allPoints.map(p=>p.id)),fileIds=new Set(arr(files).map(f=>f.id));const scopedJobs=arr(jobs).filter(job=>job.payload?.textbookId===bookId||pointIds.has(job.payload?.knowledgePointId)||fileIds.has(job.payload?.fileId));const activeJob=scopedJobs.find(job=>['queued','running','cancelling'].includes(job.status));S.job=activeJob||(['failed','interrupted','cancelled'].includes(scopedJobs[0]?.status)?scopedJobs[0]:null);
    const outlineHtml=chapters.length?chapters.map(ch=>`<div class="chapter-label">${esc(ch.title)}</div>${(points.length?allPoints.filter(p=>p.chapterId===ch.id):arr(ch.knowledgePoints)).map(p=>`<a href="#/textbook/${idPath(bookId)}/kp/${idPath(p.id)}" class="kp-link ${S.kp?.id===p.id?'active':''} ${p.progress==='mastered'?'done':''}"><span class="dot"></span><span>${esc(p.title)}</span></a>`).join('')}`).join(''):'<p class="small muted" style="padding:12px">解析后在这里显示教材章节与知识点。</p>';
    shell(book.title,`<div class="course-layout"><aside class="outline-panel"><p class="eyebrow" style="padding:0 10px">YOUR PERSONAL COURSE</p><h2>${esc(book.title)}</h2><div class="outline-actions"><button data-action="outline-edit">校正目录</button><button data-action="structure-book">AI细分知识点</button><button data-action="book-options">管理教材</button><button data-action="knowledge-atlas">知识图鉴</button><button data-action="personal-summary">学习总结</button><button class="primary" data-action="teaching-pack">一课时教学任务包</button></div>${outlineHtml}</aside><div class="reader-shell"><article class="reader"><button class="quiet mobile-outline-toggle" data-action="outline-toggle">☰ 教材目录</button><div class="reader-header"><span class="tag">${esc(statusNames[book.status]||book.status)} · 教材 v${esc(book.revision||1)}</span><h1>${esc(S.kp?.title||book.title)}</h1><div class="reader-tools"><button data-action="generate-lesson" ${!S.kp?'disabled':''}>${S.lesson?'重新生成讲解':'生成知识点讲解'}</button><button data-action="speech" ${!S.lesson?'disabled':''}>▷ 设备朗读</button><button data-action="speech-pause">暂停 / 继续</button><button data-action="speech-stop">停止</button><button data-action="export-artifact" data-format="md">导出 Markdown</button><button data-action="export-artifact" data-format="html">离线阅读包</button><button data-action="mark-learned" ${!S.kp?'disabled':''}>${S.kp?.progress==='mastered'?'已掌握 ✓':'标记已掌握'}</button></div></div><div id="active-job">${jobHtml(S.job)}</div><div class="reader-tabs"><button data-action="reader-tab" data-tab="lesson" class="${S.tab==='lesson'?'active':''}">知识点讲解</button><button data-action="reader-tab" data-tab="source" class="${S.tab==='source'?'active':''}">教材原文</button><button data-action="reader-tab" data-tab="exercises" class="${S.tab==='exercises'?'active':''}">自测练习</button><button data-action="reader-tab" data-tab="notes" class="${S.tab==='notes'?'active':''}">笔记</button></div><section id="reader-body"></section></article>${chatPanel()}</div></div>`);
    await renderReader();await loadConversation();if(activeJob)watchJob(activeJob,activeJob.type==='summary'?()=>toast('学习总结已保存。'):rerenderCourse).catch(error=>{if(epoch===S.epoch)toast(error.message,true);});
  }
  function lessonText() { return typeof S.lesson==='string'?S.lesson:S.lesson?.content||S.lesson?.markdown||S.lesson?.text||S.lesson?.lesson?.content||''; }
  function chatPanel(workshop=false) {
    return `<aside class="${workshop?'workshop-chat':'chat-panel'}"><div class="chat-title">${workshop?'围绕课题讨论':'和教材一起想明白'}<p>${workshop?'回答基于当前课题材料，材料不足时应明确说明。':'可以追问定义、推导或例子。回答以当前知识点与教材为上下文。'}</p><div id="chat-session-controls"></div></div><div id="study-chat-messages" class="chat-messages"><div class="conversation-empty">${S.kp?'哪里还不清楚？把你的疑问写下来。':'先选一个知识点，或在课题中添加材料。'}</div></div><form id="study-chat-form" class="chat-form"><textarea name="content" required maxlength="6000" placeholder="例如：这一步为什么成立？可以换个例子吗？" aria-label="向教材提问"></textarea><div class="row"><span class="small muted">Ctrl / ⌘ + Enter 发送</span><button class="primary" type="submit">发送 ↑</button></div></form></aside>`;
  }
  async function renderReader() {
    const body=document.getElementById('reader-body');if(!body)return;
    if(S.tab==='lesson'){
      const content=lessonText();
      body.innerHTML=content?`<div class="source-banner">教材：${esc(S.book.title)} · ${esc(S.kp?.title)} · ${esc(styleNames[S.lesson?.style]||'历史风格未记录')}<br>${S.lesson?.stale?'来源已修订，这份讲解属于旧版本，请重新生成。':'AI 生成内容，请对照原文核查。'}选中文字可保存批注。</div><div class="prose" id="lesson-prose">${markdown(content)}</div>`:`<div class="empty">${S.kp?'点击“生成知识点讲解”，从这一个概念开始。':'上传并解析教材后，校正目录，开始逐知识点学习。'}<div class="row" style="justify-content:center;margin-top:20px"><button data-action="parse-book">解析教材</button><button data-action="parse-ocr">识别扫描页</button></div></div>`;
      paintMath(body);
      const versions=S.lessonVersions||[];
      if(versions.length>1){const control=document.createElement('label');control.className='field-label';control.style.marginBottom='18px';control.innerHTML=`讲解版本<select id="lesson-version-select">${versions.map(lesson=>`<option value="${esc(lesson.id)}" ${S.lesson?.id===lesson.id?'selected':''}>版本 ${esc(lesson.version||1)} · ${esc(stamp(lesson.createdAt))}${lesson.stale?' · 来源已修订':''}</option>`).join('')}</select>`;body.prepend(control);}
      locatePendingNote();
    } else if(S.tab==='source'){
      const text=S.kp?.sourceText||S.kp?.source?.text||S.kp?.text||'';
      body.innerHTML=`<div class="source-banner">源页码：${esc(S.kp?.sourceAnchor?.startPage||'—')}–${esc(S.kp?.sourceAnchor?.endPage||'—')}。原文来自文档解析，公式与版式请对照原文件。</div><div class="row" style="margin-bottom:20px"><button data-action="original-file">打开原教材文件</button><button data-action="outline-edit">校正章节范围</button></div><div class="prose" id="source-prose"></div>`;body.querySelector('#source-prose').textContent=text||'当前知识点尚无可读取的原文范围，请先解析或校正目录。';locatePendingNote();
    } else if(S.tab==='exercises')await showExercises();
    else await showNotes();
  }
  function locatePendingNote() {
    const note=S.pendingNote;if(!note)return;
    const result=notesClient.locate(note);if(result.status==='not-present')return;
    S.pendingNote=null;if(result.status!=='located')toast('已打开对应来源，文字位置或版本需要人工核对。');
  }
  async function loadConversation() {
    if(!S.book||!S.kp)return;
    const bookId=S.book.id,pointId=S.kp.id,epoch=S.epoch;
    const conversations=arr(await api('/textbooks/'+idPath(bookId)+'/conversations'));
    if(epoch!==S.epoch||S.book?.id!==bookId||S.kp?.id!==pointId)return;
    S.currentConversations=conversations.filter(c=>c.knowledgePointId===pointId);S.conversation=S.currentConversations.find(c=>c.id===S.preferredConversationId)||S.currentConversations.at(-1)||null;renderChatControls();
    if(S.conversation)await showMessages();
  }
  function renderChatControls(){const slot=document.getElementById('chat-session-controls');if(!slot)return;const sessions=S.currentConversations||[];slot.innerHTML='<div class="row" style="margin-top:12px">'+(sessions.length>1?'<select id="chat-session-select" aria-label="选择讨论记录" style="min-width:0;max-width:190px">'+sessions.map(session=>'<option value="'+esc(session.id)+'" '+(S.conversation?.id===session.id?'selected':'')+'>'+esc(session.title||'讨论记录')+'</option>').join('')+'</select>':'')+'<button class="quiet small" data-action="conversation-new">＋ 新讨论</button></div>';}
  function messageSourceLinks(message){const cited=new Set(arr(message.sourceIds));return arr(message.sourceVersions).filter(source=>cited.has(source.id)).map(source=>{const file=S.workshopFiles?.find(f=>f.id===source.id),material=S.workshopMaterials?.find(m=>m.id===source.id),point=arr(S.outline?.knowledgePoints).find(p=>p.id===source.id);const anchor=source.sourceAnchor||source.anchor;const name=source.textbookTitle?source.textbookTitle+' · '+(source.title||'知识点'):file?.name||material?.name||source.title||point?.title||'教材来源';const pages=source.sourcePages||[];return '<button class="quiet small" data-action="message-source" data-id="'+esc(source.id)+'" data-kind="'+esc(source.collection||'knowledgePoints')+'" data-revision="'+esc(source.revision||'')+'" data-page="'+esc(pages[0]||anchor?.startPage||1)+'">↗ '+esc(name)+(pages.length?' · 第'+esc(pages.join('、'))+'页':anchor?' · 来源'+esc(anchor.startPage)+'–'+esc(anchor.endPage)+'页':'')+'</button>';}).join('');}
  async function showMessages() {
    if(!S.conversation)return;
    const conversationId=S.conversation.id,epoch=S.epoch,userId=S.user?.id;
    const messages=arr(await api('/conversations/'+idPath(conversationId)+'/messages'));
    if(S.conversation?.id!==conversationId||epoch!==S.epoch||userId!==S.user?.id)return;
    const box=document.getElementById('study-chat-messages');if(!box)return;
    box.innerHTML=messages.map(message=>`<div class="chat-message ${message.role==='user'?'user':'assistant'}"><div class="prose" data-message-id="${esc(message.id)}">${message.role==='user'?esc(message.content):markdown(message.content)}</div>${message.superseded?'<p class="small muted">历史回答 · 已有新版本</p>':''}${messageSourceLinks(message)}${message.role==='assistant'?`<button class="quiet small" data-action="regenerate-message" data-id="${esc(message.id)}">重新生成</button>`:''}</div>`).join('')||'<div class="conversation-empty">从你的第一个问题开始。</div>';paintMath(box);box.scrollTop=box.scrollHeight;locatePendingNote();
  }
  async function showExercises() {
    const box=document.getElementById('reader-body');if(!S.kp){box.innerHTML='<p class="empty">先选择知识点。</p>';return;}
    const epoch=S.epoch,userId=S.user?.id,pointId=S.kp.id,load=(S.exerciseLoad||0)+1;S.exerciseLoad=load;
    const current=()=>epoch===S.epoch&&userId===S.user?.id&&pointId===S.kp?.id&&S.tab==='exercises'&&load===S.exerciseLoad&&box.isConnected;
    const sets=arr(await api('/knowledge-points/'+idPath(S.kp.id)+'/exercises'));
    if(!current())return;
    S.exerciseSets=sets;const set=sets.find(item=>item.id===S.pendingNote?.exerciseId)||S.exercise&&sets.find(item=>item.id===S.exercise.id)||sets[sets.length-1];S.exercise=set||null;
    box.innerHTML=`<div class="row" style="margin-bottom:22px"><button data-action="generate-exercises" data-type="choice">生成3道选择题</button><button data-action="generate-exercises" data-type="short">生成2道简答题</button><span class="small muted">先作答，再查看解析。</span></div><div id="exercise-content">${set?exerciseHtml(set):'<div class="empty">用一道题，检查自己理解到了哪里。</div>'}</div>`;
    restoreDraft();if(set){const history=arr(await api('/exercises/'+idPath(set.id)+'/attempts'));if(!current()||S.exercise?.id!==set.id)return;S.attempt=S.preferredAttemptId==='new'?null:history.find(item=>item.id===S.pendingNote?.attemptId)||history.find(item=>item.id===S.preferredAttemptId)||history.at(-1)||null;const historyControl=document.createElement('label');historyControl.className='field-label';historyControl.style.marginBottom='18px';historyControl.innerHTML='作答记录<select id="attempt-history-select"><option value="new" '+(!S.attempt?'selected':'')+'>继续未提交草稿 / 新作答</option>'+history.map((attempt,index)=>'<option value="'+esc(attempt.id)+'" '+(S.attempt?.id===attempt.id?'selected':'')+'>第'+esc(index+1)+'次 · '+esc(stamp(attempt.createdAt))+(attempt.status==='graded'?' · 已有反馈':'')+'</option>').join('')+'</select>';document.getElementById('exercise-content').prepend(historyControl);if(S.attempt){const form=document.getElementById('study-exercise-form');for(const input of form.elements){if(!input.name)continue;const answer=S.attempt.answers?.[input.name];if(answer===undefined)continue;if(input.type==='radio')input.checked=input.value===answer;else input.value=answer;}showAttemptSummary();if(S.attempt.gradingJobId){const gradingJob=await api('/jobs/'+idPath(S.attempt.gradingJobId));if(!current())return;if(['queued','running','cancelling'].includes(gradingJob.status))watchJob(gradingJob,async()=>{const attemptId=S.attempt?.id;if(!attemptId||!current())return;const fresh=await api('/attempts/'+idPath(attemptId));if(!current()||S.attempt?.id!==attemptId)return;S.attempt=fresh;showAttemptSummary();}).catch(error=>toast(error.message,true));}if(S.attempt.revealedAt)await showAttemptReveal();}}paintMath(box);locatePendingNote();
  }
  function exerciseHtml(set) {
    const questions=arr(set.questions);
    return `${S.exerciseSets?.length>1?`<label class="field-label" style="margin-bottom:20px">练习版本<select id="exercise-version-select">${S.exerciseSets.map(item=>`<option value="${esc(item.id)}" ${item.id===set.id?'selected':''}>版本 ${esc(item.version||1)}${item.stale?' · 来源已修订':''}</option>`).join('')}</select></label>`:''}${set.stale?'<p class="hint">这份练习属于旧来源版本，请重新生成后提交。可保留历史作答供回看。</p>':''}<form id="study-exercise-form">${questions.map((q,i)=>`<article class="question"><h3>第 ${i+1} 题</h3><div class="prose" ${noteAttributes(set,q.id,'stem')}>${markdown(q.question||q.prompt||q.stem||q.text)}</div>${Array.isArray(q.options)?q.options.map((o,j)=>{const key=typeof o==='object'?(o.id||o.key||String.fromCharCode(65+j)):String.fromCharCode(65+j);const text=typeof o==='object'?(o.text||o.label||o.content):o;return `<label class="answer-option"><input type="radio" name="${esc(q.id)}" value="${esc(key)}" required><span>${esc(key)}. <span class="prose">${markdown(text)}</span></span></label>`;}).join(''):`<textarea name="${esc(q.id)}" maxlength="6000" placeholder="写下你的理解…" required aria-label="第${i+1}题作答"></textarea>`}<div id="feedback-${esc(q.id)}"></div></article>`).join('')}<div class="row"><button class="primary" type="submit">提交作答</button><span class="small muted" id="draft-status">草稿自动保存在当前浏览器</span></div></form><div id="attempt-result"></div>`;
  }
  function noteAttributes(set,questionId,block,attemptId){
    return `data-note-kind="exercise" data-note-source="${esc(set.id)}" data-note-revision="${esc(set.sourceRevision)}" data-question-id="${esc(questionId)}" data-note-block="${esc(block)}"${attemptId?` data-attempt-id="${esc(attemptId)}"`:''}`;
  }
  function showAttemptSummary(){
    const output=document.getElementById('attempt-result');if(!output||!S.attempt)return;
    const grading=S.attempt.grading;
    output.innerHTML='<div class="feedback"><strong>作答已保存在账户中</strong><p class="small">'+(grading?'反馈仅作学习参考，请对照教材核查。':'可先请求学习反馈，再显式查看参考答案。')+'</p>'+(grading?'<p>建议分数：'+esc(grading.score)+' / '+esc(grading.maxScore)+'</p><div class="prose">'+markdown(grading.feedback)+'</div>'+arr(grading.questions).map(q=>'<div class="small"><strong>'+esc(q.score)+' / '+esc(q.maxScore)+'</strong><div class="prose" '+noteAttributes(S.exercise,q.questionId,'feedback',S.attempt.id)+'>'+markdown(q.feedback)+'</div></div>').join(''):S.attempt.status==='grading'?'<p class="small" role="status">学习反馈正在生成，完成后会自动显示。</p>':'<button data-action="grade-attempt">请求学习反馈</button>')+' <button data-action="reveal-attempt">查看答案与解析</button></div>';paintMath(output);locatePendingNote();
  }
  async function showAttemptReveal(){
    if(!S.attempt)return;const attemptId=S.attempt.id,exerciseId=S.exercise.id,epoch=S.epoch,userId=S.user?.id;
    const result=await api('/attempts/'+idPath(attemptId)+'/reveal',{method:'POST',data:{}});
    if(epoch!==S.epoch||userId!==S.user?.id||S.attempt?.id!==attemptId||S.exercise?.id!==exerciseId||!document.getElementById('attempt-result'))return;
    S.attempt.revealedAt=result.revealedAt||S.attempt.revealedAt||new Date().toISOString();
    showAttemptSummary();
    document.getElementById('attempt-result').insertAdjacentHTML('beforeend','<h2 class="section-title">逐题核对</h2>'+arr(result.questions).map((question,index)=>'<article class="question"><h3>第 '+esc(index+1)+' 题</h3><div class="prose" '+noteAttributes(S.exercise,question.id,'stem')+'>'+markdown(question.stem)+'</div><p class="small">你的回答：'+esc(question.submittedAnswer)+'</p><span class="tag">'+(question.requiresHumanReview?'简答题 · 待人工核对':question.correct?'回答正确':'再想一想')+'</span><div class="feedback"><strong>参考答案：</strong><div class="prose" '+noteAttributes(S.exercise,question.id,'reference_answer',attemptId)+'>'+markdown(String(question.answer))+'</div><div '+noteAttributes(S.exercise,question.id,'solution',attemptId)+'><div class="prose">'+markdown(question.explanation||'')+'</div>'+ (question.rubric?'<ul>'+question.rubric.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'')+'</div></div></article>').join(''));paintMath();locatePendingNote();
  }
  function draftKey(){return `learning-draft:${S.user.id}:${S.exercise?.id}`;}
  function restoreDraft(){try{const draft=JSON.parse(localStorage.getItem(draftKey())||'{}');const form=document.getElementById('study-exercise-form');if(!form)return;for(const element of form.elements){if(!element.name||draft[element.name]===undefined)continue;if(element.type==='radio')element.checked=element.value===draft[element.name];else element.value=draft[element.name];}}catch{}}
  async function showNotes() {
    const epoch=S.epoch,userId=S.user?.id,sourceId=S.kp?.id;const notes=arr(await api('/highlights'+(S.kp?'?sourceId='+idPath(S.kp.id):'')));
    if(epoch!==S.epoch||userId!==S.user?.id||sourceId!==S.kp?.id)return;const box=document.getElementById('reader-body')||document.getElementById('notes-content');if(!box)return;
    if(sourceId&&S.tab!=='notes')return;
    box.innerHTML=`<p class="small muted">选中原文、讲解、对话或练习中的文字，保存多色批注。每条笔记绑定具体来源与版本，变化后请重新核对。</p>${notes.map(note=>`<article class="note-card"><div class="note-quote">“${esc(note.exact)}”</div><p>${esc(note.note||'未添加文字笔记')}</p><small>${note.resolution?.requiresReview?'位置需核对 · ':note.resolution?.status==='stale'?'来源版本已变 · ':''}版本 ${esc(note.revision||1)} · ${esc(stamp(note.createdAt))}</small><div class="row"><button class="quiet small" data-action="jump-note" data-id="${esc(note.id)}">打开对应来源</button><button class="quiet small" data-action="note-edit" data-id="${esc(note.id)}" data-note="${esc(note.note||'')}">编辑笔记</button><button class="quiet small danger" data-action="note-delete" data-id="${esc(note.id)}">删除</button></div></article>`).join('')||'<div class="empty">把值得回看的理解，留在这里。</div>'}`;
  }
  function workshopForm(workshop=null){
    const linked=new Set(workshop?.linkedTextbookIds||[]);
    modal(`<h2>${workshop?'课题与教材范围':'你想弄明白什么？'}</h2><form id="${workshop?'study-workshop-edit-form':'study-workshop-form'}" ${workshop?`data-revision="${esc(workshop.revision)}"`:''} class="stack"><label class="field-label">课题名称<input name="title" maxlength="180" required value="${esc(workshop?.title||'')}" placeholder="例如：植物如何把光变成能量"></label><label class="field-label">课题目标（选填）<textarea name="description" maxlength="200" rows="2" placeholder="这次想解决什么问题？">${esc(workshop?.description||'')}</textarea></label><div><p class="field-label">关联你的教材</p><p class="small muted">提问时，同时从课题材料和所选教材中查找依据。教材原件仍保留在“我的教材”。</p><div class="workshop-book-choice">${S.books.map(book=>`<label><input type="checkbox" name="linkedTextbookIds" value="${esc(book.id)}" ${linked.has(book.id)?'checked':''}><span>${esc(book.title)} <small class="muted">${esc(statusNames[book.status]||book.status)}</small></span></label>`).join('')||'<p class="small muted">还没有教材，可先创建课题，之后再关联。</p>'}</div></div><button class="primary" type="submit">${workshop?'保存课题范围':'创建课题'}</button></form>`);
  }
  async function workshopList() {
    shell('课题研究',`<section class="content"><div class="page-heading"><div><p class="eyebrow">THINK ACROSS MATERIALS</p><h1>课题研究</h1><p>把讲义、问题和材料放在一起，围绕一个问题持续讨论。</p></div><button class="primary" data-action="workshop-new">＋ 新建课题</button></div><div class="list">${S.workshops.map(w=>`<a class="list-item" href="#/workshops/${idPath(w.id)}"><div><strong>${esc(w.title)}</strong><p>更新于 ${esc(stamp(w.updatedAt))}</p></div><span>打开 ↗</span></a>`).join('')||'<div class="card empty">从一个你想弄明白的问题开始。</div>'}</div></section>`);
  }
  async function workshopDetail(workshopId,epoch) {
    const [workshop,materials,conversations,files,jobs]=await Promise.all([api('/workshops/'+idPath(workshopId)),api('/workshops/'+idPath(workshopId)+'/materials'),api('/workshops/'+idPath(workshopId)+'/conversations'),api('/workshops/'+idPath(workshopId)+'/files'),api('/jobs')]);
    if(epoch!==S.epoch)return;
    S.book=null;S.kp=null;S.workshop=workshop;S.workshopFiles=arr(files);S.workshopMaterials=arr(materials);S.currentConversations=arr(conversations);S.conversation=S.currentConversations.find(c=>c.id===S.preferredConversationId)||S.currentConversations.at(-1)||null;
    const fileIds=new Set(S.workshopFiles.map(file=>file.id)),conversationIds=new Set(S.currentConversations.map(session=>session.id));const scopedJobs=arr(jobs).filter(job=>job.payload?.workshopId===workshopId||fileIds.has(job.payload?.fileId)||conversationIds.has(job.payload?.conversationId));const activeJob=scopedJobs.find(job=>['queued','running','cancelling','cancel_requested'].includes(job.status));S.job=activeJob||(['failed','interrupted','cancelled'].includes(scopedJobs[0]?.status)?scopedJobs[0]:null);
    shell('课题研究 / '+workshop.title,`<section class="content"><div class="page-heading"><div><p class="eyebrow">RESEARCH WORKSHOP</p><h1>${esc(workshop.title)}</h1><p>${esc(workshop.description||'围绕材料与教材提问，并核对回答依据。')}</p></div><div class="row"><button data-action="workshop-links">关联教材 / 管理课题</button><button data-action="workshop-material">＋ 添加材料</button></div></div><div id="active-job">${jobHtml(S.job)}</div><div class="material-grid"><div><section class="linked-books"><strong class="small">关联教材 · ${arr(workshop.linkedTextbookIds).length} 本</strong>${arr(workshop.linkedTextbookIds).map(id=>{const book=S.books.find(item=>item.id===id);return book?`<a href="#/textbook/${idPath(id)}">▤ ${esc(book.title)} ↗</a>`:'';}).join('')||'<p class="small muted">尚未关联教材，可在上方设置。</p>'}</section><h2 class="section-title">课题材料 <span>${arr(materials).length+arr(files).length} 份</span></h2><div class="list">${arr(files).map(file=>`<article class="card"><strong class="small">${esc(file.name)}</strong><p class="small muted">${esc(file.status==='ready'?'可用于讨论':file.status==='partial'?'部分页待识别':statusNames[file.status]||file.status)}${file.pageCount?' · '+esc(file.pageCount)+'页':''}</p><div class="row"><button class="quiet small" data-action="workshop-file-preview" data-id="${esc(file.id)}">预览</button>${file.status!=='ready'?`<button class="quiet small" data-action="workshop-file-parse" data-id="${esc(file.id)}">继续处理</button>`:''}<button class="quiet small danger" data-action="workshop-file-delete" data-id="${esc(file.id)}">移除</button></div></article>`).join('')}${arr(materials).map(m=>`<article class="card"><strong class="small">${esc(m.name||m.title)}</strong><p class="small muted">${esc(m.status||'文本材料')}</p><button class="quiet small danger" data-action="material-delete" data-id="${esc(m.id)}">移除材料</button></article>`).join('')||(!arr(files).length?'<p class="small muted">先添加一份资料，再开始有依据的讨论。</p>':'')}</div><p class="footer-note">回答可引用当前课题材料和已关联教材。调整关联范围后，旧回答仍作为历史记录保留。</p></div>${chatPanel(true)}</div></section>`);renderChatControls();if(S.conversation)await showMessages();if(activeJob)watchJob(activeJob,render).catch(error=>{if(epoch===S.epoch)toast(error.message,true);});
  }
  async function renderSettings() {
    shell('学习偏好',`<section class="content"><div class="page-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h1>按你的方式理解</h1><p>偏好保存后，下一次生成使用新的讲解风格；已有讲解不会被覆盖。</p></div></div><form id="study-settings-form" class="card settings-form"><label class="field-label">讲解风格<select name="teachingStyle">${Object.entries(styleNames).map(([key,label])=>`<option value="${key}" ${S.preferences.teachingStyle===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="field-label">阅读主题<select name="theme">${[['light','纸白'],['dark','深绿'],['system','跟随设备']].map(([key,label])=>`<option value="${key}" ${S.preferences.theme===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field-label">正文字号<select name="fontScale">${[[.9,'较小'],[1,'标准'],[1.15,'较大'],[1.3,'大']].map(([key,label])=>`<option value="${key}" ${Number(S.preferences.fontScale||1)===key?'selected':''}>${label}</option>`).join('')}</select></label><div class="hint">设备朗读使用当前浏览器提供的语音。AI模型由服务端配置，浏览器不保存模型密钥。</div><button class="primary" type="submit">保存偏好</button></form></section>`);
  }
  async function renderStatistics() {
    const epoch=S.epoch;const data=await api('/statistics');if(epoch!==S.epoch)return;
    const pairs=[['教材',data.counts?.textbooks??S.books.length],['知识点',data.counts?.knowledgePoints??0],['讲解记录',data.counts?.lessons??0],['已提交练习',data.counts?.attempts??0]];
    shell('学习记录',`<section class="content"><div class="page-heading"><div><p class="eyebrow">YOUR LEARNING, RECORDED</p><h1>每一步理解，都留下记录</h1><p>仅显示当前服务中保存的行为，不据此推断真实学习效果。</p></div></div><div class="stats">${pairs.map(([label,value])=>`<article class="card stat"><span>${label}</span><strong>${esc(typeof value==='object'?value.count??0:value)}</strong></article>`).join('')}</div><div class="card" style="margin-top:25px"><h2 class="section-title" style="margin-top:0">继续学习</h2><div class="list">${S.books.map(book=>`<a class="list-item" href="#/textbook/${idPath(book.id)}"><strong>${esc(book.title)}</strong><span class="small muted">${esc(statusNames[book.status]||book.status)}</span></a>`).join('')||'<p class="small muted">上传第一本教材后开始积累记录。</p>'}</div></div></section>`);
  }
  async function render() {
    const epoch=++S.epoch;stopSpeech();S.job=null;teachingClient.close();
    if(!S.user){showAuth();return;}
    const parts=route();
    try{
      if(parts[0]==='textbook'&&parts[1])await course(parts[1],parts[3],epoch);
      else if(parts[0]==='workshops'&&parts[1])await workshopDetail(parts[1],epoch);
      else if(parts[0]==='workshops')await workshopList();
      else if(parts[0]==='settings')await renderSettings();
      else if(parts[0]==='statistics')await renderStatistics();
      else if(parts[0]==='notes'){S.book=null;S.kp=null;shell('我的笔记','<section class="content"><div class="page-heading"><div><p class="eyebrow">KEEP YOUR UNDERSTANDING</p><h1>我的笔记</h1></div></div><div id="notes-content"></div></section>');await showNotes();}
      else library();
    }catch(error){if(epoch!==S.epoch)return;if(error.status===401){S.user=null;showAuth();}else{shell('暂时无法打开',`<section class="content"><div class="card empty">${esc(error.message)}<p><a href="#/textbooks">返回我的教材</a></p></div></section>`);toast(error.message,true);}}
  }
  async function rerenderCourse(){teachingClient.close();if(S.book)await course(S.book.id,S.kp?.id,++S.epoch);}

  let speechQueue=[],speechIndex=0,speechActive=false;
  function stopSpeech(){if(window.speechSynthesis)speechSynthesis.cancel();speechQueue=[];speechIndex=0;speechActive=false;}
  function speakNext(){if(!speechActive||speechIndex>=speechQueue.length){speechActive=false;return;}const utterance=new SpeechSynthesisUtterance(speechQueue[speechIndex++]);utterance.lang=(S.preferences.teachingStyle==='english'?'en-US':'zh-CN');utterance.rate=.95;utterance.onend=speakNext;utterance.onerror=()=>{speechActive=false;toast('设备朗读没有完成，请检查系统语音。',true);};speechSynthesis.speak(utterance);}
  function speak(){if(!window.speechSynthesis){toast('当前浏览器不支持设备朗读。',true);return;}stopSpeech();const text=document.querySelector('#lesson-prose')?.textContent||lessonText();if(!text.trim())return;const bounded=text.slice(0,30000);let current='';for(const sentence of bounded.split(/(?<=[。！？.!?\n])/)){if(current.length+sentence.length>3000&&current){speechQueue.push(current);current='';}for(let i=0;i<sentence.length;i+=3000){const part=sentence.slice(i,i+3000);if(current.length+part.length>3000){speechQueue.push(current);current='';}current+=part;}}if(current)speechQueue.push(current);speechActive=true;speakNext();if(text.length>30000)toast('本次朗读前30,000个字符。');}

  async function perform(action,node) {
    if(action==='auth-toggle'){S.signup=!S.signup;showAuth();return;}
    if(action==='menu'){document.querySelector('.side')?.classList.toggle('open');return;}
    if(action==='logout'){await api('/auth/logout',{method:'POST',data:{}});teachingClient.close();S.user=null;S.books=[];S.kp=null;showAuth();return;}
    if(action==='upload'){if(S.upload){toast('当前文件仍在传输，可在上传窗口取消。');return;}uploadModal();return;}
    if(action==='outline-toggle'){document.querySelector('.outline-panel')?.classList.toggle('open');return;}
    if(action==='speech'){speak();return;}
    if(action==='speech-stop'){stopSpeech();return;}
    if(action==='speech-pause'){if(speechSynthesis.paused)speechSynthesis.resume();else speechSynthesis.pause();return;}
    if(action==='reader-tab'){S.tab=node.dataset.tab;document.querySelectorAll('.reader-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===S.tab));await renderReader();return;}
    if(action==='knowledge-atlas'){await courseClient.openAtlas();return;}
    if(action==='personal-summary'){await courseClient.openSummary();return;}
    if(action==='teaching-pack'){await teachingClient.open();return;}
    if(action==='export-artifact'){const artifact=await api('/textbooks/'+idPath(S.book.id)+'/artifacts',{method:'POST',data:{title:S.book.title+' · 学习笔记'}});const anchor=document.createElement('a');anchor.href='/api/v1/artifacts/'+idPath(artifact.id)+'/download'+(node.dataset.format==='html'?'?format=html':'');anchor.download='';document.body.appendChild(anchor);anchor.click();anchor.remove();toast(node.dataset.format==='html'?'离线包已开始下载，打开后可使用浏览器打印为PDF。':'学习笔记已开始下载。');return;}
    if(action==='folder-new'){modal('<h2>整理你的教材</h2><form id="study-folder-form" class="stack"><label class="field-label">文件夹名称<input name="title" required maxlength="100"></label><button class="primary" type="submit">创建文件夹</button></form>');return;}
    if(action==='book-options'){modal(`<h2>管理教材</h2><form id="study-book-form" class="stack"><label class="field-label">教材名称<input name="title" value="${esc(S.book.title)}" maxlength="180" required></label><label class="field-label">文件夹<select name="folderId"><option value="">我的教材</option>${S.folders.map(f=>`<option value="${esc(f.id)}" ${S.book.folderId===f.id?'selected':''}>${esc(f.title||f.name)}</option>`).join('')}</select></label><div class="form-actions"><button type="button" class="danger" data-action="delete-book">删除教材…</button><button class="primary" type="submit">保存修改</button></div></form>`);return;}
    if(action==='delete-book'){modal(`<h2>删除“${esc(S.book.title)}”？</h2><p class="small muted">教材及其学习内容会从当前账户移除。此操作无法在界面撤销。</p><div class="form-actions"><button class="danger" data-action="delete-book-confirm">确认删除这本教材</button></div>`);return;}
    if(action==='delete-book-confirm'){await api('/textbooks/'+idPath(S.book.id),{method:'DELETE'});dialog.close();await refreshLists();link('/textbooks');return;}
    if(action==='parse-book'){const job=await api('/textbooks/'+idPath(S.book.id)+'/parse',{method:'POST',data:{ocr:action==='parse-ocr',ocrPages:5}});await watchJob(job,async()=>{await refreshLists();await rerenderCourse();toast('文档解析已完成，请核对目录和页码。');});return;}
    if(action==='resume-job'){const job=await api('/jobs/'+idPath(node.dataset.id)+'/resume',{method:'POST',data:{}});await watchJob(job,job.type==='summary'?()=>toast('学习总结已保存。'):render);return;}
    if(action==='cancel-job'){const job=await api('/jobs/'+idPath(node.dataset.id)+'/cancel',{method:'POST',data:{}});S.job=job;const box=document.getElementById('active-job');if(box)box.innerHTML=jobHtml(job);return;}
    if(action==='outline-edit'){openOutlineEditor();return;}
    if(action==='outline-add-chapter'){document.getElementById('outline-chapters').insertAdjacentHTML('beforeend',outlineChapter());return;}
    if(action==='outline-add-point'){node.closest('.outline-chapter').querySelector('.outline-points').insertAdjacentHTML('beforeend',outlinePoint());return;}
    if(action==='outline-remove-point'){node.closest('.outline-point').remove();return;}
    if(action==='outline-remove-chapter'){node.closest('.outline-chapter').remove();return;}
    if(action==='structure-book'){
      modal('<h2>把教材整理成学习路径</h2><p class="small muted">AI根据所选来源页提出章节与知识点，需你核对后确认。每次最多20页。</p><form id="study-structure-form" class="stack"><div class="form-columns"><label class="field-label">起始页<input name="startPage" type="number" min="1" data-page-bound max="3000" value="1" required></label><label class="field-label">结束页<input name="endPage" type="number" min="1" data-page-bound max="3000" value="'+Math.min(20,S.book.pageCount||S.kp?.sourceAnchor?.endPage||1)+'" required></label></div><button class="primary" type="submit">生成待核对提案</button></form>');return;
    }
    if(action==='parse-ocr'){
      const files=arr(await api('/textbooks/'+idPath(S.book.id)+'/files'));const file=files.find(f=>f.id===S.book.activeFileId)||files.at(-1);const knownCount=file?.pageCount||file?.pages?.length||S.book.pageCount||S.job?.result?.pageCount;const count=knownCount||studyLimits().pages;const first=file?.pendingPages?.[0]||1;
      modal('<h2>识别教材扫描页</h2><p class="small muted">'+(knownCount?'教材共 '+esc(knownCount)+' 页。':'页数将在处理文件后确认。')+'请选择本课需要的页码，每次最多5页；文字在本机识别。'+(file?.pendingPages?.length?'还有 '+esc(file.pendingPages.length)+' 页没有文字。':'')+'</p>'+(file?.blockedPages?.length?'<p class="hint">部分页的图像超出处理范围，请先将对应页面缩小后重新导入，或选择其他页。</p>':'')+'<form id="study-ocr-form" class="stack"><div class="form-columns"><label class="field-label">起始页<input name="startPage" type="number" min="1" max="'+count+'" value="'+first+'" required></label><label class="field-label">结束页<input name="endPage" type="number" min="1" max="'+count+'" value="'+Math.min(first+4,count)+'" required></label></div><label class="field-label">识别语言<select name="ocrLanguage"><option value="chi_sim">简体中文</option><option value="eng">English</option></select></label><p class="small muted">识别后请对照原件核对公式、符号和页码。其余页可稍后继续识别。</p><button class="primary" type="submit">开始本机识别</button></form>');return;
    }
    if(action==='generate-lesson'){const job=await api('/knowledge-points/'+idPath(S.kp.id)+'/lesson',{method:'POST',data:{style:S.preferences.teachingStyle||'default'}});await watchJob(job,async()=>{S.lessonVersions=arr(await api('/knowledge-points/'+idPath(S.kp.id)+'/lesson'));S.lesson=S.lessonVersions.at(-1)||null;S.tab='lesson';await renderReader();toast('讲解已保存，请对照教材核查。');});return;}
    if(action==='generate-exercises'){const job=await api('/knowledge-points/'+idPath(S.kp.id)+'/exercises',{method:'POST',data:{type:node.dataset.type,count:node.dataset.type==='choice'?3:2}});await watchJob(job,async()=>{S.exercise=null;await showExercises();});return;}
    if(action==='grade-attempt'){const attemptId=S.attempt.id,exerciseId=S.exercise.id;const job=await api('/attempts/'+idPath(attemptId)+'/grade',{method:'POST',data:{}});if(S.attempt?.id!==attemptId||S.exercise?.id!==exerciseId)return;S.attempt.gradingJobId=job.id;S.attempt.status='grading';showAttemptSummary();await watchJob(job,async()=>{const fresh=await api('/attempts/'+idPath(attemptId));if(S.attempt?.id!==attemptId||S.exercise?.id!==exerciseId)return;S.attempt=fresh;showAttemptSummary();});return;}
    if(action==='reveal-attempt'){await showAttemptReveal();return;}
    if(action==='mark-learned'){await api('/knowledge-points/'+idPath(S.kp.id)+'/progress',{method:'PATCH',data:{status:S.kp.progress==='mastered'?'learning':'mastered'}});await rerenderCourse();return;}
    if(action==='original-file'){const files=arr(await api('/textbooks/'+idPath(S.book.id)+'/files'));const file=files.find(f=>f.id===S.kp?.sourceAnchor?.fileId)||files[files.length-1];if(!file)throw new Error('没有可打开的原文件');window.open('/api/v1/files/'+idPath(file.id)+'/download','_blank','noopener');return;}
    if(action==='jump-note'){
      const note=arr(await api('/highlights')).find(n=>n.id===node.dataset.id);if(!note)throw new Error('笔记已不存在');
      S.pendingNote=note;S.preferredConversationId=note.conversationId||null;S.preferredAttemptId=note.attemptId||null;
      S.tab=note.sourceKind==='exercise'?'exercises':note.sourceKind==='lesson'?'lesson':'source';
      const target=note.workshopId?'/workshops/'+idPath(note.workshopId):'/textbook/'+idPath(note.textbookId)+'/kp/'+idPath(note.knowledgePointId||note.sourceId);
      if(location.hash==='#'+target)await render();else link(target);return;
    }
    if(action==='note-edit'){modal(`<h2>更新理解</h2><form id="study-note-form" data-id="${esc(node.dataset.id)}" class="stack"><label class="field-label">笔记<textarea name="note" maxlength="6000" rows="5">${esc(node.dataset.note||'')}</textarea></label><button class="primary" type="submit">保存笔记</button></form>`);return;}
    if(action==='note-delete'){await api('/highlights/'+idPath(node.dataset.id),{method:'DELETE'});await showNotes();return;}
    if(action==='workshop-new'){workshopForm();return;}
    if(action==='workshop-links'){workshopForm(S.workshop);return;}
    if(action==='workshop-material'){
      modal('<h2>添加课题材料</h2><form id="study-material-form" class="stack"><label class="field-label">资料名称<input name="name" maxlength="180" required></label><label class="field-label">粘贴资料正文<textarea name="text" rows="5" maxlength="30000" placeholder="最多30,000字；粘贴讲义、问题或阅读资料，或选择下方文件…"></textarea></label><label class="field-label">或上传资料文件<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.md,.markdown"><span class="small muted">每个课题最多10份文件；PDF/PNG/JPG≤30MiB，Markdown≤5MiB。扫描识别需本机OCR语言包。</span></label><label class="field-label">图片识别语言<select name="ocrLanguage"><option value="chi_sim">简体中文</option><option value="eng">English</option></select></label><p class="upload-status" id="material-upload-status" role="status"></p><button class="primary" type="submit">添加并处理材料</button></form>');return;
    }
    if(action==='workshop-file-delete'){await api('/files/'+idPath(node.dataset.id),{method:'DELETE'});await render();return;}
    if(action==='workshop-file-preview'){
      const file=S.workshopFiles.find(item=>item.id===node.dataset.id);if(!file)throw new Error('文件已不存在');
      const url='/api/v1/files/'+idPath(file.id)+'/preview';
      if(file.mime==='application/pdf')modal('<h2>'+esc(file.name)+'</h2><iframe class="pdf-frame" title="课题PDF预览" src="'+url+'"></iframe><p class="small"><a target="_blank" rel="noopener" href="/api/v1/files/'+idPath(file.id)+'/download">下载原文件</a></p>');
      else if(file.mime?.startsWith('image/'))modal('<h2>'+esc(file.name)+'</h2><img src="'+url+'" alt="'+esc(file.name)+'" style="max-width:100%;height:auto"><p class="small muted">识别文字需核对原图。</p>');
      else{const data=await api('/files/'+idPath(file.id)+'/content?page=1');modal('<h2>'+esc(file.name)+'</h2><pre class="markdown-preview small">'+esc(data.page?.text||data.page||'')+'</pre>');}return;
    }
    if(action==='workshop-file-parse'){
      const file=S.workshopFiles.find(item=>item.id===node.dataset.id);if(!file)throw new Error('文件已不存在');
      modal('<h2>处理资料：'+esc(file.name)+'</h2><form id="study-material-parse-form" data-file-id="'+esc(file.id)+'" class="stack"><label class="field-label">识别语言<select name="ocrLanguage"><option value="chi_sim">简体中文</option><option value="eng">English</option></select></label><label class="small"><input name="ocr" type="checkbox" '+(file.mime?.startsWith('image/')?'checked':'')+'> 扫描资料使用本机OCR</label><div class="form-columns"><label class="field-label">起始页<input name="startPage" type="number" min="1" data-page-bound max="3000" value="1" required></label><label class="field-label">结束页<input name="endPage" type="number" min="1" data-page-bound max="3000" value="'+Math.min(5,file.pageCount||1)+'" required></label></div><p class="small muted">文字PDF可直接解析全文；OCR每次最多5页，未完成页会保留待处理状态。</p><button class="primary" type="submit">开始处理</button></form>');return;
    }
    if(action==='material-delete'){await api('/workshops/'+idPath(S.workshop.id)+'/materials/'+idPath(node.dataset.id),{method:'DELETE'});await render();return;}
    if(action==='conversation-new'){modal('<h2>开始一轮新讨论</h2><form id="study-new-conversation-form" class="stack"><label class="field-label">讨论主题<input name="title" maxlength="160" required placeholder="这次想弄明白什么？"></label>'+(S.workshop&&!S.book?'<label class="field-label">讨论方式<select name="persona"><option value="default">材料讨论</option><option value="exercise_explainer">习题讲解</option></select></label>':'')+'<button class="primary" type="submit">开始讨论</button></form>');return;}
    if(action==='message-source'){
      const id=node.dataset.id,kind=node.dataset.kind;
      if(kind==='knowledgePoints'){const point=await api('/knowledge-points/'+idPath(id));modal('<h2>'+esc(point.title)+'</h2><p class="small muted">来源第'+esc(point.sourceAnchor.startPage)+'–'+esc(point.sourceAnchor.endPage)+'页，修订'+esc(point.revision)+'</p><pre class="markdown-preview small">'+esc(point.sourceText)+'</pre>');}
      else if(kind==='fileRecords'){const data=await api('/files/'+idPath(id)+'/content?page='+idPath(node.dataset.page||1));modal('<h2>来源页核对</h2><p class="small muted">以下为实际提取文字，OCR结果需对照原件。</p><pre class="markdown-preview small">'+esc(data.page?.text||'')+'</pre>');}
      else{const material=S.workshopMaterials?.find(m=>m.id===id);if(!material)throw new Error('材料已移除或当前不可读');modal('<h2>'+esc(material.name||material.title)+'</h2><pre class="markdown-preview small">'+esc(material.text||material.content||'')+'</pre>');}return;
    }
    if(action==='regenerate-message'){const job=await api('/conversations/'+idPath(S.conversation.id)+'/messages/'+idPath(node.dataset.id)+'/regenerate',{method:'POST',data:{}});await watchJob(job,showMessages);return;}
    if(action==='feedback'){modal('<h2>反馈与建议</h2><form id="study-feedback-form" class="stack"><label class="field-label">遇到了什么问题？<textarea name="content" rows="5" maxlength="4000" required></textarea></label><button class="primary" type="submit">保存反馈</button></form>');return;}
    if(action==='membership'){const [quota,skus]=await Promise.all([api('/users/me/quota'),api('/membership/skus')]);modal(`<h2>学习服务状态</h2><p class="small">${S.config.modelConfigured?'模型服务已配置。':'模型未配置：可先使用文档解析、目录和笔记。'}</p><div class="hint">短信与支付尚未配置，不会创建实际收费订单或承诺会员权益。</div><p class="small muted" style="margin-top:20px">当前本机服务配额记录</p><p class="small">已保存教材：${esc(quota.counts?.textbooks??0)} 本<br>当前采用本机账户与文件存储；模型服务由运营者配置。<br>此处没有接入真实会员计费。</p>`);return;}
  }

  root.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;button.disabled=true;perform(action,button).catch(error=>toast(error.message,true)).finally(()=>{if(button.isConnected)button.disabled=false;});});
  dialog.addEventListener('close',()=>{if(S.upload)S.upload.abort();});
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button){button.disabled=true;perform(button.dataset.action,button).catch(error=>toast(error.message,true)).finally(()=>{if(button.isConnected)button.disabled=false;});}});
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.id.startsWith('study-'))return;event.preventDefault();const button=form.querySelector('[type=submit]');if(button?.disabled)return;if(button)button.disabled=true;const values=Object.fromEntries(new FormData(form));
    try{
      if(form.id==='study-auth-form'){const data=await api(S.signup?'/auth/register':'/auth/login-password',{method:'POST',data:values});S.user=data.user;S.preferences=data.preferences||{};applyPreferences();await refreshLists();await render();}
      else if(form.id==='study-upload-form'){
        const file=values.file;const pdf=/\.pdf$/i.test(file.name);if(!file.size||!(/\.(pdf|md|markdown)$/i.test(file.name)))throw new Error('请选择PDF或Markdown教材');if(file.size>(pdf?studyLimits().textbookBytes:studyLimits().markdownBytes))throw new Error('文件超过页面所示上限');
        const status=document.getElementById('upload-status');const book=await api('/textbooks',{method:'POST',data:{title:values.title,folderId:values.folderId||null}});await uploadFile(book.id,file,text=>status.textContent=text);status.textContent='文件接收完成，正在创建解析任务…';const job=await api('/textbooks/'+idPath(book.id)+'/parse',{method:'POST',data:{}});dialog.close();await refreshLists();history.replaceState(null,'','#/textbook/'+idPath(book.id));await render();await watchJob(job,async()=>{await refreshLists();await rerenderCourse();});
      }
      else if(form.id==='study-folder-form'){await api('/folders',{method:'POST',data:{name:values.title}});dialog.close();await refreshLists();library();}
      else if(form.id==='study-book-form'){await api('/textbooks/'+idPath(S.book.id),{method:'PATCH',data:{title:values.title,folderId:values.folderId||null}});dialog.close();await refreshLists();await rerenderCourse();}
      else if(form.id==='study-outline-form'){const data=readOutlineForm(form);await api('/textbooks/'+idPath(S.book.id)+'/outline',{method:'PATCH',data});dialog.close();await rerenderCourse();toast('目录已保存。');}
      else if(form.id==='study-structure-form'){
        const job=await api('/textbooks/'+idPath(S.book.id)+'/structure',{method:'POST',data:{startPage:Number(values.startPage),endPage:Number(values.endPage)}});dialog.close();await watchJob(job,async result=>{const proposal=await api('/artifacts/'+idPath(result.result.id));openOutlineEditor(mergeCourseProposal(proposal),proposal.partial?'这份提案只覆盖第'+proposal.startPage+'–'+proposal.endPage+'页。所选范围以外的章节与知识点已保留，跨范围章节保留原页码。请核对这次新增的知识点，再确认保存。':'这是一份AI提案，尚未改变你的目录。请对照教材确认知识点与来源页码。');});
      }
      else if(form.id==='study-ocr-form'){
        const job=await api('/textbooks/'+idPath(S.book.id)+'/parse',{method:'POST',data:{ocr:true,ocrPages:5,ocrLanguage:values.ocrLanguage,startPage:Number(values.startPage),endPage:Number(values.endPage)}});dialog.close();await watchJob(job,async result=>{await rerenderCourse();toast(result.result?.partial?'所选页已识别，教材仍有待处理页。':'识别完成，请核对教材文字。');});
      }
      else if(form.id==='study-settings-form'){S.preferences=await api('/users/me/preferences',{method:'PATCH',data:{...values,fontScale:Number(values.fontScale)}});applyPreferences();toast('学习偏好已保存。');}
      else if(form.id==='study-note-form'){await api('/highlights/'+idPath(form.dataset.id),{method:'PATCH',data:values});dialog.close();await showNotes();}
      else if(form.id==='study-workshop-form'||form.id==='study-workshop-edit-form'){
        const editing=form.id==='study-workshop-edit-form',data={title:values.title,description:values.description,linkedTextbookIds:new FormData(form).getAll('linkedTextbookIds'),...(editing?{expectedRevision:Number(form.dataset.revision)}:{})};
        const workshop=await api(editing?'/workshops/'+idPath(S.workshop.id):'/workshops',{method:editing?'PATCH':'POST',data});dialog.close();await refreshLists();if(editing)await render();else link('/workshops/'+idPath(workshop.id));
      }
      else if(form.id==='study-material-form'){
        if(values.file?.size){
          const file=values.file;const limit=/\.(md|markdown)$/i.test(file.name)?5:30;if(file.size>limit*1024*1024)throw new Error('文件超过材料上限');
          const record=await uploadFile(S.workshop.id,file,text=>document.getElementById('material-upload-status').textContent=text,'workshops');
          const image=/\.(png|jpg|jpeg)$/i.test(file.name);const job=await api('/workshops/'+idPath(S.workshop.id)+'/files/'+idPath(record.id)+'/parse',{method:'POST',data:{ocr:image,ocrPages:5,ocrLanguage:values.ocrLanguage}});
          dialog.close();await watchJob(job,async()=>{await render();toast('材料已处理，请核对提取文字。');});
        }else{if(!String(values.text||'').trim())throw new Error('请粘贴正文或选择材料文件');await api('/workshops/'+idPath(S.workshop.id)+'/materials',{method:'POST',data:{name:values.name,text:values.text}});dialog.close();await render();}
      }
      else if(form.id==='study-material-parse-form'){
        const job=await api('/workshops/'+idPath(S.workshop.id)+'/files/'+idPath(form.dataset.fileId)+'/parse',{method:'POST',data:{ocr:values.ocr==='on',ocrPages:5,ocrLanguage:values.ocrLanguage,startPage:Number(values.startPage),endPage:Number(values.endPage)}});dialog.close();await watchJob(job,render);
      }
      else if(form.id==='study-new-conversation-form'){
        const base=S.book?'/textbooks/'+idPath(S.book.id):'/workshops/'+idPath(S.workshop.id);const session=await api(base+'/conversations',{method:'POST',data:{title:values.title,...(S.kp?{knowledgePointId:S.kp.id}:{}),...(!S.book?{persona:values.persona}:{})}});S.preferredConversationId=session.id;dialog.close();await render();
      }
      else if(form.id==='study-chat-form'){
        if(!S.conversation){const base=S.book?'/textbooks/'+idPath(S.book.id):'/workshops/'+idPath(S.workshop.id);S.conversation=await api(base+'/conversations',{method:'POST',data:{title:values.content.slice(0,60),knowledgePointId:S.kp?.id}});}
        const job=await api('/conversations/'+idPath(S.conversation.id)+'/messages',{method:'POST',data:{content:values.content,knowledgePointId:S.kp?.id}});form.querySelector('textarea').value='';await showMessages();await watchJob(job,showMessages);
      }
      else if(form.id==='study-exercise-form'){const attemptKey=draftKey()+':submission';let submission;try{submission=JSON.parse(localStorage.getItem(attemptKey)||'null');}catch{}const serialized=JSON.stringify(values);if(!submission||submission.answers!==serialized)submission={id:crypto.randomUUID(),answers:serialized};localStorage.setItem(attemptKey,JSON.stringify(submission));S.attempt=await api('/exercises/'+idPath(S.exercise.id)+'/attempts',{method:'POST',data:{answers:values,clientAttemptId:submission.id}});S.preferredAttemptId=S.attempt.id;localStorage.removeItem(draftKey());localStorage.removeItem(attemptKey);await showExercises();}
      else if(form.id==='study-feedback-form'){await api('/feedbacks',{method:'POST',data:{title:'学习空间反馈',content:values.content}});dialog.close();toast('反馈已保存在当前服务。');}
    }catch(error){if(error.code==='STALE_VIEW')return;if(form.id==='study-auth-form')document.getElementById('auth-error').textContent=error.message;else toast(error.message,true);}finally{if(button?.isConnected)button.disabled=false;}
  });
  root.addEventListener('input',event=>{
    if(event.target.closest('#study-exercise-form')){try{localStorage.setItem(draftKey(),JSON.stringify(Object.fromEntries(new FormData(event.target.closest('form')))));}catch{}}
    if(event.target.id==='book-search')filterBooks();
  });
  root.addEventListener('change',event=>{if(event.target.id==='attempt-history-select'){S.preferredAttemptId=event.target.value;showExercises().catch(error=>toast(error.message,true));}if(event.target.id==='chat-session-select'){S.preferredConversationId=event.target.value;S.conversation=S.currentConversations.find(session=>session.id===event.target.value)||null;showMessages().catch(error=>toast(error.message,true));}if(event.target.id==='book-folder-filter')filterBooks();if(event.target.id==='exercise-version-select'){S.preferredAttemptId=null;S.exercise=S.exerciseSets.find(item=>item.id===event.target.value)||null;showExercises().catch(error=>toast(error.message,true));}if(event.target.id==='lesson-version-select'){S.lesson=S.lessonVersions.find(l=>l.id===event.target.value)||null;stopSpeech();renderReader().catch(error=>toast(error.message,true));}});
  function filterBooks(){const query=document.getElementById('book-search').value.toLocaleLowerCase(),folder=document.getElementById('book-folder-filter').value;document.getElementById('book-grid').innerHTML=S.books.filter(book=>(!folder||book.folderId===folder)&&book.title.toLocaleLowerCase().includes(query)).map(bookCard).join('')+'<button class="add-card" data-action="upload"><span>＋ 添加教材</span></button>';}
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&event.target.closest('#study-chat-form')){event.preventDefault();event.target.closest('form').requestSubmit();}});
  window.addEventListener('hashchange',()=>{dialog.close();document.getElementById('dialog-content').replaceChildren();render();});window.addEventListener('pagehide',stopSpeech);document.addEventListener('visibilitychange',()=>{if(document.hidden&&window.speechSynthesis)speechSynthesis.pause();});
  (async()=>{
    try{S.config=await api('/config/public');const account=await api('/users/me');S.user=account.user;S.preferences=account.preferences||{};applyPreferences();await refreshLists();await render();}
    catch(error){if(error.status&&error.status!==401)toast(error.message,true);showAuth();}
  })();
})();
