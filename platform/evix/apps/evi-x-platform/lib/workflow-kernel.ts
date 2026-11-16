import { getWorkflowNodeDefinition, validateWorkflowConfig } from '../../../packages/evi-x-shared/src/workflow.ts';
import { canonical } from './questionnaire-mapping.ts';
import { chartChoices, defaultChart } from './chart-registry.ts';
import { CHART_THEMES, defaultChartStyle, validateChartStyle, THREE_LINE_TABLE_RULES } from './chart-theme.ts';
import { buildChartOption, buildTableSVG } from './chart-options.ts';
import type { ChartKind, ChartSnapshot, ChartThemeId } from './chart-types.ts';
import { parseEditorContent } from './editor-model.ts';
import { buildDocx, buildPptx, fileName } from './editor-export.ts';
import { buildLatexSource, generateLatexBody, latexCompileInput } from './latex-report.ts';
import { generatePanel, attributeIssues, defaultAppearance, type PanelSpec, type Persona, type PersonaAttribute } from './silicon/persona.ts';
import { transformWorkflowDataset, runWorkflowAnalysis, kernelHash, kernelObject, WorkflowKernelError, WORKFLOW_KERNEL_VERSION, type WorkflowAnalysis } from './workflow/pipeline.ts';

export { prepareWorkflowDataset, transformWorkflowDataset, runWorkflowAnalysis, WorkflowKernelError, WORKFLOW_KERNEL_VERSION } from './workflow/pipeline.ts';
export type WorkflowExecutorRequest = { kind:string; config:Record<string,unknown>; inputs:Record<string,unknown> };
export type WorkflowExecutorReceipt = { output:Record<string,unknown>; ports:Record<string,unknown>; diagnostics:string[] };
export type WorkflowAdapterRequest = { kind:string; adapter:'model'|'manual'|'artifact'|'provider'|'latex'; config:Record<string,unknown>; inputs:Record<string,unknown> };

function requireInput(inputs:Record<string,unknown>,port:string):unknown { const value=inputs[port];if(value===undefined||value===null)throw new WorkflowKernelError('missing_input',`请连接 ${port} 输入。`);return value; }
function receipt(output:Record<string,unknown>,port:string,diagnostics:string[]=[]):WorkflowExecutorReceipt {return {output,ports:{[port]:output},diagnostics};}
function boundedText(value:unknown,max=120000):string {if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new WorkflowKernelError('invalid_text','节点文本长度或字符无效。');return value;}

/** This contract never dispatches network or applies approvals. Dedicated backend adapters own those capabilities. */
export function workflowAdapterRequest(request:WorkflowExecutorRequest):WorkflowAdapterRequest {
  const spec=getWorkflowNodeDefinition(request.kind);if(!spec||spec.executor==='pure')throw new WorkflowKernelError('invalid_adapter','节点无需外部适配器。');
  const config=kernelObject(request.config,'节点配置'), inputs=kernelObject(request.inputs,'节点输入');
  const issues=validateWorkflowConfig(request.kind,config,true);if(issues.length)throw new WorkflowKernelError('invalid_config',issues[0].message);
  for(const port of spec.inputs)if(port.required)requireInput(inputs,port.id);
  if(spec.executor==='model') for(const [key,value] of Object.entries(inputs)) {
    if(key.startsWith('__'))throw new WorkflowKernelError('raw_data_to_model','模型节点不接收后台数据上下文。');
    if(containsRawData(value))throw new WorkflowKernelError('raw_data_to_model','模型节点仅接收研究材料和汇总证据。');
  }
  return {kind:request.kind,adapter:spec.executor,config,inputs};
}
/** Enforced at the worker boundary in addition to typed canvas ports. Aggregate result.data.rows are table summaries. */
export function containsRawData(value:unknown,depth=0,parent=''):boolean {
  if(depth>20)return true;
  if(Array.isArray(value))return value.some(item=>containsRawData(item,depth+1,parent));
  if(value&&typeof value==='object') {
    const x=value as Record<string,unknown>;
    if(x.kind==='dataset'||x.schema==='analysis-chart-data/v1')return true;
    for(const [key,item] of Object.entries(x)) {
      if(['csv','rawAnswers','rawResponses','table','pairs','distributions','eligibleIndices','rowIndices'].includes(key))return true;
      if(key==='rows'&&parent!=='data')return true;
      if(containsRawData(item,depth+1,key))return true;
    }
  }
  return false;
}

function parseAnalysis(value:unknown):WorkflowAnalysis {
  const result=kernelObject(value,'统计结果');
  if(result.kind!=='result'||!['actual','simulated'].includes(result.classification as string)||typeof result.hash!=='string'||!/^[a-f0-9]{64}$/.test(result.hash)||!result.source||!result.data)throw new WorkflowKernelError('invalid_result','请选择已计算并绑定版本的统计结果。');
  return result as unknown as WorkflowAnalysis;
}
async function validateAnalysisHash(result:WorkflowAnalysis) {
  if(await kernelHash({source:result.source,data:result.data,classification:result.classification})!==result.hash)throw new WorkflowKernelError('result_hash_mismatch','计算结果内容与哈希不一致。');
}
type NamedAnalysis = {name:string;value:WorkflowAnalysis};
async function readResultGroup(value:unknown):Promise<NamedAnalysis[]> {
  const group=kernelObject(value,'命名结果组');
  if(group.kind!=='result'||!Array.isArray(group.results)||!group.results.length||group.results.length>50)throw new WorkflowKernelError('invalid_result_group','请选择 1–50 份已经计算的命名结果。');
  if(typeof group.hash!=='string'||await kernelHash(group.results)!==group.hash)throw new WorkflowKernelError('result_hash_mismatch','命名结果组内容与哈希不一致。');
  const results=group.results.map(entry=>{const x=kernelObject(entry,'结果组成员');return {name:boundedText(x.name,240),value:parseAnalysis(x.value)};});
  if(results.some(r=>!r.name.trim())||new Set(results.map(r=>r.name)).size!==results.length)throw new WorkflowKernelError('duplicate_result_name','结果组成员名称需要唯一且非空。');
  await Promise.all(results.map(r=>validateAnalysisHash(r.value)));
  if(group.classification!==(results.some(r=>r.value.classification==='simulated')?'simulated':'actual'))throw new WorkflowKernelError('result_classification_mismatch','结果组分类与成员数据不一致。');
  return results;
}
async function selectedAnalysis(value:unknown,resultName:unknown):Promise<WorkflowAnalysis> {
  const input=kernelObject(value,'统计结果');
  if(Array.isArray(input.results)&&!input.data) {
    const results=await readResultGroup(input);
    if(typeof resultName!=='string'||!resultName.trim())throw new WorkflowKernelError('result_selection_required','请选择命名结果组中的一个成员；各分支样本数分别保留。');
    const selected=results.find(r=>r.name===resultName);
    if(!selected)throw new WorkflowKernelError('unknown_result_name','所选成员不在当前结果组中。');
    return selected.value;
  }
  const result=parseAnalysis(input);await validateAnalysisHash(result);return result;
}
function aggregateSnapshot(result:WorkflowAnalysis):ChartSnapshot {
  const source=result.source, config=source.config, data=result.data;
  const snapshot:ChartSnapshot={schema:'analysis-chart-data/v1',method:data.method,n:data.n,binding:{dataHash:result.datasetRef.hash,signature:result.hash,computedAt:'frozen-input'},xLabel:typeof config.question==='string'?config.question:'变量',yLabel:'',categories:[],distributions:[],cross:null,pairs:null,reliability:[],table:{headers:data.headers,rows:data.rows},statistics:data.warnings};
  if(data.method==='frequency')snapshot.categories=data.rows.map(row=>({key:canonical([snapshot.xLabel,row[0]]),label:String(row[0]),count:Number(row[1]),percent:Number(row[2])}));
  if(data.method==='crosstab') {const cells=data.rows.map(row=>({row:String(row[0]),column:String(row[1]),count:Number(row[2]),rowPercent:Number(row[3])}));snapshot.cross={rows:[...new Set(cells.map(c=>c.row))],columns:[...new Set(cells.map(c=>c.column))],cells};}
  if(data.method==='alpha'&&data.reliability)snapshot.reliability=data.reliability.items.map(item=>({key:String(item.index),label:item.name,mean:item.mean,sd:item.sd,correctedItemTotal:item.correctedItemTotal,alphaIfDeleted:item.alphaIfDeleted}));
  return snapshot;
}
async function renderWorkflowChart(config:Record<string,unknown>,inputs:Record<string,unknown>):Promise<WorkflowExecutorReceipt> {
  const result=await selectedAnalysis(requireInput(inputs,'result'),config.resultName);
  let snapshot=aggregateSnapshot(result), full=false;
  if(inputs.__dataset!==undefined) {
    const dataset=kernelObject(inputs.__dataset,'图表数据上下文');
    const source=result.source;
    const replay=await runWorkflowAnalysis(result.data.method==='groups'?'grouped':result.data.method,{...source.config,filter:null},{...dataset,missingCodes:source.missingCodes,mapping:source.mapping,routing:source.routing,filters:source.filters});
    if(canonical(replay.output.data)!==canonical(result.data)||replay.output.datasetRef.hash!==result.datasetRef.hash||replay.output.classification!==result.classification)throw new WorkflowKernelError('chart_source_mismatch','图表数据与计算版本不一致。');
    snapshot=replay.snapshot;full=true;
  }
  const choices=chartChoices(snapshot).map(choice=>!full&&!['frequency','crosstab','alpha'].includes(snapshot.method)&&choice.id!=='table'?{...choice,available:false,reason:'请连接该结果绑定的数据版本以绘制分布或配对图。'}:choice);
  const kind=(typeof config.chartKind==='string'&&config.chartKind!=='auto'?config.chartKind:full||['frequency','crosstab','alpha'].includes(snapshot.method)?defaultChart(snapshot):'table') as ChartKind;
  if(!choices.some(choice=>choice.id===kind&&choice.available))throw new WorkflowKernelError('chart_kind_unavailable',choices.find(c=>c.id===kind)?.reason||'当前结果不支持该图型。');
  const theme=(config.theme??'blue') as ChartThemeId;if(!CHART_THEMES.some(t=>t.id===theme))throw new WorkflowKernelError('invalid_theme','项目色系未注册。');
  const style=validateChartStyle({...defaultChartStyle(typeof result.source.config.question==='string'?result.source.config.question:'统计结果'),...(config.style?kernelObject(config.style,'图表格式'):{}),tableRules:'three_line'});
  let svg:string, width=style.width,height=style.height;
  if(kind==='table') {const table=buildTableSVG(snapshot,style);svg=table.svg;width=table.width;height=table.height;}
  else {
    const {engine}=await import('./chart-engine.ts');
    const instance=engine.init(null,undefined,{renderer:'svg',ssr:true,width,height});
    try {instance.setOption({...buildChartOption(snapshot,kind,style,theme),animation:false});svg=instance.renderToSVGString();}finally{instance.dispose();}
  }
  if(svg.length>4_000_000)throw new WorkflowKernelError('chart_size','图形超过 4 MB，请减少显示内容。');
  const output={kind:'chart',classification:result.classification,sourceHash:result.hash,datasetRef:result.datasetRef,hash:await kernelHash({sourceHash:result.hash,kind,theme,style,svg}),chartKind:kind,theme,style,width,height,svg,choices,summary:{n:result.data.n,method:result.data.method},tableRules:{outerPt:THREE_LINE_TABLE_RULES.outerPt,headerPt:THREE_LINE_TABLE_RULES.headerPt,alignment:'center'}};
  return receipt(output,'chart');
}

async function documentReceipt(kind:'word'|'ppt'|'latex',input:unknown):Promise<WorkflowExecutorReceipt> {
  const descriptor=kernelObject(input,'报告输入'), content=parseEditorContent(descriptor.content??descriptor.report??descriptor);
  if(descriptor.kind!==undefined&&descriptor.kind!=='report')throw new WorkflowKernelError('invalid_report','请连接保存后的报告版本。');
  if(typeof descriptor.hash==='string'&&await kernelHash(content)!==descriptor.hash)throw new WorkflowKernelError('report_hash_mismatch','报告内容与冻结版本哈希不一致。');
  let blob:Blob, mediaType:string, extension:string, source:string|undefined;
  if(kind==='word'){blob=await buildDocx(content);mediaType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';extension='docx';}
  else if(kind==='ppt'){blob=await buildPptx(content);mediaType='application/vnd.openxmlformats-officedocument.presentationml.presentation';extension='pptx';}
  else {source=buildLatexSource({...latexCompileInput(content),body:content.latex?.body??generateLatexBody(content)});mediaType='application/x-tex';extension='tex';blob=new Blob([source],{type:mediaType});}
  const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.byteLength>8*1024*1024)throw new WorkflowKernelError('file_limit','生成文件超过 8 MiB。');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  // Node-only export adapter. Existing downloadBlob remains the browser wrapper.
  const base64=Buffer.from(bytes).toString('base64');
  const sourceRef=descriptor.artifactRef??descriptor.sourceRef??(typeof descriptor.versionId==='string'?{id:descriptor.versionId,revision:descriptor.revision??null,hash:descriptor.hash??null}:null);
  const classification=['actual','simulated','unknown'].includes(descriptor.classification as string)?descriptor.classification:undefined;
  return receipt({kind:'file',mediaType,name:`${fileName(content.title)}.${extension}`,hash,bytes:bytes.byteLength,base64,...(source?{source}:{}),...(classification?{classification}:{}),sourceRef,executorVersion:WORKFLOW_KERNEL_VERSION},'file');
}

function personasFromConfig(config:Record<string,unknown>):{personas:Persona[];attributes:PersonaAttribute[]} {
  const value=config.personas;
  if(Array.isArray(value)) {
    if(!value.length||value.length>120)throw new WorkflowKernelError('persona_limit','请配置 1–120 个样本人设。');
    const personas=value.map((value,index)=>{const p=kernelObject(value,'人设'),traits=kernelObject(p.traits??{},'人设属性'),personId=typeof p.id==='string'?p.id:`persona-${index+1}`;if(Object.keys(traits).length>8||Object.values(traits).some(x=>typeof x!=='string'||x.length>120))throw new WorkflowKernelError('invalid_persona','人设属性需要至多 8 项文本。');return{id:boundedText(personId,64),code:typeof p.code==='string'?boundedText(p.code,24):`S-${String(index+1).padStart(3,'0')}`,traits:traits as Record<string,string>,background:typeof p.background==='string'?boundedText(p.background,240):'',appearance:defaultAppearance(personId)};});
    if(new Set(personas.map(p=>p.id)).size!==personas.length)throw new WorkflowKernelError('invalid_persona','人设 ID 重复。');return {personas,attributes:[]};
  }
  const spec=kernelObject(value,'人设生成配置');
  if(!Array.isArray(spec.attributes)||!Number.isSafeInteger(spec.size)||(spec.size as number)<1||(spec.size as number)>120||!['quota','random'].includes(spec.allocation as string)||!Number.isSafeInteger(spec.seed)||typeof spec.background!=='string')throw new WorkflowKernelError('invalid_persona','请填写属性、1–120 的数量、分配方式和固定种子。');
  const issues=attributeIssues(spec.attributes as PersonaAttribute[]);if(issues.length)throw new WorkflowKernelError('invalid_persona',issues.join(' '));
  const panel=spec as unknown as PanelSpec;return {personas:generatePanel(panel),attributes:panel.attributes};
}

export async function executeWorkflowNode(raw:unknown):Promise<WorkflowExecutorReceipt> {
  const request=kernelObject(raw,'执行请求');
  if(typeof request.kind!=='string')throw new WorkflowKernelError('unknown_kind','节点种类未注册。');
  const spec=getWorkflowNodeDefinition(request.kind);if(!spec)throw new WorkflowKernelError('unknown_kind','节点种类未注册。');
  if(spec.executor!=='pure')throw new WorkflowKernelError('adapter_required',`${spec.title}需要后台 ${spec.executor} 适配器和真实回执。`);
  const config=kernelObject(request.config??{},'节点配置'),inputs=kernelObject(request.inputs??{},'节点输入');
  const issues=validateWorkflowConfig(spec.kind,config,true);if(issues.length)throw new WorkflowKernelError('invalid_config',issues[0].message);
  for(const port of spec.inputs)if(port.required)requireInput(inputs,port.id);
  if(['frequency','numeric','grouped','crosstab','pearson','spearman','alpha'].includes(spec.kind)) {const result=await runWorkflowAnalysis(spec.kind,config,requireInput(inputs,'dataset'));return receipt(result.output as unknown as Record<string,unknown>,'result',result.output.diagnostics);}
  if(spec.kind==='transform'){const d=await transformWorkflowDataset(requireInput(inputs,'dataset'),config,inputs.questionnaire);return receipt({...d,summary:{originalRows:d.table.rows.length,filterCount:d.filters.length},hash:await kernelHash({ref:d.datasetRef,identity:d.identity,missingCodes:d.missingCodes,mapping:d.mapping??null,routing:d.routing??null,filters:d.filters})},'dataset');}
  if(spec.kind==='question'||spec.kind==='note'){const text=boundedText(config.text??'');return receipt({kind:'text',text,hash:await kernelHash({kind:spec.kind,text}),classification:'proposed'},'text');}
  if(spec.kind==='method'){const text=boundedText(config.text),source=boundedText(config.source??'',3000);return receipt({kind:'material',text,source,hash:await kernelHash({text,source}),classification:'proposed'},'material');}
  if(spec.kind==='persona'){const panel=personasFromConfig(config);return receipt({kind:'persona',classification:'simulated',...panel,hash:await kernelHash(panel)},'persona');}
  if(spec.kind==='chart')return renderWorkflowChart(config,inputs);
  if(spec.kind==='word'||spec.kind==='ppt'||spec.kind==='latex')return documentReceipt(spec.kind,requireInput(inputs,'report'));
  if(spec.kind==='condition') {
    const result=await selectedAnalysis(requireInput(inputs,'result'),config.resultName);
    const metric=result.data.metrics.find(m=>m.label===config.metric);if(!metric)throw new WorkflowKernelError('unknown_metric','所选指标不在当前结果中。');
    const defined=metric.value!==null, value=metric.value, target=config.value as number, op=config.op??'gte';
    if(op!=='defined'&&typeof target!=='number')throw new WorkflowKernelError('invalid_condition','请填写比较值。');
    const matches=op==='defined'?defined:defined&&(op==='eq'?value===target:op==='ne'?value!==target:op==='gt'?value!>target:op==='gte'?value!>=target:op==='lt'?value!<target:value!<=target);
    const selectedPort=matches?'true':'false';return {output:{kind:'decision',selectedPort,metric:config.metric,value,target:target??null,sourceHash:result.hash},ports:{[selectedPort]:result},diagnostics:defined?[]:['指标未定义，选择 false 分支。']};
  }
  if(spec.kind==='collect') {
    const value=requireInput(inputs,'results'), entries=Array.isArray(value)?value:Object.values(kernelObject(value,'命名结果'));
    if(!entries.length||entries.length>50)throw new WorkflowKernelError('collect_limit','请连接 1–50 份结果。');
    const results:NamedAnalysis[]=[];
    for(const [index,entry] of entries.entries()) {
      const x=kernelObject(entry,'结果项'),name=typeof x.name==='string'?boundedText(x.name,120):`结果 ${index+1}`,value=kernelObject(x.value??x,'结果项内容');
      if(Array.isArray(value.results)&&!value.data)for(const child of await readResultGroup(value))results.push({name:`${name}/${child.name}`,value:child.value});
      else results.push({name,value:parseAnalysis(value)});
    }
    if(results.length>50)throw new WorkflowKernelError('collect_limit','汇集后最多 50 份独立结果，请拆分结果组。');
    if(results.some(r=>!r.name.trim()||r.name.length>240)||new Set(results.map(r=>r.name)).size!==results.length)throw new WorkflowKernelError('duplicate_result_name','结果组成员名称需要唯一且非空。');
    await Promise.all(results.map(item=>validateAnalysisHash(item.value)));
    const classification=results.some(r=>r.value.classification==='simulated')?'simulated':'actual';
    return receipt({kind:'result',classification,hash:await kernelHash(results),results,summary:{count:results.length,samples:results.map(r=>({name:r.name,n:r.value.data.n,datasetRef:r.value.datasetRef}))},diagnostics:[]},'result');
  }
  throw new WorkflowKernelError('executor_unavailable','节点执行器尚未注册，未生成结果。');
}
