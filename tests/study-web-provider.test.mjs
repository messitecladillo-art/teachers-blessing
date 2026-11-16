import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {createWebResearchProvider,deriveResponsesUrl,DEFAULT_RESEARCH_DOMAINS,WEB_RESEARCH_LIMITS} from '../learning/web-research-provider.mjs';

const INPUT=Object.freeze({bookTitle:'自编公共分数教材',chapterTitle:'同分母分数相加',knowledgePointTitle:'等分单位保持不变'});
const KEY='synthetic-provider-secret-not-real';
const U1='https://www.zhihu.com/question/123456',U2='https://www.bilibili.com/video/BVSynthetic';
const text='等分单位保持不变，合并的是单位的个数。以下综合仅是合成测试数据。';
function responseData(){return{status:'completed',model:'synthetic-web-model',usage:{input_tokens:120,output_tokens:80,total_tokens:200},output:[{type:'web_search_call',id:'synthetic-search-1',status:'completed',action:{type:'search',queries:['合成公开词检索'],sources:[{type:'url',url:U1,title:'合成知乎解释'},{type:'url',url:U2,title:'合成B站讲解'}]}},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[{type:'url_citation',start_index:0,end_index:8,url:U1,title:'合成知乎解释'}]}]}]};}
const asResponse=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function harness(fn,options={}){const requests=[];const provider=createWebResearchProvider({apiUrl:'https://operator.example/v1/chat/completions',apiKey:KEY,model:'synthetic-web-model',...options,fetch:async(url,request)=>{requests.push({url,request});return fn?fn(url,request):asResponse(responseData());}});return{provider,requests};}

test('one same-origin Responses request requires real search, exact sources and bounded public metadata',async()=>{
  const h=harness(),result=await h.provider(INPUT);assert.equal(h.requests.length,1);const request=h.requests[0];assert.equal(request.url,'https://operator.example/v1/responses');assert.equal(request.request.redirect,'error');assert.equal(request.request.headers.Authorization,'Bearer '+KEY);const body=JSON.parse(request.request.body);assert.equal(body.tool_choice,'required');assert.deepEqual(body.include,['web_search_call.action.sources']);assert.equal(body.max_tool_calls,3);assert.equal(body.store,false);assert.equal(body.tools.length,1);assert.equal(body.tools[0].type,'web_search');assert.deepEqual(body.tools[0].filters.allowed_domains,DEFAULT_RESEARCH_DOMAINS);assert.equal(body.tools[0].external_web_access,true);for(const value of Object.values(INPUT))assert.ok(body.input[1].content.includes(value));assert.equal(body.input.length,2);
  assert.equal(result.status,'completed');assert.equal(result.content,text);assert.equal(result.report,result.content);assert.equal(result.search.executed,true);assert.equal(result.toolCalls,1);assert.equal(result.sources.length,2);assert.equal(result.sources[0].url,U1);assert.equal(result.sources[0].access,'search-index');assert.equal(result.sources[0].platform,'zhihu');assert.equal(result.annotations[0].sourceId,result.sources[0].id);assert.deepEqual([result.usage.inputTokens,result.usage.outputTokens,result.usage.totalTokens,result.usage.webSearchCalls],[120,80,200,1]);assert.equal(result.usage.costVerified,false);assert.ok(!Number.isNaN(Date.parse(result.searchedAt)));assert.ok(!JSON.stringify(result).includes(KEY));assert.ok(!JSON.stringify(h.provider.metadata).includes(KEY));
});

test('unconfigured adapter is honest and never invokes fetch',async()=>{
  let calls=0;const provider=createWebResearchProvider({fetch:async()=>{calls++;}});assert.equal(provider.configured,false);await assert.rejects(provider(INPUT),e=>e.status===503&&e.code==='WEB_RESEARCH_NOT_CONFIGURED');assert.equal(calls,0);
});

test('public titles become natural language and a directly executable site query instead of JSON',async()=>{
  const h=harness(),goal='比较直觉解释';await h.provider({...INPUT,goal});const body=JSON.parse(h.requests[0].request.body),input=body.input[1].content;
  assert.ok(input.includes('公共书名：'+INPUT.bookTitle));assert.ok(input.includes('章节：'+INPUT.chapterTitle));assert.ok(input.includes('知识点：'+INPUT.knowledgePointTitle));assert.ok(input.includes('公共目标：'+goal));assert.ok(!input.includes('"bookTitle"'));assert.ok(!input.includes('\\u'));
  assert.match(input,/检索查询：\n\(site:zhihu\.com OR site:bilibili\.com/);assert.ok(input.includes(') '+INPUT.knowledgePointTitle+' 直觉 讲解'));assert.match(body.input[0].content,/真实工具来源.*HTTPS/);assert.equal(h.requests.length,1);
});

test('missing provider annotations accepts only explicit HTTPS links from this real search evidence',async()=>{
  for(const omitted of [false,true]){
    const d=responseData(),block=d.output[1].content[0];block.text='合成的相关公开线索，需人工辨析。参考：['+'真实工具返回来源'+']('+U1+')。';if(omitted)delete block.annotations;else block.annotations=[];
    const result=await harness(()=>asResponse(d)).provider(INPUT),citation=result.annotations[0];assert.equal(result.status,'completed');assert.equal(citation.url,U1);assert.equal(citation.citationKind,'explicit-tool-url');assert.equal(result.content.slice(citation.startIndex,citation.endIndex),U1);assert.equal(citation.sourceId,result.sources[0].id);
  }
  for(const forged of ['https://www.zhihu.com/question/fabricated','https://outside.example/article']){const d=responseData();d.output[1].content[0]={type:'output_text',text:'伪造引用 '+forged,annotations:[]};await assert.rejects(harness(()=>asResponse(d)).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNVERIFIED_LINK');}
  const absent=responseData();delete absent.output[1].content[0].annotations;await assert.rejects(harness(()=>asResponse(absent)).provider(INPUT),e=>e.code==='WEB_RESEARCH_CITATION');
});

test('GPT-4.1 keeps the configured model and uses site instructions plus strict source post-validation',async()=>{
  for(const model of ['gpt-4.1','gpt-4.1-mini','gpt-4.1-nano-2025-04-14']){
    const h=harness(null,{model}),result=await h.provider(INPUT),body=JSON.parse(h.requests[0].request.body);
    assert.equal(body.model,model);assert.equal(Object.hasOwn(body.tools[0],'filters'),false);assert.equal(body.tools[0].type,'web_search');assert.match(body.input[0].content,/site:zhihu\.com/);assert.match(body.input[0].content,/site:bilibili\.com/);assert.equal(h.provider.metadata.filterMode,'post-validation');assert.equal(result.status,'completed');assert.equal(result.sources[0].url,U1);assert.equal(h.requests.length,1);
  }
  const bad=responseData();bad.output[1].content[0].annotations[0].url='https://outside.example/article';bad.output[0].action.sources.push({url:'https://outside.example/article'});
  await assert.rejects(harness(()=>asResponse(bad),{model:'gpt-4.1-mini'}).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNVERIFIED_CITATION');
  assert.equal(harness().provider.metadata.filterMode,'native');
});

test('GPT-5/6 research requests use low reasoning and 6000 output tokens while GPT-4.1 keeps 3000',async()=>{
  for(const model of ['gpt-5-mini','gpt-5.1','gpt-6','gpt-6-mini']){const h=harness(null,{model});await h.provider(INPUT);const body=JSON.parse(h.requests[0].request.body);assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.max_output_tokens,6000);assert.equal(body.max_tool_calls,3);assert.equal(body.model,model);assert.equal(h.requests.length,1);}
  const legacy=harness(null,{model:'gpt-4.1-mini'});await legacy.provider(INPUT);const body=JSON.parse(legacy.requests[0].request.body);assert.equal(Object.hasOwn(body,'reasoning'),false);assert.equal(body.max_output_tokens,3000);
  const incomplete=responseData();incomplete.status='incomplete';await assert.rejects(harness(()=>asResponse(incomplete),{model:'gpt-5-mini'}).provider(INPUT),e=>e.code==='WEB_RESEARCH_INCOMPLETE');
});

test('derived URLs preserve original path prefix and reject redirects/config credential sinks',()=>{
  assert.equal(deriveResponsesUrl('https://operator.example/api/v1/chat/completions'),'https://operator.example/api/v1/responses');
  for(const url of ['http://operator.example/v1/chat/completions','https://user:password@operator.example/v1/chat/completions','https://operator.example/v1/chat/completions?target=other','https://operator.example/v1/other'])assert.throws(()=>deriveResponsesUrl(url),e=>e.code==='WEB_RESEARCH_CONFIG');
  for(const allowedDomains of [['https://zhihu.com'],['127.0.0.1'],['private.localhost'],[]])assert.throws(()=>harness(null,{allowedDomains}),e=>e.code==='WEB_RESEARCH_CONFIG');
});

test('raw textbook, notes, model override and browser upstream URLs are rejected before sending',async()=>{
  const h=harness();for(const extra of [{sourceText:'PRIVATE TEXT'},{notes:['PRIVATE NOTES']},{messages:[]},{apiUrl:'https://evil.example/responses'},{model:'unexpected'}, {knowledgePointTitle:'x'.repeat(241)}])await assert.rejects(h.provider({...INPUT,...extra}),e=>e.status===400&&e.code==='WEB_RESEARCH_INPUT');assert.equal(h.requests.length,0);
});

test('a fluent answer without an actual completed search is never research success',async()=>{
  for(const mutate of [d=>{d.output=d.output.filter(v=>v.type==='message');},d=>{d.output[0].status='failed';},d=>{d.status='incomplete';},d=>{d.output[0].action.type='open_page';}]){const d=responseData();mutate(d);const h=harness(()=>asResponse(d));await assert.rejects(h.provider(INPUT),e=>['WEB_SEARCH_NOT_EXECUTED','WEB_RESEARCH_INCOMPLETE'].includes(e.code));assert.equal(h.requests.length,1);}
});

test('completed search without allowed sources returns explicit no-results and discards invented synthesis',async()=>{
  const d=responseData();d.output[0].action.sources=[];d.output[1].content[0].text='INVENTED_UNSUPPORTED_REPORT';const h=harness(()=>asResponse(d)),result=await h.provider(INPUT);assert.equal(result.status,'no-results');assert.deepEqual(result.sources,[]);assert.deepEqual(result.annotations,[]);assert.equal(result.search.executed,true);assert.equal(result.toolCalls,1);assert.ok(!result.content.includes('INVENTED'));assert.match(result.content,/没有取得/);
});

test('citations must exactly match actual tool URLs and domain boundaries',async()=>{
  for(const url of ['https://www.zhihu.com/question/invented','https://zhihu.com.evil.example/private','https://name:secret@www.zhihu.com/question/123456','https://127.0.0.1/private','https://www.bilibili.com/fake.mp4']){const d=responseData();d.output[1].content[0].annotations[0].url=url;await assert.rejects(harness(()=>asResponse(d)).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNVERIFIED_CITATION');}
  const d=responseData();d.output[1].content[0].annotations[0].end_index=text.length+1;await assert.rejects(harness(()=>asResponse(d)).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNVERIFIED_CITATION');
});

test('non-allowlisted or login/download URLs are not exposed as usable sources',async()=>{
  for(const url of ['https://www.zhihu.com/login','https://www.bilibili.com/download/video','https://www.zhihu.com/question/123?token=private','https://other.example/article']){const d=responseData();d.output[0].action.sources=[{url}];const result=await harness(()=>asResponse(d)).provider(INPUT);assert.equal(result.status,'no-results');assert.equal(result.sources.length,0);assert.equal(result.search.rejectedSources,1);}
});

test('source/report/tool limits are checked without truncating claims or inventing citations',async()=>{
  const atLimit=responseData();atLimit.output[0].action.sources=Array.from({length:WEB_RESEARCH_LIMITS.sources},(_,i)=>({url:'https://www.zhihu.com/question/'+i}));atLimit.output[1].content[0].annotations=atLimit.output[0].action.sources.map(v=>({type:'url_citation',url:v.url,start_index:0,end_index:1,title:'Synthetic'}));const accepted=await harness(()=>asResponse(atLimit)).provider(INPUT);assert.equal(accepted.sources.length,WEB_RESEARCH_LIMITS.sources);assert.equal(accepted.annotations.length,WEB_RESEARCH_LIMITS.sources);
  const tooMany=structuredClone(atLimit);tooMany.output[0].action.sources.push({url:'https://www.zhihu.com/question/over-limit'});tooMany.output[1].content[0].annotations=tooMany.output[0].action.sources.map(v=>({type:'url_citation',url:v.url,start_index:0,end_index:1,title:'Synthetic'}));assert.equal(tooMany.output[0].action.sources.length,WEB_RESEARCH_LIMITS.sources+1);await assert.rejects(harness(()=>asResponse(tooMany)).provider(INPUT),e=>e.code==='WEB_RESEARCH_SOURCE_BUDGET');
  const long=responseData();long.output[1].content[0].text='x'.repeat(12001);await assert.rejects(harness(()=>asResponse(long)).provider(INPUT),e=>e.code==='WEB_RESEARCH_OUTPUT_BUDGET');
  const calls=responseData();calls.output.unshift(...Array.from({length:3},()=>structuredClone(calls.output[0])));await assert.rejects(harness(()=>asResponse(calls)).provider(INPUT),e=>e.code==='WEB_RESEARCH_TOOL_BUDGET');
  const tool=responseData();tool.output.push({type:'function_call',name:'not-authorized'});await assert.rejects(harness(()=>asResponse(tool)).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNEXPECTED_TOOL');
});

test('report links outside the real search evidence and missing annotations are rejected',async()=>{
  const d=responseData();d.output[1].content[0].text+=' https://www.zhihu.com/question/not-in-search';await assert.rejects(harness(()=>asResponse(d)).provider(INPUT),e=>e.code==='WEB_RESEARCH_UNVERIFIED_LINK');const missing=responseData();missing.output[1].content[0].annotations=[];await assert.rejects(harness(()=>asResponse(missing)).provider(INPUT),e=>e.code==='WEB_RESEARCH_CITATION');
});

test('non-OK provider errors are redacted, never retried or sent to a different host',async()=>{
  for(const status of [400,401,404,429,500]){const h=harness(()=>new Response('upstream-path PRIVATE '+KEY,{status}));await assert.rejects(h.provider(INPUT),e=>!e.message.includes(KEY)&&!e.message.includes('upstream-path')&&[429,502,503].includes(e.status));assert.equal(h.requests.length,1);}
  const h=harness(()=>new Response('',{status:302,headers:{Location:'https://different.example/steal'}}));await assert.rejects(h.provider(INPUT),e=>e.code==='WEB_RESEARCH_REDIRECT');assert.equal(h.requests.length,1);
});

test('response byte budgets and invalid content types cancel bodies',async()=>{
  let cancelled=0;const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array(10));},cancel(){cancelled++;}});
  await assert.rejects(harness(()=>new Response(stream(),{headers:{'Content-Type':'text/html'}})).provider(INPUT),e=>e.code==='WEB_RESEARCH_RESPONSE');assert.equal(cancelled,1);
  await assert.rejects(harness(()=>new Response(stream(),{headers:{'Content-Type':'application/json','Content-Length':String(2*1024**2)}})).provider(INPUT),e=>e.code==='WEB_RESEARCH_RESPONSE');assert.equal(cancelled,2);
  const huge=new ReadableStream({start(c){c.enqueue(new Uint8Array(WEB_RESEARCH_LIMITS.responseBytes+1));},cancel(){cancelled++;}});await assert.rejects(harness(()=>new Response(huge,{headers:{'Content-Type':'application/json'}})).provider(INPUT),e=>e.code==='WEB_RESEARCH_RESPONSE_BUDGET');assert.equal(cancelled,3);
});

test('absolute timeout bounds a fetch that ignores abort and removes caller listeners',async()=>{
  const controller=new AbortController();let innerSignal;const h=harness((_url,options)=>{innerSignal=options.signal;return new Promise(()=>{});},{timeoutMs:15});await assert.rejects(h.provider({...INPUT,signal:controller.signal}),e=>e.status===504&&e.code==='WEB_RESEARCH_TIMEOUT');assert.equal(innerSignal.aborted,true);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('abort before and during streaming makes no successful report and cleans stream/listeners',async()=>{
  const early=new AbortController();early.abort();const h=harness();await assert.rejects(h.provider({...INPUT,signal:early.signal}),e=>e.code==='WEB_RESEARCH_CANCELLED');assert.equal(h.requests.length,0);
  const controller=new AbortController();let entered,cancelled=false;const ready=new Promise(r=>entered=r),stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),running=harness(()=>{entered();return new Response(stream,{headers:{'Content-Type':'application/json'}});});const pending=running.provider({...INPUT,signal:controller.signal});await ready;controller.abort();await assert.rejects(pending,e=>e.status===499&&e.code==='WEB_RESEARCH_CANCELLED');assert.equal(cancelled,true);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('missing usage stays unknown and echoed operator secret is never returned',async()=>{
  const d=responseData();delete d.usage;const result=await harness(()=>asResponse(d)).provider(INPUT);assert.equal(result.usage.inputTokens,null);assert.equal(result.usage.totalTokens,null);const leaked=responseData();leaked.output[1].content[0].text+=KEY;await assert.rejects(harness(()=>asResponse(leaked)).provider(INPUT),e=>e.code==='WEB_RESEARCH_RESPONSE'&&!e.message.includes(KEY));
});

test('all report URLs remain represented within the canonical source cap and citation metadata stays bounded',async()=>{
  const d=responseData();d.output[1].content[0].text+=' '+U2+'.';const result=await harness(()=>asResponse(d)).provider(INPUT);assert.ok(result.sources.some(s=>s.url===U2));
  const many=responseData();many.output[0].action.sources=Array.from({length:WEB_RESEARCH_LIMITS.sources+1},(_,i)=>({url:'https://www.zhihu.com/question/'+i}));many.output[1].content[0].annotations[0].url=many.output[0].action.sources[0].url;many.output[1].content[0].text+=' '+many.output[0].action.sources.map(s=>s.url).join(' ');await assert.rejects(harness(()=>asResponse(many)).provider(INPUT),e=>e.code==='WEB_RESEARCH_SOURCE_BUDGET');
  const annotations=responseData();annotations.output[1].content[0].annotations=Array.from({length:65},()=>structuredClone(annotations.output[1].content[0].annotations[0]));await assert.rejects(harness(()=>asResponse(annotations)).provider(INPUT),e=>e.code==='WEB_RESEARCH_CITATION_BUDGET');
});

test('known tracking parameters deduplicate the same retrieved document without merging different content',async()=>{
  const d=responseData();d.output[0].action.sources[0].url=U1+'?utm_source=provider';d.output[1].content[0].annotations[0].url=U1+'?utm_source=inline';d.output[1].content[0].text+=' '+U1+'?utm_source=markdown';
  const result=await harness(()=>asResponse(d)).provider(INPUT);
  assert.equal(result.sources.filter(source=>source.url===U1).length,1);
  assert.ok(result.annotations.every(annotation=>annotation.url===U1));
  d.output[1].content[0].annotations[0].url=U1+'?contentId=another-document';
  await assert.rejects(harness(()=>asResponse(d)).provider(INPUT),error=>error.code==='WEB_RESEARCH_UNVERIFIED_CITATION');
});
