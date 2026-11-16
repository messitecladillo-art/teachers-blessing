import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_CATALOG, WORKFLOW_SCHEMA, blankWorkflow, createWorkflowNode, parseWorkflow, serializeWorkflow, validateWorkflow, validateCanvasLayout, workflowSelection, migrateLegacyAnalysisPlan, aggregateWorkflowStatus } from '../src/workflow.ts';

const node=(kind,id,config={})=>({...createWorkflowNode(kind,id),config:{...createWorkflowNode(kind,id).config,...config}});
const edge=(id,source,sourcePort,target,targetPort,kind='data')=>({id,source,sourcePort,target,targetPort,kind});
const graph=(nodes,edges=[])=>({schemaVersion:WORKFLOW_SCHEMA,nodes,edges});
const base=()=>graph([node('dataset','d',{datasetVersionId:'data-1'}),node('frequency','f',{x:0}),node('numeric','n',{x:1})],[edge('d-f','d','dataset','f','dataset'),edge('d-n','d','dataset','n','dataset')]);

test('all research node kinds are registered; definitions are portable Unicode settings without answers or secrets',()=>{
  assert.equal(WORKFLOW_CATALOG.length,31);
  const definition=base();definition.nodes[1].title='渠道结构 🧩';
  assert.deepEqual(parseWorkflow(serializeWorkflow(definition)),definition);
  assert.deepEqual(blankWorkflow(),graph([]));
  assert.equal(WORKFLOW_CATALOG.some(n=>n.kind==='python'||n.kind==='http'),false);
  assert.ok(WORKFLOW_CATALOG.every(n=>n.inputs&&n.outputs&&n.configFields));
});

test('single and selected execution include necessary ancestors but never unrelated siblings',()=>{
  assert.deepEqual(workflowSelection(base(),['f'],'single'),['d','f']);
  assert.deepEqual(validateWorkflow(base(),{mode:'selected',selectedNodeIds:['n']}).nodeIds,['d','n']);
  assert.equal(validateWorkflow(base()).valid,true);
  assert.throws(()=>workflowSelection(base(),['f','n'],'single'));
  const reference=base();reference.edges.push(edge('research-association','f','','n','','reference'));
  assert.deepEqual(workflowSelection(reference,['n'],'selected'),['d','n']);
});

test('drafts keep incomplete configuration; execution reports missing input and variable by exact node',()=>{
  const definition=graph([node('alpha','a')]);
  assert.equal(validateWorkflow(definition,{forRun:false}).valid,true);
  const validation=validateWorkflow(definition);
  assert.equal(validation.valid,false);
  assert.deepEqual(validation.issues.map(i=>i.code),['missing_scale','missing_input']);
  assert.ok(validation.issues.every(i=>i.nodeId==='a'));
  assert.equal(validateWorkflow(blankWorkflow(),{forRun:false}).valid,true);
  assert.ok(validateWorkflow(blankWorkflow()).issues.some(i=>i.code==='empty_workflow'));
});

test('report proposals accept evidence and material nodes require executable citation text',()=>{
  const report=node('report','report');
  assert.equal(report.config.binding,'proposal');
  const g=base();g.nodes.push(report);g.edges.push(edge('f-report','f','result','report','result'));
  assert.equal(validateWorkflow(g).valid,true);
  assert.equal(validateWorkflow(graph([report])).valid,false);
  assert.equal(validateWorkflow(graph([node('report','saved',{binding:'pinned'})])).valid,false);
  assert.equal(validateWorkflow(graph([node('report','saved',{binding:'head'})])).valid,true);
  assert.equal(validateWorkflow(graph([node('material','material',{text:'引用材料',source:'文献页码'})])).valid,true);
  assert.equal(validateWorkflow(graph([node('material','material')])).valid,false);
});

test('type mismatch, bad ports, missing references, disabled sources and duplicate inputs are rejected',()=>{
  for(const [code,mutate] of [
    ['port_type',g=>{g.edges.push(edge('bad','f','result','n','dataset'));}],
    ['invalid_port',g=>{g.edges[0].sourcePort='imaginary';}],
    ['missing_node',g=>{g.edges[0].source='gone';}],
    ['disabled_dependency',g=>{g.nodes[0].disabled=true;}],
    ['multiple_input',g=>{g.nodes.push(node('dataset','other',{datasetVersionId:'second'}));g.edges.push(edge('second','other','dataset','f','dataset'));}],
  ]) {const g=base();mutate(g);assert.ok(validateWorkflow(g).issues.some(i=>i.code===code),code);}
});

test('cycles can remain editable drafts but are located before execution; dotted research relationships do not create cycles',()=>{
  const g=graph([node('collect','a'),node('collect','b')],[edge('a-b','a','result','b','results'),edge('b-a','b','result','a','results')]);
  assert.deepEqual(parseWorkflow(g),g);
  assert.deepEqual(validateWorkflow(g).issues.filter(i=>i.code==='cycle').map(i=>i.edgeId),['a-b','b-a']);
  const refs=graph([node('question','q',{text:'问题'}),node('method','m',{text:'方法'})],[edge('q-m','q','','m','','reference'),edge('m-q','m','','q','','reference')]);
  assert.equal(validateWorkflow(refs).valid,true);
});

test('conditions have two typed branches and named joins accept several results',()=>{
  const g=base();g.nodes.push(node('condition','c',{metric:'有效类别数',op:'gt',value:1}),node('collect','join'));
  g.edges.push(edge('f-c','f','result','c','result'),edge('c-join','c','true','join','results'),edge('n-join','n','result','join','results'));
  assert.equal(validateWorkflow(g).valid,true);
  assert.equal(validateWorkflow(g).nodeIds.at(-1),'join');
});

test('single-result consumers require explicit member choice from a named result group, including reviewed groups',()=>{
  const g=base();g.nodes.push(node('collect','join'),node('review','review'),node('chart','chart'));
  g.edges.push(edge('f-join','f','result','join','results'),edge('n-join','n','result','join','results'),edge('join-review','join','result','review','value'),edge('review-chart','review','value','chart','result'));
  assert.ok(validateWorkflow(g).issues.some(i=>i.code==='result_selection_required'&&i.nodeId==='chart'));
  g.nodes.at(-1).config.resultName='f';assert.equal(validateWorkflow(g).valid,true);
});

test('human review preserves typed questionnaire and report paths into native consumers',()=>{
  const q=graph([node('questionnaire','q',{artifactVersionId:'questionnaire-v1'}),node('review','review'),node('survey_publish','publish')],[edge('q-r','q','questionnaire','review','value'),edge('r-p','review','questionnaire','publish','questionnaire')]);
  assert.equal(validateWorkflow(q).valid,true);
  const r=graph([node('report','r',{binding:'pinned',artifactVersionId:'report-v1'}),node('review','review'),node('word','export')],[edge('r-review','r','report','review','value'),edge('review-word','review','report','export','report')]);
  assert.equal(validateWorkflow(r).valid,true);
  r.edges[1].sourcePort='text';assert.ok(validateWorkflow(r).issues.some(i=>i.code==='port_type'));
});

test('strict schemas reject duplicate JSON fields, unsupported versions, arbitrary configuration and deep credentials',()=>{
  const g=base(), raw=serializeWorkflow(g);
  for(const poisoned of [raw.replace('"schemaVersion":','"schemaVersion":"forged","schemaVersion":'),raw.replace('"title":','"\\u0074itle":"forged","title":')])assert.throws(()=>parseWorkflow(poisoned),/重复字段/);
  for(const mutation of [g=>{g.schemaVersion='v2';},g=>{g.nodes[1].config.apiKey='secret';},g=>{g.nodes[1].config.python='print(1)';},g=>{g.nodes[1].config.filter={column:0,values:['A'],nested:{token:'secret'}};},g=>{g.nodes[1].config.rows=[['raw']];},g=>{g.nodes[0].id='__proto__';},g=>{g.nodes.push(g.nodes[0]);}]) {const copy=structuredClone(g);mutation(copy);assert.throws(()=>parseWorkflow(copy));}
});

test('legacy flat cards preserve IDs, source and scale without inventing execution order',()=>{
  const plan={schema:'analysis-plan/v1',title:'历史方案',source:{hash:'a'.repeat(64),headers:['组别','金额'],interpretationHash:'b'.repeat(64),expectedMapping:null},missingCodes:['NA'],nodes:[{id:'old-1',method:'groups',x:0,y:1,question:'比较描述',branch:'参与者',filter:{column:0,values:['甲']},scale:null},{id:'old-2',method:'alpha',x:null,y:null,question:'一致性',branch:'全体',filter:null,scale:{columns:[0,1],reverse:[1],min:1,max:5,construct:'体验'}}]};
  const migrated=migrateLegacyAnalysisPlan(plan);
  assert.deepEqual(migrated.definition.nodes.map(n=>n.id),['old-1','old-2']);
  assert.equal(migrated.definition.nodes[0].kind,'grouped');assert.deepEqual(migrated.definition.edges,[]);
  assert.deepEqual(migrated.definition.nodes[1].config.scale,plan.nodes[1].scale);
  assert.deepEqual(migrated.definition.nodes[0].config.legacySource,plan.source);
  assert.deepEqual(validateCanvasLayout(migrated.layout,['old-1','old-2']),migrated.layout);
});

test('layout rejects duplicate group membership and unknown IDs; a view change is not a business definition change',()=>{
  const layout={positions:{a:{x:10,y:20},b:{x:300,y:20}},groups:[{id:'g',title:'研究分支',nodeIds:['a'],collapsed:true}]};
  assert.deepEqual(validateCanvasLayout(layout,['a','b']),layout);
  assert.throws(()=>validateCanvasLayout(layout,['a']));
  assert.throws(()=>validateCanvasLayout({...layout,groups:[...layout.groups,{id:'g2',title:'重复',nodeIds:['a'],collapsed:false}]}));
  assert.throws(()=>validateCanvasLayout({...layout,positions:{a:{x:Infinity,y:0}}}));
});

test('unknown charged outcomes stay visible even after other nodes succeed or cancellation is requested',()=>{
  const aggregate=statuses=>aggregateWorkflowStatus(statuses.map(status=>({status})));
  assert.equal(aggregate(['succeeded','outcome_unknown']).status,'outcome_unknown');
  assert.equal(aggregateWorkflowStatus([{status:'outcome_unknown'}],true).status,'outcome_unknown');
  assert.equal(aggregate(['succeeded','failed']).status,'partial');
  assert.equal(aggregate(['waiting_collection','succeeded']).status,'waiting');
  assert.equal(aggregate(['waiting_data','pending','succeeded']).status,'waiting');
  assert.equal(aggregate(['skipped','succeeded']).status,'succeeded');
  assert.equal(aggregate(['blocked','failed']).status,'failed');
  assert.equal(aggregate([]).status,'failed');
});

test('large diagrams remain saveable but bounded executable selections are required',()=>{
  const g=graph(Array.from({length:200},(_,i)=>node('question',`n-${i}`,{text:'问题'})));
  assert.equal(parseWorkflow(g).nodes.length,200);
  assert.ok(validateWorkflow(g).issues.some(i=>i.code==='run_limit'));
  assert.equal(validateWorkflow(g,{selectedNodeIds:['n-1'],mode:'single'}).valid,true);
  g.nodes.push(node('note','extra'));assert.throws(()=>parseWorkflow(g),/200/);
});
