import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from './services/api';
import {
  AgentLinkedItem,
  AgentThread,
  ArtifactItem,
  CheatsheetData,
  CourseRecord,
  HkRoute,
  HomeTab,
  LLMStatusSummary,
  MindMapRecord,
  PedagogyTopic,
  SourceDocMeta,
  TeachTab,
  TeachingTransferPayload,
  TutorSubTab,
  WeeklyTracker,
} from './types';
import { HkSidebar } from './components/HkSidebar';
import { HkTopBar } from './components/HkTopBar';
import { HkSettingsModal } from './components/HkSettingsModal';
import { HkChangelogModal } from './components/HkChangelogModal';
import { ArtifactVaultDrawer } from './components/ArtifactVaultDrawer';
import { SurveyInsightsModal } from './components/SurveyInsightsModal';
import { PedagogyVaultModal } from './components/PedagogyVaultModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';

import { HkHomeView } from './views/HkHomeView';
import { HkMyCoursesView } from './views/HkMyCoursesView';
import { HkCourseSpaceView } from './views/HkCourseSpaceView';
import { HkCheatsheetView } from './views/HkCheatsheetView';
import { HkLearningFeedView } from './views/HkLearningFeedView';
import { HkMarketplaceView } from './views/HkMarketplaceView';
import { HkHistoryView } from './views/HkHistoryView';
import { HkKnowledgeBaseView } from './views/HkKnowledgeBaseView';

const HkWhiteboardView = lazy(() =>
  import('./views/HkWhiteboardView').then((m) => ({ default: m.HkWhiteboardView }))
);
const MindMapDrawioWorkbench = lazy(() =>
  import('./components/MindMapDrawioWorkbench').then((m) => ({ default: m.MindMapDrawioWorkbench }))
);
const TutorWorkspace = lazy(() =>
  import('./workspaces/TutorWorkspace').then((m) => ({ default: m.TutorWorkspace }))
);
const LessonWorkspace = lazy(() =>
  import('./workspaces/LessonWorkspace').then((m) => ({ default: m.LessonWorkspace }))
);
const PptStudioWorkspace = lazy(() =>
  import('./workspaces/PptStudioWorkspace').then((m) => ({ default: m.PptStudioWorkspace }))
);
const ExamBuilderWorkspace = lazy(() =>
  import('./workspaces/ExamBuilderWorkspace').then((m) => ({ default: m.ExamBuilderWorkspace }))
);
const AnalyticsWorkspace = lazy(() =>
  import('./workspaces/AnalyticsWorkspace').then((m) => ({ default: m.AnalyticsWorkspace }))
);

interface ParsedHashState {
  route: HkRoute;
  homeTab: HomeTab;
  courseId?: string;
  lectureId?: string;
  threadId?: string;
}

const VALID_TOOL_ROUTES = new Set<string>(['tutor', 'lesson', 'ppt', 'exam', 'analytics', 'mindmap']);

function parseHashLocation(hashStr: string): ParsedHashState {
  const clean = (hashStr || '').replace(/^#\/?/, '').trim();
  if (!clean || clean === 'home') return { route: 'home', homeTab: 'craft' };
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'home' && parts[1] === 'instant') {
    return { route: 'home', homeTab: 'instant', threadId: parts[2] };
  }
  if (parts[0] === 'courses') return { route: 'courses', homeTab: 'craft' };
  if (parts[0] === 'calendar') return { route: 'calendar', homeTab: 'craft' };
  if (parts[0] === 'history') return { route: 'history', homeTab: 'craft' };
  if (parts[0] === 'marketplace') return { route: 'marketplace', homeTab: 'craft' };
  if (parts[0] === 'kb') return { route: 'kb', homeTab: 'craft' };
  if (parts[0] === 'course' && parts[1]) {
    return { route: 'course_space', homeTab: 'craft', courseId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'whiteboard' && parts[1]) {
    return {
      route: 'whiteboard',
      homeTab: 'craft',
      courseId: decodeURIComponent(parts[1]),
      lectureId: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    };
  }
  if (parts[0] === 'cheatsheet') {
    return {
      route: 'cheatsheet',
      homeTab: 'craft',
      courseId: parts[1] ? decodeURIComponent(parts[1]) : undefined,
    };
  }
  if (parts[0] === 'tool' && parts[1] && VALID_TOOL_ROUTES.has(parts[1])) {
    return { route: `tool_${parts[1]}` as HkRoute, homeTab: 'craft' };
  }
  return { route: 'home', homeTab: 'craft' };
}

export const App: React.FC = () => {
  const initialHash = typeof window !== 'undefined' ? parseHashLocation(window.location.hash) : { route: 'home' as HkRoute, homeTab: 'craft' as HomeTab };
  const [route, setRoute] = useState<HkRoute>(initialHash.route);
  const [prevRoute, setPrevRoute] = useState<HkRoute>('home');
  const [homeTab, setHomeTab] = useState<HomeTab>(initialHash.homeTab);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [llmStatus, setLlmStatus] = useState<LLMStatusSummary | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [weeklyTracker, setWeeklyTracker] = useState<WeeklyTracker | null>(null);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialHash.threadId || null);

  const [activeCourse, setActiveCourse] = useState<CourseRecord | null>(null);
  const [activeCourseMaterials, setActiveCourseMaterials] = useState<SourceDocMeta[]>([]);
  const [activeLectureId, setActiveLectureId] = useState<string>(initialHash.lectureId || '');
  const [cheatsheetTopic, setCheatsheetTopic] = useState<string>('函数单调性与导数');
  const [externalCheatsheetData, setExternalCheatsheetData] = useState<CheatsheetData | null>(null);
  const [externalCraftDraft, setExternalCraftDraft] = useState<string | null>(null);
  const [externalInstantPrompt, setExternalInstantPrompt] = useState<string | null>(null);
  const [restoringDeepRoute, setRestoringDeepRoute] = useState<boolean>(Boolean(initialHash.courseId));

  // Specialist cross-open parameters
  const [tutorTab, setTutorTab] = useState<TutorSubTab>('solve');
  const [externalTutorPrompt, setExternalTutorPrompt] = useState<{ subject: string; grade: string; question: string } | null>(null);
  const [externalMindmap, setExternalMindmap] = useState<MindMapRecord | null>(null);
  const [externalLessonId, setExternalLessonId] = useState<string | null>(null);
  const [externalDeckId, setExternalDeckId] = useState<string | null>(null);
  const [externalExamId, setExternalExamId] = useState<string | null>(null);
  const [externalExamView, setExternalExamView] = useState<'student' | 'teacher' | 'take' | 'edit'>('take');
  const [transferPayload, setTransferPayload] = useState<TeachingTransferPayload | null>(null);

  // Modals & Drawers
  const [vaultOpen, setVaultOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [pedagogyOpen, setPedagogyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'memory' | 'model'>('general');
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const cheatsheetCourseSeqRef = useRef(0);

  const navigateTo = useCallback(
    (next: HkRoute) => {
      setPrevRoute((curr) => (route.startsWith('tool_') ? curr : route));
      setRoute(next);
    },
    [route]
  );

  const refreshSystemAndArtifacts = useCallback(async () => {
    try {
      const [sysRes, artRes] = await Promise.all([
        apiJson<{ llm: LLMStatusSummary }>('/api/system/status'),
        apiJson<{ artifacts: ArtifactItem[] }>('/api/artifacts'),
      ]);
      setLlmStatus(sysRes.llm);
      setArtifacts(artRes.artifacts || []);
    } catch {
      /* ignore transient */
    }
  }, []);

  const refreshCourses = useCallback(async () => {
    try {
      const res = await apiJson<{ courses: CourseRecord[]; weekly_tracker: WeeklyTracker }>('/api/courses');
      setCourses(res.courses || []);
      setWeeklyTracker(res.weekly_tracker || null);
      if (activeCourse) {
        const hit = (res.courses || []).find((c) => c.id === activeCourse.id);
        if (hit) setActiveCourse(hit);
      }
    } catch {
      /* ignore */
    }
  }, [activeCourse?.id]);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await apiJson<{ threads: AgentThread[] }>('/api/agent/threads');
      setThreads(res.threads || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshSystemAndArtifacts();
    refreshCourses();
    refreshThreads();
  }, [refreshSystemAndArtifacts, refreshCourses, refreshThreads]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openCourseSpace = useCallback(async (courseId: string) => {
    try {
      const res = await apiJson<{ course: CourseRecord; materials: SourceDocMeta[] }>(`/api/courses/${courseId}`);
      if (res.course) {
        setActiveCourse(res.course);
        setActiveCourseMaterials(res.materials || []);
        navigateTo('course_space');
        return;
      }
    } catch {
      /* fallback local */
    }
    const local = courses.find((c) => c.id === courseId) || (activeCourse?.id === courseId ? activeCourse : null);
    if (local) {
      if (activeCourse?.id !== courseId) {
        setActiveCourseMaterials([]);
      }
      setActiveCourse(local);
      navigateTo('course_space');
    } else {
      navigateTo('courses');
    }
  }, [activeCourse, courses, navigateTo]);

  const openWhiteboard = useCallback(async (courseId: string, lectureId?: string) => {
    let targetCourse = courses.find((c) => c.id === courseId) || (activeCourse?.id === courseId ? activeCourse : null);
    let appliedRemote = false;
    try {
      const res = await apiJson<{ course: CourseRecord; materials: SourceDocMeta[] }>(`/api/courses/${courseId}`);
      if (res.course) {
        targetCourse = res.course;
        appliedRemote = true;
        setActiveCourse(res.course);
        setActiveCourseMaterials(res.materials || []);
      }
    } catch {
      /* fallback local */
    }
    if (!targetCourse) {
      navigateTo('courses');
      return;
    }
    if (!appliedRemote) {
      if (activeCourse?.id !== courseId) {
        setActiveCourseMaterials([]);
      }
      setActiveCourse(targetCourse);
    }
    const lid =
      lectureId ||
      targetCourse.last_lecture_id ||
      targetCourse.next_lecture?.id ||
      targetCourse.units?.[0]?.lectures?.[0]?.id ||
      '';
    setActiveLectureId(lid);
    navigateTo('whiteboard');
  }, [activeCourse, courses, navigateTo]);

  // Restore deep hash routes (course / whiteboard / cheatsheet) on mount & browser Back/Forward
  useEffect(() => {
    const hydrateFromHash = async (hashStr: string) => {
      const parsed = parseHashLocation(hashStr);
      setHomeTab(parsed.homeTab);
      setActiveThreadId(parsed.threadId || null);
      if (parsed.courseId) {
        setRestoringDeepRoute(true);
        try {
          const res = await apiJson<{ course: CourseRecord; materials: SourceDocMeta[] }>(`/api/courses/${parsed.courseId}`);
          if (res.course) {
            setActiveCourse(res.course);
            setActiveCourseMaterials(res.materials || []);
            if (parsed.route === 'whiteboard') {
              const fallbackLid =
                parsed.lectureId ||
                res.course.last_lecture_id ||
                res.course.next_lecture?.id ||
                res.course.units?.[0]?.lectures?.[0]?.id ||
                '';
              setActiveLectureId(fallbackLid);
            }
            setRoute(parsed.route);
          } else {
            setRoute('courses');
          }
        } catch {
          setRoute('courses');
        } finally {
          setRestoringDeepRoute(false);
        }
      } else {
        if (parsed.route === 'cheatsheet' && !parsed.courseId) {
          setActiveCourse(null);
        }
        setRoute(parsed.route);
      }
    };

    if (initialHash.courseId) {
      hydrateFromHash(window.location.hash);
    }

    const onHashChange = () => {
      hydrateFromHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync reactive app state -> URL hash cleanly without clobbering restoring routes
  useEffect(() => {
    if (restoringDeepRoute) return;
    let nextHash = '#/home';
    if (route === 'home') {
      nextHash =
        homeTab === 'instant'
          ? activeThreadId
            ? `#/home/instant/${encodeURIComponent(activeThreadId)}`
            : '#/home/instant'
          : '#/home';
    } else if (route === 'courses' || route === 'calendar' || route === 'history' || route === 'marketplace' || route === 'kb') {
      nextHash = `#/${route}`;
    } else if (route === 'course_space') {
      if (!activeCourse) return;
      nextHash = `#/course/${encodeURIComponent(activeCourse.id)}`;
    } else if (route === 'whiteboard') {
      if (!activeCourse) return;
      const lid = activeLectureId || activeCourse.last_lecture_id || activeCourse.units?.[0]?.lectures?.[0]?.id || '';
      nextHash = lid
        ? `#/whiteboard/${encodeURIComponent(activeCourse.id)}/${encodeURIComponent(lid)}`
        : `#/course/${encodeURIComponent(activeCourse.id)}`;
    } else if (route === 'cheatsheet') {
      nextHash = activeCourse ? `#/cheatsheet/${encodeURIComponent(activeCourse.id)}` : '#/cheatsheet';
    } else if (route.startsWith('tool_')) {
      nextHash = `#/tool/${route.slice('tool_'.length)}`;
    }

    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [route, homeTab, activeCourse, activeLectureId, activeThreadId, restoringDeepRoute]);

  const handleOpenContinueWhiteboard = () => {
    const cont = weeklyTracker?.continue_learning;
    if (cont) {
      openWhiteboard(cont.course_id, cont.lecture_id);
      return;
    }
    if (courses[0]) {
      openWhiteboard(courses[0].id);
      return;
    }
    navigateTo('courses');
  };

  const handleEnrollAndOpen = async (marketId: string) => {
    try {
      const res = await apiJson<{ course: CourseRecord }>('/api/courses/enroll', {
        method: 'POST',
        body: JSON.stringify({ market_id: marketId }),
      });
      if (res.course) {
        await refreshCourses();
        setActiveCourse(res.course);
        setActiveCourseMaterials([]);
        navigateTo('course_space');
      }
    } catch {
      navigateTo('marketplace');
    }
  };

  const handleTransferToTeach = (payload: TeachingTransferPayload) => {
    setTransferPayload(payload);
    const mapTab: Record<TeachTab, HkRoute> = {
      lesson: 'tool_lesson',
      ppt: 'tool_ppt',
      exam: 'tool_exam',
      analytics: 'tool_analytics',
    };
    navigateTo(mapTab[payload.target_tab]);
  };

  const handleOpenLinkedItem = async (item: AgentLinkedItem, openMode?: 'take' | 'view') => {
    if (item.kind === 'lesson') {
      setExternalLessonId(item.id);
      navigateTo('tool_lesson');
    } else if (item.kind === 'ppt') {
      setExternalDeckId(item.id);
      navigateTo('tool_ppt');
    } else if (item.kind === 'exam') {
      setExternalExamId(item.id);
      setExternalExamView(openMode === 'take' ? 'take' : 'teacher');
      navigateTo('tool_exam');
    } else if (item.kind === 'mindmap') {
      try {
        const res = await apiJson<{ mindmaps: MindMapRecord[] }>('/api/mindmap/list');
        const found = res.mindmaps.find((m) => m.id === item.id) || res.mindmaps[0];
        if (found) setExternalMindmap(found);
      } catch {
        /* ignore */
      }
      navigateTo('tool_mindmap');
    } else if (item.kind === 'tutor') {
      setExternalTutorPrompt({
        subject: item.subject || '高中数学',
        grade: item.grade_level || '高二年级',
        question: item.question_text || item.title,
      });
      setTutorTab('solve');
      navigateTo('tool_tutor');
    } else if (item.kind === 'course') {
      await refreshCourses();
      await openCourseSpace(item.id);
    } else if (item.kind === 'cheatsheet') {
      setActiveCourse(null);
      setCheatsheetTopic(item.title);
      setExternalCheatsheetData(item.cheatsheet_data || null);
      navigateTo('cheatsheet');
    } else if (item.kind === 'plan') {
      navigateTo('calendar');
    }
  };

  const formatPedagogyContext = (t: PedagogyTopic) =>
    `【主题】${t.title}\n【直观模型】${t.intuition_models.map((m) => `${m.name}: ${m.desc}`).join('；')}\n【讲解脉络】${t.teaching_flow.join(' -> ')}\n【微格开场】${t.micro_teaching_hook}\n【易错反例】${t.pitfalls_and_counterexamples.join('；')}\n【板书金句】${t.board_punchline}`;

  const isDotCanvasRoute = route === 'home' || route === 'courses' || route === 'calendar' || route === 'marketplace' || route === 'course_space' || route === 'history' || route === 'kb' || route === 'cheatsheet';
  const showSidebarShell = route !== 'whiteboard';

  return (
    <div className="hk-shell">
      {showSidebarShell && (
        <HkSidebar
          route={route}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileMenuOpen}
          weeklyTracker={weeklyTracker}
          threads={threads}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onNavigate={(r) => {
            if (r === 'whiteboard') {
              handleOpenContinueWhiteboard();
              return;
            }
            if (r === 'home') {
              setActiveThreadId(null);
            }
            if (r === 'cheatsheet') {
              setExternalCheatsheetData(null);
            }
            navigateTo(r);
          }}
          onOpenContinueWhiteboard={handleOpenContinueWhiteboard}
          onOpenThread={(tid) => {
            setActiveThreadId(tid);
            setHomeTab('instant');
            navigateTo('home');
          }}
          onOpenChangelog={() => setChangelogOpen(true)}
        />
      )}

      <div className={`hk-main-column ${isDotCanvasRoute ? 'hk-dot-canvas' : ''}`}>
        {route !== 'whiteboard' && (
          <HkTopBar
            route={route}
            homeTab={homeTab}
            sidebarCollapsed={sidebarCollapsed}
            llmStatus={llmStatus}
            artifactCount={artifacts.length}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onChangeHomeTab={(tab) => {
              setHomeTab(tab);
              setActiveThreadId(null);
            }}
            onOpenVault={() => setVaultOpen(true)}
            onOpenSettings={(t = 'general') => {
              setSettingsTab(t);
              setSettingsOpen(true);
            }}
            onNavigate={navigateTo}
            onOpenPedagogy={() => setPedagogyOpen(true)}
            onOpenInsights={() => setInsightsOpen(true)}
            onBackFromTool={() => setRoute(prevRoute === route ? 'home' : prevRoute)}
            onOpenCommandPalette={() => setCmdkOpen(true)}
          />
        )}

        <main style={{ flex: 1, minHeight: 0 }}>
          {restoringDeepRoute && (route === 'course_space' || route === 'whiteboard') && !activeCourse && (
            <div className="hk-page-wrap">
              <div className="paper-folio" style={{ padding: 28, textAlign: 'center', color: '#6b7280' }}>
                正在恢复课程进度与白板内容…
              </div>
            </div>
          )}

          {route === 'home' && (
            <HkHomeView
              homeTab={homeTab}
              activeThreadId={activeThreadId}
              externalCraftDraft={externalCraftDraft}
              onConsumeCraftDraft={() => setExternalCraftDraft(null)}
              externalInstantPrompt={externalInstantPrompt}
              onConsumeInstantPrompt={() => setExternalInstantPrompt(null)}
              onSelectThread={setActiveThreadId}
              onCourseCrafted={async (course) => {
                await refreshCourses();
                setActiveCourse(course);
                setActiveCourseMaterials([]);
                navigateTo('course_space');
              }}
              onOpenMarketplaceCourse={handleEnrollAndOpen}
              onNavigate={(r) => {
                if (r === 'whiteboard') handleOpenContinueWhiteboard();
                else navigateTo(r);
              }}
              onOpenLinkedItem={handleOpenLinkedItem}
              onThreadsChanged={refreshThreads}
              onArtifactsChanged={refreshSystemAndArtifacts}
              onOpenCustomCheatsheet={(topic) => {
                setActiveCourse(null);
                setExternalCheatsheetData(null);
                setCheatsheetTopic(topic);
                navigateTo('cheatsheet');
              }}
            />
          )}

          {route === 'courses' && (
            <HkMyCoursesView
              courses={courses}
              weeklyTracker={weeklyTracker}
              onOpenCourseSpace={openCourseSpace}
              onOpenWhiteboard={openWhiteboard}
              onOpenCheatsheet={async (cid) => {
                setExternalCheatsheetData(null);
                await openCourseSpace(cid);
                setRoute('cheatsheet');
              }}
              onOpenMarketplace={() => navigateTo('marketplace')}
              onGoCreateCourse={() => {
                setHomeTab('craft');
                navigateTo('home');
              }}
              onCourseDeleted={(cid) => {
                if (activeCourse?.id === cid) setActiveCourse(null);
                refreshCourses();
              }}
            />
          )}

          {route === 'course_space' && activeCourse && (
            <HkCourseSpaceView
              key={activeCourse.id}
              course={activeCourse}
              materials={activeCourseMaterials}
              onBack={() => navigateTo('courses')}
              onCourseUpdated={(updated) => {
                setActiveCourse(updated);
                refreshCourses();
              }}
              onOpenWhiteboard={(lid) => openWhiteboard(activeCourse.id, lid)}
              onOpenCheatsheet={() => {
                setExternalCheatsheetData(null);
                navigateTo('cheatsheet');
              }}
              onOpenCalendar={() => navigateTo('calendar')}
              onAskInstantHelp={(prompt) => {
                setHomeTab('instant');
                setActiveThreadId(null);
                setExternalInstantPrompt(prompt);
                navigateTo('home');
              }}
              onOpenLinkedTool={async (kind, id) => {
                if (kind === 'exam') {
                  setExternalExamId(id);
                  setExternalExamView('take');
                  setPrevRoute('course_space');
                  setRoute('tool_exam');
                } else if (kind === 'ppt') {
                  setExternalDeckId(id);
                  setPrevRoute('course_space');
                  setRoute('tool_ppt');
                } else if (kind === 'lesson') {
                  setExternalLessonId(id);
                  setPrevRoute('course_space');
                  setRoute('tool_lesson');
                } else if (kind === 'mindmap') {
                  try {
                    const res = await apiJson<{ mindmaps: MindMapRecord[] }>('/api/mindmap/list');
                    const found = (res.mindmaps || []).find((m) => m.id === id) || res.mindmaps?.[0];
                    if (found) setExternalMindmap(found);
                  } catch {
                    /* ignore */
                  }
                  setPrevRoute('course_space');
                  setRoute('tool_mindmap');
                }
              }}
            />
          )}

          {route === 'whiteboard' && activeCourse && (
            <Suspense
              fallback={
                <div className="hk-page-wrap">
                  <div className="paper-folio" style={{ padding: 28, textAlign: 'center', color: '#6b7280' }}>
                    正在载入互动白板课堂…
                  </div>
                </div>
              }
            >
              <HkWhiteboardView
                key={activeCourse.id}
                course={activeCourse}
                lectureId={activeLectureId}
                onExit={() => {
                  refreshCourses();
                  setRoute('course_space');
                }}
                onCourseUpdated={(updated) => {
                  setActiveCourse(updated);
                  refreshCourses();
                }}
                onOpenCheatsheet={() => {
                  setExternalCheatsheetData(null);
                  setPrevRoute('whiteboard');
                  setRoute('cheatsheet');
                }}
                onSelectLecture={(lid) => setActiveLectureId(lid)}
              />
            </Suspense>
          )}

          {route === 'cheatsheet' && (
            <HkCheatsheetView
              course={activeCourse}
              courses={courses}
              initialTopic={cheatsheetTopic}
              initialData={externalCheatsheetData}
              backLabel={prevRoute === 'whiteboard' && activeCourse ? '返回白板课堂' : undefined}
              onSelectCourse={(cid) => {
                const reqSeq = ++cheatsheetCourseSeqRef.current;
                setExternalCheatsheetData(null);
                const switching = !cid || cid !== activeCourse?.id;
                if (switching && prevRoute === 'whiteboard') {
                  setPrevRoute('course_space');
                }
                if (!cid) {
                  setActiveCourse(null);
                  setActiveCourseMaterials([]);
                  setActiveLectureId('');
                  return;
                }
                if (switching) {
                  setActiveCourseMaterials([]);
                }
                const local = courses.find((c) => c.id === cid) || null;
                if (local) {
                  setActiveCourse(local);
                  if (switching) {
                    setActiveLectureId(
                      local.last_lecture_id ||
                        local.next_lecture?.id ||
                        local.units?.[0]?.lectures?.[0]?.id ||
                        ''
                    );
                  }
                } else if (switching) {
                  setActiveLectureId('');
                }
                apiJson<{ course: CourseRecord; materials: SourceDocMeta[] }>(`/api/courses/${cid}`)
                  .then((res) => {
                    if (reqSeq !== cheatsheetCourseSeqRef.current) return;
                    if (res.course) {
                      const c = res.course;
                      setActiveCourse(c);
                      setActiveCourseMaterials(res.materials || []);
                      if (switching) {
                        setActiveLectureId(
                          c.last_lecture_id ||
                            c.next_lecture?.id ||
                            c.units?.[0]?.lectures?.[0]?.id ||
                            ''
                        );
                      }
                    }
                  })
                  .catch(() => {});
              }}
              onBack={() => {
                setExternalCheatsheetData(null);
                if (prevRoute === 'whiteboard' && activeCourse) {
                  setRoute('whiteboard');
                } else if (activeCourse) {
                  setRoute('course_space');
                } else {
                  setRoute('home');
                }
              }}
              onCourseUpdated={(updated) => {
                setActiveCourse(updated);
                refreshCourses();
              }}
            />
          )}

          {route === 'calendar' && (
            <HkLearningFeedView
              onStartRemediationExam={(examId) => {
                setExternalExamId(examId);
                setExternalExamView('take');
                setPrevRoute('calendar');
                setRoute('tool_exam');
              }}
            />
          )}

          {route === 'marketplace' && (
            <HkMarketplaceView
              onCourseEnrolled={async (course) => {
                await refreshCourses();
                setActiveCourse(course);
                setActiveCourseMaterials([]);
                navigateTo('course_space');
              }}
            />
          )}

          {route === 'history' && (
            <HkHistoryView
              threads={threads}
              courses={courses}
              onNewChat={() => {
                setActiveThreadId(null);
                setHomeTab('instant');
                navigateTo('home');
              }}
              onOpenThread={(tid) => {
                setActiveThreadId(tid);
                setHomeTab('instant');
                navigateTo('home');
              }}
              onOpenCourseWhiteboard={openWhiteboard}
              onOpenSpecialist={(specRoute, itemId) => {
                if (specRoute === 'tool_ppt' && itemId) setExternalDeckId(itemId);
                if (specRoute === 'tool_lesson' && itemId) setExternalLessonId(itemId);
                if (specRoute === 'tool_exam' && itemId) {
                  setExternalExamId(itemId);
                  setExternalExamView('take');
                }
                if (specRoute === 'tool_tutor') {
                  setTutorTab('errorbook');
                }
                setPrevRoute('history');
                setRoute(specRoute);
              }}
            />
          )}

          {route === 'kb' && (
            <HkKnowledgeBaseView
              onBuildCourseFromDoc={(doc) => {
                setHomeTab('craft');
                setActiveThreadId(null);
                setExternalCraftDraft(`请围绕个人知识库资料《${doc.title}》打造一门结构化课程，自动生成单元讲次、板书路线与巩固测验`);
                navigateTo('home');
              }}
            />
          )}

          {/* Embedded Specialist Workspaces (code-split lazy loaded) */}
          <Suspense
            fallback={
              <div className="hk-page-wrap">
                <div className="paper-folio" style={{ padding: 28, textAlign: 'center', color: '#6b7280' }}>
                  正在载入专项工作台…
                </div>
              </div>
            }
          >
            {route === 'tool_tutor' && (
              <TutorWorkspace
                activeSubTab={tutorTab}
                onChangeSubTab={setTutorTab}
                onArtifactsChanged={refreshSystemAndArtifacts}
                onSolutionReady={() => {}}
                onTransferToTeach={handleTransferToTeach}
                externalPrompt={externalTutorPrompt}
                onConsumeExternalPrompt={() => setExternalTutorPrompt(null)}
                externalMindmap={externalMindmap}
                onConsumeExternalMindmap={() => setExternalMindmap(null)}
                onOpenPedagogyVault={() => setPedagogyOpen(true)}
              />
            )}

            {route === 'tool_lesson' && (
              <LessonWorkspace
                transferPayload={transferPayload}
                onConsumeTransfer={() => setTransferPayload(null)}
                externalLessonId={externalLessonId}
                onConsumeExternalLesson={() => setExternalLessonId(null)}
                onArtifactsChanged={refreshSystemAndArtifacts}
                onGeneratePptFromLesson={(title, subject, grade, material, domain, branch) =>
                  handleTransferToTeach({ title, subject, grade_level: grade, domain, branch, context_summary: material, target_tab: 'ppt' })
                }
              />
            )}

            {route === 'tool_ppt' && (
              <PptStudioWorkspace
                transferPayload={transferPayload}
                onConsumeTransfer={() => setTransferPayload(null)}
                externalDeckId={externalDeckId}
                onConsumeExternalDeck={() => setExternalDeckId(null)}
                onArtifactsChanged={refreshSystemAndArtifacts}
              />
            )}

            {route === 'tool_exam' && (
              <ExamBuilderWorkspace
                externalExamId={externalExamId}
                externalViewMode={externalExamView}
                onConsumeExternalExam={() => setExternalExamId(null)}
                onArtifactsChanged={refreshSystemAndArtifacts}
                onExportExamToPpt={(title, subject, grade, material, domain, branch) =>
                  handleTransferToTeach({ title, subject, grade_level: grade, domain, branch, context_summary: material, target_tab: 'ppt' })
                }
              />
            )}

            {route === 'tool_analytics' && (
              <AnalyticsWorkspace
                onArtifactsChanged={refreshSystemAndArtifacts}
                onExportAnalyticsToPpt={(title, subject, grade, material, domain, branch) =>
                  handleTransferToTeach({ title, subject, grade_level: grade, domain, branch, context_summary: material, target_tab: 'ppt' })
                }
                onCreateRemediationQuiz={async (weakTopics = []) => {
                  try {
                    const res = await apiJson<{ exam_record?: { id: string }; exam_id?: string }>(
                      '/api/agent/memory/remediation-quiz',
                      {
                        method: 'POST',
                        body: JSON.stringify({ weak_topics: weakTopics, topics: weakTopics, count: 4 }),
                      }
                    );
                    const examId = res.exam_record?.id || res.exam_id;
                    if (examId) {
                      setExternalExamId(examId);
                      setExternalExamView('take');
                      setPrevRoute('tool_analytics');
                      setRoute('tool_exam');
                      refreshSystemAndArtifacts();
                    }
                  } catch (err) {
                    throw err;
                  }
                }}
              />
            )}

            {route === 'tool_mindmap' && (
              <div className="hk-page-wrap">
                <MindMapDrawioWorkbench
                  externalMap={externalMindmap}
                  onArtifactsChanged={refreshSystemAndArtifacts}
                />
              </div>
            )}
          </Suspense>
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <HkSettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        llmStatus={llmStatus}
        onClose={() => setSettingsOpen(false)}
        onLlmUpdated={setLlmStatus}
        onStartRemediationExam={(examId) => {
          setExternalExamId(examId);
          setExternalExamView('take');
          setPrevRoute(route);
          setRoute('tool_exam');
        }}
      />

      <HkChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      <ArtifactVaultDrawer
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        artifacts={artifacts}
        onDelete={async (id) => {
          await apiJson(`/api/artifacts/${id}`, { method: 'DELETE' });
          refreshSystemAndArtifacts();
        }}
      />

      <SurveyInsightsModal
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        onPurged={() => {
          refreshSystemAndArtifacts();
          refreshCourses();
          refreshThreads();
        }}
      />

      <PedagogyVaultModal
        open={pedagogyOpen}
        onClose={() => setPedagogyOpen(false)}
        onCreateMindmap={async (topic) => {
          try {
            const res = await apiJson<{ mindmap: MindMapRecord }>('/api/mindmap/from-topic', {
              method: 'POST',
              body: JSON.stringify({ topic_id: topic.id }),
            });
            setExternalMindmap(res.mindmap);
            setPedagogyOpen(false);
            navigateTo('tool_mindmap');
            refreshSystemAndArtifacts();
          } catch {
            /* ignore */
          }
        }}
        onApplyToTutor={(topic) => {
          setExternalTutorPrompt({
            subject: topic.subject,
            grade: topic.grade_level,
            question: `请运用“${topic.intuition_models[0]?.name}”等直观视角，系统讲解《${topic.title}》，并剖析以下高频易错点：${topic.pitfalls_and_counterexamples[0]}`,
          });
          setTutorTab('solve');
          setPedagogyOpen(false);
          navigateTo('tool_tutor');
        }}
        onApplyToLesson={(topic) => {
          handleTransferToTeach({
            title: topic.title.split('：')[0],
            subject: topic.subject,
            grade_level: topic.grade_level,
            context_summary: formatPedagogyContext(topic),
            target_tab: 'lesson',
          });
          setPedagogyOpen(false);
        }}
        onApplyToPpt={(topic) => {
          handleTransferToTeach({
            title: topic.title.split('：')[0],
            subject: topic.subject,
            grade_level: topic.grade_level,
            context_summary: formatPedagogyContext(topic),
            target_tab: 'ppt',
          });
          setPedagogyOpen(false);
        }}
      />

      <CommandPaletteModal
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        artifacts={artifacts}
        courses={courses}
        onNavigateRoute={(r, tab) => {
          if (r === 'whiteboard') {
            handleOpenContinueWhiteboard();
            return;
          }
          if (r === 'home') {
            if (tab) setHomeTab(tab);
            setActiveThreadId(null);
          }
          if (r === 'cheatsheet') {
            setExternalCheatsheetData(null);
          }
          navigateTo(r);
        }}
        onOpenCourseSpace={(cid) => {
          void openCourseSpace(cid);
        }}
        onOpenWhiteboard={(cid, lid) => {
          void openWhiteboard(cid, lid);
        }}
        onNavigateAgent={() => {
          setHomeTab('instant');
          navigateTo('home');
        }}
        onNavigateTutor={(tab) => {
          setTutorTab(tab);
          navigateTo('tool_tutor');
        }}
        onNavigateTeach={(tab) => {
          const mapTab: Record<TeachTab, HkRoute> = {
            lesson: 'tool_lesson',
            ppt: 'tool_ppt',
            exam: 'tool_exam',
            analytics: 'tool_analytics',
          };
          navigateTo(mapTab[tab]);
        }}
        onApplyPedagogyToTutor={(topic) => {
          setExternalTutorPrompt({
            subject: topic.subject,
            grade: topic.grade_level,
            question: `请系统讲解《${topic.title}》的直观理解与易错反例。`,
          });
          setTutorTab('solve');
          navigateTo('tool_tutor');
        }}
        onApplyPedagogyToPpt={(topic) =>
          handleTransferToTeach({
            title: topic.title.split('：')[0],
            subject: topic.subject,
            grade_level: topic.grade_level,
            context_summary: formatPedagogyContext(topic),
            target_tab: 'ppt',
          })
        }
      />
    </div>
  );
};

export default App;
