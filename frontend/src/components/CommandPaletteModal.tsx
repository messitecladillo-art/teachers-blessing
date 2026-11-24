import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, handleSafeDownload, resolveApiUrl } from '../services/api';
import { ArtifactItem, CourseRecord, HkRoute, HomeTab, PedagogyTopic, TeachTab, TutorSubTab } from '../types';
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
  courses?: CourseRecord[];
  onNavigateRoute?: (r: HkRoute, tab?: HomeTab) => void;
  onOpenCourseSpace?: (cid: string) => void;
  onOpenWhiteboard?: (cid: string, lid?: string) => void;
  onNavigateAgent: () => void;
  onNavigateTutor: (tab: TutorSubTab) => void;
  onNavigateTeach: (tab: TeachTab) => void;
  onApplyPedagogyToTutor: (topic: PedagogyTopic) => void;
  onApplyPedagogyToPpt: (topic: PedagogyTopic) => void;
}

interface WorkbenchCmdItem {
  id: string;
  label: string;
  sub: string;
  kind: 'route' | 'agent' | 'tutor' | 'teach';
  route?: HkRoute;
  homeTab?: HomeTab;
  target?: string;
}

const WORKBENCH_COMMANDS: WorkbenchCmdItem[] = [
  { id: 'v5_home_craft', label: '首页·打造课程', sub: '输入主题或上传讲义，打造多单元互动白板课程', kind: 'route', route: 'home', homeTab: 'craft' },
  { id: 'v5_home_instant', label: '首页·即时协助', sub: '多步规划备课、跨模块联动修改、查讲义与薄弱点记忆', kind: 'route', route: 'home', homeTab: 'instant' },
  { id: 'v5_courses', label: '我的课程', sub: '查看课程学习进度、单元讲次与本周节次统计', kind: 'route', route: 'courses' },
  { id: 'v5_marketplace', label: '课程集市', sub: '浏览学科精选示范专题与教研备课模板', kind: 'route', route: 'marketplace' },
  { id: 'v5_calendar', label: '学习动态', sub: '月历任务待办、7日复习计划与到期薄弱点强化', kind: 'route', route: 'calendar' },
  { id: 'v5_kb', label: '个人知识库', sub: '管理本地讲义资料、检索章节片段与一键建课', kind: 'route', route: 'kb' },
  { id: 'v5_history', label: '历史会话', sub: '回顾历史对话、白板课堂、教案课件与测验学情', kind: 'route', route: 'history' },
  { id: 'v5_cheatsheet', label: '学科速查表', sub: '多栏高密度核心公式、反例避坑与打印导出', kind: 'route', route: 'cheatsheet' },
  { id: 'v5_mindmap', label: '结构导图与画板', sub: '思维导图节点编辑、二维函数与三维曲面实验台', kind: 'route', route: 'tool_mindmap' },
  { id: 'cmd_solve', label: '题目答疑与算式验算', sub: '分步提示、连续追问与函数作图', kind: 'tutor', target: 'solve' },
  { id: 'cmd_err', label: '错题本与熟练度标记', sub: '记录错因与要点，按阶段重做复习', kind: 'tutor', target: 'errorbook' },
  { id: 'cmd_lesson', label: '教案设计', sub: '编写教学目标、过程与板书并导出文档', kind: 'teach', target: 'lesson' },
  { id: 'cmd_ppt', label: '课件制作', sub: '生成可编辑幻灯片并支持试讲配音', kind: 'teach', target: 'ppt' },
  { id: 'cmd_exam', label: '试卷组卷', sub: '题库选题或自定义出题，在线作答自动批改', kind: 'teach', target: 'exam' },
  { id: 'cmd_ana', label: '成绩分析', sub: '姓名学号自动脱敏、分布统计与讲评建议', kind: 'teach', target: 'analytics' },
];

interface CourseLectureMatch {
  id: string;
  entryType: 'course' | 'lecture';
  courseId: string;
  lectureId?: string;
  title: string;
  sub: string;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  artifacts,
  courses = [],
  onNavigateRoute,
  onOpenCourseSpace,
  onOpenWhiteboard,
  onNavigateAgent,
  onNavigateTutor,
  onNavigateTeach,
  onApplyPedagogyToTutor,
  onApplyPedagogyToPpt,
}) => {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<PedagogyTopic[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Record<number, HTMLElement | null>>({});
  const artifactLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    apiJson<{ topics: PedagogyTopic[] }>('/api/pedagogy/topics')
      .then((res) => setTopics(res.topics || []))
      .catch(() => {});

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  const matchedCmds = useMemo(
    () =>
      WORKBENCH_COMMANDS.filter(
        (c) => !q || c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)
      ),
    [q]
  );

  const matchedCourseItems = useMemo<CourseLectureMatch[]>(() => {
    const out: CourseLectureMatch[] = [];
    for (const c of courses) {
      const courseMatches =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q);
      if (courseMatches && out.filter((x) => x.entryType === 'course').length < 4) {
        out.push({
          id: `crs_${c.id}`,
          entryType: 'course',
          courseId: c.id,
          title: c.title,
          sub: `${c.subject} · 进度 ${c.progress_pct}%`,
        });
      }

      if (!q) {
        const defaultLec =
          c.next_lecture ||
          (c.units?.[0]?.lectures?.[0]
            ? {
                id: c.units[0].lectures[0].id,
                title: c.units[0].lectures[0].title,
                unit_index: c.units[0].unit_index,
              }
            : null);
        if (defaultLec && out.filter((x) => x.entryType === 'lecture').length < 3) {
          out.push({
            id: `lec_${c.id}_${defaultLec.id}`,
            entryType: 'lecture',
            courseId: c.id,
            lectureId: defaultLec.id,
            title: defaultLec.title,
            sub: `${c.title} · 直达白板课堂`,
          });
        }
      } else {
        for (const u of c.units || []) {
          for (const lec of u.lectures || []) {
            const lecMatches =
              lec.title.toLowerCase().includes(q) ||
              (lec.summary || '').toLowerCase().includes(q) ||
              c.title.toLowerCase().includes(q);
            if (lecMatches && out.filter((x) => x.entryType === 'lecture').length < 6) {
              out.push({
                id: `lec_${c.id}_${lec.id}`,
                entryType: 'lecture',
                courseId: c.id,
                lectureId: lec.id,
                title: lec.title,
                sub: `${c.title} · 第 ${u.unit_index} 单元 · 直达白板课堂`,
              });
            }
          }
        }
      }
    }
    return out;
  }, [courses, q]);

  const matchedTopics = useMemo(
    () =>
      topics
        .filter(
          (t) =>
            !q ||
            t.title.toLowerCase().includes(q) ||
            t.subject.toLowerCase().includes(q) ||
            (t.domain_name || '').toLowerCase().includes(q) ||
            (t.branch || '').toLowerCase().includes(q) ||
            t.keywords.some((k) => k.toLowerCase().includes(q))
        )
        .slice(0, 6),
    [topics, q]
  );

  const matchedArts = useMemo(
    () =>
      artifacts
        .filter((a) => !q || a.title.toLowerCase().includes(q) || a.filename.toLowerCase().includes(q))
        .slice(0, 4),
    [artifacts, q]
  );

  const executeCmd = useCallback(
    (cmd: WorkbenchCmdItem) => {
      if (cmd.kind === 'route' && cmd.route) {
        if (onNavigateRoute) {
          onNavigateRoute(cmd.route, cmd.homeTab);
        } else if (cmd.route === 'home' && cmd.homeTab === 'instant') {
          onNavigateAgent();
        } else if (cmd.route === 'tool_mindmap') {
          onNavigateTutor('mindmap');
        }
      } else if (cmd.kind === 'agent') {
        onNavigateAgent();
      } else if (cmd.kind === 'tutor' && cmd.target) {
        onNavigateTutor(cmd.target as TutorSubTab);
      } else if (cmd.kind === 'teach' && cmd.target) {
        onNavigateTeach(cmd.target as TeachTab);
      }
      onClose();
    },
    [onNavigateRoute, onNavigateAgent, onNavigateTutor, onNavigateTeach, onClose]
  );

  const executeCourseItem = useCallback(
    (item: CourseLectureMatch) => {
      if (item.entryType === 'lecture') {
        onOpenWhiteboard?.(item.courseId, item.lectureId);
      } else {
        onOpenCourseSpace?.(item.courseId);
      }
      onClose();
    },
    [onOpenWhiteboard, onOpenCourseSpace, onClose]
  );

  const navActions = useMemo(() => {
    const actions: (() => void)[] = [];
    for (const cmd of matchedCmds) {
      actions.push(() => executeCmd(cmd));
    }
    for (const ci of matchedCourseItems) {
      actions.push(() => executeCourseItem(ci));
    }
    for (const tp of matchedTopics) {
      actions.push(() => {
        onApplyPedagogyToTutor(tp);
        onClose();
      });
    }
    for (const art of matchedArts) {
      actions.push(() => {
        artifactLinkRefs.current[art.id]?.click();
        onClose();
      });
    }
    return actions;
  }, [
    matchedCmds,
    matchedCourseItems,
    matchedTopics,
    matchedArts,
    executeCmd,
    executeCourseItem,
    onApplyPedagogyToTutor,
    onClose,
  ]);

  const totalCount = navActions.length;
  const safeIndex = totalCount > 0 ? Math.min(activeIndex, totalCount - 1) : -1;

  useEffect(() => {
    if (safeIndex >= 0) {
      itemRefs.current[safeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [safeIndex]);

  if (!open) return null;

  const cmdOffset = 0;
  const courseOffset = cmdOffset + matchedCmds.length;
  const topicOffset = courseOffset + matchedCourseItems.length;
  const artOffset = topicOffset + matchedTopics.length;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalCount > 0) {
        setActiveIndex((prev) => (Math.min(prev, totalCount - 1) + 1) % totalCount);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalCount > 0) {
        setActiveIndex((prev) => (Math.min(prev, totalCount - 1) - 1 + totalCount) % totalCount);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (safeIndex >= 0 && navActions[safeIndex]) {
        navActions[safeIndex]();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="command-palette-modal">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索与快速跳转"
        style={{ width: 'min(660px, 95vw)', padding: 0, overflow: 'hidden' }}
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
            placeholder="搜索页面路由、课程与讲次、学科专题或导出文件（↑↓ 选择，Enter 跳转）…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            data-testid="cmdk-input"
          />
          <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭指令面板" onClick={onClose}>
            <IconCloseX size={16} />
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ maxHeight: '58vh', overflowY: 'auto', padding: '12px 14px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {totalCount === 0 && (
              <div
                data-testid="cmdk-empty-state"
                style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 6 }}>
                  未找到与「{query.trim()}」匹配的路由、课程讲次、专题或文件
                </div>
                <div style={{ fontSize: 12 }}>请尝试更换搜索词，或按 Esc 关闭面板</div>
              </div>
            )}

            {matchedCmds.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  页面导航与专项工坊（{matchedCmds.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {matchedCmds.map((cmd, i) => {
                    const flatIdx = cmdOffset + i;
                    const active = flatIdx === safeIndex;
                    return (
                      <button
                        key={cmd.id}
                        ref={(el) => {
                          itemRefs.current[flatIdx] = el;
                        }}
                        type="button"
                        className="spine-item"
                        data-active={active ? 'true' : 'false'}
                        style={{
                          padding: '7px 10px',
                          background: active ? 'var(--accent-soft)' : undefined,
                          borderRadius: 8,
                          border: active ? '1px solid rgba(59, 79, 125, 0.28)' : '1px solid transparent',
                        }}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => executeCmd(cmd)}
                      >
                        <span className="spine-item-left">
                          <IconLessonDoc size={14} color="var(--accent)" />
                          <span>
                            <strong style={{ fontSize: 13 }}>{cmd.label}</strong>
                            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginLeft: 8 }}>{cmd.sub}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {matchedCourseItems.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  课程与讲次（{matchedCourseItems.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {matchedCourseItems.map((ci, i) => {
                    const flatIdx = courseOffset + i;
                    const active = flatIdx === safeIndex;
                    return (
                      <button
                        key={ci.id}
                        ref={(el) => {
                          itemRefs.current[flatIdx] = el;
                        }}
                        type="button"
                        data-active={active ? 'true' : 'false'}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => executeCourseItem(ci)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: active ? '1px solid var(--accent)' : '1px solid var(--border-hairline)',
                          background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ci.title}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{ci.sub}</div>
                        </div>
                        <span className={`badge ${ci.entryType === 'lecture' ? 'badge-info' : 'badge-neutral'}`} style={{ flexShrink: 0 }}>
                          {ci.entryType === 'lecture' ? '进入白板 →' : '课程空间'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {matchedTopics.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  学科专题参考（{matchedTopics.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matchedTopics.map((t, i) => {
                    const flatIdx = topicOffset + i;
                    const active = flatIdx === safeIndex;
                    return (
                      <div
                        key={t.id}
                        ref={(el) => {
                          itemRefs.current[flatIdx] = el;
                        }}
                        data-active={active ? 'true' : 'false'}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: active ? '1px solid var(--accent)' : '1px solid var(--border-hairline)',
                          background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        }}
                      >
                        <div
                          style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                          onClick={() => {
                            onApplyPedagogyToTutor(t);
                            onClose();
                          }}
                        >
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
                    );
                  })}
                </div>
              </div>
            )}

            {matchedArts.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, paddingLeft: 4 }}>
                  本地已编译产出物（{matchedArts.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {matchedArts.map((a, i) => {
                    const flatIdx = artOffset + i;
                    const active = flatIdx === safeIndex;
                    return (
                      <div
                        key={a.id}
                        ref={(el) => {
                          itemRefs.current[flatIdx] = el;
                        }}
                        data-active={active ? 'true' : 'false'}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: active ? '1px solid var(--accent)' : '1px solid var(--border-hairline)',
                          background: active ? 'var(--accent-soft)' : undefined,
                        }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</span>
                        <a
                          ref={(el) => {
                            artifactLinkRefs.current[a.id] = el;
                          }}
                          href={resolveApiUrl(a.download_url)}
                          download={a.filename}
                          onClick={(e) => handleSafeDownload(e, a.download_url, a.filename)}
                          className="btn btn-surface btn-sm"
                          style={{ textDecoration: 'none' }}
                        >
                          <IconDownloadBox size={12} /> 下载
                        </a>
                      </div>
                    );
                  })}
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
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span>
              {WORKBENCH_COMMANDS.length} 个功能 · {courses.length} 门课程 · {topics.length} 个专题 · {artifacts.length} 份文件
            </span>
            <span className="mono-num">↑↓ 移动 · Enter 确认 · Esc 关闭</span>
          </div>
        </div>
      </div>
    </div>
  );
};
