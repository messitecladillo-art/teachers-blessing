import React, { useEffect, useMemo, useState } from 'react';
import { DOMAIN_QUICK_PRESETS } from '../data/disciplineTaxonomy';
import { apiJson, handleSafeDownload, postSseStream, resolveApiUrl } from '../services/api';
import { ArtifactItem, ExamQuestion, ExamRecord, ExamSubmissionResult } from '../types';
import { AgentStreamTrace } from '../components/AgentStreamTrace';
import { DisciplineCascadePicker } from '../components/DisciplineCascadePicker';
import { MathText } from '../components/MathText';
import {
  IconAlertWarn,
  IconClockTimer,
  IconDownloadBox,
  IconExamPaper,
  IconRefreshSwap,
  IconSaveDisc,
  IconShieldLock,
  IconSlideDeck,
  IconVerifyCheck,
} from '../components/EduIcons';

interface ExamBuilderWorkspaceProps {
  externalExamId?: string | null;
  externalViewMode?: 'teacher' | 'student' | 'take' | 'edit';
  onConsumeExternalExam?: () => void;
  onArtifactsChanged: () => void;
  onExportExamToPpt: (title: string, subject: string, grade: string, material: string) => void;
}

interface BankTopic {
  id: string;
  name: string;
  count: number;
}

interface BankChapter {
  id: string;
  book: string;
  name: string;
  label: string;
  count: number;
  topics: BankTopic[];
}

interface BankCatalog {
  books: Record<string, string>;
  chapters: BankChapter[];
  total_items: number;
  reasoning_items: number;
}

const EXAM_PRESETS = [
  { label: '导数单调性与极值专项测验', subject: '高中数学', grade: '高二年级', kp: '导数符号与单调区间、驻点与极值点辨析、三次函数最值' },
  { label: '三角函数与解三角形过关卷', subject: '高中数学', grade: '高一年级', kp: '正弦定理、余弦定理、诱导公式与图像平移' },
  { label: '电磁感应与法拉第定律', subject: '高中物理', grade: '高二年级', kp: '磁通量变化、楞次定律、右手定则与动生电动势' },
];

export const ExamBuilderWorkspace: React.FC<ExamBuilderWorkspaceProps> = ({
  externalExamId,
  externalViewMode,
  onConsumeExternalExam,
  onArtifactsChanged,
  onExportExamToPpt,
}) => {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [batchRecords, setBatchRecords] = useState<ExamRecord[]>([]);
  const [activeExam, setActiveExam] = useState<ExamRecord | null>(null);
  const [loadingExams, setLoadingExams] = useState(true);
  const [viewMode, setViewMode] = useState<'teacher' | 'student' | 'take' | 'edit'>('student');
  const [sourceTab, setSourceTab] = useState<'bank' | 'ai'>('bank');

  // Online taking & auto-grading state
  const [userAnswers, setUserAnswers] = useState<Record<string, unknown>>({});
  const [submittingExam, setSubmittingExam] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<ExamSubmissionResult | null>(null);
  const [takeSeconds, setTakeSeconds] = useState(0);
  const [remediating, setRemediating] = useState(false);

  // Question Bank Mode state
  const [catalog, setCatalog] = useState<BankCatalog | null>(null);
  const [selectedBook, setSelectedBook] = useState('r1');
  const [selectedUnit, setSelectedUnit] = useState('r1-2');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [bankMode, setBankMode] = useState<'strategy' | 'thinking'>('strategy');
  const [bankPref, setBankPref] = useState<'foundation' | 'balanced' | 'challenge'>('balanced');
  const [bankCount, setBankCount] = useState(8);
  const [bankDuration, setBankDuration] = useState(25);
  const [bankVersions, setBankVersions] = useState<1 | 3>(1);
  const [assembling, setAssembling] = useState(false);
  const [recommendedMinutes, setRecommendedMinutes] = useState<number | null>(null);
  const [timeMatches, setTimeMatches] = useState(true);

  // Custom Generation Mode state
  const [domainId, setDomainId] = useState('math');
  const [branch, setBranch] = useState('初等与高中数学');
  const [subject, setSubject] = useState('高中数学');
  const [gradeLevel, setGradeLevel] = useState('高二年级');
  const [knowledgePoints, setKnowledgePoints] = useState(EXAM_PRESETS[0].kp);
  const [difficultyProfile, setDifficultyProfile] = useState('均衡梯度（基础40% / 中档40% / 拔高20%）');
  const [questionCount, setQuestionCount] = useState(4);

  const [isStreaming, setIsStreaming] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [replaceTargetIdx, setReplaceTargetIdx] = useState<number | null>(null);
  const [replaceInstruction, setReplaceInstruction] = useState('更换一道考查同一知识点但设问角度不同的新题');
  const [replacingIdx, setReplacingIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const loadInitial = async () => {
    try {
      const [exRes, catRes] = await Promise.all([
        apiJson<{ exams: ExamRecord[] }>('/api/exam/list'),
        apiJson<{ ok: boolean } & BankCatalog>('/api/exam/bank/catalog').catch(() => null),
      ]);
      setExams(exRes.exams);
      if (!activeExam && exRes.exams.length > 0) {
        setActiveExam(exRes.exams[0]);
      }
      if (catRes?.chapters?.length) {
        setCatalog(catRes);
        const defCh = catRes.chapters.find((c) => c.id === 'r1-2') || catRes.chapters[0];
        setSelectedBook(defCh.book);
        setSelectedUnit(defCh.id);
        setSelectedTopics(defCh.topics.map((t) => t.id));
      }
    } finally {
      setLoadingExams(false);
    }
  };

  useEffect(() => {
    loadInitial().catch(() => {});
  }, []);

  useEffect(() => {
    if (!externalExamId) return;
    apiJson<{ exams: ExamRecord[] }>('/api/exam/list')
      .then((exRes) => {
        setExams(exRes.exams);
        const found = exRes.exams.find((e) => e.id === externalExamId);
        if (found) {
          setActiveExam(found);
          setUserAnswers({});
          setSubmissionResult(null);
          setTakeSeconds(0);
        }
        if (externalViewMode) setViewMode(externalViewMode);
      })
      .catch(() => {})
      .finally(() => onConsumeExternalExam?.());
  }, [externalExamId, externalViewMode, onConsumeExternalExam]);

  useEffect(() => {
    if (viewMode !== 'take' || submissionResult) return;
    const t = window.setInterval(() => setTakeSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [viewMode, submissionResult]);

  const handleSubmitOnlineExam = async () => {
    if (!activeExam || submittingExam) return;
    setSubmittingExam(true);
    setErrorMsg('');
    try {
      const res = await apiJson<{ ok: boolean; submission: ExamSubmissionResult }>(
        `/api/exam/${activeExam.id}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ answers: userAnswers, duration_sec: takeSeconds }),
        }
      );
      setSubmissionResult(res.submission);
      setToastMsg(
        res.submission.logged_error_count > 0
          ? `批改完成：${res.submission.score}/${res.submission.total_score} 分，已将 ${res.submission.logged_error_count} 道错题记入错题本并同步学情记忆。`
          : `批改完成：${res.submission.score}/${res.submission.total_score} 分，本次作答全部通过！`
      );
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交判分失败');
    } finally {
      setSubmittingExam(false);
    }
  };

  const handlePracticeWeakTopics = async () => {
    if (remediating) return;
    setRemediating(true);
    try {
      const res = await apiJson<{ exam_record: ExamRecord }>('/api/agent/memory/remediation-quiz', {
        method: 'POST',
        body: JSON.stringify({ topics: submissionResult?.weak_topics || [], count: 4 }),
      });
      setExams((prev) => [res.exam_record, ...prev]);
      setActiveExam(res.exam_record);
      setUserAnswers({});
      setSubmissionResult(null);
      setTakeSeconds(0);
      setViewMode('take');
      onArtifactsChanged();
    } finally {
      setRemediating(false);
    }
  };

  const bookChapters = useMemo(
    () => (catalog?.chapters || []).filter((c) => c.book === selectedBook),
    [catalog, selectedBook]
  );

  const currentChapter = useMemo(
    () => (catalog?.chapters || []).find((c) => c.id === selectedUnit) || null,
    [catalog, selectedUnit]
  );

  const handleBookChange = (bookId: string) => {
    setSelectedBook(bookId);
    const firstCh = (catalog?.chapters || []).find((c) => c.book === bookId);
    if (firstCh) {
      setSelectedUnit(firstCh.id);
      setSelectedTopics(firstCh.topics.map((t) => t.id));
    }
  };

  const handleUnitChange = (unitId: string) => {
    setSelectedUnit(unitId);
    const ch = (catalog?.chapters || []).find((c) => c.id === unitId);
    if (ch) {
      setSelectedTopics(ch.topics.map((t) => t.id));
    }
  };

  const toggleTopic = (tid: string) => {
    setSelectedTopics((prev) =>
      prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]
    );
  };

  const handleSwitchBankMode = (m: 'strategy' | 'thinking') => {
    setBankMode(m);
    if (m === 'strategy') {
      setBankCount(8);
      setBankDuration(25);
    } else {
      setBankCount(5);
      setBankDuration(45);
    }
  };

  const assembleFromBank = async (overrideDuration?: number) => {
    const dur = overrideDuration ?? bankDuration;
    if (assembling || !selectedTopics.length) return;
    setAssembling(true);
    setErrorMsg('');
    setToastMsg('');
    try {
      const res = await apiJson<{
        ok: boolean;
        records: ExamRecord[];
        recommended_minutes: number;
        time_matches: boolean;
        estimate_minutes: number;
      }>('/api/exam/bank/assemble', {
        method: 'POST',
        body: JSON.stringify({
          unit: selectedUnit,
          topics: selectedTopics,
          mode: bankMode,
          preference: bankPref,
          count: bankCount,
          duration: dur,
          versions: bankVersions,
        }),
      });
      setRecommendedMinutes(res.recommended_minutes);
      setTimeMatches(res.time_matches);
      if (res.records.length > 0) {
        setBatchRecords(res.records);
        setActiveExam(res.records[0]);
        setExams((prev) => {
          const newIds = new Set(res.records.map((r) => r.id));
          return [...res.records, ...prev.filter((x) => !newIds.has(x.id))];
        });
        setToastMsg(
          res.time_matches
            ? `已从题库组卷生成 ${res.records.length} 套试卷，并完成答案核对。`
            : `已生成 ${res.records.length} 套试卷（预计作答 ${res.estimate_minutes} 分钟，建议设为 ${res.recommended_minutes} 分钟）。`
        );
        onArtifactsChanged();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '题库组卷失败');
    } finally {
      setAssembling(false);
    }
  };

  const handleGenerate = async () => {
    if (!knowledgePoints.trim() || isStreaming) return;
    setIsStreaming(true);
    setStageMsg('正在生成试题与解析…');
    setThinkingText('');
    setErrorMsg('');
    setToastMsg('');
    setBatchRecords([]);

    try {
      await postSseStream<{ exam_record: ExamRecord; student_artifact: ArtifactItem; teacher_artifact: ArtifactItem }>(
        '/api/exam/generate',
        {
          subject,
          grade_level: gradeLevel,
          domain: domainId,
          branch,
          knowledge_points: knowledgePoints,
          difficulty_profile: difficultyProfile,
          question_count: questionCount,
        },
        {
          onStage: (_, msg) => setStageMsg(msg),
          onThinking: (d) => setThinkingText((p) => p + d),
          onResult: (data) => {
            setActiveExam(data.exam_record);
            setExams((prev) => [data.exam_record, ...prev]);
            setToastMsg('试卷生成完毕，已核对答案并生成可下载文件。');
            onArtifactsChanged();
          },
          onError: (msg) => setErrorMsg(msg),
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '组卷失败');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSaveExam = async () => {
    if (!activeExam) return;
    setSaving(true);
    try {
      const res = await apiJson<{ exam: ExamRecord['exam']; edit_count: number }>(
        `/api/exam/${activeExam.id}`,
        { method: 'PUT', body: JSON.stringify({ exam: activeExam.exam }) }
      );
      const updated = { ...activeExam, exam: res.exam, edit_count: res.edit_count };
      setActiveExam(updated);
      setExams((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setBatchRecords((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setToastMsg('修改已保存，学生卷与教师卷同步更新。');
      onArtifactsChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceQuestion = async (qIdx: number) => {
    if (!activeExam || !replaceInstruction.trim()) return;
    setReplacingIdx(qIdx);
    try {
      const res = await apiJson<{ exam: ExamRecord['exam']; edit_count: number }>(
        `/api/exam/${activeExam.id}/replace-question`,
        {
          method: 'POST',
          body: JSON.stringify({ question_index: qIdx, instruction: replaceInstruction }),
        }
      );
      const updated = { ...activeExam, exam: res.exam, edit_count: res.edit_count };
      setActiveExam(updated);
      setExams((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setReplaceTargetIdx(null);
      setToastMsg(`第 ${qIdx + 1} 题已替换并完成核对。`);
      onArtifactsChanged();
    } finally {
      setReplacingIdx(null);
    }
  };

  const updateQuestionField = (idx: number, field: keyof ExamQuestion, value: string) => {
    if (!activeExam) return;
    const questions = [...activeExam.exam.questions];
    questions[idx] = { ...questions[idx], [field]: value };
    setActiveExam({ ...activeExam, exam: { ...activeExam.exam, questions } });
  };

  return (
    <div className="desk-split">
      {/* Left Intent Column */}
      <div className="pane-intent">
        <div className="pane-intent-scroll">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 className="serif-heading" style={{ margin: 0, fontSize: 16.5 }}>组卷设置</h2>
            </div>
            <div className="seg-switch" style={{ width: '100%' }}>
              <button
                type="button"
                className={`seg-switch-btn ${sourceTab === 'bank' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSourceTab('bank')}
                data-testid="exam-source-bank"
              >
                题库选题组卷
              </button>
              <button
                type="button"
                className={`seg-switch-btn ${sourceTab === 'ai' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSourceTab('ai')}
                data-testid="exam-source-ai"
              >
                自定义出题
              </button>
            </div>
          </div>

          {sourceTab === 'bank' ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }} data-testid="bank-inventory-summary">
                {catalog
                  ? `人教 A 版 · ${catalog.chapters.length} 个单元 · ${catalog.total_items.toLocaleString('zh-CN')} 道题（含 ${catalog.reasoning_items.toLocaleString('zh-CN')} 道递进题）`
                  : '正在读取高中数学题库…'}
              </div>

              <div className="pane-section-div" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 8 }}>
                <div>
                  <label className="field-label">教材</label>
                  <select
                    className="select"
                    value={selectedBook}
                    onChange={(e) => handleBookChange(e.target.value)}
                    data-testid="bank-book-select"
                  >
                    {Object.entries(catalog?.books || {}).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">单元</label>
                  <select
                    className="select"
                    value={selectedUnit}
                    onChange={(e) => handleUnitChange(e.target.value)}
                    data-testid="bank-unit-select"
                  >
                    {bookChapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name} ({ch.count}题)</option>
                    ))}
                  </select>
                </div>
              </div>

              {currentChapter && (
                <div>
                  <label className="field-label">知识点</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {currentChapter.topics.map((tp) => {
                      const checked = selectedTopics.includes(tp.id);
                      return (
                        <label
                          key={tp.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '6px 9px',
                            borderRadius: 6,
                            border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-hairline)'}`,
                            background: checked ? 'var(--accent-soft)' : '#FFFFFF',
                            fontSize: 12.5,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTopic(tp.id)}
                            />
                            {tp.name}
                          </span>
                          <span className="mono-num" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{tp.count}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="field-label">测验模式</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${bankMode === 'strategy' ? 'btn-primary' : 'btn-surface'}`}
                    style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '7px 9px', height: 'auto', textAlign: 'left' }}
                    onClick={() => handleSwitchBankMode('strategy')}
                    data-testid="bank-mode-strategy"
                  >
                    <strong>限时策略卷</strong>
                    <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 400 }}>侧重解题速度与时间分配</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${bankMode === 'thinking' ? 'btn-primary' : 'btn-surface'}`}
                    style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '7px 9px', height: 'auto', textAlign: 'left' }}
                    onClick={() => handleSwitchBankMode('thinking')}
                    data-testid="bank-mode-thinking"
                  >
                    <strong>充分思考卷</strong>
                    <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 400 }}>含多问递进解答与推理检查</span>
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="field-label">时间（分钟）</label>
                  <input
                    type="number"
                    className="input mono-num"
                    min={5}
                    max={180}
                    value={bankDuration}
                    onChange={(e) => setBankDuration(Math.max(5, Math.min(180, Number(e.target.value) || 25)))}
                  />
                </div>
                <div>
                  <label className="field-label">每套题量</label>
                  <input
                    type="number"
                    className="input mono-num"
                    min={4}
                    max={12}
                    value={bankCount}
                    onChange={(e) => setBankCount(Math.max(4, Math.min(12, Number(e.target.value) || 6)))}
                  />
                </div>
                <div>
                  <label className="field-label">难度侧重</label>
                  <select className="select" value={bankPref} onChange={(e) => setBankPref(e.target.value as 'foundation' | 'balanced' | 'challenge')}>
                    <option value="foundation">基础优先</option>
                    <option value="balanced">均衡</option>
                    <option value="challenge">提高优先</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">试卷套数</label>
                  <select
                    className="select"
                    value={bankVersions}
                    onChange={(e) => setBankVersions(Number(e.target.value) === 3 ? 3 : 1)}
                    data-testid="bank-versions-select"
                  >
                    <option value={1}>1 套</option>
                    <option value={3}>3 套（题目不重复）</option>
                  </select>
                </div>
              </div>

              {recommendedMinutes !== null && !timeMatches && (
                <button
                  type="button"
                  className="btn btn-surface btn-sm"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setBankDuration(recommendedMinutes);
                    assembleFromBank(recommendedMinutes);
                  }}
                >
                  按建议设为 {recommendedMinutes} 分钟并重排
                </button>
              )}
            </>
          ) : (
            <>
              <div className="preset-strip">
                {EXAM_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="preset-chip"
                    onClick={() => {
                      setSubject(p.subject);
                      setGradeLevel(p.grade);
                      setKnowledgePoints(p.kp);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="pane-section-div">
                <DisciplineCascadePicker
                  domainId={domainId}
                  branch={branch}
                  subject={subject}
                  gradeLevel={gradeLevel}
                  onChange={(next) => {
                    setDomainId(next.domainId);
                    setBranch(next.branch);
                    setSubject(next.subject);
                    setGradeLevel(next.gradeLevel);
                    const pr = DOMAIN_QUICK_PRESETS.find((x) => x.domainId === next.domainId);
                    if (pr) setKnowledgePoints(pr.topicTitle);
                  }}
                />
              </div>

              <div>
                <label className="field-label">考查知识点</label>
                <textarea
                  className="textarea"
                  rows={3}
                  value={knowledgePoints}
                  onChange={(e) => setKnowledgePoints(e.target.value)}
                  data-testid="exam-kp-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                <div>
                  <label className="field-label">难度配比</label>
                  <select className="select" value={difficultyProfile} onChange={(e) => setDifficultyProfile(e.target.value)}>
                    <option value="均衡梯度（基础40% / 中档40% / 拔高20%）">均衡梯度（4:4:2）</option>
                    <option value="基础达标（基础70% / 中档30%）">基础过关（7:3）</option>
                    <option value="培优选拔（中档40% / 拔高60%）">竞赛提高（4:6）</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">题量</label>
                  <select className="select" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                    <option value={3}>3 题</option>
                    <option value={4}>4 题</option>
                    <option value={6}>6 题</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="pane-section-div">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: 'var(--ink-muted)' }}>
              已生成试卷 ({exams.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 165, overflowY: 'auto' }}>
              {exams.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  className={`spine-item ${activeExam?.id === ex.id ? 'active' : ''}`}
                  style={{ padding: '7px 10px' }}
                  onClick={() => {
                    setActiveExam(ex);
                    setToastMsg('');
                    setUserAnswers({});
                    setSubmissionResult(null);
                    setTakeSeconds(0);
                  }}
                >
                  <span className="spine-item-text" style={{ fontSize: 12.5 }}>{ex.title}</span>
                  <span className="spine-count">{ex.exam.questions.length} 题</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pane-sticky-cta">
          {sourceTab === 'bank' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '9px 14px' }}
              onClick={() => assembleFromBank()}
              disabled={assembling || !selectedTopics.length}
              data-testid="btn-assemble-bank"
            >
              <IconExamPaper size={15} />
              {assembling ? '组卷中…' : '从题库组卷'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '9px 14px' }}
              onClick={handleGenerate}
              disabled={isStreaming || !knowledgePoints.trim()}
              data-testid="btn-generate-exam"
            >
              <IconExamPaper size={15} />
              {isStreaming ? '生成中…' : '生成试卷'}
            </button>
          )}
        </div>
      </div>

      {/* Right Stage: Exam Paper Preview */}
      <div className="pane-stage">
        <div className="stage-inner" style={{ maxWidth: 920 }}>
          <AgentStreamTrace isStreaming={isStreaming} stageMessage={stageMsg} thinkingText={thinkingText} errorMessage={errorMsg} />

          {!activeExam && loadingExams && (
            <article className="paper-folio-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 380 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>正在加载试卷记录…</div>
              <div style={{ height: 28, width: '64%', margin: '0 auto', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ height: 56, width: '82%', margin: '0 auto', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ height: 140, width: '100%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
            </article>
          )}

          {activeExam && (
            <>
              <div className="folio-strip" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="seg-switch">
                    <button
                      type="button"
                      className={`seg-switch-btn ${viewMode === 'student' ? 'active' : ''}`}
                      onClick={() => setViewMode('student')}
                      data-testid="exam-view-student"
                    >
                      学生卷
                    </button>
                    <button
                      type="button"
                      className={`seg-switch-btn ${viewMode === 'take' ? 'active' : ''}`}
                      onClick={() => setViewMode('take')}
                      data-testid="exam-view-take"
                    >
                      在线作答
                    </button>
                    <button
                      type="button"
                      className={`seg-switch-btn ${viewMode === 'teacher' ? 'active' : ''}`}
                      onClick={() => setViewMode('teacher')}
                      data-testid="exam-view-teacher"
                    >
                      教师卷
                    </button>
                    <button
                      type="button"
                      className={`seg-switch-btn ${viewMode === 'edit' ? 'active' : ''}`}
                      onClick={() => setViewMode('edit')}
                      data-testid="exam-view-edit"
                    >
                      编辑
                    </button>
                  </div>

                  {batchRecords.length > 1 && (
                    <div className="seg-switch" data-testid="exam-batch-switcher">
                      {batchRecords.map((rec, bi) => (
                        <button
                          key={rec.id}
                          type="button"
                          className={`seg-switch-btn ${activeExam.id === rec.id ? 'active' : ''}`}
                          onClick={() => setActiveExam(rec)}
                          data-testid={`exam-batch-${bi}`}
                        >
                          {'ABC'[bi]}卷
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-surface btn-sm" onClick={handleSaveExam} disabled={saving}>
                    <IconSaveDisc size={13} /> {saving ? '保存中…' : '保存修改'}
                  </button>
                  <a
                    href={resolveApiUrl(`/api/artifacts/${activeExam.student_artifact_id}/download`)}
                    download
                    onClick={(e) => handleSafeDownload(e, `/api/artifacts/${activeExam.student_artifact_id}/download`, `${activeExam.exam.title || '测验试卷'}_学生卷.docx`)}
                    className={`btn btn-sm ${viewMode === 'student' ? 'btn-primary' : 'btn-surface'}`}
                    style={{ textDecoration: 'none' }}
                    data-testid="btn-download-student-exam"
                  >
                    <IconDownloadBox size={13} /> 下载学生卷
                  </a>
                  <a
                    href={resolveApiUrl(`/api/artifacts/${activeExam.teacher_artifact_id}/download`)}
                    download
                    onClick={(e) => handleSafeDownload(e, `/api/artifacts/${activeExam.teacher_artifact_id}/download`, `${activeExam.exam.title || '测验试卷'}_解析卷.docx`)}
                    className={`btn btn-sm ${viewMode === 'student' ? 'btn-surface' : 'btn-primary'}`}
                    style={{ textDecoration: 'none' }}
                    data-testid="btn-download-teacher-exam"
                  >
                    <IconDownloadBox size={13} /> 下载解析卷
                  </a>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => window.print()}>
                    打印试卷
                  </button>
                  <button
                    type="button"
                    className="btn btn-surface btn-sm"
                    onClick={() =>
                      onExportExamToPpt(
                        `${activeExam.exam.title}·讲评课件`,
                        activeExam.subject,
                        activeExam.grade_level,
                        JSON.stringify(activeExam.exam.questions, null, 2)
                      )
                    }
                  >
                    <IconSlideDeck size={13} color="var(--accent)" /> 转讲评课件
                  </button>
                </div>
              </div>

              {toastMsg && (
                <div className="callout-verified" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconVerifyCheck size={15} color="var(--success)" /> {toastMsg}
                </div>
              )}

              {viewMode === 'student' && (
                <article className="paper-folio-sheet" data-testid="exam-student-sheet">
                  <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 10, letterSpacing: '0.08em' }}>
                    — — — — 独立作答完成后再对照教师卷核对答案 — — — —
                  </div>
                  <div style={{ textAlign: 'center', borderBottom: '2px solid var(--ink-primary)', paddingBottom: 14, marginBottom: 18 }}>
                    <h1 className="serif-heading" style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 600 }}>
                      {activeExam.exam.title}（学生卷）
                    </h1>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', marginBottom: 10 }}>
                      {activeExam.subject} · {activeExam.grade_level} · 满分 {activeExam.exam.total_score} 分 · 建议用时 {activeExam.exam.duration_minutes} 分钟
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>
                      班级：_____________ &nbsp;&nbsp; 姓名：_____________ &nbsp;&nbsp; 学号：_____________
                    </div>

                    <table className="data-table" style={{ maxWidth: 680, margin: '0 auto', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>题号</th>
                          {activeExam.exam.questions.map((qq, qi) => (
                            <th key={qi} className="mono-num">第{qi + 1}题 ({qq.score}分)</th>
                          ))}
                          <th className="mono-num">总分 ({activeExam.exam.total_score} 分)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ fontWeight: 700 }}>得分</td>
                          {activeExam.exam.questions.map((_, qi) => (
                            <td key={qi} style={{ height: 28 }}></td>
                          ))}
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {activeExam.exam.questions.map((q, idx) => (
                      <div key={q.id || idx} style={{ paddingBottom: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                          <span className="mono-num" style={{ color: 'var(--accent)', marginRight: 6 }}>
                            {idx + 1}. [{q.type} · {q.score}分]
                          </span>
                          <MathText text={q.stem} />
                        </div>
                        {q.options && q.options.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: '6px 14px', paddingLeft: 18, fontSize: 13.5 }}>
                            {q.options.map((o, oi) => (
                              <MathText key={oi} text={o} />
                            ))}
                          </div>
                        ) : q.parts && q.parts.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 18 }}>
                            {q.parts.map((pt, pi) => (
                              <div key={pi}>
                                <div style={{ fontSize: 13.5 }}>
                                  （{pi + 1}）<MathText text={pt.prompt} /> （{pt.points}分）
                                </div>
                                <div style={{ marginTop: 6, height: 52, borderBottom: '1px dashed var(--border-strong)', borderLeft: '2px solid var(--border-hairline)' }} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 10, height: 76, borderBottom: '1px dashed var(--border-strong)', borderLeft: '2px solid var(--border-hairline)', marginLeft: 16 }} />
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              )}

              {viewMode === 'take' && (
                <article className="paper-folio-sheet" data-testid="exam-take-sheet">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingBottom: 12, borderBottom: '2px solid var(--ink-primary)', marginBottom: 16 }}>
                    <div>
                      <h2 className="serif-heading" style={{ margin: 0, fontSize: 20 }}>
                        {activeExam.exam.title}（在线作答）
                      </h2>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 3 }}>
                        提交后自动判分，未通过题目将自动收录进错题本并生成针对性巩固建议
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="stamp-badge stamp-neutral mono-num">
                        <IconClockTimer size={13} /> {Math.floor(takeSeconds / 60)}:{String(takeSeconds % 60).padStart(2, '0')}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSubmitOnlineExam}
                        disabled={submittingExam}
                        data-testid="btn-submit-exam"
                      >
                        {submittingExam ? '批改中…' : '提交并批改'}
                      </button>
                    </div>
                  </div>

                  {submissionResult && (
                    <div className="callout-verified" style={{ marginBottom: 18, padding: '12px 14px' }} data-testid="exam-grade-summary">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <strong style={{ fontSize: 15 }}>
                            本次得分：{submissionResult.score} / {submissionResult.total_score} 分
                          </strong>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', marginTop: 3 }}>
                            {submissionResult.logged_error_count > 0
                              ? `已自动收入 ${submissionResult.logged_error_count} 道错题到错题本，并记录薄弱点（${submissionResult.weak_topics.join('、')}）与在线测验学情报告。`
                              : '所有题目均已核对通过，已同步提升对应知识点掌握度。'}
                          </div>
                        </div>
                        {submissionResult.weak_topics.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={handlePracticeWeakTopics}
                            disabled={remediating}
                            data-testid="btn-exam-remediate"
                          >
                            {remediating ? '组卷中…' : '针对薄弱点再练一组'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {activeExam.exam.questions.map((q, idx) => {
                      const qid = q.id || `q${idx + 1}`;
                      const curVal = userAnswers[qid];
                      const itemGrade = submissionResult?.item_results.find((it) => it.question_id === qid);

                      return (
                        <div key={qid} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border-hairline)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span className="mono-num" style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13.5 }}>
                              第 {idx + 1} 题 · {q.type} ({q.score} 分)
                            </span>
                            {itemGrade && (
                              <span className={`stamp-badge ${itemGrade.correct ? 'stamp-verified' : 'stamp-danger'} mono-num`}>
                                {itemGrade.earned} / {itemGrade.max_score} 分
                              </span>
                            )}
                          </div>
                          <MathText text={q.stem} />

                          {q.options && q.options.length > 0 ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 10 }}>
                              {q.options.map((opt, oi) => {
                                const picked = String(curVal || '') === opt;
                                return (
                                  <button
                                    key={oi}
                                    type="button"
                                    className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-surface'}`}
                                    style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}
                                    onClick={() => setUserAnswers((prev) => ({ ...prev, [qid]: opt }))}
                                    data-testid={`take-q${idx}-opt-${oi}`}
                                  >
                                    <MathText text={opt} />
                                  </button>
                                );
                              })}
                            </div>
                          ) : q.parts && q.parts.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                              {q.parts.map((pt, pi) => {
                                const partMap = (typeof curVal === 'object' && curVal !== null ? curVal : {}) as Record<string, string>;
                                return (
                                  <div key={pi}>
                                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                                      （{pi + 1}）<MathText text={pt.prompt} />
                                    </div>
                                    <input
                                      className="input"
                                      placeholder={`输入第（${pi + 1}）问答案或关键结论…`}
                                      value={partMap[String(pi)] || ''}
                                      onChange={(e) =>
                                        setUserAnswers((prev) => ({
                                          ...prev,
                                          [qid]: { ...(partMap || {}), [String(pi)]: e.target.value },
                                        }))
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <textarea
                              className="textarea"
                              rows={2}
                              style={{ marginTop: 10 }}
                              placeholder="在此输入你的答案或关键解答结论…"
                              value={String(curVal || '')}
                              onChange={(e) => setUserAnswers((prev) => ({ ...prev, [qid]: e.target.value }))}
                              data-testid={`take-q${idx}-input`}
                            />
                          )}

                          {itemGrade && (
                            <div
                              className={itemGrade.correct ? 'callout-verified' : 'callout-danger'}
                              style={{ marginTop: 10, fontSize: 12.5 }}
                            >
                              <div><strong>判分说明：</strong>{itemGrade.feedback}</div>
                              {!itemGrade.correct && (
                                <div style={{ marginTop: 3 }}><strong>参考解析：</strong><MathText text={q.analysis || q.answer} /></div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              )}

              {viewMode === 'teacher' && (
                <article className="paper-folio-sheet" data-testid="exam-teacher-sheet">
                  <div style={{ paddingBottom: 14, borderBottom: '2px solid var(--ink-primary)', marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <h1 className="serif-heading" style={{ margin: 0, fontSize: 20 }}>
                        {activeExam.exam.title}（教师解析卷）
                      </h1>
                      <span className="stamp-badge stamp-accent mono-num">
                        {activeExam.exam.total_score} 分 · {activeExam.exam.duration_minutes} 分钟
                      </span>
                    </div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14, marginBottom: 8, color: 'var(--accent)' }}>
                      <IconExamPaper size={15} color="var(--accent)" /> 一、试题结构与答案核对表
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>题号</th>
                            <th>题型</th>
                            <th>知识点</th>
                            <th>难度 / 分值</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeExam.exam.questions.map((q, idx) => (
                            <tr key={q.id || idx}>
                              <td className="mono-num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>第 {idx + 1} 题</td>
                              <td>{q.type}</td>
                              <td>{q.knowledge_point}</td>
                              <td className="mono-num">{q.difficulty} · {q.score}分</td>
                              <td>
                                {q.verification?.status === 'verified' ? (
                                  <span className="stamp-badge stamp-verified"><IconShieldLock size={12} /> {q.verification.badge}</span>
                                ) : (
                                  <span className="stamp-badge stamp-warn"><IconAlertWarn size={12} /> {q.verification?.badge || '建议复核'}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {activeExam.exam.questions.map((q, idx) => (
                      <div key={q.id || idx} style={{ paddingBottom: 14, borderBottom: '1px solid var(--border-hairline)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className="stamp-badge stamp-accent mono-num">第 {idx + 1} 题 · {q.type} · {q.score}分</span>
                            <span className="stamp-badge stamp-neutral">{q.knowledge_point}</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-surface btn-sm"
                            onClick={() => setReplaceTargetIdx(replaceTargetIdx === idx ? null : idx)}
                          >
                            <IconRefreshSwap size={13} /> 换一题
                          </button>
                        </div>

                        {replaceTargetIdx === idx && (
                          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                            <input
                              className="input"
                              value={replaceInstruction}
                              onChange={(e) => setReplaceInstruction(e.target.value)}
                              placeholder="输入换题方向…"
                            />
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={replacingIdx === idx}
                              onClick={() => handleReplaceQuestion(idx)}
                            >
                              {replacingIdx === idx ? '更换中…' : '确认换题'}
                            </button>
                          </div>
                        )}

                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                          <MathText text={q.stem} />
                        </div>
                        {q.options && q.options.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 8 }}>
                            {q.options.map((o, oi) => (
                              <MathText key={oi} text={o} />
                            ))}
                          </div>
                        )}

                        {q.parts && q.parts.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                            {q.parts.map((pt, pi) => (
                              <div key={pi} style={{ padding: '7px 10px', background: '#FAF8F4', borderLeft: '2px solid var(--accent)', fontSize: 13 }}>
                                <div style={{ fontWeight: 600, marginBottom: 3 }}>
                                  （{pi + 1}）<MathText text={pt.prompt} /> （{pt.points}分）
                                </div>
                                <div style={{ color: 'var(--success)' }}>
                                  <strong>答案：</strong><MathText text={pt.answer} />
                                </div>
                                <div style={{ color: 'var(--ink-secondary)', marginTop: 2 }}>
                                  <strong>解析：</strong><MathText text={pt.explanation} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <div className="callout-verified" style={{ fontSize: 13, marginBottom: 8 }}>
                              <strong>【参考答案】</strong>
                              <MathText text={q.answer} />
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.65 }}>
                              <strong>【解析】</strong>
                              <MathText text={q.analysis} />
                            </div>
                          </>
                        )}

                        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                          说明：<MathText text={q.intent} />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              {viewMode === 'edit' && (
                <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="exam-edit-panel">
                  {activeExam.exam.questions.map((q, idx) => (
                    <div key={q.id || idx} style={{ paddingBottom: 14, borderBottom: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stamp-badge stamp-accent mono-num">第 {idx + 1} 题 · {q.type}</span>
                        <span className="stamp-badge stamp-neutral">{q.knowledge_point}</span>
                      </div>
                      <div>
                        <label className="field-label">题干</label>
                        <textarea className="textarea" rows={2} value={q.stem} onChange={(e) => updateQuestionField(idx, 'stem', e.target.value)} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 10 }}>
                        <div>
                          <label className="field-label">参考答案</label>
                          <textarea className="textarea" rows={3} style={{ fontSize: 12.5 }} value={q.answer} onChange={(e) => updateQuestionField(idx, 'answer', e.target.value)} />
                        </div>
                        <div>
                          <label className="field-label">分步解析</label>
                          <textarea className="textarea" rows={3} style={{ fontSize: 12.5 }} value={q.analysis} onChange={(e) => updateQuestionField(idx, 'analysis', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
