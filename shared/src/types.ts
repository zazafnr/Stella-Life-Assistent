// Datenformen, die Server und Apps teilen (API-Verträge).

import type { ItemKind } from './parser.ts';

export type ItemStatus = 'open' | 'done' | 'cancelled';

export interface Attachment {
  id: string;
  kind: 'image' | 'audio';
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
  /** Erledigung mit Ort: beim Erinnern zeigt Stella Läden in der Nähe */
  place?: { category: string; label: string } | null;
}

/** Karte unter einer Stella-Nachricht (z. B. Läden in der Nähe) */
export interface MessageCard {
  type: 'places';
  category: string;
  label: string;
  itemId: string | null;
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
  /** nur im Gerät: Sprachnachricht, die Stella nicht abschreiben konnte – die Aufnahme liegt auf dem Server, „Nochmal versuchen“ nutzt diese Id */
  failedAudioId?: string;
  /** gehört zu einer Aktion (Vorschlag mit Ja/Nein oder Erledigtes mit „Rückgängig“) */
  actionId?: string;
  card?: MessageCard;
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
  open?: { tab: 'chat' | 'inbox' | 'goals'; label: string };
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
  why: 'exam' | 'homework' | 'assignment' | 'goal';
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

// ---------- Profil (Einführung, Paket 5) ----------

export const SITUATIONS = ['school', 'university', 'work', 'apprenticeship', 'other'] as const;
export type Situation = (typeof SITUATIONS)[number];
export const FEATURES = ['mails', 'planner', 'homework', 'shopping', 'goals', 'finance', 'health'] as const;
export type Feature = (typeof FEATURES)[number];
export const AGE_GROUPS = ['u14', '14-17', '18-24', '25-34', '35-49', '50+'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/** Wer Stella benutzt und wobei sie helfen soll – steuert Oberfläche, Hinweise und Planung */
export interface UserProfile {
  situation: Situation;
  ageGroup?: AgeGroup;
  /** Arbeitstage (1 = Montag … 7 = Sonntag) und Zeiten; Pendeln ja/nein */
  workHours?: { days: number[]; start: string; end: string; commute?: boolean };
  school?: { level: string };
  university?: { name: string };
  features: Feature[];
}

/** Sieht dieses Profil die Funktion? Ohne Profil (ältere Konten) bleibt alles wie bisher, nur Finanzen braucht eine Einrichtung. */
export function profileHas(profile: UserProfile | undefined, feature: Feature): boolean {
  if (!profile) return feature !== 'finance';
  if (feature === 'homework' && profile.situation !== 'school') return false;
  return profile.features.includes(feature);
}

/** Schule im engen Sinn: Schulbücher, HÜ-Autopilot, WebUntis. Ohne Profil = ja (wie bisher). */
export const profileIsSchool = (profile: UserProfile | undefined) => !profile || profile.situation === 'school';
/** Schule oder Studium: Tests, Lerneinheiten, Lernpläne */
export const profileIsLearner = (profile: UserProfile | undefined) => !profile || profile.situation === 'school' || profile.situation === 'university';

// ---------- Listen und Läden (Paket 7) ----------

export interface ListItem {
  id: string;
  text: string;
  qty: string | null;
  done: boolean;
  addedVia: string;
  createdAt: string;
}

export interface StellaList {
  id: string;
  name: string;
  kind: 'shopping' | 'custom';
  items: ListItem[];
}

export interface NearbyPlace {
  name: string;
  distanceM: number;
  openingHours: string | null;
  /** null = unbekannt */
  openNow: boolean | null;
  address: string | null;
  lat: number;
  lon: number;
  appleMapsUrl: string;
  osmUrl: string;
}

export interface NearbyPlaces {
  category: string;
  label: string;
  plural: string;
  emoji: string;
  places: NearbyPlace[];
}

// ---------- Ziele (Paket 8) ----------

export interface Goal {
  id: string;
  title: string;
  why: string | null;
  /** was gezählt wird, z. B. „km“ oder „Einheiten“ */
  metric: string;
  unit: string;
  /** pro Tag (cadence daily) bzw. pro Woche (sonst) */
  target: number;
  /** daily | weekly:n | custom */
  cadence: string;
  /** Zeit pro Einheit in Minuten – für den Wochenplaner */
  minutes: number | null;
  /** z. B. „So 18:00“ oder „18:00“ */
  checkIn: string | null;
  status: 'active' | 'paused' | 'done';
  createdAt: string;
}

export interface GoalLog {
  id: string;
  date: string;
  value: number;
  note: string | null;
}

export interface GoalProgress extends Goal {
  /** Stand diese Woche (Montag bis Sonntag) */
  weekValue: number;
  weekTarget: number;
  /** die letzten 8 Wochen, älteste zuerst (die letzte ist die aktuelle) */
  history: number[];
  recent: GoalLog[];
}
