'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {safeSourceUrl,sourceCards,describeResearch,extractResearchSections,citedResearchMarkdown,stripResearchMarkers}=require('../study-research.js');
const context={userId:'A',knowledgePointId:'kp1',revision:2,configured:true};
const artifact=(changes={})=>({id:'a1',userId:'A',type:'knowledge-research',knowledgePointId:'kp1',sourceRevision:2,title:'条件概率的解释',content:'根据教材核对前提。',status:'generated-review-required',createdAt:'2026-11-17T01:00:00Z',sources:[{url:'https://www.zhihu.com/question/123',title:'解释与讨论',platform:'知乎',access:'search-index'}],...changes});
const job=(changes={})=>({id:'j1',userId:'A',type:'knowledge-research',payload:{knowledgePointId:'kp1'},status:'running',...changes});

test('source URLs require absolute credential-free HTTPS and exclude controls',()=>{
  assert.equal(safeSourceUrl('https://www.bilibili.com/video/BV123?from=course'),'https://www.bilibili.com/video/BV123?from=course');
  for(const value of ['javascript:alert(1)','data:text/html,hi','http://example.com','//example.com/path','https://user:secret@example.com','https://example.com/\npath','https://example.com/ path','not a url',null])assert.equal(safeSourceUrl(value),null,String(value));
});
test('sources preserve untrusted labels as text, dedupe URLs and do not invent metadata',()=>{
  const result=sourceCards([{url:'https://www.zhihu.com/question/1',title:'<img onerror=alert(1)>',platform:'<script>bad</script>'},{url:'https://www.zhihu.com/question/1',title:'duplicate'},{url:'javascript:1',title:'blocked'},{url:'https://example.edu/reference'}]);
  assert.equal(result.blocked,1);assert.equal(result.cards.length,2);assert.equal(result.cards[0].title,'<img onerror=alert(1)>');assert.equal(result.cards[0].platform,'<script>bad</script>');assert.equal(result.cards[0].access,'公开检索摘要');assert.equal(result.cards[1].title,'example.edu');assert.equal(Object.hasOwn(result.cards[0],'author'),false);
});
test('video classification is based on real platform domains, not display labels',()=>{
  const result=sourceCards([{url:'https://www.bilibili.com/video/BV1',platform:'B站'},{url:'https://bilibili.com.evil.example/video/1',platform:'B站'},{url:'https://youtu.be/123'}]);
  assert.deepEqual(result.cards.map(source=>source.video),[true,false,true]);
});
test('newest created record is selected without mutating the provided history',()=>{
  const old=artifact({id:'old',createdAt:'2026-11-16T01:00:00Z',searchedAt:'2026-11-18T01:00:00Z'}),fresh=artifact({id:'new',createdAt:'2026-11-17T01:00:00Z'}),items=Object.freeze([Object.freeze(old),Object.freeze(fresh)]);
  const result=describeResearch({items,configured:true},context);assert.equal(result.selected.id,'new');assert.equal(items[0].id,'old');assert.equal(describeResearch({items,configured:true},context,'old').selected.id,'old');
});
test('foreign artifacts/jobs and wrong KP/type are excluded from the public view',()=>{
  const result=describeResearch({configured:true,items:[artifact(),artifact({id:'foreign',userId:'B'}),artifact({id:'wrong',knowledgePointId:'kp2'}),artifact({id:'type',type:'personal-summary'})],job:job({payload:{knowledgePointId:'kp2'}})},context);
  assert.deepEqual(result.items.map(item=>item.id),['a1']);assert.equal(result.job,null);assert.equal(result.active,false);
  assert.equal(describeResearch({job:job({userId:'B'})},context).job,null);
});
test('unconfigured service keeps history readable while preventing start and resume',()=>{
  const result=describeResearch({items:[artifact()],job:job({status:'failed'}),configured:false},context);
  assert.equal(result.selected.id,'a1');assert.equal(result.canStart,false);assert.equal(result.canResume,false);assert.match(result.title,/尚未配置/);
});
test('running and cancellation are activity states, without completion or fabricated percentages',()=>{
  for(const status of ['queued','running','cancelling','cancel_requested']){const result=describeResearch({configured:true,job:job({status})},context);assert.equal(result.active,true);assert.equal(result.canStart,false);assert.equal(result.canResume,false);assert.equal(Object.hasOwn(result,'percent'),false);}
  const result=describeResearch({configured:true,job:job({status:'cancelled'})},context);assert.equal(result.active,false);assert.equal(result.canResume,true);assert.match(result.title,/取消/);
});
test('no-results is an honest terminal record and an old revision remains visibly stale',()=>{
  const empty=describeResearch({configured:true,items:[artifact({status:'no-results',sources:[]})],job:job({status:'completed'})},context);assert.equal(empty.noResults,true);assert.match(empty.title,/未找到/);assert.equal(empty.sources.cards.length,0);
  const stale=describeResearch({configured:true,items:[artifact({sourceRevision:1})]},context);assert.equal(stale.stale,true);assert.match(stale.title,/旧版/);
  assert.equal(describeResearch({items:[artifact({stale:true})]},context).stale,true);
});
test('failure retains a prior artifact and resumes only explicit terminal jobs',()=>{
  const result=describeResearch({configured:true,items:[artifact()],job:job({status:'failed',error:{code:'SEARCH_FAILED'}})},context);assert.equal(result.selected.id,'a1');assert.equal(result.canResume,true);assert.equal(result.canStart,true);assert.match(result.title,/未完成/);
  assert.equal(describeResearch({configured:true,job:job({status:'completed'})},context).canResume,false);
});
test('comparison columns extract only actual Markdown sections, excluding code fence headings',()=>{
  const body='综合说明。\n```md\n## 与教材一致的部分\n伪标题不是事实。\n```\n## 与教材一致的部分\n- 定义与原文一致（待核对）。\n### 具体条件\n需满足教材假设。\n## 需要辨析的部分\n- 先验的选择。\n## 其他\n不能混入。';
  const value=extractResearchSections(body);assert.match(value.aligned,/定义与原文一致/);assert.match(value.aligned,/具体条件/);assert.doesNotMatch(value.aligned,/伪标题/);assert.equal(value.debated,'- 先验的选择。');
  assert.deepEqual(extractResearchSections('普通综合，没有结构化对照。'),{aligned:'',debated:''});
});

const marker='\uE200cite\uE202opaque-provider-id\uE201';
const citationArtifact=(content,annotations)=>({content,sources:[{id:'s1',url:'https://www.zhihu.com/question/123'},{id:'s2',url:'https://www.bilibili.com/video/BV1'}],annotations});
const cite=(startIndex,endIndex,sourceId='s1',url='https://www.zhihu.com/question/123')=>({startIndex,endIndex,sourceId,url,indexBasis:'provider-output-text',citationKind:'provider-url-citation'});
test('citation rendering uses verified UTF16 annotation ranges, replacing only the internal marker',()=>{
  const content='😀中文结论 '+marker+' 继续。',start=content.indexOf(marker),input=citationArtifact(content,[cite(start,start+marker.length)]),before=JSON.stringify(input);
  const output=citedResearchMarkdown(input);assert.equal(output,'😀中文结论 [[1]](<https://www.zhihu.com/question/123>) 继续。');assert.equal(JSON.stringify(input),before);
  const wide=citationArtifact(content,[cite(2,start+marker.length)]);assert.equal(citedResearchMarkdown(wide),output);
});
test('same range aggregates multiple actual sources and dedupes repeated citations',()=>{
  const content='结论'+marker,start=2,input=citationArtifact(content,[cite(start,content.length),cite(start,content.length,'s2','https://www.bilibili.com/video/BV1'),cite(start,content.length)]);
  assert.equal(citedResearchMarkdown(input),'结论[[1]](<https://www.zhihu.com/question/123>) [[2]](<https://www.bilibili.com/video/BV1>)');
});
test('non-marker citation preserves text and appends a numeric reference',()=>{
  assert.equal(citedResearchMarkdown(citationArtifact('定义与条件。',[cite(0,5)])),'定义与条件 [[1]](<https://www.zhihu.com/question/123>)。');
});
test('overlapping, out-of-range, wrong-basis and split-surrogate ranges never invent links',()=>{
  for(const annotations of [[cite(0,3),cite(2,5)],[cite(-1,4)],[cite(0,100)],[{...cite(0,3),indexBasis:'other'}],[cite(0,1)]]){
    const content='😀abc';assert.equal(citedResearchMarkdown(citationArtifact(content,annotations)),content);
  }
});
test('citation URL must be a safe exact source member with a matching provided sourceId',()=>{
  for(const annotation of [cite(0,2,'s1','https://foreign.example/x'),cite(0,2,'s2'),cite(0,2,'s1','javascript:alert(1)')])assert.equal(citedResearchMarkdown(citationArtifact('结论。',[annotation])),'结论。');
});
test('existing explicit HTTPS Markdown links/autolinks/bare source URLs remain intact without duplication',()=>{
  for(const content of ['根据[原文](https://www.zhihu.com/question/123)核对','根据[复杂 [标签]](<https://www.zhihu.com/question/123>)核对','<https://www.zhihu.com/question/123>','https://www.zhihu.com/question/123']){
    assert.equal(citedResearchMarkdown(citationArtifact(content,[cite(0,content.length)])),content);
  }
  const content='`literal`';assert.equal(citedResearchMarkdown(citationArtifact(content,[cite(1,5)])),content);
});
test('unmapped markers remain in the pure range result but are safely removed for fragment/UI fallback',()=>{
  const content='没有可验证坐标 '+marker+'，不猜opaque-provider-id的来源。';assert.equal(citedResearchMarkdown(citationArtifact(content,[])),content);assert.equal(stripResearchMarkers(content),'没有可验证坐标 ，不猜opaque-provider-id的来源。');assert.equal(stripResearchMarkers('普通文字 [1] 和 https://example.edu'),'普通文字 [1] 和 https://example.edu');
});
