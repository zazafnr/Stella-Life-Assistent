// Brücke aus der PC-App (desktop/src/preload.js); fehlt im normalen Browser.
interface StellaDesktopBridge {
  platform: string;
  notify(title: string, body: string): void;
  setBadge(count: number): void;
  setTitleBarColor?(color: string): void;
}

interface Window {
  stellaDesktop?: StellaDesktopBridge;
}
