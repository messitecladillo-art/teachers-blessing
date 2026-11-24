import React, { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../services/api';
import { AgentThread, AnalyticsReport, CourseRecord, ErrorBookEntry, ExamRecord, HkRoute, LessonRecord, PptDeck } from '../types';
import { MathText } from '../components/MathText';

interface HkHistoryViewProps {
  threads: AgentThread[];
  courses: CourseRecord[];
  onNewChat: () => void;
  onOpenThread: (tid: string) => void;
  onOpenCourseWhiteboard: (courseId: string, lectureId: string) => void;
  onOpenSpecialist: (route: HkRoute, itemId?: string) => void;
}

export const HkHistoryView: React.FC<HkHistoryViewProps> = ({
  threads,
  courses,
  onNewChat,
  onOpenThread,
  onOpenCourseWhiteboard,
  onOpenSpecialist,
}) => {
  const [subTab, setSubTab] = useState<'chat' | 'courses' | 'teach' | 'exams'>('chat');
  const [q, setQ] = useState('');
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [decks, setDecks] = useState<PptDeck[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [errors, setErrors] = useState<ErrorBookEntry[]>([]);
  const [reports, setReports] = useState<AnalyticsReport[]>([]);

  useEffect(() => {
    Promise.all([
      apiJson<{ lessons: LessonRecord[] }>('/api/lesson/list'),
      apiJson<{ decks: PptDeck[] }>('/api/ppt/decks'),
      apiJson<{ exams: ExamRecord[] }>('/api/exam/list'),
      apiJson<{ items: ErrorBookEntry[] }>('/api/tutor/error-book'),
      apiJson<{ reports: AnalyticsReport[] }>('/api/analytics/reports'),
    ])
      .then(([l, p, e, err, r]) => {
        setLessons(l.lessons || []);
        setDecks(p.decks || []);
        setExams(e.exams || []);
        setErrors(err.items || []);
        setReports(r.reports || []);
      })
      .catch(() => {});
  }, []);

  const qLow = q.trim().toLowerCase();

  const filteredThreads = useMemo(
    () => threads.filter((t) => !qLow || t.title.toLowerCase().includes(qLow)),
    [threads, qLow]
  );
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (c) => !qLow || c.title.toLowerCase().includes(qLow) || c.subject.toLowerCase().includes(qLow)
      ),
    [courses, qLow]
  );
  const filteredDecks = useMemo(
    () =>
      decks.filter(
        (d) => !qLow || d.title.toLowerCase().includes(qLow) || d.subject.toLowerCase().includes(qLow)
      ),
    [decks, qLow]
  );
  const filteredLessons = useMemo(
    () =>
      lessons.filter(
        (l) => !qLow || l.title.toLowerCase().includes(qLow) || l.subject.toLowerCase().includes(qLow)
      ),
    [lessons, qLow]
  );
  const filteredExams = useMemo(
    () =>
      exams.filter(
        (ex) => !qLow || ex.title.toLowerCase().includes(qLow) || ex.subject.toLowerCase().includes(qLow)
      ),
    [exams, qLow]
  );
  const filteredReports = useMemo(
    () =>
      reports.filter(
        (rp) =>
          !qLow ||
          rp.title.toLowerCase().includes(qLow) ||
          (rp.dataset_name || '').toLowerCase().includes(qLow)
      ),
    [reports, qLow]
  );
  const filteredErrors = useMemo(
    () =>
      errors.filter(
        (er) =>
          !qLow ||
          er.topic_tag.toLowerCase().includes(qLow) ||
          er.question_text.toLowerCase().includes(qLow) ||
          er.subject.toLowerCase().includes(qLow) ||
          (er.my_mistake || '').toLowerCase().includes(qLow)
      ),
    [errors, qLow]
  );

  const renderEmptyState = (emptyTitle: string) => (
    <div
      style={{
        border: '1.5px dashed #e2e6ee',
        borderRadius: 16,
        padding: '44px 24px',
        textAlign: 'center',
        color: '#6b7280',
        background: '#ffffff',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        {qLow ? `未找到与「${q.trim()}」匹配的记录` : emptyTitle}
      </div>
      <div style={{ fontSize: 12.5, color: '#9ca3af', marginBottom: qLow ? 14 : 0 }}>
        {qLow ? '请尝试更换搜索词或清空筛选条件' : '发起新的会话、课程或练习后将自动归档在此'}
      </div>
      {qLow && (
        <button type="button" className="btn btn-surface btn-sm" onClick={() => setQ('')}>
          清空搜索词
        </button>
      )}
    </div>
  );

  return (
    <div className="hk-page-wrap">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>历史</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            className="input"
            style={{ width: 240, borderRadius: 999, height: 38 }}
            placeholder="搜索对话或记录..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="hk-pill-control" onClick={onNewChat}>
            <span>+</span>
            <span>新建对话</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button type="button" className={`hk-chip-btn ${subTab === 'chat' ? 'active' : ''}`} onClick={() => setSubTab('chat')}>
          对话 ({filteredThreads.length})
        </button>
        <button type="button" className={`hk-chip-btn ${subTab === 'courses' ? 'active' : ''}`} onClick={() => setSubTab('courses')}>
          白板课堂 ({filteredCourses.length})
        </button>
        <button type="button" className={`hk-chip-btn ${subTab === 'teach' ? 'active' : ''}`} onClick={() => setSubTab('teach')}>
          教案与课件 ({filteredLessons.length + filteredDecks.length})
        </button>
        <button type="button" className={`hk-chip-btn ${subTab === 'exams' ? 'active' : ''}`} onClick={() => setSubTab('exams')}>
          试卷与学情 ({filteredExams.length + filteredErrors.length + filteredReports.length})
        </button>
      </div>

      {subTab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredThreads.map((t) => (
            <button
              key={t.id}
              type="button"
              className="paper-folio"
              style={{ padding: '16px 20px', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => onOpenThread(t.id)}
            >
              <div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: '#181a1f' }}>{t.title}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
                  状态：{t.status === 'completed' ? '已完成' : '可继续追问'}
                </div>
              </div>
              <span className="btn btn-surface btn-sm">打开会话 →</span>
            </button>
          ))}
          {filteredThreads.length === 0 && renderEmptyState('暂无历史对话记录')}
        </div>
      )}

      {subTab === 'courses' &&
        (filteredCourses.length === 0 ? (
          renderEmptyState('暂无白板课堂学习记录')
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {filteredCourses.map((c) => {
              const lid = c.last_lecture_id || c.units?.[0]?.lectures?.[0]?.id || '';
              return (
                <div key={c.id} className="paper-folio" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#3b4f7d', fontWeight: 600 }}>{c.subject}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{c.title}</div>
                  <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6 }}>进度 {c.progress_pct}%</div>
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => lid && onOpenCourseWhiteboard(c.id, lid)}
                    >
                      恢复白板课堂
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {subTab === 'teach' &&
        (filteredDecks.length + filteredLessons.length === 0 ? (
          renderEmptyState('暂无教案与演示课件记录')
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {filteredDecks.map((d) => (
              <div key={d.id} className="paper-folio" style={{ padding: 16 }}>
                <span className="badge badge-info">演示课件 · {d.slides.length} 页</span>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8 }}>{d.title}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>{d.subject} · {d.grade_level}</div>
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => onOpenSpecialist('tool_ppt', d.id)}>
                  打开课件编辑器
                </button>
              </div>
            ))}
            {filteredLessons.map((l) => (
              <div key={l.id} className="paper-folio" style={{ padding: 16 }}>
                <span className="badge badge-verified">教学教案 · {l.lesson_type}</span>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8 }}>{l.title}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>{l.subject} · {l.grade_level}</div>
                <button type="button" className="btn btn-surface btn-sm" style={{ marginTop: 12 }} onClick={() => onOpenSpecialist('tool_lesson', l.id)}>
                  打开教案编辑器
                </button>
              </div>
            ))}
          </div>
        ))}

      {subTab === 'exams' &&
        (filteredExams.length + filteredReports.length + filteredErrors.length === 0 ? (
          renderEmptyState('暂无试卷、错题与学情诊断记录')
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {filteredExams.map((ex) => (
              <div key={ex.id} className="paper-folio" style={{ padding: 16 }}>
                <span className="badge badge-info">试卷 · {ex.exam.questions.length} 题</span>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8 }}>{ex.title}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>{ex.subject} · 满分 {ex.exam.total_score} 分</div>
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => onOpenSpecialist('tool_exam', ex.id)}>
                  开始在线作答
                </button>
              </div>
            ))}
            {filteredReports.map((rp) => (
              <div key={rp.id} className="paper-folio" style={{ padding: 16 }}>
                <span className="badge badge-verified">学情脱敏报告</span>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8 }}>{rp.title}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>
                  样本 {rp.stats.student_count} 人 · 均分 {rp.stats.summary.mean}
                </div>
                <button type="button" className="btn btn-surface btn-sm" style={{ marginTop: 12 }} onClick={() => onOpenSpecialist('tool_analytics', rp.id)}>
                  查看学情看板
                </button>
              </div>
            ))}
            {filteredErrors.map((er) => (
              <div key={er.id} className="paper-folio" style={{ padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <span className="badge badge-warn">错题本 · 熟练度 Lv.{er.mastery_level}</span>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8, color: '#181a1f' }}>{er.topic_tag}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                    {er.subject} · {er.grade_level}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: '#374151',
                      marginTop: 6,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    <MathText text={er.question_text} inline />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => onOpenSpecialist('tool_tutor', er.id)}>
                    打开错题本复盘
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
};
