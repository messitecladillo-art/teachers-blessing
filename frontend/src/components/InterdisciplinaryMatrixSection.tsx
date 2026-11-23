import React, { useMemo, useState } from 'react';
import { DISCIPLINE_TAXONOMY } from '../data/disciplineTaxonomy';
import {
  DisciplineDomain,
  PedagogyTopic,
  SandboxPresetConfig,
} from '../types';
import {
  IconCompassBook,
  IconFunctionCurve,
  IconLessonDoc,
  IconMindMap,
  IconSparkPulse,
} from './EduIcons';
import { MathText } from './MathText';

interface InterdisciplinaryMatrixSectionProps {
  topics: PedagogyTopic[];
  domains?: DisciplineDomain[];
  onLoadSandbox: (preset: SandboxPresetConfig) => void;
  onCreateMindmap: (topic: PedagogyTopic) => void;
  onApplyToTutor: (topic: PedagogyTopic) => void;
  onApplyToLesson: (topic: PedagogyTopic) => void;
  onOpenVault?: () => void;
}

export const InterdisciplinaryMatrixSection: React.FC<InterdisciplinaryMatrixSectionProps> = ({
  topics,
  domains = DISCIPLINE_TAXONOMY,
  onLoadSandbox,
  onCreateMindmap,
  onApplyToTutor,
  onApplyToLesson,
  onOpenVault,
}) => {
  const [activeDomainId, setActiveDomainId] = useState<string>('featured');
  const [activeBranch, setActiveBranch] = useState<string>('全部');
  const [searchQ, setSearchQ] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [buildingMapId, setBuildingMapId] = useState<string>('');

  const selectedDomainObj = useMemo(
    () => domains.find((d) => d.id === activeDomainId) || null,
    [domains, activeDomainId]
  );

  const displayedTopics = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (q) {
      return topics
        .filter((t) => {
          const hay = [
            t.title,
            t.subject,
            t.domain_name || '',
            t.branch || '',
            ...(t.keywords || []),
            ...(t.interdisciplinary_links || []).map((l) => `${l.domain} ${l.title}`),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 8);
    }

    if (activeDomainId === 'featured') {
      const picks = [
        'zhihu_deriv_mono',
        'v35_alg_coset_quotient',
        'v35_complex_branch',
        'v35_astro_distance_ladder',
        'v3_pbl_epidemic_sir',
        'v3_hum_chibifu',
      ];
      const byId = new Map(topics.map((t) => [t.id, t]));
      const chosen = picks.map((id) => byId.get(id)).filter((x): x is PedagogyTopic => Boolean(x));
      return chosen.length ? chosen : topics.slice(0, 6);
    }

    return topics.filter((t) => {
      if (t.domain_id !== activeDomainId) return false;
      if (activeBranch !== '全部' && t.branch !== activeBranch) return false;
      return true;
    });
  }, [topics, activeDomainId, activeBranch, searchQ]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="paper-folio" data-testid="interdisciplinary-matrix-section">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <IconCompassBook size={18} color="var(--accent)" />
          <h3 className="serif-heading" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            学科专题与教学参考
          </h3>
          <span className="stamp-badge stamp-accent mono-num">
            {domains.length} 个学科分类 · 45 个分支 · {topics.length} 个专题
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ width: 200, padding: '5px 10px', fontSize: 12 }}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="搜索专题、公式或概念…"
            data-testid="matrix-search-input"
          />
          {onOpenVault && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenVault} data-testid="btn-open-full-vault">
              查看全部专题 →
            </button>
          )}
        </div>
      </div>

      {/* Tier 1: Primary Discipline Domain Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--border-hairline)', marginBottom: 10 }} data-testid="matrix-domain-tabs">
        <button
          type="button"
          className={`btn btn-sm ${activeDomainId === 'featured' ? 'btn-primary' : 'btn-surface'}`}
          onClick={() => {
            setActiveDomainId('featured');
            setActiveBranch('全部');
            setSearchQ('');
          }}
          data-testid="matrix-domain-featured"
        >
          跨学科精选 (6)
        </button>
        {domains.map((d) => {
          const cnt = topics.filter((t) => t.domain_id === d.id).length;
          const active = activeDomainId === d.id;
          return (
            <button
              key={d.id}
              type="button"
              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-surface'}`}
              onClick={() => {
                setActiveDomainId(d.id);
                setActiveBranch('全部');
                setSearchQ('');
              }}
              data-testid={`matrix-domain-${d.id}`}
            >
              {d.short_name}
              <span className="mono-num" style={{ opacity: 0.78 }}>({cnt})</span>
            </button>
          );
        })}
      </div>

      {/* Tier 2: Dynamic Branch Filter Pills (45-branch hierarchy) */}
      {selectedDomainObj && !searchQ.trim() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }} data-testid="matrix-branch-pills">
          <span style={{ color: 'var(--ink-muted)', fontWeight: 600 }}>细分分支：</span>
          <button
            type="button"
            className="preset-chip"
            style={activeBranch === '全部' ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
            onClick={() => setActiveBranch('全部')}
          >
            全部分支
          </button>
          {selectedDomainObj.branches.map((br) => {
            const bCnt = topics.filter((t) => t.domain_id === selectedDomainObj.id && t.branch === br.name).length;
            const bActive = activeBranch === br.name;
            return (
              <button
                key={br.id}
                type="button"
                className="preset-chip"
                style={bActive ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                onClick={() => setActiveBranch(br.name)}
                data-testid={`matrix-branch-${br.id}`}
              >
                {br.name} {bCnt > 0 ? `(${bCnt})` : ''}
              </button>
            );
          })}
        </div>
      )}

      {/* Topics Manuscript Grid */}
      {displayedTopics.length === 0 ? (
        <div style={{ padding: '26px 12px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
          该细分分支暂可切换至「全部分支」浏览同大类专题，或直接在左上角选择该分支触发 AI 专属推导与生成。
        </div>
      ) : (
        <div className="pedagogy-grid-2x2">
          {displayedTopics.map((ft) => {
            const isExpanded = Boolean(expandedIds[ft.id]);
            const links = ft.interdisciplinary_links || [];
            const socratic = ft.socratic_chain || [];
            return (
              <div
                key={ft.id}
                style={{
                  padding: '12px 14px',
                  borderLeft: '2.5px solid var(--accent)',
                  borderBottom: '1px solid var(--border-hairline)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 8,
                  background: '#FDFCF9',
                }}
                data-testid={`matrix-card-${ft.id}`}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="stamp-badge stamp-accent">{ft.domain_name || ft.subject}</span>
                      {ft.branch && (
                        <span className="stamp-badge stamp-neutral" style={{ fontSize: 11 }}>{ft.branch}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{ft.grade_level}</span>
                  </div>

                  <div className="serif-heading" style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.4 }}>
                    {ft.title}
                  </div>

                  {ft.core_formula_latex && (
                    <div style={{ padding: '5px 8px', background: '#FAF8F4', borderLeft: '2px solid var(--border-strong)', fontSize: 12, color: 'var(--ink-primary)' }}>
                      <MathText text={ft.core_formula_latex} />
                    </div>
                  )}

                  <div style={{ fontSize: 12.5, color: 'var(--ink-secondary)', lineHeight: 1.58 }}>
                    <strong>{ft.intuition_models[0]?.name}：</strong>
                    {ft.intuition_models[0]?.desc.slice(0, 92)}
                    {(ft.intuition_models[0]?.desc?.length || 0) > 92 ? '…' : ''}
                  </div>

                  {links.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>关联领域：</span>
                      {links.map((lk, idx) => (
                        <span
                          key={idx}
                          className="stamp-badge stamp-warn"
                          style={{ fontSize: 10.5 }}
                          title={lk.mechanism}
                        >
                          {lk.domain} · {lk.title.slice(0, 14)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* In-place Expandable Socratic Chain */}
                  {isExpanded && (
                    <div style={{ marginTop: 4, padding: '8px 10px', background: '#FAF8F4', borderRadius: 6, border: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
                      {socratic.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>分步引导问题：</div>
                          {socratic.map((sc, i) => (
                            <div key={i} style={{ marginBottom: 4, lineHeight: 1.55 }}>
                              <strong style={{ color: 'var(--seal)' }}>[{sc.step}]</strong> <MathText text={sc.question} />
                              <div style={{ color: 'var(--ink-secondary)', paddingLeft: 10 }}>↳ 提示：<MathText text={sc.insight} /></div>
                            </div>
                          ))}
                        </div>
                      )}
                      {links.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 5 }}>
                          <div style={{ fontWeight: 700, color: 'var(--ink-primary)', marginBottom: 3 }}>跨学科联系：</div>
                          {links.map((lk, i) => (
                            <div key={i} style={{ color: 'var(--ink-secondary)', marginBottom: 2 }}>
                              • <strong>{lk.domain}（{lk.title}）：</strong><MathText text={lk.mechanism} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ color: 'var(--accent)', borderTop: '1px solid var(--border-hairline)', paddingTop: 5 }}>
                        <strong>核心要点：</strong>{ft.board_punchline}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11.5, padding: '2px 6px', color: 'var(--seal)' }}
                    onClick={() => toggleExpand(ft.id)}
                    data-testid={`matrix-expand-${ft.id}`}
                  >
                    {isExpanded ? '收起详情 ▲' : `引导问题与 ${ft.pitfalls_and_counterexamples.length} 条反例 ▼`}
                  </button>

                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {ft.sandbox_preset && (
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        style={{ fontSize: 11.5, padding: '4px 8px' }}
                        onClick={() => onLoadSandbox(ft.sandbox_preset!)}
                        data-testid={`matrix-sandbox-${ft.id}`}
                      >
                        <IconFunctionCurve size={12} color="var(--accent)" /> 打开画板
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      style={{ fontSize: 11.5, padding: '4px 8px' }}
                      disabled={buildingMapId === ft.id}
                      onClick={async () => {
                        setBuildingMapId(ft.id);
                        try {
                          await onCreateMindmap(ft);
                        } finally {
                          setBuildingMapId('');
                        }
                      }}
                      data-testid={`matrix-mindmap-${ft.id}`}
                    >
                      <IconMindMap size={12} color="var(--accent)" />
                      {buildingMapId === ft.id ? '生成中…' : '思维导图'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      style={{ fontSize: 11.5, padding: '4px 8px' }}
                      onClick={() => onApplyToTutor(ft)}
                    >
                      <IconSparkPulse size={12} /> 答疑
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: 11.5, padding: '4px 8px' }}
                      onClick={() => onApplyToLesson(ft)}
                    >
                      <IconLessonDoc size={12} /> 转教案
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
