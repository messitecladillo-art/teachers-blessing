import { parseSurveyCsv, parseMissingCodes, type Delimiter, type SurveyTable } from '../survey-analysis.ts';
import { createPlanNode, filterPlanSample, planNodeRequest, runPlanNode, type PlanFilter, type PlanNode, type PlanResult } from '../analysis-plan.ts';
import { canonical, datasetIdentity, mappingSignature, prepareLinkedAnalysis, assignmentProblems, researchLink, type DatasetIdentity, type Mapping } from '../questionnaire-mapping.ts';
import { parseQuestionnaire } from '../questionnaire.ts';
import type { RoutingChoice, RoutingEvidence } from '../routing-evidence.ts';
import { buildChartSnapshot } from '../chart-data.ts';
import type { ChartSnapshot } from '../chart-types.ts';
import type { ArtifactRef } from '../../../../packages/evi-x-shared/src/workflow.ts';

export const WORKFLOW_KERNEL_VERSION = 'research-kernel/v1' as const;
export type WorkflowDataset = {
  kind: 'dataset'; datasetRef: ArtifactRef; table: SurveyTable; identity: DatasetIdentity;
  missingCodes: string[]; mapping?: Mapping; routing?: RoutingChoice; filters: PlanFilter[];
};
export type WorkflowAnalysis = {
  kind:'result'; classification:'actual'|'simulated'; hash:string;
  datasetRef:ArtifactRef;
  summary:{method:string;n:number;total:number;originalRows:number;branchRows:number;eligibleRows:number;metrics:{label:string;value:number|null}[]};
  source:{datasetRef:ArtifactRef;executorVersion:typeof WORKFLOW_KERNEL_VERSION;config:Record<string,unknown>;filters:PlanFilter[];missingCodes:string[];mapping?:Mapping;routing?:RoutingChoice;interpretationHash:string;mappingHash:string|null;eligibility:RoutingEvidence|null;filterEligibility:RoutingEvidence[];filterEvidence:ReturnType<typeof filterPlanSample>['evidence'][]};
  diagnostics:string[]; data:PlanResult;
};
export type AnalysisPipelineOutput = { output:WorkflowAnalysis; table:SurveyTable; node:PlanNode; snapshot:ChartSnapshot };

export class WorkflowKernelError extends Error {
  code:string;
  constructor(code:string,message:string) { super(message);this.name='WorkflowKernelError';this.code=code; }
}
export function kernelObject(value:unknown,label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new WorkflowKernelError('invalid_input',`${label}须为对象。`);
  return value as Record<string,unknown>;
}
export async function kernelHash(value:unknown):Promise<string> {
  const encoded=new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function boundedMissing(value:unknown):string[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim())||new Set(value).size!==value.length)throw new WorkflowKernelError('invalid_missing','缺失代码须为不重复的文本列表。');
  return parseMissingCodes(value.join(';'));
}
const quote=(value:string)=>!value||/[",;\t\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
/** Only JSON tables accepted; round-trip through the existing bounded CSV parser before numerical work. */
export function validateKernelTable(value:unknown):SurveyTable {
  const t=kernelObject(value,'数据表');
  if(!Array.isArray(t.headers)||!Array.isArray(t.rows)||t.headers.some(h=>typeof h!=='string')||t.rows.some(r=>!Array.isArray(r)||r.some(c=>typeof c!=='string')))throw new WorkflowKernelError('invalid_dataset','表头与单元格须为文本。');
  if(t.headers.length>80||t.rows.length>5000||t.headers.length*t.rows.length>200000)throw new WorkflowKernelError('dataset_limit','数据超过 5,000 行、80 列或 200,000 个单元格。');
  const delimiter=(t.delimiter??',') as Delimiter;
  const empty=t.rows.length===0;
  const csv=[t.headers as string[],...(empty?[(t.headers as string[]).map(()=>'')]:t.rows as string[][])].map(row=>row.map(quote).join(delimiter)).join('\n');
  const parsed=parseSurveyCsv(csv,delimiter);
  if((t.headers as string[]).some((h,i)=>h!==parsed.headers[i]))throw new WorkflowKernelError('invalid_dataset','列名需要去除首尾空白。');
  return {...parsed,...(empty?{rows:[]}:{}),skippedBlankLines:typeof t.skippedBlankLines==='number'&&Number.isSafeInteger(t.skippedBlankLines)&&t.skippedBlankLines>=0?t.skippedBlankLines:0};
}

export async function prepareWorkflowDataset(value:unknown):Promise<WorkflowDataset> {
  const d=kernelObject(value,'数据输入');
  const rawRef=kernelObject(d.datasetRef??{id:d.id,hash:d.hash,classification:d.classification,sourceName:d.sourceName},'数据版本引用');
  if(typeof rawRef.id!=='string'||!rawRef.id||rawRef.id.length>128||typeof rawRef.hash!=='string'||!/^[a-f0-9]{64}$/.test(rawRef.hash)||!['actual','simulated'].includes(rawRef.classification as string))throw new WorkflowKernelError('invalid_dataset_ref','请选择含有效哈希和分类的数据版本。');
  const table=typeof d.csv==='string'?parseSurveyCsv(d.csv,(d.delimiter??',') as Delimiter):validateKernelTable(d.table);
  const silicon=table.headers.some(h=>h.toLowerCase()==='__origin');
  const datasetRef:ArtifactRef={id:rawRef.id,hash:rawRef.hash,classification:silicon?'simulated':rawRef.classification as ArtifactRef['classification'],...(typeof rawRef.sourceName==='string'?{sourceName:rawRef.sourceName}:{}),...(typeof rawRef.revision==='number'?{revision:rawRef.revision}:{})};
  const priorIdentity=d.identity===undefined?undefined:kernelObject(d.identity,'原始数据解析身份');
  const originalHash=priorIdentity&&typeof priorIdentity.sourceHash==='string'&&/^[a-f0-9]{64}$/.test(priorIdentity.sourceHash)?priorIdentity.sourceHash:datasetRef.hash;
  const encoding=typeof d.encoding==='string'?d.encoding:priorIdentity&&typeof priorIdentity.encoding==='string'?priorIdentity.encoding:'utf-8';
  const identity=await datasetIdentity(originalHash,encoding,table);
  if(d.identity&&canonical(d.identity)!==canonical(identity))throw new WorkflowKernelError('dataset_identity_mismatch','数据解析版本已变化。');
  const missingCodes=boundedMissing(d.missingCodes);
  let mapping:Mapping|undefined;
  if(d.mapping!==undefined&&d.mapping!==null) {
    const m=kernelObject(d.mapping,'问卷对应');
    const design=parseQuestionnaire(typeof m.design==='string'?m.design:JSON.stringify(m.design));
    if(!Array.isArray(m.assignments)||m.assignments.length>80)throw new WorkflowKernelError('invalid_mapping','请填写问卷与数据列的对应。');
    const assignments=m.assignments.map(value=>{const a=kernelObject(value,'题目对应');if(typeof a.questionId!=='string'||typeof a.column!=='string'||!['code','label'].includes(a.representation as string))throw new WorkflowKernelError('invalid_mapping','题目对应格式无效。');return{questionId:a.questionId,column:a.column,representation:a.representation as 'code'|'label'};});
    mapping={design,assignments,confirmed:typeof m.confirmed==='string'?m.confirmed:null,sourceSignature:typeof m.sourceSignature==='string'?m.sourceSignature:null};
    const problems=assignmentProblems(mapping,identity);if(problems.length)throw new WorkflowKernelError('invalid_mapping',problems.join(' '));
    // Explicit node configuration confirmation is bound by the immutable workflow version.
    if(m.confirmed===true)mapping.confirmed=mappingSignature(mapping,identity);
  }
  let routing:RoutingChoice|undefined;
  if(d.routing!==undefined&&d.routing!==null) {const r=kernelObject(d.routing,'跳题策略');if(!['strict','exclude'].includes(r.policy as string)||typeof r.confirmed!=='boolean')throw new WorkflowKernelError('invalid_routing','请确认有效的跳题处理策略。');routing={policy:r.policy as RoutingChoice['policy'],confirmed:r.confirmed};}
  const filters:PlanFilter[]=[];
  if(d.filters!==undefined) {if(!Array.isArray(d.filters)||d.filters.length>20)throw new WorkflowKernelError('filter_limit','一个分支最多 20 个筛选条件。');for(const f of d.filters){const checked=filterPlanSample(table,f as PlanFilter,missingCodes);if(checked.evidence.filterColumn===null)continue;filters.push(f as PlanFilter);}}
  return {kind:'dataset',datasetRef,table,identity,missingCodes,...(mapping?{mapping}:{}),...(routing?{routing}:{}),filters};
}

/** Retain original rows. Filters are versioned interpretations, then intersected after eligibility checks. */
export async function transformWorkflowDataset(input:unknown,config:Record<string,unknown>,questionnaire?:unknown):Promise<WorkflowDataset> {
  const d=await prepareWorkflowDataset(input);
  let mapping=config.mapping??d.mapping;
  if(questionnaire&&mapping) {const q=kernelObject(questionnaire,'问卷输入');const m=kernelObject(mapping,'列对应');mapping={...m,design:q.design??q.content??q.questionnaire??q};}
  const filters=[...d.filters,...(config.filter===undefined||config.filter===null?[]:[config.filter as PlanFilter])];
  return prepareWorkflowDataset({...d,missingCodes:config.missingCodes??d.missingCodes,mapping,routing:config.routing??d.routing,filters});
}

export function analysisPlanNode(kind:string,config:Record<string,unknown>):PlanNode {
  const method=kind==='grouped'?'groups':kind;
  if(!['frequency','numeric','groups','crosstab','pearson','spearman','alpha'].includes(method))throw new WorkflowKernelError('unknown_method','统计方法未注册。');
  const node=createPlanNode(method as PlanNode['method'],'workflow-stat');
  return {...node,x:method==='alpha'?null:(config.x??null) as number|null,y:method==='alpha'?null:(config.y??null) as number|null,question:typeof config.question==='string'?config.question:'',branch:typeof config.branch==='string'?config.branch:'全部样本',filter:(config.filter??null) as PlanFilter|null,scale:method==='alpha'?(config.scale??node.scale) as PlanNode['scale']:null};
}

/** Same order as the workbench: validate full-source filters, assess original response eligibility, intersect, calculate complete cases. */
export async function runWorkflowAnalysis(kind:string,config:Record<string,unknown>,input:unknown):Promise<AnalysisPipelineOutput> {
  const d=await prepareWorkflowDataset(input), node=analysisPlanNode(kind,config), missingCodes=boundedMissing(config.missingCodes??d.missingCodes);
  if(config.legacySource) {const source=kernelObject(config.legacySource,'历史数据绑定');if(source.hash!==d.identity.sourceHash||source.interpretationHash!==d.identity.interpretationHash||canonical(source.headers)!==canonical(d.table.headers))throw new WorkflowKernelError('legacy_source_mismatch','历史方案对应的数据或解析版本不一致。');
    let expectedMapping=null;if(d.mapping){const link=await researchLink(d.mapping,d.identity,false);expectedMapping={questionnaireHash:link.questionnaireHash,mappingHash:link.mappingHash,routingPolicy:d.routing?.policy??'strict'};}
    if(canonical(source.expectedMapping??null)!==canonical(expectedMapping))throw new WorkflowKernelError('legacy_mapping_mismatch','历史方案对应的问卷、变量映射或跳题策略不一致。');
  }
  const filters=[...d.filters,...(node.filter?[node.filter]:[])];
  const branches=filters.map(filter=>filterPlanSample(d.table,filter,missingCodes));
  const prepared=d.mapping?prepareLinkedAnalysis(d.mapping,d.identity,false,d.table,missingCodes,planNodeRequest(node),d.routing):{table:d.table,problems:[],eligibility:null};
  if(prepared.problems.length)throw new WorkflowKernelError('analysis_precondition',prepared.problems.join(' '));
  const filterPrepared=filters.map(filter=>d.mapping?prepareLinkedAnalysis(d.mapping,d.identity,false,d.table,missingCodes,{method:'frequency',columns:[filter.column!] },d.routing):{table:d.table,problems:[],eligibility:null});
  const problems=filterPrepared.flatMap(p=>p.problems);if(problems.length)throw new WorkflowKernelError('filter_precondition',`筛选变量：${problems.join(' ')}`);
  const eligible=new Set(prepared.table.rows), validFilters=filterPrepared.map(p=>new Set(p.table.rows)), branchSets=branches.map(p=>new Set(p.table.rows));
  const branchRows=d.table.rows.filter(row=>branchSets.every(set=>set.has(row))).length;
  const table={...d.table,rows:d.table.rows.filter(row=>eligible.has(row)&&validFilters.every(set=>set.has(row))&&branchSets.every(set=>set.has(row)))};
  const data=runPlanNode(table,node,missingCodes);
  const source={datasetRef:d.datasetRef,executorVersion:WORKFLOW_KERNEL_VERSION,config:structuredClone(config),filters:structuredClone(filters),missingCodes,...(d.mapping?{mapping:d.mapping}:{}),...(d.routing?{routing:d.routing}:{}),interpretationHash:d.identity.interpretationHash,mappingHash:d.mapping?await kernelHash(mappingSignature(d.mapping,d.identity)):null,eligibility:prepared.eligibility,filterEligibility:filterPrepared.flatMap(p=>p.eligibility?[p.eligibility]:[]),filterEvidence:branches.map(p=>p.evidence)};
  const summary={method:data.method,n:data.n,total:data.total,originalRows:d.table.rows.length,branchRows,eligibleRows:table.rows.length,metrics:data.metrics};
  const hash=await kernelHash({source,data,classification:d.datasetRef.classification});
  const output:WorkflowAnalysis={kind:'result',classification:d.datasetRef.classification,hash,datasetRef:d.datasetRef,summary,source,diagnostics:[...data.warnings],data};
  const snapshot=buildChartSnapshot(table,node,data,missingCodes,{dataHash:d.datasetRef.hash,signature:hash,computedAt:'frozen-input'});
  return {output,table,node,snapshot};
}
