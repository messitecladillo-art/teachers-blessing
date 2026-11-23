import React, { useRef, useState } from 'react';
import { apiJson, uploadSourceFile } from '../services/api';
import { CourseLecture, CourseRecord, LectureMastery, SourceDocMeta } from '../types';
import { HkIcon, HkUploadBadge } from '../components/HkAssets';
import { MathText } from '../components/MathText';

interface HkCourseSpaceViewProps {
  course: CourseRecord;
  materials: SourceDocMeta[];
  onBack: () => void;
  onCourseUpdated: (c: CourseRecord) => void;
  onOpenWhiteboard: (lectureId: string) => void;
  onOpenCheatsheet: () => void;
  onOpenCalendar: () => void;
  onAskInstantHelp: (prompt: string) => void;
  onOpenLinkedTool: (kind: 'lesson' | 'ppt' | 'exam' | 'mindmap', id: string) => void;
}

const MASTERY_CYCLE: LectureMastery[] = ['unstarted', 'attempted', 'familiar', 'proficient', 'mastered'];
const MASTERY_LABEL: Record<LectureMastery, string> = {
  unstarted: '未开始',
  attempted: '已尝试',
  familiar: '熟悉',
  proficient: '熟练',
  mastered: '已掌握',
};

export const HkCourseSpaceView: React.FC<HkCourseSpaceViewProps> = ({
  course,
  materials,
  onBack,
  onCourseUpdated,
  onOpenWhiteboard,
  onOpenCheatsheet,
  onOpenCalendar,
  onAskInstantHelp,
  onOpenLinkedTool,
}) => {
  const [leftTab, setLeftTab] = useState<'units' | 'materials' | 'practice'>('units');
  const [activeUnitIdx, setActiveUnitIdx] = useState<number>(course.units?.[0]?.unit_index || 1);
  const [descExpanded, setDescExpanded] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editTitle, setEditTitle] = useState(course.title);
  const [editDesc, setEditDesc] = useState(course.description);

  const [expandNote, setExpandNote] = useState('');
  const [expanding, setExpanding] = useState(false);
  const [generatingCompanion, setGeneratingCompanion] = useState<'lesson' | 'ppt' | 'exam' | null>(null);
  const [notice, setNotice] = useState('');

  // Quick lecture quiz drawer/modal state
  const [quizLecture, setQuizLecture] = useState<CourseLecture | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const allLectures = course.units.flatMap((u) => u.lectures.map((l) => ({ unit: u.unit_index, lecture: l })));
  const nextStepTarget =
    allLectures.find((x) => x.lecture.id === course.next_lecture?.id) || allLectures[0] || null;

  const activeUnit = course.units.find((u) => u.unit_index === activeUnitIdx) || course.units[0];

  const handleCycleMastery = async (lec: CourseLecture) => {
    const idx = MASTERY_CYCLE.indexOf(lec.mastery);
    const nextM = MASTERY_CYCLE[(idx + 1) % MASTERY_CYCLE.length];
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ lecture_id: lec.id, mastery: nextM }),
      });
      if (res.course) onCourseUpdated(res.course);
    } catch {
      /* ignore */
    }
  };

  const handleUploadExpand = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setExpanding(true);
    setNotice('');
    try {
      const up = await uploadSourceFile(f);
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/expand`, {
        method: 'POST',
        body: JSON.stringify({ source_id: up.source_id, note: up.filename }),
      });
      if (res.course) {
        onCourseUpdated(res.course);
        setActiveUnitIdx(res.course.units[res.course.units.length - 1]?.unit_index || 1);
        setNotice(`已按《${up.filename}》自动扩充新单元讲次`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '扩充失败');
    } finally {
      setExpanding(false);
    }
  };

  const handleNoteExpand = async () => {
    if (!expandNote.trim() || expanding) return;
    setExpanding(true);
    setNotice('');
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/expand`, {
        method: 'POST',
        body: JSON.stringify({ note: expandNote.trim() }),
      });
      if (res.course) {
        onCourseUpdated(res.course);
        setExpandNote('');
        setActiveUnitIdx(res.course.units[res.course.units.length - 1]?.unit_index || 1);
        setNotice('已补充新讲次至课程路线');
      }
    } catch {
      setNotice('补充章节失败');
    } finally {
      setExpanding(false);
    }
  };

  const handleSaveMeta = async () => {
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle, description: editDesc }),
      });
      if (res.course) onCourseUpdated(res.course);
      setEditingMeta(false);
    } catch {
      /* ignore */
    }
  };

  const handleGenerateCompanion = async (kind: 'lesson' | 'ppt' | 'exam') => {
    if (generatingCompanion) return;
    setGeneratingCompanion(kind);
    setNotice('');
    try {
      const res = await apiJson<{ course: CourseRecord; linked_item?: { title?: string } }>(
        `/api/courses/${course.id}/generate-companion`,
        {
          method: 'POST',
          body: JSON.stringify({ kind }),
        }
      );
      if (res.course) {
        onCourseUpdated(res.course);
        const label = kind === 'lesson' ? '配套教学教案' : kind === 'ppt' ? '同步演示课件' : '配套随堂测验卷';
        setNotice(`已生成${label}${res.linked_item?.title ? `《${res.linked_item.title}》` : ''}`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '配套资源生成失败');
    } finally {
      setGeneratingCompanion(null);
    }
  };

  const handleOpenQuiz = (lec: CourseLecture) => {
    if (lec.kind === 'quiz' && course.linked_ids?.exam_id) {
      onOpenLinkedTool('exam', course.linked_ids.exam_id);
      return;
    }
    setQuizLecture(lec);
    setQuizAnswers({});
    setQuizSubmitted(false);
  };

  const handleSubmitQuickQuiz = async () => {
    setQuizSubmitted(true);
    if (!quizLecture) return;
    const items = quizLecture.quiz_items || [];
    const correctCount = items.filter((it) => quizAnswers[it.id] === it.answer).length;
    const nextMastery: LectureMastery = correctCount === items.length && items.length > 0 ? 'mastered' : 'familiar';
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ lecture_id: quizLecture.id, mastery: nextMastery }),
      });
      if (res.course) onCourseUpdated(res.course);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="hk-course-space">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.pptx,.md,.txt,.tex,.zip"
        style={{ display: 'none' }}
        onChange={handleUploadExpand}
      />

      {/* LEFT PANEL (300px) */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <button type="button" className="hk-pill-control" onClick={onBack}>
            <span>×</span>
            <span>退出课程</span>
          </button>
        </div>

        {/* Cover Card + 4 Floating Circular Actions */}
        <div className="hk-course-cover-wrap">
          <img src={course.cover_image} alt={course.title} />
          <div className="hk-cover-actions">
            <button
              type="button"
              className="hk-cover-fab"
              title="编辑课程信息"
              aria-label="编辑课程信息"
              onClick={() => {
                setEditTitle(course.title);
                setEditDesc(course.description);
                setEditingMeta((v) => !v);
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="hk-cover-fab"
              title="打开多栏速查表"
              aria-label="打开多栏速查表"
              onClick={onOpenCheatsheet}
            >
              <HkIcon name="cheatsheet" size={16} />
            </button>
            <button
              type="button"
              className="hk-cover-fab"
              title="查看学习日历"
              aria-label="查看学习日历"
              onClick={onOpenCalendar}
            >
              <HkIcon name="calendar" size={16} />
            </button>
            <button
              type="button"
              className="hk-cover-fab"
              title="课程材料清单"
              aria-label="课程材料清单"
              onClick={() => setLeftTab('materials')}
            >
              <HkIcon name="kb" size={16} />
            </button>
            <a
              className="hk-cover-fab"
              title="打包导出整课"
              aria-label="打包导出整课"
              href={`/api/courses/${course.id}/export-zip`}
              style={{ textDecoration: 'none' }}
            >
              ⬇
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#6b7280' }}>
          <HkIcon name="courses" size={15} />
          <span>策划自 {course.curator}</span>
        </div>

        {editingMeta ? (
          <div className="card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <textarea className="textarea" rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveMeta}>
                保存
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingMeta(false)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, lineHeight: 1.3 }}>{course.title}</h1>
            <p
              style={{
                margin: '8px 0 4px',
                fontSize: 13,
                lineHeight: 1.55,
                color: '#6b7280',
                display: descExpanded ? 'block' : '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {course.description}
            </p>
            <button
              type="button"
              style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 12.5, color: '#3b4f7d', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => setDescExpanded((v) => !v)}
            >
              {descExpanded ? '收起简介' : '显示更多'}
            </button>
          </div>
        )}

        {/* Panel Switcher: 单元 | 资料 | 练习 */}
        <div style={{ borderTop: '1px solid #eef0f3', paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>面板</div>
          <div className="seg-switch" style={{ width: '100%' }}>
            <button
              type="button"
              className={`seg-switch-btn ${leftTab === 'units' ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setLeftTab('units')}
            >
              单元
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${leftTab === 'materials' ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setLeftTab('materials')}
            >
              资料
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${leftTab === 'practice' ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setLeftTab('practice')}
            >
              练习
            </button>
          </div>
        </div>

        {/* Left Panel Tab Body */}
        {leftTab === 'units' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {course.units.map((u) => (
              <button
                key={u.unit_index}
                type="button"
                className={`hk-unit-pill ${activeUnit?.unit_index === u.unit_index ? 'active' : ''}`}
                onClick={() => setActiveUnitIdx(u.unit_index)}
              >
                <span className="hk-unit-num">{u.unit_index}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.title}</span>
              </button>
            ))}
          </div>
        )}

        {leftTab === 'materials' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="hk-continue-card"
              onClick={onOpenCheatsheet}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                <HkIcon name="cheatsheet" size={16} />
                <span>本课高密度速查表</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>点击进入双栏重点汇总与打印页</div>
            </button>

            {course.linked_ids?.deck_id ? (
              <button
                type="button"
                className="hk-continue-card"
                onClick={() => onOpenLinkedTool('ppt', course.linked_ids.deck_id!)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>同步演示课件</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>打开原生可编辑幻灯片台</div>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-surface btn-sm"
                style={{ width: '100%' }}
                disabled={generatingCompanion !== null}
                onClick={() => handleGenerateCompanion('ppt')}
              >
                {generatingCompanion === 'ppt' ? '正在生成课件…' : '+ 一键生成演示课件'}
              </button>
            )}

            {course.linked_ids?.lesson_id ? (
              <button
                type="button"
                className="hk-continue-card"
                onClick={() => onOpenLinkedTool('lesson', course.linked_ids.lesson_id!)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>配套教学教案</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>查看教案文本并导出文档</div>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-surface btn-sm"
                style={{ width: '100%' }}
                disabled={generatingCompanion !== null}
                onClick={() => handleGenerateCompanion('lesson')}
              >
                {generatingCompanion === 'lesson' ? '正在生成教案…' : '+ 一键生成配套教案'}
              </button>
            )}

            {course.linked_ids?.mindmap_id && (
              <button
                type="button"
                className="hk-continue-card"
                onClick={() => onOpenLinkedTool('mindmap', course.linked_ids.mindmap_id!)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>知识结构思维导图</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>查看节点关系与跨学科关联</div>
              </button>
            )}

            {materials.map((doc) => (
              <div key={doc.id} className="card-compact" style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{doc.title}</div>
                <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                  已拆分 {doc.chunk_count} 个章节段落
                </div>
              </div>
            ))}

            {materials.length === 0 &&
              !course.linked_ids?.deck_id &&
              !course.linked_ids?.lesson_id && (
                <div style={{ fontSize: 12.5, color: '#6b7280', padding: '8px 4px' }}>
                  可以在右上方上传讲义文档，自动纳入本课程资料。
                </div>
              )}
          </div>
        )}

        {leftTab === 'practice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {course.linked_ids?.exam_id ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => onOpenLinkedTool('exam', course.linked_ids.exam_id!)}
              >
                开始整卷在线作答与自动批改
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ width: '100%' }}
                disabled={generatingCompanion !== null}
                onClick={() => handleGenerateCompanion('exam')}
              >
                {generatingCompanion === 'exam' ? '正在组卷…' : '+ 一键生成配套随堂卷'}
              </button>
            )}
            {allLectures
              .filter((x) => (x.lecture.quiz_items && x.lecture.quiz_items.length > 0) || x.lecture.kind === 'quiz')
              .map((x) => (
                <button
                  key={x.lecture.id}
                  type="button"
                  className="hk-continue-card"
                  onClick={() => handleOpenQuiz(x.lecture)}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{x.lecture.title}</div>
                  <div style={{ fontSize: 12, color: '#3b4f7d', marginTop: 3 }}>点击进行随堂小测 →</div>
                </button>
              ))}
          </div>
        )}
      </aside>

      {/* RIGHT MAIN WORKSPACE */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Upload Expand Drop Card */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e6e8ec',
            borderRadius: 18,
            padding: '14px 18px',
            boxShadow: 'var(--shadow-paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', flex: '1 1 260px' }}
            onClick={() => fileRef.current?.click()}
          >
            <HkUploadBadge size={52} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#181a1f' }}>上传材料，扩展这门课程</div>
              <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>
                点击上传讲义文档，或右侧输入想要补充的章节主题
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 240px' }}>
            <input
              className="input"
              style={{ borderRadius: 999, height: 36 }}
              placeholder="描述想新增的专题讲次..."
              value={expandNote}
              onChange={(e) => setExpandNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNoteExpand();
              }}
            />
            <button
              type="button"
              className="btn btn-surface btn-sm"
              disabled={expanding}
              onClick={() => (expandNote.trim() ? handleNoteExpand() : fileRef.current?.click())}
            >
              {expanding ? '处理中…' : expandNote.trim() ? '追加讲次' : '选文件'}
            </button>
          </div>
        </div>

        {notice && <div className="callout-verified" style={{ fontSize: 13 }}>{notice}</div>}

        {/* Mastery Legend + Horizontal Path + Next Step CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, fontSize: 12, color: '#6b7280' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="hk-mastery-dot mastered" style={{ width: 15, height: 15, fontSize: 9 }}>✓</span> 已掌握
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="hk-mastery-dot proficient" style={{ width: 15, height: 15 }} /> 熟练
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="hk-mastery-dot familiar" style={{ width: 15, height: 15 }} /> 熟悉
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="hk-mastery-dot attempted" style={{ width: 15, height: 15 }} /> 已尝试
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="hk-mastery-dot" style={{ width: 15, height: 15 }} /> 未开始
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <HkIcon name="quiz" size={14} /> 测验
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {allLectures.map(({ unit, lecture }) => (
              <button
                key={lecture.id}
                type="button"
                title={`单元 ${unit} · ${lecture.title}（${MASTERY_LABEL[lecture.mastery]}，点击切换状态）`}
                className={`hk-mastery-dot ${lecture.mastery}`}
                onClick={() => handleCycleMastery(lecture)}
              >
                {lecture.mastery === 'mastered' ? '✓' : ''}
              </button>
            ))}
          </div>

          {nextStepTarget && (
            <div>
              <button
                type="button"
                className="hk-pill-control"
                style={{ background: '#ffffff' }}
                onClick={() => onOpenWhiteboard(nextStepTarget.lecture.id)}
              >
                <span>▶</span>
                <span>
                  下一步：单元 {nextStepTarget.unit} · {nextStepTarget.lecture.title}
                </span>
                <span>›</span>
              </button>
            </div>
          )}
        </div>

        {/* Unit Lecture Timeline Cards */}
        {activeUnit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3b4f7d' }}>第 {activeUnit.unit_index} 单元</div>
                <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700 }}>{activeUnit.title}</h2>
              </div>
              <button type="button" className="btn btn-surface btn-sm" onClick={onOpenCheatsheet}>
                打开速查表
              </button>
            </div>

            {activeUnit.lectures.map((lec, lIdx) => {
              const isNext = nextStepTarget?.lecture.id === lec.id;
              return (
                <div
                  key={lec.id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e6e8ec',
                    borderRadius: 18,
                    padding: '18px 20px',
                    boxShadow: 'var(--shadow-paper)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 16.5, fontWeight: 700, color: '#181a1f' }}>
                        讲次 {lIdx + 1}：{lec.title}
                      </div>
                      <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 4, lineHeight: 1.55 }}>
                        {lec.summary}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      onClick={() =>
                        onAskInstantHelp(`我在学习《${course.title}》的“${lec.title}”，请用直观反例和分步板书给我深入讲解一下。`)
                      }
                    >
                      获取协助
                    </button>
                  </div>

                  {/* Action Sub-row inside lecture card */}
                  <div
                    style={{
                      borderTop: '1px solid #eef0f3',
                      paddingTop: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#181a1f' }}>
                        {lec.duration_min} 分钟 · {lec.board_pages?.length || 1} 页板书
                      </span>
                      {isNext && (
                        <span className="badge badge-info" style={{ fontSize: 11 }}>
                          下一个
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ padding: '7px 16px' }}
                        onClick={() => onOpenWhiteboard(lec.id)}
                      >
                        ▶ {lec.mastery === 'unstarted' ? '开始学习' : '继续学习'}
                      </button>

                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        onClick={() => handleOpenQuiz(lec)}
                      >
                        ✎ 练习
                      </button>

                      <button
                        type="button"
                        title={`当前掌握度：${MASTERY_LABEL[lec.mastery]}（点击切换）`}
                        className={`hk-mastery-dot ${lec.mastery}`}
                        onClick={() => handleCycleMastery(lec)}
                      >
                        {lec.mastery === 'mastered' ? '✓' : ''}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inline Quick Quiz Modal */}
      {quizLecture && (
        <div className="modal-backdrop" onClick={() => setQuizLecture(null)}>
          <div className="modal-panel" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <span className="badge badge-info">随堂微测</span>
                <h2 style={{ margin: '6px 0 0', fontSize: 19 }}>{quizLecture.title}</h2>
              </div>
              <button type="button" className="hk-collapse-btn" onClick={() => setQuizLecture(null)}>
                ✕
              </button>
            </div>

            {!quizLecture.quiz_items || quizLecture.quiz_items.length === 0 ? (
              <div style={{ padding: '16px 0', color: '#6b7280', fontSize: 13.5 }}>
                本讲暂无预置随堂小题，你可以去左栏「练习」打开整卷测试，或点击右上获取专题变式题。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {quizLecture.quiz_items.map((q, qi) => (
                  <div key={q.id} className="card-compact">
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                      <MathText text={`${qi + 1}. ${q.question}`} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {q.options.map((opt) => {
                        const letter = opt.trim().charAt(0);
                        const selected = quizAnswers[q.id] === letter;
                        return (
                          <button
                            key={opt}
                            type="button"
                            className={`btn ${selected ? 'btn-primary' : 'btn-surface'}`}
                            style={{ justifyContent: 'flex-start', borderRadius: 10, padding: '8px 12px', textAlign: 'left' }}
                            disabled={quizSubmitted}
                            onClick={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: letter }))}
                          >
                            <MathText text={opt} />
                          </button>
                        );
                      })}
                    </div>
                    {quizSubmitted && (
                      <div
                        className={quizAnswers[q.id] === q.answer ? 'callout-verified' : 'callout-warn'}
                        style={{ marginTop: 10, fontSize: 12.5 }}
                      >
                        <strong>正确答案：{q.answer}</strong>
                        <div style={{ marginTop: 4 }}>
                          <MathText text={q.explanation} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {!quizSubmitted ? (
                    <button type="button" className="btn btn-primary" onClick={handleSubmitQuickQuiz}>
                      提交并更新掌握度
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => setQuizLecture(null)}>
                      完成练习
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
