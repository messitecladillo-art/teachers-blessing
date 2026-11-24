import React, { useEffect, useRef, useState } from 'react';
import { apiJson } from '../services/api';
import { CheatsheetData, CourseRecord } from '../types';
import { MathText } from '../components/MathText';
import { HkIcon } from '../components/HkAssets';

interface HkCheatsheetViewProps {
  course: CourseRecord | null;
  courses?: CourseRecord[];
  initialTopic?: string;
  initialData?: CheatsheetData | null;
  backLabel?: string;
  onSelectCourse?: (courseId: string | null) => void;
  onBack: () => void;
  onCourseUpdated?: (c: CourseRecord) => void;
}

const DEFAULT_CHEATSHEET = (topic: string): CheatsheetData => ({
  title: `${topic} · 高密度速查表`,
  subtitle: '重点公式、判定流程与常见误区对比',
  sections: [
    {
      title: '核心定理与符号规范',
      badge: '必背框架',
      items: [
        {
          term: '区间递增判据',
          formula_or_rule: "在某区间内 $f'(x) > 0 \\Rightarrow$ 函数严格递增；$f'(x) \\ge 0$ 且仅在离散点取零依然递增",
          highlight_color: 'blue',
          trap_note: '多段递增区间禁止写并集符号 $\\cup$，应写“和”或逗号',
        },
        {
          term: '四步标准化程序',
          formula_or_rule: '① 先标定义域 $\\rightarrow$ ② 求导因式分解 $\\rightarrow$ ③ 找驻点与无定义点 $\\rightarrow$ ④ 分段列表检号',
          highlight_color: 'yellow',
          trap_note: '对数函数 $\\ln x$ 优先标注 $x>0$',
        },
      ],
    },
    {
      title: '典型反例清单',
      badge: '避坑提示',
      items: [
        {
          term: '驻点无极值反例',
          formula_or_rule: "$f(x)=x^3$ 在 $x=0$ 处 $f'(0)=0$，但导数不变号，无极值",
          highlight_color: 'yellow',
          trap_note: '不可仅凭二阶导为零做判断',
        },
        {
          term: '极值点不可导反例',
          formula_or_rule: '$f(x)=|x|$ 在 $x=0$ 处连续不可导，却是极小值点',
          highlight_color: 'none',
          trap_note: '先画尖点草图复核',
        },
      ],
    },
  ],
});

const hasSections = (cs?: CheatsheetData | null): cs is CheatsheetData => Boolean(cs?.sections?.length);

export const HkCheatsheetView: React.FC<HkCheatsheetViewProps> = ({
  course,
  courses = [],
  initialTopic = '函数单调性与导数',
  initialData,
  backLabel,
  onSelectCourse,
  onBack,
  onCourseUpdated,
}) => {
  const [selectedCourse, setSelectedCourse] = useState<CourseRecord | null>(course);
  const [data, setData] = useState<CheatsheetData>(() => {
    if (hasSections(initialData)) return initialData;
    if (hasSections(course?.cheatsheet)) return course.cheatsheet;
    return DEFAULT_CHEATSHEET(course?.title || initialTopic);
  });
  const [cols, setCols] = useState<2 | 3>(3);
  const [focusUnit, setFocusUnit] = useState<number | null>(null);
  const [topicInput, setTopicInput] = useState(initialTopic);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const reqIdRef = useRef(0);

  useEffect(() => {
    reqIdRef.current += 1;
    setGenerating(false);
    setSelectedCourse(course);
    setFocusUnit(null);
    setErrorMsg('');
    if (hasSections(initialData)) {
      setData(initialData);
    } else if (course) {
      setData(hasSections(course.cheatsheet) ? course.cheatsheet : DEFAULT_CHEATSHEET(course.title));
    } else {
      setData(DEFAULT_CHEATSHEET(initialTopic));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, initialData]);

  useEffect(() => {
    if (course && selectedCourse?.id === course.id) {
      setSelectedCourse(course);
      if (focusUnit === null && hasSections(course.cheatsheet) && !hasSections(initialData)) {
        setData(course.cheatsheet);
      }
    }
  }, [course, selectedCourse?.id, focusUnit, initialData]);

  useEffect(() => {
    setTopicInput(initialTopic);
  }, [initialTopic]);

  const fetchCourseCheatsheet = async (targetCourse: CourseRecord, unitFilter: number | null) => {
    const reqId = ++reqIdRef.current;
    setGenerating(true);
    setErrorMsg('');
    try {
      const res = await apiJson<{ cheatsheet: CheatsheetData }>(`/api/courses/${targetCourse.id}/cheatsheet`, {
        method: 'POST',
        body: JSON.stringify({ focus_unit: unitFilter }),
      });
      if (reqId !== reqIdRef.current) return;
      if (hasSections(res.cheatsheet)) {
        setData(res.cheatsheet);
        if (unitFilter === null) {
          const updated = { ...targetCourse, cheatsheet: res.cheatsheet };
          setSelectedCourse(updated);
          onCourseUpdated?.(updated);
        }
      } else if (res.cheatsheet) {
        setData(res.cheatsheet);
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : '速查表生成失败，请稍后重试');
    } finally {
      if (reqId === reqIdRef.current) {
        setGenerating(false);
      }
    }
  };

  const handleRegenerate = async () => {
    if (selectedCourse) {
      await fetchCourseCheatsheet(selectedCourse, focusUnit);
      return;
    }
    const reqId = ++reqIdRef.current;
    setGenerating(true);
    setErrorMsg('');
    try {
      const res = await apiJson<{ cheatsheet: CheatsheetData }>('/api/courses/cheatsheet-custom', {
        method: 'POST',
        body: JSON.stringify({ topic: topicInput.trim() || initialTopic }),
      });
      if (reqId !== reqIdRef.current) return;
      if (hasSections(res.cheatsheet)) {
        setData(res.cheatsheet);
      } else if (res.cheatsheet) {
        setData(res.cheatsheet);
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : '主题速查表生成失败，请稍后重试');
    } finally {
      if (reqId === reqIdRef.current) {
        setGenerating(false);
      }
    }
  };

  const handleSelectUnitPill = (unitIdx: number | null) => {
    setFocusUnit(unitIdx);
    setErrorMsg('');
    if (!selectedCourse) return;
    if (unitIdx === null && hasSections(selectedCourse.cheatsheet)) {
      reqIdRef.current += 1;
      setGenerating(false);
      setData(selectedCourse.cheatsheet);
      return;
    }
    void fetchCourseCheatsheet(selectedCourse, unitIdx);
  };

  const handleCourseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cid = e.target.value || null;
    reqIdRef.current += 1;
    setGenerating(false);
    setFocusUnit(null);
    setErrorMsg('');
    if (!cid) {
      setSelectedCourse(null);
      setData(DEFAULT_CHEATSHEET(topicInput.trim() || initialTopic));
    } else {
      const found = courses.find((c) => c.id === cid) || null;
      if (found) {
        setSelectedCourse(found);
        setData(hasSections(found.cheatsheet) ? found.cheatsheet : DEFAULT_CHEATSHEET(found.title));
      }
    }
    onSelectCourse?.(cid);
  };

  return (
    <div className="hk-page-wrap">
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="hk-pill-control" onClick={onBack}>
            <span>←</span>
            <span>{backLabel || (selectedCourse ? '返回课程空间' : '返回首页')}</span>
          </button>
          <HkIcon name="cheatsheet" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>可打印学科速查表</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {courses.length > 0 && (
            <select
              className="select"
              aria-label="切换速查表课程"
              data-testid="cheatsheet-course-select"
              disabled={generating}
              style={{ width: 210, height: 34, borderRadius: 999, padding: '0 12px', fontSize: 12.5 }}
              value={selectedCourse?.id || ''}
              onChange={handleCourseChange}
            >
              <option value="">自由主题速查表</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          {!selectedCourse && (
            <input
              className="input"
              style={{ width: 220, height: 34, borderRadius: 999 }}
              placeholder="输入任意主题生成速查表..."
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  void handleRegenerate();
                }
              }}
            />
          )}
          <div className="seg-switch">
            <button type="button" className={`seg-switch-btn ${cols === 2 ? 'active' : ''}`} onClick={() => setCols(2)}>
              2 栏视图
            </button>
            <button type="button" className={`seg-switch-btn ${cols === 3 ? 'active' : ''}`} onClick={() => setCols(3)}>
              3 栏视图
            </button>
          </div>
          <button type="button" className="btn btn-surface btn-sm" disabled={generating} onClick={handleRegenerate}>
            {generating ? '生成中…' : selectedCourse ? '刷新本课速查' : '生成主题速查'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            打印 / 导出 PDF
          </button>
        </div>
      </div>

      {selectedCourse && selectedCourse.units && selectedCourse.units.length > 0 && (
        <div
          className="no-print"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}
        >
          <button
            type="button"
            className={`hk-chip-btn ${focusUnit === null ? 'active' : ''}`}
            style={{ height: 30, fontSize: 12 }}
            disabled={generating}
            onClick={() => handleSelectUnitPill(null)}
          >
            全部单元
          </button>
          {selectedCourse.units.map((u) => (
            <button
              key={u.unit_index}
              type="button"
              title={u.title}
              className={`hk-chip-btn ${focusUnit === u.unit_index ? 'active' : ''}`}
              style={{ height: 30, fontSize: 12 }}
              disabled={generating}
              onClick={() => handleSelectUnitPill(u.unit_index)}
            >
              单元 {u.unit_index}
            </button>
          ))}
        </div>
      )}

      {errorMsg && (
        <div className="callout-danger no-print" style={{ marginBottom: 14, fontSize: 13 }}>
          {errorMsg}
        </div>
      )}

      <div
        className="paper-folio"
        style={{
          background: '#ffffff',
          borderRadius: 18,
          padding: '24px 28px',
        }}
      >
        <div style={{ borderBottom: '2px solid #181a1f', paddingBottom: 12, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 className="serif-heading" style={{ margin: 0, fontSize: 22 }}>
              <span className="hk-brush-blue">
                <MathText text={data.title} inline />
              </span>
            </h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 5 }}>
              <MathText text={data.subtitle} inline />
            </div>
          </div>
          <span className="badge badge-info">
            {focusUnit !== null ? `单元 ${focusUnit} 专项速查` : '知学高密度一页览'}
          </span>
        </div>

        <div className="hk-cheatsheet-cols" data-cols={cols}>
          {(data.sections || []).map((sec, sIdx) => (
            <div key={sIdx} className="hk-cheatsheet-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef0f3', paddingBottom: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 14.5, color: '#181a1f' }}>
                  <MathText text={sec.title} inline />
                </strong>
                {sec.badge && <span className="badge badge-info">{sec.badge}</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(sec.items || []).map((it, iIdx) => (
                  <div key={iIdx} style={{ fontSize: 13 }}>
                    <div
                      style={{
                        display: 'inline-block',
                        fontWeight: 700,
                        marginBottom: 4,
                        padding: '1px 6px',
                        borderRadius: 5,
                        background:
                          it.highlight_color === 'blue'
                            ? '#e8eef9'
                            : it.highlight_color === 'yellow'
                            ? '#fef08a'
                            : '#f3f4f6',
                        color: '#181a1f',
                      }}
                    >
                      <MathText text={it.term} inline />
                    </div>
                    <div style={{ color: '#374151', lineHeight: 1.55 }}>
                      <MathText text={it.formula_or_rule} />
                    </div>
                    {it.trap_note && (
                      <div style={{ fontSize: 11.5, color: '#b43b2a', marginTop: 4 }}>
                        注意：<MathText text={it.trap_note} inline />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
