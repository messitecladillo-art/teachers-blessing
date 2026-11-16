/* A source-bound teaching workbench. User records and suggested content remain distinct. */
(() => {
  'use strict';
  const esc=v=>window.TeachingAI.escapeHtml(String(v??''));
  const arr=v=>Array.isArray(v)?v:v?.items||[];
  const enc=v=>encodeURIComponent(String(v));
  const active=j=>['queued','running','cancelling','cancel_requested'].includes(j?.status);
  const tabs=[['task','任务卡'],['plan','教案'],['diagram','教学图示'],['worksheet','学生任务单'],['assessment','评价题'],['answers','教师参考'],['reflection','理解与复盘'],['review','来源与审阅']];
  const input=(label,name,value='',options='')=>`<label class="field-label">${esc(label)}<input name="${name}" value="${esc(value)}" ${options}></label>`;
  const area=(label,name,value='',options='')=>`<label class="field-label">${esc(label)}<textarea name="${name}" rows="3" ${options}>${esc(value)}</textarea></label>`;
  const textList=values=>`<ul>${arr(values).map(v=>`<li>${esc(typeof v==='string'?v:v.text||v.description||v.title||'')}</li>`).join('')}</ul>`;

  function install({api,getContext,notify=()=>{},navigate}={}) {
    if(typeof api!=='function'||typeof getContext!=='function')throw new TypeError('Teaching workbench requires api and context');
    const dialog=document.createElement('dialog');dialog.id='teaching-dialog';dialog.className='teaching-dialog';dialog.setAttribute('aria-label','一课时教学任务包');document.body.append(dialog);
    let sequence=0,view=null,disposed=false;
    const stamp=()=>{const c=getContext();return JSON.stringify([c.userId,c.epoch,c.book?.id]);};
    const valid=token=>!disposed&&view?.token===token&&view.stamp===stamp()&&!!getContext().userId;
    function close(force=false){if((view?.editing||view?.formDirty)&&!force){notify('请先保存修订，或取消编辑 / 清空输入。',true);return;}sequence++;view=null;if(dialog.open)dialog.close();dialog.replaceChildren();}
    function pending(){if(view?.editing||view?.formDirty){notify('请先保存修订，或取消编辑 / 清空输入。',true);return true;}return false;}
    function body(){return dialog.querySelector('#teaching-body');}
    function url(suffix=''){return '/teaching-packs/'+enc(view.pack.id)+suffix;}
    function vurl(suffix=''){return url('/versions/'+enc(view.version.id)+suffix);}
    function markdown(value){const n=document.createElement('div');n.className='prose';n.innerHTML=window.StudyRender.markdown(String(value||''));window.StudyRender.paint(n);return n;}
    async function open(){
      close(true);const c=getContext();if(!c.userId||!c.book?.id)throw new Error('请先打开一本教材。');
      const token=++sequence;view={token,stamp:stamp(),bookId:c.book.id,tab:'task',pack:null,versions:[],version:null,editing:null,teacherContent:null,busy:true};
      dialog.innerHTML=`<header class="teaching-heading"><div><p class="eyebrow">PLAN · TEACH · REFLECT</p><h2>一课时教学任务包</h2><p class="small muted">${esc(c.book.title)} · 从教材依据到可修订、可试讲的教学成果</p></div><button class="quiet" data-teaching="close" aria-label="关闭教学任务包">×</button></header><div class="teaching-layout"><aside class="teaching-sidebar"><button class="primary" data-teaching="new">＋ 新建一课时任务</button><div id="teaching-pack-list" class="stack"></div></aside><main id="teaching-body" aria-live="polite">正在读取任务…</main></div>`;
      dialog.showModal();
      try{await loadList(token);if(!valid(token))return;const jobs=arr(await api('/jobs'));if(!valid(token))return;const job=jobs.find(j=>j.type==='teaching-pack'&&active(j)&&view.packs.some(p=>p.id===j.payload?.packId));if(job){await selectPack(job.payload.packId,token);if(valid(token))watch(job,token).catch(report);}else if(view.packs.length)await selectPack(view.packs.at(-1).id,token);else taskForm();}catch(error){report(error);if(valid(token))body().textContent=error.message;}finally{if(valid(token))view.busy=false;}
    }
    async function loadList(token){const data=await api('/textbooks/'+enc(view.bookId)+'/teaching-packs');if(!valid(token))return;view.packs=arr(data);renderList();}
    function renderList(){const list=dialog.querySelector('#teaching-pack-list');if(!list)return;list.innerHTML=view.packs.map(p=>`<button class="teaching-pack-choice ${view.pack?.id===p.id?'active':''}" data-teaching="select" data-id="${esc(p.id)}"><strong>${esc(p.title||p.task?.title||p.task?.goal)}</strong><small>${esc(p.task?.subject||'教学任务')} · ${esc(p.task?.durationMinutes||'—')}分钟</small></button>`).join('')||'<p class="small muted">每个任务保存独立目标、教材范围和修订版本。</p>';}
    async function selectPack(id,token=view.token,preferred){
      const selection=(view.selection||0)+1;view.selection=selection;
      const current=()=>valid(token)&&view.selection===selection;
      const pack=await api('/teaching-packs/'+enc(id));if(!current())return;
      const versions=arr(await api('/teaching-packs/'+enc(id)+'/versions'));if(!current())return;
      if(view.pack?.id!==id)view.job=null;
      view.pack=pack;view.versions=versions;view.version=null;view.teacherContent=null;view.editing=null;view.formDirty=false;
      const version=versions.find(v=>v.id===preferred)||versions.find(v=>v.id===pack.currentVersionId)||versions.at(-1);
      if(version){const loaded=await api('/teaching-packs/'+enc(id)+'/versions/'+enc(version.id));if(!current())return;view.version=loaded;}
      const jobs=arr(await api('/jobs'));if(!current())return;
      const latestJob=jobs.filter(j=>j.type==='teaching-pack'&&j.payload?.packId===id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      view.job=latestJob&&(active(latestJob)||['failed','cancelled','interrupted'].includes(latestJob.status))?latestJob:null;
      renderList();render();
    }
    function taskForm(edit=false){
      const c=getContext(),p=edit?view.pack:null,t=p?.task||{},scope=p?.scope||{},chapters=arr(c.outline?.chapters);view.editing=edit?'task':'new';view.formDirty=false;
      body().innerHTML=`<form id="teaching-task-form" class="stack"><div><p class="eyebrow">01 · TEACHING MISSION</p><h3>${edit?'修订教学任务':'这节课要让学生做到什么？'}</h3><p class="small muted">把目标写成可以通过解释、操作或作答检查的表现，再选择实际教材依据。</p></div>${input('任务名称','title',p?.title||t.title||'', 'maxlength="120" required placeholder="例如：用图解释同分母分数相加"')}<div class="form-columns">${input('学段 / 年级','grade',t.grade||'','maxlength="80" required placeholder="例如：小学四年级"')}${input('学科','subject',t.subject||'','maxlength="80" required')}</div>${input('课时长度（分钟）','durationMinutes',t.durationMinutes||40,'type="number" min="5" max="120" required')}${area('本课目标','goal',t.goal||'','maxlength="1200" required placeholder="例如：学生能画图说明为什么只把分子相加，并解释每份大小没有变化。"')}${area('先备知识与班情（本人提供）','priorKnowledge',t.priorKnowledge||'','maxlength="2000" placeholder="写已知情况；没有调查过的内容请注明假设。"')}<fieldset class="teaching-scope"><legend>教材依据</legend>${chapters.map(ch=>`<label><input type="checkbox" name="chapterIds" value="${esc(ch.id)}" ${arr(scope.chapterIds).includes(ch.id)?'checked':''}> <span>${esc(ch.title)}</span></label>`).join('')||'<p class="small muted">这本教材尚未提取到可用文字。请先返回教材识别扫描页，再创建任务。</p>'}</fieldset><p class="small muted">仅使用所选章节已提取的片段；扫描教材可以先识别本课相关页面。</p><div class="row"><button class="primary" type="submit" ${!chapters.length?'disabled':''}>${edit?'保存任务修订':'创建教学任务'}</button>${p?'<button type="button" data-teaching="cancel-edit">取消编辑</button>':'<button type="button" data-teaching="back">返回任务</button>'}</div></form>`;
    }
    function render(){
      if(!view?.pack)return taskForm();
      const p=view.pack,v=view.version,stale=!!v?.stale,reviewed=v?.reviewValid===true;
      body().innerHTML=`<div class="teaching-task-heading"><div><h3>${esc(p.title||p.task?.title||'教学任务')}</h3><p class="small muted">${esc(p.task?.grade)} · ${esc(p.task?.subject)} · ${esc(p.task?.durationMinutes)}分钟</p></div><button data-teaching="edit-task">修订任务与范围</button></div><div class="teaching-toolbar"><button class="primary" data-teaching="generate" ${active(view.job)?'disabled':''}>${v?'按当前目标重新生成':'生成教学任务包'}</button>${!v?'<button data-teaching="blank">从空白草稿开始</button>':''}${v?`<label class="field-label">修订版本<select id="teaching-version">${view.versions.map(item=>`<option value="${esc(item.id)}" ${item.id===v.id?'selected':''}>版本 ${esc(item.version)} · ${({'ai-generated':'AI生成','human-created':'本人人工草稿','human-edited':'本人修订'}[item.origin]||'待核对成果')}${item.stale?' · 来源或任务已变化':''}</option>`).join('')}</select></label>${reviewed&&!stale?`<a class="teaching-download" href="/api/v1${esc(vurl('/download?audience=student&format=html'))}" download>学生版 · 打印 / 离线</a>`:'<span class="small muted">完成审阅后可下载学生版</span>'}`:''}</div><div id="teaching-job"></div>${v?.validation?.complete===false?'<p class="hint">这份草稿还有未填写或未核对的内容。补全各页后才能确认审阅和导出。</p>':''}${stale?'<p class="hint">这份历史成果对应较早的教学目标或教材。可回看，请按当前依据重新生成后审阅。</p>':v?`<p class="teaching-status ${reviewed?'reviewed':''}">${reviewed?'已由你确认审阅；课堂使用时仍需结合实际班情。':'AI或本人草稿，请核对来源、内容与适龄性后确认审阅。'}</p>`:''}<nav class="teaching-tabs" aria-label="教学任务包内容">${tabs.map(([id,label])=>`<button data-teaching="tab" data-tab="${id}" aria-current="${view.tab===id?'page':'false'}" class="${view.tab===id?'active':''}" ${!v&&id!=='task'?'disabled':''}>${label}</button>`).join('')}</nav><section id="teaching-panel"></section>`;
      renderJob();renderPanel();
    }
    function renderJob(){const slot=dialog.querySelector('#teaching-job');if(!slot)return;const j=view.job;if(!j){slot.replaceChildren();return;}const failed=['failed','cancelled','interrupted'].includes(j.status);slot.innerHTML=`<div class="job-box ${failed?'job-error':''}"><div><strong>${esc(active(j)?'正在整理这一课时的教学成果':failed?'本次生成未完成':'教学成果已保存')}</strong><div class="small">${esc(j.error?.message||'任务保存在当前教学目标与教材版本下。')}</div></div>${active(j)?'<button data-teaching="cancel-job">取消生成</button>':failed?'<button data-teaching="resume-job">恢复生成</button>':''}</div>`;}
    function panel(){return dialog.querySelector('#teaching-panel');}
    function sourcesHtml(sourceIds){const sources=arr(view.version?.sourceVersions||view.version?.sources),allowed=new Set(arr(sourceIds));return sources.filter(s=>!allowed.size||allowed.has(s.id||s.knowledgePointId)).map(s=>`<a class="teaching-source" data-teaching="source" data-id="${esc(s.id||s.knowledgePointId)}" href="#/textbook/${enc(view.bookId)}/kp/${enc(s.id||s.knowledgePointId)}">${esc(s.title||'教材片段')} · ${esc(s.anchor?.startPage||s.sourceAnchor?.startPage||'—')}–${esc(s.anchor?.endPage||s.sourceAnchor?.endPage||'—')}页${s.pageCoverage?.partial?` · 文字 ${esc(s.pageCoverage.readablePageCount)}/${esc(s.pageCoverage.totalPages)} 页`:''} ↗</a>`).join('');}
    function renderPanel(){
      const host=panel(),p=view.pack,v=view.version,c=v?.content||{};if(!host)return;
      if(view.tab==='task'){host.innerHTML=`<h3>本课任务与成果</h3><div class="teaching-goal">${esc(p.task.goal)}</div><h4>先备知识与班情</h4><p class="teaching-plain">${esc(p.task.priorKnowledge||'尚未提供；需要根据实际教学对象补充。')}</p><ol class="teaching-deliverables"><li>用教案组织教学目标、活动与时间</li><li>用图示表达关系，并让学生补图或解释</li><li>用学生任务单检查理解，教师参考单独揭示</li><li>记录本人展示的理解、误解修正与试讲反馈</li></ol>${!v?'<p class="small muted">创建任务后可生成第一份待核对成果，再逐块修订。</p>':''}`;return;}
      if(!v){host.textContent='请先生成这一课时的教学成果。';return;}
      if(view.tab==='plan'){
        const plan=c.lessonPlan||{};host.innerHTML=`<div class="row space"><h3>教案</h3><button data-teaching="edit" data-section="lessonPlan">修订教案</button></div><h4>学习目标</h4>${textList(plan.objectives)}<div class="teaching-steps">${arr(plan.steps).map((s,i)=>`<article><span class="teaching-step-number">${i+1}</span><div><p class="small muted">${esc(s.minutes)}分钟</p><h4>${esc(s.title)}</h4><dl><dt>教师引导</dt><dd>${esc(s.teacherMoves)}</dd><dt>学生活动</dt><dd>${esc(s.studentTask)}</dd><dt>理解检查</dt><dd>${esc(s.check)}</dd></dl>${sourcesHtml(s.sourceIds)}</div></article>`).join('')}</div>`;
      }else if(view.tab==='diagram'){
        host.innerHTML=`<div class="row space"><h3>${esc(c.diagram?.title||'教学图示')}</h3><button data-teaching="edit" data-section="diagram">修订节点与关系</button></div><p class="small muted">图中关系来自这份待核对教学成果。请对照教材检查，再用于讲解或让学生补图。</p><div class="row"><button data-teaching="diagram-mode" data-mode="complete">完整图</button><button data-teaching="diagram-mode" data-mode="blank">空白练习图</button><button data-teaching="diagram-download">下载当前 SVG</button></div><div id="teaching-diagram" class="teaching-diagram"></div><div class="teaching-edge-list">${arr(c.diagram?.edges).map(e=>`<p>${esc(arr(c.diagram?.nodes).find(n=>n.id===e.from)?.label||e.from)} → ${esc(arr(c.diagram?.nodes).find(n=>n.id===e.to)?.label||e.to)}：${esc(e.label)}</p>`).join('')}</div>${sourcesHtml(c.diagram?.sourceIds)}`;drawDiagram();
      }else if(view.tab==='worksheet'){
        const w=c.worksheet||{};host.innerHTML=`<div class="row space"><h3>${esc(w.title||'学生任务单')}</h3><button data-teaching="edit" data-section="worksheet">修订任务单</button></div><div id="teaching-instructions"></div><ol class="teaching-questions">${arr(w.questions).map(q=>`<li><p class="teaching-plain">${esc(q.stem)}</p><div class="teaching-answer-space" aria-label="学生作答留白"></div>${sourcesHtml(q.sourceIds)}</li>`).join('')}</ol><p class="small muted">学生版下载只包含学生可见的任务与图示。</p>`;host.querySelector('#teaching-instructions').append(markdown(w.instructions));
      }else if(view.tab==='assessment'){
        const a=c.assessment||{};host.innerHTML=`<div class="row space"><h3>形成性评价题</h3><button data-teaching="edit" data-section="assessment">修订评价题</button></div><p class="small muted">让学生解释、演示或迁移应用，用具体表现检查本课目标。参考答案与教师检查要点在“教师参考”中单独查看。</p><ol class="teaching-questions">${arr(a.questions).map(q=>`<li><p class="teaching-plain">${esc(q.stem)}</p><div class="teaching-answer-space" aria-label="学生作答留白"></div>${sourcesHtml(q.sourceIds)}</li>`).join('')}</ol>`;
      }else if(view.tab==='answers'){
        const full=view.teacherContent;host.innerHTML=`<h3>教师参考与形成性评价</h3><p class="small muted">参考答案与量规需要教师核对。学生版下载始终不含这些教师参考字段。</p>${!full?'<button class="primary" data-teaching="reveal">查看本版本教师参考</button>':`<div class="row"><button data-teaching="edit" data-section="teacherAnswers">修订教师参考</button><a class="teaching-download" href="/api/v1${esc(vurl('/download?audience=teacher&format=html'))}" download>教师版 · 打印 / 离线</a><a class="teaching-download" href="/api/v1${esc(vurl('/download?audience=teacher&format=md'))}" download>教师版 Markdown</a></div>${arr(full.teacherAnswers).map(a=>`<article class="teaching-reference"><h4>${esc([...arr(c.worksheet?.questions),...arr(c.assessment?.questions)].find(q=>q.id===a.questionId)?.stem||'参考作答')}</h4><p class="teaching-plain">${esc(a.answer)}</p><p class="small muted">${esc(a.rationale)}</p>${a.rubric?textList(a.rubric):''}${sourcesHtml(a.sourceIds)}</article>`).join('')}`}`;
        if(full?.assessment?.criteria?.length){const h=document.createElement('h4');h.textContent='教师检查要点';host.append(h);const box=document.createElement('div');box.innerHTML=textList(full.assessment.criteria);host.append(box);}
      }else if(view.tab==='reflection'){renderReflection(host,c);}
      else renderReview(host);
      if(v.stale||v.id!==p.currentVersionId)host.querySelectorAll('[data-teaching="edit"]').forEach(button=>{button.disabled=true;button.title='请切换当前任务的最新有效版本后修订';});
      window.StudyRender.paint(host);
    }
    function renderReflection(host,c){
      const records=arr(view.version.records),reflections=arr(view.version.reflections);
      host.innerHTML=`<h3>理解证据与试讲复盘</h3><p class="small muted">记录你解释了什么、用什么作答或演示支持，以及后来修正了什么。浏览过的材料与自标掌握不会自动成为理解证据。</p><details><summary>记录一条理解或误解修正</summary><form id="teaching-record-form" class="stack"><label class="field-label">记录类型<select name="kind"><option value="demonstration">本人展示理解</option><option value="misconception-correction">误解修正</option><option value="prior-knowledge">本人自述先备知识</option></select></label>${area('具体理解 / 修正了什么','statement','','maxlength="2000" required')}${area('支持这条记录的作答、解释或演示','evidenceText','','maxlength="4000" required')}<button class="primary" type="submit">保存本人记录</button><button type="reset">清空输入</button></form></details><div class="teaching-records">${records.map(r=>`<article><strong>${esc(r.kind==='misconception-correction'?'误解修正':r.kind==='prior-knowledge'?'本人自述先备知识':'本人展示理解')}</strong><p class="teaching-plain">${esc(r.statement)}</p><blockquote>${esc(r.evidenceText)}</blockquote><small>本人记录，尚未经独立核验</small></article>`).join('')}</div><div class="row space"><h4>试讲前可以检查</h4><button data-teaching="edit" data-section="reflection">修订复盘提示</button></div>${textList(c.reflection?.prompts)}<form id="teaching-reflection-form" class="stack"><label class="field-label">反馈来源<select name="kind"><option value="self-rehearsal">本人试讲自评</option><option value="peer-feedback">同伴反馈（已获授权）</option><option value="classroom-observation">课堂观察（已获授权并去标识）</option></select></label><label class="field-label">材料性质<select name="classification"><option value="self-reported">本人自述</option><option value="synthetic">模拟试讲 / 合成材料</option><option value="authorized-anonymized">真实、已授权且去标识</option></select></label>${area('实际观察、困难与反馈','text','','maxlength="3500" required placeholder="具体到某一步、一个问题或一段讲解。"')}${area('反例或不同意见（选填）','counterexample','','maxlength="1000"')}${area('下次具体调整','action','','maxlength="1200" required placeholder="写清修改哪一步，以及如何再次检查理解。"')}${area('反馈依据（选填）','evidence','','maxlength="4000" placeholder="例如：模拟试讲中本人遗漏的说明；不要填写学生姓名等身份信息。"')}<label class="small"><input type="checkbox" name="authorized" required> 我确认输入来自本人或已授权的去标识材料，并注明模拟情况。</label><button class="primary" type="submit">保存复盘记录</button><button type="reset">清空输入</button></form><div class="teaching-records">${reflections.map(r=>`<article><strong>${esc(r.kind==='self-rehearsal'?'本人试讲自评':r.kind==='peer-feedback'?'同伴反馈':'课堂观察')} · ${esc({'synthetic':'模拟材料','self-reported':'本人自述','authorized-anonymized':'已授权去标识'}[r.classification]||'本人提供')}</strong><p class="teaching-plain">${esc(r.text)}</p><blockquote>${esc(r.evidence||'未附补充依据')}</blockquote></article>`).join('')}</div>`;
    }
    function renderReview(host){host.innerHTML=`<h3>教材依据与使用前审阅</h3><div class="teaching-sources">${sourcesHtml()}</div>${view.version.coverage?.partial?'<p class="hint">本次只使用了部分教材片段，请核对范围是否足够支持本课目标。</p>':''}<p class="small muted">教材或任务更新后，历史审阅不再代表当前版本。请先到“教师参考”查看并核对答案，再提交以下确认。确认由你本人提交。</p><form id="teaching-review-form" class="stack"><label><input type="checkbox" name="sourcesChecked" required> 已核对教材页码与关键主张</label><label><input type="checkbox" name="contentChecked" required> 已检查内容、图示关系与参考答案</label><label><input type="checkbox" name="ageAppropriate" required> 已检查适龄性、课时安排与班情假设</label>${area('审阅说明（选填）','note','','maxlength="2000"')}<button class="primary" type="submit" ${view.version.stale?'disabled':''}>确认本版本审阅</button><button type="reset">清空输入</button></form>`;}

    function drawDiagram(){
      const host=dialog.querySelector('#teaching-diagram');if(!host)return;host.replaceChildren();
      const d=view.version.content.diagram,nodes=arr(d?.nodes),edges=arr(d?.edges);if(!nodes.length){host.textContent='这份成果还没有图示节点。';return;}
      const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),width=760,height=80+nodes.length*110,blank=view.diagramMode==='blank';svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-labelledby','teaching-diagram-title teaching-diagram-description');
      const add=(name,attrs,text,parent=svg)=>{const el=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
      add('title',{id:'teaching-diagram-title'},d.title||'教学图示');add('desc',{id:'teaching-diagram-description'},blank?'空白图用于补充概念并解释关系。':'节点与有向连线表达本版本记录的教学关系；文字列表保留完整关系。');
      add('rect',{x:0,y:0,width,height,fill:'#faf9f6'});
      const defs=add('defs',{}),marker=add('marker',{id:'teaching-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},undefined,defs);add('path',{d:'M0 0 L10 5 L0 10 z',fill:'#315c46'},undefined,marker);
      const nodeMap=new Map(nodes.map((n,i)=>[n.id,{...n,y:60+i*110}]));
      edges.forEach((edge,i)=>{const a=nodeMap.get(edge.from),b=nodeMap.get(edge.to);if(!a||!b)return;const lane=490+(i%6)*34;add('path',{d:`M410 ${a.y} H${lane} V${b.y} H410`,fill:'none',stroke:'#8c9d89','stroke-width':1.7,'marker-end':'url(#teaching-arrow)'});add('text',{x:lane+7,y:(a.y+b.y)/2-5,fill:'#52684f','font-size':13},blank?'关系？':edge.label.length>14?edge.label.slice(0,13)+'…':edge.label);});
      nodes.forEach((node,i)=>{const y=nodeMap.get(node.id).y;add('rect',{x:38,y:y-29,width:372,height:58,rx:8,fill:blank?'#ffffff':'#e9efdf',stroke:'#a4b69b'});const text=blank?`概念 ${i+1}：________________`:node.label;add('text',{x:56,y:y+5,fill:'#24382d','font-family':'Microsoft YaHei, sans-serif','font-size':17},text.length>20?text.slice(0,19)+'…':text);add('title',{},blank?'待补充概念':node.label);});
      host.append(svg);
    }
    function edit(section,draft){
      const c=view.version.content;view.editing=section;view.editDraft=structuredClone(draft??(section==='teacherAnswers'?view.teacherContent[section]:c[section]));let fields='';
      if(section==='lessonPlan'){const p=c.lessonPlan;fields=area('学习目标（每行一条）','objectives',arr(p.objectives).join('\n'),'maxlength="4000" required')+arr(p.steps).map((s,i)=>`<fieldset><legend>活动 ${i+1}</legend>${input('活动名称','stepTitle'+i,s.title,'maxlength="120" required')}${input('分钟','stepMinutes'+i,s.minutes,'type="number" min="1" max="120" required')}${area('教师引导','teacherMoves'+i,s.teacherMoves,'maxlength="2000" required')}${area('学生活动','studentTask'+i,s.studentTask,'maxlength="1500" required')}${area('理解检查','check'+i,s.check,'maxlength="1000" required')}</fieldset>`).join('');}
      else if(section==='worksheet'){const w=c.worksheet;fields=input('任务单名称','title',w.title,'maxlength="160" required')+area('学生说明','instructions',w.instructions,'maxlength="3000" required')+arr(w.questions).map((q,i)=>area('任务 '+(i+1),'stem'+i,q.stem,'maxlength="2000" required')).join('');}
      else if(section==='assessment'){const a=c.assessment;fields=arr(a.questions).map((q,i)=>area('评价题 '+(i+1),'stem'+i,q.stem,'maxlength="2000" required')).join('')+area('教师检查要点（每行一条）','criteria',arr(a.criteria).join('\n'),'maxlength="4000" required');}
      else if(section==='reflection'){fields=area('试讲检查问题（每行一条）','prompts',arr(c.reflection?.prompts).join('\n'),'maxlength="4000" required');}
      else if(section==='diagram'){const d=view.editDraft;fields=input('图示标题','title',d.title,'maxlength="160" required')+`<label class="field-label">图示表达<select name="kind"><option value="process" ${d.kind==='process'?'selected':''}>过程与步骤</option><option value="concept" ${d.kind==='concept'?'selected':''}>概念与关系</option></select></label>`+arr(d.nodes).map((n,i)=>`<fieldset><legend>节点 ${i+1}</legend>${input('节点名称','label'+i,n.label,'maxlength="100" required')}<button type="button" class="quiet small danger" data-teaching="diagram-remove-node" data-index="${i}" ${d.nodes.length<=2?'disabled':''}>移除此节点及相关连线</button></fieldset>`).join('')+`<button type="button" data-teaching="diagram-add-node" ${d.nodes.length>=10?'disabled':''}>＋ 添加节点</button>`+arr(d.edges).map((e,i)=>`<fieldset><legend>关系 ${i+1}</legend><div class="form-columns"><label class="field-label">起点<select name="from${i}">${arr(d.nodes).map(n=>`<option value="${esc(n.id)}" ${n.id===e.from?'selected':''}>${esc(n.label||'待命名节点')}</option>`).join('')}</select></label><label class="field-label">终点<select name="to${i}">${arr(d.nodes).map(n=>`<option value="${esc(n.id)}" ${n.id===e.to?'selected':''}>${esc(n.label||'待命名节点')}</option>`).join('')}</select></label></div>${input('关系说明','edgeLabel'+i,e.label,'maxlength="100" required')}<button type="button" class="quiet small danger" data-teaching="diagram-remove-edge" data-index="${i}" ${d.edges.length<=1?'disabled':''}>移除此关系</button></fieldset>`).join('')+`<button type="button" data-teaching="diagram-add-edge" ${d.edges.length>=14?'disabled':''}>＋ 添加有向关系</button><p class="small muted">新增节点与关系沿用本图教材范围，保存后仍需逐项核对。图示最多10个节点、14条关系。</p>`;}
      else if(section==='teacherAnswers'){const answers=view.teacherContent?.teacherAnswers||[];fields=answers.map((a,i)=>`<fieldset><legend>参考 ${i+1}</legend>${area('参考答案','answer'+i,a.answer,'maxlength="3000" required')}${area('依据与理解检查要点','rationale'+i,a.rationale,'maxlength="3000" required')}</fieldset>`).join('');}
      panel().innerHTML=`<form id="teaching-content-form" class="stack"><h3>修订${{lessonPlan:'教案',diagram:'图示',worksheet:'学生任务单',assessment:'评价题',reflection:'复盘提示',teacherAnswers:'教师参考'}[section]}</h3><p class="small muted">保存会生成新的本人修订版本，历史版本保留，审阅需要重新确认。</p>${['lessonPlan','assessment','reflection'].includes(section)?'<p class="small muted">逐行条目最多6条，每条最多600字。</p>':''}${fields}<div class="row"><button class="primary" type="submit">保存为新修订版本</button><button type="button" data-teaching="cancel-edit">取消编辑</button></div></form>`;
    }
    function editPayload(data){
      const section=view.editing,old=view.editDraft||(section==='teacherAnswers'?view.teacherContent[section]:view.version.content[section]),copy=structuredClone(old);
      const lines=name=>{const values=String(data.get(name)||'').split('\n').map(s=>s.trim()).filter(Boolean);if(values.length>6||values.some(s=>s.length>600))throw new Error('逐行条目最多6条，每条最多600字。请缩短后保存。');return values;};
      if(section==='lessonPlan'){copy.objectives=lines('objectives');copy.steps.forEach((s,i)=>{s.title=data.get('stepTitle'+i);s.minutes=Number(data.get('stepMinutes'+i));for(const k of ['teacherMoves','studentTask','check'])s[k]=data.get(k+i);});}
      else if(section==='worksheet'){copy.title=data.get('title');copy.instructions=data.get('instructions');copy.questions.forEach((q,i)=>q.stem=data.get('stem'+i));}
      else if(section==='assessment'){copy.questions.forEach((q,i)=>q.stem=data.get('stem'+i));copy.criteria=lines('criteria');}
      else if(section==='reflection'){copy.prompts=lines('prompts');}
      else if(section==='diagram'){copy.title=data.get('title');copy.kind=data.get('kind');copy.nodes.forEach((n,i)=>n.label=data.get('label'+i));copy.edges.forEach((e,i)=>{e.from=data.get('from'+i);e.to=data.get('to'+i);e.label=data.get('edgeLabel'+i);});}
      else copy.forEach((a,i)=>{a.answer=data.get('answer'+i);a.rationale=data.get('rationale'+i);});
      return {[section]:copy};
    }
    async function refreshVersion(token=view.token){const id=view.version.id;const fresh=await api(vurl());if(!valid(token)||view.version?.id!==id)return;view.version=fresh;view.teacherContent=null;render();}
    async function watch(job,token){
      const packId=job.payload?.packId||view.pack.id,selection=view.selection;
      const currentView=()=>valid(token)&&view.pack?.id===packId&&view.selection===selection;
      if(!currentView())return;view.job=job;renderJob();let current=job;
      for(let i=0;i<900;i++){
        if(!currentView()||view.job?.id!==job.id)return;view.job=current;renderJob();
        if(current.status==='completed'){
          if(view.editing||view.formDirty){notify('后台已保存新版本。请先保存或清空当前输入，再重新打开任务查看。');return;}
          const id=current.result?.id||current.result?.versionId;await selectPack(packId,token,id);
          if(valid(token)&&view.pack?.id===packId){view.job=null;view.tab='plan';render();notify('教学任务包已保存，请核对后修订。');}return;
        }
        if(['failed','cancelled','interrupted'].includes(current.status))return;
        await new Promise(r=>setTimeout(r,700));if(!currentView())return;current=await api('/jobs/'+enc(job.id));
      }
      if(currentView())notify('任务仍在后台处理，可关闭后重新打开查看。');
    }
    function report(error){if(error?.code!=='STALE_VIEW')notify(error?.message||'操作没有完成，请重试。',true);}
    dialog.addEventListener('click',async event=>{
      const button=event.target.closest('[data-teaching]');if(!button||!view)return;const action=button.dataset.teaching,token=view.token;
      if(view.busy&&action!=='close'){notify('正在保存或读取，请稍候。');return;}
      const serial=['select','generate','blank','cancel-job','resume-job','reveal'].includes(action);
      if(serial){view.busy=true;if(body())body().inert=true;}
      try{
        if(action==='close'){close();return;}
        if(action==='cancel-edit'||action==='back'){view.editing=null;view.formDirty=false;view.pack?render():body().innerHTML='<p>选择左侧任务，或新建一课时任务。</p>';return;}
        if(['tab','select','new','edit-task','generate','edit','source'].includes(action)&&pending())return;
        if(['edit','edit-task','blank'].includes(action)&&active(view.job))throw new Error('请先等待或取消生成，再修订当前成果。');
        if(action==='new'){taskForm();return;}
        if(action==='select'){await selectPack(button.dataset.id,token);if(valid(token)&&active(view.job))watch(view.job,token).catch(report);return;}
        if(action==='edit-task'){taskForm(true);return;}
        if(action==='tab'){view.tab=button.dataset.tab;render();return;}
        if(action==='edit'){edit(button.dataset.section);return;}
        if(action.startsWith('diagram-add-')||action.startsWith('diagram-remove-')){
          if(view.editing!=='diagram')return;
          const draft=editPayload(new FormData(dialog.querySelector('#teaching-content-form'))).diagram,refs=[...draft.sourceIds];
          if(action==='diagram-add-node'&&draft.nodes.length<10)draft.nodes.push({id:'n-'+crypto.randomUUID().slice(0,8),label:'',sourceIds:refs});
          if(action==='diagram-add-edge'&&draft.edges.length<14)draft.edges.push({from:draft.nodes[0].id,to:draft.nodes[1].id,label:'',sourceIds:refs});
          if(action==='diagram-remove-node'&&draft.nodes.length>2){const id=draft.nodes[Number(button.dataset.index)]?.id;draft.nodes=draft.nodes.filter(n=>n.id!==id);draft.edges=draft.edges.filter(e=>e.from!==id&&e.to!==id);if(!draft.edges.length)draft.edges.push({from:draft.nodes[0].id,to:draft.nodes[1].id,label:'',sourceIds:refs});}
          if(action==='diagram-remove-edge'&&draft.edges.length>1)draft.edges.splice(Number(button.dataset.index),1);
          edit('diagram',draft);view.formDirty=true;return;
        }
        if(action==='generate'){const j=await api(url('/generate'),{method:'POST',data:{}});if(valid(token))watch(j,token).catch(report);return;}
        if(action==='blank'){const result=await api(url('/versions'),{method:'POST',data:{}});if(valid(token)){await selectPack(view.pack.id,token,result.id);view.tab='plan';render();}return;}
        if(action==='cancel-job'){view.job=await api('/jobs/'+enc(view.job.id)+'/cancel',{method:'POST',data:{}});if(valid(token))renderJob();return;}
        if(action==='resume-job'){const j=await api('/jobs/'+enc(view.job.id)+'/resume',{method:'POST',data:{}});if(valid(token))watch(j,token).catch(report);return;}
        if(action==='reveal'){const base=vurl(),versionId=view.version.id;const data=await api(base+'/reveal-teacher',{method:'POST',data:{}});if(!valid(token)||view.version.id!==versionId)return;const fresh=await api(base);if(!valid(token)||view.version.id!==versionId)return;view.version=fresh;view.teacherContent=data.content||data;renderPanel();return;}
        if(action==='diagram-mode'){view.diagramMode=button.dataset.mode;drawDiagram();return;}
        if(action==='diagram-download'){const svg=dialog.querySelector('#teaching-diagram svg');if(!svg)return;download(new XMLSerializer().serializeToString(svg),'image/svg+xml','teaching-diagram-'+(view.diagramMode||'complete')+'.svg');return;}
        if(action==='source'){event.preventDefault();const book=view.bookId,id=button.dataset.id;close(true);navigate?.('/textbook/'+enc(book)+'/kp/'+enc(id),{source:true});return;}
      }catch(error){if(valid(token))report(error);}finally{if(serial&&valid(token)){view.busy=false;if(body())body().inert=false;}}
    });
    dialog.addEventListener('submit',async event=>{
      event.preventDefault();if(!view||view.busy)return;const form=event.target,token=view.token,data=new FormData(form),submit=form.querySelector('[type="submit"]');view.busy=true;form.inert=true;if(submit)submit.disabled=true;
      try{
        if(form.id==='teaching-task-form'){const task={grade:data.get('grade'),subject:data.get('subject'),durationMinutes:Number(data.get('durationMinutes')),goal:data.get('goal'),priorKnowledge:data.get('priorKnowledge')},scope={chapterIds:data.getAll('chapterIds')};if(!scope.chapterIds.length)throw new Error('请选择本课要依据的教材章节。');const editing=view.editing==='task';const p=await api(editing?url():'/textbooks/'+enc(view.bookId)+'/teaching-packs',{method:editing?'PATCH':'POST',data:{title:data.get('title'),task,scope,...(editing?{expectedRevision:view.pack.revision}:{})}});if(!valid(token))return;view.editing=null;await loadList(token);await selectPack(p.id,token);notify('教学任务已保存。');}
        else if(form.id==='teaching-content-form'){const result=await api(vurl(),{method:'PATCH',data:{expectedRevision:view.version.revision,content:editPayload(data)}});if(!valid(token))return;view.editing=null;await selectPack(view.pack.id,token,result.id);notify('本人修订已保存为新版本。');}
        else if(form.id==='teaching-record-form'){await api(vurl('/records'),{method:'POST',data:{kind:data.get('kind'),statement:data.get('statement'),evidenceText:data.get('evidenceText')}});if(valid(token)){view.formDirty=false;await refreshVersion(token);}}
        else if(form.id==='teaching-reflection-form'){await api(vurl('/reflections'),{method:'POST',data:{kind:data.get('kind'),classification:data.get('classification'),text:'观察与反馈：'+data.get('text')+'\n反例或不同意见：'+(data.get('counterexample')||'未提供')+'\n下次调整：'+data.get('action'),evidence:data.get('evidence')}});if(valid(token)){view.formDirty=false;await refreshVersion(token);}}
        else if(form.id==='teaching-review-form'){await api(vurl('/review'),{method:'POST',data:{expectedRevision:view.version.revision,sourcesChecked:data.has('sourcesChecked'),contentChecked:data.has('contentChecked'),ageAppropriate:data.has('ageAppropriate'),note:data.get('note')}});if(valid(token)){view.formDirty=false;await refreshVersion(token);}}
      }catch(error){if(valid(token))report(error);}finally{if(valid(token))view.busy=false;if(form.isConnected)form.inert=false;if(submit?.isConnected)submit.disabled=false;}
    });
    dialog.addEventListener('change',async event=>{if(event.target.id!=='teaching-version'||!view)return;if(view.busy||pending()){event.target.value=view.version.id;return;}const token=view.token;view.busy=true;try{await selectPack(view.pack.id,token,event.target.value);}catch(error){if(valid(token))report(error);}finally{if(valid(token))view.busy=false;}});
    dialog.addEventListener('input',event=>{if(view&&event.target.closest('form'))view.formDirty=true;});
    dialog.addEventListener('reset',()=>{if(view)view.formDirty=false;});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>{if(view)close(true);});
    const contextChanged=()=>{if(view&&view.stamp!==stamp())close(true);};
    window.addEventListener('hashchange',contextChanged);
    function download(content,type,name){const href=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
    return Object.freeze({open,close:()=>close(true),contextChanged,dispose(){disposed=true;close(true);window.removeEventListener('hashchange',contextChanged);dialog.remove();}});
  }
  window.StudyTeaching=Object.freeze({install});
})();
