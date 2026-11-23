import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/api';
import { TelemetrySummary } from '../types';
import {
  IconCloseX,
  IconVerifyCheck,
  IconAlertWarn,
  IconSparkPulse,
  IconTrashClean,
} from './EduIcons';

interface SurveyInsightsModalProps {
  open: boolean;
  onClose: () => void;
  onPurged: () => void;
}

interface TelemetryResp {
  telemetry: TelemetrySummary;
  survey_benchmarks: {
    sample_n: number;
    normal_students_pct: number;
    college_students_pct: number;
    dual_role_overlap_in_normal: string;
    top_concerns: { label: string; pct: number; countermeasure: string }[];
    teaching_high_demand: { label: string; rate: number; mean: number; very_needed?: number }[];
    learning_high_demand: { label: string; rate: number; mean: number }[];
  };
}

export const SurveyInsightsModal: React.FC<SurveyInsightsModalProps> = ({ open, onClose, onPurged }) => {
  const [data, setData] = useState<TelemetryResp | null>(null);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiJson<TelemetryResp>('/api/system/telemetry').then(setData).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handlePurge = async (restoreShowcase: boolean) => {
    setPurging(true);
    try {
      await apiJson(`/api/system/privacy/purge?restore_showcase=${restoreShowcase}`, { method: 'POST' });
      const fresh = await apiJson<TelemetryResp>('/api/system/telemetry');
      setData(fresh);
      onPurged();
    } finally {
      setPurging(false);
    }
  };

  const tel = data?.telemetry;
  const bench = data?.survey_benchmarks;

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="survey-insights-modal">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              需求调研与使用统计
            </h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 4 }}>
              依据 n=52 问卷实证分析（师范生 51.92% / 在校大学生 86.54%）设计
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭问卷面板" onClick={onClose}>
            <IconCloseX size={20} />
          </button>
        </div>

        {/* Live Telemetry Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div className="card-compact" style={{ background: 'var(--accent-soft)' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>已生成文件</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)', marginTop: 4 }} className="mono-num">
              {tel?.total_artifacts ?? 0}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>课件 / 教案 / 试卷 / 导图</div>
          </div>
          <div className="card-compact" style={{ background: '#F0FDF4' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>计算与版式核对率</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
              {tel?.verification_pass_rate ?? 100}%
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>自动验算与排版检查</div>
          </div>
          <div className="card-compact" style={{ background: '#FFFBEB' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>人工修订比例</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--warn)', marginTop: 4 }}>
              {tel?.human_revision_rate ?? 0}%
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>支持逐段与画布修改</div>
          </div>
          <div className="card-compact" style={{ background: '#F8FAFC' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>平均处理耗时</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-primary)', marginTop: 4 }}>
              {tel?.avg_generation_sec ?? 0}s
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>分阶段进度实时展示</div>
          </div>
        </div>

        {/* Survey Pain Points -> Implemented Countermeasures */}
        {bench && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div className="card-compact">
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconAlertWarn size={16} color="var(--warn)" />
                问卷 TOP4 核心顾虑 → 系统工程兑现
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bench.top_concerns.map((item) => (
                  <div key={item.label} style={{ fontSize: 12.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span>{item.label}</span>
                      <span style={{ color: 'var(--accent)' }}>{item.pct}%</span>
                    </div>
                    <div style={{ color: 'var(--ink-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <IconVerifyCheck size={13} color="var(--success)" />
                      <span>{item.countermeasure}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-compact">
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconSparkPulse size={16} color="var(--accent)" />
                73.08% 低价意愿区间原型方案（0–30元/月）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-subtle)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>校园公益版</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)', margin: '4px 0' }}>¥0</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.5 }}>题目答疑、算式验算、错题本与基础教案</div>
                </div>
                <div style={{ padding: 10, borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid rgba(27,77,62,0.2)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>师范生试讲版</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', margin: '4px 0' }}>¥9.9/月</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)', lineHeight: 1.5 }}>可编辑课件制作、试讲配音与智能组卷</div>
                </div>
                <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-subtle)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>教研进阶版</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-primary)', margin: '4px 0' }}>¥19.9/月</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.5 }}>脱敏学情诊断与校本教材批量解析</div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-muted)' }}>
                注：呼应问卷第 7 页建议，¥9.9 与 ¥19.9 为原型实验定价梯度；本系统完全本地运行，内置即用。
              </div>
            </div>
          </div>
        )}

        {/* Privacy Data Purge Controls */}
        <div
          className="card-compact"
          style={{
            background: '#FFF1F2',
            borderColor: '#FECDD3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#9F1239' }}>
              数据隐私与本地清理
            </div>
            <div style={{ fontSize: 12, color: '#881337', marginTop: 2 }}>
              支持一键彻底清除本地保存的记录、上传资料与生成文件。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-surface btn-sm"
              disabled={purging}
              onClick={() => handlePurge(true)}
            >
              重置并恢复示范包
            </button>
            <button
              type="button"
              className="btn btn-danger-soft btn-sm"
              disabled={purging}
              onClick={() => handlePurge(false)}
              data-testid="btn-purge-all-data"
            >
              <IconTrashClean size={14} /> 一键彻底清除全部数据
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
