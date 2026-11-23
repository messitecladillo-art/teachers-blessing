import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/api';
import { CheatsheetData, CourseRecord } from '../types';
import { MathText } from '../components/MathText';
import { HkIcon } from '../components/HkAssets';

interface HkCheatsheetViewProps {
  course: CourseRecord | null;
  initialTopic?: string;
  initialData?: CheatsheetData | null;
  onBack: () => void;
  onCourseUpdated?: (c: CourseRecord) => void;
}

export const HkCheatsheetView: React.FC<HkCheatsheetViewProps> = ({
  course,
  initialTopic = '函数单调性与导数',
  initialData,
  onBack,
  onCourseUpdated,
}) => {
  const [data, setData] = useState<CheatsheetData>(
    initialData ||
      course?.cheatsheet || {
        title: `${initialTopic} · 高密度速查表`,
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
      }
  );
  const [cols, setCols] = useState<2 | 3>(3);
  const [topicInput, setTopicInput] = useState(initialTopic);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
    } else if (course?.cheatsheet) {
      setData(course.cheatsheet);
    }
  }, [initialData, course?.id, course?.cheatsheet]);

  useEffect(() => {
    setTopicInput(initialTopic);
  }, [initialTopic]);

  const handleRegenerate = async () => {
    setGenerating(true);
    try {
      if (course) {
        const res = await apiJson<{ cheatsheet: CheatsheetData }>(`/api/courses/${course.id}/cheatsheet`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (res.cheatsheet) {
          setData(res.cheatsheet);
          onCourseUpdated?.({ ...course, cheatsheet: res.cheatsheet });
        }
      } else {
        const res = await apiJson<{ cheatsheet: CheatsheetData }>('/api/courses/cheatsheet-custom', {
          method: 'POST',
          body: JSON.stringify({ topic: topicInput.trim() || initialTopic }),
        });
        if (res.cheatsheet) setData(res.cheatsheet);
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="hk-page-wrap">
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="hk-pill-control" onClick={onBack}>
            <span>←</span>
            <span>{course ? '返回课程空间' : '返回首页'}</span>
          </button>
          <HkIcon name="cheatsheet" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>可打印学科速查表</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!course && (
            <input
              className="input"
              style={{ width: 220, height: 34, borderRadius: 999 }}
              placeholder="输入任意主题生成速查表..."
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
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
            {generating ? '生成中…' : course ? '刷新本课速查' : '生成主题速查'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            打印 / 导出 PDF
          </button>
        </div>
      </div>

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
              <span className="hk-brush-blue">{data.title}</span>
            </h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 5 }}>{data.subtitle}</div>
          </div>
          <span className="badge badge-info">知学高密度一页览</span>
        </div>

        <div className="hk-cheatsheet-cols" style={{ columns: cols }}>
          {(data.sections || []).map((sec, sIdx) => (
            <div key={sIdx} className="hk-cheatsheet-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef0f3', paddingBottom: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 14.5, color: '#181a1f' }}>{sec.title}</strong>
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
                      <MathText text={it.term} />
                    </div>
                    <div style={{ color: '#374151', lineHeight: 1.55 }}>
                      <MathText text={it.formula_or_rule} />
                    </div>
                    {it.trap_note && (
                      <div style={{ fontSize: 11.5, color: '#b43b2a', marginTop: 4 }}>
                        注意：<MathText text={it.trap_note} />
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
