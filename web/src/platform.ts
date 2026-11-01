// Läuft die Oberfläche in der PC-App (Electron) oder im Browser? Nur die PC-App zeigt Wetter.
export const isDesktopApp = typeof window !== 'undefined' && 'stellaDesktop' in window;
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Strg';
