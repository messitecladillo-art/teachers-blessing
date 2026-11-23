import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { apiJson, isStaticDemoMode, postEventStream } from '../services/api';
import { BoardBlock, CourseLecture, CourseRecord, MindMapRecord } from '../types';
import { FunctionPlotCard } from '../components/FunctionPlotCard';
import { MathText } from '../components/MathText';
import { HkIcon, HkMascot } from '../components/HkAssets';

const MindMapDrawioWorkbench = lazy(() =>
  import('../components/MindMapDrawioWorkbench').then((m) => ({ default: m.MindMapDrawioWorkbench }))
);

interface HkWhiteboardViewProps {
  course: CourseRecord;
  lectureId: string;
  onExit: () => void;
  onCourseUpdated: (c: CourseRecord) => void;
  onOpenCheatsheet: () => void;
  onSelectLecture: (lid: string) => void;
}

const VOICE_OPTIONS = [
  { id: 'zh_female_clear', name: '清晰女声 · 课堂领读', desc: '节奏平稳，适合板书梳理' },
  { id: 'zh_male_steady', name: '沉稳男声 · 推导精讲', desc: '逻辑感强，适合公式推导' },
  { id: 'zh_female_warm', name: '温和讲师 · 启发追问', desc: '适合反例讨论与问答' },
  { id: 'zh_male_fast', name: '精炼男声 · 考前串讲', desc: '语速紧凑，适合快速复习' },
];

export const HkWhiteboardView: React.FC<HkWhiteboardViewProps> = ({
  course,
  lectureId,
  onExit,
  onCourseUpdated,
  onOpenCheatsheet,
  onSelectLecture,
}) => {
  const foundLecture: CourseLecture =
    course.units.flatMap((u) => u.lectures).find((l) => l.id === lectureId) ||
    course.units?.[0]?.lectures?.[0];

  const [boardMode, setBoardMode] = useState<'board' | 'visual' | 'mindmap'>('board');
  const [zoomPct, setZoomPct] = useState(100);
  const [pageIdx, setPageIdx] = useState(0);
  const [drawerWidth, setDrawerWidth] = useState(375);
  const [handwritingFont, setHandwritingFont] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.1);
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHovered, setSettingsHovered] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(true);
  const [pulsedBlockId, setPulsedBlockId] = useState<string>('');
  const [speaking, setSpeaking] = useState(false);

  const [annotateMode, setAnnotateMode] = useState(false);
  const [penColor, setPenColor] = useState<'#facc15' | '#ef4444' | '#2563eb'>('#facc15');
  const [strokesByPage, setStrokesByPage] = useState<
    Record<string, { id: string; color: string; width: number; opacity: number; d: string }[]>
  >({});
  const [activeStroke, setActiveStroke] = useState<{
    id: string;
    color: string;
    width: number;
    opacity: number;
    pts: [number, number][];
  } | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState('');
  const [streamingStage, setStreamingStage] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [linkedMap, setLinkedMap] = useState<MindMapRecord | null>(null);

  const dragResizingRef = useRef(false);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopAudioPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  useEffect(() => {
    setPageIdx(0);
    setBoardMode('board');
    setAnnotateMode(false);
    stopAudioPlayback();
  }, [lectureId]);

  useEffect(() => () => stopAudioPlayback(), []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [foundLecture?.messages?.length]);

  useEffect(() => {
    if (boardMode === 'mindmap' && course.linked_ids?.mindmap_id && !linkedMap) {
      apiJson<{ mindmaps: MindMapRecord[] }>('/api/mindmap/list')
        .then((res) => {
          const hit = res.mindmaps.find((m) => m.id === course.linked_ids.mindmap_id) || res.mindmaps[0];
          if (hit) setLinkedMap(hit);
        })
        .catch(() => {});
    }
  }, [boardMode, course.linked_ids, linkedMap]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragResizingRef.current) return;
      const newW = Math.min(540, Math.max(290, window.innerWidth - e.clientX - 18));
      setDrawerWidth(newW);
    };
    const onUp = () => {
      dragResizingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!foundLecture) {
    return (
      <div className="hk-page-wrap">
        <button type="button" className="hk-pill-control" onClick={onExit}>
          ← 返回课程
        </button>
        <div style={{ marginTop: 20 }}>该课程暂无讲次板书。</div>
      </div>
    );
  }

  const pages = foundLecture.board_pages || [];
  const safePageIdx = Math.min(pageIdx, Math.max(0, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const handleAnchorJump = (blockId?: string) => {
    if (!blockId) return;
    setBoardMode('board');
    // Find which page contains blockId
    const pIndex = pages.findIndex((p) => (p.blocks || []).some((b) => b.id === blockId));
    if (pIndex !== -1 && pIndex !== safePageIdx) {
      setPageIdx(pIndex);
    }
    window.setTimeout(() => {
      const el = blockRefs.current[blockId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setPulsedBlockId(blockId);
      window.setTimeout(() => setPulsedBlockId(''), 1600);
    }, 60);
  };

  const handleToggleSpeak = async () => {
    if (speaking) {
      stopAudioPlayback();
      return;
    }
    const textToRead = [
      currentPage?.roadmap_title || foundLecture.title,
      ...(currentPage?.blocks || []).flatMap((b) => [b.heading, ...b.lines]),
    ]
      .join('。')
      .replace(/\$+/g, '')
      .trim();
    if (!textToRead) return;

    const fallbackBrowserSpeech = () => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSpeaking(false);
        return;
      }
      const utter = new SpeechSynthesisUtterance(textToRead);
      utter.lang = 'zh-CN';
      utter.rate = speechRate;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    };

    setSpeaking(true);
    if (isStaticDemoMode()) {
      fallbackBrowserSpeech();
      return;
    }
    try {
      const resp = await fetch(`/api/courses/${course.id}/lectures/${foundLecture.id}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToRead, voice: voiceId }),
      });
      if (!resp.ok) throw new Error('tts failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = speechRate;
      audioRef.current = audio;
      audio.onended = () => stopAudioPlayback();
      audio.onerror = () => fallbackBrowserSpeech();
      await audio.play();
    } catch {
      fallbackBrowserSpeech();
    }
  };

  const handleSendChat = async () => {
    const q = chatInput.trim();
    if (!q || sending) return;
    setChatInput('');
    setSending(true);
    setOptimisticUserMsg(q);
    setStreamingStage('正在理解问题并梳理板书…');
    setStreamingReply('');
    try {
      await postEventStream(
        `/api/courses/${course.id}/lectures/${foundLecture.id}/chat-stream`,
        { message: q },
        (evt, data) => {
          if (evt === 'stage') {
            setStreamingStage(String(data.message || ''));
          } else if (evt === 'delta') {
            setStreamingReply((prev) => prev + String(data.text || ''));
          } else if (evt === 'result') {
            if (data.course) onCourseUpdated(data.course as unknown as CourseRecord);
            const pIdx = Number(data.page_index || 0);
            if (pIdx >= 1) setPageIdx(pIdx - 1);
            const blk = data.new_board_block as unknown as BoardBlock | undefined;
            if (blk?.id) handleAnchorJump(blk.id);
          }
        }
      );
    } catch {
      /* ignore stream transient */
    } finally {
      setSending(false);
      setOptimisticUserMsg('');
      setStreamingStage('');
      setStreamingReply('');
    }
  };

  const pageStrokeKey = `${foundLecture.id}:${safePageIdx}`;
  const currentStrokes = strokesByPage[pageStrokeKey] || [];

  const handleExportBoardMd = () => {
    const lines: string[] = [`# ${course.title} · ${foundLecture.title}`, ''];
    pages.forEach((pg, pi) => {
      lines.push(`## 第 ${pi + 1} 页：${pg.roadmap_title}`, '');
      (pg.blocks || []).forEach((b) => {
        lines.push(`### ${b.heading}${b.verified_badge ? `（${b.verified_badge}）` : ''}`);
        b.lines.forEach((ln) => lines.push(`- ${ln}`));
        if (b.highlight_note) lines.push(`> 重点：${b.highlight_note}`);
        lines.push('');
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${foundLecture.title}_板书.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMarkCompleted = async () => {
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ lecture_id: foundLecture.id, mastery: 'mastered' }),
      });
      if (res.course) onCourseUpdated(res.course);
    } catch {
      /* ignore */
    }
    onExit();
  };

  const visualExpr =
    foundLecture.visualizer_preset === 'ln_quad'
      ? 'ln(x) + 0.5*x^2'
      : foundLecture.visualizer_preset === 'kepler'
      ? '1/(x^2 + 0.35)'
      : 'x^3 - 3*x^2 + 2';

  return (
    <div className="hk-whiteboard-shell">
      {/* LEFT MAIN WHITEBOARD PANE */}
      <div className={`hk-wb-board-pane ${showDots ? 'hk-dot-canvas' : ''}`}>
        {/* Top Floating Controls */}
        <div className="hk-wb-float-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="hk-circle-btn"
              title="退出白板课堂"
              aria-label="退出白板课堂"
              onClick={() => setExitConfirmOpen(true)}
            >
              ×
            </button>

            <div className="hk-wb-pill-bar" style={{ padding: '5px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#181a1f' }}>{foundLecture.title}</span>
              <span
                title="板书与对话已实时同步"
                style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 12, marginLeft: 4 }}
              >
                <span style={{ width: 2.5, height: 5, background: '#16a34a', borderRadius: 2 }} />
                <span style={{ width: 2.5, height: 8, background: '#16a34a', borderRadius: 2 }} />
                <span style={{ width: 2.5, height: 11, background: '#16a34a', borderRadius: 2 }} />
              </span>
            </div>
          </div>

          <div className="hk-wb-pill-bar">
            {boardMode === 'board' && (
              <>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => setZoomPct((z) => Math.max(70, z - 10))}
                  aria-label="缩小画板"
                >
                  −
                </button>
                <span className="mono-num" style={{ fontSize: 12.5, minWidth: 42, textAlign: 'center', fontWeight: 600 }}>
                  {zoomPct}%
                </span>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => setZoomPct((z) => Math.min(140, z + 10))}
                  aria-label="放大画板"
                >
                  +
                </button>
                <span style={{ width: 1, height: 16, background: '#e5e7eb' }} />
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  disabled={safePageIdx <= 0}
                  onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                  aria-label="上一页板书"
                >
                  ‹
                </button>
                <span className="mono-num" style={{ fontSize: 12.5, minWidth: 34, textAlign: 'center', fontWeight: 600 }}>
                  {safePageIdx + 1} / {Math.max(1, pages.length)}
                </span>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  disabled={safePageIdx >= pages.length - 1}
                  onClick={() => setPageIdx((p) => Math.min(pages.length - 1, p + 1))}
                  aria-label="下一页板书"
                >
                  ›
                </button>
                <span style={{ width: 1, height: 16, background: '#e5e7eb' }} />
              </>
            )}

            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'board' ? 'active' : ''}`}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setBoardMode('board')}
            >
              板书
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'visual' ? 'active' : ''}`}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setBoardMode('visual')}
            >
              函数画板
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'mindmap' ? 'active' : ''}`}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setBoardMode('mindmap')}
            >
              结构导图
            </button>
            <button
              type="button"
              className="seg-switch-btn"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onOpenCheatsheet}
            >
              速查表
            </button>

            {boardMode === 'board' && (
              <>
                <button
                  type="button"
                  className={`seg-switch-btn ${annotateMode ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setAnnotateMode((v) => !v)}
                >
                  ✎ 批注
                </button>
                <button
                  type="button"
                  className="seg-switch-btn"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  title="导出本讲板书 Markdown"
                  onClick={handleExportBoardMd}
                >
                  导出板书
                </button>
              </>
            )}

            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="hk-collapse-btn"
                aria-label="白板设置"
                onMouseEnter={() => setSettingsHovered(true)}
                onMouseLeave={() => setSettingsHovered(false)}
                onClick={() => setSettingsOpen((v) => !v)}
              >
                ⚙
              </button>
              {settingsHovered && !settingsOpen && (
                <div
                  className="hk-dark-tooltip"
                  style={{ left: 'auto', right: 0, top: 'calc(100% + 8px)', width: 210 }}
                >
                  设置：可调节字体/语音/速度/显示等
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Floating Highlighter Sub-bar when Annotate Mode Active */}
        {boardMode === 'board' && annotateMode && (
          <div
            style={{
              position: 'absolute',
              top: 64,
              right: 20,
              zIndex: 16,
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 999,
              padding: '5px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#6b7280', fontWeight: 600 }}>画笔:</span>
            {[
              { c: '#facc15' as const, label: '荧光黄' },
              { c: '#ef4444' as const, label: '红笔' },
              { c: '#2563eb' as const, label: '蓝笔' },
            ].map((p) => (
              <button
                key={p.c}
                type="button"
                title={p.label}
                onClick={() => setPenColor(p.c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '999px',
                  background: p.c,
                  border: penColor === p.c ? '2px solid #181a1f' : '1px solid rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
            <span style={{ width: 1, height: 14, background: '#e5e7eb' }} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 7px', fontSize: 11.5 }}
              disabled={currentStrokes.length === 0}
              onClick={() =>
                setStrokesByPage((prev) => ({
                  ...prev,
                  [pageStrokeKey]: (prev[pageStrokeKey] || []).slice(0, -1),
                }))
              }
            >
              撤销
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 7px', fontSize: 11.5 }}
              disabled={currentStrokes.length === 0}
              onClick={() => setStrokesByPage((prev) => ({ ...prev, [pageStrokeKey]: [] }))}
            >
              清空
            </button>
          </div>
        )}

        {/* Whiteboard Main Body */}
        <div className="hk-wb-canvas-scroll">
          {boardMode === 'board' && currentPage && (
            <div
              style={{
                position: 'relative',
                maxWidth: 760,
                margin: '0 auto',
                transform: `scale(${zoomPct / 100})`,
                transformOrigin: 'top center',
                transition: 'transform 0.16s ease',
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: 26 }}>
                <h2
                  className={`hk-marker-yellow ${handwritingFont ? '' : 'serif-heading'}`}
                  style={{
                    margin: 0,
                    fontSize: 28,
                    fontFamily: handwritingFont ? 'var(--font-hand)' : 'var(--font-sans)',
                    color: '#2c4370',
                  }}
                >
                  {currentPage.roadmap_title}
                </h2>
              </div>

              {(currentPage.blocks || []).map((blk) => (
                <div
                  key={blk.id}
                  ref={(el) => {
                    blockRefs.current[blk.id] = el;
                  }}
                  className={`hk-wb-block ${handwritingFont ? 'handwriting' : ''} ${pulsedBlockId === blk.id ? 'pulsed' : ''}`}
                  style={{
                    borderLeft: '3px solid #c8dcfa',
                    background: 'rgba(255, 255, 255, 0.72)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: handwritingFont ? 21 : 18,
                        fontWeight: 700,
                        color: '#181a1f',
                      }}
                    >
                      <MathText text={blk.heading} />
                    </div>
                    {blk.verified_badge && (
                      <span
                        className="badge badge-verified"
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          background: '#ecfdf5',
                          color: '#166534',
                          border: '1px solid #a7f3d0',
                          borderRadius: 999,
                        }}
                      >
                        ✓ {blk.verified_badge}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: handwritingFont ? 18 : 15.5 }}>
                    {blk.lines.map((line, i) => (
                      <div key={i} style={{ paddingLeft: 12 }}>
                        <MathText text={line} />
                      </div>
                    ))}
                  </div>
                  {blk.highlight_note && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: '#fef9c3',
                        color: '#713f12',
                        fontSize: 13.5,
                        fontWeight: 600,
                      }}
                    >
                      重点：<MathText text={blk.highlight_note} />
                    </div>
                  )}
                </div>
              ))}

              {/* Freehand Annotation SVG Overlay */}
              <svg
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  zIndex: 8,
                  pointerEvents: annotateMode ? 'auto' : 'none',
                  cursor: annotateMode ? 'crosshair' : 'default',
                  touchAction: annotateMode ? 'none' : 'auto',
                }}
                onPointerDown={(e) => {
                  if (!annotateMode) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.round(e.clientX - rect.left);
                  const y = Math.round(e.clientY - rect.top);
                  setActiveStroke({
                    id: `strk_${Date.now()}`,
                    color: penColor,
                    width: penColor === '#facc15' ? 14 : 3.2,
                    opacity: penColor === '#facc15' ? 0.38 : 0.88,
                    pts: [[x, y]],
                  });
                }}
                onPointerMove={(e) => {
                  if (!annotateMode || !activeStroke) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.round(e.clientX - rect.left);
                  const y = Math.round(e.clientY - rect.top);
                  setActiveStroke((prev) => (prev ? { ...prev, pts: [...prev.pts, [x, y]] } : null));
                }}
                onPointerUp={() => {
                  if (!activeStroke) return;
                  if (activeStroke.pts.length >= 2) {
                    const d = activeStroke.pts
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
                      .join(' ');
                    setStrokesByPage((prev) => ({
                      ...prev,
                      [pageStrokeKey]: [
                        ...(prev[pageStrokeKey] || []),
                        {
                          id: activeStroke.id,
                          color: activeStroke.color,
                          width: activeStroke.width,
                          opacity: activeStroke.opacity,
                          d,
                        },
                      ],
                    }));
                  }
                  setActiveStroke(null);
                }}
              >
                {currentStrokes.map((st) => (
                  <path
                    key={st.id}
                    d={st.d}
                    fill="none"
                    stroke={st.color}
                    strokeWidth={st.width}
                    strokeOpacity={st.opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {activeStroke && activeStroke.pts.length >= 2 && (
                  <path
                    d={activeStroke.pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')}
                    fill="none"
                    stroke={activeStroke.color}
                    strokeWidth={activeStroke.width}
                    strokeOpacity={activeStroke.opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </div>
          )}

          {boardMode === 'visual' && (
            <div style={{ maxWidth: 820, margin: '0 auto' }}>
              <FunctionPlotCard
                initialExpr={visualExpr}
                activePreset={
                  foundLecture.visualizer_preset === 'group_z6'
                    ? { preset_id: 'cyclic_group', dimension: '2d' }
                    : foundLecture.visualizer_preset === 'riemann'
                    ? { preset_id: 'complex_surface', dimension: '3d' }
                    : null
                }
              />
            </div>
          )}

          {boardMode === 'mindmap' && (
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
              <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>正在加载结构导图…</div>}>
                <MindMapDrawioWorkbench compact subject={course.subject} externalMap={linkedMap} />
              </Suspense>
            </div>
          )}
        </div>

        {/* Bottom Left Audio Speaker Pill */}
        <button
          type="button"
          className="hk-circle-btn"
          title={speaking ? '停止板书朗读' : '朗读当前板书'}
          aria-label="语音朗读板书"
          onClick={handleToggleSpeak}
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            background: speaking ? '#3b4f7d' : '#ffffff',
            color: speaking ? '#ffffff' : '#181a1f',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
          }}
        >
          {speaking ? '■' : '🔊'}
        </button>

        {/* Bottom Center Toast */}
        {toastOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 999,
              padding: '6px 8px 6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
              fontSize: 12.5,
              color: '#374151',
              zIndex: 12,
              whiteSpace: 'nowrap',
            }}
          >
            <span>已载入课堂板书，可在右侧追问或点击「板书」定位重点。</span>
            <button
              type="button"
              className="btn btn-seal btn-sm"
              style={{ padding: '5px 12px', fontSize: 12 }}
              onClick={() => setToastOpen(false)}
            >
              知道了
            </button>
          </div>
        )}
      </div>

      {/* SPLITTER HANDLE */}
      <div
        className="hk-wb-resizer"
        title="拖动调整对话栏宽度"
        onMouseDown={() => {
          dragResizingRef.current = true;
        }}
      >
        <div className="hk-wb-resizer-bar" />
      </div>

      {/* RIGHT CONVERSATION HISTORY DRAWER */}
      <aside className="hk-wb-drawer" style={{ width: drawerWidth }}>
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid #eef0f3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14.5 }}>
            <HkIcon name="history" size={17} />
            <span>对话历史</span>
          </div>
          <select
            className="select"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
            value={foundLecture.id}
            onChange={(e) => onSelectLecture(e.target.value)}
            aria-label="切换讲次"
          >
            {course.units.flatMap((u) =>
              u.lectures.map((l) => (
                <option key={l.id} value={l.id}>
                  单元{u.unit_index}: {l.title}
                </option>
              ))
            )}
          </select>
        </div>

        <div
          ref={chatScrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {(foundLecture.messages || []).map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                maxWidth: m.role === 'user' ? '85%' : '100%',
              }}
            >
              {m.role === 'user' ? (
                <div
                  style={{
                    background: '#f1f3f6',
                    color: '#181a1f',
                    borderRadius: '14px 14px 4px 14px',
                    padding: '9px 13px',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {m.content}
                </div>
              ) : (
                <div>
                  {m.board_anchor_id && (
                    <button
                      type="button"
                      className="hk-wb-anchor-chip"
                      onClick={() => handleAnchorJump(m.board_anchor_id)}
                    >
                      <span>✎</span>
                      <span>板书</span>
                    </button>
                  )}
                  <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151' }}>
                    <MathText text={m.content} />
                  </div>
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {optimisticUserMsg && (
                <div
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    background: '#f1f3f6',
                    color: '#181a1f',
                    borderRadius: '14px 14px 4px 14px',
                    padding: '9px 13px',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {optimisticUserMsg}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#6b7280' }}>
                <HkMascot state="thinking" size={28} />
                <span>{streamingStage || '正在推导并同步左侧板书…'}</span>
              </div>
              {streamingReply && (
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', background: '#f8fafc', padding: '10px 12px', borderRadius: 12 }}>
                  <MathText text={streamingReply} />
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 12px', borderTop: '1px solid #eef0f3' }}>
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: '6px 8px 6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#ffffff',
            }}
          >
            <input
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13.5,
                fontFamily: 'inherit',
                background: 'transparent',
              }}
              placeholder="输入问题..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
            />
            <button
              type="button"
              className={`hk-circle-btn submit ${chatInput.trim() ? 'ready' : ''}`}
              style={{ width: 30, height: 30 }}
              disabled={!chatInput.trim() || sending}
              aria-label="发送追问"
              onClick={handleSendChat}
            >
              ↑
            </button>
          </div>
        </div>
      </aside>

      {/* EXIT CONFIRMATION MODAL */}
      {exitConfirmOpen && (
        <div className="modal-backdrop" onClick={() => setExitConfirmOpen(false)}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>离开本节白板课堂？</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: '#6b7280' }}>
              你可以直接标记本讲为已掌握并更新学习进度，或仅返回课程空间保留当前进度。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-surface btn-sm" onClick={onExit}>
                直接退出
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleMarkCompleted}>
                标为已掌握并退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WHITEBOARD SETTINGS MODAL (1:1 step_123_shot_2) */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>设置</h2>
              <button type="button" className="hk-collapse-btn" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>白板语音选择</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {VOICE_OPTIONS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="hk-continue-card"
                      style={{
                        borderColor: voiceId === v.id ? '#3b4f7d' : '#e5e7eb',
                        background: voiceId === v.id ? '#e8eef9' : '#ffffff',
                      }}
                      onClick={() => setVoiceId(v.id)}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{v.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                  <span>朗读语速</span>
                  <span className="mono-num">{speechRate.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="2.2"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #eef0f3' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>板书手写体渲染</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>开启后白板推导采用手写楷体风格</div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${handwritingFont ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setHandwritingFont((v) => !v)}
                >
                  {handwritingFont ? '手写体' : '标准体'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #eef0f3' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>白板背景网点</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>辅助板书与图形排版对齐</div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${showDots ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setShowDots((v) => !v)}
                >
                  {showDots ? '显示点阵' : '纯白底'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
