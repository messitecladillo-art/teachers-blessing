import React, { useEffect, useState } from 'react';
import { DISCIPLINE_TAXONOMY } from '../data/disciplineTaxonomy';
import { apiJson } from '../services/api';
import { DisciplineDomain, PedagogyTopic } from '../types';
import {
  IconAlertWarn,
  IconCloseX,
  IconCompassBook,
  IconLessonDoc,
  IconMindMap,
  IconSlideDeck,
  IconSparkPulse,
} from './EduIcons';
import { MathText } from './MathText';

interface PedagogyVaultModalProps {
  open: boolean;
  onClose: () => void;
  onApplyToTutor: (topic: PedagogyTopic) => void;
  onApplyToLesson: (topic: PedagogyTopic) => void;
  onApplyToPpt: (topic: PedagogyTopic) => void;
  onCreateMindmap?: (topic: PedagogyTopic) => void;
}

export const PedagogyVaultModal: React.FC<PedagogyVaultModalProps> = ({
  open,
  onClose,
  onApplyToTutor,
  onApplyToLesson,
  onApplyToPpt,
  onCreateMindmap,
}) => {
  const [topics, setTopics] = useState<PedagogyTopic[]>([]);
  const [domains, setDomains] = useState<DisciplineDomain[]>(DISCIPLINE_TAXONOMY);
  const [activeDomainId, setActiveDomainId] = useState('all');
  const [activeBranch, setActiveBranch] = useState('全部');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PedagogyTopic | null>(null);

  useEffect(() => {
    if (!open) return;
    apiJson<{ topics: PedagogyTopic[]; domains?: DisciplineDomain[] }>('/api/pedagogy/topics')
      .then((res) => {
        setTopics(res.topics || []);
        if (res.domains?.length) setDomains(res.domains);
        if (!selected && res.topics?.length) {
          setSelected(res.topics[0]);
        }
      })
      .catch(() => {});

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeDomObj = domains.find((d) => d.id === activeDomainId) || null;
  const filtered = topics.filter((t) => {
    const matchDom = activeDomainId === 'all' || t.domain_id === activeDomainId;
    const matchBranch = activeBranch === '全部' || t.branch === activeBranch;
    const q = query.trim().toLowerCase();
    if (!q) return matchDom && matchBranch;
    return (
      matchDom &&
      matchBranch &&
      (t.title.toLowerCase().includes(q) ||
        (t.branch || '').toLowerCase().includes(q) ||
        (t.domain_name || '').toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q)) ||
        t.board_punchline.toLowerCase().includes(q))
    );
  });

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="pedagogy-vault-modal">
      <div className="modal-panel" style={{ width: 'min(1120px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-hairline)' }}>
          <div>
            <h2 className="serif-heading" style={{ margin: 0, fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconCompassBook size={20} color="var(--accent)" />
              学科专题知识库
            </h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 3 }}>
              {domains.length} 个学科分类 · 45 个分支 · 共 {topics.length} 个专题，提供讲解步骤、引导问题与反例
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭" onClick={onClose}>
            <IconCloseX size={18} />
          </button>
        </div>

        {/* Filter bar: Search + Domain selector + Branch pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ width: 250 }}
              placeholder="搜索学科、公式、跨学科模型…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="pedagogy-search-input"
            />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${activeDomainId === 'all' ? 'btn-primary' : 'btn-surface'}`}
                onClick={() => {
                  setActiveDomainId('all');
                  setActiveBranch('全部');
                }}
              >
                全科总览 ({topics.length})
              </button>
              {domains.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`btn btn-sm ${activeDomainId === d.id ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => {
                    setActiveDomainId(d.id);
                    setActiveBranch('全部');
                  }}
                >
                  {d.short_name}
                </button>
              ))}
            </div>
          </div>

          {activeDomObj && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
              <span style={{ color: 'var(--ink-muted)', fontWeight: 600 }}>细分分支：</span>
              <button
                type="button"
                className="preset-chip"
                style={activeBranch === '全部' ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                onClick={() => setActiveBranch('全部')}
              >
                全部
              </button>
              {activeDomObj.branches.map((br) => (
                <button
                  key={br.id}
                  type="button"
                  className="preset-chip"
                  style={activeBranch === br.name ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => setActiveBranch(br.name)}
                >
                  {br.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 310px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* Topic list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`spine-item ${selected?.id === t.id ? 'active' : ''}`}
                style={{ padding: '9px 11px', flexDirection: 'column', alignItems: 'flex-start', gap: 3, height: 'auto' }}
                onClick={() => setSelected(t)}
              >
                <div style={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.4, textAlign: 'left' }}>{t.title}</div>
                <div style={{ fontSize: 11, opacity: 0.78 }}>
                  {t.domain_name || t.subject} · {t.branch || t.grade_level}
                </div>
              </button>
            ))}
          </div>

          {/* Detail folio */}
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '60vh', overflowY: 'auto', padding: '12px 16px', background: '#FDFCF9', border: '1px solid var(--border-hairline)', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--border-hairline)' }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="stamp-badge stamp-accent">{selected.domain_name || selected.subject}</span>
                    {selected.branch && <span className="stamp-badge stamp-neutral">{selected.branch}</span>}
                    <span className="stamp-badge stamp-neutral">{selected.grade_level}</span>
                  </div>
                  <h3 className="serif-heading" style={{ margin: '8px 0 0', fontSize: 18, fontWeight: 600 }}>{selected.title}</h3>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {onCreateMindmap && (
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      onClick={() => {
                        onCreateMindmap(selected);
                        onClose();
                      }}
                    >
                      <IconMindMap size={14} color="var(--accent)" /> 生成导图
                    </button>
                  )}
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => onApplyToTutor(selected)}>
                    <IconSparkPulse size={14} color="var(--accent)" /> 去答疑
                  </button>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => onApplyToLesson(selected)}>
                    <IconLessonDoc size={14} color="var(--accent)" /> 写教案
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onApplyToPpt(selected)}>
                    <IconSlideDeck size={14} /> 转 PPT
                  </button>
                </div>
              </div>

              {selected.core_formula_latex && (
                <div style={{ padding: '7px 12px', borderLeft: '3px solid var(--accent)', background: '#FAF8F4', fontSize: 13 }}>
                  <strong>核心公式与结论：</strong>
                  <MathText text={selected.core_formula_latex} />
                </div>
              )}

              <div className="callout-pedagogy" style={{ fontSize: 13 }}>
                <strong style={{ color: 'var(--accent)' }}>课堂导入参考：</strong>
                {selected.micro_teaching_hook}
              </div>

              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>直观理解角度</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                  {selected.intuition_models.map((im) => (
                    <div key={im.name} style={{ padding: '6px 0 6px 12px', borderLeft: '2px solid var(--border-strong)', fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700, color: 'var(--ink-primary)', marginBottom: 3 }}>{im.name}</div>
                      <div style={{ color: 'var(--ink-secondary)', lineHeight: 1.58 }}><MathText text={im.desc} /></div>
                    </div>
                  ))}
                </div>
              </div>

              {(selected.socratic_chain || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>分步引导问题</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                    {(selected.socratic_chain || []).map((sc, i) => (
                      <div key={i} style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', background: '#FAF8F4' }}>
                        <strong style={{ color: 'var(--seal)' }}>[{sc.step}] </strong>
                        <MathText text={sc.question} />
                        <div style={{ color: 'var(--ink-secondary)', marginTop: 2 }}>↳ 提示：<MathText text={sc.insight} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selected.interdisciplinary_links || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>跨学科关联</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
                    {(selected.interdisciplinary_links || []).map((lk, i) => (
                      <div key={i} style={{ padding: '6px 10px', borderLeft: '2px solid var(--warn)', background: '#FEF9EF' }}>
                        <strong>[{lk.domain}] {lk.title}：</strong>
                        <MathText text={lk.mechanism} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>建议讲解步骤</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                  {selected.teaching_flow.map((step, i) => (
                    <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-hairline)' }}>
                      <MathText text={step} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="callout-danger">
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--seal)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconAlertWarn size={14} color="var(--seal)" /> 常见易错点与反例
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                  {selected.pitfalls_and_counterexamples.map((p, idx) => (
                    <li key={idx}><MathText text={p} /></li>
                  ))}
                </ul>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12.5, paddingTop: 6, borderTop: '1px solid var(--border-hairline)' }}>
                <span>
                  <strong>要点总结：</strong>
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{selected.board_punchline}</span>
                </span>
                <a href={selected.zhihu_reference_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  查看参考讨论 ↗
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
