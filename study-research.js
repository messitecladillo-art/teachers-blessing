/* Source-labelled external knowledge research. The service owns retrieval and model work. */
(function (scope, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (scope && scope.document) scope.StudyResearch = exported;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ACTIVE = new Set(['queued', 'running', 'cancelling', 'cancel_requested']);
  const RESUMABLE = new Set(['cancelled', 'interrupted', 'failed']);
  const list = value => Array.isArray(value) ? value : [];
  function safeSourceUrl(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  }
  const markerPattern=()=>/\uE200cite\uE202[^\uE201]*\uE201/g;
  function stripResearchMarkers(value){return String(value??'').replace(markerPattern(),'');}
  function citationProtectedRanges(content,sourceUrls){
    const spans=[];
    for(let i=0;i<content.length;i++){
      if(content[i]==='`'){
        let count=1;while(content[i+count]==='`')count++;
        const end=content.indexOf('`'.repeat(count),i+count),stop=end<0?content.length:end+count;spans.push({start:i,end:stop});i=stop-1;continue;
      }
      if(content[i]==='['){
        let depth=1,j=i+1;for(;j<content.length&&depth;j++){if(content[j]==='\\'){j++;continue;}if(content[j]==='[')depth++;else if(content[j]===']')depth--;}
        if(depth||content[j]!=='(')continue;
        let end=j+1,paren=1,angle=false;for(;end<content.length&&paren;end++){const c=content[end];if(c==='\\'){end++;continue;}if(c==='<')angle=true;else if(c==='>')angle=false;else if(!angle&&c==='(')paren++;else if(!angle&&c===')')paren--;}
        const destination=content.slice(j+1,paren?content.length:end-1).trimStart();
        if(destination.startsWith('https://')||destination.startsWith('<https://'))spans.push({start:i,end:paren?(content.indexOf('\n',j)<0?content.length:content.indexOf('\n',j)):end});
      }
      if(content.startsWith('<https://',i)){const end=content.indexOf('>',i+1);if(end>=0&&safeSourceUrl(content.slice(i+1,end)))spans.push({start:i,end:end+1});}
    }
    for(const url of sourceUrls){let at=content.indexOf(url);while(at>=0){spans.push({start:at,end:at+url.length});at=content.indexOf(url,at+url.length);}}
    return spans;
  }
  /** Converts only source-verified provider-output UTF-16 ranges; never edits the stored artifact. */
  function citedResearchMarkdown(artifact){
    const content=typeof artifact?.content==='string'?artifact.content:'',annotations=list(artifact?.annotations),sources=list(artifact?.sources);
    if(!annotations.length||annotations.length>100||sources.length>100)return content;
    const allowed=new Map(),literalUrls=new Set();
    for(const source of sources){const url=safeSourceUrl(source?.url);if(!url)continue;literalUrls.add(source.url);literalUrls.add(url);let entry=allowed.get(url);if(!entry){entry={number:allowed.size+1,url,ids:new Set()};allowed.set(url,entry);}if(typeof source.id==='string')entry.ids.add(source.id);}
    const boundary=index=>index===0||index===content.length||!(content.charCodeAt(index-1)>=0xD800&&content.charCodeAt(index-1)<=0xDBFF&&content.charCodeAt(index)>=0xDC00&&content.charCodeAt(index)<=0xDFFF);
    const groups=new Map();
    for(const annotation of annotations){
      const start=annotation?.startIndex,end=annotation?.endIndex;
      if(annotation?.indexBasis!=='provider-output-text'||!['provider-url-citation','explicit-tool-url'].includes(annotation.citationKind)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>content.length||!boundary(start)||!boundary(end))continue;
      const key=start+':'+end;let group=groups.get(key);if(!group){group={start,end,refs:new Map(),overlap:false};groups.set(key,group);}
      const url=safeSourceUrl(annotation.url),source=url&&allowed.get(url);
      if(source&&(annotation.sourceId===undefined||source.ids.has(annotation.sourceId)))group.refs.set(url,source);
    }
    const ranges=[...groups.values()].sort((a,b)=>a.start-b.start||a.end-b.end),protectedRanges=citationProtectedRanges(content,literalUrls);
    for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length&&ranges[j].start<ranges[i].end;j++){ranges[i].overlap=true;ranges[j].overlap=true;}
    let result='',cursor=0;
    for(const range of ranges){
      if(range.overlap||!range.refs.size||protectedRanges.some(span=>range.start<span.end&&range.end>span.start))continue;
      const refs=[...range.refs.values()].sort((a,b)=>a.number-b.number).map(source=>'[['+source.number+']](<'+source.url.replace(/[<>()\\]/g,char=>encodeURIComponent(char))+'>)').join(' '),original=content.slice(range.start,range.end);
      const marker=markerPattern();const replacement=marker.test(original)?original.replace(markerPattern(),()=>refs):original+( /\s$/.test(original)?'':' ')+refs;
      result+=content.slice(cursor,range.start)+replacement;cursor=range.end;
    }
    return result+content.slice(cursor);
  }
  function sourceCards(sources) {
    const seen = new Set(), cards = []; let blocked = 0;
    for (const source of list(sources)) {
      const url = safeSourceUrl(source?.url);
      if (!url) { blocked++; continue; }
      if (seen.has(url)) continue;
      seen.add(url);
      const host = new URL(url).hostname;
      const video = /(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|ixigua\.com)$/.test(host);
      cards.push({url, title:typeof source.title === 'string' && source.title.trim() ? source.title : host, platform:typeof source.platform === 'string' && source.platform.trim() ? source.platform : host, host, video, access:'公开检索摘要'});
    }
    return {cards, blocked};
  }
  function extractResearchSections(value) {
    const lines=String(value||'').split(/\r?\n/), result={aligned:'',debated:''};let fence='',active=null,depth=0,buffer=[];
    const finish=()=>{if(active&&!result[active])result[active]=buffer.join('\n').trim();active=null;buffer=[];};
    for(const line of lines){const code=line.match(/^\s*(`{3,}|~{3,})/);if(code){if(!fence)fence=code[1][0];else if(fence===code[1][0])fence='';if(active)buffer.push(line);continue;}const heading=!fence&&line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);if(heading){if(active&&heading[1].length<=depth)finish();const name=heading[2];const kind=/与教材一致|教材一致|一致的部分/.test(name)?'aligned':/需要辨析|需辨析|讨论与辨析|差异与边界/.test(name)?'debated':null;if(kind&&!result[kind]){finish();active=kind;depth=heading[1].length;continue;}}if(active)buffer.push(line);}
    finish();return result;
  }
  function describeResearch(data = {}, context = {}, selectedId = null) {
    const kpId = context.knowledgePointId || context.kp?.id;
    const owner = context.userId;
    const items = list(data.items).filter(item => item && item.type === 'knowledge-research' && (!kpId || item.knowledgePointId === kpId) && (!item.userId || !owner || item.userId === owner));
    const date = item => { const value = Date.parse(item.createdAt || item.searchedAt || ''); return Number.isFinite(value) ? value : 0; };
    items.sort((a,b) => date(b)-date(a));
    const selected = items.find(item => item.id === selectedId) || items[0] || null;
    const job = data.job && data.job.type === 'knowledge-research' && (!data.job.userId || !owner || data.job.userId === owner) && (!data.job.payload?.knowledgePointId || !kpId || data.job.payload.knowledgePointId === kpId) ? data.job : null;
    const configured = typeof data.configured === 'boolean' ? data.configured : context.configured === true || context.config?.webResearchConfigured === true;
    const active = ACTIVE.has(job?.status), noResults = selected?.status === 'no-results';
    const revision = context.revision ?? context.kp?.revision;
    const stale = !!selected && (selected.stale === true || (revision !== undefined && selected.sourceRevision !== undefined && String(revision) !== String(selected.sourceRevision)));
    let title = '从不同解释中，加深对教材的理解', detail = '检索与当前教材层次相关的公开解释和讨论，再回到教材核对。';
    if (!configured) { title = '外部知识检索尚未配置'; detail = '当前仍可阅读教材、讲义和已有研究记录。配置检索服务后，可以在这里补充外部解释。'; }
    else if (active) { title = job.status === 'queued' ? '外部检索已排队' : ['cancelling','cancel_requested'].includes(job.status) ? '正在取消本次检索' : '正在检索并整理相关解释'; detail = selected ? '已有结果保留在下方；新结果以本次任务完成为准。' : '完成后会列出实际引用的来源，可对照教材阅读。'; }
    else if (job?.status === 'failed') { title = '本次外部检索未完成'; detail = '已有结果已保留，可以查看原因后重新检索。'; }
    else if (job?.status === 'cancelled') { title = '本次检索已取消'; detail = '已有研究记录仍可阅读，取消不代表检索完成。'; }
    else if (job?.status === 'interrupted') { title = '本次检索已中断'; detail = '已有记录已保留，可在条件恢复后继续。'; }
    else if (noResults) { title = '本次未找到可用的外部解释'; detail = '这不代表没有相关知识；可以稍后再检索，或先回到教材学习。'; }
    else if (selected) { title = stale ? '这份外部解析引用了旧版教材来源' : '外部解析已整理，阅读时请核对'; detail = stale ? '结果作为历史记录保留。重新检索后，才能与当前知识点来源对照。' : 'AI综合与外部观点不等于教材结论，重点核对定义、适用条件和讨论分歧。'; }
    return {items,selected,job,configured,active,noResults,stale,title,detail,sources:sourceCards(selected?.sources),canStart:configured&&!active,canResume:configured&&!!job&&RESUMABLE.has(job.status)};
  }
  function install({api, getContext, notify = () => {}, navigate = () => {}, onUpdate = () => {}} = {}) {
    if (typeof api !== 'function' || typeof getContext !== 'function') throw new TypeError('Research panel requires api and getContext');
    const doc = document, panel = doc.createElement('dialog');
    panel.id = 'research-dialog'; panel.className = 'research-dialog'; panel.setAttribute('aria-labelledby','research-title'); doc.body.append(panel);
    const entries = new Map(); let view = null, disposed = false, surface=panel;
    const owner = () => getContext()?.userId;
    const stamp = () => JSON.stringify([owner(),getContext()?.epoch]);
    const owned = entry => !disposed && !!owner() && owner() === entry.userId && entries.get(entry.kpId) === entry;
    const visible = entry => owned(entry) && view?.entry === entry && view.stamp === stamp() && (surface===panel?panel.open:surface.isConnected);
    const el = (tag, className, text, parent) => { const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;parent?.append(node);return node; };
    function icon(name,parent) { const paths={close:'M6 6l12 12M18 6 6 18',external:'M14 4h6v6m0-6-9 9M10 4H4v16h16v-6',search:'M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'};const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.search);svg.append(path);parent?.append(svg);return svg; }
    function button(text,action,parent,className='') { const node=el('button',className,text,parent);node.type='button';node.dataset.researchAction=action;return node; }
    function clearTimer(entry){if(entry.timer!==null){clearTimeout(entry.timer);entry.timer=null;}}
    function close() { const focus=view?.mode==='dialog'?view.returnFocus:null;view=null;if(panel.open)panel.close();panel.replaceChildren();if(surface!==panel)surface.remove();surface=panel;if(focus?.isConnected)focus.focus({preventScroll:true}); }
    function renderMarkdown(host,value){if(window.StudyRender?.markdown){const template=doc.createElement('template');template.innerHTML=window.StudyRender.markdown(String(value));template.content.querySelectorAll('img,picture,iframe,video,audio,source,object,embed,link').forEach(node=>node.remove());for(const link of template.content.querySelectorAll('a')){const url=safeSourceUrl(link.getAttribute('href'));if(url){link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';}else link.replaceWith(...link.childNodes);}host.append(template.content);window.StudyRender.paint?.(host);}else el('pre','research-plain',String(value),host);}
    function model(entry) { const context=getContext();return describeResearch(entry,{userId:entry.userId,knowledgePointId:entry.kpId,revision:context.kp?.id===entry.kpId?context.kp.revision:entry.kp.revision,configured:context.config?.webResearchConfigured},entry.selectedId); }
    function render(entry) {
      if(!visible(entry))return;
      const state=model(entry), slot=name=>surface.querySelector('[data-research-slot="'+name+'"]');
      slot('status-title').textContent=entry.loading&&!entry.job?'正在读取研究记录':state.title;slot('status-detail').textContent=state.detail;
      slot('status').dataset.state=state.active?'working':state.stale||entry.error||['failed','interrupted'].includes(state.job?.status)?'attention':'idle';
      slot('status').hidden=!!state.selected&&!state.active&&!state.stale&&!entry.error&&!['failed','interrupted','cancelled'].includes(state.job?.status)&&!state.noResults&&state.configured;
      const announcement=[entry.job?.id,entry.job?.status,state.title,entry.error].join(':');if(view.announcement!==announcement){view.announcement=announcement;slot('announcement').textContent=entry.error||state.title;}
      const alert=slot('alert');alert.hidden=!entry.error&&!entry.job?.error?.message;alert.textContent=entry.error||entry.job?.error?.message||'';
      const selector=slot('history'), historyKey=JSON.stringify(state.items.map(item=>[item.id,item.searchedAt,item.createdAt,item.stale]));
      if(view.historyKey!==historyKey){view.historyKey=historyKey;selector.replaceChildren();for(const [index,item]of state.items.entries()){const timestamp=new Date(item.searchedAt||item.createdAt||'');const label=Number.isFinite(timestamp.getTime())?timestamp.toLocaleString('zh-CN'):'时间未记录';const option=el('option','',`${index===0?'最近一次 · ':''}${label}${item.stale?' · 旧版来源':''}`,selector);option.value=item.id;}}
      selector.parentElement.hidden=state.items.length<2;if(state.selected)selector.value=state.selected.id;
      surface.querySelector('#research-tab-panel')?.setAttribute('aria-labelledby','research-tab-'+view.tab);
      for(const tab of surface.querySelectorAll('[data-research-tab]')){const active=tab.dataset.researchTab===view.tab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
      const selected=state.selected, contentKey=JSON.stringify([selected?.id,selected?.content,selected?.annotations,selected?.status,selected?.sources,state.stale,view.tab]);
      if(view.contentKey!==contentKey){view.contentKey=contentKey;const host=slot('content');host.replaceChildren();const sources=slot('sources');sources.replaceChildren();sources.parentElement.hidden=!selected;
        if(!selected){const empty=el('div','research-empty',undefined,host);icon('search',empty);el('h3','',entry.unavailable?'这个知识点已不可用':'给教材多一个理解的角度',empty);el('p','','从公开知识媒体的解释与讨论中寻找例子、疑问和不同观点，保持教材来源可核对。',empty);}
        else {
          const sections=extractResearchSections(stripResearchMarkers(selected.content)),header=el('header','research-result-header',undefined,host);el('p','research-result-label',state.noResults?'检索记录':state.stale?'历史结果 · 来源已变化':'AI 综合 · 待核对',header);el('h3','',view.tab==='video'?'视频来源':view.tab==='discussion'?'讨论与辨析':'外部资料综合',header);
          if(state.stale)el('p','research-stale','知识点来源已有修订，这份结果不会作为当前版本展示。',header);
          const content=view.tab==='video'?'以下链接来自公开视频平台的检索摘要。打开原来源后，可结合视频内容自行核对。':view.tab==='discussion'?sections.debated:stripResearchMarkers(citedResearchMarkdown(selected));
          if(content){const prose=el('article','prose research-prose',undefined,host);renderMarkdown(prose,content);}
          else if(view.tab==='discussion')el('p','research-help','这份综合尚无单独的辨析段落，可打开原来源核对观点与适用条件。',host);
          else el('p','research-help',state.noResults?'本次没有保存可用的外部来源或综合内容。':'本次记录没有可显示的综合正文。',host);
          const searched=new Date(selected.searchedAt||''),when=Number.isFinite(searched.getTime())?'检索于 '+searched.toLocaleString('zh-CN')+' · ':'';
          const info=el('p','research-source-note',when+'以下来源来自公开检索摘要，未据此声称已通读全文、观看视频或阅读评论。'+(view.tab==='discussion'?'本摘录未提供逐句映射，请从来源卡核对。':''),sources);info.id='research-source-note';
          const filtered=state.sources.cards.filter(source=>view.tab==='video'?source.video:view.tab==='discussion'?!source.video:true);
          if(filtered.length){const cards=el('div','research-source-grid',undefined,sources);for(const source of filtered){const card=el('a','research-source-card',undefined,cards);card.href=source.url;card.target='_blank';card.rel='noopener noreferrer';card.referrerPolicy='no-referrer';card.setAttribute('aria-label','在新页面打开来源：'+source.title);el('span','research-platform',source.platform,card);const copy=el('div','research-source-copy',undefined,card);el('strong','',source.title,copy);el('small','',source.host,copy);icon('external',card);}}
          else el('p','research-help',view.tab==='video'?'本次记录没有视频平台的可用来源。':'本次记录没有符合当前分类的有效 HTTPS 来源链接。',sources);
          if(state.sources.blocked)el('p','research-help',`${state.sources.blocked} 个来源链接格式不安全，未提供跳转。`,sources);
          if(view.tab==='explanation'){if(sections.aligned||sections.debated)el('p','research-help','以下对照摘录未提供逐句映射，请从来源卡核对。',sources);const comparison=el('section','research-comparison',undefined,sources);for(const [key,title]of [['aligned','与教材一致的部分'],['debated','需要辨析的部分']]){const card=el('article','research-comparison-card',undefined,comparison);el('h4','',title,card);if(sections[key])renderMarkdown(el('div','prose',undefined,card),sections[key]);else el('p','',key==='aligned'?'尚无逐项对照记录，请核对定义与推导。':'尚无单列辨析记录，请核对前提与边界。',card);}}
        }
      }
      const actions=slot('actions'),actionKey=JSON.stringify([state.configured,state.active,state.canResume,entry.job?.id,entry.job?.status,entry.busy,entry.loading,entry.unavailable,state.items.length]);
      if(view.actionKey!==actionKey){view.actionKey=actionKey;const focused=doc.activeElement?.closest('[data-research-action]')?.dataset.researchAction;actions.replaceChildren();if(state.active){button('取消本次检索','cancel',actions);}else if(!entry.unavailable){if(state.canResume)button('继续未完成的检索','resume',actions);const start=button(state.items.length?'重新检索并综合':'检索并综合','start',actions,'primary');start.disabled=!state.configured||entry.busy||entry.loading;}button('刷新记录','refresh',actions,'quiet');button('返回教材','book',actions,'quiet');for(const node of actions.querySelectorAll('button'))if(entry.busy)node.disabled=true;if(focused)[...actions.querySelectorAll('button')].find(node=>node.dataset.researchAction===focused&&!node.disabled)?.focus({preventScroll:true});}
      slot('persistence').textContent=state.active?'关闭面板不会取消检索。已有研究记录会保留。':'外部观点用于辅助理解，AI综合请与教材和原来源交叉核对。';
    }
    function schedule(entry,delay=1500,force=false){clearTimer(entry);if(owned(entry)&&(force||ACTIVE.has(entry.job?.status)))entry.timer=setTimeout(()=>poll(entry),delay);}
    function updated(entry){if(!owned(entry))return;const value=JSON.stringify([entry.items,entry.job,entry.configured]);render(entry);if(value!==entry.notified){entry.notified=value;try{onUpdate({knowledgePointId:entry.kpId,items:entry.items,job:entry.job,configured:entry.configured});}catch{notify('研究记录已保存，页面指示暂未更新。',true);}}}
    function acceptJob(entry,job){if(!job||job.type!=='knowledge-research'||job.userId&&job.userId!==entry.userId||job.payload?.knowledgePointId&&job.payload.knowledgePointId!==entry.kpId)throw new Error('研究任务与当前知识点不一致，未展示结果。');entry.job=job;}
    async function refresh(entry){if(!owned(entry))return;if(entry.busy){entry.reconcile=true;schedule(entry,1500,true);return;}const request=++entry.request;entry.loading=true;render(entry);try{const data=await api('/knowledge-points/'+encodeURIComponent(entry.kpId)+'/research');if(!owned(entry)||entry.request!==request)return;entry.items=list(data?.items);entry.job=null;if(data?.job)acceptJob(entry,data.job);entry.configured=typeof data?.configured==='boolean'?data.configured:getContext().config?.webResearchConfigured===true;entry.error=null;entry.unavailable=false;entry.failures=0;updated(entry);schedule(entry);}catch(error){if(!owned(entry)||entry.request!==request)return;handleError(entry,error);if(error?.code==='STALE_VIEW')schedule(entry,800,true);}finally{if(owned(entry)&&entry.request===request){entry.loading=false;render(entry);}}}
    function handleError(entry,error){if(!owned(entry)||error?.code==='STALE_VIEW')return;entry.error=error?.message||'暂时无法读取研究记录，后台任务可能仍在继续。';if([401,403,404].includes(error?.status)){clearTimer(entry);entry.items=[];entry.job=null;entry.unavailable=true;}render(entry);}
    async function poll(entry){if(!owned(entry))return;if(entry.polling||entry.busy){schedule(entry,1500,true);return;}entry.polling=true;const request=++entry.request;try{if(!ACTIVE.has(entry.job?.status)){await refresh(entry);return;}const job=await api('/jobs/'+encodeURIComponent(entry.job.id));if(!owned(entry)||entry.request!==request)return;acceptJob(entry,job);entry.error=null;entry.failures=0;updated(entry);if(ACTIVE.has(job.status))schedule(entry);else await refresh(entry);}catch(error){if(!owned(entry)||entry.request!==request)return;handleError(entry,error);if(![401,403,404].includes(error?.status)){entry.failures++;schedule(entry,error?.code==='STALE_VIEW'?800:Math.min(10000,1500*2**Math.min(entry.failures,3)),true);}}finally{entry.polling=false;}}
    function bindSurface(node){
      node.addEventListener('click',event=>{const tab=event.target.closest('[data-research-tab]');if(tab&&view){view.tab=tab.dataset.researchTab;render(view.entry);return;}const actionNode=event.target.closest('[data-research-action]');if(actionNode&&!actionNode.disabled)action(actionNode.dataset.researchAction).catch(error=>notify(error?.message||'操作未完成。',true));});
      node.addEventListener('change',event=>{if(event.target.dataset.researchSlot==='history'&&view?.entry){view.entry.selectedId=event.target.value;render(view.entry);}});
      node.addEventListener('keydown',event=>{const tab=event.target.closest('[data-research-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!view)return;const tabs=[...node.querySelectorAll('[data-research-tab]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;event.preventDefault();view.tab=tabs[next].dataset.researchTab;render(view.entry);tabs[next].focus();});
    }
    function show(entry,host=null){
      close();if(host){surface=el('section','research-page',undefined,host);bindSurface(surface);}
      view={entry,stamp:stamp(),returnFocus:doc.activeElement,mode:host?'page':'dialog',tab:'explanation'};
      const header=el('header','research-heading',undefined,surface),copy=el('div','',undefined,header);
      el('p','research-eyebrow','外部解析与讨论',copy);const title=el('h2','','换个角度，理解更深',copy);title.id='research-title';
      if(!host){const closeButton=button('','close',header,'research-close');icon('close',closeButton);closeButton.setAttribute('aria-label','关闭外部解析与讨论');}
      const context=el('section','research-context',undefined,surface);el('p','',entry.bookTitle,context);el('h3','',entry.kp.title||'当前知识点',context);if(entry.chapterTitle)el('small','',entry.chapterTitle,context);
      const tabs=el('div','research-tabs',undefined,surface);tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','外部解释类型');
      for(const [id,title]of [['explanation','直觉解释'],['video','视频讲解'],['discussion','讨论与辨析']]){const tab=el('button','',title,tabs);tab.type='button';tab.dataset.researchTab=id;tab.id='research-tab-'+id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','research-tab-panel');}
      const body=el('div','research-body',undefined,surface);body.id='research-tab-panel';body.setAttribute('role','tabpanel');
      function slot(tag,name,className,parent=body){const node=el(tag,className,undefined,parent);node.dataset.researchSlot=name;return node;}
      const status=slot('section','status','research-status');slot('h3','status-title','',status);slot('p','status-detail','',status);
      const live=slot('p','announcement','sr-only');live.setAttribute('role','status');live.setAttribute('aria-live','polite');slot('p','alert','research-error');
      const history=el('label','research-history','研究记录',body),select=slot('select','history','',history);select.setAttribute('aria-label','选择研究记录版本');slot('section','content','research-content');
      const refs=el('details','research-references',undefined,body);refs.open=true;el('summary','','公开来源',refs);slot('div','sources','',refs);
      const footer=el('footer','research-footer',undefined,surface);slot('p','persistence','',footer);slot('div','actions','research-actions',footer);
      if(!host)panel.showModal();render(entry);
    }
    async function activate(kpId,host){
      if(disposed)throw new Error('Research panel has been disposed');if(typeof kpId!=='string'||!kpId||kpId.length>100)throw new TypeError('A knowledge point ID is required');
      const context=getContext();if(!context.userId)throw new Error('请先登录后查看外部解析。');let entry=entries.get(kpId);
      if(!entry||entry.userId!==context.userId){const points=list(context.outline?.knowledgePoints);const kp=context.kp?.id===kpId?context.kp:points.find(point=>point.id===kpId)||{id:kpId,title:'教材知识点'};const chapter=list(context.outline?.chapters).find(item=>item.id===kp.chapterId);entry={kpId,userId:context.userId,kp:{...kp},bookId:context.book?.id||kp.textbookId,bookTitle:context.book?.title||'教材学习',chapterTitle:chapter?.title||'',items:[],job:null,configured:context.config?.webResearchConfigured===true,timer:null,request:0,operation:0,polling:false,busy:false,loading:false,failures:0};entries.set(kpId,entry);}
      show(entry,host);await refresh(entry);return {items:entry.items,job:entry.job,configured:entry.configured};
    }
    const open=kpId=>activate(kpId,null);
    function mount(host,kpId){if(typeof host==='string')host=doc.querySelector(host);if(!host||host.nodeType!==1)throw new TypeError('Research mount requires an existing host element');return activate(kpId,host);}
    async function action(name){const entry=view?.entry;if(!entry||!visible(entry))return;if(name==='close'){close();return;}if(name==='book'){close();if(entry.bookId)navigate('/textbook/'+encodeURIComponent(entry.bookId)+'/kp/'+encodeURIComponent(entry.kpId));return;}if(name==='refresh'){await refresh(entry);return;}if(entry.busy||!['start','cancel','resume'].includes(name))return;const state=model(entry);if(name==='start'&&!state.canStart||name==='resume'&&!state.canResume||name==='cancel'&&!state.active)return;entry.busy=true;entry.loading=false;entry.error=null;if(name==='start')entry.selectedId=null;clearTimer(entry);entry.request++;const operation=++entry.operation;render(entry);try{const path=name==='start'?'/knowledge-points/'+encodeURIComponent(entry.kpId)+'/research':'/jobs/'+encodeURIComponent(entry.job.id)+'/'+name;const job=await api(path,{method:'POST',data:{}});if(!owned(entry)||entry.operation!==operation)return;acceptJob(entry,job);updated(entry);schedule(entry);if(!ACTIVE.has(job.status))await refresh(entry);}catch(error){if(owned(entry)&&entry.operation===operation){handleError(entry,error);if(error?.code==='STALE_VIEW')entry.reconcile=true;}}finally{if(owned(entry)&&entry.operation===operation){entry.busy=false;render(entry);schedule(entry,entry.reconcile?800:1500,!!entry.reconcile);entry.reconcile=false;}}}
    bindSurface(panel);
    panel.addEventListener('cancel',event=>{event.preventDefault();close();});
    function contextChanged(){const userId=owner();for(const [id,entry]of entries)if(entry.userId!==userId){clearTimer(entry);entry.request++;entries.delete(id);}if(view&&view.stamp!==stamp())close();for(const entry of entries.values())if(ACTIVE.has(entry.job?.status))schedule(entry,800);}
    const ended=()=>{close();for(const entry of entries.values()){clearTimer(entry);entry.request++;}entries.clear();};
    window.addEventListener('study-session-ended',ended);
    function dispose(){if(disposed)return;ended();disposed=true;window.removeEventListener('study-session-ended',ended);panel.remove();}
    return Object.freeze({open,mount,close,contextChanged,dispose});
  }
  return Object.freeze({install,safeSourceUrl,sourceCards,extractResearchSections,describeResearch,citedResearchMarkdown,stripResearchMarkers});
});
