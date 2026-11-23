import React, { useState } from 'react';
import { AgentThread, HkRoute, WeeklyTracker } from '../types';
import { UI_LABELS } from '../utils/i18n';
import { HkBrandLogo, HkIcon } from './HkAssets';

interface HkSidebarProps {
  route: HkRoute;
  collapsed: boolean;
  mobileOpen: boolean;
  weeklyTracker: WeeklyTracker | null;
  threads: AgentThread[];
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate: (route: HkRoute) => void;
  onOpenContinueWhiteboard: () => void;
  onOpenThread: (threadId: string) => void;
  onOpenChangelog: () => void;
}

export const HkSidebar: React.FC<HkSidebarProps> = ({
  route,
  collapsed,
  mobileOpen,
  weeklyTracker,
  threads,
  onToggleCollapse,
  onCloseMobile,
  onNavigate,
  onOpenContinueWhiteboard,
  onOpenThread,
  onOpenChangelog,
}) => {
  const [studiosExpanded, setStudiosExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const t = UI_LABELS.zh;

  const studioItems: { route: HkRoute; icon: 'solve' | 'quiz' | 'whiteboard' | 'lesson' | 'visual' | 'cheatsheet' | 'analytics'; label: string }[] = [
    { route: 'tool_tutor', icon: 'solve', label: t.toolTutor },
    { route: 'tool_exam', icon: 'quiz', label: t.toolExam },
    { route: 'tool_ppt', icon: 'whiteboard', label: t.toolPpt },
    { route: 'tool_lesson', icon: 'lesson', label: t.toolLesson },
    { route: 'tool_mindmap', icon: 'visual', label: t.toolMindmap },
    { route: 'cheatsheet', icon: 'cheatsheet', label: '学科速查表' },
    { route: 'tool_analytics', icon: 'analytics', label: t.toolAnalytics },
  ];

  const handleNav = (r: HkRoute) => {
    onNavigate(r);
    onCloseMobile();
  };

  const navActive = (targets: HkRoute[]) => targets.includes(route);

  return (
    <>
      {mobileOpen && <div className="hk-mobile-overlay" onClick={onCloseMobile} />}
      <aside className={`hk-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div>
          <div className="hk-sidebar-brand">
            <div className="hk-brand-left" onClick={() => handleNav('home')}>
              <HkBrandLogo size={26} />
              <span className="hk-brand-title">{t.brandName}</span>
            </div>
            <button
              type="button"
              className="hk-collapse-btn"
              title="收起侧边栏"
              aria-label="收起侧边栏"
              onClick={onToggleCollapse}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 17l-5-5 5-5" />
                <path d="M18 17l-5-5 5-5" />
              </svg>
            </button>
          </div>

          <nav className="hk-nav-list" aria-label="主导航">
            <button
              type="button"
              className={`hk-nav-item ${navActive(['home']) ? 'active' : ''}`}
              onClick={() => handleNav('home')}
            >
              <span className="hk-nav-item-left">
                <HkIcon name="home" size={18} />
                <span>{t.navHome}</span>
              </span>
            </button>

            <button
              type="button"
              className={`hk-nav-item ${navActive(['courses', 'course_space', 'whiteboard']) ? 'active' : ''}`}
              onClick={() => handleNav('courses')}
            >
              <span className="hk-nav-item-left">
                <HkIcon name="courses" size={18} />
                <span>{t.navCourses}</span>
              </span>
            </button>

            <button
              type="button"
              className={`hk-nav-item ${navActive(['marketplace']) ? 'active' : ''}`}
              onClick={() => handleNav('marketplace')}
            >
              <span className="hk-nav-item-left">
                <HkIcon name="market" size={18} />
                <span>{t.navMarket}</span>
              </span>
            </button>

            <button
              type="button"
              className={`hk-nav-item ${navActive(['calendar']) ? 'active' : ''}`}
              onClick={() => handleNav('calendar')}
            >
              <span className="hk-nav-item-left">
                <HkIcon name="calendar" size={18} />
                <span>{t.navCalendar}</span>
              </span>
            </button>

            <button
              type="button"
              className={`hk-nav-item ${navActive(['kb']) ? 'active' : ''}`}
              onClick={() => handleNav('kb')}
            >
              <span className="hk-nav-item-left">
                <HkIcon name="kb" size={18} />
                <span>{t.navKb}</span>
              </span>
            </button>
          </nav>

          <div className="hk-sidebar-divider" />

          {/* Featured Studio Highlights (always visible by default) */}
          <div>
            <div className="hk-sidebar-section-label" onClick={() => setStudiosExpanded((v) => !v)}>
              <span>{t.navStudiosTitle}</span>
              <span style={{ fontSize: 11 }}>{studiosExpanded ? '▾' : '▸'}</span>
            </div>
            {studiosExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {studioItems.map((item) => (
                  <button
                    key={item.route}
                    type="button"
                    className={`hk-studio-item ${route === item.route ? 'active' : ''}`}
                    onClick={() => handleNav(item.route)}
                  >
                    <span className="hk-nav-item-left">
                      <HkIcon name={item.icon} size={17} />
                      <span>{item.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Continue Learning Card */}
          {weeklyTracker?.continue_learning && (
            <div style={{ marginTop: 10 }}>
              <div className="hk-sidebar-section-label" style={{ cursor: 'default' }}>
                <span>{t.continueLearning}</span>
              </div>
              <button
                type="button"
                className="hk-continue-card"
                onClick={() => {
                  onOpenContinueWhiteboard();
                  onCloseMobile();
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span className="hk-badge-lecture">{t.lectureTag}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#181a1f',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {weeklyTracker.continue_learning.lecture_title}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {weeklyTracker.continue_learning.course_title}
                </div>
              </button>
            </div>
          )}

          {/* Recent Activity */}
          <div>
            <div className="hk-sidebar-section-label" onClick={() => setRecentExpanded((v) => !v)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>{t.recentActivity}</span>
                <span style={{ fontSize: 10 }}>{recentExpanded ? '▾' : '▸'}</span>
              </span>
              <button
                type="button"
                className={`hk-section-link ${route === 'history' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNav('history');
                }}
              >
                {t.viewAllHistory} ›
              </button>
            </div>
            {recentExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {threads.length === 0 ? (
                  <div style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                    <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>{t.noActivity}</div>
                    <div>{t.noActivitySub}</div>
                  </div>
                ) : (
                  threads.slice(0, 5).map((th) => (
                    <button
                      key={th.id}
                      type="button"
                      className="hk-recent-item"
                      title={th.title}
                      onClick={() => {
                        onOpenThread(th.id);
                        onCloseMobile();
                      }}
                    >
                      {th.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hk-sidebar-footer">
          <button
            type="button"
            className="hk-nav-item"
            style={{ fontSize: 12, color: '#6b7280', padding: '7px 10px' }}
            onClick={() => {
              onOpenChangelog();
              onCloseMobile();
            }}
          >
            <span className="hk-nav-item-left">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l2.5 2.5" />
              </svg>
              <span>{t.changelogBtn}</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
};
