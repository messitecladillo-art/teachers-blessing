import React, { useEffect, useMemo, useState } from 'react';
import { apiJson, handleSafeDownload, resolveApiUrl } from '../services/api';
import { CalendarTaskItem, LearnerWeakTopic, StudyPlanRecord } from '../types';
import { HkIcon } from '../components/HkAssets';

interface HkLearningFeedViewProps {
  onStartRemediationExam: (examId: string) => void;
}

const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

function formatIsoDate(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const HkLearningFeedView: React.FC<HkLearningFeedViewProps> = ({ onStartRemediationExam }) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [taskTab, setTaskTab] = useState<'confirmed' | 'pending'>('confirmed');

  const [calendarTasks, setCalendarTasks] = useState<CalendarTaskItem[]>([]);
  const [plans, setPlans] = useState<StudyPlanRecord[]>([]);
  const [weakTopics, setWeakTopics] = useState<LearnerWeakTopic[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMinutes, setNewTaskMinutes] = useState(30);
  const [addingTask, setAddingTask] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planTopic, setPlanTopic] = useState('导数单调性与含参极值');

  const loadFeed = async () => {
    try {
      const [tRes, pRes, mRes] = await Promise.all([
        apiJson<{ tasks: CalendarTaskItem[] }>('/api/tutor/calendar-tasks'),
        apiJson<{ plans: StudyPlanRecord[] }>('/api/tutor/study-plans'),
        apiJson<{ weak_topics: LearnerWeakTopic[] }>('/api/agent/memory'),
      ]);
      setCalendarTasks(tRes.tasks || []);
      setPlans(pRes.plans || []);
      setWeakTopics(mRes.weak_topics || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const selectedIso = formatIsoDate(viewYear, viewMonth, selectedDay);

  const handleAddTask = async () => {
    const titleVal = newTaskTitle.trim();
    if (!titleVal || addingTask) return;
    setAddingTask(true);
    try {
      const res = await apiJson<{ task: CalendarTaskItem }>('/api/tutor/calendar-tasks', {
        method: 'POST',
        body: JSON.stringify({
          date_str: selectedIso,
          title: titleVal,
          minutes: newTaskMinutes,
        }),
      });
      if (res.task) {
        setCalendarTasks((prev) => [...prev, res.task]);
        setNewTaskTitle('');
      }
    } finally {
      setAddingTask(false);
    }
  };

  const toggleTaskDone = async (task: CalendarTaskItem) => {
    const nextDone = !task.completed;
    setCalendarTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: nextDone } : t)));
    try {
      const res = await apiJson<{ task: CalendarTaskItem }>(`/api/tutor/calendar-tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: nextDone }),
      });
      if (res.task) {
        setCalendarTasks((prev) => prev.map((t) => (t.id === task.id ? res.task : t)));
      }
    } catch {
      setCalendarTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)));
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await apiJson(`/api/tutor/calendar-tasks/${taskId}`, { method: 'DELETE' });
      setCalendarTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      /* ignore */
    }
  };

  const handleGeneratePlan = async () => {
    setCreatingPlan(true);
    try {
      const topics = weakTopics.length
        ? weakTopics.slice(0, 3).map((w) => w.topic_tag)
        : [planTopic.trim() || '核心专题强化'];
      await apiJson('/api/tutor/study-plans', {
        method: 'POST',
        body: JSON.stringify({
          title: `${planTopic.trim() || '阶段复习'} · 7日计划`,
          goal: `系统巩固${topics.join('、')}`,
          weak_topics: topics,
          daily_minutes: 35,
        }),
      });
      await loadFeed();
    } finally {
      setCreatingPlan(false);
    }
  };

  const handleQuickRemediation = async () => {
    try {
      const res = await apiJson<{ exam_record: { id: string } }>('/api/agent/memory/remediation-quiz', {
        method: 'POST',
        body: JSON.stringify({ topics: weakTopics.slice(0, 3).map((w) => w.topic_tag), count: 4 }),
      });
      if (res.exam_record?.id) onStartRemediationExam(res.exam_record.id);
    } catch {
      /* ignore */
    }
  };

  const activePlan = plans[0] || null;

  const tasksByDate = useMemo(() => {
    const map: Record<string, CalendarTaskItem[]> = {};
    for (const tk of calendarTasks) {
      map[tk.date_str] = map[tk.date_str] || [];
      map[tk.date_str].push(tk);
    }
    return map;
  }, [calendarTasks]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const cells: { day: number; inMonth: boolean; isToday: boolean }[] = [];

    for (let i = firstWeekday - 1; i >= 0; i--) {
      cells.push({ day: prevMonthDays - i, inMonth: false, isToday: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday =
        viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
      cells.push({ day: d, inMonth: true, isToday });
    }
    const rem = 35 - cells.length > 0 ? 35 - cells.length : 42 - cells.length;
    for (let i = 1; i <= rem; i++) {
      cells.push({ day: i, inMonth: false, isToday: false });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const selectedDayTasks = tasksByDate[selectedIso] || [];
  const completedTasks = calendarTasks.filter((t) => t.completed);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <div className="hk-page-wrap">
      <div className="hk-calendar-shell">
        {/* LEFT COLUMN (268px): Today Card + Todo + Completed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="paper-folio" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#6b7280' }}>
                <HkIcon name="calendar" size={16} />
                <span>日历</span>
              </span>
              <span className="badge badge-info">{selectedIso === formatIsoDate(today.getFullYear(), today.getMonth(), today.getDate()) ? '今天' : selectedIso}</span>
            </div>
            <div className="mono-num" style={{ fontSize: 40, fontWeight: 800, color: '#181a1f', lineHeight: 1.1 }}>
              {selectedDay}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              周{WEEKDAYS_SHORT[new Date(viewYear, viewMonth, selectedDay).getDay()]}，{viewMonth + 1}月 {selectedDay}日
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="badge badge-neutral">{weakTopics.length} 项待复习</span>
              <span className="badge badge-neutral">{selectedDayTasks.length} 个计划任务</span>
            </div>
          </div>

          <div className="paper-folio" style={{ padding: '16px 18px', minHeight: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>当日待办</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                className="input"
                style={{ flex: 1, height: 32, fontSize: 12.5, padding: '0 10px' }}
                placeholder="新增当日待办任务..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTask();
                }}
              />
              <select
                className="select"
                style={{ width: 66, height: 32, fontSize: 11.5, padding: '0 4px' }}
                value={newTaskMinutes}
                onChange={(e) => setNewTaskMinutes(Number(e.target.value))}
                aria-label="任务时长"
              >
                <option value={15}>15分</option>
                <option value={30}>30分</option>
                <option value={45}>45分</option>
                <option value={60}>60分</option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ height: 32, padding: '0 10px', whiteSpace: 'nowrap' }}
                disabled={!newTaskTitle.trim() || addingTask}
                onClick={handleAddTask}
              >
                + 添加
              </button>
            </div>

            {selectedDayTasks.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 12.5, padding: '18px 0', textAlign: 'center' }}>
                当天暂无任务，可上方直接添加或点击右侧生成 7 日计划
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedDayTasks.map((tk) => (
                  <div
                    key={tk.id}
                    style={{
                      border: '1px solid #eef0f3',
                      borderRadius: 10,
                      padding: '8px 10px',
                      background: tk.completed ? '#f8f9fb' : '#ffffff',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleTaskDone(tk)}
                      style={{
                        flex: 1,
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                        textDecoration: tk.completed ? 'line-through' : 'none',
                        color: tk.completed ? '#9ca3af' : '#181a1f',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {tk.completed ? '☑ ' : '☐ '}
                        {tk.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                        {tk.course_title ? `${tk.course_title} · ` : ''}约 {tk.minutes} 分钟
                      </div>
                    </button>
                    <button
                      type="button"
                      title="删除待办"
                      aria-label="删除待办"
                      onClick={() => handleDeleteTask(tk.id)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1,
                        padding: '2px 4px',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="paper-folio" style={{ padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 8 }}>已完成 ({completedTasks.length})</div>
            {completedTasks.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 12.5, textAlign: 'center', padding: '10px 0' }}>
                完成的任务会显示在这里
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 12.5, color: '#166534', fontWeight: 600 }}>
                  累计完成 {completedTasks.length} 项学习目标
                </div>
                {completedTasks.slice(0, 3).map((ct) => (
                  <div key={ct.id} style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ✓ {ct.date_str.slice(5)} {ct.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Monthly Calendar Grid & Controls */}
        <div className="paper-folio" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${taskTab === 'confirmed' ? 'btn-primary' : 'btn-surface'}`}
                onClick={() => setTaskTab('confirmed')}
              >
                已确认任务
              </button>
              <button
                type="button"
                className={`btn btn-sm ${taskTab === 'pending' ? 'btn-primary' : 'btn-surface'}`}
                onClick={() => setTaskTab('pending')}
              >
                待复习薄弱点 ({weakTopics.length})
              </button>
              {(activePlan?.ics_artifact_id || activePlan?.ics_artifact?.id) && (
                <a
                  href={resolveApiUrl(`/api/artifacts/${activePlan.ics_artifact_id || activePlan.ics_artifact?.id}/download`)}
                  onClick={(e) =>
                    handleSafeDownload(
                      e,
                      `/api/artifacts/${activePlan.ics_artifact_id || activePlan.ics_artifact?.id}/download`,
                      `${activePlan.title || '学习日程'}.ics`
                    )
                  }
                  className="btn btn-surface btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  导出日历 .ics
                </a>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="hk-circle-btn" style={{ width: 30, height: 30 }} onClick={prevMonth} aria-label="上个月">
                ‹
              </button>
              <span style={{ fontWeight: 700, fontSize: 16, minWidth: 96, textAlign: 'center' }}>
                {MONTHS_ZH[viewMonth]} {viewYear}
              </span>
              <button type="button" className="hk-circle-btn" style={{ width: 30, height: 30 }} onClick={nextMonth} aria-label="下个月">
                ›
              </button>
            </div>
          </div>

          {/* Quick 7-day generator bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 220px', borderRadius: 999, height: 36 }}
              placeholder="输入想安排 7 日学习计划的专题..."
              value={planTopic}
              onChange={(e) => setPlanTopic(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={creatingPlan} onClick={handleGeneratePlan}>
              {creatingPlan ? '生成中…' : '+ 生成7日学习计划'}
            </button>
            {weakTopics.length > 0 && (
              <button type="button" className="btn btn-surface btn-sm" onClick={handleQuickRemediation}>
                薄弱点立刻强化测验
              </button>
            )}
          </div>

          {taskTab === 'pending' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {weakTopics.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                  当前无到期薄弱知识点。
                </div>
              ) : (
                weakTopics.map((w) => (
                  <div key={w.id} className="card-compact" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{w.topic_tag}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {w.subject} · 掌握度 {Math.round(w.mastery_score)}%
                        {w.mistake_patterns[0] ? ` · ${w.mistake_patterns[0]}` : ''}
                      </div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleQuickRemediation}>
                      安排专项练习
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="hk-cal-grid-7" style={{ marginBottom: 6 }}>
                {WEEKDAYS_SHORT.map((wd) => (
                  <div key={wd} style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', fontWeight: 600, paddingBottom: 4 }}>
                    {wd}
                  </div>
                ))}
              </div>
              <div className="hk-cal-grid-7">
                {calendarCells.map((cell, idx) => {
                  const cellIso = formatIsoDate(viewYear, viewMonth, cell.day);
                  const dayTasks = cell.inMonth ? tasksByDate[cellIso] || [] : [];
                  const selected = cell.inMonth && cell.day === selectedDay;
                  return (
                    <div
                      key={idx}
                      className={`hk-cal-cell ${!cell.inMonth ? 'muted' : ''} ${cell.isToday ? 'today' : ''}`}
                      style={{ background: selected ? '#f4f7fd' : undefined }}
                      onClick={() => cell.inMonth && setSelectedDay(cell.day)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <span
                          className="mono-num"
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: cell.isToday ? 700 : 600,
                            background: cell.isToday ? '#3b4f7d' : 'transparent',
                            color: cell.isToday ? '#ffffff' : undefined,
                          }}
                        >
                          {cell.day}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {dayTasks.slice(0, 2).map((tk) => (
                          <div
                            key={tk.id}
                            style={{
                              fontSize: 10.5,
                              padding: '2px 5px',
                              borderRadius: 5,
                              background: tk.completed ? '#ecfdf5' : '#e8eef9',
                              color: tk.completed ? '#166534' : '#2c4370',
                              textDecoration: tk.completed ? 'line-through' : 'none',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontWeight: 600,
                            }}
                          >
                            {tk.completed ? '✓ ' : ''}
                            {tk.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
