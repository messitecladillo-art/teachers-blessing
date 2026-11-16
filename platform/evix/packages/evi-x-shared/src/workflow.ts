import catalogDocument from './workflow-catalog.json' with { type: 'json' };
import { rejectDuplicateMembers } from './questionnaire.ts';

export const WORKFLOW_SCHEMA = 'research-workflow/v1' as const;
export const WORKFLOW_LIMITS = Object.freeze({ nodes: 200, edges: 500, executableNodes: 50, bytes: 500_000, configBytes: 100_000, parallelCompute: 4, parallelModels: 2 });
export type WorkflowDataType = 'material' | 'questionnaire' | 'persona' | 'release' | 'dataset' | 'result' | 'chart' | 'text' | 'report' | 'file' | 'decision';
export type WorkflowPort = { id: string; type: WorkflowDataType; required?: boolean; multiple?: boolean; accepts?: WorkflowDataType[] };
export type WorkflowConfigField = { key: string; label: string; type: 'text' | 'number' | 'boolean' | 'select' | 'json'; required?: boolean; options?: string[]; default?: unknown; min?: number; max?: number; maxLength?: number };
export type WorkflowNodeDefinition = { kind: string; title: string; category: string; description: string; executor: 'pure' | 'model' | 'manual' | 'artifact' | 'provider' | 'latex'; editorSection?: string; inputs: WorkflowPort[]; outputs: WorkflowPort[]; configFields: WorkflowConfigField[] };
export const WORKFLOW_CATALOG: readonly WorkflowNodeDefinition[] = catalogDocument.nodes as WorkflowNodeDefinition[];
export const NODE_CATALOG = WORKFLOW_CATALOG;
export type WorkflowNode = { id: string; kind: string; title: string; config: Record<string, unknown>; disabled?: boolean };
export type WorkflowEdge = { id: string; source: string; sourcePort: string; target: string; targetPort: string; kind: 'data' | 'control' | 'reference' };
export type WorkflowDefinition = { schemaVersion: typeof WORKFLOW_SCHEMA; nodes: WorkflowNode[]; edges: WorkflowEdge[] };
export type CanvasLayout = { positions: Record<string, { x: number; y: number }>; groups: { id: string; title: string; nodeIds: string[]; collapsed: boolean }[]; revision?: number };
export type UserCanvasView = { viewport: { x: number; y: number; zoom: number }; selectedNodeIds: string[]; motion: 'standard' | 'reduced' | 'off'; transparency: number };
export type WorkflowIssue = { code: string; message: string; nodeId?: string; edgeId?: string };
export type WorkflowValidation = { valid: boolean; issues: WorkflowIssue[]; nodeIds: string[] };
export type WorkflowValidationOptions = { selectedNodeIds?: string[]; mode?: 'all' | 'selected' | 'single'; forRun?: boolean };
export type WorkflowNodeStatus = 'pending' | 'queued' | 'running' | 'waiting' | 'waiting_review' | 'waiting_collection' | 'waiting_input' | 'waiting_data' | 'wait_expired' | 'rejected' | 'succeeded' | 'skipped' | 'blocked' | 'failed' | 'cancelled' | 'outcome_unknown';
export type WorkflowRunStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'outcome_unknown';
export type ArtifactRef = { id: string; hash: string; classification: 'actual' | 'simulated'; sourceName?: string; revision?: number };
export type WorkflowRunEvent = { sequence: number; nodeId?: string; type: string; at: string; payload: Record<string, unknown> };
export type WorkflowNodeRun = { nodeId: string; kind: string; status: WorkflowNodeStatus; attempt: number; inputHash?: string; result?: unknown; errorCode?: string; startedAt?: string; finishedAt?: string };
export type WorkflowRun = { id: string; projectId: string; workflowVersionId: string; status: WorkflowRunStatus; createdAt: string; updatedAt: string; unknownCount: number; nodes: WorkflowNodeRun[]; events?: WorkflowRunEvent[] };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_CONFIG_KEYS = /^(?:apikey|secret|token|authorization|password|ciphertext|rawanswers|rawresponses|answers|responses|rows|csv)$/i;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(`${label}须为对象。`);
  return value as Record<string, unknown>;
}
function exact(value: unknown, required: string[], optional: string[], label: string) {
  const result = object(value, label);
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) throw Error(`${label}字段缺失或包含未知字段。`);
  return result;
}
function id(value: unknown, label: string): string { if (typeof value !== 'string' || !ID.test(value) || RESERVED.has(value)) throw Error(`${label}无效。`); return value; }
function text(value: unknown, max: number, label: string): string { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw Error(`${label}长度或字符无效。`); return value; }
function finite(value: unknown, min: number, max: number, label: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${label}数值无效。`); return value; }
/** JSON-only configurations reject executable values, credentials and raw rows at every depth. */
function safeConfigValue(value: unknown, depth = 0): void {
  if (depth > 16) throw Error('节点配置嵌套过深。');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { text(value, 120000, '节点文本'); return; }
  if (typeof value === 'number') { finite(value, -1e12, 1e12, '节点配置'); return; }
  if (Array.isArray(value)) { if (value.length > 5000) throw Error('节点配置列表过长。'); value.forEach(item => safeConfigValue(item, depth + 1)); return; }
  const result = object(value, '节点配置');
  for (const [key, item] of Object.entries(result)) {
    if (RESERVED.has(key) || FORBIDDEN_CONFIG_KEYS.test(key.replaceAll('_',''))) throw Error('节点配置不能包含密钥、原始答卷或可执行字段。');
    safeConfigValue(item, depth + 1);
  }
}

export function getWorkflowNodeDefinition(kind: string): WorkflowNodeDefinition | undefined { return WORKFLOW_CATALOG.find(item => item.kind === kind); }
export function createWorkflowNode(kind: string, nodeId: string): WorkflowNode {
  const spec = getWorkflowNodeDefinition(kind); if (!spec) throw Error('节点种类未注册。');
  const config = Object.fromEntries(spec.configFields.filter(field => field.default !== undefined).map(field => [field.key, structuredClone(field.default)]));
  return { id: id(nodeId, '节点 ID'), kind, title: spec.title, config };
}
export function blankWorkflow(): WorkflowDefinition { return { schemaVersion: WORKFLOW_SCHEMA, nodes: [], edges: [] }; }
export function validateWorkflowConfig(kind: string, value: unknown, forRun = false): WorkflowIssue[] {
  const spec = getWorkflowNodeDefinition(kind); if (!spec) return [{ code: 'unknown_kind', message: '节点种类未注册。' }];
  const config = object(value, '节点配置'); safeConfigValue(config);
  if (new TextEncoder().encode(JSON.stringify(config)).length > WORKFLOW_LIMITS.configBytes) throw Error('单个节点配置超过 100 KB。');
  const allowed = new Set([...spec.configFields.map(field => field.key), 'legacySource']);
  const unknown = Object.keys(config).filter(key => !allowed.has(key));
  const issues: WorkflowIssue[] = unknown.map(key => ({ code: 'unknown_config', message: `节点配置不支持 ${key}。` }));
  for (const field of spec.configFields) {
    const item = config[field.key];
    if (item === undefined || item === null || item === '') { if (forRun && field.required) issues.push({ code: 'missing_config', message: `请填写${field.label}。` }); continue; }
    let valid = true;
    if (field.type === 'text') valid = typeof item === 'string' && item.length <= (field.maxLength ?? 120000);
    if (field.type === 'number') valid = typeof item === 'number' && Number.isFinite(item) && item >= (field.min ?? -1e12) && item <= (field.max ?? 1e12);
    if (field.type === 'boolean') valid = typeof item === 'boolean';
    if (field.type === 'select') valid = typeof item === 'string' && !!field.options?.includes(item);
    if (!valid) issues.push({ code: 'invalid_config', message: `${field.label}格式无效。` });
  }
  if (forRun && ['frequency','numeric','grouped','crosstab','pearson','spearman'].includes(kind)) {
    if (!Number.isInteger(config.x) || (config.x as number) < 0 || (config.x as number) > 79) issues.push({ code: 'missing_variable', message: '请选择有效的变量 X。' });
    if (!['frequency','numeric'].includes(kind) && (!Number.isInteger(config.y) || (config.y as number) < 0 || (config.y as number) > 79 || config.y === config.x)) issues.push({ code: 'missing_variable', message: '请选择另一个有效变量 Y。' });
  }
  if (forRun && kind === 'alpha') {
    const scale = config.scale && typeof config.scale === 'object' ? config.scale as Record<string, unknown> : {};
    if (!Array.isArray(scale.columns) || scale.columns.length < 2 || scale.columns.length > 30 || typeof scale.construct !== 'string' || !scale.construct.trim()) issues.push({ code: 'missing_scale', message: '请选择 2–30 个量表题项并填写共同构念。' });
  }
  if (forRun && (kind === 'questionnaire' || kind === 'report' && config.binding === 'pinned') && config.binding !== 'head' && !config.artifactVersionId && !config.artifactId) issues.push({ code: 'missing_artifact', message: '请选择成果对象或精确版本。' });
  return issues;
}

/** Strict portable definition. Drafts may remain disconnected; validation reports runtime issues separately. */
export function parseWorkflow(value: unknown): WorkflowDefinition {
  if (typeof value === 'string') { if (new TextEncoder().encode(value).length > WORKFLOW_LIMITS.bytes) throw Error('研究流程超过 500 KB。'); rejectDuplicateMembers(value); value = JSON.parse(value.replace(/^\uFEFF/, '')); }
  const doc = exact(value, ['schemaVersion','nodes','edges'], [], '研究流程');
  if (doc.schemaVersion !== WORKFLOW_SCHEMA) throw Error('研究流程版本不支持。');
  if (!Array.isArray(doc.nodes) || doc.nodes.length > WORKFLOW_LIMITS.nodes || !Array.isArray(doc.edges) || doc.edges.length > WORKFLOW_LIMITS.edges) throw Error('研究流程最多 200 个节点、500 条连线。');
  const nodes: WorkflowNode[] = doc.nodes.map(value => {
    const x = exact(value, ['id','kind','title','config'], ['disabled'], '研究节点');
    const kind = text(x.kind, 64, '节点种类'); if (!getWorkflowNodeDefinition(kind)) throw Error('节点种类未注册。');
    const config = object(x.config, '节点配置'); const issues = validateWorkflowConfig(kind, config); if (issues.length) throw Error(issues[0].message);
    if (x.disabled !== undefined && typeof x.disabled !== 'boolean') throw Error('节点启用状态无效。');
    return { id: id(x.id,'节点 ID'), kind, title: text(x.title,160,'节点标题'), config: structuredClone(config), ...(x.disabled === undefined ? {} : { disabled: x.disabled as boolean }) };
  });
  const edges: WorkflowEdge[] = doc.edges.map(value => {
    const x = exact(value,['id','source','sourcePort','target','targetPort','kind'],[],'研究连线');
    if (!['data','control','reference'].includes(x.kind as string)) throw Error('连线类型无效。');
    const kind = x.kind as WorkflowEdge['kind'];
    return { id:id(x.id,'连线 ID'),source:id(x.source,'起点'),target:id(x.target,'终点'),sourcePort:text(x.sourcePort,64,'输出端口'),targetPort:text(x.targetPort,64,'输入端口'),kind };
  });
  if (new Set(nodes.map(n => n.id)).size !== nodes.length || new Set(edges.map(e => e.id)).size !== edges.length) throw Error('节点或连线 ID 重复。');
  const result = { schemaVersion: WORKFLOW_SCHEMA, nodes, edges };
  if (new TextEncoder().encode(JSON.stringify(result)).length > WORKFLOW_LIMITS.bytes) throw Error('研究流程超过 500 KB。');
  return result;
}
export const parseWorkflowDefinition = parseWorkflow;
export function serializeWorkflow(value: WorkflowDefinition): string { return JSON.stringify(parseWorkflow(value), null, 2); }

/** Returns the explicit selected set plus its enabled execution ancestors; research annotations never schedule jobs. */
export function workflowSelection(definition: WorkflowDefinition, selectedNodeIds?: readonly string[], mode: 'all'|'selected'|'single' = 'all'): string[] {
  const active = new Set(definition.nodes.filter(node => !node.disabled && node.kind !== 'note').map(node => node.id));
  if (mode === 'all' && selectedNodeIds === undefined) return [...active];
  const selected = new Set(selectedNodeIds ?? []);
  if (!selected.size || (mode === 'single' && selected.size !== 1) || [...selected].some(nodeId => !active.has(nodeId))) throw Error('请选择有效的运行节点。');
  const closure = new Set(selected); let changed = true;
  while (changed) { changed = false; for (const edge of definition.edges) if (edge.kind !== 'reference' && closure.has(edge.target) && active.has(edge.source) && !closure.has(edge.source)) { closure.add(edge.source); changed = true; } }
  return definition.nodes.filter(node => closure.has(node.id)).map(node => node.id);
}

export function validateWorkflow(raw: unknown, options: WorkflowValidationOptions = {}): WorkflowValidation {
  let definition: WorkflowDefinition;
  try { definition = parseWorkflow(raw); } catch (error) { return { valid:false,issues:[{code:'invalid_definition',message:(error as Error).message}],nodeIds:[] }; }
  const issues: WorkflowIssue[] = [], nodes = new Map(definition.nodes.map(node => [node.id,node]));
  const selectionProvided = options.selectedNodeIds !== undefined || options.mode && options.mode !== 'all';
  let selected: string[];
  try { selected = workflowSelection(definition, options.selectedNodeIds, options.mode ?? (selectionProvided ? 'selected':'all')); } catch(error) { return { valid:false,issues:[{code:'invalid_selection',message:(error as Error).message}],nodeIds:[] }; }
  const active = new Set(selected), adjacency = new Map(selected.map(nodeId => [nodeId,[] as string[]])), indegree = new Map(selected.map(nodeId => [nodeId,0]));
  const connected = new Set<string>(), occupied = new Set<string>(), duplicate = new Set<string>();
  const groupedOutput = (nodeId:string, seen=new Set<string>()):boolean => {
    if(seen.has(nodeId))return false;seen.add(nodeId);
    const node=nodes.get(nodeId);if(node?.kind==='collect')return true;
    if(node?.kind!=='review')return false;
    const input=definition.edges.find(edge=>edge.kind==='data'&&edge.target===nodeId&&edge.targetPort==='value');
    return !!input&&groupedOutput(input.source,seen);
  };
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) { issues.push({ code:'missing_node',message:'连线引用了不存在的节点。',edgeId:edge.id }); continue; }
    if (edge.kind === 'reference') continue;
    if (!active.has(edge.target) && selectionProvided) continue;
    if (source.disabled || source.kind === 'note') { if (active.has(edge.target)) issues.push({code:'disabled_dependency',message:'所需上游节点已停用或仅为注释。',nodeId:target.id,edgeId:edge.id}); continue; }
    if (edge.source === edge.target) issues.push({code:'cycle',message:'执行节点不能连接自身。',nodeId:target.id,edgeId:edge.id});
    const key = `${edge.kind}:${edge.source}:${edge.sourcePort}:${edge.target}:${edge.targetPort}`;
    if (duplicate.has(key)) issues.push({code:'duplicate_edge',message:'同一输入输出关系不能重复连接。',edgeId:edge.id}); duplicate.add(key);
    if (edge.kind === 'data') {
      const output = getWorkflowNodeDefinition(source.kind)!.outputs.find(p => p.id === edge.sourcePort), input = getWorkflowNodeDefinition(target.kind)!.inputs.find(p => p.id === edge.targetPort);
      if (!input || !output) issues.push({code:'invalid_port',message:'请选择节点已注册的输入输出端口。',edgeId:edge.id});
      else {
        if (output.type !== input.type && !input.accepts?.includes(output.type)) issues.push({code:'port_type',message:`${output.type} 不能接入 ${input.type} 输入。`,edgeId:edge.id});
        const inputKey = `${target.id}:${input.id}`;
        if (occupied.has(inputKey) && !input.multiple) issues.push({code:'multiple_input',message:'该输入仅接受一个来源。',nodeId:target.id,edgeId:edge.id});
        occupied.add(inputKey); connected.add(inputKey);
      }
    }
    if (active.has(source.id) && active.has(target.id)) { adjacency.get(source.id)!.push(target.id); indegree.set(target.id,indegree.get(target.id)!+1); }
  }
  if (options.forRun !== false) for (const nodeId of selected) {
    const node = nodes.get(nodeId)!, spec = getWorkflowNodeDefinition(node.kind)!;
    issues.push(...validateWorkflowConfig(node.kind,node.config,true).map(issue => ({...issue,nodeId})));
    for (const input of spec.inputs) if (input.required && !connected.has(`${node.id}:${input.id}`)) issues.push({code:'missing_input',message:`请连接 ${input.id} 输入。`,nodeId});
    if (node.kind === 'report' && !node.config.artifactVersionId && !node.config.artifactId && node.config.binding !== 'head' && !spec.inputs.some(input => connected.has(`${node.id}:${input.id}`))) issues.push({code:'missing_input',message:'请连接报告材料、结论或图表，或选择报告版本。',nodeId});
    if (['chart','condition'].includes(node.kind) && definition.edges.some(edge=>edge.kind==='data'&&edge.target===node.id&&edge.targetPort==='result'&&groupedOutput(edge.source)) && (typeof node.config.resultName!=='string'||!node.config.resultName.trim())) issues.push({code:'result_selection_required',message:'请选择命名结果组中的一个成员。',nodeId});
  }
  const queue = selected.filter(nodeId => !indegree.get(nodeId)), ordered: string[] = [];
  while(queue.length) { const current = queue.shift()!; ordered.push(current); for(const target of adjacency.get(current)!) { indegree.set(target,indegree.get(target)!-1); if(!indegree.get(target)) queue.push(target); } }
  if (ordered.length !== selected.length) for (const edge of definition.edges) if (edge.kind !== 'reference' && (indegree.get(edge.source) ?? 0) > 0 && (indegree.get(edge.target) ?? 0) > 0) issues.push({code:'cycle',message:'执行流程存在循环，请断开标记的连接。',edgeId:edge.id});
  if (options.forRun !== false && selected.length > WORKFLOW_LIMITS.executableNodes) issues.push({code:'run_limit',message:'单次运行最多包含 50 个执行节点，请选择一个子流程。'});
  if (options.forRun !== false && !selected.length) issues.push({code:'empty_workflow',message:'请添加或启用一个执行节点。'});
  return {valid:issues.length===0,issues,nodeIds:ordered.length===selected.length?ordered:selected};
}

export function validateCanvasLayout(value: unknown, nodeIds?: readonly string[]): CanvasLayout {
  const x = exact(value,['positions','groups'],['revision'],'画布布局'), rawPositions = object(x.positions,'节点位置');
  if (Object.keys(rawPositions).length > 200 || !Array.isArray(x.groups) || x.groups.length > 100) throw Error('画布布局数量超出范围。');
  const positions = Object.fromEntries(Object.entries(rawPositions).map(([nodeId,value])=>{id(nodeId,'布局节点 ID'); if(nodeIds&&!nodeIds.includes(nodeId))throw Error('布局引用未知节点。');const p=exact(value,['x','y'],[],'节点位置');return[nodeId,{x:finite(p.x,-1e7,1e7,'横坐标'),y:finite(p.y,-1e7,1e7,'纵坐标')}];}));
  const members = new Set<string>();
  const groups = x.groups.map(value=>{const g=exact(value,['id','title','nodeIds','collapsed'],[],'编组');if(!Array.isArray(g.nodeIds)||g.nodeIds.length>200||typeof g.collapsed!=='boolean')throw Error('编组成员或状态无效。');const ids=g.nodeIds.map(value=>id(value,'编组节点 ID'));if(new Set(ids).size!==ids.length||ids.some(nodeId=>members.has(nodeId)||nodeIds&&!nodeIds.includes(nodeId)))throw Error('节点不能重复编组或引用未知节点。');ids.forEach(nodeId=>members.add(nodeId));return{id:id(g.id,'编组 ID'),title:text(g.title,160,'编组名称'),nodeIds:ids,collapsed:g.collapsed};});
  if(new Set(groups.map(g=>g.id)).size!==groups.length)throw Error('编组 ID 重复。');
  return {positions,groups,...(x.revision===undefined?{}:{revision:finite(x.revision,0,Number.MAX_SAFE_INTEGER,'布局版本')})};
}

/** Legacy cards had no execution dependencies. Preserve IDs and settings without inventing list-order edges. */
export function migrateLegacyAnalysisPlan(value: unknown): { definition: WorkflowDefinition; layout: CanvasLayout } {
  const plan=object(value,'历史分析方案');if(plan.schema!=='analysis-plan/v1'||!Array.isArray(plan.nodes)||plan.nodes.length>12)throw Error('历史分析方案版本不支持。');
  const nodes=plan.nodes.map(value=>{const x=object(value,'历史分析模块');const method=x.method==='groups'?'grouped':x.method;if(typeof method!=='string'||!['frequency','numeric','grouped','crosstab','pearson','spearman','alpha'].includes(method))throw Error('历史分析方法未注册。');const spec=getWorkflowNodeDefinition(method)!;return{id:id(x.id,'历史节点 ID'),kind:method,title:spec.title,config:{x:x.x,y:x.y,question:x.question,branch:x.branch,filter:structuredClone(x.filter),scale:structuredClone(x.scale),missingCodes:structuredClone(plan.missingCodes),legacySource:structuredClone(plan.source)}};});
  const definition=parseWorkflow({schemaVersion:WORKFLOW_SCHEMA,nodes,edges:[]});
  const layout:CanvasLayout={positions:Object.fromEntries(nodes.map((node,i)=>[node.id,{x:80+(i%4)*320,y:100+Math.floor(i/4)*220}])),groups:[]};
  return {definition,layout};
}

export function aggregateWorkflowStatus(nodes: readonly Pick<WorkflowNodeRun,'status'>[], cancelled=false): { status: WorkflowRunStatus; unknownCount:number; completed:number; skipped:number; waiting:number } {
  const unknownCount=nodes.filter(n=>n.status==='outcome_unknown').length, completed=nodes.filter(n=>n.status==='succeeded').length, skipped=nodes.filter(n=>n.status==='skipped').length, waiting=nodes.filter(n=>['waiting','waiting_review','waiting_collection','waiting_input','waiting_data','wait_expired'].includes(n.status)).length;
  let status:WorkflowRunStatus;
  if(unknownCount)status='outcome_unknown';else if(nodes.some(n=>n.status==='running'))status='running';else if(nodes.some(n=>n.status==='queued'))status='queued';else if(waiting)status='waiting';else if(nodes.some(n=>n.status==='pending'))status='queued';else if(cancelled||nodes.some(n=>n.status==='cancelled'))status='cancelled';else if(!nodes.length||nodes.some(n=>n.status==='failed'||n.status==='blocked'||n.status==='rejected'))status=completed?'partial':'failed';else status='succeeded';
  return {status,unknownCount,completed,skipped,waiting};
}
