// Lokaler Zustand + Offline-Logik.
// Alles wird im Gerät zwischengespeichert. Ohne Netz landen Nachrichten in einem Postausgang;
// Kurznotizen versteht die App trotzdem sofort (gleicher Parser wie der Server) und zeigt sie
// im Planer an. Sobald wieder Netz da ist, wird alles mit dem VPS abgeglichen.

import { useSyncExternalStore } from 'react';
import {
  formatDateDe, interpret, todayIn, type ChatMessage, type ChatResponse, type Item, type SyncResponse,
} from '@stella/shared';

export type BookProvider = 'digi4school' | 'scook';
export interface BookConfig { subject: string; provider: BookProvider; url: string; pageOffset?: number; pageUrlTemplate?: string }

export interface Me {
  id: string; name: string; email: string; timeZone: string; ingestUrl: string;
  settings: {
    eveningTime?: string; studyTime?: string; stepGoal?: number;
    books?: BookConfig[]; homeworkAutopilot?: boolean; mailAutoTrash?: boolean;
  };
  integrations: {
    books: Record<BookProvider, { connected: boolean; cookies: boolean; email: string | null }>;
    webuntis: boolean;
    mailAccounts: number;
    handwritingFont: boolean;
    freeNotes?: boolean;
  };
}

interface OutboxEntry { clientId: string; text: string; createdAt: string }

interface State {
  token: string | null;
  me: Me | null;
  items: Record<string, Item>;
  messages: ChatMessage[];
  outbox: OutboxEntry[];
  lastSync: string | null;
  online: boolean;
  thinking: boolean;
  busyItems: string[];
}

const STORAGE_KEY = 'stella-state-v1';

function load(): State {
  const base: State = { token: null, me: null, items: {}, messages: [], outbox: [], lastSync: null, online: navigator.onLine, thinking: false, busyItems: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...base, ...JSON.parse(raw), online: navigator.onLine, thinking: false };
  } catch { /* privater Modus o. Ä. */ }
  return base;
}

let state = load();
const listeners = new Set<() => void>();

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  try {
    const { online, thinking, ...persist } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persist, messages: persist.messages.slice(-300) }));
  } catch { /* Speicher voll/gesperrt – App läuft trotzdem */ }
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => select(state));
}
export const getState = () => state;

// ---------- HTTP ----------

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 401 && state.token) { logoutLocal(); throw new ApiError(401, 'Bitte neu anmelden.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Fehler ${res.status}`);
  return data as T;
}

const isNetworkError = (err: unknown) => !(err instanceof ApiError);

// ---------- Anmeldung ----------

export async function authenticate(mode: 'login' | 'register', body: Record<string, string>) {
  const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : navigator.platform;
  const { token, user } = await api<{ token: string; user: Me }>(`/api/auth/${mode}`, {
    method: 'POST', json: { ...body, device, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  set({ token, me: user, items: {}, messages: [], outbox: [], lastSync: null });
  await sync();
}

export function logoutLocal() {
  set({ token: null, me: null, items: {}, messages: [], outbox: [], lastSync: null });
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  logoutLocal();
}

export async function refreshMe() {
  set({ me: await api<Me>('/api/me') });
}

// ---------- Abgleich ----------

function mergeItems(items: Item[], dropLocal: string[] = []) {
  set((s) => {
    const next = { ...s.items };
    for (const id of dropLocal) delete next[id];
    for (const i of items) {
      if (i.deleted) delete next[i.id];
      else next[i.id] = i;
    }
    return { items: next };
  });
}

function mergeMessages(incoming: ChatMessage[]) {
  set((s) => {
    const byId = new Map(s.messages.map((m) => [m.id, m]));
    for (const m of incoming) {
      // lokale Platzhalter durch Server-Version ersetzen
      if (m.clientId) {
        byId.delete(`local-${m.clientId}`);
      }
      byId.set(m.id, m);
    }
    const messages = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { messages };
  });
}

// In der PC-App (Electron) gibt es kein Web-Push: neue Stella-Nachrichten als Systemmitteilung zeigen
function notifyDesktop(incoming: ChatMessage[], firstSync: boolean) {
  const desktop = (window as { stellaDesktop?: { notify: (title: string, body: string) => void } }).stellaDesktop;
  if (!desktop || firstSync) return;
  const known = new Set(state.messages.map((m) => m.id));
  for (const m of incoming) {
    if (m.role === 'assistant' && !known.has(m.id) && (document.hidden || !document.hasFocus())) {
      desktop.notify('Stella', m.text.replace(/\*\*|_/g, '').slice(0, 180));
    }
  }
}

let syncing: Promise<void> | null = null;

export function sync(): Promise<void> {
  if (!state.token) return Promise.resolve();
  syncing ??= (async () => {
    try {
      await flushOutbox();
      const q = state.lastSync ? `?since=${encodeURIComponent(state.lastSync)}` : '';
      const res = await api<SyncResponse>(`/api/sync${q}`);
      notifyDesktop(res.messages, !state.lastSync);
      if (!state.lastSync) set({ items: {} });
      mergeItems(res.items);
      mergeMessages(res.messages);
      set({ lastSync: res.serverTime, online: true, busyItems: res.busyItems ?? [] });
    } catch (err) {
      if (isNetworkError(err)) set({ online: false });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function flushOutbox() {
  for (const entry of [...state.outbox]) {
    let res: ChatResponse = { messages: [], items: [] };
    try {
      res = await api<ChatResponse>('/api/chat', { method: 'POST', json: { text: entry.text, clientId: entry.clientId } });
    } catch (err) {
      if (isNetworkError(err)) throw err; // später nochmal
      // Server lehnt ab (z. B. leere Nachricht) → nicht ewig wiederholen
    }
    set((s) => ({
      outbox: s.outbox.filter((o) => o.clientId !== entry.clientId),
      messages: s.messages.filter((m) => m.id !== `local-reply-${entry.clientId}`),
    }));
    mergeItems(res.items, [`local-${entry.clientId}`]);
    mergeMessages(res.userMessage ? [res.userMessage, ...res.messages] : res.messages);
  }
}

// ---------- Chat ----------

export async function sendMessage(text: string, images: string[] = []) {
  if (images.length && !navigator.onLine) throw new Error('Fotos kann ich nur mit Internet annehmen.');
  const clientId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const local: ChatMessage = {
    id: `local-${clientId}`, clientId, role: 'user', text: text || '📸', attachments: [], createdAt, pending: true,
  };
  set((s) => ({ messages: [...s.messages, local] }));

  if (navigator.onLine) {
    set({ thinking: true });
    try {
      const res = await api<ChatResponse>('/api/chat', { method: 'POST', json: { text, clientId, images } });
      set((s) => ({ messages: s.messages.map((m) => (m.id === local.id ? { ...m, pending: false } : m)) }));
      mergeItems(res.items);
      mergeMessages(res.userMessage ? [res.userMessage, ...res.messages] : res.messages);
      set({ online: true });
      return;
    } catch (err) {
      if (!isNetworkError(err) || images.length) {
        set((s) => ({ messages: s.messages.filter((m) => m.id !== local.id) }));
        throw err;
      }
    } finally {
      set({ thinking: false });
    }
  }
  queueOffline(text, clientId, createdAt);
}

function queueOffline(text: string, clientId: string, createdAt: string) {
  const tz = state.me?.timeZone ?? 'Europe/Vienna';
  const today = todayIn(tz);
  const intent = interpret(text, today);
  let reply = '📴 Du bist offline – ich hab die Nachricht gespeichert und schicke sie, sobald du wieder Netz hast.';
  let localItem: Item | null = null;
  if (intent?.type === 'create' && intent.entry.due) {
    const e = intent.entry;
    localItem = {
      id: `local-${clientId}`, kind: e.kind, subject: e.subject, title: e.title, detail: e.detail || null, notes: null,
      page: e.page, exercises: e.exercises, due: e.due, time: e.time, status: 'open', material: null, parentId: null,
      attachments: [], updatedAt: createdAt, deleted: false,
    };
    reply = `📴 Offline notiert: **${e.title}**${e.detail ? ` – ${e.detail}` : ''}, ${formatDateDe(e.due!, today)} – ` +
      'Erinnerungen & Lernplan richte ich ein, sobald du wieder online bist.';
  }
  const replyMsg: ChatMessage = {
    id: `local-reply-${clientId}`, clientId: null, role: 'assistant', text: reply, attachments: [],
    createdAt: new Date(Date.parse(createdAt) + 1).toISOString(), pending: true,
  };
  set((s) => ({
    outbox: [...s.outbox, { clientId, text, createdAt }],
    messages: [...s.messages, replyMsg],
    items: localItem ? { ...s.items, [localItem.id]: localItem } : s.items,
    online: false,
  }));
}

// ---------- Planer ----------

export async function patchItem(id: string, patch: Partial<Item>) {
  const prev = state.items[id];
  if (prev) mergeItems([{ ...prev, ...patch }]);
  try {
    mergeItems([await api<Item>(`/api/items/${id}`, { method: 'PATCH', json: patch })]);
  } catch (err) {
    if (prev) mergeItems([prev]);
    throw err;
  }
}

export async function deleteItem(id: string) {
  const prev = state.items[id];
  mergeItems([], [id]);
  try {
    await api(`/api/items/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (prev) mergeItems([prev]);
    throw err;
  }
}

// ---------- Hintergrund ----------

let started = false;
export function startBackgroundSync() {
  if (started) { void sync(); return; }
  started = true;
  const onOnline = () => { set({ online: true }); void sync(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data === 'sync') void sync(); });
  setInterval(() => { if (!document.hidden) void sync(); }, 20_000);
  void sync();
}

/** Foto verkleinern (max. 2000 px, JPEG) – spart Datenvolumen, reicht zum Lesen der Aufgabe. */
export async function compressImage(file: File, maxSide = 2000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
