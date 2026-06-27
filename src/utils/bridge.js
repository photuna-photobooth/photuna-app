/**
 * Returns the Electron IPC bridge exposed via contextBridge.
 * window.api and window.electron are both valid aliases (preload exposes both).
 */
export function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.api ?? window.electron ?? null;
}
