import { api } from './store.ts';

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function base64ToUint8(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(isIos() && !isStandalone()
      ? 'Auf dem iPhone/iPad: erst Teilen → „Zum Home-Bildschirm“, dann Stella von dort öffnen.'
      : 'Dieser Browser unterstützt keine Push-Mitteilungen.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', json: sub.toJSON() });
}
