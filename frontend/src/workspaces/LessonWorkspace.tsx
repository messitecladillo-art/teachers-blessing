import React, { useEffect, useState } from 'react';
import { DOMAIN_QUICK_PRESETS } from '../data/disciplineTaxonomy';
import { apiJson, postSseStream, uploadSourceFile } from '../services/api';
import { ArtifactItem, LessonContent, LessonRecord, TeachingTransferPayload } from '../types';
import { AgentStreamTrace } from '../components/AgentStreamTrace';
import { DisciplineCascadePicker } from '../components/DisciplineCascadePicker';
import { MathText } from '../components/MathText';
import {
  IconDownloadBox,
  IconEditPen,
  IconLessonDoc,
  IconPaperView,
  IconSaveDisc,
  IconSlideDeck,
  IconUploadCloud,
  IconVerifyCheck,
  IconWandRefine,
} from '../components/EduIcons';

interface LessonWorkspaceProps {
  transferPayload: TeachingTransferPayload | null;
  onConsumeTransfer: () => void;
  externalLessonId?: string | null;
  onConsumeExternalLesson?: () => void;
  onArtifactsChanged: () => void;
  onGeneratePptFromLesson: (title: string, subject: string, grade: string, material: string) => void;
}

const LESSON_PRESETS = [
  { label: '导数的几何意义 (15min微格)', subject: '高中数学', grade: '高二年级', topic: '导数的几何意义与切线方程', ltype: '师范生微格试讲 (15分钟)' },
  { label: '等差数列前n项和 (45min新授)', subject: '高中数学', grade: '高二年级', topic: '等差数列的前n项和公式推导与应用', ltype: '45分钟新授课' },
  { label: '牛顿第二定律探究实验', subject: '高中物理', grade: '高一年级', topic: '探究加速度与力、质量的关系', ltype: '实验探究课' },
];

export const LessonWorkspace: React.FC<LessonWorkspaceProps> = ({
  transferPayload,
  onConsumeTransfer,
  externalLessonId,
  onConsumeExternalLesson,
  onArtifactsChanged,
  onGeneratePptFromLesson,
}) => {
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [activeLesson, setActiveLesson] = useState<LessonRecord | null>(null);
  const [draft, setDraft] = useState<LessonContent | null>(null);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [viewMode, setViewMode] = useState<'paper' | 'edit'>('paper');

  const [domainId, setDomainId] = useState('math');
  const [branch, setBranch] = useState('初等与高中数学');
  const [subject, setSubject] = useState('高中数学');
  const [gradeLevel, setGradeLevel] = useState('高二年级');
  const [topic, setTopic] = useState('导数的几何意义与切线方程');
  const [lessonType, setLessonType] = useState('师范生微格试讲 (15分钟)');
  const [sourceContext, setSourceContext] = useState('');
  const [fromTutorCtx, setFromTutorCtx] = useState('');
  const [uploadedFilename, setUploadedFilename] = useState('');

  const [isStreaming, setIsStreaming] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [rewritingKey, setRewritingKey] = useState<string | null>(null);
  const [rewriteTarget, setRewriteTarget] = useState<{ key: string; instruction: string } | null>(null);
  const [latestArtifact, setLatestArtifact] = useState<ArtifactItem | null>(null);
  const [saveToast, setSaveToast] = useState('');

  const loadLessons = async () => {
    try {
      const res = await apiJson<{ lessons: LessonRecord[] }>('/api/lesson/list');
      setLessons(res.lessons);
      if (!activeLesson && res.lessons.length > 0) {
        setActiveLesson(res.lessons[0]);
        setDraft(res.lessons[0].content);
      }
    } finally {
      setLoadingLessons(false);
    }
  };

  useEffect(() => {
    loadLessons().catch(() => {});
  }, []);

  useEffect(() => {
    if (!externalLessonId) return;
    apiJson<{ lessons: LessonRecord[] }>('/api/lesson/list')
      .then((res) => {
        setLessons(res.lessons);
        const found = res.lessons.find((l) => l.id === externalLessonId);
        if (found) {
          setActiveLesson(found);
          setDraft(found.content);
          setViewMode('paper');
        }
      })
      .catch(() => {})
      .finally(() => onConsumeExternalLesson?.());
  }, [externalLessonId, onConsumeExternalLesson]);

  useEffect(() => {
    if (transferPayload && transferPayload.target_tab === 'lesson') {
      setTopic(transferPayload.title);
      setSubject(transferPayload.subject);
      setGradeLevel(transferPayload.grade_level);
      setFromTutorCtx(transferPayload.context_summary);
      onConsumeTransfer();
    }
  }, [transferPayload, onConsumeTransfer]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadSourceFile(file);
      setUploadedFilename(res.filename);
      setSourceContext(res.markdown_full);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '文档上传失败');
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || isStreaming) return;
    setIsStreaming(true);
    setStageMsg('正在生成教案…');
    setThinkingText('');
    setErrorMsg('');

    try {
      await postSseStream<{ lesson: LessonRecord; artifact: ArtifactItem }>(
        '/api/lesson/generate',
        {
          subject,
          grade_level: gradeLevel,
          domain: domainId,
          branch,
          topic,
          lesson_type: lessonType,
          source_context: sourceContext,
          from_tutor_context: fromTutorCtx,
        },
        {
          onStage: (_, msg) => setStageMsg(msg),
          onThinking: (d) => setThinkingText((p) => p + d),
          onResult: (data) => {
            setActiveLesson(data.lesson);
            setDraft(data.lesson.content);
            setLatestArtifact(data.artifact);
            setLessons((prev) => [data.lesson, ...prev]);
            setViewMode('paper');
            onArtifactsChanged();
          },
          onError: (msg) => setErrorMsg(msg),
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!activeLesson || !draft) return;
    setSaving(true);
    setSaveToast('');
    try {
      const res = await apiJson<{ edit_count: number; edited_char_delta: number; artifact: ArtifactItem }>(
        `/api/lesson/${activeLesson.id}`,
        { method: 'PUT', body: JSON.stringify({ content: draft }) }
      );
      const updatedLesson = {
        ...activeLesson,
        title: draft.title,
        content: draft,
        edit_count: res.edit_count,
        edited_char_delta: res.edited_char_delta,
      };
      setActiveLesson(updatedLesson);
      setLessons((prev) => prev.map((l) => (l.id === updatedLesson.id ? updatedLesson : l)));
      setLatestArtifact(res.artifact);
      setSaveToast(`修改已保存（累计修订 ${res.edit_count} 次，变更 ${res.edited_char_delta} 字）。`);
      onArtifactsChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleRewriteSection = async (sectionKey: string, instruction: string) => {
    if (!activeLesson || !instruction.trim()) return;
    setRewritingKey(sectionKey);
    try {
      const res = await apiJson<{ content: LessonContent; artifact: ArtifactItem; edit_count: number }>(
        `/api/lesson/${activeLesson.id}/rewrite-section`,
        { method: 'POST', body: JSON.stringify({ section_key: sectionKey, instruction }) }
      );
      setDraft(res.content);
      setLatestArtifact(res.artifact);
      const updatedLesson = { ...activeLesson, content: res.content, edit_count: res.edit_count };
      setActiveLesson(updatedLesson);
      setLessons((prev) => prev.map((l) => (l.id === updatedLesson.id ? updatedLesson : l)));
      setRewriteTarget(null);
      setSaveToast('局部内容已更新，教案文件已同步保存。');
      onArtifactsChanged();
    } finally {
      setRewritingKey(null);
    }
  };

  const exportDownloadUrl = latestArtifact?.download_url || (activeLesson?.artifact_id ? `/api/artifacts/${activeLesson.artifact_id}/download` : '');

  const rawBb = String(draft?.blackboard_design || '');
  const [bbMain, bbSub] = rawBb.includes('【副板书】')
    ? rawBb.split('【副板书】', 2).map((s) => s.replace('【主板书】', '').trim())
    : [rawBb.replace('【主板书】', '').trim(), String(draft?.difficult_points || '')];

  return (
    <div className="desk-split">
      {/* Left Intent Column */}
      <div className="pane-intent">
        <div className="pane-intent-scroll">
          <div>
            <h2 className="serif-heading" style={{ margin: '0 0 10px', fontSize: 16.5 }}>教案设计与素材源</h2>
            <div className="preset-strip">
              {LESSON_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="preset-chip"
                  onClick={() => {
                    setSubject(p.subject);
                    setGradeLevel(p.grade);
                    setTopic(p.topic);
                    setLessonType(p.ltype);
                  }}
                >
                  {p.label}
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
              onChange={(next) => {
                setDomainId(next.domainId);
                setBranch(next.branch);
                setSubject(next.subject);
                setGradeLevel(next.gradeLevel);
                const pr = DOMAIN_QUICK_PRESETS.find((x) => x.domainId === next.domainId);
                if (pr) setTopic(pr.topicTitle);
                if (next.domainId === 'interdisciplinary') {
                  setLessonType('跨学科主题学习 PBL (45分钟)');
                }
              }}
            />
          </div>

          <div>
            <label className="field-label">课题名称</label>
            <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} data-testid="lesson-topic-input" />
          </div>

          <div>
            <label className="field-label">课型设定</label>
            <select className="select" value={lessonType} onChange={(e) => setLessonType(e.target.value)}>
              <option value="师范生微格试讲 (15分钟)">师范生微格试讲 (15分钟)</option>
              <option value="跨学科主题学习 PBL (45分钟)">跨学科主题学习 PBL (45分钟)</option>
              <option value="新课标大单元教学设计">新课标大单元教学设计</option>
              <option value="45分钟新授课">45分钟新授课</option>
              <option value="专题复习与讲评课">专题复习与讲评课</option>
              <option value="实验探究课">实验探究课</option>
            </select>
          </div>

          {fromTutorCtx && (
            <div className="callout-pedagogy" style={{ fontSize: 12 }}>
              <strong>已注入「学→教」上下文：</strong>
              <div style={{ marginTop: 3, maxHeight: 60, overflow: 'hidden', color: 'var(--ink-secondary)' }}>
                {fromTutorCtx.slice(0, 120)}…
              </div>
            </div>
          )}

          <div>
            <label className="field-label">参考资料（文档 / 课件 / LaTeX / 压缩包）</label>
            <label className="btn btn-surface btn-sm" style={{ width: '100%', cursor: 'pointer' }}>
              <IconUploadCloud size={14} />
              {uploadedFilename ? `已导入：${uploadedFilename}` : '上传参考资料'}
              <input type="file" hidden accept=".pdf,.docx,.pptx,.tex,.latex,.html,.zip,.md,.txt" onChange={handleFileUpload} />
            </label>
          </div>

          <div className="pane-section-div">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: 'var(--ink-muted)' }}>
              已归档教案 ({lessons.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 190, overflowY: 'auto' }}>
              {lessons.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`spine-item ${activeLesson?.id === l.id ? 'active' : ''}`}
                  style={{ padding: '7px 10px' }}
                  onClick={() => {
                    setActiveLesson(l);
                    setDraft(l.content);
                    setLatestArtifact(null);
                    setSaveToast('');
                  }}
                >
                  <span className="spine-item-text" style={{ fontSize: 12.5 }}>{l.title}</span>
                  <span className="spine-count">{l.edit_count} 改</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pane-sticky-cta">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 14px' }}
            onClick={handleGenerate}
            disabled={isStreaming || !topic.trim()}
            data-testid="btn-generate-lesson"
          >
            <IconLessonDoc size={15} />
            {isStreaming ? '生成中…' : '生成教案'}
          </button>
        </div>
      </div>

      {/* Right Stage: Authentic A4 Paper Folio View <-> Section Edit Mode */}
      <div className="pane-stage">
        <div className="stage-inner" style={{ maxWidth: 920 }}>
          <AgentStreamTrace isStreaming={isStreaming} stageMessage={stageMsg} thinkingText={thinkingText} errorMessage={errorMsg} />

          {!draft && loadingLessons && (
            <article className="paper-folio-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 380 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>正在调取教案活页档案…</div>
              <div style={{ height: 28, width: '62%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ height: 14, width: '40%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ height: 120, width: '100%', background: 'var(--bg-subtle)', borderRadius: 4, marginTop: 8 }} />
            </article>
          )}

          {draft && activeLesson && (
            <>
              <div className="folio-strip" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div className="seg-switch">
                  <button
                    type="button"
                    className={`seg-switch-btn ${viewMode === 'paper' ? 'active' : ''}`}
                    onClick={() => setViewMode('paper')}
                    data-testid="lesson-view-paper"
                  >
                    <IconPaperView size={13} style={{ marginRight: 4 }} /> 教案预览
                  </button>
                  <button
                    type="button"
                    className={`seg-switch-btn ${viewMode === 'edit' ? 'active' : ''}`}
                    onClick={() => setViewMode('edit')}
                    data-testid="lesson-view-edit"
                  >
                    <IconEditPen size={13} style={{ marginRight: 4 }} /> 编辑内容
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="btn btn-surface btn-sm" onClick={handleSaveEdits} disabled={saving} data-testid="btn-save-lesson">
                    <IconSaveDisc size={13} /> {saving ? '保存中…' : '保存修改'}
                  </button>
                  {exportDownloadUrl && (
                    <a href={exportDownloadUrl} download className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }} data-testid="btn-download-lesson-docx">
                      <IconDownloadBox size={13} /> 导出教案
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-surface btn-sm"
                    onClick={() =>
                      onGeneratePptFromLesson(
                        draft.title,
                        draft.subject,
                        draft.grade_level,
                        JSON.stringify(draft, null, 2)
                      )
                    }
                    data-testid="btn-lesson-to-ppt"
                  >
                    <IconSlideDeck size={13} color="var(--accent)" /> 转为课件
                  </button>
                </div>
              </div>

              {saveToast && (
                <div className="callout-verified" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconVerifyCheck size={15} color="var(--success)" /> {saveToast}
                </div>
              )}

              {viewMode === 'paper' ? (
                <article className="paper-folio-sheet" data-testid="lesson-paper-sheet">
                  {/* Formal Paper Header */}
                  <div style={{ textAlign: 'center', paddingBottom: 16, borderBottom: '2px solid var(--ink-primary)', marginBottom: 20 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>
                      教学设计方案
                    </div>
                    <h1 className="serif-heading" style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 600 }}>
                      {draft.title}
                    </h1>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                      <span>学科：{draft.subject}</span>
                      <span>学段：{draft.grade_level}</span>
                      <span>课型：{draft.lesson_type}</span>
                      <span>时长：{draft.duration}</span>
                      <span className="stamp-badge stamp-neutral mono-num">修订 {activeLesson.edit_count} 次</span>
                    </div>
                  </div>

                  {/* Section 1 */}
                  <section style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 className="serif-heading" style={{ margin: 0, fontSize: 15.5, color: 'var(--accent)' }}>一、教学目标与核心素养</h3>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRewriteTarget({ key: 'objectives', instruction: '紧扣新课标核心素养表述，进一步突出学生探究主体性' })}
                      >
                        <IconWandRefine size={13} /> 重写本节
                      </button>
                    </div>
                    {rewriteTarget?.key === 'objectives' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        <input
                          className="input"
                          value={rewriteTarget.instruction}
                          onChange={(e) => setRewriteTarget({ ...rewriteTarget, instruction: e.target.value })}
                        />
                        <button type="button" className="btn btn-primary btn-sm" disabled={rewritingKey === 'objectives'} onClick={() => handleRewriteSection('objectives', rewriteTarget.instruction)}>
                          {rewritingKey === 'objectives' ? '精修中…' : '确认'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRewriteTarget(null)}>取消</button>
                      </div>
                    )}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.75, color: 'var(--ink-secondary)' }}>
                      {(draft.objectives || []).map((obj, idx) => (
                        <li key={idx}><MathText text={obj} /></li>
                      ))}
                    </ul>
                  </section>

                  {/* Section 2 */}
                  <section style={{ marginBottom: 20 }}>
                    <h3 className="serif-heading" style={{ margin: '0 0 10px', fontSize: 15.5, color: 'var(--accent)' }}>二、学情预判与教学重难点</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, fontSize: 13.5, lineHeight: 1.7 }}>
                      <div style={{ padding: '2px 0 4px 12px', borderLeft: '2px solid var(--border-strong)' }}>
                        <strong style={{ color: 'var(--ink-primary)' }}>学情前置分析：</strong>
                        <MathText text={draft.learner_analysis} />
                      </div>
                      <div style={{ padding: '2px 0 4px 12px', borderLeft: '2px solid var(--border-strong)' }}>
                        <strong style={{ color: 'var(--ink-primary)' }}>教学难点与突破：</strong>
                        <MathText text={draft.difficult_points} />
                      </div>
                    </div>
                  </section>

                  {/* Section 3: Booktabs Timeline */}
                  <section style={{ marginBottom: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 className="serif-heading" style={{ margin: 0, fontSize: 15.5, color: 'var(--accent)' }}>三、结构化教学过程</h3>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRewriteTarget({ key: 'teaching_steps', instruction: '增加生活化情境导入并细化课堂板演追问' })}
                      >
                        <IconWandRefine size={13} /> 优化环节
                      </button>
                    </div>
                    {rewriteTarget?.key === 'teaching_steps' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        <input
                          className="input"
                          value={rewriteTarget.instruction}
                          onChange={(e) => setRewriteTarget({ ...rewriteTarget, instruction: e.target.value })}
                        />
                        <button type="button" className="btn btn-primary btn-sm" disabled={rewritingKey === 'teaching_steps'} onClick={() => handleRewriteSection('teaching_steps', rewriteTarget.instruction)}>
                          {rewritingKey === 'teaching_steps' ? '优化中…' : '确认'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRewriteTarget(null)}>取消</button>
                      </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '25%' }}>环节与时长</th>
                            <th style={{ width: '27%' }}>教师主导活动</th>
                            <th style={{ width: '24%' }}>学生探究响应</th>
                            <th style={{ width: '24%' }}>设计意图</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(draft.teaching_steps || []).map((st, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 700 }}>
                                <div>{st.phase}</div>
                                <div className="mono-num" style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 2 }}>{st.duration}</div>
                              </td>
                              <td><MathText text={st.teacher_activity} /></td>
                              <td><MathText text={st.student_activity} /></td>
                              <td><MathText text={st.design_intent} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Section 4: Authentic Dual-Column Pine Chalkboard */}
                  <section style={{ marginBottom: 22 }}>
                    <h3 className="serif-heading" style={{ margin: '0 0 8px', fontSize: 15.5, color: 'var(--accent)' }}>四、结构化板书设计</h3>
                    <div className="chalkboard-grid" data-testid="lesson-chalkboard">
                      <div className="chalkboard-col">
                        <div className="chalkboard-label">主板书 · 核心逻辑与四步程序</div>
                        <div style={{ fontSize: 13, lineHeight: 1.75 }}><MathText text={bbMain} /></div>
                      </div>
                      <div className="chalkboard-col">
                        <div className="chalkboard-label">副板书 · 直观模型与反例警示</div>
                        <div style={{ fontSize: 13, lineHeight: 1.75 }}><MathText text={bbSub} /></div>
                      </div>
                    </div>
                  </section>

                  {/* Section 5: Layered Practice & Verification Checklist */}
                  <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
                    <div>
                      <h3 className="serif-heading" style={{ margin: '0 0 10px', fontSize: 15.5, color: 'var(--accent)' }}>五、随堂分层练习</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                        {(draft.exercises || []).map((ex, i) => (
                          <div key={i} style={{ padding: '4px 0 6px 12px', borderLeft: '2px solid var(--accent)' }}>
                            <div style={{ fontWeight: 600, marginBottom: 4, lineHeight: 1.6 }}>
                              <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-serif)', marginRight: 6 }}>
                                【例 {i + 1} · {ex.tier}】
                              </span>
                              <MathText text={ex.question} />
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', lineHeight: 1.65 }}>
                              <strong style={{ color: 'var(--ink-primary)' }}>解析：</strong><MathText text={ex.solution} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="serif-heading" style={{ margin: '0 0 10px', fontSize: 15.5, color: 'var(--accent)' }}>六、试讲自查核验清单</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                        {(draft.verification_checklist || []).map((c, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 2px', borderBottom: '1px solid var(--border-hairline)' }}>
                            <IconVerifyCheck size={14} color="var(--success)" style={{ marginTop: 2, flexShrink: 0 }} />
                            <span style={{ lineHeight: 1.6 }}>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                </article>
              ) : (
                <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="lesson-edit-panel">
                  <div>
                    <label className="field-label">教案标题</label>
                    <input className="input" style={{ fontSize: 16, fontWeight: 700 }} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">一、教学目标（每行一条）</label>
                    <textarea className="textarea" rows={3} value={(draft.objectives || []).join('\n')} onChange={(e) => setDraft({ ...draft, objectives: e.target.value.split('\n') })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="field-label">二、学情前置分析</label>
                      <textarea className="textarea" rows={3} value={draft.learner_analysis} onChange={(e) => setDraft({ ...draft, learner_analysis: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">教学难点与突破策略</label>
                      <textarea className="textarea" rows={3} value={draft.difficult_points} onChange={(e) => setDraft({ ...draft, difficult_points: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="field-label">三、教学过程表逐单元格精修</label>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '20%' }}>环节与时长</th>
                            <th>教师主导活动</th>
                            <th>学生探究响应</th>
                            <th>设计意图</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(draft.teaching_steps || []).map((st, idx) => (
                            <tr key={idx}>
                              <td>
                                <textarea
                                  className="textarea"
                                  rows={2}
                                  style={{ fontSize: 12, marginBottom: 4 }}
                                  value={st.phase}
                                  onChange={(e) => {
                                    const next = [...draft.teaching_steps];
                                    next[idx] = { ...next[idx], phase: e.target.value };
                                    setDraft({ ...draft, teaching_steps: next });
                                  }}
                                />
                                <input
                                  className="input"
                                  style={{ fontSize: 11.5 }}
                                  value={st.duration}
                                  onChange={(e) => {
                                    const next = [...draft.teaching_steps];
                                    next[idx] = { ...next[idx], duration: e.target.value };
                                    setDraft({ ...draft, teaching_steps: next });
                                  }}
                                />
                              </td>
                              <td>
                                <textarea
                                  className="textarea"
                                  rows={3}
                                  style={{ fontSize: 12.5 }}
                                  value={st.teacher_activity}
                                  onChange={(e) => {
                                    const next = [...draft.teaching_steps];
                                    next[idx] = { ...next[idx], teacher_activity: e.target.value };
                                    setDraft({ ...draft, teaching_steps: next });
                                  }}
                                />
                              </td>
                              <td>
                                <textarea
                                  className="textarea"
                                  rows={3}
                                  style={{ fontSize: 12.5 }}
                                  value={st.student_activity}
                                  onChange={(e) => {
                                    const next = [...draft.teaching_steps];
                                    next[idx] = { ...next[idx], student_activity: e.target.value };
                                    setDraft({ ...draft, teaching_steps: next });
                                  }}
                                />
                              </td>
                              <td>
                                <textarea
                                  className="textarea"
                                  rows={3}
                                  style={{ fontSize: 12.5 }}
                                  value={st.design_intent}
                                  onChange={(e) => {
                                    const next = [...draft.teaching_steps];
                                    next[idx] = { ...next[idx], design_intent: e.target.value };
                                    setDraft({ ...draft, teaching_steps: next });
                                  }}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <label className="field-label">四、结构化板书（使用【主板书】与【副板书】分段）</label>
                    <textarea className="textarea" rows={4} value={draft.blackboard_design} onChange={(e) => setDraft({ ...draft, blackboard_design: e.target.value })} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
