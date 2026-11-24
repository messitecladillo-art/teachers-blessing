import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/api';
import { CourseRecord, MarketplaceCourse } from '../types';
import { assetUrl } from '../utils/assets';

interface HkMarketplaceViewProps {
  onCourseEnrolled: (course: CourseRecord) => void;
}

export const HkMarketplaceView: React.FC<HkMarketplaceViewProps> = ({ onCourseEnrolled }) => {
  const [tabMode, setTabMode] = useState<'curated' | 'teaching'>('curated');
  const [category, setCategory] = useState('全部');
  const [categories, setCategories] = useState<string[]>(['全部']);
  const [bento, setBento] = useState<MarketplaceCourse[]>([]);
  const [items, setItems] = useState<MarketplaceCourse[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [enrollingId, setEnrollingId] = useState('');
  const [previewItem, setPreviewItem] = useState<MarketplaceCourse | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!previewItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewItem(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewItem]);

  const loadMarketplace = async (cat: string, qText: string, mode: 'curated' | 'teaching') => {
    setLoading(true);
    setErrorMsg('');
    try {
      const qs = new URLSearchParams({ category: cat, q: qText, tab: mode }).toString();
      const res = await apiJson<{
        categories: string[];
        featured_bento: MarketplaceCourse[];
        items: MarketplaceCourse[];
      }>(`/api/courses/marketplace?${qs}`);
      setCategories(res.categories || ['全部']);
      setBento(res.featured_bento || []);
      setItems(res.items || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载课程集市失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMarketplace(category, debouncedQuery, tabMode);
  }, [category, debouncedQuery, tabMode]);

  const handleEnroll = async (marketId: string) => {
    setEnrollingId(marketId);
    setErrorMsg('');
    try {
      const res = await apiJson<{ course: CourseRecord }>('/api/courses/enroll', {
        method: 'POST',
        body: JSON.stringify({ market_id: marketId, mode: tabMode === 'teaching' ? 'teaching' : 'self_study' }),
      });
      if (res.course) {
        setPreviewItem(null);
        onCourseEnrolled(res.course);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加入课程失败，请稍后重试');
    } finally {
      setEnrollingId('');
    }
  };

  return (
    <div className="hk-page-wrap">
      {/* Centered Hero with Sky-Blue Highlight */}
      <div style={{ textAlign: 'center', margin: '10px auto 24px', maxWidth: 640 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 700, lineHeight: 1.35 }}>
          发现<span className="hk-brush-blue">最适合你的</span>课程
          <br />
          围绕清晰结构打造你的学习节奏
        </h1>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <div className="hk-mode-switcher">
            <button
              type="button"
              className={`hk-mode-btn ${tabMode === 'curated' ? 'active' : ''}`}
              onClick={() => setTabMode('curated')}
            >
              官方课程
            </button>
            <button
              type="button"
              className={`hk-mode-btn ${tabMode === 'teaching' ? 'active' : ''}`}
              onClick={() => setTabMode('teaching')}
            >
              专题教研集
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, maxWidth: 460, marginInline: 'auto' }}>
          <input
            className="input"
            style={{ borderRadius: 999, height: 42, paddingLeft: 18, background: '#ffffff', boxShadow: 'var(--shadow-paper)' }}
            placeholder="在课程集市中搜索学科、定理或课题..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {errorMsg && (
        <div className="callout-danger" style={{ marginBottom: 18, fontSize: 13 }}>
          {errorMsg}
        </div>
      )}

      {/* Bento Featured Grid */}
      {bento.length > 0 && !query.trim() && category === '全部' && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span className="badge badge-neutral">精选</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>编辑精选</span>
          </div>

          <div className="hk-bento-grid">
            {bento.slice(0, 6).map((b) => (
              <button
                key={b.market_id}
                type="button"
                className={`hk-bento-card size-${b.size || 'medium'}`}
                onClick={() => setPreviewItem(b)}
              >
                <img src={assetUrl(b.cover_image)} alt={b.title} />
                <div className="hk-bento-overlay">
                  <div className="hk-bento-meta-row">
                    <span className="hk-frosted-tag">{b.level}</span>
                    <span className="hk-frosted-tag">{b.hours}</span>
                  </div>
                  <div style={{ fontSize: b.size === 'hero' ? 22 : 15, fontWeight: 700, lineHeight: 1.3 }}>
                    {b.title}
                  </div>
                  {b.size === 'hero' && (
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: 6, lineHeight: 1.5 }}>
                      {b.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 11-Category Horizontal Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          overflowX: 'auto',
          borderBottom: '1px solid #eef0f3',
          paddingBottom: 10,
          marginBottom: 20,
        }}
      >
        {categories.map((cat) => {
          const active = category === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              style={{
                border: 'none',
                borderBottom: active ? '2px solid #181a1f' : '2px solid transparent',
                background: 'transparent',
                padding: '6px 2px',
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                color: active ? '#181a1f' : '#6b7280',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Course Cards Grid */}
      {!loading && items.length === 0 ? (
        <div className="paper-folio" style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#181a1f', marginBottom: 6 }}>
            未找到符合条件的集市课程
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            当前分类「{category}」{query.trim() ? `与关键词「${query.trim()}」` : ''}下暂无匹配结果，可重置筛选查看全部专题。
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setCategory('全部');
              setQuery('');
              setDebouncedQuery('');
            }}
          >
            重置筛选条件
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 18 }}>
          {items.slice(0, 24).map((it) => {
            const isCompleted = (it as unknown as { status?: string; progress_pct?: number }).status === 'completed' || ((it as unknown as { progress_pct?: number }).progress_pct ?? 0) >= 100;
            return (
              <div
                key={it.market_id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e6e8ec',
                  borderRadius: 16,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-paper)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ height: 148, overflow: 'hidden', background: '#f3f4f6' }}>
                    <img
                      src={assetUrl(it.cover_image)}
                      alt={it.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: '#3b4f7d', fontWeight: 600 }}>
                      <span>{it.subject}</span>
                      <span>
                        {isCompleted ? '已完成 · ' : ''}
                        {it.level} · {it.hours}
                      </span>
                    </div>
                    <div className="serif-heading" style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>
                      {it.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
                      {it.description}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    disabled={enrollingId === it.market_id}
                    onClick={() => handleEnroll(it.market_id)}
                  >
                    {enrollingId === it.market_id
                      ? '加入中…'
                      : tabMode === 'teaching'
                      ? '采用此模板备课'
                      : '加入我的课程'}
                  </button>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => setPreviewItem(it)}>
                    预览
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Course Preview Modal */}
      {previewItem && (
        <div className="modal-backdrop" onClick={() => setPreviewItem(null)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={previewItem.title}
            style={{ maxWidth: 580 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ height: 190, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              <img
                src={assetUrl(previewItem.cover_image)}
                alt={previewItem.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span className="badge badge-info">{previewItem.subject}</span>
              <span className="badge badge-neutral">{previewItem.level}</span>
              <span className="badge badge-neutral">{previewItem.hours}</span>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{previewItem.title}</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: '#374151', lineHeight: 1.65 }}>
              {previewItem.description}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => setPreviewItem(null)}>
                关闭
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={enrollingId === previewItem.market_id}
                onClick={() => handleEnroll(previewItem.market_id)}
              >
                {enrollingId === previewItem.market_id ? '加入中…' : '加入并进入课程空间'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
