import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { executeWorkflowNode, prepareWorkflowDataset, runWorkflowAnalysis, transformWorkflowDataset, workflowAdapterRequest, containsRawData } from '../lib/workflow-kernel.ts';
import { parseSurveyCsv } from '../lib/survey-analysis.ts';
import { runPlanNode, createPlanNode } from '../lib/analysis-plan.ts';
import { newQuestion,newQuestionnaire } from '../lib/questionnaire.ts';
import { createEditorContent } from '../lib/editor-model.ts';
import { datasetIdentity } from '../lib/questionnaire-mapping.ts';
import { kernelHash } from '../lib/workflow/pipeline.ts';

const ref={id:'synthetic-test',hash:'a'.repeat(64),classification:'simulated',sourceName:'合成验收 🧩'};
const dataset=csv=>({kind:'dataset',datasetRef:ref,csv});
const base=()=>dataset('组别,X,Y,Q1,Q2,Q3\n甲,1,2,1,2,5\n甲,2,4,2,3,4\n乙,3,6,3,4,3\n乙,4,8,4,5,2\n,NA,10,,2,2\n甲,wrong,NA,99,2,2');
const execute=(kind,config,input=base())=>executeWorkflowNode({kind,config,inputs:{dataset:input}});

test('all seven fixed methods agree with workbench and independently derived golden values',async()=>{
  const table=parseSurveyCsv(base().csv), configs={frequency:{x:0},numeric:{x:1},grouped:{x:0,y:1},crosstab:{x:0,y:3},pearson:{x:1,y:2},spearman:{x:1,y:2},alpha:{scale:{columns:[3,4,5],reverse:[5],min:1,max:5,construct:'体验'}}};
  for(const [kind,config] of Object.entries(configs)) {
    const receipt=await execute(kind,{...config,missingCodes:['NA']}),method=kind==='grouped'?'groups':kind;
    const node={...createPlanNode(method,'workflow-stat'),...config};
    assert.deepEqual(receipt.output.data,runPlanNode(table,node,['NA']),kind);
    assert.equal(receipt.output.classification,'simulated');assert.equal(receipt.ports.result.hash,receipt.output.hash);
  }
  assert.equal((await execute('frequency',{x:0})).output.data.n,5);
  assert.deepEqual((await execute('frequency',{x:0})).output.data.rows,[['甲',3,60],['乙',2,40]]);
  assert.equal((await execute('numeric',{x:1,missingCodes:['NA']})).output.data.metrics[0].value,2.5);
  assert.equal((await execute('pearson',{x:1,y:2,missingCodes:['NA']})).output.data.metrics[0].value,1);
  assert.equal((await execute('spearman',{x:1,y:2,missingCodes:['NA']})).output.data.metrics[0].value,1);
  const alpha=(await execute('alpha',configs.alpha)).output.data;
  assert.equal(alpha.n,4);assert.equal(alpha.reliability.alpha,1);
});

test('branch filters preserve the original table and denominator; nested branches intersect once',async()=>{
  const input=base(), first=await transformWorkflowDataset(input,{filter:{column:0,values:['甲']},missingCodes:['NA']});
  assert.equal(first.table.rows.length,6);
  const result=await runWorkflowAnalysis('numeric',{x:1,filter:{column:3,values:['1','2','3']}},first);
  assert.equal(result.output.summary.originalRows,6);assert.equal(result.output.summary.branchRows,2);assert.equal(result.output.data.n,2);assert.equal(result.output.data.metrics[0].value,1.5);
  assert.deepEqual(result.output.source.filterEvidence.map(e=>e.branchRows),[3,3]);
  assert.equal(input.csv,base().csv);
});

test('private dataset version identity and original file identity remain distinct without losing blank records',async()=>{
  const table=parseSurveyCsv('A,B\n,\nx,y'),identity=await datasetIdentity('b'.repeat(64),'utf-8',table);
  const prepared=await prepareWorkflowDataset({datasetRef:ref,table,identity});
  assert.equal(prepared.table.rows.length,2);assert.equal(prepared.identity.sourceHash,'b'.repeat(64));assert.equal(prepared.datasetRef.hash,ref.hash);
  const empty=await prepareWorkflowDataset({datasetRef:ref,table:{headers:['A'],rows:[],delimiter:',',skippedBlankLines:0}});
  assert.equal(empty.table.rows.length,0);
  const result=await execute('frequency',{x:0},empty);assert.equal(result.output.data.n,0);assert.ok(result.output.diagnostics.some(d=>d.includes('有效样本')));
});

async function conditionalDataset(){
  const design=newQuestionnaire();
  design.questions=[{...newQuestion('p','P'),text:'参与状态',choices:[{code:'A',label:'参与'},{code:'B',label:'未参与'}]},{...newQuestion('x','X'),text:'投入数值',type:'number',min:null,max:null,choices:[],condition:{questionId:'p',codes:['A']}},{...newQuestion('y','Y'),text:'另一个数值',type:'number',min:null,max:null,choices:[]}];
  return {...dataset('P,X,Y\nA,10,1\nA,20,2\nB,,3\nB,90,4\n,30,5\nA,,6'),mapping:{design,assignments:design.questions.map(q=>({questionId:q.id,column:q.variable,representation:'code'})),confirmed:true},routing:{policy:'exclude',confirmed:true}};
}

test('eligibility is checked on the original dataset before filtering and invalid branch rows never sneak in',async()=>{
  const input=await conditionalDataset();
  const result=await runWorkflowAnalysis('numeric',{x:1,filter:{column:0,values:['A']}},input);
  assert.equal(result.output.summary.originalRows,6);assert.equal(result.output.summary.branchRows,3);assert.equal(result.output.summary.eligibleRows,3);assert.equal(result.output.data.n,2);assert.equal(result.output.data.metrics[0].value,15);
  assert.equal(result.output.source.eligibility.unknownRows,1);assert.equal(result.output.source.eligibility.contradictionRows,1);
  await assert.rejects(()=>runWorkflowAnalysis('numeric',{x:1,filter:{column:0,values:['A']}},{...input,routing:{policy:'strict',confirmed:true}}),/严格策略暂停/);
  await assert.rejects(()=>runWorkflowAnalysis('numeric',{x:1},{...input,routing:{policy:'exclude',confirmed:false}}),/确认本版处理策略/);
  await assert.rejects(()=>runWorkflowAnalysis('numeric',{x:1},{...input,mapping:{...input.mapping,confirmed:false}}),/确认本版问卷/);
});

test('missing pairs and zero variance remain diagnosed null estimates, never zero or fake success numbers',async()=>{
  const result=await execute('pearson',{x:0,y:1},dataset('X,Y\n1,2\n1,3\n1,\n1,NA'));
  assert.equal(result.output.data.n,2);assert.equal(result.output.data.metrics[0].value,null);
  assert.ok(result.output.diagnostics.some(w=>w.includes('无变异')));
});

test('silicon marker forces simulated classification and aggregate receipts contain no raw rows',async()=>{
  const input={...dataset('__origin,渠道\nsilicon_simulated,校园\nsilicon_simulated,社区'),datasetRef:{...ref,classification:'actual'}};
  const result=await execute('frequency',{x:1},input);
  assert.equal(result.output.classification,'simulated');assert.equal(result.output.datasetRef.classification,'simulated');
  assert.equal(containsRawData(result.output),false);assert.equal(containsRawData(await prepareWorkflowDataset(input)),true);
  assert.equal(JSON.stringify(result.output).includes('silicon_simulated'),false);
});

test('model adapter forbids raw datasets at backend boundary while accepting bounded aggregate evidence',async()=>{
  const result=(await execute('frequency',{x:0})).output;
  assert.equal(workflowAdapterRequest({kind:'model',config:{prompt:'解释结果'},inputs:{result}}).adapter,'model');
  assert.throws(()=>workflowAdapterRequest({kind:'model',config:{prompt:'解释'},inputs:{text:{rawResponses:['private']}}}),/汇总证据/);
  assert.throws(()=>workflowAdapterRequest({kind:'model',config:{prompt:'解释'},inputs:{result:base()}}),/汇总证据/);
  await assert.rejects(()=>executeWorkflowNode({kind:'model',config:{prompt:'解释'},inputs:{result}}),/适配器和真实回执/);
});

test('result hashes are deterministic and bind parameter, source and classification changes',async()=>{
  const a=(await execute('frequency',{x:0})).output, b=(await execute('frequency',{x:0})).output;
  assert.equal(a.hash,b.hash);
  assert.notEqual(a.hash,(await execute('frequency',{x:0,missingCodes:['甲']})).output.hash);
  assert.notEqual(a.hash,(await execute('frequency',{x:0},{...base(),datasetRef:{...ref,classification:'actual'}})).output.hash);
  const corrupted=structuredClone(a);corrupted.data.rows[0][1]=99;
  await assert.rejects(()=>executeWorkflowNode({kind:'condition',config:{metric:'有效类别数',op:'gt',value:1},inputs:{result:corrupted}}),/哈希不一致/);
});

test('condition populates only the selected port, collect preserves independent sample counts',async()=>{
  const a=(await execute('frequency',{x:0})).output,b=(await execute('numeric',{x:1,missingCodes:['NA']})).output;
  const branch=await executeWorkflowNode({kind:'condition',config:{metric:'有效类别数',op:'gte',value:2},inputs:{result:a}});
  assert.equal(branch.output.selectedPort,'true');assert.deepEqual(Object.keys(branch.ports),['true']);
  const joined=await executeWorkflowNode({kind:'collect',config:{title:'两条证据'},inputs:{results:[{name:'结构',value:a},{name:'数值',value:b}]}});
  assert.deepEqual(joined.output.summary.samples.map(s=>s.n),[5,4]);assert.equal(joined.output.summary.n,undefined);
  assert.equal(joined.output.results[0].value.hash,a.hash);
  await assert.rejects(()=>executeWorkflowNode({kind:'chart',config:{chartKind:'table'},inputs:{result:joined.output}}),/请选择命名结果组/);
  const chart=await executeWorkflowNode({kind:'chart',config:{resultName:'结构',chartKind:'table'},inputs:{result:joined.output}});
  assert.equal(chart.output.summary.n,5);assert.equal(chart.output.sourceHash,a.hash);
  const selected=await executeWorkflowNode({kind:'condition',config:{resultName:'结构',metric:'有效类别数',op:'gte',value:2},inputs:{result:joined.output}});
  assert.equal(selected.output.selectedPort,'true');assert.equal(selected.ports.true.hash,a.hash);
  await assert.rejects(()=>executeWorkflowNode({kind:'condition',config:{resultName:'不存在',metric:'有效类别数',op:'gte',value:2},inputs:{result:joined.output}}),/所选成员不在/);
  const nested=await executeWorkflowNode({kind:'collect',config:{},inputs:{results:[{name:'原研究',value:joined.output}]}});
  assert.deepEqual(nested.output.results.map(r=>r.name),['原研究/结构','原研究/数值']);
  assert.deepEqual(nested.output.summary.samples.map(s=>s.n),[5,4]);
  await assert.rejects(()=>executeWorkflowNode({kind:'collect',config:{},inputs:{results:[{name:'相同名称',value:a},{name:'相同名称',value:b}]}}),/名称需要唯一/);
  const forged=structuredClone(joined.output);forged.results[0].value.data.n=99;
  await assert.rejects(()=>executeWorkflowNode({kind:'chart',config:{resultName:'结构',chartKind:'table'},inputs:{result:forged}}),/哈希不一致/);
});

test('chart server rendering uses identical source values and centered physical three-line table rules',async()=>{
  const result=(await execute('frequency',{x:0})).output;
  const chart=await executeWorkflowNode({kind:'chart',config:{chartKind:'bar',theme:'teal'},inputs:{result}});
  assert.ok(chart.output.svg.startsWith('<svg'));assert.ok(chart.output.svg.includes('校园')===false);assert.equal(chart.output.summary.n,5);
  const table=await executeWorkflowNode({kind:'chart',config:{chartKind:'table',theme:'blue',style:{title:'研究表',tableRules:'grid'}},inputs:{result}});
  assert.deepEqual(table.output.tableRules,{outerPt:1.5,headerPt:.75,alignment:'center'});
  const rules=[...table.output.svg.matchAll(/<line[^>]*stroke-width="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(rules,[2,1,2]);assert.ok(table.output.svg.includes('text-anchor="middle"'));
});

test('distribution charts rehydrate original frozen interpretation without storing row projections in receipts',async()=>{
  const result=(await execute('numeric',{x:1,missingCodes:['NA'],filter:{column:0,values:['甲']}})).output;
  const chart=await executeWorkflowNode({kind:'chart',config:{chartKind:'histogram'},inputs:{result,__dataset:base()}});
  assert.equal(chart.output.summary.n,2);assert.ok(chart.output.svg.startsWith('<svg'));assert.equal(chart.output.snapshot,undefined);
  await assert.rejects(()=>executeWorkflowNode({kind:'chart',config:{chartKind:'histogram'},inputs:{result}}),/绑定的数据版本/);
});

test('Word/PPT/LaTeX server builds produce actual parseable files using existing editors and helpers',async()=>{
  const content=createEditorContent();content.title='研究成果 🧩';content.report=[{id:'s1',title:'摘要',body:'有效样本 4；Pearson r = 1。',source:'合成验收数据'}];
  for(const kind of ['word','ppt']) {
    const receipt=await executeWorkflowNode({kind,config:{},inputs:{report:{kind:'report',artifactRef:{id:'r1',hash:'b'.repeat(64)},content}}});
    const archive=await JSZip.loadAsync(Buffer.from(receipt.output.base64,'base64'));
    assert.ok(archive.file(kind==='word'?'word/document.xml':'ppt/presentation.xml'));
    assert.equal(receipt.output.bytes,Buffer.from(receipt.output.base64,'base64').length);
  }
  const tex=await executeWorkflowNode({kind:'latex',config:{},inputs:{report:{kind:'report',content}}});
  const source=Buffer.from(tex.output.base64,'base64').toString('utf8');
  assert.ok(source.includes('1.5bp'));assert.ok(source.includes('0.75bp'));assert.ok(source.includes('有效样本 4'));
  const hash=await kernelHash(content);
  const pinned=await executeWorkflowNode({kind:'latex',config:{},inputs:{report:{kind:'report',content,versionId:'version-1',revision:3,hash,classification:'simulated'}}});
  assert.deepEqual(pinned.output.sourceRef,{id:'version-1',revision:3,hash});
  assert.equal(pinned.output.classification,'simulated');
  const legacy=await executeWorkflowNode({kind:'latex',config:{},inputs:{report:{kind:'report',content,classification:'unknown'}}});
  assert.equal(legacy.output.classification,'unknown');
  await assert.rejects(()=>executeWorkflowNode({kind:'word',config:{},inputs:{report:{kind:'report',content,hash:'a'.repeat(64)}}}),/报告内容与冻结版本/);
});

test('fixed CLI emits one Unicode JSON receipt and rejects duplicate or oversized inputs without dispatching arbitrary kinds',()=>{
  const cli=new URL('../scripts/workflow-executor.mjs',import.meta.url);
  const run=input=>spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(cli)],{input,encoding:'utf8',maxBuffer:12*1024*1024,timeout:30000});
  const valid=run(JSON.stringify({kind:'frequency',config:{x:0},inputs:{dataset:base()}}));
  assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).output.data.rows[0][0],'甲');
  const duplicate=run('{"kind":"note","kind":"question","config":{"text":"中文"},"inputs":{}}');
  assert.equal(duplicate.status,2);assert.match(JSON.parse(duplicate.stdout).error.message,/重复字段/);
  const unregistered=run(JSON.stringify({kind:'python',config:{},inputs:{}}));
  assert.equal(unregistered.status,2);assert.equal(JSON.parse(unregistered.stdout).error.code,'unknown_kind');
});
