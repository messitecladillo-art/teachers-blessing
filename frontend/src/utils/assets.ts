/**
 * Resolve public static asset URLs cleanly across root dev server and sub-path static hosting (e.g., GitHub Pages).
 */
export function assetUrl(path: string): string {
  if (!path) return path;
  if (/^(https?:|data:|blob:|mailto:)/i.test(path)) return path;
  const normalized = path.replace(/^\/+/, '');
  const base =
    (import.meta as { env?: Record<string, string | undefined> }).env?.BASE_URL || './';
  if (base.endsWith('/')) return `${base}${normalized}`;
  return `${base}/${normalized}`;
}
