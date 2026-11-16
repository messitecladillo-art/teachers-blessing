/** Clear account-owned drafts without touching other project settings or data. */
export function clearCanvasIdentity(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, ownerId: string): void {
  if (!ownerId || ownerId.length > 80 || /[:\s]/u.test(ownerId)) return;
  const prefix = `evix:canvas:draft:${ownerId}:`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(prefix)) keys.push(key); }
  for (const key of keys) storage.removeItem(key);
}
