import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, handleSafeDownload, postEventStream, resolveApiUrl, uploadSourceFile } from '../services/api';
import {
  AgentLinkedItem,
  AgentPlanStep,
  AgentThread,
  AgentToolTrace,
  CourseRecord,
  HkRoute,
  HomeTab,
  LearnerWeakTopic,
  MarketplaceCourse,
  PedagogyTopic,
  SourceDocMeta,
} from '../types';
import { HkIcon, HkMascot } from '../components/HkAssets';
import { MathText } from '../components/MathText';
import { assetUrl } from '../utils/assets';

const FunctionPlotCard = lazy(() =>
  import('../components/FunctionPlotCard').then((m) => ({ default: m.FunctionPlotCard }))
);

interface HkHomeViewProps {
  homeTab: HomeTab;
  activeThreadId: string | null;
  externalCraftDraft?: string | null;
  onConsumeCraftDraft?: () => void;
  externalInstantPrompt?: string | null;
  onConsumeInstantPrompt?: () => void;
  onSelectThread: (tid: string | null) => void;
  onCourseCrafted: (course: CourseRecord) => void;
  onOpenMarketplaceCourse: (marketId: string) => void;
  onNavigate: (route: HkRoute) => void;
  onOpenLinkedItem: (item: AgentLinkedItem, mode?: 'take' | 'view') => void;
  onThreadsChanged: () => void;
  onArtifactsChanged: () => void;
  onOpenCustomCheatsheet: (topic: string) => void;
}

const CRAFT_SUGGESTIONS = [
  '系统梳理《函数单调性与导数》，配齐直观切线演示与含参分类易错点',
  '从零掌握《线性代数：特征值与二次型对角化》，附带速查表与自测卷',
  '按《集合与常用逻辑用语》讲义备一节 15 分钟示范课，含随堂检测题',
  '梳理《行星运动与天体测距阶梯》，适合通识选修自学与课堂启发',
];

const INSTANT_HEADLINES = [
  '攻克导数压轴题？',
  '筹备 15 分钟微格试讲？',
  '理解群论与商群构造？',
  '把长讲义拆解成复习卡片？',
];

const INSTANT_PLACEHOLDERS = [
  '帮我分步梳理函数 f(x) = x³ - 3x² + 2 的单调性与极值，并验证驻点结果',
  '根据我的薄弱点出一份 4 题巩固卷，考后直接在线作答批改',
  '把刚上传的讲义提炼成一页重点速查表和思维导图',
];

export const HkHomeView: React.FC<HkHomeViewProps> = ({
  homeTab,
  activeThreadId,
  externalCraftDraft,
  onConsumeCraftDraft,
  externalInstantPrompt,
  onConsumeInstantPrompt,
  onSelectThread,
  onCourseCrafted,
  onOpenMarketplaceCourse,
  onNavigate,
  onOpenLinkedItem,
  onThreadsChanged,
  onArtifactsChanged,
  onOpenCustomCheatsheet,
}) => {
  // Craft state
  const [craftPrompt, setCraftPrompt] = useState('');
  const [craftMode, setCraftMode] = useState<'self_study' | 'teaching'>('self_study');
  const [craftDepth, setCraftDepth] = useState<'deep' | 'fast'>('deep');
  const [craftModelMenu, setCraftModelMenu] = useState(false);
  const [craftSourceIds, setCraftSourceIds] = useState<string[]>([]);
  const [craftPlusMenu, setCraftPlusMenu] = useState(false);
  const [crafting, setCrafting] = useState(false);
  const [craftStage, setCraftStage] = useState('');
  const [craftTipsOpen, setCraftTipsOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);

  // Instant assist state
  const [instantPrompt, setInstantPrompt] = useState('');
  const [instantSpeed, setInstantSpeed] = useState<'standard' | 'fast'>('standard');
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [hoveredSpeed, setHoveredSpeed] = useState<'standard' | 'fast' | null>(null);
  const [instantToolsOpen, setInstantToolsOpen] = useState(false);
  const [instantAddOpen, setInstantAddOpen] = useState(false);
  const [instantKbOpen, setInstantKbOpen] = useState(false);
  const [instantSpeedOpen, setInstantSpeedOpen] = useState(false);
  const [visualSandboxOpen, setVisualSandboxOpen] = useState(false);

  // Feed & Thread execution
  const [feedMode, setFeedMode] = useState<'today' | 'weak'>('today');
  const [topics, setTopics] = useState<PedagogyTopic[]>([]);
  const [topicOffset, setTopicOffset] = useState(0);
  const [weakTopics, setWeakTopics] = useState<LearnerWeakTopic[]>([]);
  const [marketPreview, setMarketPreview] = useState<MarketplaceCourse[]>([]);
  const [docs, setDocs] = useState<SourceDocMeta[]>([]);

  // Active instant conversation state
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [runningAgent, setRunningAgent] = useState(false);
  const [liveStages, setLiveStages] = useState<string[]>([]);
  const [liveTraces, setLiveTraces] = useState<AgentToolTrace[]>([]);
  const [livePlanSummary, setLivePlanSummary] = useState('');
  const [livePlanSteps, setLivePlanSteps] = useState<AgentPlanStep[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const anyPopoverOpen =
    craftModelMenu ||
    craftPlusMenu ||
    craftTipsOpen ||
    instantToolsOpen ||
    instantAddOpen ||
    instantKbOpen ||
    instantSpeedOpen;

  useEffect(() => {
    if (!anyPopoverOpen) return;
    const closeAllPopovers = () => {
      setCraftModelMenu(false);
      setCraftPlusMenu(false);
      setCraftTipsOpen(false);
      setInstantToolsOpen(false);
      setInstantAddOpen(false);
      setInstantKbOpen(false);
      setInstantSpeedOpen(false);
      setHoveredSpeed(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAllPopovers();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-hk-popover-root="true"]')) return;
      closeAllPopovers();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [anyPopoverOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSuggestIdx((i) => i + 1);
    }, 5200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    apiJson<{ featured_bento: MarketplaceCourse[] }>('/api/courses/marketplace')
      .then((res) => setMarketPreview((res.featured_bento || []).slice(0, 3)))
      .catch(() => {});
    apiJson<{ topics: PedagogyTopic[] }>('/api/pedagogy/topics')
      .then((res) => setTopics(res.topics || []))
      .catch(() => {});
    apiJson<{ weak_topics: LearnerWeakTopic[] }>('/api/agent/memory')
      .then((res) => setWeakTopics(res.weak_topics || []))
      .catch(() => {});
    apiJson<{ documents: SourceDocMeta[] }>('/api/sources/list')
      .then((res) => setDocs(res.documents || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setThread(null);
      return;
    }
    apiJson<{ thread: AgentThread }>(`/api/agent/threads/${activeThreadId}`)
      .then((res) => setThread(res.thread))
      .catch(() => {});
  }, [activeThreadId]);

  useEffect(() => {
    if (externalCraftDraft) {
      setCraftPrompt(externalCraftDraft);
      onConsumeCraftDraft?.();
    }
  }, [externalCraftDraft, onConsumeCraftDraft]);

  useEffect(() => {
    if (externalInstantPrompt) {
      setInstantPrompt(externalInstantPrompt);
      onConsumeInstantPrompt?.();
    }
  }, [externalInstantPrompt, onConsumeInstantPrompt]);

  const currentCraftHint = CRAFT_SUGGESTIONS[suggestIdx % CRAFT_SUGGESTIONS.length];
  const currentHeadline = INSTANT_HEADLINES[suggestIdx % INSTANT_HEADLINES.length];
  const currentInstantHint = INSTANT_PLACEHOLDERS[suggestIdx % INSTANT_PLACEHOLDERS.length];

  const feedTopics = useMemo(() => {
    if (!topics.length) return [];
    const out: PedagogyTopic[] = [];
    for (let i = 0; i < Math.min(5, topics.length); i++) {
      out.push(topics[(topicOffset + i) % topics.length]);
    }
    return out;
  }, [topics, topicOffset]);

  const handleUploadTrigger = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErrorMsg('');
    try {
      const up = await uploadSourceFile(f);
      const list = await apiJson<{ documents: SourceDocMeta[] }>('/api/sources/list');
      setDocs(list.documents || []);
      setCraftSourceIds((prev) => Array.from(new Set([...prev, up.source_id])));
      if (homeTab === 'craft' && !craftPrompt.trim()) {
        setCraftPrompt(`根据上传讲义《${up.filename}》梳理一门结构化课程，包含讲次板书、速查表与巩固练习`);
      } else if (homeTab === 'instant' && !instantPrompt.trim()) {
        setInstantPrompt(`结合刚上传的资料《${up.filename}》，帮我梳理重点并出 4 道巩固测试题`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '文件解析失败');
    }
  };

  const submitCraftCourse = async () => {
    const promptVal = craftPrompt.trim();
    if (!promptVal || crafting) return;
    setCrafting(true);
    setCraftStage('正在解析课程主题与讲义资料…');
    setErrorMsg('');
    try {
      await postEventStream(
        '/api/courses/craft',
        {
          prompt: promptVal,
          mode: craftMode,
          depth: craftDepth,
          source_doc_ids: craftSourceIds,
        },
        (evt, data) => {
          if (evt === 'stage') {
            setCraftStage(String(data.message || '正在生成…'));
          } else if (evt === 'result' && data.course) {
            onArtifactsChanged();
            onCourseCrafted(data.course as unknown as CourseRecord);
          } else if (evt === 'error') {
            setErrorMsg(String(data.message || '课程生成遇到问题'));
          }
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '课程生成失败');
    } finally {
      setCrafting(false);
    }
  };

  const runInstantAssist = async (customText?: string) => {
    const textVal = (customText ?? instantPrompt).trim();
    if (!textVal || runningAgent) return;
    setInstantPrompt('');
    setRunningAgent(true);
    setErrorMsg('');
    setLiveStages(['正在梳理需求并匹配知识库与学习记录…']);
    setLiveTraces([]);
    setLivePlanSteps([]);
    setLivePlanSummary('');

    try {
      await postEventStream(
        '/api/agent/chat',
        {
          thread_id: thread?.id || null,
          message: textVal,
          require_confirmation: instantSpeed === 'standard' && confirmBeforeRun,
          speed_mode: instantSpeed,
        },
        (evt, data) => {
          if (evt === 'stage') {
            setLiveStages((s) => [...s, String(data.message || '')]);
          } else if (evt === 'plan') {
            setLivePlanSummary(String(data.summary || ''));
            setLivePlanSteps((data.steps as AgentPlanStep[]) || []);
          } else if (evt === 'step_start') {
            setLiveStages((s) => [...s, `正在执行：${String(data.label || '')}`]);
          } else if (evt === 'step_done') {
            setLiveTraces((t) => [...t, data as unknown as AgentToolTrace]);
          } else if (evt === 'clarify' || evt === 'plan_confirmation') {
            const th = data.thread as unknown as AgentThread;
            if (th) {
              setThread(th);
              onSelectThread(th.id);
              onThreadsChanged();
            }
          } else if (evt === 'result') {
            const th = data.thread as unknown as AgentThread;
            if (th) {
              setThread(th);
              onSelectThread(th.id);
              onThreadsChanged();
              onArtifactsChanged();
            }
          } else if (evt === 'error') {
            setErrorMsg(String(data.message || '执行遇到异常'));
            setInstantPrompt((curr) => (curr.trim() ? curr : textVal));
          }
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '任务请求失败');
      setInstantPrompt((curr) => (curr.trim() ? curr : textVal));
    } finally {
      setRunningAgent(false);
    }
  };

  const handleConfirmPlan = async (tid: string) => {
    setRunningAgent(true);
    setErrorMsg('');
    setLiveStages(['正在按确认步骤执行…']);
    setLiveTraces([]);
    try {
      await postEventStream(`/api/agent/threads/${tid}/execute-plan`, {}, (evt, data) => {
        if (evt === 'step_start') setLiveStages((s) => [...s, `正在执行：${String(data.label || '')}`]);
        else if (evt === 'step_done') setLiveTraces((t) => [...t, data as unknown as AgentToolTrace]);
        else if (evt === 'result') {
          const th = data.thread as unknown as AgentThread;
          if (th) setThread(th);
          onThreadsChanged();
          onArtifactsChanged();
        } else if (evt === 'error') {
          setErrorMsg(String(data.message || '方案执行遇到异常'));
        }
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '方案执行失败');
    } finally {
      setRunningAgent(false);
    }
  };

  return (
    <div className="hk-home-stage">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.pptx,.xlsx,.md,.txt,.csv,.tex,.html,.zip"
        style={{ display: 'none' }}
        onChange={handleUploadTrigger}
      />

      {/* ACTIVE THREAD CONVERSATION VIEW FOR INSTANT ASSIST */}
      {homeTab === 'instant' && (thread || runningAgent) ? (
        <div style={{ width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              className="hk-pill-control"
              onClick={() => {
                setThread(null);
                onSelectThread(null);
                setLiveStages([]);
                setLiveTraces([]);
              }}
            >
              <span>←</span>
              <span>返回即时协助主页</span>
            </button>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#374151' }}>{thread?.title || '正在处理中…'}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(thread?.messages || []).map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'stretch',
                  maxWidth: msg.role === 'user' ? '78%' : '100%',
                  background: msg.role === 'user' ? '#3b4f7d' : '#ffffff',
                  color: msg.role === 'user' ? '#ffffff' : '#181a1f',
                  border: msg.role === 'user' ? 'none' : '1px solid #e5e7eb',
                  borderRadius: 16,
                  padding: '14px 18px',
                  boxShadow: 'var(--shadow-paper)',
                }}
              >
                {msg.role === 'user' ? (
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>{msg.content}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <MathText text={msg.content} />

                    {msg.tool_traces && msg.tool_traces.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {msg.tool_traces.map((tr) => (
                          <span key={tr.index} className={`badge ${tr.ok ? 'badge-verified' : 'badge-warn'}`}>
                            {tr.ok ? '✓' : '!'} {tr.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.needs_confirmation && thread?.status === 'awaiting_confirmation' && (
                      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={runningAgent}
                          onClick={() => handleConfirmPlan(thread.id)}
                        >
                          确认执行方案
                        </button>
                      </div>
                    )}

                    {msg.linked_items && msg.linked_items.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, paddingTop: 4 }}>
                        {msg.linked_items.map((item) => (
                          <div
                            key={`${item.kind}-${item.id}`}
                            style={{
                              border: '1px solid #e5e7eb',
                              borderRadius: 12,
                              padding: '11px 13px',
                              background: '#f8f9fb',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#3b4f7d' }}>{item.subtitle}</div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#181a1f', marginTop: 2 }}>{item.title}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => onOpenLinkedItem(item, item.kind === 'exam' ? 'take' : 'view')}
                              >
                                {item.kind === 'exam'
                                  ? '在线作答'
                                  : item.kind === 'course'
                                  ? '进入课程'
                                  : item.kind === 'cheatsheet'
                                  ? '打开速查表'
                                  : item.kind === 'plan'
                                  ? '查看学习日历'
                                  : '打开查看'}
                              </button>
                              {item.download_url && (
                                <a
                                  href={resolveApiUrl(item.download_url)}
                                  onClick={(e) => handleSafeDownload(e, item.download_url, item.title)}
                                  className="btn btn-surface btn-sm"
                                  style={{ textDecoration: 'none' }}
                                >
                                  下载
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {runningAgent && (
              <div className="stream-trace">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                  <HkMascot state="thinking" size={32} />
                  <span>{livePlanSummary || liveStages[liveStages.length - 1] || '正在处理请求…'}</span>
                </div>
                {livePlanSteps.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    步骤清单：{livePlanSteps.map((s) => s.step_label).join(' → ')}
                  </div>
                )}
                {liveTraces.map((tr) => (
                  <div key={tr.index} style={{ fontSize: 12.5, color: '#166534', marginTop: 4 }}>
                    ✓ {tr.label} — {tr.summary}
                  </div>
                ))}
              </div>
            )}
          </div>

          {errorMsg && <div className="callout-danger">{errorMsg}</div>}

          <div className="hk-composer-card" style={{ maxWidth: '100%' }}>
            <div className="hk-composer-input-row" style={{ padding: '12px 16px' }}>
              <textarea
                className="hk-composer-textarea"
                rows={2}
                placeholder="继续追问，或要求联动调整上面的教案、课件或测验卷…"
                value={instantPrompt}
                onChange={(e) => setInstantPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    runInstantAssist();
                  }
                }}
              />
            </div>
            <div className="hk-composer-toolbar" style={{ paddingTop: 0 }}>
              <div className="hk-composer-tools-left">
                <button type="button" className="hk-circle-btn" onClick={() => fileInputRef.current?.click()} title="上传补充资料">
                  +
                </button>
              </div>
              <div className="hk-composer-tools-right">
                <button
                  type="button"
                  className={`hk-circle-btn submit ${instantPrompt.trim() ? 'ready' : ''}`}
                  disabled={!instantPrompt.trim() || runningAgent}
                  onClick={() => runInstantAssist()}
                  aria-label="发送"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : homeTab === 'craft' ? (
        /* ===========================
           MODE 1: CRAFT COURSES
           =========================== */
        <>
          <h1 className="hk-hero-heading">
            <span>使用</span>
            <HkMascot state={crafting ? 'thinking' : 'welcome'} size={52} />
            <span>知学打造你的</span>
            <span className="hk-brush-blue">专属课程</span>
          </h1>
          <p className="hk-hero-sub">
            输入学习目标或上传讲义，自动梳理单元结构、白板板书、速查表与配套测验
          </p>

          {errorMsg && (
            <div className="callout-danger" style={{ maxWidth: 650, width: '100%', marginBottom: 14 }}>
              {errorMsg}
            </div>
          )}

          <div className="hk-composer-card">
            <div className="hk-composer-input-row">
              <textarea
                className="hk-composer-textarea"
                rows={3}
                placeholder="输入想学或要备课的主题、课程描述…"
                value={craftPrompt}
                onChange={(e) => setCraftPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && !craftPrompt.trim()) {
                    e.preventDefault();
                    setCraftPrompt(currentCraftHint);
                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitCraftCourse();
                  }
                }}
              />
              {!craftPrompt.trim() && (
                <button
                  type="button"
                  className="hk-tab-hint-btn"
                  onClick={() => setCraftPrompt(currentCraftHint)}
                >
                  <span>示例：{currentCraftHint}</span>
                  <span className="hk-tab-cap">tab</span>
                </button>
              )}
              {craftSourceIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {craftSourceIds.map((sid) => {
                    const doc = docs.find((d) => d.id === sid);
                    return (
                      <span key={sid} className="badge badge-info">
                        已附讲义：{doc?.title || sid}
                        <button
                          type="button"
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', marginLeft: 4, color: 'inherit' }}
                          onClick={() => setCraftSourceIds((arr) => arr.filter((x) => x !== sid))}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="hk-composer-toolbar">
              <div className="hk-composer-tools-left">
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-circle-btn"
                    aria-label="添加文件或讲义"
                    onClick={() => {
                      setCraftPlusMenu((v) => !v);
                      setCraftModelMenu(false);
                      setCraftTipsOpen(false);
                    }}
                  >
                    +
                  </button>
                  {craftPlusMenu && (
                    <div className="hk-popover-menu">
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setCraftPlusMenu(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        <span>上传本地讲义文件</span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setCraftPlusMenu(false);
                          onNavigate('kb');
                        }}
                      >
                        <span>打开个人知识库</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="hk-mode-switcher" style={{ padding: 2 }}>
                  <button
                    type="button"
                    className={`hk-mode-btn ${craftMode === 'self_study' ? 'active' : ''}`}
                    style={{ padding: '4px 11px', fontSize: 12.5 }}
                    onClick={() => setCraftMode('self_study')}
                  >
                    自学
                  </button>
                  <button
                    type="button"
                    className={`hk-mode-btn ${craftMode === 'teaching' ? 'active' : ''}`}
                    style={{ padding: '4px 11px', fontSize: 12.5 }}
                    onClick={() => setCraftMode('teaching')}
                  >
                    课堂教学
                  </button>
                </div>
              </div>

              <div className="hk-composer-tools-right">
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-chip-btn"
                    onClick={() => {
                      setCraftModelMenu((v) => !v);
                      setCraftPlusMenu(false);
                      setCraftTipsOpen(false);
                    }}
                  >
                    <span>{craftDepth === 'deep' ? '精编课程 ▾' : '快速大纲 ▾'}</span>
                  </button>
                  {craftModelMenu && (
                    <div className="hk-popover-menu right" style={{ minWidth: 210 }}>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setCraftDepth('deep');
                          setCraftModelMenu(false);
                        }}
                      >
                        <span>精编课程（含板书与速查）</span>
                        {craftDepth === 'deep' && <span>✓</span>}
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setCraftDepth('fast');
                          setCraftModelMenu(false);
                        }}
                      >
                        <span>快速大纲（3 单元轻量生成）</span>
                        {craftDepth === 'fast' && <span>✓</span>}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={`hk-circle-btn submit ${craftPrompt.trim() ? 'ready' : ''}`}
                  disabled={!craftPrompt.trim() || crafting}
                  aria-label="开始生成课程"
                  onClick={submitCraftCourse}
                >
                  {crafting ? '…' : '↑'}
                </button>
              </div>
            </div>

            <div className="hk-composer-tray">
              <span>或从已索引文档快速生成：</span>
              {docs.slice(0, 2).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="hk-tray-link"
                  onClick={() => {
                    setCraftSourceIds([d.id]);
                    setCraftPrompt(`按《${d.title}》分章构建系统课程，附带板书路线图与巩固自测`);
                  }}
                >
                  {d.title.slice(0, 12)}
                </button>
              ))}
              {docs.length === 0 && (
                <button type="button" className="hk-tray-link" onClick={() => fileInputRef.current?.click()}>
                  上传讲义文件
                </button>
              )}
            </div>
          </div>

          {crafting && (
            <div className="stream-trace" style={{ maxWidth: 650, width: '100%', marginTop: 14 }}>
              <strong>正在生成专属课程：</strong> {craftStage}
            </div>
          )}

          <div style={{ marginTop: 14, position: 'relative' }} data-hk-popover-root="true">
            <button
              type="button"
              style={{ border: 'none', background: 'transparent', fontSize: 12.5, color: '#6b7280', cursor: 'pointer' }}
              onClick={() => {
                setCraftTipsOpen((v) => !v);
                setCraftPlusMenu(false);
                setCraftModelMenu(false);
              }}
            >
              ? 生成课程时可以输入什么主题？
            </button>
            {craftTipsOpen && (
              <div className="card-compact" style={{ marginTop: 8, maxWidth: 520, fontSize: 12.5, color: '#374151' }}>
                支持学科专题（如“极值与最值辨析”）、教材章节讲义、备课目标（如“15分钟微格试讲”），也可附加自定义补充说明。
              </div>
            )}
          </div>

          {/* Marketplace 3-card preview below the fold */}
          <div style={{ width: '100%', maxWidth: 920, marginTop: 44 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
                <HkIcon name="market" size={18} />
                <span>课程集市</span>
              </div>
              <button
                type="button"
                className="hk-tray-link"
                style={{ textDecoration: 'none', color: '#3b4f7d' }}
                onClick={() => onNavigate('marketplace')}
              >
                查看全部 ↗
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
              {marketPreview.map((item) => (
                <button
                  key={item.market_id}
                  type="button"
                  onClick={() => onOpenMarketplaceCourse(item.market_id)}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e6e8ec',
                    borderRadius: 16,
                    overflow: 'hidden',
                    textAlign: 'left',
                    padding: 0,
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-paper)',
                    transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                  }}
                >
                  <div style={{ height: 138, overflow: 'hidden', background: '#f3f4f6' }}>
                    <img src={assetUrl(item.cover_image)} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 11.5, color: '#3b4f7d', fontWeight: 600 }}>
                      {item.curator} · {item.hours}
                    </div>
                    <div className="serif-heading" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* ===========================
           MODE 2: INSTANT ASSIST
           =========================== */
        <>
          <h1 className="hk-hero-heading" style={{ marginBottom: 22 }}>
            <HkMascot state="welcome" size={50} />
            <span>{currentHeadline}</span>
          </h1>

          {errorMsg && (
            <div className="callout-danger" style={{ maxWidth: 650, width: '100%', marginBottom: 14 }}>
              {errorMsg}
            </div>
          )}

          <div className="hk-composer-card">
            <div className="hk-composer-input-row">
              <textarea
                className="hk-composer-textarea"
                rows={3}
                placeholder={currentInstantHint}
                value={instantPrompt}
                onChange={(e) => setInstantPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && !instantPrompt.trim()) {
                    e.preventDefault();
                    setInstantPrompt(currentInstantHint);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    runInstantAssist();
                  }
                }}
              />
            </div>

            <div className="hk-composer-toolbar">
              <div className="hk-composer-tools-left">
                {/* + Upload */}
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-circle-btn"
                    aria-label="添加资料"
                    onClick={() => {
                      setInstantAddOpen((v) => !v);
                      setInstantKbOpen(false);
                      setInstantToolsOpen(false);
                      setInstantSpeedOpen(false);
                    }}
                  >
                    +
                  </button>
                  {instantAddOpen && (
                    <div className="hk-popover-menu">
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantAddOpen(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        <span>添加本地文档</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* KB Quick Import */}
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-circle-btn"
                    title="引用个人知识库讲义"
                    aria-label="个人知识库"
                    onClick={() => {
                      setInstantKbOpen((v) => !v);
                      setInstantAddOpen(false);
                      setInstantToolsOpen(false);
                      setInstantSpeedOpen(false);
                    }}
                  >
                    <HkIcon name="kb" size={16} />
                  </button>
                  {instantKbOpen && (
                    <div className="hk-popover-menu" style={{ minWidth: 230 }}>
                      <div style={{ fontSize: 11.5, color: '#6b7280', padding: '4px 8px 6px' }}>引用已收录讲义</div>
                      {docs.slice(0, 4).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="hk-popover-row"
                          onClick={() => {
                            setInstantKbOpen(false);
                            setInstantPrompt((p) => (p ? `${p} 结合《${d.title}》` : `请查阅《${d.title}》并梳理重点与典型例题`));
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="hk-popover-row"
                        style={{ color: '#3b4f7d', fontWeight: 600 }}
                        onClick={() => {
                          setInstantKbOpen(false);
                          onNavigate('kb');
                        }}
                      >
                        <span>管理全部资料 ↗</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Tools Popover */}
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-chip-btn"
                    onClick={() => {
                      setInstantToolsOpen((v) => !v);
                      setInstantAddOpen(false);
                      setInstantKbOpen(false);
                      setInstantSpeedOpen(false);
                    }}
                  >
                    <span>工具 ▾</span>
                  </button>
                  {instantToolsOpen && (
                    <div className="hk-popover-menu" style={{ minWidth: 190 }}>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('whiteboard');
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <HkIcon name="whiteboard" size={16} />
                          白板课堂
                        </span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('cheatsheet');
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <HkIcon name="cheatsheet" size={16} />
                          速查表
                        </span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('calendar');
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <HkIcon name="calendar" size={16} />
                          学习规划
                        </span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('tool_exam');
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <HkIcon name="quiz" size={16} />
                          题库组卷与测评
                        </span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('tool_ppt');
                        }}
                      >
                        <span>制作演示课件</span>
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onClick={() => {
                          setInstantToolsOpen(false);
                          onNavigate('tool_lesson');
                        }}
                      >
                        <span>编写教学教案</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="hk-composer-tools-right">
                {/* Speed Selector with Dark Hover Tooltip */}
                <div style={{ position: 'relative' }} data-hk-popover-root="true">
                  <button
                    type="button"
                    className="hk-chip-btn"
                    onClick={() => {
                      setInstantSpeedOpen((v) => !v);
                      setInstantToolsOpen(false);
                      setInstantAddOpen(false);
                      setInstantKbOpen(false);
                    }}
                  >
                    <span>{instantSpeed === 'standard' ? '标准 ▾' : '快速 ▾'}</span>
                  </button>
                  {instantSpeedOpen && (
                    <div className="hk-popover-menu right" style={{ minWidth: 176 }}>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onMouseEnter={() => setHoveredSpeed('standard')}
                        onMouseLeave={() => setHoveredSpeed(null)}
                        onClick={() => {
                          setInstantSpeed('standard');
                        }}
                      >
                        <span>标准</span>
                        {instantSpeed === 'standard' && <span>✓</span>}
                      </button>
                      <button
                        type="button"
                        className="hk-popover-row"
                        onMouseEnter={() => setHoveredSpeed('fast')}
                        onMouseLeave={() => setHoveredSpeed(null)}
                        onClick={() => {
                          setInstantSpeed('fast');
                          setInstantSpeedOpen(false);
                        }}
                      >
                        <span>快速</span>
                        {instantSpeed === 'fast' && <span>✓</span>}
                      </button>
                      {instantSpeed === 'standard' && (
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 10px',
                            fontSize: 12,
                            color: '#374151',
                            borderTop: '1px solid #eef0f3',
                            marginTop: 4,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={confirmBeforeRun}
                            onChange={(e) => setConfirmBeforeRun(e.target.checked)}
                          />
                          <span>执行前先确认步骤</span>
                        </label>
                      )}
                      {hoveredSpeed && (
                        <div className="hk-dark-tooltip">
                          {hoveredSpeed === 'standard'
                            ? '经典模式，回答更全面、多步骤协同与算式验算更完整。'
                            : '轻量直接回答，适合快速定义确认或单项改写。'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={`hk-circle-btn submit ${instantPrompt.trim() ? 'ready' : ''}`}
                  disabled={!instantPrompt.trim() || runningAgent}
                  aria-label="发送需求"
                  onClick={() => runInstantAssist()}
                >
                  ↑
                </button>
              </div>
            </div>
          </div>

          {/* 5 Capability Chips */}
          <div className="hk-cap-chips-grid">
            <button
              type="button"
              className="hk-cap-chip"
              onClick={() =>
                setInstantPrompt('请用直观几何或生活类比讲解《f(x)=x³ 在 x=0 导数为零为何仍单调递增》')
              }
            >
              <HkIcon name="concept" size={16} />
              <span>概念讲解</span>
              <span className="hk-badge-upgraded">已升级</span>
            </button>

            <button
              type="button"
              className="hk-cap-chip"
              onClick={() => onOpenCustomCheatsheet(instantPrompt.trim() || '函数单调性与导数')}
            >
              <HkIcon name="cheatsheet" size={16} />
              <span>学习资料生成</span>
            </button>

            <button
              type="button"
              className="hk-cap-chip"
              onClick={() =>
                setInstantPrompt('请查阅讲义并围绕《导数单调性》生成思维导图、微格教案与 5 道巩固卷')
              }
            >
              <HkIcon name="kb" size={16} />
              <span>长讲义消化</span>
            </button>

            <button
              type="button"
              className="hk-cap-chip"
              onClick={() => onNavigate('tool_tutor')}
            >
              <HkIcon name="solve" size={16} />
              <span>问题求解</span>
            </button>

            <button
              type="button"
              className="hk-cap-chip"
              onClick={() => setVisualSandboxOpen((v) => !v)}
            >
              <HkIcon name="visual" size={16} />
              <span>图形可视化</span>
              <span className="hk-badge-new">New</span>
            </button>
          </div>

          {visualSandboxOpen && (
            <div style={{ width: '100%', maxWidth: 820, marginTop: 18 }}>
              <Suspense
                fallback={
                  <div className="paper-folio" style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                    正在载入函数可视化画板…
                  </div>
                }
              >
                <FunctionPlotCard initialExpr="x^3 - 3*x^2 + 2" />
              </Suspense>
            </div>
          )}

          {/* Worth Learning Today + Swap Batch */}
          <div className="hk-feed-box">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className={`hk-chip-btn ${feedMode === 'today' ? 'active' : ''}`}
                  style={{ height: 30, fontSize: 12.5 }}
                  onClick={() => setFeedMode('today')}
                >
                  <span>今日值得学</span>
                </button>
                <button
                  type="button"
                  className={`hk-chip-btn ${feedMode === 'weak' ? 'active' : ''}`}
                  style={{ height: 30, fontSize: 12.5 }}
                  onClick={() => setFeedMode('weak')}
                >
                  <span>待复习焦点 ({weakTopics.length})</span>
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setTopicOffset((o) => o + 5)}
              >
                ↻ 换一批
              </button>
            </div>

            {feedMode === 'today' ? (
              <div>
                {feedTopics.map((tp) => (
                  <button
                    key={tp.id}
                    type="button"
                    className="hk-feed-row"
                    onClick={() =>
                      runInstantAssist(
                        `请围绕《${tp.title.split('：')[0]}》（${tp.subject}）用直观模型讲解核心要点，并绘制思维导图。`
                      )
                    }
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ color: '#9ca3af' }}>↗</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tp.title}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{tp.subject}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                {weakTopics.length === 0 ? (
                  <div style={{ padding: '18px 8px', color: '#6b7280', fontSize: 13 }}>暂无待复习薄弱点，去测验或白板课堂练习后将自动汇总。</div>
                ) : (
                  weakTopics.map((wk) => (
                    <button
                      key={wk.id}
                      type="button"
                      className="hk-feed-row"
                      onClick={() => runInstantAssist(`针对我的薄弱点「${wk.topic_tag}」出一套 4 题靶向巩固测验并附上解析要点。`)}
                    >
                      <span>↗ {wk.topic_tag}（掌握度 {Math.round(wk.mastery_score)}%）</span>
                      <span className="badge badge-warn">点击强化</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
