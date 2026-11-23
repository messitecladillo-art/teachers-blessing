import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, postSseStream } from '../services/api';
import {
  MindMapCategory,
  MindMapGraph,
  MindMapNode,
  MindMapRecord,
} from '../types';
import {
  IconCloseX,
  IconDownloadBox,
  IconEditPen,
  IconMindMap,
  IconSaveDisc,
  IconStageExpand,
  IconUploadCloud,
  IconVerifyCheck,
} from './EduIcons';

interface MindMapDrawioWorkbenchProps {
  compact?: boolean;
  subject?: string;
  domainId?: string;
  branch?: string;
  externalMap?: MindMapRecord | null;
  onExpandFull?: () => void;
  onArtifactsChanged?: () => void;
}

const CAT_PALETTE: Record<MindMapCategory, { fill: string; stroke: string; text: string; label: string }> = {
  root: { fill: '#3B4F7D', stroke: '#2E3F66', text: '#FFFFFF', label: '中心命题' },
  principle: { fill: '#E8EEF9', stroke: '#3B4F7D', text: '#181A1F', label: '核心原理' },
  intuition: { fill: '#FFFFFF', stroke: '#3B4F7D', text: '#181A1F', label: '直观模型' },
  socratic: { fill: '#F1F3F6', stroke: '#4B5563', text: '#181A1F', label: '推演阶梯' },
  pitfall: { fill: '#FAECE9', stroke: '#B43B2A', text: '#7F1D1D', label: '反例警示' },
  interdisciplinary: { fill: '#FEF5E7', stroke: '#9A5B13', text: '#7C2D12', label: '跨学科关联' },
};

function computeClientLayout(graph: MindMapGraph): MindMapGraph {
  const layout = graph.layout || 'mindmap_lr';
  const rawNodes = (graph.nodes || []).map((n) => ({ ...n }));
  if (rawNodes.length === 0) return graph;
  if (layout === 'free') {
    return {
      ...graph,
      nodes: rawNodes.map((n, i) => ({
        ...n,
        x: typeof n.x === 'number' ? n.x : 420 + (i % 3) * 190,
        y: typeof n.y === 'number' ? n.y : 220 + Math.floor(i / 3) * 85,
      })),
    };
  }

  const byId = new Map(rawNodes.map((n) => [n.id, n]));
  const root = rawNodes.find((n) => !n.parent_id || !byId.has(n.parent_id)) || rawNodes[0];
  root.parent_id = null;
  root.level = 0;
  root.side = 'center';
  root.category = 'root';

  const children = new Map<string, MindMapNode[]>();
  rawNodes.forEach((n) => children.set(n.id, []));
  rawNodes.forEach((n) => {
    if (n.parent_id && n.id !== root.id) {
      children.get(n.parent_id)?.push(n);
    }
  });

  const weight = (nid: string, depth = 0): number => {
    if (depth > 6) return 1;
    const ch = children.get(nid) || [];
    if (!ch.length) return 1;
    return ch.reduce((acc, c) => acc + weight(c.id, depth + 1), 0);
  };

  const topCh = children.get(root.id) || [];
  const leftBr = layout === 'tree_right' ? [] : topCh.filter((_, i) => i % 2 === 1);
  const rightBr = layout === 'tree_right' ? topCh : topCh.filter((_, i) => i % 2 === 0);
  const rootX = layout === 'tree_right' ? 120 : 540;
  const rowGap = 68;
  const xStep = 235;
  const totalUnits = Math.max(
    4,
    leftBr.reduce((a, b) => a + weight(b.id), 0),
    rightBr.reduce((a, b) => a + weight(b.id), 0)
  );
  const centerY = Math.max(240, (totalUnits * rowGap) / 2 + 40);
  root.x = rootX;
  root.y = centerY;

  const placeSide = (branches: MindMapNode[], dir: number) => {
    const sumW = Math.max(1, branches.reduce((a, b) => a + weight(b.id), 0));
    let cursor = centerY - (sumW * rowGap) / 2 + rowGap / 2;

    const walk = (node: MindMapNode, lvl: number, topY: number): number => {
      const span = weight(node.id) * rowGap;
      node.level = lvl;
      node.side = dir < 0 ? 'left' : 'right';
      node.x = rootX + dir * lvl * xStep;
      node.y = topY + span / 2 - rowGap / 2;
      const ch = children.get(node.id) || [];
      let cy = topY;
      for (const c of ch) {
        cy = walk(c, lvl + 1, cy);
      }
      return topY + span;
    };

    for (const b of branches) {
      cursor = walk(b, 1, cursor);
    }
  };

  if (rightBr.length) placeSide(rightBr, 1);
  if (leftBr.length) placeSide(leftBr, -1);

  return { ...graph, layout, nodes: rawNodes };
}

export const MindMapDrawioWorkbench: React.FC<MindMapDrawioWorkbenchProps> = ({
  compact = false,
  subject = '跨学科探索',
  domainId = '',
  branch = '',
  externalMap = null,
  onExpandFull,
  onArtifactsChanged,
}) => {
  const [maps, setMaps] = useState<MindMapRecord[]>([]);
  const [activeMap, setActiveMap] = useState<MindMapRecord | null>(null);
  const [draftGraph, setDraftGraph] = useState<MindMapGraph | null>(null);
  const [selectedId, setSelectedId] = useState<string>('n_root');
  const [linkTargetId, setLinkTargetId] = useState<string>('');
  const [genTopic, setGenTopic] = useState('导数的跨学科应用与极值边界');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [errMsg, setErrMsg] = useState('');

  // Engine mode: built-in fast vector SVG vs embedded external editor
  const [engineMode, setEngineMode] = useState<'local' | 'drawio'>('local');
  const [drawioReady, setDrawioReady] = useState(false);
  const [drawioOfflineWarn, setDrawioOfflineWarn] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Interactive viewport & drag state
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(compact ? 0.82 : 0.96);
  const [pan, setPan] = useState({ x: compact ? -20 : 10, y: 0 });
  const [dragState, setDragState] = useState<
    | { kind: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
    | { kind: 'node'; nodeId: string; startX: number; startY: number; origX: number; origY: number }
    | null
  >(null);

  const loadMaps = async () => {
    try {
      const res = await apiJson<{ mindmaps: MindMapRecord[] }>('/api/mindmap/list');
      setMaps(res.mindmaps || []);
      if (!activeMap && res.mindmaps?.length) {
        const first = res.mindmaps[0];
        setActiveMap(first);
        setDraftGraph(computeClientLayout(first.graph));
        setSelectedId(first.graph.nodes[0]?.id || 'n_root');
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadMaps();
  }, []);

  useEffect(() => {
    if (!externalMap) return;
    setActiveMap(externalMap);
    setDraftGraph(computeClientLayout(externalMap.graph));
    setSelectedId(externalMap.graph.nodes?.[0]?.id || 'n_root');
    setMaps((prev) => [externalMap, ...prev.filter((m) => m.id !== externalMap.id)]);
    setToast(`已载入导图《${externalMap.title}》`);
  }, [externalMap]);

  // External diagram iframe postMessage bridge
  useEffect(() => {
    if (engineMode !== 'drawio') {
      setDrawioReady(false);
      setDrawioOfflineWarn(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setDrawioOfflineWarn((prev) => (drawioReady ? prev : true));
    }, 6500);

    const onMsg = async (evt: MessageEvent) => {
      if (!iframeRef.current || evt.source !== iframeRef.current.contentWindow) return;
      let msg: { event?: string; xml?: string; exit?: boolean } | null = null;
      try {
        msg = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
      } catch {
        return;
      }
      if (!msg?.event) return;

      if (msg.event === 'init') {
        setDrawioReady(true);
        setDrawioOfflineWarn(false);
        iframeRef.current.contentWindow?.postMessage(
          JSON.stringify({
            action: 'load',
            autosave: 1,
            xml: activeMap?.drawio_xml || '',
          }),
          '*'
        );
      } else if ((msg.event === 'save' || msg.event === 'autosave') && msg.xml && activeMap) {
        try {
          const res = await apiJson<{ mindmap: MindMapRecord }>(`/api/mindmap/${activeMap.id}`, {
            method: 'PUT',
            body: JSON.stringify({ drawio_xml: msg.xml }),
          });
          setActiveMap(res.mindmap);
          setDraftGraph(computeClientLayout(res.mindmap.graph));
          setToast('画布修改已同步保存');
          onArtifactsChanged?.();
        } catch {
          /* ignore transient autosave error */
        }
        if (msg.exit) setEngineMode('local');
      } else if (msg.event === 'exit') {
        setEngineMode('local');
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };
  }, [engineMode, activeMap?.id, activeMap?.drawio_xml, drawioReady]);

  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    if (!draftGraph) return hidden;
    const byId = new Map(draftGraph.nodes.map((n) => [n.id, n]));
    for (const node of draftGraph.nodes) {
      let curPid = node.parent_id;
      let depth = 0;
      while (curPid && depth < 10) {
        const parent = byId.get(curPid);
        if (!parent) break;
        if (parent.collapsed) {
          hidden.add(node.id);
          break;
        }
        curPid = parent.parent_id;
        depth += 1;
      }
    }
    return hidden;
  }, [draftGraph]);

  const visibleNodes = useMemo(
    () => (draftGraph?.nodes || []).filter((n) => !hiddenIds.has(n.id)),
    [draftGraph, hiddenIds]
  );

  const selectedNode = useMemo(
    () => draftGraph?.nodes.find((n) => n.id === selectedId) || null,
    [draftGraph, selectedId]
  );

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (draftGraph?.nodes || []).forEach((n) => {
      if (n.parent_id) counts.set(n.parent_id, (counts.get(n.parent_id) || 0) + 1);
    });
    return counts;
  }, [draftGraph]);

  const handleGenerateAiMap = async () => {
    if (!genTopic.trim() || generating) return;
    setGenerating(true);
    setErrMsg('');
    setToast('正在生成思维导图…');
    try {
      await postSseStream<{ mindmap: MindMapRecord }>(
        '/api/mindmap/generate',
        { topic: genTopic, subject, domain: domainId, branch },
        {
          onStage: (_, m) => setToast(m),
          onResult: (data) => {
            setActiveMap(data.mindmap);
            setDraftGraph(computeClientLayout(data.mindmap.graph));
            setMaps((prev) => [data.mindmap, ...prev.filter((m) => m.id !== data.mindmap.id)]);
            setSelectedId(data.mindmap.graph.nodes[0]?.id || 'n_root');
            setToast(`已生成导图《${data.mindmap.title}》`);
            onArtifactsChanged?.();
          },
          onError: (m) => setErrMsg(m),
        }
      );
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveMap = async () => {
    if (!activeMap || !draftGraph) return;
    setSaving(true);
    setErrMsg('');
    try {
      const res = await apiJson<{ mindmap: MindMapRecord }>(`/api/mindmap/${activeMap.id}`, {
        method: 'PUT',
        body: JSON.stringify({ graph: draftGraph }),
      });
      setActiveMap(res.mindmap);
      setMaps((prev) => prev.map((m) => (m.id === res.mindmap.id ? res.mindmap : m)));
      setToast('导图修改已保存');
      onArtifactsChanged?.();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleImportDrawio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const xml = await file.text();
      const res = await apiJson<{ mindmap: MindMapRecord }>('/api/mindmap/import-xml', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, xml_content: xml, subject }),
      });
      setActiveMap(res.mindmap);
      setDraftGraph(computeClientLayout(res.mindmap.graph));
      setMaps((prev) => [res.mindmap, ...prev]);
      setToast(`已导入文件《${file.name}》`);
      onArtifactsChanged?.();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : '导入失败');
    }
  };

  const handleDownloadDrawio = () => {
    if (!activeMap) return;
    const blob = new Blob([activeMap.drawio_xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeMap.title}.drawio`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSvg = () => {
    if (!svgRef.current || !activeMap) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeMap.title}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mutateNode = (id: string, patch: Partial<MindMapNode>) => {
    if (!draftGraph) return;
    const updated: MindMapGraph = {
      ...draftGraph,
      nodes: draftGraph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    };
    if (patch.label !== undefined && id === draftGraph.nodes[0]?.id && updated.nodes[0].level === 0) {
      updated.title = patch.label;
    }
    setDraftGraph(updated);
  };

  const handleAddChild = (asSibling = false) => {
    if (!draftGraph || !selectedNode) return;
    const parentId = asSibling ? (selectedNode.parent_id || selectedNode.id) : selectedNode.id;
    const parent = draftGraph.nodes.find((n) => n.id === parentId) || draftGraph.nodes[0];
    const nid = `n_${Date.now().toString(36).slice(-5)}`;
    const newNode: MindMapNode = {
      id: nid,
      label: '新思维分支节点',
      parent_id: parent.id,
      level: (parent.level || 0) + 1,
      side: parent.side === 'left' ? 'left' : 'right',
      category: parent.level === 0 ? 'principle' : 'intuition',
      note: '点击此处补充公式或跨学科注解',
      x: (parent.x || 400) + (parent.side === 'left' ? -210 : 210),
      y: (parent.y || 240) + 60,
    };
    const nextGraph = computeClientLayout({
      ...draftGraph,
      nodes: [...draftGraph.nodes, newNode],
    });
    setDraftGraph(nextGraph);
    setSelectedId(nid);
  };

  const handleDeleteNode = (id: string) => {
    if (!draftGraph) return;
    const target = draftGraph.nodes.find((n) => n.id === id);
    if (!target || target.level === 0 || !target.parent_id) return;
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of draftGraph.nodes) {
        if (n.parent_id && toRemove.has(n.parent_id) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          changed = true;
        }
      }
    }
    const nextGraph = computeClientLayout({
      ...draftGraph,
      nodes: draftGraph.nodes.filter((n) => !toRemove.has(n.id)),
      cross_links: (draftGraph.cross_links || []).filter((c) => !toRemove.has(c.source) && !toRemove.has(c.target)),
    });
    setDraftGraph(nextGraph);
    setSelectedId(target.parent_id);
  };

  const handleAddCrossLink = () => {
    if (!draftGraph || !selectedNode || !linkTargetId || linkTargetId === selectedNode.id) return;
    const cid = `cl_${Date.now().toString(36).slice(-4)}`;
    setDraftGraph({
      ...draftGraph,
      cross_links: [
        ...(draftGraph.cross_links || []),
        { id: cid, source: selectedNode.id, target: linkTargetId, label: '跨分支互证' },
      ],
    });
    setLinkTargetId('');
  };

  const svgHeight = compact ? 370 : 500;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="mindmap-drawio-workbench">
      {/* Top Toolbar: Map Selector, AI Generator, Engine Toggle & Import/Export */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <select
            className="select"
            style={{ width: compact ? 210 : 250, padding: '5px 9px', fontSize: 12 }}
            value={activeMap?.id || ''}
            onChange={(e) => {
              const found = maps.find((m) => m.id === e.target.value);
              if (found) {
                setActiveMap(found);
                setDraftGraph(computeClientLayout(found.graph));
                setSelectedId(found.graph.nodes[0]?.id || 'n_root');
              }
            }}
            data-testid="mindmap-selector"
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.graph?.nodes?.length || 0} 节点)
              </option>
            ))}
          </select>

          <div className="seg-switch">
            <button
              type="button"
              className={`seg-switch-btn ${engineMode === 'local' ? 'active' : ''}`}
              onClick={() => setEngineMode('local')}
              data-testid="btn-mindmap-local"
            >
              标准画板
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${engineMode === 'drawio' ? 'active' : ''}`}
              onClick={() => setEngineMode('drawio')}
              data-testid="btn-mindmap-drawio-embed"
            >
              扩展画布
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || !activeMap}
            onClick={handleSaveMap}
            data-testid="btn-save-mindmap"
          >
            <IconSaveDisc size={13} /> {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="btn btn-surface btn-sm" onClick={handleDownloadDrawio} disabled={!activeMap} data-testid="btn-export-drawio">
            <IconDownloadBox size={13} /> 导出导图
          </button>
          {engineMode === 'local' && (
            <button type="button" className="btn btn-surface btn-sm" onClick={handleDownloadSvg} disabled={!draftGraph}>
              <IconDownloadBox size={13} /> 导出图片
            </button>
          )}
          <label className="btn btn-surface btn-sm" style={{ cursor: 'pointer' }}>
            <IconUploadCloud size={13} /> 导入
            <input type="file" hidden accept=".drawio,.xml" onChange={handleImportDrawio} />
          </label>
          {compact && onExpandFull && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onExpandFull} data-testid="btn-expand-mindmap">
              <IconStageExpand size={13} /> 全屏展开
            </button>
          )}
        </div>
      </div>

      {/* Mindmap Generator Row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 220, padding: '6px 10px', fontSize: 12.5 }}
          value={genTopic}
          onChange={(e) => setGenTopic(e.target.value)}
          placeholder="输入主题或知识点，一键生成思维导图…"
          data-testid="mindmap-ai-topic-input"
        />
        <button
          type="button"
          className="btn btn-surface btn-sm"
          disabled={generating || !genTopic.trim()}
          onClick={handleGenerateAiMap}
          data-testid="btn-generate-mindmap"
        >
          <IconMindMap size={14} color="var(--accent)" />
          {generating ? '生成中…' : '生成导图'}
        </button>

        {engineMode === 'local' && draftGraph && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['mindmap_lr', 'tree_right', 'free'] as const).map((ly) => (
              <button
                key={ly}
                type="button"
                className={`btn btn-sm ${draftGraph.layout === ly ? 'btn-primary' : 'btn-surface'}`}
                onClick={() => setDraftGraph(computeClientLayout({ ...draftGraph, layout: ly }))}
              >
                {ly === 'mindmap_lr' ? '双向发散' : ly === 'tree_right' ? '向右逻辑树' : '自由拖拽'}
              </button>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="callout-verified" style={{ padding: '6px 10px', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <IconVerifyCheck size={13} color="var(--success)" /> {toast}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => setToast('')}>
            <IconCloseX size={12} />
          </button>
        </div>
      )}
      {errMsg && <div className="callout-danger" style={{ padding: '6px 10px', fontSize: 12 }}>{errMsg}</div>}

      {/* Engine Body */}
      {engineMode === 'drawio' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawioOfflineWarn && !drawioReady && (
            <div className="callout-warn" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>在线扩展画布暂不可用，可切回标准画板编辑或直接导出文件。</span>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => setEngineMode('local')}>
                切回标准画板
              </button>
            </div>
          )}
          <iframe
            ref={iframeRef}
            title="扩展思维导图画布"
            src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=min&libraries=1"
            style={{
              width: '100%',
              height: compact ? 440 : 590,
              border: '1px solid var(--border-strong)',
              borderRadius: 6,
              background: '#FFFFFF',
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Interactive SVG Canvas */}
          <div style={{ position: 'relative', border: '1px solid var(--border-hairline)', borderRadius: 10, background: '#FFFFFF', overflow: 'hidden' }}>
            {/* Canvas zoom/fit HUD */}
            <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, display: 'flex', gap: 4, background: 'rgba(255,255,255,0.92)', padding: '3px 5px', borderRadius: 8, border: '1px solid var(--border-hairline)' }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 7px' }} onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.12).toFixed(2))))}>
                −
              </button>
              <span className="mono-num" style={{ fontSize: 11.5, alignSelf: 'center', minWidth: 38, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 7px' }} onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.12).toFixed(2))))}>
                +
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => { setZoom(compact ? 0.82 : 0.96); setPan({ x: compact ? -20 : 10, y: 0 }); }}>
                复位
              </button>
            </div>

            <div style={{ position: 'absolute', bottom: 8, left: 10, zIndex: 5, fontSize: 11, color: 'var(--ink-muted)', pointerEvents: 'none' }}>
              提示：拖动节点可调整位置，点击节点可在下方编辑文字，虚线表示跨分支关联
            </div>

            <svg
              ref={svgRef}
              viewBox="0 0 1120 620"
              style={{
                width: '100%',
                height: svgHeight,
                display: 'block',
                cursor: dragState?.kind === 'pan' ? 'grabbing' : 'grab',
                userSelect: 'none',
              }}
              onMouseDown={(e) => {
                if ((e.target as SVGElement).tagName.toLowerCase() === 'svg' || (e.target as SVGElement).dataset.bg === '1') {
                  setDragState({ kind: 'pan', startX: e.clientX, startY: e.clientY, origPanX: pan.x, origPanY: pan.y });
                }
              }}
              onMouseMove={(e) => {
                if (!dragState || !draftGraph) return;
                const scale = 1120 / (svgRef.current?.clientWidth || 1120) / zoom;
                const dx = (e.clientX - dragState.startX) * scale;
                const dy = (e.clientY - dragState.startY) * scale;
                if (dragState.kind === 'pan') {
                  setPan({ x: dragState.origPanX + (e.clientX - dragState.startX) * 0.7, y: dragState.origPanY + (e.clientY - dragState.startY) * 0.7 });
                } else if (dragState.kind === 'node') {
                  setDraftGraph({
                    ...draftGraph,
                    layout: 'free',
                    nodes: draftGraph.nodes.map((n) =>
                      n.id === dragState.nodeId ? { ...n, x: Math.round(dragState.origX + dx), y: Math.round(dragState.origY + dy) } : n
                    ),
                  });
                }
              }}
              onMouseUp={() => setDragState(null)}
              onMouseLeave={() => setDragState(null)}
            >
              <defs>
                <pattern id="edu-grid-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="12" cy="12" r="0.9" fill="#D5CEC0" />
                </pattern>
                <marker id="arrow-vermilion" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#B43B2A" />
                </marker>
              </defs>
              <rect data-bg="1" x="0" y="0" width="1120" height="620" fill="url(#edu-grid-dots)" />

              <g transform={`translate(${560 + pan.x}, ${310 + pan.y}) scale(${zoom}) translate(-540, -290)`}>
                {/* Hierarchical Bezier Connectors */}
                {visibleNodes.map((n) => {
                  if (!n.parent_id) return null;
                  const parent = visibleNodes.find((p) => p.id === n.parent_id);
                  if (!parent) return null;
                  const sx = parent.x ?? 540;
                  const sy = parent.y ?? 260;
                  const tx = n.x ?? 540;
                  const ty = n.y ?? 260;
                  const c1x = sx + (tx - sx) * 0.48;
                  const c2x = sx + (tx - sx) * 0.52;
                  const st = CAT_PALETTE[n.category || 'intuition'] || CAT_PALETTE.intuition;
                  return (
                    <path
                      key={`edge-${parent.id}-${n.id}`}
                      d={`M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`}
                      fill="none"
                      stroke={st.stroke}
                      strokeOpacity={n.level === 1 ? 0.85 : 0.55}
                      strokeWidth={n.level === 1 ? 2.2 : 1.5}
                    />
                  );
                })}

                {/* Cross-disciplinary Dashed Links */}
                {(draftGraph?.cross_links || []).map((lk) => {
                  const s = visibleNodes.find((n) => n.id === lk.source);
                  const t = visibleNodes.find((n) => n.id === lk.target);
                  if (!s || !t) return null;
                  const sx = s.x ?? 500;
                  const sy = s.y ?? 260;
                  const tx = t.x ?? 500;
                  const ty = t.y ?? 260;
                  const mx = (sx + tx) / 2;
                  const my = Math.min(sy, ty) - 42;
                  return (
                    <g key={lk.id}>
                      <path
                        d={`M ${sx} ${sy} Q ${mx} ${my}, ${tx} ${ty}`}
                        fill="none"
                        stroke="#B43B2A"
                        strokeWidth="1.6"
                        strokeDasharray="5,4"
                        markerEnd="url(#arrow-vermilion)"
                      />
                      {lk.label && (
                        <g transform={`translate(${mx}, ${(sy + ty) / 4 + my / 2})`}>
                          <rect x="-42" y="-10" width="84" height="17" rx="3" fill="#FAECE9" stroke="#B43B2A" strokeWidth="0.8" />
                          <text x="0" y="2" fontSize="10" fontWeight="600" fill="#B43B2A" textAnchor="middle">
                            {lk.label.slice(0, 10)}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {visibleNodes.map((n) => {
                  const st = CAT_PALETTE[n.category || 'intuition'] || CAT_PALETTE.intuition;
                  const isSel = n.id === selectedId;
                  const w = n.level === 0 ? 204 : n.level === 1 ? 172 : 164;
                  const h = n.level === 0 ? 48 : 38;
                  const nx = n.x ?? 540;
                  const ny = n.y ?? 260;
                  const labelShow = n.label.length > 15 ? n.label.slice(0, 14) + '…' : n.label;
                  const cCount = childCounts.get(n.id) || 0;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${nx}, ${ny})`}
                      style={{ cursor: 'pointer' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedId(n.id);
                        setDragState({ kind: 'node', nodeId: n.id, startX: e.clientX, startY: e.clientY, origX: nx, origY: ny });
                      }}
                    >
                      {isSel && (
                        <rect
                          x={-w / 2 - 4}
                          y={-h / 2 - 4}
                          width={w + 8}
                          height={h + 8}
                          rx={9}
                          fill="none"
                          stroke="#B43B2A"
                          strokeWidth="1.8"
                          strokeDasharray="4,2"
                        />
                      )}
                      <rect
                        x={-w / 2}
                        y={-h / 2}
                        width={w}
                        height={h}
                        rx={7}
                        fill={st.fill}
                        stroke={st.stroke}
                        strokeWidth={n.level <= 1 ? 1.8 : 1.15}
                      />
                      <text
                        x={0}
                        y={4}
                        fontSize={n.level === 0 ? 13.5 : 11.8}
                        fontWeight={n.level <= 1 ? 700 : 500}
                        fill={st.text}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        {labelShow}
                      </text>
                      {cCount > 0 && (
                        <g
                          transform={`translate(${n.side === 'left' ? -w / 2 - 2 : w / 2 + 2}, 0)`}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            mutateNode(n.id, { collapsed: !n.collapsed });
                          }}
                        >
                          <circle r="8.5" fill="#FDFCF9" stroke={st.stroke} strokeWidth="1.2" />
                          <text x="0" y="3.5" fontSize="10" fontWeight="700" fill={st.stroke} textAnchor="middle">
                            {n.collapsed ? `+${cCount}` : '−'}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Selected Node Inspector */}
          {selectedNode && (
            <div style={{ padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border-hairline)', background: '#FAF8F4', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  <IconEditPen size={13} color="var(--accent)" />
                  <span>节点编辑：{selectedNode.label}</span>
                  <span className="stamp-badge stamp-neutral">{CAT_PALETTE[selectedNode.category || 'intuition']?.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => handleAddChild(false)} data-testid="btn-mindmap-add-child">
                    + 子节点
                  </button>
                  {selectedNode.level > 0 && (
                    <button type="button" className="btn btn-surface btn-sm" onClick={() => handleAddChild(true)}>
                      + 同级节点
                    </button>
                  )}
                  {selectedNode.level > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--seal)' }} onClick={() => handleDeleteNode(selectedNode.id)}>
                      删除
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(130px, 0.7fr) minmax(200px, 1.3fr)', gap: 8 }}>
                <input
                  className="input"
                  style={{ padding: '5px 9px', fontSize: 12.5 }}
                  value={selectedNode.label}
                  onChange={(e) => mutateNode(selectedNode.id, { label: e.target.value })}
                  placeholder="节点标题"
                  data-testid="mindmap-node-label-input"
                />
                <select
                  className="select"
                  style={{ padding: '5px 8px', fontSize: 12 }}
                  disabled={selectedNode.level === 0}
                  value={selectedNode.category}
                  onChange={(e) => mutateNode(selectedNode.id, { category: e.target.value as MindMapCategory })}
                >
                  {Object.entries(CAT_PALETTE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 5 }}>
                  <select
                    className="select"
                    style={{ padding: '5px 8px', fontSize: 12 }}
                    value={linkTargetId}
                    onChange={(e) => setLinkTargetId(e.target.value)}
                  >
                    <option value="">建立跨分支虚线关联…</option>
                    {(draftGraph?.nodes || [])
                      .filter((x) => x.id !== selectedNode.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          连向：{x.label.slice(0, 16)}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="btn btn-surface btn-sm" disabled={!linkTargetId} onClick={handleAddCrossLink}>
                    连线
                  </button>
                </div>
              </div>

              <input
                className="input"
                style={{ padding: '5px 9px', fontSize: 12 }}
                value={selectedNode.note || ''}
                onChange={(e) => mutateNode(selectedNode.id, { note: e.target.value })}
                placeholder="补充节点公式或文字说明…"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
