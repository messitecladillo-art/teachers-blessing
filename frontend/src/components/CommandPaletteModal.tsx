import React, { useEffect, useState } from 'react';
import { apiJson, handleSafeDownload, resolveApiUrl } from '../services/api';
import { ArtifactItem, PedagogyTopic, TeachTab, TutorSubTab } from '../types';
import {
  IconCloseX,
  IconCommandK,
  IconCompassBook,
  IconDownloadBox,
  IconSparkPulse,
  IconLessonDoc,
  IconSlideDeck,
} from './EduIcons';

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  artifacts: ArtifactItem[];
  onNavigateAgent: () => void;
  onNavigateTutor: (tab: TutorSubTab) => void;
  onNavigateTeach: (tab: TeachTab) => void;
  onApplyPedagogyToTutor: (topic: PedagogyTopic) => void;
  onApplyPedagogyToPpt: (topic: PedagogyTopic) => void;
}

const WORKBENCH_COMMANDS: {
  id: string;
  label: string;
  sub: string;
  kind: 'agent' | 'tutor' | 'teach';
  target: string;
}[] = [
  { id: 'cmd_agent', label: '任务助手（全局协同）', sub: '多步规划备课、跨模块联动修改、查讲义与薄弱点记忆', kind: 'agent', target: 'hub' },
  { id: 'cmd_solve', label: '题目答疑与算式验算', sub: '分步提示、连续追问与函数作图', kind: 'tutor', target: 'solve' },
  { id: 'cmd_mindmap', label: '图形画板与思维导图', sub: '平面函数、三维曲面与导图编辑导出', kind: 'tutor', target: 'mindmap' },
  { id: 'cmd_err', label: '错题本与熟练度标记', sub: '记录错因与要点，按阶段重做复习', kind: 'tutor', target: 'errorbook' },
  { id: 'cmd_plan', label: '7日复习计划', sub: '安排每日任务并导出日历与打卡表', kind: 'tutor', target: 'plan' },
  { id: 'cmd_lesson', label: '教案设计', sub: '编写教学目标、过程与板书并导出文档', kind: 'teach', target: 'lesson' },
  { id: 'cmd_ppt', label: '课件制作', sub: '生成可编辑幻灯片并支持试讲配音', kind: 'teach', target: 'ppt' },
  { id: 'cmd_exam', label: '试卷组卷', sub: '题库选题或自定义出题，分别导出学生卷与教师卷', kind: 'teach', target: 'exam' },
  { id: 'cmd_ana', label: '成绩分析', sub: '姓名学号自动脱敏、分布统计与讲评建议', kind: 'teach', target: 'analytics' },
];

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  artifacts,
  onNavigateAgent,
  onNavigateTutor,
  onNavigateTeach,
  onApplyPedagogyToTutor,
  onApplyPedagogyToPpt,
}) => {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<PedagogyTopic[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    apiJson<{ topics: PedagogyTopic[] }>('/api/pedagogy/topics')
      .then((res) => setTopics(res.topics || []))
      .catch(() => {});

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchedCmds = WORKBENCH_COMMANDS.filter(
    (c) => !q || c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)
  );
  const matchedTopics = topics
    .filter(
      (t) =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.domain_name || '').toLowerCase().includes(q) ||
        (t.branch || '').toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    )
    .slice(0, 6);
  const matchedArts = artifacts
    .filter((a) => !q || a.title.toLowerCase().includes(q) || a.filename.toLowerCase().includes(q))
    .slice(0, 4);

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="command-palette-modal">
      <div
        className="modal-panel"
        style={{ width: 'min(640px, 95vw)', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-hairline)',
          }}
        >
          <IconCommandK size={16} color="var(--accent)" />
          <input
            autoFocus
            className="input"
            style={{ border: 'none', boxShadow: 'none', padding: '4px 0', fontSize: 14 }}
            placeholder="搜索功能模块、学科专题或导出文件（Esc 关闭）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="cmdk-input"
          />
          <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭指令面板" onClick={onClose}>
            <IconCloseX size={16} />
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ maxHeight: '58vh', overflowY: 'auto', padding: '12px 14px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {matchedCmds.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  常用功能
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {matchedCmds.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      className="spine-item"
                      style={{ padding: '7px 10px' }}
                      onClick={() => {
                        if (cmd.kind === 'agent') onNavigateAgent();
                        else if (cmd.kind === 'tutor') onNavigateTutor(cmd.target as TutorSubTab);
                        else onNavigateTeach(cmd.target as TeachTab);
                        onClose();
                      }}
                    >
                      <span className="spine-item-left">
                        <IconLessonDoc size={14} color="var(--accent)" />
                        <span>
                          <strong style={{ fontSize: 13 }}>{cmd.label}</strong>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginLeft: 8 }}>{cmd.sub}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {matchedTopics.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  学科专题参考（{matchedTopics.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matchedTopics.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-hairline)',
                        background: 'var(--bg-subtle)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <IconCompassBook size={13} color="var(--accent)" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>
                          {t.intuition_models[0]?.name} · {t.subject}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn btn-surface btn-sm"
                          onClick={() => {
                            onApplyPedagogyToTutor(t);
                            onClose();
                          }}
                        >
                          <IconSparkPulse size={12} /> 答疑
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            onApplyPedagogyToPpt(t);
                            onClose();
                          }}
                        >
                          <IconSlideDeck size={12} /> PPT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {matchedArts.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  本地已编译产出物
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {matchedArts.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-hairline)',
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</span>
                      <a
                        href={resolveApiUrl(a.download_url)}
                        download={a.filename}
                        onClick={(e) => handleSafeDownload(e, a.download_url, a.filename)}
                        className="btn btn-surface btn-sm"
                        style={{ textDecoration: 'none' }}
                      >
                        <IconDownloadBox size={12} /> 下载
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border-hairline)',
              background: 'var(--bg-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11.5,
              color: 'var(--ink-muted)',
            }}
          >
            <span>{WORKBENCH_COMMANDS.length} 个功能 · {topics.length} 个专题 · {artifacts.length} 份文件</span>
            <span className="mono-num">Esc 关闭</span>
          </div>
        </div>
      </div>
    </div>
  );
};
