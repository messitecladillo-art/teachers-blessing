import React, { useMemo, useState } from 'react';
import { apiJson } from '../services/api';
import { CourseRecord, WeeklyTracker } from '../types';
import { HkIcon } from '../components/HkAssets';

interface HkMyCoursesViewProps {
  courses: CourseRecord[];
  weeklyTracker: WeeklyTracker | null;
  onOpenCourseSpace: (courseId: string) => void;
  onOpenWhiteboard: (courseId: string, lectureId: string) => void;
  onOpenCheatsheet: (courseId: string) => void;
  onOpenMarketplace: () => void;
  onGoCreateCourse: () => void;
  onCourseDeleted?: (courseId: string) => void;
}

function formatDateZh(ts: number): string {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '近期添加';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export const HkMyCoursesView: React.FC<HkMyCoursesViewProps> = ({
  courses,
  weeklyTracker,
  onOpenCourseSpace,
  onOpenWhiteboard,
  onOpenCheatsheet,
  onOpenMarketplace,
  onGoCreateCourse,
  onCourseDeleted,
}) => {
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleConfirmDelete = async (courseId: string) => {
    setDeletingId(courseId);
    try {
      await apiJson(`/api/courses/${courseId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      setMenuId(null);
      onCourseDeleted?.(courseId);
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const visibleCourses = useMemo(() => {
    const qLow = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (filter === 'in_progress' && c.status !== 'in_progress') return false;
      if (filter === 'completed' && c.status !== 'completed') return false;
      if (qLow) {
        const hay = `${c.title} ${c.subject} ${c.curator} ${c.description}`.toLowerCase();
        if (!hay.includes(qLow)) return false;
      }
      return true;
    });
  }, [courses, filter, query]);

  return (
    <div className="hk-page-wrap">
      <h1 style={{ margin: '6px 0 18px', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>我的课程</h1>

      {/* Filter Pills + Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={`hk-chip-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={`hk-chip-btn ${filter === 'in_progress' ? 'active' : ''}`}
            onClick={() => setFilter('in_progress')}
          >
            进行中
          </button>
          <button
            type="button"
            className={`hk-chip-btn ${filter === 'completed' ? 'active' : ''}`}
            onClick={() => setFilter('completed')}
          >
            已完成
          </button>
        </div>

        <div style={{ position: 'relative', minWidth: 250, flex: '0 1 320px' }}>
          <input
            className="input"
            style={{ borderRadius: 999, paddingLeft: 16, height: 38, background: '#ffffff' }}
            placeholder="搜索课程..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 2-Column Perforated Ticket Cards + Weekly Card */}
      <div className="hk-courses-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {visibleCourses.length === 0 ? (
            <div className="paper-folio" style={{ textAlign: 'center', padding: '42px 24px' }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>暂无匹配课程</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>可以从课程集市加入精品专题，或在首页输入目标创建新课程</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                <button type="button" className="btn btn-primary" onClick={onGoCreateCourse}>
                  前往打造课程
                </button>
                <button type="button" className="btn btn-surface" onClick={onOpenMarketplace}>
                  浏览课程集市
                </button>
              </div>
            </div>
          ) : (
            visibleCourses.map((c) => {
              const targetLectureId = c.next_lecture?.id || c.last_lecture_id || c.units?.[0]?.lectures?.[0]?.id || '';
              return (
                <div key={c.id} className="hk-ticket-card">
                  {/* Left main ticket body -> Course Space */}
                  <div className="hk-ticket-main" onClick={() => onOpenCourseSpace(c.id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 4 }}>课程名称</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#181a1f', lineHeight: 1.3 }}>{c.title}</div>
                      </div>
                      <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="hk-circle-btn"
                          style={{ width: 28, height: 28, fontSize: 13 }}
                          aria-label="更多操作"
                          onClick={() => setMenuId((id) => (id === c.id ? null : c.id))}
                        >
                          ···
                        </button>
                        {menuId === c.id && (
                          <div className="hk-popover-menu right" style={{ minWidth: 168 }}>
                            <button
                              type="button"
                              className="hk-popover-row"
                              onClick={() => {
                                setMenuId(null);
                                onOpenCourseSpace(c.id);
                              }}
                            >
                              <span>进入课程空间</span>
                            </button>
                            <button
                              type="button"
                              className="hk-popover-row"
                              onClick={() => {
                                setMenuId(null);
                                onOpenCheatsheet(c.id);
                              }}
                            >
                              <span>打开本课速查表</span>
                            </button>
                            <a
                              className="hk-popover-row"
                              href={`/api/courses/${c.id}/export-zip`}
                              style={{ textDecoration: 'none', color: 'inherit' }}
                              onClick={() => setMenuId(null)}
                            >
                              <span>打包导出整课</span>
                            </a>
                            {confirmDeleteId === c.id ? (
                              <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderTop: '1px solid #eef0f3' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  style={{ background: '#dc2626', color: '#fff', flex: 1, fontSize: 11.5 }}
                                  disabled={deletingId === c.id}
                                  onClick={() => handleConfirmDelete(c.id)}
                                >
                                  {deletingId === c.id ? '删除中…' : '确认删除'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ fontSize: 11.5 }}
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="hk-popover-row"
                                style={{ color: '#b91c1c', borderTop: '1px solid #eef0f3' }}
                                onClick={() => setConfirmDeleteId(c.id)}
                              >
                                <span>删除课程</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12.5 }}>
                      <div>
                        <div style={{ color: '#9ca3af', fontSize: 11.5 }}>来源</div>
                        <div style={{ color: '#374151', fontWeight: 600, marginTop: 2 }}>{c.curator}</div>
                      </div>
                      <div>
                        <div style={{ color: '#9ca3af', fontSize: 11.5 }}>添加日期</div>
                        <div style={{ color: '#374151', fontWeight: 600, marginTop: 2 }}>{formatDateZh(c.created_at)}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 6, background: '#eef0f3', borderRadius: 999, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${c.progress_pct}%`,
                            height: '100%',
                            background: c.progress_pct >= 95 ? '#16a34a' : '#3b4f7d',
                            borderRadius: 999,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <span className="mono-num" style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
                        {c.progress_pct}%
                      </span>
                    </div>
                  </div>

                  {/* Right perforated ticket stub -> Direct to Whiteboard */}
                  <div
                    className="hk-ticket-stub"
                    onClick={() => {
                      if (targetLectureId) onOpenWhiteboard(c.id, targetLectureId);
                      else onOpenCourseSpace(c.id);
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 6 }}>接下来</div>
                      <span className="hk-badge-lecture">
                        {c.next_lecture?.kind === 'quiz' ? '测验' : '讲座'}
                      </span>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#181a1f', marginTop: 8, lineHeight: 1.4 }}>
                        {c.next_lecture?.title || '进入课程大纲'}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#3b4f7d', fontWeight: 600 }}>进入白板课堂 →</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Side Panel: Weekly Study Card + Marketplace Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="paper-folio" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: '#6b7280', fontWeight: 600 }}>本周</span>
              <HkIcon name="calendar" size={16} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#181a1f' }}>
              已学 {weeklyTracker?.total_sessions ?? 0} 个学习单元
            </div>
            <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
              完成白板课堂或随堂测验即可累计本周学习节次。
            </div>

            <div className="hk-week-tiles">
              {(weeklyTracker?.days || [
                { label: '一', date: '1', count: 0, is_today: false },
                { label: '二', date: '2', count: 0, is_today: false },
                { label: '三', date: '3', count: 0, is_today: false },
                { label: '四', date: '4', count: 0, is_today: false },
                { label: '五', date: '5', count: 0, is_today: false },
                { label: '六', date: '6', count: 0, is_today: false },
                { label: '日', date: '7', count: 0, is_today: false },
              ]).map((d) => (
                <div
                  key={d.date}
                  className={`hk-week-tile ${d.count > 0 ? 'has-activity' : ''} ${d.is_today ? 'today' : ''}`}
                >
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div className="mono-num" style={{ marginTop: 3 }}>
                    {d.count > 0 ? d.count : '—'}
                  </div>
                </div>
              ))}
            </div>

            {weeklyTracker?.continue_learning && (
              <div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>从上次学到的地方继续</div>
                <button
                  type="button"
                  className="hk-continue-card"
                  onClick={() =>
                    onOpenWhiteboard(
                      weeklyTracker.continue_learning!.course_id,
                      weeklyTracker.continue_learning!.lecture_id
                    )
                  }
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#181a1f' }}>
                    {weeklyTracker.continue_learning.course_title}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
                    下一讲：{weeklyTracker.continue_learning.lecture_title}
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="paper-folio"
            style={{ padding: '18px 20px', textAlign: 'left', cursor: 'pointer', width: '100%' }}
            onClick={onOpenMarketplace}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#181a1f' }}>课程集市</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3b4f7d' }}>查看更多 ↗</span>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
              浏览知学教研组整理的各学科示范专题，一键加入我的课程。
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
