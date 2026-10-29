// Datenformen, die Server und Apps teilen (API-Verträge).

import type { ItemKind } from './parser.ts';

export type ItemStatus = 'open' | 'done' | 'cancelled';

export interface Attachment {
  id: string;
  kind: 'image';
  caption?: string;
}

export interface Item {
  id: string;
  kind: ItemKind;
  subject: string | null;
  title: string;
  detail: string | null;
  notes: string | null;
  page: string | null;
  exercises: string | null;
  due: string | null;
  time: string | null;
  status: ItemStatus;
  /** bei Tests: der Stoff */
  material: string | null;
  /** bei Lerneinheiten: zugehöriger Test */
  parentId: string | null;
  attachments: Attachment[];
  updatedAt: string;
  deleted: boolean;
}

export interface ChatMessage {
  id: string;
  clientId: string | null;
  role: 'user' | 'assistant';
  text: string;
  attachments: Attachment[];
  createdAt: string;
  /** offline in der App erzeugt, noch nicht synchronisiert */
  pending?: boolean;
  /** gehört zu einer Aktion (Vorschlag mit Ja/Nein oder Erledigtes mit „Rückgängig“) */
  actionId?: string;
}

/** Wie viel Stella von sich aus tun darf */
export type PermissionLevel = 'auto' | 'notify' | 'ask' | 'never';

/** Bereiche, für die man Stella Rechte gibt */
export type ActionGroup = 'planner' | 'delete' | 'homework' | 'mail_sort' | 'memory';

export type ActionStatus = 'proposed' | 'done' | 'rejected' | 'undone' | 'failed';

/** Etwas, das Stella getan hat oder vorschlägt */
export interface ActionEntry {
  id: string;
  type: string;
  group: ActionGroup;
  summary: string;
  status: ActionStatus;
  source: 'chat' | 'auto';
  canUndo: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCategory = 'person' | 'routine' | 'preference' | 'school' | 'goal' | 'health' | 'other';

/** Etwas, das Stella über den Nutzer weiß */
export interface Memory {
  id: string;
  category: MemoryCategory;
  text: string;
  /** user = ausdrücklich gesagt, learned = selbst gelernt */
  source: 'user' | 'learned';
  /** bei Routinen: wann (für Wochenplanung und Hinweise) */
  schedule: { days: number[]; start: string; end: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  messages: ChatMessage[];
  items: Item[];
  /** die gespeicherte Nutzer-Nachricht (mit Fotos), ersetzt den lokalen Platzhalter */
  userMessage?: ChatMessage;
}

export interface SyncResponse {
  items: Item[];
  messages: ChatMessage[];
  serverTime: string;
  /** Einträge, an denen Stella gerade arbeitet */
  busyItems?: string[];
  /** Aktionen und Vorschläge, die sich seit `since` geändert haben */
  actions?: ActionEntry[];
}

export interface HealthDay {
  date: string;
  steps: number | null;
  sleepHours: number | null;
  activeMinutes: number | null;
}
