export type CanvasMotionPreference = 'standard' | 'reduced' | 'off';
export const CANVAS_MOTION = Object.freeze({ press: 90, release: 160, hover: 120, selection: 180, enter: 220, reorder: 240, group: 260, layout: 300, remove: 160, transfer: 300 });
export function canvasMotionDuration(action: keyof typeof CANVAS_MOTION, preference: CanvasMotionPreference, systemReduced = false): number {
  return preference === 'off' || preference === 'reduced' || systemReduced ? 0 : CANVAS_MOTION[action];
}
export function canvasDetailLevel(zoom: number): 'detail' | 'summary' | 'title' | 'overview' {
  return zoom >= 1 ? 'detail' : zoom >= .6 ? 'summary' : zoom >= .3 ? 'title' : 'overview';
}
export function snapCanvasPosition(point: { x: number; y: number }, bypass = false, grid = 16) {
  return bypass ? { ...point } : { x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid };
}
export function interpolateCanvasPositions(from: Record<string, { x: number; y: number }>, to: Record<string, { x: number; y: number }>, progress: number) {
  const t = Math.max(0, Math.min(1, progress)), eased = 1 - Math.pow(1 - t, 3);
  return Object.fromEntries(Object.entries(to).map(([id, end]) => { const start = from[id] ?? end; return [id, { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased }]; }));
}

/** Visual children only: never animate the React Flow positioning wrapper. */
export function createCanvasMotion(scope: HTMLElement, getPreference: () => CanvasMotionPreference) {
  const active = new Map<Element, Animation>();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  const cancel = (element?: Element) => {
    if (element) { active.get(element)?.cancel(); active.delete(element); }
    else { active.forEach(animation => animation.cancel()); active.clear(); }
  };
  const visibility = () => { if (document.hidden || reduced.matches) cancel(); };
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', visibility);
  function animate(element: Element, frames: Keyframe[], action: keyof typeof CANVAS_MOTION, delay = 0) {
    cancel(element);
    const duration = canvasMotionDuration(action, getPreference(), reduced.matches);
    if (disposed || !duration || document.hidden || !scope.contains(element) || typeof element.animate !== 'function') return;
    const animation = element.animate(frames, { duration, delay: Math.min(delay, 210), easing: 'cubic-bezier(.16,.8,.12,1)' });
    active.set(element, animation);
    animation.onfinish = animation.oncancel = () => { if (active.get(element) === animation) active.delete(element); };
  }
  return { animate, cancel, dispose: () => { disposed = true; cancel(); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); } };
}
