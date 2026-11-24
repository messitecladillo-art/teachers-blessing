import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, isStaticDemoMode, postEventStream, resolveApiUrl } from '../services/api';
import { BoardBlock, CourseLecture, CourseRecord, MindMapRecord, SandboxPresetConfig } from '../types';
import { MathText } from '../components/MathText';
import { HkIcon, HkMascot } from '../components/HkAssets';
import { buildBlockNarration, extractPlottableFromBlock, latexToSpokenZh } from '../utils/speechMath';
import type { BoardEditorPayload } from '../components/WhiteboardBlockEditorModal';

const FunctionPlotCard = lazy(() =>
  import('../components/FunctionPlotCard').then((m) => ({ default: m.FunctionPlotCard }))
);
const MindMapDrawioWorkbench = lazy(() =>
  import('../components/MindMapDrawioWorkbench').then((m) => ({ default: m.MindMapDrawioWorkbench }))
);
const WhiteboardQuizPane = lazy(() =>
  import('../components/WhiteboardQuizPane').then((m) => ({ default: m.WhiteboardQuizPane }))
);
const WhiteboardBlockEditorModal = lazy(() =>
  import('../components/WhiteboardBlockEditorModal').then((m) => ({ default: m.WhiteboardBlockEditorModal }))
);

interface HkWhiteboardViewProps {
  course: CourseRecord;
  lectureId: string;
  onExit: () => void;
  onCourseUpdated: (c: CourseRecord) => void;
  onOpenCheatsheet: () => void;
  onSelectLecture: (lid: string) => void;
}

const VOICE_OPTIONS = [
  { id: 'zh_female_clear', name: '清晰女声 · 课堂领读', desc: '节奏平稳，适合板书梳理' },
  { id: 'zh_male_steady', name: '沉稳男声 · 推导精讲', desc: '逻辑感强，适合公式推导' },
  { id: 'zh_female_warm', name: '温和讲师 · 启发追问', desc: '适合反例讨论与问答' },
  { id: 'zh_male_fast', name: '精炼男声 · 考前串讲', desc: '语速紧凑，适合快速复习' },
];

const BLOCK_TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  concept: { label: '核心概念', cls: 'hk-wb-type-concept' },
  derivation: { label: '推导步骤', cls: 'hk-wb-type-derivation' },
  example: { label: '典例演算', cls: 'hk-wb-type-example' },
  trap: { label: '易错反例', cls: 'hk-wb-type-trap' },
  summary: { label: '课堂小结', cls: 'hk-wb-type-summary' },
};

const STROKES_STORAGE_KEY = 'eduforge_wb_strokes_v50';
const GROUP_Z6_PRESET: SandboxPresetConfig = { preset_id: 'cyclic_group', dimension: '2d' };
const RIEMANN_PRESET: SandboxPresetConfig = { preset_id: 'complex_surface', dimension: '3d' };

interface SavedStroke {
  id: string;
  color: string;
  width: number;
  opacity: number;
  d: string;
}

function loadSavedStrokes(): Record<string, SavedStroke[]> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(STROKES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SavedStroke[]>) : {};
  } catch {
    return {};
  }
}

interface LectureStep {
  stepIndex: number;
  pageIndex: number;
  blockIndex: number;
  pageTitle: string;
  block: BoardBlock;
}

export const HkWhiteboardView: React.FC<HkWhiteboardViewProps> = ({
  course,
  lectureId,
  onExit,
  onCourseUpdated,
  onOpenCheatsheet,
  onSelectLecture,
}) => {
  const flatLectures = useMemo(() => course.units.flatMap((u) => u.lectures), [course.units]);
  const foundLecture: CourseLecture | undefined =
    flatLectures.find((l) => l.id === lectureId) || flatLectures[0];
  const currentLectureIdx = foundLecture ? flatLectures.findIndex((l) => l.id === foundLecture.id) : -1;
  const nextLectureInCourse =
    currentLectureIdx >= 0 && currentLectureIdx + 1 < flatLectures.length
      ? flatLectures[currentLectureIdx + 1]
      : null;

  const [boardMode, setBoardMode] = useState<'board' | 'split' | 'visual' | 'mindmap' | 'quiz'>('board');
  const [classroomRole, setClassroomRole] = useState<'self_study' | 'teaching'>(() =>
    course.mode === 'teaching' ? 'teaching' : 'self_study'
  );
  const [drawerTab, setDrawerTab] = useState<'chat' | 'outline'>('chat');
  const [zoomPct, setZoomPct] = useState(100);
  const [pageIdx, setPageIdx] = useState(0);
  const [drawerWidth, setDrawerWidth] = useState(375);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [handwritingFont, setHandwritingFont] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.1);
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);

  // Interactive Lecture Player State
  const [lecturePlaying, setLecturePlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [stepByStepReveal, setStepByStepReveal] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [autoReadReply, setAutoReadReply] = useState(false);
  const [lectureCompletedBar, setLectureCompletedBar] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Visual / Plot bridge state
  const [visualExprOverride, setVisualExprOverride] = useState(() => {
    const firstPg = (foundLecture?.board_pages || []).find((pg) => (pg.blocks || []).length > 0);
    const firstBlk = firstPg?.blocks?.[0];
    return (firstBlk ? extractPlottableFromBlock(firstBlk) : '') || '';
  });

  // Modals & Highlights
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHovered, setSettingsHovered] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [pulsedBlockId, setPulsedBlockId] = useState<string>('');
  const [focusedBlockId, setFocusedBlockId] = useState<string>('');
  const [pendingAnchorReq, setPendingAnchorReq] = useState<{ id: string; nonce: number } | null>(null);
  const [boardEditorState, setBoardEditorState] = useState<{
    open: boolean;
    mode: 'add_block' | 'edit_block' | 'add_page';
    initialBlock?: BoardBlock | null;
  }>({ open: false, mode: 'add_block', initialBlock: null });
  const [mutatingBoard, setMutatingBoard] = useState(false);
  const [boardMutationError, setBoardMutationError] = useState('');

  // Annotations & Laser Pointer
  const [annotateMode, setAnnotateMode] = useState<'off' | 'draw' | 'laser'>('off');
  const [penColor, setPenColor] = useState<'#facc15' | '#ef4444' | '#2563eb'>('#facc15');
  const [strokesByPage, setStrokesByPage] = useState<Record<string, SavedStroke[]>>(() => loadSavedStrokes());
  const [activeStroke, setActiveStroke] = useState<{
    id: string;
    color: string;
    width: number;
    opacity: number;
    pts: [number, number][];
  } | null>(null);
  const [laserTrail, setLaserTrail] = useState<{ x: number; y: number; ts: number }[]>([]);

  // Chat & Streaming State
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState('');
  const [streamingStage, setStreamingStage] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [linkedMap, setLinkedMap] = useState<MindMapRecord | null>(null);
  const [listeningMic, setListeningMic] = useState(false);

  const dragResizingRef = useRef(false);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const ttsFetchTimerRef = useRef<number | null>(null);
  const playTokenRef = useRef(0);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const seededLectureIdRef = useRef<string>('');
  const pendingAutoSpeechRef = useRef<string>('');

  const pages = foundLecture?.board_pages || [];
  const safePageIdx = Math.min(pageIdx, Math.max(0, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const lectureSteps: LectureStep[] = useMemo(() => {
    const out: LectureStep[] = [];
    let idx = 0;
    (foundLecture?.board_pages || []).forEach((pg, pi) => {
      (pg.blocks || []).forEach((blk, bi) => {
        out.push({
          stepIndex: idx++,
          pageIndex: pi,
          blockIndex: bi,
          pageTitle: pg.roadmap_title || `第 ${pi + 1} 页`,
          block: blk,
        });
      });
    });
    return out;
  }, [foundLecture?.board_pages]);

  const initialStepPlotExpr = useMemo(() => {
    const firstBlk = lectureSteps[0]?.block;
    return (firstBlk ? extractPlottableFromBlock(firstBlk) : '') || '';
  }, [lectureSteps]);

  const safeActiveStepIdx = Math.min(activeStepIdx, Math.max(0, lectureSteps.length - 1));
  const currentStep = lectureSteps[safeActiveStepIdx];

  const clearTimersAndAudio = useCallback(() => {
    playTokenRef.current += 1;
    if (ttsFetchTimerRef.current !== null) {
      window.clearTimeout(ttsFetchTimerRef.current);
      ttsFetchTimerRef.current = null;
    }
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.onloadedmetadata = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    clearTimersAndAudio();
    setSpeaking(false);
    setLecturePlaying(false);
  }, [clearTimersAndAudio]);

  // Persist whiteboard strokes whenever updated
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STROKES_STORAGE_KEY, JSON.stringify(strokesByPage));
      }
    } catch {
      /* ignore quota limits */
    }
  }, [strokesByPage]);

  // Prune old laser trail points cleanly while in laser mode
  useEffect(() => {
    if (annotateMode !== 'laser' || laserTrail.length === 0) return;
    const t = window.setTimeout(() => {
      const cutoff = Date.now() - 650;
      setLaserTrail((prev) => prev.filter((pt) => pt.ts >= cutoff));
    }, 90);
    return () => window.clearTimeout(t);
  }, [annotateMode, laserTrail]);

  // Class timer ticks while lecture is actively playing
  useEffect(() => {
    if (!lecturePlaying) return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lecturePlaying]);

  // Reset per-lecture ephemeral state on lecture switch
  useEffect(() => {
    setPageIdx(0);
    setBoardMode('board');
    setAnnotateMode('off');
    setActiveStepIdx(0);
    setElapsedSec(0);
    setLectureCompletedBar(false);
    setFocusedBlockId('');
    setPendingAnchorReq(null);
    setBoardMutationError('');
    pendingAutoSpeechRef.current = '';
    const firstPg = (foundLecture?.board_pages || []).find((pg) => (pg.blocks || []).length > 0);
    const firstBlk = firstPg?.blocks?.[0];
    setVisualExprOverride((firstBlk ? extractPlottableFromBlock(firstBlk) : '') || '');
    seededLectureIdRef.current = foundLecture?.id || lectureId;
    stopAudioPlayback();
  }, [lectureId, stopAudioPlayback]);

  // Seed visualExprOverride if active lecture resolves asynchronously or via fallback
  useEffect(() => {
    const lid = foundLecture?.id || lectureId;
    if (seededLectureIdRef.current === lid) return;
    seededLectureIdRef.current = lid;
    const firstBlk = lectureSteps[0]?.block;
    setVisualExprOverride((firstBlk ? extractPlottableFromBlock(firstBlk) : '') || '');
  }, [foundLecture?.id, lectureId, lectureSteps]);

  useEffect(() => () => stopAudioPlayback(), [stopAudioPlayback]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [foundLecture?.messages?.length, sending]);

  useEffect(() => {
    if (boardMode === 'mindmap' && course.linked_ids?.mindmap_id && !linkedMap) {
      apiJson<{ mindmaps: MindMapRecord[] }>('/api/mindmap/list')
        .then((res) => {
          const hit = res.mindmaps.find((m) => m.id === course.linked_ids.mindmap_id) || res.mindmaps[0];
          if (hit) setLinkedMap(hit);
        })
        .catch(() => {});
    }
  }, [boardMode, course.linked_ids, linkedMap]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragResizingRef.current) return;
      const newW = Math.min(540, Math.max(290, window.innerWidth - e.clientX - 18));
      setDrawerWidth(newW);
    };
    const onUp = () => {
      dragResizingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleAnchorJump = useCallback(
    (blockId?: string) => {
      if (!blockId) return;
      stopAudioPlayback();
      setLectureCompletedBar(false);
      setBoardMode((prev) => (prev === 'split' ? 'split' : 'board'));
      const pIndex = pages.findIndex((p) => (p.blocks || []).some((b) => b.id === blockId));
      if (pIndex !== -1 && pIndex !== safePageIdx) {
        setPageIdx(pIndex);
      }
      const stIdx = lectureSteps.findIndex((st) => st.block.id === blockId);
      if (stIdx >= 0) {
        setActiveStepIdx(stIdx);
        const expr = extractPlottableFromBlock(lectureSteps[stIdx].block);
        if (expr) setVisualExprOverride(expr);
      }
      window.setTimeout(() => {
        const el = blockRefs.current[blockId];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setPulsedBlockId(blockId);
        window.setTimeout(() => setPulsedBlockId(''), 1600);
      }, 65);
    },
    [stopAudioPlayback, pages, safePageIdx, lectureSteps]
  );

  const speakPlainText = useCallback(
    (
      rawText: string,
      options?: {
        cacheKey?: string;
        onDone?: () => void;
        rateOverride?: number;
        keepLecturePlaying?: boolean;
      }
    ) => {
      clearTimersAndAudio();
      if (!options?.keepLecturePlaying) {
        setLecturePlaying(false);
      }
      const myToken = playTokenRef.current;
      const spoken = latexToSpokenZh(rawText);
      if (!spoken) {
        setSpeaking(false);
        options?.onDone?.();
        return;
      }

      const rate = options?.rateOverride ?? speechRate;
      const safeFallbackMs = Math.min(11000, Math.max(3200, Math.round((spoken.length * 105) / rate)));
      setSpeaking(true);

      let audioConfirmedStarted = false;

      const scheduleTimer = (ms: number) => {
        if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = window.setTimeout(() => {
          if (playTokenRef.current !== myToken) return;
          setSpeaking(false);
          options?.onDone?.();
        }, ms);
      };

      const finishNow = () => {
        if (playTokenRef.current !== myToken) return;
        if (safetyTimerRef.current !== null) {
          window.clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
        setSpeaking(false);
        options?.onDone?.();
      };

      const runBrowserSpeech = () => {
        if (playTokenRef.current !== myToken) return;
        // Start safety fallback immediately in case headless browser has zero voices / never fires onend
        scheduleTimer(safeFallbackMs);
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          return;
        }
        try {
          const utter = new SpeechSynthesisUtterance(spoken);
          utter.lang = 'zh-CN';
          utter.rate = rate;
          utter.onstart = () => {
            if (playTokenRef.current !== myToken) return;
            audioConfirmedStarted = true;
            // Extend upper ceiling slightly when real TTS starts
            scheduleTimer(Math.min(35000, Math.max(safeFallbackMs + 2500, Math.round((spoken.length * 170) / rate))));
          };
          utter.onend = () => {
            if (audioConfirmedStarted) finishNow();
          };
          utter.onerror = () => {
            /* keep safety timer pace */
          };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        } catch {
          /* keep safety timer */
        }
      };

      if (isStaticDemoMode() || !foundLecture) {
        runBrowserSpeech();
        return;
      }

      // Abort /tts fetch after 10000ms and fall back to browser speech instead of prematurely firing onDone
      let timedOut = false;
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      ttsFetchTimerRef.current = window.setTimeout(() => {
        if (playTokenRef.current !== myToken) return;
        timedOut = true;
        controller.abort();
      }, 10000);

      const clearFetchTimeout = () => {
        if (ttsFetchTimerRef.current !== null) {
          window.clearTimeout(ttsFetchTimerRef.current);
          ttsFetchTimerRef.current = null;
        }
      };

      fetch(resolveApiUrl(`/api/courses/${course.id}/lectures/${foundLecture.id}/tts`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken, voice: voiceId }),
        signal: controller.signal,
      })
        .then(async (resp) => {
          if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
          if (playTokenRef.current !== myToken) {
            clearFetchTimeout();
            return;
          }
          if (!resp.ok) throw new Error('tts failed');
          const blob = await resp.blob();
          clearFetchTimeout();
          if (playTokenRef.current !== myToken) return;
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audio.playbackRate = rate;
          audioRef.current = audio;

          const updateWatchdogFromDuration = () => {
            if (playTokenRef.current !== myToken) return;
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              const realMs = Math.round((audio.duration * 1000) / Math.max(0.4, rate)) + 1500;
              scheduleTimer(Math.min(120000, Math.max(3000, realMs)));
            }
          };

          audio.onloadedmetadata = updateWatchdogFromDuration;
          audio.onended = () => finishNow();
          audio.onerror = () => {
            if (playTokenRef.current !== myToken) return;
            if (!audioConfirmedStarted) {
              runBrowserSpeech();
            } else {
              finishNow();
            }
          };

          scheduleTimer(Math.min(60000, safeFallbackMs + 15000));
          await audio.play();
          if (playTokenRef.current !== myToken) return;
          audioConfirmedStarted = true;
          updateWatchdogFromDuration();
        })
        .catch((err) => {
          clearFetchTimeout();
          if (playTokenRef.current !== myToken) return;
          if (!timedOut && err && (err as { name?: string }).name === 'AbortError') return;
          runBrowserSpeech();
        });
    },
    [clearTimersAndAudio, speechRate, foundLecture, course.id, voiceId]
  );

  const playStepRef = useRef<(idx: number, continueSequence: boolean) => void>(() => {});

  const playStep = useCallback(
    (idx: number, continueSequence: boolean) => {
      if (!lectureSteps.length || !foundLecture) return;
      const clamped = Math.max(0, Math.min(lectureSteps.length - 1, idx));
      const targetStep = lectureSteps[clamped];
      const expr = extractPlottableFromBlock(targetStep.block);
      if (expr) {
        setVisualExprOverride(expr);
      }
      setActiveStepIdx(clamped);
      setPageIdx(targetStep.pageIndex);
      setBoardMode((prev) => (prev === 'split' ? 'split' : 'board'));
      setLectureCompletedBar(false);
      setLecturePlaying(continueSequence);

      window.setTimeout(() => {
        const el = blockRefs.current[targetStep.block.id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);

      const narration = buildBlockNarration(targetStep.block, foundLecture.title);
      speakPlainText(narration, {
        keepLecturePlaying: continueSequence,
        onDone: () => {
          if (!continueSequence) return;
          if (clamped + 1 < lectureSteps.length) {
            playStepRef.current(clamped + 1, true);
          } else {
            setLecturePlaying(false);
            setSpeaking(false);
            setLectureCompletedBar(true);
          }
        },
      });
    },
    [lectureSteps, foundLecture, speakPlainText]
  );

  useEffect(() => {
    if (!pendingAnchorReq) return;
    const targetId = pendingAnchorReq.id;
    const readyInSteps = lectureSteps.some((st) => st.block.id === targetId);
    const readyInPages = pages.some((p) => (p.blocks || []).some((b) => b.id === targetId));
    if (readyInSteps || readyInPages) {
      handleAnchorJump(targetId);
      setPendingAnchorReq(null);
      if (pendingAutoSpeechRef.current) {
        const queuedSpeech = pendingAutoSpeechRef.current;
        pendingAutoSpeechRef.current = '';
        speakPlainText(queuedSpeech);
      }
    }
  }, [pendingAnchorReq, course, lectureSteps, pages, handleAnchorJump, speakPlainText]);

  useEffect(() => {
    playStepRef.current = playStep;
  }, [playStep]);

  const handleToggleLecturePlay = useCallback(() => {
    if (lecturePlaying) {
      stopAudioPlayback();
    } else {
      playStep(safeActiveStepIdx, true);
    }
  }, [lecturePlaying, stopAudioPlayback, playStep, safeActiveStepIdx]);

  const jumpToStepSilently = useCallback(
    (idx: number) => {
      if (!lectureSteps.length) return;
      const clamped = Math.max(0, Math.min(lectureSteps.length - 1, idx));
      const target = lectureSteps[clamped];
      stopAudioPlayback();
      const expr = extractPlottableFromBlock(target.block);
      if (expr) {
        setVisualExprOverride(expr);
      }
      setActiveStepIdx(clamped);
      setPageIdx(target.pageIndex);
      setLectureCompletedBar(false);
      setBoardMode((prev) => (prev === 'split' ? 'split' : 'board'));
      window.setTimeout(() => {
        const el = blockRefs.current[target.block.id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPulsedBlockId(target.block.id);
        window.setTimeout(() => setPulsedBlockId(''), 1200);
      }, 60);
    },
    [lectureSteps, stopAudioPlayback]
  );

  const handleStepDelta = useCallback(
    (delta: number) => {
      if (!lectureSteps.length) return;
      const next = Math.max(0, Math.min(lectureSteps.length - 1, safeActiveStepIdx + delta));
      if (lecturePlaying) {
        playStep(next, true);
      } else {
        jumpToStepSilently(next);
      }
    },
    [lectureSteps.length, safeActiveStepIdx, lecturePlaying, playStep, jumpToStepSilently]
  );

  // Keyboard Shortcuts (Escape closes modals/modes first; stage keys ignored inside inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-testid="command-palette-modal"]')) return;

      const target = e.target as HTMLElement | null;
      const isTypingTarget = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      );

      if (e.key === 'Escape' || e.code === 'Escape') {
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (exitConfirmOpen) {
          e.preventDefault();
          setExitConfirmOpen(false);
          return;
        }
        if (boardEditorState.open) {
          if (!mutatingBoard) {
            e.preventDefault();
            setBoardEditorState((prev) => ({ ...prev, open: false }));
          }
          return;
        }
        if (!isTypingTarget) {
          if (annotateMode !== 'off') {
            e.preventDefault();
            setAnnotateMode('off');
            return;
          }
          if (focusMode) {
            e.preventDefault();
            setFocusMode(false);
            return;
          }
          if (mobileDrawerOpen) {
            e.preventDefault();
            setMobileDrawerOpen(false);
            return;
          }
        }
        return;
      }

      if (isTypingTarget) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        boardEditorState.open ||
        settingsOpen ||
        exitConfirmOpen ||
        (typeof document !== 'undefined' && document.querySelector('.modal-backdrop'))
      ) {
        return;
      }

      const onBoardOrSplit = boardMode === 'board' || boardMode === 'split';

      if (e.code === 'Space' && onBoardOrSplit) {
        e.preventDefault();
        handleToggleLecturePlay();
      } else if (e.code === 'ArrowLeft' && onBoardOrSplit) {
        e.preventDefault();
        handleStepDelta(-1);
      } else if (e.code === 'ArrowRight' && onBoardOrSplit) {
        e.preventDefault();
        handleStepDelta(1);
      } else if (e.code === 'KeyL' && onBoardOrSplit) {
        e.preventDefault();
        setAnnotateMode((m) => (m === 'laser' ? 'off' : 'laser'));
      } else if (e.code === 'KeyA' && onBoardOrSplit) {
        e.preventDefault();
        setAnnotateMode((m) => (m === 'draw' ? 'off' : 'draw'));
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    boardEditorState.open,
    mutatingBoard,
    settingsOpen,
    exitConfirmOpen,
    annotateMode,
    focusMode,
    mobileDrawerOpen,
    boardMode,
    handleToggleLecturePlay,
    handleStepDelta,
  ]);

  if (!foundLecture) {
    return (
      <div className="hk-page-wrap">
        <button type="button" className="hk-pill-control" onClick={onExit}>
          ← 返回课程
        </button>
        <div style={{ marginTop: 20 }}>该课程暂无讲次板书。</div>
      </div>
    );
  }

  const handleTeachAction = async (
    action:
      | 'next_segment'
      | 'reexplain_analogy'
      | 'worked_example'
      | 'counterexample'
      | 'socratic_check'
      | 'summarize'
      | 'teacher_script',
    targetBlock?: BoardBlock | null,
    labelHint?: string
  ) => {
    if (sending) return;
    stopAudioPlayback();
    setDrawerTab('chat');
    setSending(true);
    setOptimisticUserMsg(
      labelHint ||
        (targetBlock
          ? `围绕「${targetBlock.heading}」执行教学增强`
          : action === 'socratic_check'
          ? '请围绕本讲内容出一道随堂诊断题'
          : '请继续讲解并补充白板内容')
    );
    setStreamingStage('正在构建交互讲解并同步白板…');
    setStreamingReply('');

    let createdBlockId = '';
    let receivedQuiz = false;
    let replyToSpeak = '';
    try {
      await postEventStream(
        `/api/courses/${course.id}/lectures/${foundLecture.id}/teach-step`,
        {
          action,
          block_id: targetBlock?.id || focusedBlockId || currentStep?.block?.id || '',
          page_index: safePageIdx + 1,
          teaching_mode: classroomRole,
        },
        (evt, data) => {
          if (evt === 'stage') {
            setStreamingStage(String(data.message || ''));
          } else if (evt === 'delta') {
            setStreamingReply((prev) => prev + String(data.text || ''));
          } else if (evt === 'result') {
            if (data.course) onCourseUpdated(data.course as unknown as CourseRecord);
            const pIdx = Number(data.page_index || 0);
            if (pIdx >= 1) setPageIdx(pIdx - 1);
            const blk = data.new_board_block as unknown as BoardBlock | undefined;
            if (blk?.id) createdBlockId = blk.id;
            if (data.new_quiz_item) receivedQuiz = true;
            const rep = data.reply as { content?: string } | undefined;
            if (rep?.content) replyToSpeak = String(rep.content);
          }
        }
      );
      if (receivedQuiz) {
        setBoardMode('quiz');
        if (autoReadReply && replyToSpeak) {
          speakPlainText(replyToSpeak);
        }
      } else if (createdBlockId) {
        if (autoReadReply && replyToSpeak) {
          pendingAutoSpeechRef.current = replyToSpeak;
        }
        setPendingAnchorReq({ id: createdBlockId, nonce: Date.now() });
      } else if (autoReadReply && replyToSpeak) {
        speakPlainText(replyToSpeak);
      }
    } catch {
      /* ignore stream transient */
    } finally {
      setSending(false);
      setOptimisticUserMsg('');
      setStreamingStage('');
      setStreamingReply('');
    }
  };

  const handleSendChat = async () => {
    const q = chatInput.trim();
    if (!q || sending) return;
    stopAudioPlayback();
    setChatInput('');
    setDrawerTab('chat');
    setSending(true);
    setOptimisticUserMsg(q);
    setStreamingStage('正在理解问题并梳理板书…');
    setStreamingReply('');
    let createdBlockId = '';
    let replyToSpeak = '';
    try {
      await postEventStream(
        `/api/courses/${course.id}/lectures/${foundLecture.id}/chat-stream`,
        {
          message: q,
          focus_block_id: focusedBlockId,
          teaching_mode: classroomRole,
        },
        (evt, data) => {
          if (evt === 'stage') {
            setStreamingStage(String(data.message || ''));
          } else if (evt === 'delta') {
            setStreamingReply((prev) => prev + String(data.text || ''));
          } else if (evt === 'result') {
            if (data.course) onCourseUpdated(data.course as unknown as CourseRecord);
            const pIdx = Number(data.page_index || 0);
            if (pIdx >= 1) setPageIdx(pIdx - 1);
            const blk = data.new_board_block as unknown as BoardBlock | undefined;
            if (blk?.id) createdBlockId = blk.id;
            const rep = data.reply as { content?: string } | undefined;
            if (rep?.content) replyToSpeak = String(rep.content);
          }
        }
      );
      if (createdBlockId) {
        if (autoReadReply && replyToSpeak) {
          pendingAutoSpeechRef.current = replyToSpeak;
        }
        setPendingAnchorReq({ id: createdBlockId, nonce: Date.now() });
      } else if (autoReadReply && replyToSpeak) {
        speakPlainText(replyToSpeak);
      }
    } catch {
      /* ignore stream transient */
    } finally {
      setSending(false);
      setOptimisticUserMsg('');
      setStreamingStage('');
      setStreamingReply('');
    }
  };

  const handleBoardModalSubmit = async (payload: BoardEditorPayload) => {
    if (mutatingBoard) return;
    stopAudioPlayback();
    setMutatingBoard(true);
    setBoardMutationError('');
    try {
      const res = await apiJson<{ ok: boolean; course: CourseRecord; page_index: number; block?: BoardBlock }>(
        `/api/courses/${course.id}/lectures/${foundLecture.id}/board`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      if (res.course) onCourseUpdated(res.course);
      if (res.page_index >= 1) setPageIdx(res.page_index - 1);
      setBoardEditorState((prev) => ({ ...prev, open: false }));
      if (res.block) {
        const editedExpr = extractPlottableFromBlock(res.block);
        if (editedExpr) setVisualExprOverride(editedExpr);
      }
      let targetBlockId = res.block?.id || payload.block_id || '';
      if (!targetBlockId && payload.op === 'add_page' && res.course) {
        const updatedLec = res.course.units.flatMap((u) => u.lectures).find((l) => l.id === foundLecture.id);
        const targetPg =
          updatedLec?.board_pages?.[
            res.page_index >= 1 ? res.page_index - 1 : Math.max(0, (updatedLec?.board_pages?.length || 1) - 1)
          ];
        if (targetPg?.blocks?.[0]?.id) {
          targetBlockId = targetPg.blocks[0].id;
        }
      }
      if (targetBlockId) {
        setBoardMode((prev) => (prev === 'split' ? 'split' : 'board'));
        setPendingAnchorReq({ id: targetBlockId, nonce: Date.now() });
      }
    } catch (err) {
      setBoardMutationError(err instanceof Error ? err.message : '保存板书更改失败，请稍后重试');
    } finally {
      setMutatingBoard(false);
    }
  };

  const handleMoveOrDeleteBlock = async (op: 'move_block' | 'delete_block', blockId: string, direction?: 'up' | 'down') => {
    if (mutatingBoard) return;
    stopAudioPlayback();
    setMutatingBoard(true);
    setBoardMutationError('');
    try {
      const res = await apiJson<{ ok: boolean; course: CourseRecord; page_index: number }>(
        `/api/courses/${course.id}/lectures/${foundLecture.id}/board`,
        {
          method: 'PATCH',
          body: JSON.stringify({ op, block_id: blockId, page_index: safePageIdx + 1, direction: direction || 'up' }),
        }
      );
      if (res.course) onCourseUpdated(res.course);
      if (res.page_index >= 1) setPageIdx(res.page_index - 1);
      if (op === 'delete_block' && focusedBlockId === blockId) {
        setFocusedBlockId('');
      }
    } catch (err) {
      setBoardMutationError(err instanceof Error ? err.message : '调整板书模块失败，请稍后重试');
    } finally {
      setMutatingBoard(false);
    }
  };

  const handleToggleVoiceMic = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      };
    };
    const Rec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Rec) return;

    if (listeningMic && speechRecRef.current) {
      speechRecRef.current.stop();
      setListeningMic(false);
      return;
    }

    try {
      const rec = new Rec();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const txt = ev.results?.[0]?.[0]?.transcript;
        if (txt) setChatInput((prev) => (prev ? `${prev} ${txt}` : txt));
      };
      rec.onend = () => setListeningMic(false);
      rec.onerror = () => setListeningMic(false);
      speechRecRef.current = rec;
      setListeningMic(true);
      rec.start();
    } catch {
      setListeningMic(false);
    }
  };

  const pageStrokeKey = `${course.id}:${foundLecture.id}:${safePageIdx}`;
  const currentStrokes = strokesByPage[pageStrokeKey] || [];
  const BOARD_SVG_VIEW_W = 860;
  const BOARD_SVG_VIEW_H = 1100;

  const getScaledCoords = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rw = Math.max(1, rect.width);
    const rh = Math.max(1, rect.height);
    return [
      Math.round(((e.clientX - rect.left) / rw) * BOARD_SVG_VIEW_W * 10) / 10,
      Math.round(((e.clientY - rect.top) / rh) * BOARD_SVG_VIEW_H * 10) / 10,
    ];
  };

  const handleExportBoardMd = () => {
    const lines: string[] = [`# ${course.title} · ${foundLecture.title}`, ''];
    pages.forEach((pg, pi) => {
      lines.push(`## 第 ${pi + 1} 页：${pg.roadmap_title}`, '');
      (pg.blocks || []).forEach((b) => {
        lines.push(`### ${b.heading}${b.verified_badge ? `（${b.verified_badge}）` : ''}`);
        b.lines.forEach((ln) => lines.push(`- ${ln}`));
        if (b.highlight_note) lines.push(`> 重点：${b.highlight_note}`);
        if (b.teaching_tip) lines.push(`> 授课提示：${b.teaching_tip}`);
        lines.push('');
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${foundLecture.title}_板书.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMarkCompleted = async () => {
    try {
      const res = await apiJson<{ course: CourseRecord }>(`/api/courses/${course.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ lecture_id: foundLecture.id, mastery: 'mastered' }),
      });
      if (res.course) onCourseUpdated(res.course);
    } catch {
      /* ignore */
    }
    onExit();
  };

  const defaultVisualExpr =
    foundLecture.visualizer_preset === 'ln_quad'
      ? 'ln(x) + 0.5*x^2'
      : foundLecture.visualizer_preset === 'kepler'
      ? '1/(x^2 + 0.35)'
      : 'x^3 - 3*x^2 + 2';

  const activePlotPreset: SandboxPresetConfig | null =
    foundLecture.visualizer_preset === 'group_z6'
      ? GROUP_Z6_PRESET
      : foundLecture.visualizer_preset === 'riemann'
      ? RIEMANN_PRESET
      : null;

  const resolvedPlotExpr = visualExprOverride || initialStepPlotExpr || defaultVisualExpr;
  const isBoardStage = boardMode === 'board' || boardMode === 'split';

  const quizCount = (foundLecture.quiz_items || []).length;
  const focusedBlock = lectureSteps.find((s) => s.block.id === focusedBlockId)?.block || null;
  const hasSpeechRec =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  const fmtTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeCaptionText = currentStep ? buildBlockNarration(currentStep.block, foundLecture.title) : '';

  const renderBoardPageContent = (inSplit: boolean) => {
    if (!currentPage) return null;
    const pageBlocks = currentPage.blocks || [];
    return (
      <div
        style={{
          position: 'relative',
          maxWidth: inSplit ? 'none' : 780,
          margin: '0 auto',
          transform: `scale(${zoomPct / 100})`,
          transformOrigin: inSplit ? 'top left' : 'top center',
          transition: 'transform 0.16s ease',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2
            className={`hk-marker-yellow ${handwritingFont ? '' : 'serif-heading'}`}
            style={{
              margin: 0,
              fontSize: inSplit ? 24 : 27,
              fontFamily: handwritingFont ? 'var(--font-hand)' : 'var(--font-sans)',
              color: '#2c4370',
            }}
          >
            {currentPage.roadmap_title}
          </h2>
        </div>

        {pageBlocks.map((blk, blkIdxInPage) => {
          const stepEntry = lectureSteps.find((s) => s.block.id === blk.id);
          const blkStepIdx = stepEntry ? stepEntry.stepIndex : 0;
          const isActiveStep = currentStep?.block.id === blk.id;
          const isFutureStep = stepByStepReveal && blkStepIdx > safeActiveStepIdx;
          const typeMeta = BLOCK_TYPE_BADGES[blk.block_type || 'concept'] || BLOCK_TYPE_BADGES.concept;
          const plotExpr = extractPlottableFromBlock(blk);

          return (
            <div
              key={blk.id}
              ref={(el) => {
                blockRefs.current[blk.id] = el;
              }}
              className={`hk-wb-block ${handwritingFont ? 'handwriting' : ''} ${
                isActiveStep ? 'active-step' : ''
              } ${pulsedBlockId === blk.id ? 'pulsed' : ''} ${isFutureStep ? 'dim-future' : ''}`}
              style={{
                borderLeft: `3px solid ${isActiveStep ? '#3b4f7d' : '#c8dcfa'}`,
                background: isActiveStep ? 'rgba(244, 248, 255, 0.96)' : 'rgba(255, 255, 255, 0.78)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`hk-wb-type-badge ${typeMeta.cls}`}>{typeMeta.label}</span>
                  <div
                    style={{
                      fontSize: handwritingFont ? 21 : 17.5,
                      fontWeight: 700,
                      color: '#181a1f',
                    }}
                  >
                    <MathText text={blk.heading} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {isActiveStep && speaking && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#1d4ed8',
                        background: '#e0e7ff',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      <span className="hk-wb-wave">
                        <span />
                        <span />
                        <span />
                      </span>
                      正在讲解
                    </span>
                  )}
                  {blk.verified_badge && (
                    <span
                      className="badge badge-verified"
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        background: '#ecfdf5',
                        color: '#166534',
                        border: '1px solid #a7f3d0',
                        borderRadius: 999,
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      ✓ {blk.verified_badge}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: handwritingFont ? 18 : 15 }}>
                {blk.lines.map((line, i) => (
                  <div key={i} style={{ paddingLeft: 12 }}>
                    <MathText text={line} />
                  </div>
                ))}
              </div>

              {blk.highlight_note && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '6px 12px',
                    borderRadius: 8,
                    background: '#fef9c3',
                    color: '#713f12',
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  重点：<MathText text={blk.highlight_note} />
                </div>
              )}

              {classroomRole === 'teaching' && blk.teaching_tip && (
                <div className="hk-wb-tip-box">
                  <strong>授课提示：</strong>
                  {blk.teaching_tip}
                </div>
              )}

              {/* Per-Block Interactive Micro-Actions */}
              <div className="hk-wb-micro-actions">
                <button
                  type="button"
                  className="hk-wb-micro-btn"
                  onClick={() => playStep(blkStepIdx, false)}
                  data-testid={`wb-speak-blk-${blk.id}`}
                >
                  {isActiveStep && speaking ? '🔊 讲授中' : '▶ 精讲此段'}
                </button>
                <button
                  type="button"
                  className="hk-wb-micro-btn"
                  disabled={sending}
                  onClick={() => handleTeachAction('reexplain_analogy', blk, `请为「${blk.heading}」换个通俗类比`)}
                >
                  💡 换个比喻
                </button>
                <button
                  type="button"
                  className="hk-wb-micro-btn"
                  disabled={sending}
                  onClick={() => handleTeachAction('worked_example', blk, `围绕「${blk.heading}」补一道分步例题`)}
                >
                  📝 看个例题
                </button>
                {plotExpr && (
                  <button
                    type="button"
                    className="hk-wb-micro-btn"
                    style={{ color: '#2563eb', borderColor: '#bfdbfe', background: '#eff6ff' }}
                    onClick={() => {
                      setVisualExprOverride(plotExpr);
                      setBoardMode(typeof window !== 'undefined' && window.innerWidth > 1080 ? 'split' : 'visual');
                    }}
                    data-testid={`wb-plot-blk-${blk.id}`}
                  >
                    📈 画图
                  </button>
                )}
                <button
                  type="button"
                  className="hk-wb-micro-btn"
                  onClick={() => {
                    setFocusedBlockId(blk.id);
                    setDrawerTab('chat');
                    if (focusMode) setFocusMode(false);
                    setMobileDrawerOpen(true);
                  }}
                >
                  💬 追问此块
                </button>

                {classroomRole === 'teaching' && (
                  <>
                    <button
                      type="button"
                      className="hk-wb-micro-btn"
                      style={{ marginLeft: 'auto' }}
                      disabled={mutatingBoard}
                      onClick={() => setBoardEditorState({ open: true, mode: 'edit_block', initialBlock: blk })}
                    >
                      ✎ 编辑
                    </button>
                    {blkIdxInPage > 0 && (
                      <button
                        type="button"
                        className="hk-wb-micro-btn"
                        disabled={mutatingBoard}
                        title="上移"
                        onClick={() => handleMoveOrDeleteBlock('move_block', blk.id, 'up')}
                      >
                        ↑
                      </button>
                    )}
                    {blkIdxInPage + 1 < pageBlocks.length && (
                      <button
                        type="button"
                        className="hk-wb-micro-btn"
                        disabled={mutatingBoard}
                        title="下移"
                        onClick={() => handleMoveOrDeleteBlock('move_block', blk.id, 'down')}
                      >
                        ↓
                      </button>
                    )}
                    {lectureSteps.length > 1 && (
                      <button
                        type="button"
                        className="hk-wb-micro-btn"
                        style={{ color: '#b91c1c' }}
                        disabled={mutatingBoard}
                        onClick={() => handleMoveOrDeleteBlock('delete_block', blk.id)}
                      >
                        删
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Freehand Annotation & Ephemeral Laser Overlay */}
        <svg
          viewBox={`0 0 ${BOARD_SVG_VIEW_W} ${BOARD_SVG_VIEW_H}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            zIndex: 8,
            pointerEvents: annotateMode !== 'off' ? 'auto' : 'none',
            cursor: annotateMode === 'laser' ? 'none' : annotateMode === 'draw' ? 'crosshair' : 'default',
            touchAction: annotateMode !== 'off' ? 'none' : 'auto',
          }}
          onPointerDown={(e) => {
            if (annotateMode === 'off') return;
            const [x, y] = getScaledCoords(e);
            if (annotateMode === 'laser') {
              setLaserTrail([{ x, y, ts: Date.now() }]);
              return;
            }
            setActiveStroke({
              id: `strk_${Date.now()}`,
              color: penColor,
              width: penColor === '#facc15' ? 14 : 3.2,
              opacity: penColor === '#facc15' ? 0.38 : 0.88,
              pts: [[x, y]],
            });
          }}
          onPointerMove={(e) => {
            if (annotateMode === 'off') return;
            const [x, y] = getScaledCoords(e);
            if (annotateMode === 'laser') {
              const nowTs = Date.now();
              setLaserTrail((prev) => [...prev.filter((p) => nowTs - p.ts < 650), { x, y, ts: nowTs }]);
              return;
            }
            if (!activeStroke) return;
            setActiveStroke((prev) => (prev ? { ...prev, pts: [...prev.pts, [x, y]] } : null));
          }}
          onPointerUp={() => {
            if (annotateMode === 'laser' || !activeStroke) return;
            if (activeStroke.pts.length >= 2) {
              const d = activeStroke.pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
              setStrokesByPage((prev) => ({
                ...prev,
                [pageStrokeKey]: [
                  ...(prev[pageStrokeKey] || []),
                  {
                    id: activeStroke.id,
                    color: activeStroke.color,
                    width: activeStroke.width,
                    opacity: activeStroke.opacity,
                    d,
                  },
                ],
              }));
            }
            setActiveStroke(null);
          }}
          onPointerLeave={() => {
            if (annotateMode === 'laser') setLaserTrail([]);
          }}
        >
          {currentStrokes.map((st) => (
            <path
              key={st.id}
              d={st.d}
              fill="none"
              stroke={st.color}
              strokeWidth={st.width}
              strokeOpacity={st.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {activeStroke && activeStroke.pts.length >= 2 && (
            <path
              d={activeStroke.pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')}
              fill="none"
              stroke={activeStroke.color}
              strokeWidth={activeStroke.width}
              strokeOpacity={activeStroke.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {laserTrail.length >= 2 && (
            <polyline
              points={laserTrail.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#ef4444"
              strokeWidth={4}
              strokeOpacity={0.45}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {laserTrail.length > 0 && (
            <g>
              <circle
                cx={laserTrail[laserTrail.length - 1].x}
                cy={laserTrail[laserTrail.length - 1].y}
                r={11}
                fill="#ef4444"
                fillOpacity={0.22}
              />
              <circle
                cx={laserTrail[laserTrail.length - 1].x}
                cy={laserTrail[laserTrail.length - 1].y}
                r={4.5}
                fill="#dc2626"
              />
            </g>
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="hk-whiteboard-shell">
      {/* LEFT MAIN WHITEBOARD PANE */}
      <div className={`hk-wb-board-pane ${showDots ? 'hk-dot-canvas' : ''}`}>
        {/* Top Floating Controls */}
        <div className="hk-wb-float-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="hk-circle-btn"
              title="退出白板课堂"
              aria-label="退出白板课堂"
              onClick={() => setExitConfirmOpen(true)}
            >
              ×
            </button>

            <div className="hk-wb-pill-bar" style={{ padding: '4px 10px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#181a1f' }}>{foundLecture.title}</span>
              <span
                title="板书与对话已实时同步"
                style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 12, marginLeft: 4 }}
              >
                <span style={{ width: 2.5, height: 5, background: '#16a34a', borderRadius: 2 }} />
                <span style={{ width: 2.5, height: 8, background: '#16a34a', borderRadius: 2 }} />
                <span style={{ width: 2.5, height: 11, background: '#16a34a', borderRadius: 2 }} />
              </span>
            </div>

            {/* Dual Role Switch */}
            <div className="hk-wb-pill-bar" style={{ padding: 3 }} data-testid="wb-role-switch">
              <button
                type="button"
                className={`seg-switch-btn ${classroomRole === 'self_study' ? 'active' : ''}`}
                style={{ padding: '3px 9px', fontSize: 11.5 }}
                onClick={() => setClassroomRole('self_study')}
              >
                学生听课
              </button>
              <button
                type="button"
                className={`seg-switch-btn ${classroomRole === 'teaching' ? 'active' : ''}`}
                style={{ padding: '3px 9px', fontSize: 11.5 }}
                onClick={() => setClassroomRole('teaching')}
              >
                教师授课
              </button>
            </div>
          </div>

          <div className="hk-wb-pill-bar" style={{ flexWrap: 'wrap' }}>
            {isBoardStage && (
              <>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => setZoomPct((z) => Math.max(70, z - 10))}
                  aria-label="缩小画板"
                >
                  −
                </button>
                <span className="mono-num" style={{ fontSize: 12, minWidth: 38, textAlign: 'center', fontWeight: 600 }}>
                  {zoomPct}%
                </span>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => setZoomPct((z) => Math.min(140, z + 10))}
                  aria-label="放大画板"
                >
                  +
                </button>
                <span style={{ width: 1, height: 16, background: '#e5e7eb' }} />
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  disabled={safePageIdx <= 0}
                  onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                  aria-label="上一页板书"
                >
                  ‹
                </button>
                <span className="mono-num" style={{ fontSize: 12, minWidth: 32, textAlign: 'center', fontWeight: 600 }}>
                  {safePageIdx + 1}/{Math.max(1, pages.length)}
                </span>
                <button
                  type="button"
                  className="hk-collapse-btn"
                  style={{ width: 24, height: 24 }}
                  disabled={safePageIdx >= pages.length - 1}
                  onClick={() => setPageIdx((p) => Math.min(pages.length - 1, p + 1))}
                  aria-label="下一页板书"
                >
                  ›
                </button>
                <span style={{ width: 1, height: 16, background: '#e5e7eb' }} />
              </>
            )}

            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'board' ? 'active' : ''}`}
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={() => setBoardMode('board')}
            >
              板书
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'split' ? 'active' : ''}`}
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={() => setBoardMode('split')}
              data-testid="wb-mode-split"
            >
              板书+画图
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'visual' ? 'active' : ''}`}
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={() => setBoardMode('visual')}
            >
              函数画板
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'mindmap' ? 'active' : ''}`}
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={() => setBoardMode('mindmap')}
            >
              结构导图
            </button>
            <button
              type="button"
              className={`seg-switch-btn ${boardMode === 'quiz' ? 'active' : ''}`}
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={() => setBoardMode('quiz')}
              data-testid="wb-mode-quiz"
            >
              随堂检验 ({quizCount})
            </button>
            <button
              type="button"
              className="seg-switch-btn"
              style={{ padding: '4px 9px', fontSize: 12 }}
              onClick={onOpenCheatsheet}
            >
              速查表
            </button>

            {isBoardStage && (
              <>
                <button
                  type="button"
                  className="seg-switch-btn"
                  style={{ padding: '4px 9px', fontSize: 12, color: '#1d4ed8' }}
                  onClick={() => setBoardEditorState({ open: true, mode: 'add_block', initialBlock: null })}
                  data-testid="wb-add-block-btn"
                >
                  + 记板书
                </button>
                {classroomRole === 'teaching' && (
                  <button
                    type="button"
                    className="seg-switch-btn"
                    style={{ padding: '4px 9px', fontSize: 12 }}
                    onClick={() => setBoardEditorState({ open: true, mode: 'add_page', initialBlock: null })}
                  >
                    + 新建页
                  </button>
                )}
                <button
                  type="button"
                  className={`seg-switch-btn ${annotateMode !== 'off' ? 'active' : ''}`}
                  style={{ padding: '4px 9px', fontSize: 12 }}
                  onClick={() => setAnnotateMode((v) => (v === 'off' ? 'draw' : 'off'))}
                  data-testid="wb-annotate-toggle"
                >
                  ✎ 批注
                </button>
                <button
                  type="button"
                  className="seg-switch-btn"
                  style={{ padding: '4px 9px', fontSize: 12 }}
                  title="导出本讲板书 Markdown"
                  onClick={handleExportBoardMd}
                >
                  导出
                </button>
              </>
            )}

            {focusMode && (
              <button
                type="button"
                className="seg-switch-btn active"
                style={{ padding: '4px 9px', fontSize: 12 }}
                onClick={() => setFocusMode(false)}
                data-testid="wb-exit-focus-top"
              >
                展开互动栏
              </button>
            )}

            <button
              type="button"
              className={`seg-switch-btn hk-wb-mobile-drawer-btn${mobileDrawerOpen && !focusMode ? ' active' : ''}`}
              style={{ fontSize: 12 }}
              onClick={() => {
                if (focusMode) {
                  setFocusMode(false);
                  setMobileDrawerOpen(true);
                } else {
                  setMobileDrawerOpen((v) => !v);
                }
              }}
              data-testid="wb-mobile-drawer-toggle"
            >
              💬 互动/大纲
            </button>

            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="hk-collapse-btn"
                aria-label="白板设置"
                onMouseEnter={() => setSettingsHovered(true)}
                onMouseLeave={() => setSettingsHovered(false)}
                onClick={() => setSettingsOpen((v) => !v)}
              >
                ⚙
              </button>
              {settingsHovered && !settingsOpen && (
                <div
                  className="hk-dark-tooltip"
                  style={{ left: 'auto', right: 0, top: 'calc(100% + 8px)', width: 225 }}
                >
                  设置：字体/语音/语速/快捷键 (Space/←/→/L/F/Esc)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Highlighter & Laser Sub-bar in normal flex flow directly below .hk-wb-float-top */}
        {isBoardStage && annotateMode !== 'off' && (
          <div
            style={{
              margin: '0 16px 6px',
              alignSelf: 'flex-end',
              zIndex: 14,
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 999,
              padding: '5px 10px',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#6b7280', fontWeight: 600 }}>工具:</span>
            {[
              { c: '#facc15' as const, label: '荧光黄' },
              { c: '#ef4444' as const, label: '红笔' },
              { c: '#2563eb' as const, label: '蓝笔' },
            ].map((p) => (
              <button
                key={p.c}
                type="button"
                title={p.label}
                onClick={() => {
                  setAnnotateMode('draw');
                  setPenColor(p.c);
                }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '999px',
                  background: p.c,
                  border: annotateMode === 'draw' && penColor === p.c ? '2px solid #181a1f' : '1px solid rgba(0,0,0,0.12)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
            <button
              type="button"
              className={`btn btn-sm ${annotateMode === 'laser' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '2px 8px', fontSize: 11.5 }}
              onClick={() => setAnnotateMode((m) => (m === 'laser' ? 'draw' : 'laser'))}
              data-testid="wb-laser-btn"
            >
              🔴 激光笔
            </button>
            <span style={{ width: 1, height: 14, background: '#e5e7eb' }} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 7px', fontSize: 11.5 }}
              disabled={currentStrokes.length === 0}
              onClick={() =>
                setStrokesByPage((prev) => ({
                  ...prev,
                  [pageStrokeKey]: (prev[pageStrokeKey] || []).slice(0, -1),
                }))
              }
            >
              撤销
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 7px', fontSize: 11.5 }}
              disabled={currentStrokes.length === 0}
              onClick={() => setStrokesByPage((prev) => ({ ...prev, [pageStrokeKey]: [] }))}
            >
              清空
            </button>
          </div>
        )}

        {/* Whiteboard Main Body */}
        <div className="hk-wb-canvas-scroll">
          {boardMode === 'board' && currentPage && renderBoardPageContent(false)}

          {boardMode === 'split' && (
            <div className="hk-wb-split-grid">
              <div>{currentPage ? renderBoardPageContent(true) : null}</div>
              <div style={{ position: 'sticky', top: 8 }}>
                <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>正在加载函数画板…</div>}>
                  <FunctionPlotCard
                    initialExpr={resolvedPlotExpr}
                    activePreset={activePlotPreset}
                    subject={course.subject}
                  />
                </Suspense>
              </div>
            </div>
          )}

          {boardMode === 'visual' && (
            <div style={{ maxWidth: 820, margin: '0 auto' }}>
              <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>正在加载函数画板…</div>}>
                <FunctionPlotCard
                  initialExpr={resolvedPlotExpr}
                  activePreset={activePlotPreset}
                  subject={course.subject}
                />
              </Suspense>
            </div>
          )}

          {boardMode === 'mindmap' && (
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
              <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>正在加载结构导图…</div>}>
                <MindMapDrawioWorkbench compact subject={course.subject} externalMap={linkedMap} />
              </Suspense>
            </div>
          )}

          {boardMode === 'quiz' && (
            <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>正在载入随堂检验…</div>}>
              <WhiteboardQuizPane
                courseId={course.id}
                lecture={foundLecture}
                subject={course.subject}
                gradeLevel={course.grade_level}
                generatingQuiz={sending}
                onCourseUpdated={onCourseUpdated}
                onGenerateQuiz={() =>
                  handleTeachAction('socratic_check', currentStep?.block || null, '围绕当前本讲内容出一道随堂诊断题')
                }
                onJumpToBlock={(bid) => handleAnchorJump(bid)}
                onBackToBoard={() => setBoardMode('board')}
              />
            </Suspense>
          )}
        </div>

        {/* Bottom Flex Footer Tray (Subtitle Bar + Lecture Player Dock) */}
        {isBoardStage && lectureSteps.length > 0 && (
          <div className="hk-wb-footer-tray">
            {showCaptions && currentStep && (
              <div className="hk-wb-caption-bar" data-testid="wb-caption-bar">
                {lectureCompletedBar ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: '#86efac' }}>✓ 本讲 {lectureSteps.length} 块板书梳理完成！</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => setBoardMode('quiz')}
                      >
                        进入随堂检验
                      </button>
                      {nextLectureInCourse && (
                        <button
                          type="button"
                          className="btn btn-surface btn-sm"
                          style={{ padding: '3px 10px', fontSize: 12 }}
                          onClick={() => onSelectLecture(nextLectureInCourse.id)}
                        >
                          下一讲 →
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={handleMarkCompleted}
                      >
                        标为已掌握
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd' }}>
                        讲课同步字幕 · 第 {safeActiveStepIdx + 1}/{lectureSteps.length} 步
                      </span>
                      {classroomRole === 'teaching' && currentStep.block.teaching_tip && (
                        <span style={{ fontSize: 11, color: '#fde68a' }}>
                          [教研提示: {currentStep.block.teaching_tip}]
                        </span>
                      )}
                    </div>
                    <div>{activeCaptionText}</div>
                  </div>
                )}
              </div>
            )}

            <div className="hk-wb-dock" data-testid="wb-lecture-dock">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12 }}
                onClick={handleToggleLecturePlay}
                data-testid="wb-play-lecture-btn"
              >
                {lecturePlaying ? '⏸ 暂停' : '▶ 开始讲课'}
              </button>

              <button
                type="button"
                className="hk-collapse-btn"
                style={{ width: 26, height: 26 }}
                disabled={safeActiveStepIdx <= 0}
                title="上一步 (←)"
                aria-label="上一步讲解"
                onClick={() => handleStepDelta(-1)}
                data-testid="wb-prev-step-btn"
              >
                ⏮
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px' }}>
                {lectureSteps.map((st) => {
                  const isCur = st.stepIndex === safeActiveStepIdx;
                  return (
                    <button
                      key={st.block.id}
                      type="button"
                      title={`${st.stepIndex + 1}. ${st.block.heading}`}
                      onClick={() => (lecturePlaying ? playStep(st.stepIndex, true) : jumpToStepSilently(st.stepIndex))}
                      style={{
                        width: isCur ? 22 : 16,
                        height: 16,
                        borderRadius: 999,
                        border: 'none',
                        background: isCur ? '#3b4f7d' : st.stepIndex < safeActiveStepIdx ? '#93c5fd' : '#e5e7eb',
                        color: isCur ? '#ffffff' : '#374151',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.14s ease',
                        padding: 0,
                      }}
                    >
                      {st.stepIndex + 1}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="hk-collapse-btn"
                style={{ width: 26, height: 26 }}
                disabled={safeActiveStepIdx >= lectureSteps.length - 1}
                title="下一步 (→)"
                aria-label="下一步讲解"
                onClick={() => handleStepDelta(1)}
                data-testid="wb-next-step-btn"
              >
                ⏭
              </button>

              <span style={{ width: 1, height: 16, background: '#e5e7eb' }} />

              <button
                type="button"
                className="seg-switch-btn"
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                title="切换语速"
                onClick={() => {
                  const cycle = [0.8, 1.0, 1.2, 1.5];
                  const idx = cycle.findIndex((r) => Math.abs(r - speechRate) < 0.12);
                  setSpeechRate(cycle[(idx + 1) % cycle.length]);
                }}
              >
                {speechRate.toFixed(1)}×
              </button>

              <button
                type="button"
                className={`seg-switch-btn ${stepByStepReveal ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                title="切换全览/逐段渐进揭示"
                onClick={() => setStepByStepReveal((v) => !v)}
                data-testid="wb-reveal-toggle"
              >
                {stepByStepReveal ? '逐段' : '全览'}
              </button>

              <button
                type="button"
                className={`seg-switch-btn ${showCaptions ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                onClick={() => setShowCaptions((v) => !v)}
                data-testid="wb-caption-toggle"
              >
                字幕
              </button>

              <span className="mono-num hk-hide-mobile" style={{ fontSize: 11, color: '#6b7280', padding: '0 4px' }}>
                {fmtTimer(elapsedSec)} / {foundLecture.duration_min}m
              </span>

              <button
                type="button"
                className={`seg-switch-btn ${focusMode ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                title="沉浸全屏白板 (F)"
                onClick={() => setFocusMode((v) => !v)}
                data-testid="wb-focus-toggle"
              >
                {focusMode ? '还原' : '沉浸'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SPLITTER HANDLE */}
      {!focusMode && (
        <div
          className="hk-wb-resizer"
          title="拖动调整对话栏宽度"
          onMouseDown={() => {
            dragResizingRef.current = true;
          }}
        >
          <div className="hk-wb-resizer-bar" />
        </div>
      )}

      {/* RIGHT CONVERSATION & OUTLINE DRAWER */}
      {mobileDrawerOpen && !focusMode && (
        <div
          className="hk-wb-mobile-backdrop"
          onClick={() => setMobileDrawerOpen(false)}
          data-testid="wb-mobile-drawer-backdrop"
        />
      )}

      {!focusMode && (
        <aside className={`hk-wb-drawer ${mobileDrawerOpen ? 'mobile-open' : ''}`} style={{ width: drawerWidth }}>
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid #eef0f3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className={`seg-switch-btn ${drawerTab === 'chat' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => setDrawerTab('chat')}
              >
                <HkIcon name="history" size={14} />
                <span>课堂互动</span>
              </button>
              <button
                type="button"
                className={`seg-switch-btn ${drawerTab === 'outline' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 12.5 }}
                onClick={() => setDrawerTab('outline')}
                data-testid="wb-drawer-outline-tab"
              >
                本讲大纲 ({lectureSteps.length})
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                className="select"
                style={{ width: 'auto', maxWidth: 132, padding: '4px 6px', fontSize: 11.5 }}
                value={foundLecture.id}
                onChange={(e) => onSelectLecture(e.target.value)}
                aria-label="切换讲次"
              >
                {course.units.flatMap((u) =>
                  u.lectures.map((l) => (
                    <option key={l.id} value={l.id}>
                      单元{u.unit_index}: {l.title}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="hk-wb-mobile-drawer-close"
                onClick={() => setMobileDrawerOpen(false)}
                data-testid="wb-mobile-drawer-close"
              >
                ✕ 收起
              </button>
            </div>
          </div>

          {drawerTab === 'outline' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                <MathText text={foundLecture.summary || '点击下方步骤卡片即可跳转并点亮对应板书模块'} />
              </div>
              {lectureSteps.map((st) => {
                const isCur = st.stepIndex === safeActiveStepIdx;
                const typeMeta = BLOCK_TYPE_BADGES[st.block.block_type || 'concept'] || BLOCK_TYPE_BADGES.concept;
                return (
                  <button
                    key={st.block.id}
                    type="button"
                    className="hk-continue-card"
                    style={{
                      borderColor: isCur ? '#3b4f7d' : '#e5e7eb',
                      background: isCur ? '#eff6ff' : '#ffffff',
                      padding: '10px 12px',
                    }}
                    onClick={() => playStep(st.stepIndex, false)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span className={`hk-wb-type-badge ${typeMeta.cls}`}>{typeMeta.label}</span>
                      <span className="mono-num" style={{ fontSize: 11, color: '#6b7280' }}>
                        第 {st.pageIndex + 1} 页 · 步 {st.stepIndex + 1}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#181a1f', marginTop: 6 }}>
                      <MathText text={st.block.heading} />
                    </div>
                  </button>
                );
              })}

              {nextLectureInCourse && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => onSelectLecture(nextLectureInCourse.id)}
                >
                  进入下一讲：{nextLectureInCourse.title} →
                </button>
              )}
            </div>
          ) : (
            <>
              <div
                ref={chatScrollRef}
                style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {(foundLecture.messages || []).map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                      maxWidth: m.role === 'user' ? '85%' : '100%',
                    }}
                  >
                    {m.role === 'user' ? (
                      <div
                        style={{
                          background: '#f1f3f6',
                          color: '#181a1f',
                          borderRadius: '14px 14px 4px 14px',
                          padding: '9px 13px',
                          fontSize: 13.5,
                          lineHeight: 1.55,
                        }}
                      >
                        {m.content}
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          {m.board_anchor_id && (
                            <button
                              type="button"
                              className="hk-wb-anchor-chip"
                              style={{ marginBottom: 0 }}
                              onClick={() => handleAnchorJump(m.board_anchor_id)}
                            >
                              <span>✎</span>
                              <span>定位板书</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="hk-wb-anchor-chip"
                            style={{ marginBottom: 0 }}
                            onClick={() => speakPlainText(m.content)}
                            title="朗读这段回答"
                          >
                            <span>🔊</span>
                            <span>朗读</span>
                          </button>
                        </div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151' }}>
                          <MathText text={m.content} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {sending && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {optimisticUserMsg && (
                      <div
                        style={{
                          alignSelf: 'flex-end',
                          maxWidth: '85%',
                          background: '#f1f3f6',
                          color: '#181a1f',
                          borderRadius: '14px 14px 4px 14px',
                          padding: '9px 13px',
                          fontSize: 13.5,
                          lineHeight: 1.55,
                        }}
                      >
                        {optimisticUserMsg}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#6b7280' }}>
                      <HkMascot state="thinking" size={28} />
                      <span>{streamingStage || '正在推导并同步左侧板书…'}</span>
                    </div>
                    {streamingReply && (
                      <div
                        style={{
                          fontSize: 13.5,
                          lineHeight: 1.65,
                          color: '#374151',
                          background: '#f8fafc',
                          padding: '10px 12px',
                          borderRadius: 12,
                        }}
                      >
                        <MathText text={streamingReply} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Pedagogical Action Chips & Focus Pill */}
              <div style={{ padding: '8px 12px 0', borderTop: '1px solid #eef0f3', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {focusedBlock && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: '#eff6ff',
                      color: '#1e3a8a',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      聚焦板块：{focusedBlock.heading}
                    </span>
                    <button
                      type="button"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1e3a8a', fontWeight: 700 }}
                      onClick={() => setFocusedBlockId('')}
                    >
                      ×
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="hk-wb-micro-btn"
                    disabled={sending}
                    onClick={() => handleTeachAction('reexplain_analogy', currentStep?.block, '换个直观比喻重讲当前要点')}
                  >
                    💡 换个比喻
                  </button>
                  <button
                    type="button"
                    className="hk-wb-micro-btn"
                    disabled={sending}
                    onClick={() => handleTeachAction('worked_example', currentStep?.block, '补一道分步例题')}
                  >
                    📝 补道例题
                  </button>
                  <button
                    type="button"
                    className="hk-wb-micro-btn"
                    disabled={sending}
                    onClick={() => handleTeachAction('counterexample', currentStep?.block, '举个反例警示')}
                  >
                    ⚠ 反例
                  </button>
                  <button
                    type="button"
                    className="hk-wb-micro-btn"
                    disabled={sending}
                    onClick={() => handleTeachAction('socratic_check', currentStep?.block, '出一道随堂检验')}
                  >
                    🎯 随堂出一题
                  </button>
                  {classroomRole === 'teaching' && (
                    <button
                      type="button"
                      className="hk-wb-micro-btn"
                      disabled={sending}
                      onClick={() => handleTeachAction('teacher_script', currentStep?.block, '生成试讲口播逐字稿')}
                    >
                      🎤 试讲口播
                    </button>
                  )}
                </div>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#6b7280', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoReadReply}
                    onChange={(e) => setAutoReadReply(e.target.checked)}
                  />
                  <span>回答后自动语音领读</span>
                </label>
              </div>

              <div style={{ padding: '8px 12px 10px' }}>
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 16,
                    padding: '6px 8px 6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#ffffff',
                  }}
                >
                  <input
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      fontSize: 13.5,
                      fontFamily: 'inherit',
                      background: 'transparent',
                    }}
                    placeholder={
                      focusedBlock
                        ? `针对「${focusedBlock.heading.slice(0, 12)}」提问…`
                        : classroomRole === 'teaching'
                        ? '输入备课指令或设问…'
                        : '输入追问或方程 (如 x^2 - 1 = 0)…'
                    }
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendChat();
                      }
                    }}
                  />
                  {hasSpeechRec && (
                    <button
                      type="button"
                      className="hk-collapse-btn"
                      style={{
                        width: 28,
                        height: 28,
                        color: listeningMic ? '#dc2626' : '#6b7280',
                        borderColor: listeningMic ? '#fca5a5' : 'transparent',
                      }}
                      title={listeningMic ? '停止语音输入' : '语音提问'}
                      onClick={handleToggleVoiceMic}
                    >
                      🎤
                    </button>
                  )}
                  <button
                    type="button"
                    className={`hk-circle-btn submit ${chatInput.trim() ? 'ready' : ''}`}
                    style={{ width: 30, height: 30 }}
                    disabled={!chatInput.trim() || sending}
                    aria-label="发送追问"
                    onClick={handleSendChat}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      )}

      {/* BOARD MUTATION ERROR TOAST */}
      {boardMutationError && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            borderRadius: 12,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
            maxWidth: '92vw',
          }}
        >
          <span>{boardMutationError}</span>
          <button
            type="button"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#991b1b',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '0 2px',
            }}
            onClick={() => setBoardMutationError('')}
            aria-label="关闭错误提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* BOARD BLOCK EDITOR MODAL */}
      <Suspense fallback={null}>
        <WhiteboardBlockEditorModal
          open={boardEditorState.open}
          mode={boardEditorState.mode}
          pageIndex={safePageIdx + 1}
          totalPages={pages.length}
          initialBlock={boardEditorState.initialBlock}
          saving={mutatingBoard}
          onClose={() => {
            if (!mutatingBoard) {
              setBoardMutationError('');
              setBoardEditorState((prev) => ({ ...prev, open: false }));
            }
          }}
          onSubmit={handleBoardModalSubmit}
        />
      </Suspense>

      {/* EXIT CONFIRMATION MODAL */}
      {exitConfirmOpen && (
        <div className="modal-backdrop" onClick={() => setExitConfirmOpen(false)}>
          <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>离开本节白板课堂？</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: '#6b7280' }}>
              你可以直接标记本讲为已掌握并更新学习进度，或仅返回课程空间保留当前进度。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-surface btn-sm" onClick={onExit}>
                直接退出
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleMarkCompleted}>
                标为已掌握并退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WHITEBOARD SETTINGS MODAL */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>设置</h2>
              <button type="button" className="hk-collapse-btn" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>白板语音选择</div>
                <div className="hk-wb-grid-2">
                  {VOICE_OPTIONS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="hk-continue-card"
                      style={{
                        borderColor: voiceId === v.id ? '#3b4f7d' : '#e5e7eb',
                        background: voiceId === v.id ? '#e8eef9' : '#ffffff',
                      }}
                      onClick={() => setVoiceId(v.id)}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{v.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                  <span>朗读语速</span>
                  <span className="mono-num">{speechRate.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="2.2"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #eef0f3' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>板书手写体渲染</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>开启后白板推导采用手写楷体风格</div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${handwritingFont ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setHandwritingFont((v) => !v)}
                >
                  {handwritingFont ? '手写体' : '标准体'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #eef0f3' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>白板背景网点</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>辅助板书与图形排版对齐</div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${showDots ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setShowDots((v) => !v)}
                >
                  {showDots ? '显示点阵' : '纯白底'}
                </button>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px solid #eef0f3', fontSize: 12, color: '#6b7280', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: '#374151', marginBottom: 4 }}>键盘快捷键</div>
                <div>`Space` 播放/暂停讲课 · `← / →` 上一步/下一步 · `L` 激光笔 · `A` 荧光笔 · `F` 沉浸全屏 · `Esc` 关闭弹层/退出批注或沉浸</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
