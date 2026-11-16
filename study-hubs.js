/* Real entry points for teaching, research and saved knowledge. No generation happens here. */
(function(scope,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;if(scope?.document)scope.StudyHubs=value;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const rows=value=>Array.isArray(value)?value:[];
  const idOK=value=>typeof value==='string'&&value.length>0&&value.length<=100;
  const ordered=(a,b)=>(Number.isFinite(a.order)?a.order:0)-(Number.isFinite(b.order)?b.order:0);
  const date=value=>{const parsed=new Date(value||'');return Number.isFinite(parsed.getTime())?parsed.toLocaleDateString('zh-CN'):'日期未记录';};
  function install({api,getContext,navigate=()=>{},notify=()=>{}}={}){
    if(typeof api!=='function'||typeof getContext!=='function')throw new TypeError('Study hubs require api and getContext');
    const doc=document;let view=null,disposed=false;
    const stamp=()=>JSON.stringify([getContext()?.userId,getContext()?.epoch]);
    const current=v=>!disposed&&view===v&&v.stamp===stamp()&&!!getContext()?.userId&&v.node.isConnected;
    function el(tag,className,text,parent){const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;parent?.append(node);return node;}
    function icon(name,parent){const glyphs={book:'M4 5.5c3-1 5-.4 8 1.5 3-1.9 5-2.5 8-1.5v14c-3-1-5-.4-8 1.5-3-1.9-5-2.5-8-1.5zM12 7v14',research:'M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',teaching:'M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5',bookmark:'M6 3h12v18l-6-4-6 4V3z',arrow:'M5 12h14m-5-5 5 5-5 5',close:'M7 7l10 10M17 7 7 17'};const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',glyphs[name]||glyphs.book);svg.append(path);parent?.append(svg);return svg;}
    function button(text,action,parent,className=''){const node=el('button',className,text,parent);node.type='button';node.dataset.hubAction=action;return node;}
    function slot(v,name){return v.node.querySelector('[data-hub-slot="'+name+'"]');}
    function named(tag,name,className,parent){const node=el(tag,className,undefined,parent);node.dataset.hubSlot=name;return node;}
    function clear(){if(view){view.request++;view.listRequest++;view.node.remove();}view=null;}
    function empty(host,kind,title,description,action){host.replaceChildren();if(action){const art=el('img','hubs-empty-art',undefined,host);art.src='/assets/ui/auth-books-v1.png';art.alt='';art.setAttribute('aria-hidden','true');}else{const mark=el('span','hubs-empty-mark',undefined,host);icon(kind,mark);}el('h2','',title,host);el('p','',description,host);if(action)button(action.text,action.name,host,action.primary?'primary':'');}
    function shell(host,kind){
      clear();const context=getContext();if(!context.userId)throw new Error('请先登录学习账户。');
      const node=el('section','hubs-page hubs-'+kind,undefined,host);const v={node,kind,stamp:stamp(),request:0,listRequest:0,books:rows(context.books).filter(book=>idOK(book.id)&&(!book.userId||book.userId===context.userId)),bookId:'',chapterId:'',kpId:'',chapters:[],points:[],items:[],pendingDeletes:new Set(),loading:false,error:null};view=v;
      const heading=el('header','hubs-heading',undefined,node),mark=el('span','hubs-heading-mark',undefined,heading);icon(kind==='bookmarks'?'bookmark':kind,mark);const copy=el('div','',undefined,heading);
      el('p','hubs-eyebrow',kind==='research'?'研读 · 多一个理解的角度':kind==='teaching'?'备课 · 从理解到教学':'收藏 · 留下值得重读的知识',copy);
      el('h1','',kind==='research'?'换个角度，理解更深':kind==='teaching'?'准备一堂好课':'值得再读一遍',copy);
      el('p','hubs-intro',kind==='research'?'从教材中的一个知识点出发，参考外部解释与讨论。':kind==='teaching'?'选好教材，带着真实来源进入教学设计。':'把重要的知识点留在这里，回到来源继续思考。',copy);
      const live=named('p','announcement','sr-only',node);live.setAttribute('role','status');live.setAttribute('aria-live','polite');
      named('p','error','hubs-error',node).hidden=true;
      if(kind==='bookmarks'){
        const toolbar=el('div','hubs-list-toolbar',undefined,node);named('p','count','',toolbar);button('刷新收藏','refresh',toolbar,'quiet');named('div','list','hubs-bookmark-list',node);
      }else if(!v.books.length){
        const host=el('div','hubs-empty',undefined,node);empty(host,'book','先带来一本教材','导入教材并按真实章节解析后，就能选择知识点。',{text:'前往我的教材',name:'library',primary:true});
      }else{
        const scope=el('section','hubs-scope',undefined,node);el('h2','',kind==='research'?'从一个知识点开始':'选择备课的教材与范围',scope);
        const grid=el('div','hubs-fields',undefined,scope);
        for(const [name,title,placeholder]of [['book','教材','请选择一本教材'],['chapter','章节','先选择教材']]){const label=el('label','hubs-field',title,grid),select=named('select',name,'',label);select.setAttribute('aria-label',title);const option=el('option','',placeholder,select);option.value='';if(name==='book')for(const book of v.books){const option=el('option','',book.title||'未命名教材',select);option.value=book.id;}else select.disabled=true;}
        named('p','scope-note','hubs-scope-note',scope);const points=named('fieldset','points','hubs-point-choice',scope);el('legend','','知识点',points);
        const footer=el('footer','hubs-scope-footer',undefined,scope);named('p','selection','',footer);const start=button(kind==='research'?'进入知识点研读':'进入教材备课','continue',footer,'primary');icon('arrow',start);start.disabled=true;
        const next=el('div','hubs-next-step',undefined,node);icon(kind,next);const copy=el('div','',undefined,next);el('h2','',kind==='research'?'外部解释，始终回到教材核对':'把所学转成一份可修订的教学任务',copy);el('p','',kind==='research'?'公开检索摘要会保留出处。视频、文章与讨论的实际内容，需要打开原来源核对。':'进入后再确认教学目标与资料范围，编辑、审阅已有教学包；此处不会自动生成内容。',copy);
      }
      node.addEventListener('change',event=>onChange(v,event));node.addEventListener('click',event=>{const target=event.target.closest('[data-hub-action]');if(target&&!target.disabled)action(v,target).catch(error=>{if(current(v)&&error?.code!=='STALE_VIEW')showError(v,error.message||'操作未完成。');});});
      return v;
    }
    function showError(v,message){if(!current(v))return;v.error=message;const error=slot(v,'error');error.hidden=!message;error.textContent=message||'';slot(v,'announcement').textContent=message||'';}
    function renderScope(v){
      if(!current(v)||!slot(v,'points'))return;
      const chapterSelect=slot(v,'chapter'),key=JSON.stringify([v.bookId,v.chapters.map(chapter=>[chapter.id,chapter.title]),v.loading]);
      if(chapterSelect.dataset.key!==key){chapterSelect.dataset.key=key;chapterSelect.replaceChildren();const first=el('option','',v.loading?'正在读取目录':v.chapters.length?'请选择真实章节':'尚无可用章节',chapterSelect);first.value='';for(const chapter of v.chapters){const option=el('option','',chapter.title||'未命名章节',chapterSelect);option.value=chapter.id;}}
      chapterSelect.value=v.chapterId;chapterSelect.disabled=v.loading||!v.chapters.length||v.needsReview;
      const note=slot(v,'scope-note');note.replaceChildren();
      if(v.loading)note.textContent='正在读取教材目录…';
      else if(v.needsReview){el('span','','教材目录待核对，请先确认真实章节。',note);button('核对目录','outline',note,'quiet');}
      else if(v.bookId&&!v.points.length){el('span','','这本教材尚无可用知识点，请先按章解析。',note);button('打开教材','book',note,'quiet');}
      else if(!v.bookId)note.textContent='只使用当前账户的教材与实际目录。';
      else note.textContent=v.chapterId?(v.points.filter(point=>point.chapterId===v.chapterId).length+' 个知识点可选择'):'选择一个章节，再确定知识点。';
      const host=slot(v,'points'),focused=doc.activeElement?.value;host.replaceChildren();el('legend','','知识点',host);
      const points=v.points.filter(point=>point.chapterId===v.chapterId);
      if(!v.loading&&!v.needsReview)for(const point of points){const label=el('label','hubs-point',undefined,host),input=el('input','',undefined,label);input.type='radio';input.name='hubs-knowledge-point';input.value=point.id;input.checked=v.kpId===point.id;const copy=el('span','hubs-point-copy',undefined,label);el('strong','',point.title||'未命名知识点',copy);if(point.sourceAnchor?.startPage)el('small','','来源 '+point.sourceAnchor.startPage+(point.sourceAnchor.endPage!==point.sourceAnchor.startPage?'–'+point.sourceAnchor.endPage:'')+' 页',copy);}
      host.hidden=!points.length||v.loading||v.needsReview;
      if(focused&&host.querySelector('input:checked')?.value===focused)host.querySelector('input:checked').focus({preventScroll:true});
      const selected=v.points.find(point=>point.id===v.kpId),chapter=v.chapters.find(chapter=>chapter.id===v.chapterId);
      slot(v,'selection').textContent=selected?selected.title:chapter?(v.kind==='teaching'?'进入后可继续确认本章备课范围':'请选择一个知识点'):'';
      const start=v.node.querySelector('[data-hub-action="continue"]');start.disabled=v.loading||v.needsReview||!v.bookId||!v.chapterId||!points.length||(v.kind==='research'&&!selected);
    }
    async function outline(v,bookId){
      v.bookId=bookId;v.chapterId='';v.kpId='';v.chapters=[];v.points=[];v.needsReview=false;v.loading=!!bookId;const request=++v.request;showError(v,null);renderScope(v);if(!bookId)return;
      try{const data=await api('/textbooks/'+encodeURIComponent(bookId)+'/outline');if(!current(v)||v.request!==request||v.bookId!==bookId)return;v.chapters=rows(data?.chapters).filter(chapter=>idOK(chapter.id)&&!chapter.archived&&(!chapter.textbookId||chapter.textbookId===bookId)).sort(ordered);const ids=new Set(v.chapters.map(chapter=>chapter.id));v.points=rows(data?.knowledgePoints).filter(point=>idOK(point.id)&&!point.archived&&ids.has(point.chapterId)&&(!point.textbookId||point.textbookId===bookId)).sort(ordered);v.needsReview=data?.directoryNeedsReview===true||data?.requiresOutlineReview===true;v.chapterId=v.chapters[0]?.id||'';slot(v,'announcement').textContent=v.needsReview?'教材目录待核对':'已读取 '+v.chapters.length+' 个真实章节';}
      catch(error){if(current(v)&&v.request===request&&error?.code!=='STALE_VIEW')showError(v,error?.message||'暂时无法读取目录，请重新选择教材。');}
      finally{if(current(v)&&v.request===request){v.loading=false;renderScope(v);}}
    }
    function onChange(v,event){if(!current(v))return;const field=event.target.dataset.hubSlot;if(field==='book'){outline(v,event.target.value);return;}if(field==='chapter'){v.chapterId=event.target.value;v.kpId='';renderScope(v);return;}if(event.target.name==='hubs-knowledge-point'){v.kpId=event.target.value;renderScope(v);}}
    function bookmarkRoute(item){if(!item?.canOpen||!idOK(item.textbookId)||!idOK(item.knowledgePointId))return null;const expected='/textbook/'+encodeURIComponent(item.textbookId)+'/kp/'+encodeURIComponent(item.knowledgePointId);return item.route===expected?expected:null;}
    function renderBookmarks(v){
      if(!current(v))return;const host=slot(v,'list'),focused=host.contains(doc.activeElement)?{id:doc.activeElement.closest('.hubs-bookmark')?.dataset.kpId,remove:doc.activeElement.matches('button')}:null;host.replaceChildren();host.setAttribute('aria-busy',String(v.loading||v.pendingDeletes.size>0));slot(v,'count').textContent=v.loading?'正在读取收藏…':v.items.length+' 个知识点';
      if(!v.items.length){host.classList.add('hubs-empty');empty(host,'bookmark',v.loading?'正在读取收藏':'给重要的知识留一个位置',v.loading?'请稍候。':'在教材阅读页收藏知识点，之后就能从这里回来。',v.loading?null:{text:'去读一本教材',name:'library',primary:true});if(focused)v.node.querySelector('[data-hub-action="refresh"]')?.focus({preventScroll:true});return;}
      host.classList.remove('hubs-empty');
      for(const item of v.items){const card=el('article','hubs-bookmark',undefined,host),mark=el('span','hubs-bookmark-mark',undefined,card);card.dataset.kpId=item.knowledgePointId;icon('bookmark',mark);const copy=el('div','hubs-bookmark-copy',undefined,card);el('p','hubs-bookmark-scope',[item.textbookTitle,item.chapterTitle].filter(Boolean).join(' · '),copy);const route=bookmarkRoute(item),title=item.currentTitle||item.title||'已收藏知识点';if(route){const link=el('a','hubs-bookmark-title',title,copy);link.href='#'+route;}else el('h2','hubs-bookmark-title',title,copy);const info=el('div','hubs-bookmark-meta',undefined,copy);el('span','',date(item.createdAt)+' 收藏',info);if(item.stale)el('span','hubs-stale',item.canOpen?'来源已更新 · 可打开当前版本':'来源已失效 · 记录保留',info);const remove=button('','remove',card,'hubs-remove');remove.dataset.knowledgePointId=item.knowledgePointId;remove.disabled=v.pendingDeletes.has(item.knowledgePointId);remove.setAttribute('aria-label',(remove.disabled?'正在取消收藏：':'取消收藏：')+title);remove.title='取消收藏';icon('close',remove);}
      if(focused){const card=[...host.querySelectorAll('.hubs-bookmark')].find(node=>node.dataset.kpId===focused.id),target=card?.querySelector(focused.remove?'button:not(:disabled)':'a[href]')||v.node.querySelector('[data-hub-action="refresh"]');target?.focus({preventScroll:true});}
    }
    async function loadBookmarks(v){
      if(!current(v))return;const request=++v.listRequest;v.loading=true;renderBookmarks(v);
      try{const data=await api('/bookmarks');if(!current(v)||v.listRequest!==request)return;v.items=rows(data?.items).filter(item=>item?.type==='knowledge-bookmark'&&idOK(item.knowledgePointId));showError(v,null);slot(v,'announcement').textContent='已读取 '+v.items.length+' 个收藏知识点';}
      catch(error){if(current(v)&&v.listRequest===request&&error?.code!=='STALE_VIEW')showError(v,error?.message||'暂时无法读取收藏，已有列表保留。');}
      finally{if(current(v)&&v.listRequest===request){v.loading=false;renderBookmarks(v);}}
    }
    async function action(v,node){
      if(!current(v))return;const name=node.dataset.hubAction;
      if(name==='library'){navigate('/textbooks');return;}
      if(name==='book'||name==='outline'){if(v.bookId)navigate('/textbook/'+encodeURIComponent(v.bookId),name==='outline'?{outlineReview:true}:{});return;}
      if(name==='continue'){
        if(v.loading||v.needsReview||!v.bookId||!v.chapterId)return;
        if(v.kind==='research'&&v.points.some(point=>point.id===v.kpId&&point.chapterId===v.chapterId))navigate('/textbook/'+encodeURIComponent(v.bookId)+'/kp/'+encodeURIComponent(v.kpId)+'/research');
        else if(v.kind==='teaching')navigate('/textbook/'+encodeURIComponent(v.bookId),{teaching:true,chapterId:v.chapterId,...(v.kpId?{knowledgePointId:v.kpId}:{})});return;
      }
      if(name==='refresh'){await loadBookmarks(v);return;}
      if(name==='remove'){
        const kpId=node.dataset.knowledgePointId;if(!idOK(kpId)||v.pendingDeletes.has(kpId))return;v.pendingDeletes.add(kpId);v.bookmarksDirty=true;v.listRequest++;v.loading=false;showError(v,null);renderBookmarks(v);
        try{await api('/bookmarks/'+encodeURIComponent(kpId),{method:'DELETE',data:{}});if(current(v))slot(v,'announcement').textContent='已取消收藏，正在读取最新列表';}
        catch(error){if(current(v)&&error?.code!=='STALE_VIEW')showError(v,error?.message||'取消收藏未完成，请核对最新记录。');}
        finally{if(current(v)){v.pendingDeletes.delete(kpId);if(!v.pendingDeletes.size&&v.bookmarksDirty){v.bookmarksDirty=false;const failure=v.error;await loadBookmarks(v);if(failure&&current(v))showError(v,failure);}else renderBookmarks(v);}}
      }
    }
    async function mount(host,kind){if(disposed)throw new Error('Study hubs have been disposed');if(!['research','teaching','bookmarks'].includes(kind))throw new TypeError('Unknown study hub');if(typeof host==='string')host=doc.querySelector(host);if(!host||host.nodeType!==1)throw new TypeError('Study hub requires an existing mount element');const v=shell(host,kind);if(kind==='bookmarks')await loadBookmarks(v);else renderScope(v);}
    function contextChanged(){if(view&&view.stamp!==stamp())clear();}
    const ended=()=>clear();window.addEventListener('study-session-ended',ended);
    function dispose(){if(disposed)return;clear();disposed=true;window.removeEventListener('study-session-ended',ended);}
    return Object.freeze({mount,contextChanged,dispose});
  }
  return Object.freeze({install});
});
