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
export type ActionGroup = 'planner' | 'delete' | 'homework' | 'mail_sort' | 'mail_send' | 'memory';

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

/** Ein Chat. Jeder Tag startet automatisch einen neuen; mehrere am Tag bekommen einen Titel. */
export interface Conversation {
  id: string;
  /** KI-Titel (höchstens 5 Wörter) oder null */
  title: string | null;
  /** was angezeigt wird: Titel, sonst „Heute“, „Gestern“ oder „Mi, 4.11.“ */
  label: string;
  day: string;
  lastMessage: string | null;
  updatedAt: string;
  count: number;
}

export interface ChatResponse {
  messages: ChatMessage[];
  items: Item[];
  /** in welchem Chat die Nachricht gelandet ist */
  conversationId?: string;
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
  /** der Chat, zu dem `messages` gehören */
  conversationId?: string | null;
  /** der neueste Chat von heute (null: heute noch nichts geschrieben) */
  current?: string | null;
  /** die letzten Chats mit Titel, neueste zuerst */
  conversations?: Conversation[];
}

export interface HealthDay {
  date: string;
  steps: number | null;
  sleepHours: number | null;
  activeMinutes: number | null;
}

/** Etwas, das Stella bemerkt hat („Was hast du vergessen?“) */
export interface Hint {
  /** stabil, z. B. "exam_no_plan:<id>" – damit derselbe Hinweis nicht zweimal kommt */
  key: string;
  priority: 'high' | 'normal';
  text: string;
  /** Stella kann es gleich erledigen (Knopf) */
  actionLabel?: string;
  /** schon als Vorschlag-Karte verschickt */
  actionId?: string;
  /** statt Aktion: woanders weitermachen (Rückfrage im Chat beantworten, Antwort in der Inbox schreiben) */
  open?: { tab: 'chat' | 'inbox'; label: string };
  itemId?: string;
}

export interface BriefingSection { id: string; title: string; lines: string[] }

/** Der Überblick am Morgen */
export interface Briefing {
  date: string;
  greeting: string;
  sections: BriefingSection[];
  hints: Hint[];
  closing: string;
  /** alles als eine Chat-Nachricht */
  text: string;
  /** wann es heute kommt bzw. kam (HH:MM), null = aus */
  time: string | null;
  sent: boolean;
}

/** Ein Block im Wochenplan – wird beim Übernehmen ein Eintrag (Art „study“) */
export interface PlanBlock {
  /** stabil je Vorschlag, z. B. "<parentId>:2" – damit Ab-/Anwählen eindeutig ist */
  key: string;
  date: string;
  start: string;
  end: string;
  title: string;
  /** Schwerpunkt, z. B. „Mitose“ oder „Alles wiederholen“ */
  focus: string | null;
  subject: string | null;
  /** Test, HÜ oder Abgabe, für die der Block ist */
  parentId: string;
  why: 'exam' | 'homework' | 'assignment';
}

/** „Plan my week“: Vorschlag für die nächsten 7 Tage */
export interface WeekPlan {
  from: string;
  to: string;
  blocks: PlanBlock[];
  /** was nicht ganz aufgeht („Für Bio reicht es nur für 2 Einheiten“) */
  notes: string[];
  /** Zeit, die schon fest eingeplant ist (Minuten je Tag) – für die Wochenansicht */
  load: { date: string; freeMinutes: number; plannedMinutes: number }[];
}
