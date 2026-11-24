import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { DISCIPLINE_TAXONOMY, DOMAIN_QUICK_PRESETS } from '../data/disciplineTaxonomy';
import { apiJson, handleSafeDownload, postSseStream, resolveApiUrl } from '../services/api';
import {
  DisciplineDomain,
  ErrorBookEntry,
  FunctionPlotData,
  MindMapRecord,
  PedagogyTopic,
  SandboxPresetConfig,
  StudyPlanRecord,
  TeachingTransferPayload,
  TutorFollowupMsg,
  TutorSolution,
  TutorSubTab,
  VerificationReport,
} from '../types';
import { AgentStreamTrace } from '../components/AgentStreamTrace';
import { MathText } from '../components/MathText';
import { TrustBadgeBar } from '../components/TrustBadgeBar';
import { DisciplineCascadePicker } from '../components/DisciplineCascadePicker';
import { InterdisciplinaryMatrixSection } from '../components/InterdisciplinaryMatrixSection';
import {
  IconUnlockStep,
  IconVerifyCheck,
  IconCrossCircle,
  IconBookmarkPlus,
  IconTrashClean,
  IconCalendarPlan,
  IconDownloadBox,
  IconBridgeFlow,
  IconSympySigma,
  IconCompassBook,
  IconStarBadge,
  IconFunctionCurve,
} from '../components/EduIcons';

const FunctionPlotCard = lazy(() =>
  import('../components/FunctionPlotCard').then((m) => ({ default: m.FunctionPlotCard }))
);
const MindMapDrawioWorkbench = lazy(() =>
  import('../components/MindMapDrawioWorkbench').then((m) => ({ default: m.MindMapDrawioWorkbench }))
);

interface TutorWorkspaceProps {
  activeSubTab: TutorSubTab;
  onChangeSubTab: (tab: TutorSubTab) => void;
  onArtifactsChanged: () => void;
  onErrorBookCountChange?: (count: number) => void;
  onSolutionReady: (solution: TutorSolution | null, question: string, subject: string, grade: string) => void;
  onTransferToTeach: (payload: TeachingTransferPayload) => void;
  externalPrompt?: { subject: string; grade: string; question: string } | null;
  onConsumeExternalPrompt?: () => void;
  externalMindmap?: MindMapRecord | null;
  onConsumeExternalMindmap?: () => void;
  onOpenPedagogyVault?: () => void;
}

export const TutorWorkspace: React.FC<TutorWorkspaceProps> = ({
  activeSubTab,
  onChangeSubTab,
  onArtifactsChanged,
  onErrorBookCountChange,
  onSolutionReady,
  onTransferToTeach,
  externalPrompt,
  onConsumeExternalPrompt,
  externalMindmap,
  onConsumeExternalMindmap,
  onOpenPedagogyVault,
}) => {
  const [domainId, setDomainId] = useState('math');
  const [branch, setBranch] = useState('初等与高中数学');
  const [subject, setSubject] = useState('高中数学');
  const [gradeLevel, setGradeLevel] = useState('高二年级');
  const [mode, setMode] = useState<'progressive' | 'walkthrough'>('progressive');
  const [question, setQuestion] = useState(DOMAIN_QUICK_PRESETS[0].question);
  const [mobilePane, setMobilePane] = useState<'input' | 'stage'>('stage');
  const [activePlotExpr, setActivePlotExpr] = useState('x^3 - 3*x^2 + 2');
  const [activePreset, setActivePreset] = useState<SandboxPresetConfig | null>(null);
  const [activePresetNonce, setActivePresetNonce] = useState(0);
  const [inlineMindmap, setInlineMindmap] = useState<MindMapRecord | null>(null);
  const [fullWorkbenchMode, setFullWorkbenchMode] = useState<'mindmap' | 'space'>('mindmap');

  const [isStreaming, setIsStreaming] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [solution, setSolution] = useState<TutorSolution | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [studentAttempt, setStudentAttempt] = useState<string>('');
  const [followups, setFollowups] = useState<TutorFollowupMsg[]>([]);
  const [followupInput, setFollowupInput] = useState<string>('');
  const [sendingFollowup, setSendingFollowup] = useState<boolean>(false);
  const followupInFlightRef = useRef<boolean>(false);
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [pedagogyRefs, setPedagogyRefs] = useState<PedagogyTopic[]>([]);
  const [plotData, setPlotData] = useState<FunctionPlotData | null>(null);
  const [domains, setDomains] = useState<DisciplineDomain[]>(DISCIPLINE_TAXONOMY);
  const [allTopics, setAllTopics] = useState<PedagogyTopic[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [unlockedHints, setUnlockedHints] = useState<number>(1);
  const [showFullSolution, setShowFullSolution] = useState(false);
  const [variantAnswers, setVariantAnswers] = useState<Record<number, string>>({});

  // Quick standalone expression verifier
  const [quickExpr, setQuickExpr] = useState('x^3 - 3*x^2 + 2');
  const [quickResult, setQuickResult] = useState<{ badge: string; detail: string } | null>(null);

  // Error book & study plans
  const [errorBook, setErrorBook] = useState<ErrorBookEntry[]>([]);
  const [errorSubjectFilter, setErrorSubjectFilter] = useState<string>('ALL');
  const [errorKeyword, setErrorKeyword] = useState<string>('');
  const [savingErrorBook, setSavingErrorBook] = useState<boolean>(false);
  const saveErrorBookLockRef = useRef<boolean>(false);
  const [updatingMasteryId, setUpdatingMasteryId] = useState<string | null>(null);
  const masteryLockRef = useRef<Set<string>>(new Set());
  const [mistakeNote, setMistakeNote] = useState('');
  const [savedToast, setSavedToast] = useState('');
  const [studyPlans, setStudyPlans] = useState<StudyPlanRecord[]>([]);
  const [planTitle, setPlanTitle] = useState('导数单调性与极值专项巩固');
  const [planGoal, setPlanGoal] = useState('7 天内彻底攻克定义域优先陷阱与含参分类讨论');
  const [creatingPlan, setCreatingPlan] = useState(false);

  const errorBookSubjects = useMemo(
    () => Array.from(new Set(errorBook.map((it) => it.subject).filter(Boolean))),
    [errorBook]
  );

  const filteredErrorBook = useMemo(() => {
    const kw = errorKeyword.trim().toLowerCase();
    return errorBook.filter((it) => {
      if (errorSubjectFilter !== 'ALL' && it.subject !== errorSubjectFilter) return false;
      if (!kw) return true;
      const hay = `${it.subject} ${it.topic_tag} ${it.question_text} ${it.my_mistake} ${it.key_takeaway}`.toLowerCase();
      return hay.includes(kw);
    });
  }, [errorBook, errorSubjectFilter, errorKeyword]);

  const clearCurrentSolutionState = () => {
    setSolution(null);
    setVerification(null);
    setFollowups([]);
    setPlotData(null);
    setPedagogyRefs([]);
    setSessionId('');
    setVariantAnswers({});
    setUnlockedHints(1);
    setShowFullSolution(false);
    setErrorMsg('');
    setThinkingText('');
    setStageMsg('');
  };

  const refreshErrorBook = async () => {
    try {
      const res = await apiJson<{ items: ErrorBookEntry[] }>('/api/tutor/error-book');
      setErrorBook(res.items);
      onErrorBookCountChange?.(res.items.length);
    } catch {
      /* ignore */
    }
  };

  const refreshPlans = async () => {
    try {
      const res = await apiJson<{ plans: StudyPlanRecord[] }>('/api/tutor/study-plans');
      setStudyPlans(res.plans);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refreshErrorBook();
    refreshPlans();
    apiJson<{ topics: PedagogyTopic[]; domains?: DisciplineDomain[] }>('/api/pedagogy/topics')
      .then((res) => {
        setAllTopics(res.topics || []);
        if (res.domains?.length) setDomains(res.domains);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSubTab === 'errorbook') {
      void refreshErrorBook();
    } else if (activeSubTab === 'plan') {
      void refreshPlans();
    }
    setErrorMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  useEffect(() => {
    if (externalMindmap) {
      setInlineMindmap(externalMindmap);
      setFullWorkbenchMode('mindmap');
      onConsumeExternalMindmap?.();
    }
  }, [externalMindmap, onConsumeExternalMindmap]);

  const visiblePresets = useMemo(() => {
    const matched = DOMAIN_QUICK_PRESETS.filter((p) => p.domainId === domainId);
    const crossPicks = DOMAIN_QUICK_PRESETS.filter((p) => p.domainId !== domainId && (p.domainId === 'interdisciplinary' || p.domainId === 'math' || p.domainId === 'humanities'));
    return [...matched, ...crossPicks].slice(0, 4);
  }, [domainId]);

  useEffect(() => {
    if (externalPrompt) {
      setSubject(externalPrompt.subject);
      setGradeLevel(externalPrompt.grade);
      setQuestion(externalPrompt.question);
      clearCurrentSolutionState();
      onSolutionReady(null, externalPrompt.question, externalPrompt.subject, externalPrompt.grade);
      onChangeSubTab('solve');
      onConsumeExternalPrompt?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPrompt, onConsumeExternalPrompt, onChangeSubTab]);

  const handleSolve = async () => {
    if (!question.trim() || isStreaming) return;
    setIsStreaming(true);
    setStageMsg('正在审题并梳理步骤…');
    setThinkingText('');
    setErrorMsg('');
    setSolution(null);
    setSessionId('');
    setFollowups([]);
    setVerification(null);
    setPedagogyRefs([]);
    setPlotData(null);
    setUnlockedHints(1);
    setShowFullSolution(mode === 'walkthrough');
    setVariantAnswers({});

    try {
      await postSseStream<{
        session_id?: string;
        solution: TutorSolution;
        verification: VerificationReport;
        pedagogy_refs?: PedagogyTopic[];
        plot_data?: FunctionPlotData | null;
      }>(
        '/api/tutor/solve',
        { subject, grade_level: gradeLevel, domain: domainId, branch, question, mode, student_attempt: studentAttempt },
        {
          onStage: (_, msg) => setStageMsg(msg),
          onThinking: (delta) => setThinkingText((prev) => prev + delta),
          onResult: (data) => {
            if (data.session_id) setSessionId(data.session_id);
            setSolution(data.solution);
            setVerification(data.verification);
            setPedagogyRefs(data.pedagogy_refs || []);
            setPlotData(data.plot_data || null);
            setShowFullSolution(mode === 'walkthrough');
            onSolutionReady(data.solution, question, subject, gradeLevel);
            onArtifactsChanged();
          },
          onError: (msg) => setErrorMsg(msg),
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSendFollowup = async (overrideText?: string) => {
    const qText = (overrideText ?? followupInput).trim();
    if (!qText || sendingFollowup || followupInFlightRef.current || !solution) return;
    followupInFlightRef.current = true;
    if (!overrideText) setFollowupInput('');
    setSendingFollowup(true);
    const optimisticUser: TutorFollowupMsg = {
      id: `local_${Date.now()}`,
      session_id: sessionId || 'local',
      role: 'user',
      content: qText,
      created_at: Date.now() / 1000,
    };
    setFollowups((prev) => [...prev, optimisticUser]);
    try {
      const res = await apiJson<{ ok: boolean; session_id: string; reply: TutorFollowupMsg }>(
        '/api/tutor/followup',
        {
          method: 'POST',
          body: JSON.stringify({
            session_id: sessionId,
            question_context: question,
            solution_summary: `${solution.final_answer}\n${(solution.steps || []).map((s) => `${s.step}. ${s.title}: ${s.derivation}`).join('\n')}`,
            followup_question: qText,
            subject,
          }),
        }
      );
      if (res.session_id) setSessionId(res.session_id);
      if (res.reply) setFollowups((prev) => [...prev, res.reply]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '追问请求失败');
    } finally {
      followupInFlightRef.current = false;
      setSendingFollowup(false);
    }
  };

  const handleQuickVerify = async () => {
    if (!quickExpr.trim()) return;
    try {
      const res = await apiJson<{ verification: { badge: string; detail: string } }>(
        '/api/tutor/verify-expression',
        { method: 'POST', body: JSON.stringify({ expression: quickExpr }) }
      );
      setQuickResult(res.verification);
    } catch {
      /* ignore */
    }
  };

  const handleSaveToErrorBook = async () => {
    if (!solution || savingErrorBook || saveErrorBookLockRef.current) return;
    saveErrorBookLockRef.current = true;
    setSavingErrorBook(true);
    setErrorMsg('');
    try {
      await apiJson('/api/tutor/error-book', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          grade_level: gradeLevel,
          topic_tag: solution.topic_tag,
          question_text: question,
          my_mistake: mistakeNote || '推导步骤容易遗漏边界/定义域检验',
          key_takeaway: solution.knowledge_graph?.core_concept || solution.final_answer,
          solution_json: solution,
        }),
      });
      setSavedToast('已加入错题本。');
      window.setTimeout(() => setSavedToast(''), 3500);
      await refreshErrorBook();
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加入错题本失败');
    } finally {
      saveErrorBookLockRef.current = false;
      setSavingErrorBook(false);
    }
  };

  const handleSetMastery = async (itemId: string, lvl: number) => {
    if (masteryLockRef.current.has(itemId)) return;
    masteryLockRef.current.add(itemId);
    setUpdatingMasteryId(itemId);
    setErrorMsg('');
    try {
      await apiJson(`/api/tutor/error-book/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ mastery_level: lvl }),
      });
      setErrorBook((prev) => prev.map((it) => (it.id === itemId ? { ...it, mastery_level: lvl } : it)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新掌握星级失败');
    } finally {
      masteryLockRef.current.delete(itemId);
      setUpdatingMasteryId((cur) => (cur === itemId ? null : cur));
    }
  };

  const handleCreatePlan = async () => {
    if (creatingPlan) return;
    setCreatingPlan(true);
    setErrorMsg('');
    try {
      const weak = errorBook.slice(0, 3).map((e) => e.topic_tag);
      const res = await apiJson<{ plan: StudyPlanRecord }>('/api/tutor/study-plans', {
        method: 'POST',
        body: JSON.stringify({
          title: planTitle,
          goal: planGoal,
          weak_topics: weak.length ? weak : [solution?.topic_tag || planTitle],
          daily_minutes: 45,
        }),
      });
      setStudyPlans((prev) => [res.plan, ...prev]);
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成复习计划失败');
    } finally {
      setCreatingPlan(false);
    }
  };

  const handlePushSandboxPreset = (preset: SandboxPresetConfig) => {
    setActivePreset(preset);
    setActivePresetNonce((n) => n + 1);
    if (preset.expr && !preset.dimension) {
      setQuickExpr(preset.expr);
      setActivePlotExpr(preset.expr);
    }
    setMobilePane('stage');
    stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBuildMindmapFromTopic = async (topic: PedagogyTopic) => {
    try {
      const res = await apiJson<{ mindmap: MindMapRecord }>('/api/mindmap/from-topic', {
        method: 'POST',
        body: JSON.stringify({ topic_id: topic.id }),
      });
      setInlineMindmap(res.mindmap);
      setActivePreset({ preset_id: 'custom', dimension: 'mindmap' });
      setActivePresetNonce((n) => n + 1);
      onArtifactsChanged();
      setMobilePane('stage');
      stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* ignore */
    }
  };

  if (activeSubTab === 'mindmap') {
    return (
      <div className="pane-stage" style={{ height: 'calc(100vh - 52px)' }} data-testid="full-mindmap-workspace">
        <div className="stage-inner" style={{ maxWidth: 1180 }}>
          <div className="folio-strip" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 className="serif-heading" style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>
                图形画板与思维导图
              </h2>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                绘制思维导图、函数图像与三维几何图形
              </div>
            </div>
            <div className="seg-switch">
              <button
                type="button"
                className={`seg-switch-btn ${fullWorkbenchMode === 'mindmap' ? 'active' : ''}`}
                onClick={() => setFullWorkbenchMode('mindmap')}
                data-testid="full-mode-mindmap"
              >
                思维导图
              </button>
              <button
                type="button"
                className={`seg-switch-btn ${fullWorkbenchMode === 'space' ? 'active' : ''}`}
                onClick={() => setFullWorkbenchMode('space')}
                data-testid="full-mode-space"
              >
                函数与三维画板
              </button>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="paper-folio" style={{ padding: 28, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                正在载入图形与思维导图画板…
              </div>
            }
          >
            {fullWorkbenchMode === 'mindmap' ? (
              <div className="paper-folio" style={{ padding: '16px 20px' }}>
                <MindMapDrawioWorkbench
                  subject={subject}
                  domainId={domainId}
                  branch={branch}
                  externalMap={inlineMindmap}
                  onArtifactsChanged={onArtifactsChanged}
                />
              </div>
            ) : (
              <FunctionPlotCard
                initialExpr={activePlotExpr}
                initialPlotData={plotData}
                activePreset={activePreset}
                activePresetNonce={activePresetNonce}
                subject={subject}
                domainId={domainId}
                branch={branch}
                externalMindmap={inlineMindmap}
                onArtifactsChanged={onArtifactsChanged}
              />
            )}
          </Suspense>
        </div>
      </div>
    );
  }

  const tutorTopTabs = (
    <div
      className="no-print"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        padding: '8px 22px',
        background: '#ffffff',
        borderBottom: '1px solid var(--border-hairline)',
      }}
    >
      <div
        className="hk-mode-switcher"
        role="tablist"
        aria-label="答疑与错题本切换"
        style={{ borderRadius: 999 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'solve'}
          className={`hk-mode-btn ${activeSubTab === 'solve' ? 'active' : ''}`}
          style={{ borderRadius: 999, padding: '5px 14px', fontSize: 12.5 }}
          onClick={() => onChangeSubTab('solve')}
          data-testid="tutor-tab-solve"
        >
          分步答疑与验算
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'errorbook'}
          className={`hk-mode-btn ${activeSubTab === 'errorbook' ? 'active' : ''}`}
          style={{ borderRadius: 999, padding: '5px 14px', fontSize: 12.5 }}
          onClick={() => onChangeSubTab('errorbook')}
          data-testid="tutor-tab-errorbook"
        >
          {`错题本 (${errorBook.length})`}
        </button>
      </div>
    </div>
  );

  if (activeSubTab === 'errorbook') {
    return (
      <>
        {tutorTopTabs}
        <div className="pane-stage" style={{ height: 'calc(100vh - 102px)' }}>
        <div className="stage-inner" style={{ maxWidth: 900 }}>
          {errorMsg && (
            <div className="callout-danger" style={{ marginBottom: 12, fontSize: 12.5 }}>
              {errorMsg}
            </div>
          )}
          <div className="paper-folio">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h2 className="serif-heading" style={{ margin: 0, fontSize: 20 }}>错题本</h2>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 3 }}>
                  点击星标记录掌握程度，支持按学科与关键词检索巩固
                </div>
              </div>
              <span className="stamp-badge stamp-accent mono-num">
                {filteredErrorBook.length === errorBook.length
                  ? `共 ${errorBook.length} 题`
                  : `筛选 ${filteredErrorBook.length} / ${errorBook.length} 题`}
              </span>
            </div>

            {errorBook.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <select
                  className="select"
                  style={{ width: 156, padding: '6px 10px', fontSize: 12.5 }}
                  value={errorSubjectFilter}
                  onChange={(e) => setErrorSubjectFilter(e.target.value)}
                  aria-label="错题学科筛选"
                  data-testid="errorbook-subject-filter"
                >
                  <option value="ALL">全部学科</option>
                  {errorBookSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 12.5 }}
                  value={errorKeyword}
                  onChange={(e) => setErrorKeyword(e.target.value)}
                  placeholder="搜索知识点、题干、错因或要点总结…"
                  data-testid="errorbook-keyword-input"
                />
                {(errorSubjectFilter !== 'ALL' || errorKeyword.trim()) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setErrorSubjectFilter('ALL');
                      setErrorKeyword('');
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {errorBook.length === 0 ? (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-muted)' }}>
                暂无错题记录，在答疑解析底部点击「收入错题本」即可沉淀。
              </div>
            ) : filteredErrorBook.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-muted)' }}>
                未找到匹配的错题记录，请调整学科或关键词筛选条件。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredErrorBook.map((item) => (
                  <div key={item.id} style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="stamp-badge stamp-accent">{item.subject}</span>
                        <span className="stamp-badge stamp-warn">{item.topic_tag}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6 }} title="三刷掌握星级">
                          {[1, 2, 3].map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: 3 }}
                              disabled={updatingMasteryId === item.id}
                              onClick={() => handleSetMastery(item.id, lvl)}
                              aria-label={`标记为 ${lvl} 星掌握`}
                            >
                              <IconStarBadge
                                size={15}
                                filled={lvl <= (item.mastery_level || 1)}
                                color={lvl <= (item.mastery_level || 1) ? '#9A5B13' : 'var(--ink-faint)'}
                              />
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn btn-surface btn-sm"
                          onClick={() => {
                            setSubject(item.subject);
                            setGradeLevel(item.grade_level);
                            setQuestion(item.question_text);
                            clearCurrentSolutionState();
                            onSolutionReady(null, item.question_text, item.subject, item.grade_level);
                            onChangeSubTab('solve');
                          }}
                        >
                          重做此题
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label="删除错题"
                          onClick={async () => {
                            try {
                              setErrorMsg('');
                              await apiJson(`/api/tutor/error-book/${item.id}`, { method: 'DELETE' });
                              await refreshErrorBook();
                            } catch (err) {
                              setErrorMsg(err instanceof Error ? err.message : '删除错题失败');
                            }
                          }}
                        >
                          <IconTrashClean size={14} color="var(--seal)" />
                        </button>
                      </div>
                    </div>
                    <MathText text={item.question_text} />
                    <div className="callout-danger" style={{ fontSize: 12.5 }}>
                      <strong>我的错因：</strong><MathText text={item.my_mistake} />
                    </div>
                    <div className="callout-verified" style={{ fontSize: 12.5 }}>
                      <strong>要点总结：</strong><MathText text={item.key_takeaway} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      </>
    );
  }

  if (activeSubTab === 'plan') {
    return (
      <div className="desk-split">
        <div className="pane-intent">
          <div className="pane-intent-scroll">
            <div>
              <h2 className="serif-heading" style={{ margin: '0 0 6px', fontSize: 17 }}>7 日复习计划</h2>
              <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', margin: 0, lineHeight: 1.6 }}>
                根据薄弱专题安排每日复习任务，支持导出日历与计划表。
              </p>
            </div>
            <div className="pane-section-div">
              <label className="field-label">计划标题</label>
              <input className="input" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
            </div>
            <div>
              <label className="field-label">7 日验收目标</label>
              <textarea className="textarea" rows={4} value={planGoal} onChange={(e) => setPlanGoal(e.target.value)} />
            </div>
          </div>
          <div className="pane-sticky-cta">
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleCreatePlan}
              disabled={creatingPlan}
              data-testid="btn-create-study-plan"
            >
              <IconCalendarPlan size={15} />
              {creatingPlan ? '生成中…' : '生成复习计划'}
            </button>
          </div>
        </div>

        <div className="pane-stage">
          <div className="stage-inner">
            {errorMsg && (
              <div className="callout-danger" style={{ marginBottom: 12, fontSize: 12.5 }}>
                {errorMsg}
              </div>
            )}
            <div className="paper-folio-sheet">
              <h2 className="serif-heading" style={{ margin: '0 0 14px', fontSize: 19 }}>可执行 7 日复习档案</h2>
              {studyPlans.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-muted)' }}>
                  在左侧填写目标后点击生成，日历事件将可直接导入系统日历。
                </div>
              ) : (
                studyPlans.map((pl) => (
                  <div key={pl.id} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-hairline)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                      <div>
                        <div className="serif-heading" style={{ fontWeight: 700, fontSize: 16.5 }}>{pl.title}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{pl.goal}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {pl.ics_artifact && (
                          <a
                            href={resolveApiUrl(pl.ics_artifact.download_url)}
                            download
                            onClick={(e) => handleSafeDownload(e, pl.ics_artifact?.download_url, pl.ics_artifact?.filename || `${pl.title}.ics`)}
                            className="btn btn-primary btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            <IconDownloadBox size={13} /> 导出日历
                          </a>
                        )}
                        {pl.docx_artifact && (
                          <a
                            href={resolveApiUrl(pl.docx_artifact.download_url)}
                            download
                            onClick={(e) => handleSafeDownload(e, pl.docx_artifact?.download_url, pl.docx_artifact?.filename || `${pl.title}.docx`)}
                            className="btn btn-surface btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            <IconDownloadBox size={13} /> 导出计划表
                          </a>
                        )}
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ whiteSpace: 'nowrap', minWidth: 74 }}>日程</th>
                            <th style={{ minWidth: 150 }}>核心聚焦</th>
                            <th>每日微任务</th>
                            <th>验收标准</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pl.days.map((d) => (
                            <tr key={d.day}>
                              <td className="mono-num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{d.day}</td>
                              <td>{d.focus}</td>
                              <td>{d.task}</td>
                              <td>{d.checkpoint}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {tutorTopTabs}
      <div className="mobile-tutor-toggle">
        <div className="seg-switch" style={{ width: '100%' }}>
          <button
            type="button"
            className={`seg-switch-btn ${mobilePane === 'stage' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setMobilePane('stage')}
          >
            函数画板与解析
          </button>
          <button
            type="button"
            className={`seg-switch-btn ${mobilePane === 'input' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setMobilePane('input')}
          >
            题干输入与验算
          </button>
        </div>
      </div>

      <div className="desk-split">
        {/* Left Intent Column: Minimalist Hairline Sections + Sticky Primary CTA */}
        <div className={`pane-intent ${mobilePane === 'input' ? '' : 'mobile-hidden-pane'}`}>
          <div className="pane-intent-scroll">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 className="serif-heading" style={{ margin: 0, fontSize: 16.5 }}>题目输入</h2>
                <span className="stamp-badge stamp-accent">分步引导</span>
              </div>
              <div className="preset-strip">
                {visiblePresets.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="preset-chip"
                    onClick={() => {
                      setDomainId(s.domainId);
                      setBranch(s.branch);
                      setSubject(s.subject);
                      setGradeLevel(s.grade);
                      setQuestion(s.question);
                      if (s.plotExpr) {
                        setQuickExpr(s.plotExpr);
                        setActivePlotExpr(s.plotExpr);
                      }
                      if (s.sandboxPreset) {
                        handlePushSandboxPreset(s.sandboxPreset);
                      }
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pane-section-div">
              <DisciplineCascadePicker
                domainId={domainId}
                branch={branch}
                subject={subject}
                gradeLevel={gradeLevel}
                domains={domains}
                onChange={(next) => {
                  setDomainId(next.domainId);
                  setBranch(next.branch);
                  setSubject(next.subject);
                  setGradeLevel(next.gradeLevel);
                  const preset = DOMAIN_QUICK_PRESETS.find((p) => p.domainId === next.domainId);
                  if (preset) {
                    setQuestion(preset.question);
                    if (preset.sandboxPreset) {
                      setActivePreset(preset.sandboxPreset);
                      setActivePresetNonce((n) => n + 1);
                    }
                  }
                }}
              />
            </div>

            <div>
              <label className="field-label">导学节奏</label>
              <div className="seg-switch" style={{ width: '100%' }}>
                <button
                  type="button"
                  className={`seg-switch-btn ${mode === 'progressive' ? 'active' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setMode('progressive')}
                >
                  三级启发提示
                </button>
                <button
                  type="button"
                  className={`seg-switch-btn ${mode === 'walkthrough' ? 'active' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setMode('walkthrough')}
                >
                  知识点串讲
                </button>
              </div>
            </div>

            <div>
              <label className="field-label">题目与边界描述</label>
              <textarea
                className="textarea"
                rows={4}
                value={question}
                onChange={(e) => {
                  const val = e.target.value;
                  setQuestion(val);
                  const m = val.match(/(?:[fgh]\(x\)|y)\s*=\s*([A-Za-z0-9\s+\-*/^().²³]+)/);
                  if (m && m[1]) {
                    const ex = m[1].trim().replace(/\$$/, '');
                    setQuickExpr(ex);
                    setActivePlotExpr(ex);
                  }
                }}
                placeholder="输入想弄懂的题目、概念或推导卡点…"
                data-testid="tutor-question-input"
              />
              {question.includes('$') && (
                <div style={{ marginTop: 6, padding: '7px 10px', borderRadius: 6, background: 'var(--bg-subtle)', border: '1px solid var(--border-hairline)', fontSize: 12.5 }}>
                  <MathText text={question} />
                </div>
              )}
            </div>

            <div>
              <label className="field-label">我的思路或卡点（可选，填写可先批改）</label>
              <textarea
                className="textarea"
                rows={2}
                value={studentAttempt}
                onChange={(e) => setStudentAttempt(e.target.value)}
                placeholder="例如：我求导后直接令 f'(x)>0 解出来，但不确定端点 x=0 怎么判断…"
                data-testid="tutor-attempt-input"
              />
            </div>

            {/* Standalone Calculator Sandbox */}
            <div className="pane-section-div">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12.5, marginBottom: 7, color: 'var(--accent)' }}>
                <IconSympySigma size={15} color="var(--accent)" />
                算式验算与作图
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input mono-num"
                  style={{ fontSize: 12 }}
                  value={quickExpr}
                  onChange={(e) => setQuickExpr(e.target.value)}
                  placeholder="如 3*x*(x-2)=0"
                />
                <button
                  type="button"
                  className="btn btn-surface btn-sm"
                  onClick={() => {
                    handleQuickVerify();
                    if (!quickExpr.includes('=')) setActivePlotExpr(quickExpr);
                  }}
                >
                  验算
                </button>
              </div>
              {quickResult && (
                <div className="callout-verified" style={{ marginTop: 8, fontSize: 12 }}>
                  <strong>{quickResult.badge}：</strong>
                  <MathText text={quickResult.detail} />
                </div>
              )}
            </div>
          </div>

          <div className="pane-sticky-cta">
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '9px 14px' }}
              onClick={() => {
                setMobilePane('stage');
                handleSolve();
              }}
              disabled={isStreaming || !question.trim()}
              data-testid="btn-tutor-solve"
            >
              <IconFunctionCurve size={15} />
              {isStreaming ? '正在解答…' : '开始解答'}
            </button>
          </div>
        </div>

        {/* Right Stage Column: Interactive Plot + Marginalia Folio Solution */}
        <div ref={stageRef} className={`pane-stage ${mobilePane === 'stage' ? '' : 'mobile-hidden-pane'}`}>
          <div className="stage-inner">
            <AgentStreamTrace
              isStreaming={isStreaming}
              stageMessage={stageMsg}
              thinkingText={thinkingText}
              errorMessage={errorMsg}
            />

            {/* 4-Dimension Experimental Workbench & Mindmap Card */}
            {(!solution || plotData?.ok) && !isStreaming && (
              <Suspense
                fallback={
                  <div className="paper-folio" style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    正在载入函数与几何画板…
                  </div>
                }
              >
                <FunctionPlotCard
                  initialExpr={activePlotExpr}
                  initialPlotData={plotData}
                  activePreset={activePreset}
                  activePresetNonce={activePresetNonce}
                  subject={subject}
                  domainId={domainId}
                  branch={branch}
                  externalMindmap={inlineMindmap}
                  onExpandMindmap={() => onChangeSubTab('mindmap')}
                  onArtifactsChanged={onArtifactsChanged}
                />
              </Suspense>
            )}

            {!solution && !isStreaming && !errorMsg && allTopics.length > 0 && (
              <InterdisciplinaryMatrixSection
                topics={allTopics}
                domains={domains}
                onLoadSandbox={handlePushSandboxPreset}
                onCreateMindmap={handleBuildMindmapFromTopic}
                onApplyToTutor={(ft) => {
                  if (ft.domain_id) setDomainId(ft.domain_id);
                  if (ft.branch) setBranch(ft.branch);
                  setSubject(ft.subject);
                  setGradeLevel(ft.grade_level);
                  setQuestion(`请结合“${ft.intuition_models[0]?.name}”直观模型，系统剖析《${ft.title}》，重点辨析：${ft.pitfalls_and_counterexamples[0]}`);
                  if (ft.sandbox_preset) handlePushSandboxPreset(ft.sandbox_preset);
                  setMobilePane('input');
                }}
                onApplyToLesson={(ft) =>
                  onTransferToTeach({
                    title: ft.title.split('：')[0],
                    subject: ft.subject,
                    grade_level: ft.grade_level,
                    domain: ft.domain_id || domainId,
                    branch: ft.branch || branch,
                    context_summary: `【专题】${ft.title}\n【分支】${ft.domain_name} · ${ft.branch}\n【直观模型】${ft.intuition_models.map((m) => `${m.name}:${m.desc}`).join('；')}\n【跨学科视角】${(ft.interdisciplinary_links || []).map((l) => `${l.domain}-${l.title}`).join('；')}\n【板书金句】${ft.board_punchline}`,
                    target_tab: 'lesson',
                  })
                }
                onOpenVault={onOpenPedagogyVault}
              />
            )}

          {solution && (
            <>
              {/* Condition Marginalia & Trust Badge */}
              <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <span className="stamp-badge stamp-accent">{solution.topic_tag}</span>
                    <h3 className="serif-heading" style={{ margin: '8px 0 0', fontSize: 18 }}>
                      一、条件识别与隐含边界检查
                    </h3>
                  </div>
                  {solution.teaching_bridge && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        onTransferToTeach({
                          title: solution.teaching_bridge?.suggested_lesson_title || solution.topic_tag,
                          subject,
                          grade_level: gradeLevel,
                          domain: domainId,
                          branch,
                          context_summary: `【原学习题目】${question}\n【核心思想】${solution.knowledge_graph?.core_concept}\n【教学重难点建议】${solution.teaching_bridge?.pedagogical_focus}\n【关键步骤】${solution.steps.map((s) => `${s.step}. ${s.title}: ${s.derivation}`).join('\n')}`,
                          target_tab: 'lesson',
                        })
                      }
                      data-testid="tutor-inline-bridge-btn"
                    >
                      <IconBridgeFlow size={14} /> 转为教案
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {(solution.known_conditions || []).map((c, idx) => (
                    <span key={idx} className="stamp-badge stamp-neutral" style={{ fontSize: 12 }}>
                      条件 {idx + 1}：<MathText inline text={c} />
                    </span>
                  ))}
                </div>

                {solution.missing_condition_check && (
                  <div className={solution.missing_condition_check.has_ambiguity ? 'callout-warn' : 'callout-pedagogy'} style={{ fontSize: 13 }}>
                    <strong>边界核查：</strong>
                    <MathText inline text={solution.missing_condition_check.prompt} />
                  </div>
                )}

                <TrustBadgeBar verification={verification || undefined} uncertaintyNote={solution.uncertainty_note} />

                {solution.draft_diagnosis?.has_attempt && (
                  <div className="callout-pedagogy" style={{ fontSize: 13 }} data-testid="tutor-draft-diagnosis">
                    <strong>思路诊断批改：</strong>
                    <MathText text={solution.draft_diagnosis.summary} />
                  </div>
                )}
              </div>

              {pedagogyRefs.length > 0 && (
                <div className="callout-pedagogy">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconCompassBook size={15} color="var(--accent)" />
                      延伸讲解参考
                    </span>
                    <a href={pedagogyRefs[0].zhihu_reference_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                      相关讨论检索 ↗
                    </a>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
                    <strong>{pedagogyRefs[0].intuition_models[0]?.name}：</strong>
                    {pedagogyRefs[0].intuition_models[0]?.desc}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 5 }}>
                    <strong>核心要点：</strong>{pedagogyRefs[0].board_punchline}
                  </div>
                </div>
              )}

              {/* Progressive Hints */}
              <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h3 className="serif-heading" style={{ margin: 0, fontSize: 17 }}>
                    二、三级渐进式启发提示
                  </h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {unlockedHints < (solution.hints || []).length && (
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        onClick={() => setUnlockedHints((h) => h + 1)}
                        data-testid="btn-unlock-next-hint"
                      >
                        <IconUnlockStep size={14} /> 解锁下一级 ({unlockedHints}/{solution.hints.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setShowFullSolution((v) => !v)}
                      data-testid="btn-toggle-full-solution"
                    >
                      {showFullSolution ? '收起完整解析' : '已思考，展开完整分步解析'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(solution.hints || []).slice(0, unlockedHints).map((h) => (
                    <div
                      key={h.level}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-hairline)',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--accent)', marginBottom: 4 }}>
                        Level {h.level} · {h.title}
                      </div>
                      <MathText text={h.content} />
                    </div>
                  ))}
                </div>
              </div>

              {showFullSolution && (
                <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <h3 className="serif-heading" style={{ margin: 0, fontSize: 17 }}>
                    三、分步严密推导与依据批注
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(solution.steps || []).map((st) => (
                      <div
                        key={st.step}
                        style={{
                          paddingBottom: 12,
                          borderBottom: '1px solid var(--border-hairline)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 5 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-primary)' }}>
                            第 {st.step} 步：<MathText inline text={st.title} />
                          </span>
                          <span className="stamp-badge stamp-accent">
                            依据：<MathText inline text={st.theorem_basis} />
                          </span>
                        </div>
                        <MathText text={st.derivation} />
                      </div>
                    ))}
                  </div>

                  <div className="callout-verified">
                    <strong style={{ color: 'var(--success)', fontSize: 13.5 }}>最终结论：</strong>
                    <MathText text={solution.final_answer} />
                  </div>

                  {solution.knowledge_graph && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 12.5 }}>
                      <div>
                        <strong>前置基础：</strong>
                        <MathText inline text={(solution.knowledge_graph.prerequisites || []).join('、')} />
                      </div>
                      <div>
                        <strong>高频陷阱：</strong>
                        <MathText inline text={(solution.knowledge_graph.common_traps || []).join('；')} />
                      </div>
                      <div>
                        <strong>高阶迁移：</strong>
                        <MathText inline text={(solution.knowledge_graph.extensions || []).join('、')} />
                      </div>
                      {(solution.knowledge_graph.interdisciplinary_bridges || []).length > 0 && (
                        <div>
                          <strong>跨学科映射：</strong>
                          <MathText inline text={(solution.knowledge_graph.interdisciplinary_bridges || []).join('；')} />
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 220 }}
                      placeholder="记录出错步骤或原因…"
                      value={mistakeNote}
                      onChange={(e) => setMistakeNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-surface"
                      disabled={savingErrorBook}
                      onClick={handleSaveToErrorBook}
                      data-testid="btn-save-errorbook"
                    >
                      <IconBookmarkPlus size={15} color="var(--accent)" /> {savingErrorBook ? '保存中…' : '收入错题本'}
                    </button>
                    {savedToast && <span style={{ fontSize: 12.5, color: 'var(--success)', fontWeight: 600 }}>{savedToast}</span>}
                  </div>
                </div>
              )}

              {(solution.variants || []).length > 0 && (
                <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h3 className="serif-heading" style={{ margin: 0, fontSize: 17 }}>
                    四、同类梯度变式题即时自测
                  </h3>
                  {solution.variants.map((v, vIdx) => {
                    const picked = variantAnswers[vIdx];
                    const isCorrect = picked && picked.trim().toUpperCase().startsWith(v.answer.trim().toUpperCase()[0] || '');
                    return (
                      <div key={vIdx} style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-hairline)', background: 'var(--bg-subtle)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span className="stamp-badge stamp-accent">{v.tier}</span>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>变式 {vIdx + 1}</span>
                        </div>
                        <MathText text={v.question} />
                        {v.options && v.options.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>
                            {v.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                className={`btn btn-sm ${picked === opt ? 'btn-primary' : 'btn-surface'}`}
                                style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}
                                onClick={() => setVariantAnswers((prev) => ({ ...prev, [vIdx]: opt }))}
                              >
                                <MathText text={opt} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-surface btn-sm"
                            style={{ marginTop: 8 }}
                            onClick={() => setVariantAnswers((prev) => ({ ...prev, [vIdx]: v.answer }))}
                          >
                            查看参考答案
                          </button>
                        )}

                        {picked && (
                          <div className={isCorrect || !v.options?.length ? 'callout-verified' : 'callout-danger'} style={{ marginTop: 10, fontSize: 12.5 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 3, flexWrap: 'wrap' }}>
                              {isCorrect || !v.options?.length ? (
                                <IconVerifyCheck size={14} color="var(--success)" />
                              ) : (
                                <IconCrossCircle size={14} color="var(--seal)" />
                              )}
                              <span>标准答案：<MathText inline text={v.answer} /></span>
                            </div>
                            <MathText text={v.explanation} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Multi-turn continuous follow-up Q&A */}
              <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="tutor-followup-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h3 className="serif-heading" style={{ margin: 0, fontSize: 16.5 }}>
                    五、针对步骤继续追问（多轮对话）
                  </h3>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['第 1 步依据再解释细一点', '换一种直观例子类比', '这道题最容易在哪里扣分'].map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="preset-chip"
                        onClick={() => handleSendFollowup(q)}
                        disabled={sendingFollowup}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {followups.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {followups.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          alignSelf: f.role === 'user' ? 'flex-end' : 'stretch',
                          maxWidth: f.role === 'user' ? '82%' : '100%',
                          padding: '9px 12px',
                          borderRadius: 8,
                          background: f.role === 'user' ? 'var(--accent)' : 'var(--bg-subtle)',
                          color: f.role === 'user' ? '#FFFFFF' : 'var(--ink-primary)',
                          fontSize: 13,
                          lineHeight: 1.65,
                        }}
                      >
                        <MathText inline={f.role === 'user'} text={f.content} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={followupInput}
                    onChange={(e) => setFollowupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendFollowup();
                      }
                    }}
                    placeholder="对某一步推导有疑问？直接输入继续追问…"
                    data-testid="tutor-followup-input"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSendFollowup()}
                    disabled={sendingFollowup || !followupInput.trim()}
                    data-testid="btn-send-followup"
                  >
                    {sendingFollowup ? '解答中…' : '继续追问'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
};
