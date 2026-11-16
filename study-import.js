/* Durable chapter-centred book import. The server owns all work and progress. */
(function (scope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope && scope.document) scope.StudyImport = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ACTIVE = new Set(['queued', 'running', 'cancelling', 'cancel_requested']);
  const PHASES = { extracting:'读取教材文字', ocr:'自动识别扫描页', outline:'识别教材目录', knowledge:'按章萃取知识点', research:'检索补充解析与讨论', lessons:'按章准备讲义', ready:'本次处理已结束', partial:'本次处理已结束，仍有项目待核对', 'awaiting-outline-review':'教材目录待核对', 'budget-paused':'本次使用额度已到上限' };
  const CHAPTER_STATUS = { pending:'等待处理', extracting:'读取本章材料', structuring:'萃取知识点', structured:'课程结构已完成', preparing:'准备本章讲义', ready:'可以学习', failed:'本章尚未完成', deferred:'本次未选择' };
  const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const optionsOf = job => ({ scope:'all', prepareLessons:'all', ocrLanguage:'chi_sim', maxModelCalls:100, externalResearch:'auto', ...(job?.payload?.options || {}) });
  function describeImport(job) {
    const data = job?.import || {}, raw = data.counts || {}, options = optionsOf(job);
    const counts = Object.fromEntries(['totalPages','readablePages','ocrAttemptedPages','totalChapters','targetChapters','structuredChapters','readyChapters','modelCalls'].map(key => [key, safeCount(raw[key])]));
    const chapters = Array.isArray(data.chapters) ? data.chapters : [];
    const active = ACTIVE.has(job?.status), allScope = options.scope === 'all';
    const selectedIds=new Set(Array.isArray(options.chapterIds)?options.chapterIds:[]);
    const targets=chapters.filter(chapter=>allScope ? true : selectedIds.size ? selectedIds.has(chapter.id) : chapter.selected!==false&&chapter.status!=='deferred');
    const targetTotal=allScope?counts.totalChapters:counts.targetChapters||selectedIds.size||targets.length;
    const targetStructured=!allScope?targets.filter(chapter=>['structured','preparing','ready'].includes(chapter.status)).length:counts.structuredChapters;
    const targetReady=!allScope?targets.filter(chapter=>chapter.status==='ready').length:counts.readyChapters;
    const goalCounts={totalChapters:targetTotal,structuredChapters:targetStructured,readyChapters:targetReady};
    const structureComplete = targetTotal > 0 && targetStructured >= targetTotal;
    const pageReview = allScope && counts.totalPages > 0 && counts.readablePages < counts.totalPages;
    const coveragePartial = data.partial === true || job?.result?.partial === true || data.coverage?.partial === true || targets.some(chapter => chapter.coverage?.partial === true);
    const lessonGoalComplete = options.prepareLessons === 'none' || (options.prepareLessons === 'first-chapter' ? targetReady >= 1 : targetTotal > 0 && targetReady >= targetTotal);
    const ready = job?.status === 'completed' && data.phase === 'ready' && structureComplete && lessonGoalComplete && counts.totalPages > 0 && !pageReview && !coveragePartial;
    let title = PHASES[data.phase] || '等待服务端确认进度', detail = '已完成的章节与讲义会保留，可以先进入可学习的章节。';
    if (!job) { title = '让整本教材成为可学习的课程'; detail = '自动识别教材目录，按真实章节萃取知识点，并按你的选择准备讲义。'; }
    else if (job.status === 'queued') title = '整书导入已排队';
    else if (job.status === 'cancelling' || job.status === 'cancel_requested') title = '正在取消，保留已完成内容';
    else if (job.status === 'cancelled') title = '本次导入已取消';
    else if (data.phase === 'awaiting-outline-review') { title = '教材目录待核对'; detail = '尚未取得可靠的章节目录。请核对真实章节后继续，不会把固定页数分片当成章节。'; }
    else if (data.phase === 'budget-paused') { title = '处理已暂停，已完成内容保留'; detail = '本次或今日使用额度不足；请查看原因，再从未完成处继续。'; }
    else if (job.status === 'interrupted') title = '处理已中断，可以继续';
    else if (job.status === 'failed') title = '本次处理未完成';
    else if (ready) {
      title = options.prepareLessons === 'none' ? (allScope ? '全书课程结构已完成' : '所选章节结构已完成') : options.prepareLessons === 'first-chapter' ? '课程结构与首章讲义已准备' : (allScope ? '全书课程已就绪' : '所选章节已就绪');
      detail = options.prepareLessons === 'none' ? '本次只建立课程结构，讲义可以在学习时按需生成。AI归纳的目录与内容仍需对照教材核对。' : '本次目标已完成。AI归纳与讲义需要对照教材核对，不代表已完成学习。';
    } else if (job.status === 'completed') { title = `本次处理已结束，${counts.readyChapters}章可用`; detail = '仍有页面或章节待核对；可用成果已保留。尚无文字的页不自动认定为空白页，请结合原件与章节状态核对。'; }
    const endedForReview=job?.status==='completed'&&!ready;
    const steps = [
      { label:'识别教材目录', detail:'自动读取文字与扫描页', state:counts.totalChapters > 0 && data.phase !== 'awaiting-outline-review' ? 'done' : ['extracting','ocr','outline'].includes(data.phase) && active ? 'active' : 'pending' },
      { label:'按章萃取知识点', detail:'保留真实章名与来源', state:structureComplete ? 'done' : ['knowledge','research'].includes(data.phase) && active ? 'active' : 'pending' },
      { label:'按章准备讲义', detail:options.prepareLessons === 'none' ? '本次未开启，按需生成' : options.prepareLessons === 'first-chapter' ? '本次先准备首章' : '准备本次范围内全部讲义', state:options.prepareLessons === 'none' ? 'skipped' : lessonGoalComplete && structureComplete ? 'done' : data.phase === 'lessons' && active ? 'active' : 'pending' },
      { label:endedForReview?'处理结束 · 待核对':allScope ? '全书目标就绪' : '所选章节就绪', detail:ready ? '可开始学习，内容仍需核对' : endedForReview?'可用章节已保留，请核对未完成项':'完成状态由服务端确认', state:ready ? 'done' : endedForReview?'review':'pending' }
    ];
    return { title, detail, phase:data.phase, counts, goalCounts, options, chapters, active, ready, endedForReview, partial:!!job && !ready, pageReview, coveragePartial, steps, canContinue:!!job && ['failed','cancelled','interrupted'].includes(job.status), needsOutline:data.phase === 'awaiting-outline-review' };
  }
  function install({ api, getContext, notify = () => {}, navigate = () => {}, onUpdate = () => {} } = {}) {
    if (typeof api !== 'function' || typeof getContext !== 'function') throw new TypeError('Import panel requires api and getContext');
    const doc = document, dialog = doc.createElement('dialog');
    dialog.id = 'import-dialog'; dialog.className = 'import-dialog'; dialog.setAttribute('aria-labelledby', 'import-title'); doc.body.append(dialog);
    const outlet=doc.createElement('section');outlet.className='import-outlet';dialog.append(outlet);
    const entries = new Map(); let view = null, serial = 0, disposed = false;
    const owner = () => getContext()?.userId;
    const stamp = () => JSON.stringify([owner(), getContext()?.epoch]);
    const owned = entry => !disposed && !!owner() && entry.userId === owner() && entries.get(entry.bookId) === entry;
    const visible = entry => owned(entry) && view?.entry === entry && view.stamp === stamp() && view.route===window.location.hash && (view.mode==='page'?outlet.isConnected:dialog.open);
    function el(tag, className, text, parent) { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; parent?.append(node); return node; }
    function button(text, action, parent, className = '') { const node = el('button', className, text, parent); node.type = 'button'; node.dataset.importAction = action; if(action==='close')node.setAttribute('aria-label','关闭整书处理');return node; }
    function fresh(bookId) {
      if(disposed)throw new Error('导入工作区已销毁，请重新加载。');
      if (typeof bookId !== 'string' || !bookId || bookId.length > 100) throw new TypeError('A textbook ID is required');
      if (!owner()) throw new Error('请先登录后导入教材。');
      let entry = entries.get(bookId);
      if (!entry || entry.userId !== owner()) { const context = getContext(); entry = {bookId,userId:owner(),job:null,book:context.book?.id === bookId ? context.book : null,chapters:[],timer:null,polling:false,request:0,operation:0,busy:false,error:null,networkFailures:0}; entries.set(bookId, entry); }
      return entry;
    }
    function close() { serial++; view = null; if (dialog.open) dialog.close(); outlet.replaceChildren();outlet.className='import-outlet';dialog.append(outlet); }
    function show(entry,host) {
      entry.request++;entry.metadataRequest=(entry.metadataRequest||0)+1;
      close(); view = {entry,token:++serial,stamp:stamp(),route:window.location.hash,mode:host?'page':'modal',lastAnnouncement:'',chapterKey:'',warningKey:'',setupKey:'',bookKey:'',returnFocus:doc.activeElement};
      outlet.className='import-outlet'+(host?' import-page':'');if(host)host.replaceChildren(outlet);
      const head = el('header','import-heading',undefined,outlet), titleBox = el('div','',undefined,head);
      el('p','import-eyebrow','YOUR BOOK · ONE COMPLETE COURSE',titleBox); const title = el(host?'h1':'h2','',host?'把教材变成你的课程':'一键解析全书',titleBox); title.id = 'import-title';
      const subtitle = el('p','import-book-title',entry.book?.title || '教材导入',titleBox); subtitle.id = 'import-book-title'; if(host){const back=el('a','import-back','返回教材 →',head);back.href='#/textbook/'+encodeURIComponent(entry.bookId);}else button('×','close',head,'import-close');
      const body = el('div','import-body'+(host?' import-page-layout':''),undefined,outlet);
      if(host)el('aside','import-book-panel',undefined,body).id='import-book-panel';
      const main=host?el('main','import-page-main',undefined,body):body;
      if(host)el('ol','import-stages',undefined,main).id='import-stages';
      const status = el('section','import-status',undefined,main); status.id='import-status';
      el('span','import-status-mark','↗',status); const copy=el('div','import-status-copy',undefined,status); el('h3','',undefined,copy).id='import-summary'; el('p','',undefined,copy).id='import-description';
      const announced=el('p','sr-only','',main);announced.id='import-announcement';announced.setAttribute('role','status');announced.setAttribute('aria-live','polite');
      if(!host)el('ol','import-stages',undefined,main).id='import-stages';
      const progress=el('section','import-progress',undefined,main), row=el('div','import-progress-heading',undefined,progress);el('h3','','章节进度',row);el('span','',undefined,row).id='import-chapter-count';
      const bar=el('progress','',undefined,progress);bar.id='import-progress-bar';bar.setAttribute('aria-label','已完成课程结构的章节');
      el('p','import-current',undefined,progress).id='import-current';el('p','import-technical',undefined,progress).id='import-page-count';
      el('div','import-alerts',undefined,main).id='import-alerts';
      const section=el('section','import-chapters',undefined,main);el('h3','','教材章节',section);el('div','import-chapter-list',undefined,section).id='import-chapters';
      const setup=el('details','import-setup',undefined,body);setup.id='import-setup';el('summary','',host?'讲义设置':'处理范围与选项',setup);el('div','',undefined,setup).id='import-options';
      const footer=el('footer','import-footer',undefined,outlet);el('p','',undefined,footer).id='import-persistence';el('div','import-actions',undefined,footer).id='import-actions';
      if(!host)dialog.showModal(); render(entry); return view.token;
    }
    const slot = id => outlet.querySelector('#' + id);
    function renderSetup(entry, model) {
      if(view.formDirty)return;
      const key=JSON.stringify([entry.job?.id,entry.chapters.map(c=>[c.id,c.title]),model.options,entry.researchConfigured]);if(view.setupKey===key)return;view.setupKey=key;
      const host=slot('import-options');host.replaceChildren(); const form=el('form','import-options-form',undefined,host);form.id='import-options-form';
      function select(label,name,choices,value){const wrap=el('label','import-field',label,form),node=el('select','',undefined,wrap);node.name=name;for(const [id,text]of choices){const option=el('option','',text,node);option.value=id;}node.value=value;return node;}
      select('处理范围','scope',[['all','全书所有章节'],['chapters','选择已有目录中的章节']], model.options.scope);
      const scopeBox=el('fieldset','import-scope',undefined,form);scopeBox.id='import-scope';el('legend','','选择真实教材章节',scopeBox);
      for(const chapter of entry.chapters){const label=el('label','',undefined,scopeBox),checkbox=el('input','',undefined,label);checkbox.type='checkbox';checkbox.name='chapterIds';checkbox.value=chapter.id;checkbox.checked=(model.options.chapterIds||[]).includes(chapter.id);el('span','',chapter.title,label);}
      if(!entry.chapters.length)el('p','import-help','尚无可选择的目录。整书导入会先识别目录；如不能可靠识别，会请你核对。',scopeBox);scopeBox.hidden=model.options.scope!=='chapters';
      select('讲义准备','prepareLessons',[['all','准备全部章节讲义'],['first-chapter','先准备第一章讲义'],['none','只建立课程结构，讲义按需生成']], model.options.prepareLessons);
      select('扫描识别语言','ocrLanguage',[['chi_sim','中文'],['eng','English']], model.options.ocrLanguage);
      select('公开补充资料','externalResearch',[['auto','配置可用时检索并综合'],['off','关闭，仅使用教材来源']],model.options.externalResearch);
      el('p','import-help import-research-help',entry.researchConfigured===false?'当前未配置公开检索服务，将跳过外部补充，不会虚构研究结果。':'外部补充仅发送公开书名、章名与知识点标题。未配置检索服务时自动跳过；AI综合与教材来源分别核对。',form);
      const budget=el('label','import-field','本次AI请求上限',form),input=el('input','',undefined,budget);input.type='number';input.name='maxModelCalls';input.min='1';input.max='200';input.step='1';input.required=true;input.value=String(model.options.maxModelCalls);
      el('p','import-help','扫描页自动在本机识别。AI请求上限是本次处理边界，不是金额；达到上限会保留成果并暂停。',form);
      const submit=el('button','primary',entry.job?'按所选范围开始处理':'一键解析全书',form);submit.type='submit';submit.disabled=model.active||entry.busy;
      slot('import-setup').open=view.mode==='page'||!entry.job;
    }
    function renderBook(entry,model){
      const host=slot('import-book-panel');if(!host)return;
      const chapters=model.chapters.length?model.chapters:entry.chapters,key=JSON.stringify([entry.book?.title,entry.book?.coverAvailable,entry.book?.activeFileId,chapters.map(c=>[c.id,c.title,c.startPage,c.endPage])]);if(view.bookKey===key)return;view.bookKey=key;host.replaceChildren();
      const cover=el('div','import-book-cover',undefined,host),fallback=el('div','import-cover-placeholder',undefined,cover);el('span','','教材',fallback);el('strong','',entry.book?.title||'我的教材',fallback);el('small','','从原文出发，建立自己的课程',fallback);
      if(entry.book?.coverAvailable){const img=el('img','',undefined,cover);img.alt='当前教材PDF物理第一页';img.src='/api/v1/textbooks/'+encodeURIComponent(entry.bookId)+'/cover';img.loading='lazy';img.addEventListener('load',()=>{fallback.hidden=true;});img.addEventListener('error',()=>{img.remove();fallback.hidden=false;});}
      el('h3','',entry.book?.title||'教材导入',host);el('p','import-book-caption',entry.book?.coverAvailable?'PDF原件 · 物理第一页缩略图':'教材原件 · 封面不可用时显示文字占位',host);
      const directory=el('section','import-directory',undefined,host);el('h3','','教材目录',directory);el('p','import-help',model.needsOutline?'目录尚待核对':'当前实际识别结果',directory);
      const list=el('ol','',undefined,directory);for(const chapter of chapters){const li=el('li','',undefined,list);el('strong','',chapter.title||'待核对章节',li);if(chapter.startPage&&chapter.endPage)el('span','',`${chapter.startPage}–${chapter.endPage} 页`,li);}if(!chapters.length)el('p','import-help','目录识别后显示真实章节；不会用固定页块充当章名。',directory);
    }
    function render(entry) {
      if (!visible(entry)) return;
      const model=describeImport(entry.job);slot('import-book-title').textContent=view.mode==='page'?'导入教材，自动识别目录、梳理知识点并生成可教学的讲义。':entry.book?.title||'教材导入';slot('import-summary').textContent=model.title;slot('import-description').textContent=model.detail;renderBook(entry,model);
      slot('import-persistence').textContent=model.active?'关闭面板不会取消任务；本机服务运行时会继续处理。':entry.job?'已完成内容会保留，可以核对后继续处理或先开始学习。':'开始后可以关闭面板，正在执行的任务会在本机继续。';
      slot('import-status').dataset.state=model.ready?'ready':entry.job&&!model.active?'attention':'working';
      const announcement=[entry.job?.id,entry.job?.status,model.phase,model.title].join(':');if(view.lastAnnouncement!==announcement){slot('import-announcement').textContent=model.title;view.lastAnnouncement=announcement;}
      const steps=view.mode==='page'?model.steps.slice(0,3):model.steps,stages=slot('import-stages');if(stages.dataset.key!==JSON.stringify(steps)){stages.dataset.key=JSON.stringify(steps);stages.replaceChildren();steps.forEach((step,index)=>{const item=el('li','import-stage',undefined,stages);item.dataset.state=step.state;item.setAttribute('aria-label',step.label+'：'+({done:'已完成',active:'处理中',skipped:'本次不启用',pending:'等待处理',review:'待核对'}[step.state]||'等待确认'));el('span','import-stage-number',step.state==='done'?'✓':String(index+1),item);const copy=el('div','',undefined,item);el('strong','',step.label,copy);el('small','',step.detail,copy);});}
      const c=model.counts,g=model.goalCounts;slot('import-chapter-count').textContent=entry.job?`${g.structuredChapters} / ${g.totalChapters||'—'} 个目标章已建立结构 · ${g.readyChapters} 章已达到本次准备目标`:'等待识别教材目录';const bar=slot('import-progress-bar');bar.hidden=!g.totalChapters;if(g.totalChapters){bar.max=g.totalChapters;bar.value=Math.min(g.structuredChapters,g.totalChapters);}
      slot('import-current').textContent=entry.job?.import?.current?.title?`当前章节 · ${entry.job.import.current.title}`:'';
      slot('import-page-count').textContent=entry.job?`文字与扫描来源：${c.readablePages} / ${c.totalPages||'—'} 页有可读文字 · ${c.ocrAttemptedPages} 页已尝试本机识别 · AI请求 ${c.modelCalls} / 上限 ${model.options.maxModelCalls}`:'';
      const warnings=[...(entry.error?[entry.error]:[]),...(entry.job?.error?.message?[entry.job.error.message]:[]),...(Array.isArray(entry.job?.import?.warnings)?entry.job.import.warnings:[])].map(value=>typeof value==='string'?value:value?.message||value?.code||'有内容待核对');
      if(model.pageReview)warnings.push(`${Math.max(0,c.totalPages-c.readablePages)} 页尚无可读文字，可能包含空白页或受限扫描页，请结合原件核对。`);
      if(model.coveragePartial)warnings.push('本次部分章节来源仍不完整，已完成成果可先使用，但不能当作整书全部就绪。');
      const warningKey=JSON.stringify(warnings);if(view.warningKey!==warningKey){view.warningKey=warningKey;const host=slot('import-alerts');host.replaceChildren();for(const message of [...new Set(warnings)].slice(0,30))el('p','import-warning',message,host);}
      const chapters=model.chapters,chapterKey=JSON.stringify(chapters);if(view.chapterKey!==chapterKey){view.chapterKey=chapterKey;const host=slot('import-chapters'),focused=doc.activeElement?.dataset.importChapter;host.replaceChildren();for(const chapter of chapters){const item=el('article','import-chapter',undefined,host),copy=el('div','',undefined,item);item.dataset.state=chapter.status;el('h4','',chapter.title||'教材章节',copy);el('p','',`${view.mode==='page'?'':(CHAPTER_STATUS[chapter.status]||'等待确认')+' · '}${safeCount(chapter.knowledgePointCount)} 个知识点 · ${safeCount(chapter.lessonCount)} 份讲义`,copy);if(view.mode==='page')el('span','import-chapter-state',CHAPTER_STATUS[chapter.status]||'等待确认',item);if(chapter.learnable){const learn=button('先学这一章 →','learn',item,'import-learn');learn.dataset.importChapter=chapter.id;}}if(!chapters.length)el('p','import-help','真实章节将在目录识别后显示。不会按固定页数创建章节。',host);if(focused)[...host.querySelectorAll('button')].find(n=>n.dataset.importChapter===focused)?.focus({preventScroll:true});}
      renderSetup(entry,model);const form=slot('import-options-form');if(form)form.querySelector('[type=submit]').disabled=model.active||entry.busy;
      const actions=slot('import-actions'),modelBudget=entry.job?.error?.code==='IMPORT_MODEL_BUDGET',key=JSON.stringify([entry.job?.id,entry.job?.status,model.needsOutline,model.ready,entry.busy,modelBudget,model.options.maxModelCalls]);if(actions.dataset.key!==key){actions.dataset.key=key;actions.replaceChildren();if(model.needsOutline)button('核对教材目录','outline',actions,'primary');if(model.active)button('取消本次导入','cancel',actions);else if(model.canContinue){if(modelBudget){if(model.options.maxModelCalls<200){const label=el('label','import-resume-limit','提高本次AI请求上限',actions),input=el('input','',undefined,label);input.id='import-resume-limit';input.type='number';input.min=String(model.options.maxModelCalls+1);input.max='200';input.step='1';input.value=String(Math.min(200,model.options.maxModelCalls+20));button('确认提高上限并继续','resume',actions,'primary');}else el('span','import-help','已达单次200次请求上限，可先学习已完成章节或缩小处理范围。',actions);}else button('从未完成处继续','resume',actions,'primary');}if(view.mode==='page'){const first=chapters.find(ch=>ch.learnable);if(first){const learn=button('先学已完成章节','learn',actions,'primary');learn.dataset.importChapter=first.id;}button(model.active?'稍后继续':'返回教材','book',actions);}else if(model.ready||chapters.some(ch=>ch.learnable))button('打开教材','book',actions,model.ready?'primary':'');button('刷新状态','refresh',actions,'quiet');for(const node of actions.querySelectorAll('button'))node.disabled=entry.busy;}
    }
    function clearTimer(entry){if(entry.timer!==null){clearTimeout(entry.timer);entry.timer=null;}}
    function schedule(entry,delay=1400,force=false){clearTimer(entry);if(owned(entry)&&(force||ACTIVE.has(entry.job?.status)))entry.timer=setTimeout(()=>poll(entry),delay);}
    function accept(entry, job,paintToken) {
      if(!owned(entry))return;if(job && (job.type!=='book-import'||job.userId&&job.userId!==entry.userId||job.payload?.textbookId&&job.payload.textbookId!==entry.bookId))throw new Error('导入任务与当前教材不一致，未展示结果。');
      const previous=JSON.stringify(entry.job);entry.job=job||null;entry.error=null;entry.networkFailures=0;if(paintToken===undefined||view?.token===paintToken)render(entry);
      if(previous!==JSON.stringify(entry.job)){try{onUpdate({bookId:entry.bookId,job:entry.job});}catch{notify('任务已更新，页面更新暂未完成。',true);}}
      schedule(entry);
    }
    async function poll(entry) {
      if(!owned(entry))return;if(entry.polling){schedule(entry,1400,true);return;}entry.polling=true;const request=++entry.request;
      try{const data=await api('/textbooks/'+encodeURIComponent(entry.bookId)+'/import');if(owned(entry)&&entry.request===request)accept(entry,data?.job||null);}
      catch(error){if(!owned(entry)||entry.request!==request)return;if(error?.code==='STALE_VIEW'){schedule(entry,800,true);return;}entry.error=error?.message||'暂时无法读取最新状态，后台任务可能仍在继续。';entry.networkFailures++;render(entry);if(![401,403,404].includes(error?.status))schedule(entry,Math.min(10000,1400*2**Math.min(entry.networkFailures,3)),true);}
      finally{entry.polling=false;}
    }
    async function metadata(entry){const request=entry.metadataRequest=(entry.metadataRequest||0)+1,contextStamp=stamp();const results=await Promise.allSettled([api('/textbooks/'+encodeURIComponent(entry.bookId)),api('/textbooks/'+encodeURIComponent(entry.bookId)+'/outline'),api('/config/public')]);if(!owned(entry)||request!==entry.metadataRequest||contextStamp!==stamp())return;if(results[0].status==='fulfilled')entry.book=results[0].value;if(results[1].status==='fulfilled')entry.chapters=Array.isArray(results[1].value?.chapters)?results[1].value.chapters:[];if(results[2].status==='fulfilled')entry.researchConfigured=results[2].value.webResearchConfigured;render(entry);}
    async function open(bookId){const entry=fresh(bookId);show(entry);await Promise.allSettled([poll(entry),metadata(entry)]);return entry.job;}
    async function mount(host,bookId){if(!host||typeof host.replaceChildren!=='function')throw new TypeError('Import mount requires a host');const entry=fresh(bookId);show(entry,host);await Promise.allSettled([poll(entry),metadata(entry)]);return entry.job;}
    async function runStart(entry,options={}) {
      if(entry.busy)throw new Error('正在提交导入操作，请稍候。');const paintToken=view?.token;if(view?.entry===entry)view.formDirty=false;entry.busy=true;entry.error=null;const operation=++entry.operation;clearTimer(entry);entry.request++;render(entry);metadata(entry).catch(()=>{});
      try{const job=await api('/textbooks/'+encodeURIComponent(entry.bookId)+'/import',{method:'POST',data:options});if(owned(entry)&&entry.operation===operation)accept(entry,job,paintToken);return job;}
      catch(error){if(owned(entry)&&error?.code!=='STALE_VIEW'){entry.error=error?.message||'导入尚未发起，请重试。';if(view?.token===paintToken)render(entry);}if(owned(entry)&&error?.code==='STALE_VIEW')entry.reconcile=true;throw error;}
      finally{if(owned(entry)&&entry.operation===operation){entry.busy=false;if(view?.token===paintToken)render(entry);schedule(entry,entry.reconcile?800:1400,!!entry.reconcile);entry.reconcile=false;}}
    }
    async function start(bookId,options={}){const entry=fresh(bookId);show(entry);return runStart(entry,options);}
    async function action(name,chapterId){const entry=view?.entry;if(!entry||!visible(entry))return;
      if(name==='close'){const focus=view.returnFocus;close();if(focus?.isConnected)focus.focus({preventScroll:true});return;}
      if(name==='book'||name==='learn'||name==='outline'){const bookId=entry.bookId;close();navigate(name==='learn'?'/textbook/'+encodeURIComponent(bookId)+'/chapter/'+encodeURIComponent(chapterId):'/textbook/'+encodeURIComponent(bookId),name==='outline'?{outlineReview:true}:{});return;}
      if(name==='refresh'){await poll(entry);return;}if(!['cancel','resume'].includes(name)||entry.busy||!entry.job)return;
      const data={};if(name==='resume'&&entry.job.error?.code==='IMPORT_MODEL_BUDGET'){const value=Number(slot('import-resume-limit')?.value),current=optionsOf(entry.job).maxModelCalls;if(!Number.isSafeInteger(value)||value<=current||value>200){notify('请明确填写比原上限更高、且不超过200的本次累计请求上限。',true);return;}data.maxModelCalls=value;}
      const paintToken=view.token;entry.busy=true;entry.error=null;const operation=++entry.operation;clearTimer(entry);entry.request++;render(entry);
      try{const job=await api('/jobs/'+encodeURIComponent(entry.job.id)+'/'+(name==='cancel'?'cancel':'resume'),{method:'POST',data});if(owned(entry)&&operation===entry.operation)accept(entry,job,paintToken);}
      catch(error){if(owned(entry)&&error?.code!=='STALE_VIEW'){entry.error=error?.message||'操作未完成，已完成内容会保留。';if(view?.token===paintToken)render(entry);}if(owned(entry)&&error?.code==='STALE_VIEW')entry.reconcile=true;}
      finally{if(owned(entry)&&operation===entry.operation){entry.busy=false;if(view?.token===paintToken)render(entry);schedule(entry,entry.reconcile?800:1400,!!entry.reconcile);entry.reconcile=false;}}
    }
    outlet.addEventListener('click',event=>{const node=event.target.closest('[data-import-action]');if(!node||node.disabled)return;action(node.dataset.importAction,node.dataset.importChapter).catch(error=>{if(error?.code!=='STALE_VIEW')notify(error.message,true);});});
    outlet.addEventListener('change',event=>{if(event.target.name==='scope'){const section=slot('import-scope');if(section)section.hidden=event.target.value!=='chapters';}});
    outlet.addEventListener('input',()=>{if(view)view.formDirty=true;});
    outlet.addEventListener('submit',event=>{if(event.target.id!=='import-options-form'||!view)return;event.preventDefault();const data=new FormData(event.target),scope=data.get('scope'),chapterIds=data.getAll('chapterIds'),maxModelCalls=Number(data.get('maxModelCalls')),externalResearch=data.get('externalResearch')||'auto';if(scope==='chapters'&&!chapterIds.length){notify('请选择已有目录中的真实章节。',true);return;}if(!Number.isSafeInteger(maxModelCalls)||maxModelCalls<1||maxModelCalls>200){notify('本次AI请求上限须为1至200的整数。',true);return;}if(!['auto','off'].includes(externalResearch)){notify('请选择有效的公开补充资料选项。',true);return;}runStart(view.entry,{scope,...(scope==='chapters'?{chapterIds}:{}),prepareLessons:data.get('prepareLessons'),ocrLanguage:data.get('ocrLanguage'),externalResearch,maxModelCalls}).catch(error=>{if(error?.code!=='STALE_VIEW')notify(error.message,true);});});
    dialog.addEventListener('cancel',event=>{event.preventDefault();action('close');});dialog.addEventListener('close',()=>{if(view)close();});
    function contextChanged(){if(view&&(view.stamp!==stamp()||view.route!==window.location.hash||(view.mode==='page'&&!outlet.isConnected)))close();for(const [id,entry]of entries)if(entry.userId!==owner()){entry.request++;entry.operation++;entry.metadataRequest++;clearTimer(entry);entries.delete(id);}}
    const onHash=()=>contextChanged();window.addEventListener('hashchange',onHash);
    return Object.freeze({start,open,mount,unmount:close,close,contextChanged,dispose(){disposed=true;close();for(const entry of entries.values())clearTimer(entry);entries.clear();window.removeEventListener('hashchange',onHash);dialog.remove();}});
  }
  return Object.freeze({ install, describeImport });
});
