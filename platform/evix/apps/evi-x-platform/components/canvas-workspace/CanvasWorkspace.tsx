'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './CanvasWorkspace.module.css';
import { useWorkbenchTheme } from '../workbench/shell-kit';

const ResearchCanvas = dynamic(() => import('@/components/canvas/ResearchCanvas'), { ssr: false, loading: () => <p role="status">正在展开研究画布…</p> });
type Mode = 'workbench' | 'canvas' | 'editor';
export type CanvasEditorContext = { node: { id: string; kind: string; config: Record<string, unknown> }; run?: { result?: unknown } };
type Props = { children: ReactNode; projectId: string | null; projectTitle: string; userId?: string; writable?: boolean; request?: (path: string, init?: RequestInit) => Promise<unknown>; artifactRefs?: Record<string, unknown>; onOpenEditor: (section: string, nodeId?: string, context?: CanvasEditorContext) => void };

/** Both views retain their instances. Mode changes alter visibility only. */
export default function CanvasWorkspace(props: Props) {
  if (process.env.NEXT_PUBLIC_EVIX_RESEARCH_CANVAS !== 'true') return <>{props.children}</>;
  return <CanvasWorkspaceEnabled {...props} />;
}

function CanvasWorkspaceEnabled({ children, projectId, projectTitle, userId, writable = true, request, artifactRefs, onOpenEditor }: Props) {
  const [mode, setMode] = useState<Mode>('workbench');
  const theme = useWorkbenchTheme();
  const [opened, setOpened] = useState(false);
  const composing = useRef(false), pending = useRef<Mode | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const switchButton = useRef<HTMLButtonElement>(null);
  const applyMode = useCallback((next: Mode) => {
    if (next === 'canvas') { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpened(true); }
    setMode(next);
    if (next !== 'canvas') requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); else switchButton.current?.focus({ preventScroll: true }); });
  }, []);
  const switchMode = useCallback((next: Mode) => { if (composing.current) pending.current = next; else applyMode(next); }, [applyMode]);
  useEffect(() => {
    const start = () => { composing.current = true; };
    const end = () => { composing.current = false; const next = pending.current; pending.current = null; if (next) queueMicrotask(() => applyMode(next)); };
    document.addEventListener('compositionstart', start, true); document.addEventListener('compositionend', end, true);
    return () => { document.removeEventListener('compositionstart', start, true); document.removeEventListener('compositionend', end, true); };
  }, [applyMode]);
  const openEditor = useCallback((section: string, nodeId?: string, context?: CanvasEditorContext) => { onOpenEditor(section, nodeId, context); switchMode('editor'); }, [onOpenEditor, switchMode]);
  return <div className={`${styles.workspace} research-canvas-host`} data-theme={theme} data-research-view={mode}>
    <div hidden={mode === 'canvas'}>
      <div className={styles.viewBar}>
        <div className={styles.switch} role="group" aria-label="研究视图">
          <button type="button" aria-pressed={mode !== 'canvas'} onClick={() => switchMode('workbench')}>工作台</button>
          <button type="button" ref={switchButton} aria-pressed={mode === 'canvas'} onClick={() => switchMode('canvas')}>研究画布 <span aria-hidden="true">↗</span></button>
        </div>
        {mode === 'editor' && <button type="button" className={styles.return} onClick={() => switchMode('canvas')}>← 返回画布</button>}
      </div>
      {children}
    </div>
    {opened && <div className={styles.canvas} hidden={mode !== 'canvas'}><ResearchCanvas projectId={projectId} projectTitle={projectTitle} userId={userId} writable={writable} request={request} artifactRefs={artifactRefs} active={mode === 'canvas'} onOpenEditor={openEditor} onExitCanvas={() => switchMode('workbench')}/></div>}
  </div>;
}
