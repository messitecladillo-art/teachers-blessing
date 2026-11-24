import React, { useEffect, useState } from 'react';
import { apiJson, handleSafeDownload, postSseStream, resolveApiUrl } from '../services/api';
import { AnalyticsReport, ArtifactItem } from '../types';
import { AgentStreamTrace } from '../components/AgentStreamTrace';
import { MathText } from '../components/MathText';
import {
  IconAlertWarn,
  IconAnalyticsRadar,
  IconDownloadBox,
  IconExamPaper,
  IconEyePreview,
  IconShieldLock,
  IconSlideDeck,
  IconTeacherSign,
  IconUploadCloud,
  IconVerifyCheck,
} from '../components/EduIcons';

interface AnalyticsWorkspaceProps {
  onArtifactsChanged: () => void;
  onExportAnalyticsToPpt: (
    title: string,
    subject: string,
    grade: string,
    material: string,
    domain?: string,
    branch?: string
  ) => void;
  onCreateRemediationQuiz?: (weakTopics: string[]) => void | Promise<void>;
}

function formatAnalyticsForPpt(report: AnalyticsReport): string {
  const s = report.stats;
  const n = report.ai_narrative;
  const lines: string[] = [
    `# ${report.title}`,
    `- 样本人数：N = ${s.student_count}｜满分：${s.full_score} 分`,
    `- 平均分：${s.summary.mean}｜中位数：${s.summary.median}｜标准差：${s.summary.std}`,
    `- 及格率：${s.summary.pass_rate}%｜优秀率：${s.summary.excellent_rate}%`,
    '',
    '## 一、分数段分布',
    ...(s.distribution || []).map((d) => `- ${d.bucket} 分段：${d.count} 人`),
    '',
    '## 二、各题知识点掌握度与区分度',
    ...(s.item_metrics || []).map(
      (m) => `- ${m.item}：均分 ${m.mean_score}/${m.full_score}，掌握率 ${m.mastery_pct}%，区分度 D=${m.discrimination}`
    ),
    '',
    '## 三、学情整体判断与薄弱归因',
    `- 整体诊断：${n.overall_diagnosis || ''}`,
    `- 薄弱归因：${n.weakness_attribution || ''}`,
    '',
    '## 四、分层靶向干预建议',
    ...(n.teaching_interventions || []).map((t, idx) => `${idx + 1}. ${t}`),
  ];
  return lines.join('\n');
}

interface DesensPreview {
  student_count: number;
  dropped_columns: string[];
  masked_columns: string[];
  redacted_fields_count: number;
  sample_before: Record<string, string>[];
  sample_after: Record<string, string>[];
}

export const AnalyticsWorkspace: React.FC<AnalyticsWorkspaceProps> = ({
  onArtifactsChanged,
  onExportAnalyticsToPpt,
  onCreateRemediationQuiz,
}) => {
  const [reports, setReports] = useState<AnalyticsReport[]>([]);
  const [activeReport, setActiveReport] = useState<AnalyticsReport | null>(null);
  const [loadingReports, setLoadingReports] = useState(true);

  const [title, setTitle] = useState('高二数学《导数与极值》单元测验学情诊断');
  const [datasetName, setDatasetName] = useState('高二导数单元测验_48人明细.csv');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<DesensPreview | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [reviewChecked, setReviewChecked] = useState(false);
  const [teacherNote, setTeacherNote] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [creatingRemediation, setCreatingRemediation] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const loadInitial = async () => {
    try {
      const [repRes, sampleRes] = await Promise.all([
        apiJson<{ reports: AnalyticsReport[] }>('/api/analytics/reports'),
        apiJson<{ dataset_name: string; csv_text: string }>('/api/analytics/sample-csv'),
      ]);
      setReports(repRes.reports);
      if (!activeReport && repRes.reports.length > 0) {
        const first = repRes.reports[0];
        setActiveReport(first);
        setReviewChecked(first.teacher_reviewed);
        setTeacherNote(first.teacher_note || '');
      }
      setDatasetName(sampleRes.dataset_name);
      setCsvText(sampleRes.csv_text);
      const pv = await apiJson<DesensPreview>('/api/analytics/desensitize-preview', {
        method: 'POST',
        body: JSON.stringify({ csv_text: sampleRes.csv_text }),
      });
      setPreview(pv);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载学情分析数据失败');
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadSample = async () => {
    setErrorMsg('');
    try {
      const sampleRes = await apiJson<{ dataset_name: string; csv_text: string }>('/api/analytics/sample-csv');
      setDatasetName(sampleRes.dataset_name);
      setCsvText(sampleRes.csv_text);
      const pv = await apiJson<DesensPreview>('/api/analytics/desensitize-preview', {
        method: 'POST',
        body: JSON.stringify({ csv_text: sampleRes.csv_text }),
      });
      setPreview(pv);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '载入示范成绩单失败');
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErrorMsg('');
    try {
      const text = await f.text();
      setDatasetName(f.name);
      setCsvText(text);
      const pv = await apiJson<DesensPreview>('/api/analytics/desensitize-preview', {
        method: 'POST',
        body: JSON.stringify({ csv_text: text }),
      });
      setPreview(pv);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '读取成绩表格并执行脱敏预览失败');
    }
  };

  const handlePreviewDesens = async () => {
    if (!csvText.trim()) return;
    setErrorMsg('');
    try {
      const pv = await apiJson<DesensPreview>('/api/analytics/desensitize-preview', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText }),
      });
      setPreview(pv);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '脱敏预览检验失败');
    }
  };

  const handleAnalyze = async () => {
    if (!csvText.trim() || isStreaming) return;
    setIsStreaming(true);
    setStageMsg('正在对姓名学号执行自动脱敏…');
    setThinkingText('');
    setErrorMsg('');
    setToastMsg('');

    try {
      await postSseStream<{ report: AnalyticsReport; artifact: ArtifactItem }>(
        '/api/analytics/analyze',
        { title, dataset_name: datasetName, csv_text: csvText, teacher_note: teacherNote },
        {
          onStage: (_, msg) => setStageMsg(msg),
          onThinking: (d) => setThinkingText((p) => p + d),
          onResult: (data) => {
            setActiveReport(data.report);
            setReviewChecked(data.report.teacher_reviewed);
            setTeacherNote(data.report.teacher_note || '');
            setReports((prev) => [data.report, ...prev]);
            setToastMsg('成绩统计与诊断已完成，请核对后确认。');
            onArtifactsChanged();
          },
          onError: (msg) => setErrorMsg(msg),
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '诊断失败');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSaveReview = async () => {
    if (!activeReport) return;
    setSavingReview(true);
    setErrorMsg('');
    setToastMsg('');
    try {
      await apiJson(`/api/analytics/${activeReport.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ teacher_reviewed: reviewChecked, teacher_note: teacherNote }),
      });
      const updated = { ...activeReport, teacher_reviewed: reviewChecked, teacher_note: teacherNote };
      setActiveReport(updated);
      setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setToastMsg('教师复核签章已更新至 Word 报告。');
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存复核签章失败');
    } finally {
      setSavingReview(false);
    }
  };

  const handleRemediationQuiz = async () => {
    if (!activeReport || creatingRemediation) return;
    const weakTopics = activeReport.stats.item_metrics
      .filter((m) => m.mastery_pct < 75)
      .map((m) => m.item);
    const targetTopics =
      weakTopics.length > 0
        ? weakTopics
        : activeReport.stats.item_metrics.slice(0, 2).map((m) => m.item);

    setCreatingRemediation(true);
    setErrorMsg('');
    setToastMsg('');
    try {
      if (onCreateRemediationQuiz) {
        await onCreateRemediationQuiz(targetTopics);
        return;
      }
      await apiJson('/api/agent/memory/remediation-quiz', {
        method: 'POST',
        body: JSON.stringify({ topics: targetTopics, count: 4 }),
      });
      setToastMsg('已根据薄弱知识点生成靶向巩固卷，可在组卷工作台查看与作答。');
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成靶向巩固卷失败');
    } finally {
      setCreatingRemediation(false);
    }
  };

  const maxBucketCount = activeReport
    ? Math.max(1, ...activeReport.stats.distribution.map((d) => d.count))
    : 1;
  const totalStudents = activeReport?.stats.student_count || 1;

  return (
    <div className="desk-split">
      {/* Left Intent Column */}
      <div className="pane-intent">
        <div className="pane-intent-scroll">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 className="serif-heading" style={{ margin: 0, fontSize: 16.5 }}>成绩数据导入</h2>
              <span className="stamp-badge stamp-verified">
                <IconShieldLock size={12} /> 自动脱敏
              </span>
            </div>
            <div className="preset-strip">
              <button type="button" className="preset-chip" onClick={handleLoadSample}>
                载入 48 人示范成绩单
              </button>
              <label className="preset-chip" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IconUploadCloud size={12} /> 上传成绩表格
                <input type="file" hidden accept=".csv,.txt" onChange={handleCsvUpload} />
              </label>
            </div>
          </div>

          <div className="pane-section-div">
            <label className="field-label">报告标题</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <label className="field-label" style={{ margin: 0 }}>成绩明细（自动移除姓名学号手机）</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handlePreviewDesens}>
                <IconEyePreview size={13} /> 检验脱敏
              </button>
            </div>
            <textarea
              className="textarea mono-num"
              wrap="off"
              rows={5}
              style={{ fontSize: 11.5, whiteSpace: 'pre', overflowX: 'auto' }}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
          </div>

          {preview && (
            <div className="callout-verified" style={{ fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>
                已遮蔽/移除 {preview.redacted_fields_count} 项敏感字段（N={preview.student_count}）
              </div>
              {preview.sample_before.length > 0 && preview.sample_after.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div style={{ background: '#FFFFFF', padding: 6, borderRadius: 5, border: '1px solid var(--border-hairline)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--seal)' }}>脱敏前（仅本地）</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {Object.entries(preview.sample_before[0]).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  </div>
                  <div style={{ background: '#FFFFFF', padding: 6, borderRadius: 5, border: '1px solid var(--border-hairline)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--success)' }}>脱敏后（入引擎）</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {Object.entries(preview.sample_after[0]).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pane-section-div">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: 'var(--ink-muted)' }}>
              历史学情档案 ({reports.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {reports.map((rep) => (
                <button
                  key={rep.id}
                  type="button"
                  className={`spine-item ${activeReport?.id === rep.id ? 'active' : ''}`}
                  style={{ padding: '7px 10px' }}
                  onClick={() => {
                    setActiveReport(rep);
                    setReviewChecked(rep.teacher_reviewed);
                    setTeacherNote(rep.teacher_note || '');
                    setErrorMsg('');
                    setToastMsg('');
                  }}
                >
                  <span className="spine-item-text" style={{ fontSize: 12.5 }}>{rep.title}</span>
                  <span className="spine-count">{rep.stats.student_count} 人</span>
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
            onClick={handleAnalyze}
            disabled={isStreaming || !csvText.trim()}
            data-testid="btn-analyze-scores"
          >
            <IconAnalyticsRadar size={15} /> {isStreaming ? '统计中…' : '开始统计分析'}
          </button>
        </div>
      </div>

      {/* Right Stage: Diagnostic Dossier */}
      <div className="pane-stage">
        <div className="stage-inner" style={{ maxWidth: 960 }}>
          <AgentStreamTrace isStreaming={isStreaming} stageMessage={stageMsg} thinkingText={thinkingText} errorMessage={errorMsg} />

          {!activeReport && loadingReports && (
            <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 360 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>正在调取脱敏学情诊断档案…</div>
              <div style={{ height: 24, width: '58%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ height: 140, width: '100%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
            </div>
          )}

          {activeReport && (
            <div className="paper-folio" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingBottom: 14, borderBottom: '1px solid var(--border-hairline)' }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="stamp-badge stamp-accent mono-num">样本人数 N={activeReport.stats.student_count}</span>
                    {activeReport.teacher_reviewed ? (
                      <span className="stamp-badge stamp-verified"><IconTeacherSign size={12} /> 教师已确认</span>
                    ) : (
                      <span className="stamp-badge stamp-warn"><IconAlertWarn size={12} /> 待教师核对</span>
                    )}
                  </div>
                  <h2 className="serif-heading" style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 600 }}>
                    <MathText inline text={activeReport.title} />
                  </h2>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {activeReport.artifact_id && (
                    <a
                      href={resolveApiUrl(`/api/artifacts/${activeReport.artifact_id}/download`)}
                      download
                      onClick={(e) => handleSafeDownload(e, `/api/artifacts/${activeReport.artifact_id}/download`, `${activeReport.title || '成绩分析报告'}.docx`)}
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: 'none' }}
                      data-testid="btn-download-analytics-docx"
                    >
                      <IconDownloadBox size={13} /> 导出报告
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-surface btn-sm"
                    disabled={creatingRemediation}
                    onClick={handleRemediationQuiz}
                    data-testid="btn-analytics-remediation-quiz"
                  >
                    <IconExamPaper size={13} color="var(--accent)" />
                    {creatingRemediation ? '组卷中…' : '生成靶向巩固卷'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-surface btn-sm"
                    onClick={() =>
                      onExportAnalyticsToPpt(
                        `${activeReport.title}·讲评课件`,
                        '学科教学分析',
                        '班级讲评',
                        formatAnalyticsForPpt(activeReport),
                        'pedagogy',
                        '教育测量与学情增值评价'
                      )
                    }
                  >
                    <IconSlideDeck size={13} color="var(--accent)" /> 生成讲评课件
                  </button>
                </div>
              </div>

              {toastMsg && (
                <div className="callout-verified" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconVerifyCheck size={15} color="var(--success)" /> {toastMsg}
                </div>
              )}

              {/* 5 Psychometric KPI Tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10 }}>
                {[
                  { label: '平均分', val: activeReport.stats.summary.mean, color: 'var(--accent)' },
                  { label: '中位数', val: activeReport.stats.summary.median, color: 'var(--ink-primary)' },
                  { label: '标准差', val: activeReport.stats.summary.std, color: 'var(--ink-secondary)' },
                  { label: '及格率', val: `${activeReport.stats.summary.pass_rate}%`, color: 'var(--success)' },
                  { label: '优秀率', val: `${activeReport.stats.summary.excellent_rate}%`, color: 'var(--accent)' },
                ].map((kpi) => (
                  <div key={kpi.label} style={{ textAlign: 'center', background: 'var(--bg-subtle)', border: '1px solid var(--border-hairline)', borderRadius: 8, padding: '12px 10px' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{kpi.label}</div>
                    <div className="mono-num" style={{ fontSize: 22, fontWeight: 800, color: kpi.color, marginTop: 2 }}>{kpi.val}</div>
                  </div>
                ))}
              </div>

              {/* Distribution + Item Mastery Charts */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
                <div style={{ padding: '14px 16px', border: '1px solid var(--border-hairline)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>分数段分布（低 → 高）</span>
                    <span className="mono-num" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>单位：人 (占比)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 156, paddingTop: 14, borderBottom: '1px solid var(--border-strong)', paddingBottom: 4 }}>
                    {activeReport.stats.distribution.map((d) => {
                      const barPx = Math.round((d.count / maxBucketCount) * 100);
                      const pctShare = Math.round((d.count / totalStudents) * 100);
                      return (
                        <div key={d.bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <span className="mono-num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
                            {d.count}人 ({pctShare}%)
                          </span>
                          <div
                            style={{
                              width: '74%',
                              height: `${Math.max(8, barPx)}px`,
                              background: d.bucket === '<60' ? '#B43B2A' : d.bucket === '60-69' ? '#9A5B13' : '#1B4D3E',
                              borderRadius: '4px 4px 1px 1px',
                            }}
                          />
                          <span className="mono-num" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)' }}>{d.bucket}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', border: '1px solid var(--border-hairline)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>各题知识点掌握率</span>
                    <span className="mono-num" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>D ≥ 0.30 为优良</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeReport.stats.item_metrics.map((m) => (
                      <div key={m.item} style={{ fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontWeight: 600 }}><MathText inline text={m.item} /></span>
                          <span className="mono-num" style={{ fontWeight: 700, color: m.mastery_pct < 70 ? 'var(--seal)' : 'var(--success)' }}>
                            {m.mastery_pct}% (D={m.discrimination})
                          </span>
                        </div>
                        <div style={{ height: 7, background: 'var(--bg-muted)', borderRadius: 999, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${m.mastery_pct}%`,
                              height: '100%',
                              background: m.mastery_pct < 70 ? '#B43B2A' : m.mastery_pct < 82 ? '#9A5B13' : '#1B4D3E',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Attribution & Cohorts */}
              <div style={{ padding: '14px 16px', background: 'var(--bg-subtle)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, lineHeight: 1.68 }}>
                <div>
                  <strong>整体学情判断：</strong>
                  <MathText inline text={activeReport.ai_narrative.overall_diagnosis} />
                </div>
                <div>
                  <strong>薄弱环节归因：</strong>
                  <MathText inline text={activeReport.ai_narrative.weakness_attribution} />
                </div>
                <div>
                  <strong>分层靶向干预建议：</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {(activeReport.ai_narrative.teaching_interventions || []).map((t, i) => (
                      <li key={i}><MathText inline text={t} /></li>
                    ))}
                  </ul>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    重点跟进脱敏代号（{activeReport.stats.cohorts.attention_count} 人）：
                  </strong>
                  {(activeReport.stats.cohorts.attention_aliases || []).map((al) => (
                    <span key={al} className="stamp-badge stamp-seal mono-num">{al}</span>
                  ))}
                </div>
              </div>

              {/* Teacher Sign-off Bar */}
              <div style={{ padding: '12px 14px', border: '1px solid var(--border-strong)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={reviewChecked}
                      onChange={(e) => setReviewChecked(e.target.checked)}
                      data-testid="checkbox-teacher-review"
                    />
                    我已核对统计指标与脱敏代号，确认归因结论符合教学实际
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveReview}
                    disabled={savingReview}
                    data-testid="btn-save-analytics-review"
                  >
                    {savingReview ? '保存中…' : '保存复核签章'}
                  </button>
                </div>
                <input
                  className="input"
                  placeholder="输入教师附加复核批注（同步写入 Word 报告）…"
                  value={teacherNote}
                  onChange={(e) => setTeacherNote(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
