// Editionen: Stella gibt es als `life` (Alltag, Beruf) und `students` (Schule, Lehre, Studium) auf einem Server.
// Die Funktionen einer Edition kommen als **Edition-Plugin** – Code, der nicht im Kern liegt, sondern über feste
// Einhängepunkte geladen wird. Ohne Plugin läuft das normale Stella vollständig.
//
// Der Kern ruft nie ein Schul-Modul direkt auf, sondern die Sammel-Funktionen hier (`pluginLessons`, `pluginHints` …).
// Ein Plugin ist ein Objekt mit optionalen Einhängepunkten (`EditionPlugin`). Es bekommt zur Laufzeit die Plugin-API
// (siehe plugin-api.ts) von außen gereicht und importiert vom Kern nur Typen.

import type { FastifyInstance } from 'fastify';
import type { BriefingSection, Edition, Hint, Item, Locale, ParserExtension } from '@stella/shared';
import { extendCatalogs, extendEditionCatalogs, type Catalog } from '@stella/shared';
import { db } from '../db.ts';
import type { ToolDef } from '../llm-types.ts';
import type { PendingType, User } from '../db.ts';
import type { ActionParams, ActionType } from '../actions.ts';
import type { Lagebild, Busy } from '../context.ts';
import type { QuickAction } from '../quick.ts';

export type { Edition };

// ---------- Typen der Einhängepunkte ----------

/** Eine Unterrichts-/Vorlesungsstunde im Lagebild */
export interface Lesson { date: string; start: string; end: string; subject: string | null; code: string | null; status: string; info: string | null }

export interface PluginMigration { id: string; sql: string }

/** Kontext, den ein Werkzeug beim Ausführen bekommt */
export interface PluginToolContext {
  user: User;
  today: string;
  /** Aktion über `perform()` mit Rechte-Stufe, Karte und Rückgängig ausführen */
  act: <T extends ActionType>(type: T, params: ActionParams[T]) => unknown;
}
export interface PluginTool {
  def: ToolDef;
  run: (ctx: PluginToolContext, args: Record<string, any>) => unknown | Promise<unknown>;
  /** nur für diese Nutzer:innen anbieten (Standard: alle) */
  enabledFor?: (user: User) => boolean;
}


export interface PluginContext {
  lessons?: (userId: string, from: string, to: string) => Lesson[];
  /** Wenn für einen Tag nichts bekannt ist: geschätzte Belegung (z. B. „Schule (geschätzt)“) */
  estimatedBusy?: (user: User, date: string, weekend: boolean, lessons: Lesson[]) => Busy | null;
  /** Kurztext zu einem Tag für den KI-Prompt („Schule 08:00–13:00, entfällt: …“) */
  daySummary?: (lessons: Lesson[]) => string;
  /** nächste Stunde in einem Fach nach `after` (für „Latein HÜ“ ohne Datum) */
  nextLessonDate?: (userId: string, subject: string, after: string) => string | null;
  /** Anzeigename eines Buch-Anbieters („digi4school“, „scook“) für Chat-Antworten */
  bookProviderName?: (provider: string) => string | null;
}

export interface PluginHints { (user: User, lb: Lagebild): FoundHintLike[] }
/** Form eines Hinweises (siehe hints.ts `FoundHint`); hier ohne Zyklus beschrieben */
export type FoundHintLike = Hint & { action?: { type: ActionType; params: ActionParams[ActionType]; label: string }; pending?: { type: PendingType; itemId: string } };

export interface PluginBriefing {
  sections?: (user: User, lb: Lagebild) => BriefingSection[];
  /** Zeilen für „Das habe ich für dich erledigt“ (seit `sinceIso`) */
  done?: (user: User, sinceIso: string) => string[];
}

/** Aktionen und Rechte-Bereiche eines Plugins (Form wie in actions.ts: `Def` / `GroupDef`) */
export interface PluginActions {
  groups?: Record<string, { label: string; help: string; default: 'auto' | 'notify' | 'ask' | 'never'; levels: ('auto' | 'notify' | 'ask' | 'never')[] }>;
  defs?: Record<string, unknown>;
}

export interface PluginAutomation { key: `perm:${string}`; title: string; when: string }

export interface PluginQuickAction extends Omit<QuickAction, 'label' | 'text'> { needs?: string; hasText?: boolean; after?: string }

export interface PluginScheduler {
  /** Hintergrund-Jobs (`enqueueJob(user, type, payload)`) nach Typ */
  jobs?: Record<string, (userId: string, payload: any) => Promise<void>>;
  /** läuft jede Minute je Nutzer; `every(key, ms, fn)` begrenzt die Häufigkeit */
  periodic?: (userId: string, every: (key: string, ms: number, fn: () => Promise<void>) => Promise<void>) => Promise<void>;
}

/** Beschreibung eines Einstellungs-Abschnitts; die Web-App rendert ihn (Paket 5/7) */
export interface PluginSettingsSection {
  id: string;
  titleKey: string;
  /** ob schon verbunden/eingerichtet (für ein Häkchen) */
  connected?: boolean;
  actions: { id: string; labelKey: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string }[];
}

/** Zusätzlicher Schritt der Einführung */
export interface PluginOnboardingStep { id: string; after: string; titleKey: string }

export interface EditionPlugin {
  /** z. B. 'students' */
  id: string;
  edition: Edition;
  migrations?: PluginMigration[];
  /** API-Pfade, innerhalb des Logins registriert (`req.user` ist gesetzt) */
  routes?: (app: FastifyInstance) => void;
  tools?: PluginTool[];
  /** Aktionen mit Rechte-Stufe (siehe actions.ts) */
  actions?: PluginActions;
  /** Zusatz zum System-Prompt: `rules` nach der Sprachregel, `capabilities` nach der Test-Regel */
  prompt?: (user: User) => { rules?: string[]; capabilities?: string[] };
  parser?: ParserExtension;
  context?: PluginContext;
  hints?: PluginHints;
  briefing?: PluginBriefing;
  stellaPlan?: (user: User) => PluginAutomation[];
  quickActions?: (user: User) => PluginQuickAction[];
  scheduler?: PluginScheduler;
  catalog?: Partial<Record<Locale, Catalog>>;
  /** Texte, die in dieser Edition anders lauten als im Kern (gleiche Schlüssel, z. B. Schulwörter statt der neutralen Fassung) */
  overrides?: Partial<Record<Locale, Catalog>>;
  settings?: (user: User) => PluginSettingsSection[];
  onboarding?: PluginOnboardingStep[];
  /** Zusätzliche VEVENT-Blöcke für das Kalender-Abo (ohne BEGIN/END:VCALENDAR) */
  ical?: (user: User) => string[];
  /** Zusatzfelder für `integrations` in `GET /api/me` */
  integrations?: (user: User) => Record<string, unknown>;
  /** Wird nach dem Anlegen eines Eintrags aufgerufen (z. B. Buchseite holen) */
  onItemCreated?: (user: User, item: Item) => void;
  /** Zusätzliche Erinnerungen zu einem Eintrag (z. B. Abgabe einer Uni-Veranstaltung 7 Tage vorher); gehen beim Neuplanen nicht verloren */
  reminders?: (user: User, item: Item) => { date: string; time: string; message: string; withAttachments?: boolean }[];
}

// ---------- Registry ----------

const plugins = new Map<string, EditionPlugin>();

export function registerEdition(plugin: EditionPlugin): void {
  if (plugins.has(plugin.id)) throw new Error(`Edition-Plugin „${plugin.id}“ ist schon geladen.`);
  runPluginMigrations(plugin);
  if (plugin.catalog) extendCatalogs(plugin.catalog);
  if (plugin.overrides) extendEditionCatalogs(plugin.edition, plugin.overrides);
  plugins.set(plugin.id, plugin);
}

/** Für Tests: alle Plugins entladen (Migrationen bleiben in der Datenbank) */
export function resetEditions(): void { plugins.clear(); }

export const editions = (): EditionPlugin[] => [...plugins.values()];
export const hasEdition = (id: string) => plugins.has(id);

/** Migrationen des Plugins in einem eigenen Zähler (`edition_migrations`), getrennt von `PRAGMA user_version` des Kerns */
function runPluginMigrations(plugin: EditionPlugin): void {
  if (!plugin.migrations?.length) return;
  db.exec(`CREATE TABLE IF NOT EXISTS edition_migrations (plugin TEXT NOT NULL, id TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (plugin, id))`);
  const done = new Set((db.prepare('SELECT id FROM edition_migrations WHERE plugin = ?').all(plugin.id) as { id: string }[]).map((r) => r.id));
  for (const m of plugin.migrations) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO edition_migrations (plugin, id, applied_at) VALUES (?, ?, ?)').run(plugin.id, m.id, new Date().toISOString());
    })();
  }
}

// ---------- Sammel-Funktionen für den Kern ----------

export function pluginRoutes(app: FastifyInstance): void { for (const p of plugins.values()) p.routes?.(app); }

export function pluginLessons(userId: string, from: string, to: string): Lesson[] {
  return editions().flatMap((p) => p.context?.lessons?.(userId, from, to) ?? []);
}
export function pluginEstimatedBusy(user: User, date: string, weekend: boolean, lessons: Lesson[]): Busy | null {
  for (const p of plugins.values()) { const b = p.context?.estimatedBusy?.(user, date, weekend, lessons); if (b) return b; }
  return null;
}
export function pluginDaySummary(lessons: Lesson[]): string {
  return editions().map((p) => p.context?.daySummary?.(lessons)).filter(Boolean).join(' ');
}
export function pluginNextLessonDate(userId: string, subject: string, after: string): string | null {
  for (const p of plugins.values()) { const d = p.context?.nextLessonDate?.(userId, subject, after); if (d) return d; }
  return null;
}

export function pluginBookProviderName(provider: string): string {
  for (const p of plugins.values()) { const n = p.context?.bookProviderName?.(provider); if (n) return n; }
  return provider;
}

export const pluginActionGroups = (): NonNullable<PluginActions['groups']> => Object.assign({}, ...editions().map((p) => p.actions?.groups ?? {}));
export const pluginActionDefs = (): NonNullable<PluginActions['defs']> => Object.assign({}, ...editions().map((p) => p.actions?.defs ?? {}));

export const pluginTools = (user: User): PluginTool[] => editions().flatMap((p) => p.tools ?? []).filter((t) => !t.enabledFor || t.enabledFor(user));
export const pluginTool = (name: string): PluginTool | undefined => editions().flatMap((p) => p.tools ?? []).find((t) => t.def.function.name === name);

export function pluginPrompt(user: User): { rules: string[]; capabilities: string[] } {
  const out = { rules: [] as string[], capabilities: [] as string[] };
  for (const p of plugins.values()) {
    const x = p.prompt?.(user);
    if (x?.rules) out.rules.push(...x.rules);
    if (x?.capabilities) out.capabilities.push(...x.capabilities);
  }
  return out;
}

export const pluginHints = (user: User, lb: Lagebild): FoundHintLike[] => editions().flatMap((p) => p.hints?.(user, lb) ?? []);
export const pluginBriefingSections = (user: User, lb: Lagebild): BriefingSection[] => editions().flatMap((p) => p.briefing?.sections?.(user, lb) ?? []);
export const pluginBriefingDone = (user: User, sinceIso: string): string[] => editions().flatMap((p) => p.briefing?.done?.(user, sinceIso) ?? []);
export const pluginAutomations = (user: User): PluginAutomation[] => editions().flatMap((p) => p.stellaPlan?.(user) ?? []);
export const pluginQuickActions = (user: User): PluginQuickAction[] => editions().flatMap((p) => p.quickActions?.(user) ?? []);
export const pluginJobs = (): Record<string, (userId: string, payload: any) => Promise<void>> => Object.assign({}, ...editions().map((p) => p.scheduler?.jobs ?? {}));
export const pluginSettings = (user: User): PluginSettingsSection[] => editions().flatMap((p) => p.settings?.(user) ?? []);
export const pluginOnboarding = (): PluginOnboardingStep[] => editions().flatMap((p) => p.onboarding ?? []);
export const pluginIcal = (user: User): string[] => editions().flatMap((p) => p.ical?.(user) ?? []);
export const pluginIntegrations = (user: User): Record<string, unknown> => Object.assign({}, ...editions().map((p) => p.integrations?.(user) ?? {}));
/** Zusatzwörter aller Plugins für `interpret()`; ohne Plugin `undefined` (dann gilt der Wortschatz des Kerns) */
export function pluginParser(): ParserExtension | undefined {
  const all = editions().map((p) => p.parser).filter((x): x is ParserExtension => !!x);
  if (!all.length) return undefined;
  return {
    subjects: all.flatMap((x) => x.subjects ?? []), singleLetters: Object.assign({}, ...all.map((x) => x.singleLetters ?? {})),
    kinds: all.flatMap((x) => x.kinds ?? []), kindsEn: all.flatMap((x) => x.kindsEn ?? []),
    labels: Object.assign({}, ...all.map((x) => x.labels ?? {})), subjectNamesEn: Object.assign({}, ...all.map((x) => x.subjectNamesEn ?? {})),
  };
}
export function pluginReminders(user: User, item: Item): { date: string; time: string; message: string; withAttachments: boolean }[] {
  return editions().flatMap((p) => p.reminders?.(user, item) ?? []).map((r) => ({ ...r, withAttachments: !!r.withAttachments }));
}
export function pluginItemCreated(user: User, item: Item): void { for (const p of plugins.values()) p.onItemCreated?.(user, item); }
export async function pluginPeriodic(userId: string, every: (key: string, ms: number, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  for (const p of plugins.values()) await p.scheduler?.periodic?.(userId, every);
}

// ---------- Edition einer Anfrage und eines Kontos ----------

const STUDENTS_HOST = /^students\./i;

/**
 * Auf welcher Oberfläche kommt die Anfrage an? Der Host (`students.…`) gilt zuerst, dann das Feld `edition` (Body oder Header
 * `x-stella-edition`, z. B. für lokale Entwicklung und die iOS-Apps), sonst `life`.
 */
export function requestEdition(req: { headers: Record<string, unknown>; body?: unknown }): Edition {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim();
  if (STUDENTS_HOST.test(host)) return 'students';
  const fromBody = (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).edition : undefined);
  const raw = fromBody ?? req.headers['x-stella-edition'];
  return raw === 'students' ? 'students' : 'life';
}

/** Produktname je Edition (Mail-Absender, Betreff, Kopf der Vorlagen) */
export const EDITION_PRODUCT: Record<Edition, string> = { life: 'Stella', students: 'Stella for Students' };
/** „Stella“ im Text durch den Produktnamen der Edition ersetzen (die Kataloge nennen immer nur „Stella“) */
export const brandText = (text: string, product: string) => (product === EDITION_PRODUCT.life ? text : text.replace(/\bStella\b(?! for Students)/g, product));

/** Edition eines Kontos (unbekannt oder gelöscht: `life`) */
export function editionOfUser(userId: string): Edition {
  const r = db.prepare('SELECT edition FROM users WHERE id = ?').get(userId) as { edition?: string } | undefined;
  return r?.edition === 'students' ? 'students' : 'life';
}
