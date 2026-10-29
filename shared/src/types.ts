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
}

export interface HealthDay {
  date: string;
  steps: number | null;
  sleepHours: number | null;
  activeMinutes: number | null;
}
