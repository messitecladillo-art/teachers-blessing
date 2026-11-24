import React, { useEffect, useRef, useState } from 'react';
import { apiJson } from '../services/api';
import { CourseLecture, CourseRecord, LectureQuizItem, LectureQuizSubmitResult } from '../types';
import { MathText } from './MathText';

interface WhiteboardQuizPaneProps {
  courseId: string;
  lecture: CourseLecture;
  subject?: string;
  gradeLevel?: string;
  generatingQuiz: boolean;
  onCourseUpdated: (c: CourseRecord) => void;
  onGenerateQuiz: () => void;
  onJumpToBlock: (blockId: string) => void;
  onBackToBoard: () => void;
}

const MASTERY_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  mastered: { text: '已掌握', bg: '#ecfdf5', fg: '#15803d' },
  proficient: { text: '熟练', bg: '#eff6ff', fg: '#1d4ed8' },
  familiar: { text: '熟悉中', bg: '#fef3c7', fg: '#b45309' },
  attempted: { text: '探索中', bg: '#f3f4f6', fg: '#374151' },
  unstarted: { text: '未开始', bg: '#f8fafc', fg: '#6b7280' },
};

const getOptionLetter = (opt: string, oi: number) => {
  const m = String(opt || '').trim().match(/^([A-F])(?=[.、:：\s)\uff09]|$)/i);
  return m ? m[1].toUpperCase() : ['A', 'B', 'C', 'D', 'E', 'F'][oi] || 'A';
};

export const WhiteboardQuizPane: React.FC<WhiteboardQuizPaneProps> = ({
  courseId,
  lecture,
  subject,
  gradeLevel,
  generatingQuiz,
  onCourseUpdated,
  onGenerateQuiz,
  onJumpToBlock,
  onBackToBoard,
}) => {
  const quizItems = Array.isArray(lecture?.quiz_items) ? lecture.quiz_items : [];
  const lectureTitle = lecture?.title || '当前讲次';
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LectureQuizSubmitResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedErrIds, setSavedErrIds] = useState<Record<string, boolean>>({});
  const [savingErrIds, setSavingErrIds] = useState<Record<string, boolean>>({});
  const [batchSaving, setBatchSaving] = useState(false);

  const inFlightErrRef = useRef<Set<string>>(new Set());
  const batchInFlightRef = useRef(false);
  const savedErrRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    inFlightErrRef.current.clear();
    batchInFlightRef.current = false;
    savedErrRef.current.clear();
    setAnswers({});
    setResult(null);
    setErrorMsg('');
    setSavedErrIds({});
    setSavingErrIds({});
    setBatchSaving(false);
  }, [lecture?.id]);

  useEffect(() => {
    if (!result) return;
    const gradedItems = Array.isArray(result.items) ? result.items : [];
    const hasUngraded = quizItems.some((q) => !gradedItems.some((it) => it.id === q.id));
    if (hasUngraded) {
      setResult(null);
      setSavedErrIds({});
      savedErrRef.current.clear();
    }
  }, [quizItems, result]);

  const badge = MASTERY_LABEL[result?.mastery || lecture?.mastery || 'unstarted'] || MASTERY_LABEL.unstarted;
  const gradedItems = Array.isArray(result?.items) ? result.items : [];
  const anySingleSaving = Object.values(savingErrIds).some(Boolean);

  const wrongPairs = result
    ? quizItems.flatMap((q) => {
        const graded = gradedItems.find((it) => it.id === q.id);
        return graded && !graded.correct ? [{ q, graded }] : [];
      })
    : [];
  const unsavedWrongPairs = wrongPairs.filter(({ q }) => !savedErrIds[q.id]);

  const postErrorBookItem = async (
    q: LectureQuizItem,
    graded: LectureQuizSubmitResult['items'][number]
  ) => {
    const selectedOpt = graded.selected
      ? (q.options || []).find((o, oi) => getOptionLetter(o, oi) === graded.selected.toUpperCase())
      : undefined;
    const myMistake = graded.selected
      ? `随堂检验误选 ${graded.selected}${selectedOpt ? `（${selectedOpt}）` : ''}，正确答案为 ${graded.expected}`
      : `随堂检验未作答，正确答案为 ${graded.expected}`;
    const explanationText = graded.explanation || q.explanation || '';
    const safeTitle = (lecture?.title || '当前讲次').trim() || '当前讲次';
    const keyTakeaway = (
      explanationText || `复盘「${safeTitle}」对应板书要点，正确答案：${graded.expected}`
    ).slice(0, 240);

    await apiJson('/api/tutor/error-book', {
      method: 'POST',
      body: JSON.stringify({
        subject: subject?.trim() || '综合学科',
        grade_level: gradeLevel?.trim() || '通用年级',
        topic_tag: safeTitle.slice(0, 48),
        question_text: String(q.question || '随堂诊断题'),
        my_mistake: myMistake,
        key_takeaway: keyTakeaway,
        solution_json: {
          source: 'whiteboard_quiz',
          course_id: courseId,
          lecture_id: lecture?.id || '',
          options: q.options || [],
          selected: graded.selected,
          final_answer: graded.expected,
          explanation: explanationText,
          related_block_id: graded.related_block_id || q.related_block_id || '',
        },
      }),
    });
  };

  const handleSaveSingleWrong = async (
    q: LectureQuizItem,
    graded: LectureQuizSubmitResult['items'][number]
  ) => {
    if (
      batchInFlightRef.current ||
      inFlightErrRef.current.has(q.id) ||
      savedErrRef.current.has(q.id) ||
      savedErrIds[q.id] ||
      savingErrIds[q.id]
    ) {
      return;
    }
    inFlightErrRef.current.add(q.id);
    setSavingErrIds((prev) => ({ ...prev, [q.id]: true }));
    setErrorMsg('');
    try {
      await postErrorBookItem(q, graded);
      savedErrRef.current.add(q.id);
      setSavedErrIds((prev) => ({ ...prev, [q.id]: true }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加入错题本失败');
    } finally {
      inFlightErrRef.current.delete(q.id);
      setSavingErrIds((prev) => ({ ...prev, [q.id]: false }));
    }
  };

  const handleBatchSaveWrong = async () => {
    if (
      !unsavedWrongPairs.length ||
      batchSaving ||
      batchInFlightRef.current ||
      inFlightErrRef.current.size > 0
    ) {
      return;
    }
    batchInFlightRef.current = true;
    setBatchSaving(true);
    setErrorMsg('');
    try {
      for (const { q, graded } of unsavedWrongPairs) {
        if (savedErrRef.current.has(q.id) || inFlightErrRef.current.has(q.id)) continue;
        inFlightErrRef.current.add(q.id);
        try {
          await postErrorBookItem(q, graded);
          savedErrRef.current.add(q.id);
          setSavedErrIds((prev) => ({ ...prev, [q.id]: true }));
        } finally {
          inFlightErrRef.current.delete(q.id);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '批量收录错题失败');
    } finally {
      batchInFlightRef.current = false;
      setBatchSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!quizItems.length || submitting || !lecture?.id) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await apiJson<LectureQuizSubmitResult>(
        `/api/courses/${courseId}/lectures/${lecture.id}/quiz-submit`,
        {
          method: 'POST',
          body: JSON.stringify({ answers }),
        }
      );
      setResult(res);
      savedErrRef.current.clear();
      setSavedErrIds({});
      if (res.course) onCourseUpdated(res.course);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交批改失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e6e8ec',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: '#181a1f' }}>随堂即时检验 · {lectureTitle}</h3>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: 999,
                background: badge.bg,
                color: badge.fg,
              }}
            >
              {badge.text}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>
            共 {quizItems.length} 道诊断检验题 · 提交后自动判分、记录薄弱点并同步课程掌握度
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-surface btn-sm"
            disabled={generatingQuiz}
            onClick={onGenerateQuiz}
            data-testid="wb-generate-quiz-btn"
          >
            {generatingQuiz ? '正在生成新题…' : '+ AI 现场再出一题'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBackToBoard}>
            返回板书
          </button>
        </div>
      </div>

      {result && (
        <div
          data-testid="wb-quiz-result-banner"
          style={{
            background: result.score_pct >= 60 ? '#ecfdf5' : '#fffbeb',
            border: `1px solid ${result.score_pct >= 60 ? '#a7f3d0' : '#fde68a'}`,
            borderRadius: 14,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: result.score_pct >= 60 ? '#166534' : '#92400e' }}>
              本次得分：{result.score_pct}%（答对 {result.correct_count} / {result.total_count} 题）
            </div>
            <div style={{ fontSize: 12.5, color: '#4b5563', marginTop: 2 }}>
              本讲掌握度已更新为「{badge.text}」，错题建议点击下方“回看对应板书”复盘。
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {wrongPairs.length > 0 && (
              <button
                type="button"
                className={`btn btn-sm ${unsavedWrongPairs.length === 0 ? 'btn-surface' : 'btn-primary'}`}
                disabled={batchSaving || anySingleSaving || unsavedWrongPairs.length === 0}
                onClick={handleBatchSaveWrong}
                data-testid="wb-save-all-err-btn"
              >
                {unsavedWrongPairs.length === 0
                  ? '✓ 已入错题本'
                  : batchSaving
                  ? '正在收录错题…'
                  : '一键收录错题'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-surface btn-sm"
              onClick={() => {
                savedErrRef.current.clear();
                setResult(null);
                setSavedErrIds({});
              }}
            >
              重新作答
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>
          {errorMsg}
        </div>
      )}

      {quizItems.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px dashed #cbd5e1',
            borderRadius: 16,
            padding: '36px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>本讲暂未配置随堂检验题</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 420 }}>
            点击下方按钮，AI 主讲老师会立刻结合当前白板推导块命制一道针对性的检验题。
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={generatingQuiz}
            onClick={onGenerateQuiz}
            data-testid="wb-empty-generate-quiz-btn"
          >
            {generatingQuiz ? '正在命制检验题…' : 'AI 现场命制随堂检验题'}
          </button>
        </div>
      ) : (
        <>
          {quizItems.map((q, qi) => {
            const chosen = answers[q.id] || '';
            const graded = gradedItems.find((it) => it.id === q.id);
            return (
              <div
                key={q.id}
                style={{
                  background: '#ffffff',
                  border: `1px solid ${graded ? (graded.correct ? '#86efac' : '#fca5a5') : '#e6e8ec'}`,
                  borderRadius: 16,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#181a1f', lineHeight: 1.55 }}>
                    <span className="mono-num" style={{ color: '#3b4f7d', marginRight: 6 }}>
                      Q{qi + 1}.
                    </span>
                    <MathText text={q.question || ''} />
                  </div>
                  {(q.related_block_id || graded?.related_block_id) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0, fontSize: 12 }}
                      onClick={() => onJumpToBlock((graded?.related_block_id || q.related_block_id)!)}
                    >
                      回看对应板书
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {(q.options || []).map((opt, oi) => {
                    const letter = getOptionLetter(opt, oi);
                    const isSelected = chosen === letter;
                    const isExpected = graded && graded.expected === letter;
                    const isWrongSelected = graded && isSelected && !graded.correct;
                    let borderColor = isSelected ? '#3b4f7d' : '#e5e7eb';
                    let bg = isSelected ? '#eff6ff' : '#ffffff';
                    if (isExpected) {
                      borderColor = '#16a34a';
                      bg = '#ecfdf5';
                    } else if (isWrongSelected) {
                      borderColor = '#dc2626';
                      bg = '#fef2f2';
                    }
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={Boolean(graded)}
                        onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: letter }))}
                        style={{
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderRadius: 12,
                          border: `1.5px solid ${borderColor}`,
                          background: bg,
                          cursor: graded ? 'default' : 'pointer',
                          fontSize: 13.5,
                          color: '#1f2937',
                          fontFamily: 'inherit',
                        }}
                      >
                        <MathText text={String(opt ?? '')} />
                      </button>
                    );
                  })}
                </div>

                {graded && (
                  <div
                    style={{
                      marginTop: 4,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: graded.correct ? '#f0fdf4' : '#fef2f2',
                      fontSize: 13,
                      color: '#374151',
                      lineHeight: 1.55,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: graded.correct ? '#15803d' : '#b91c1c' }}>
                        {graded.correct ? '✓ 回答正确' : `✗ 正确答案 ${graded.expected}`}
                      </strong>
                      {!graded.correct && (
                        <button
                          type="button"
                          className={`btn btn-sm ${savedErrIds[q.id] ? 'btn-surface' : 'btn-ghost'}`}
                          style={{
                            padding: '2px 10px',
                            fontSize: 12,
                            color: savedErrIds[q.id] ? '#15803d' : '#b91c1c',
                            borderColor: savedErrIds[q.id] ? '#86efac' : '#fca5a5',
                            background: '#ffffff',
                          }}
                          disabled={Boolean(savedErrIds[q.id] || savingErrIds[q.id] || batchSaving)}
                          onClick={() => handleSaveSingleWrong(q, graded)}
                          data-testid={`wb-save-err-${q.id}`}
                        >
                          {savedErrIds[q.id] ? '✓ 已入错题本' : savingErrIds[q.id] ? '收录中…' : '+ 加入错题本'}
                        </button>
                      )}
                    </div>
                    <div>
                      <MathText text={graded.explanation || q.explanation || ''} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!result && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || Object.keys(answers).length === 0}
                onClick={handleSubmit}
                data-testid="wb-submit-quiz-btn"
              >
                {submitting ? '正在自动批改…' : '提交批改并更新掌握度'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
