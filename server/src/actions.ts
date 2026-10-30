// Alles, was Stella *tut*, läuft hier durch: eine benannte Aktion mit Rechte-Stufe,
// Protokoll und – wo möglich – Rückgängig.
//
// Stufen je Bereich (Einstellungen → „Was Stella selbst darf“):
//   auto    macht es einfach
//   notify  macht es und sagt im Chat Bescheid (mit „Rückgängig“)
//   ask     fragt vorher (Karte mit Ja / Nein)
//   never   tut es nie
//
// Was der Nutzer im Chat ausdrücklich verlangt („lösch die Mathe-HÜ“), ist seine Zustimmung –
// das führt Stella aus, außer der Bereich steht auf „nie“ oder ist als heikel markiert.
// Was Stella von sich aus tut (Autopilot, Hinweise, Gelerntes), folgt immer der Stufe.

import { formatDateDe, type ActionEntry, type ActionGroup, type ActionStatus, type Item, type Memory, type PermissionLevel } from '@stella/shared';
import { addMessage, db, enqueueJob, getItem, getUser, newId, now, type NewItem, type User } from './db.ts';
import { addMemory, deleteMemory, getMemory, updateMemory, type NewMemory } from './memory.ts';
import type { OutgoingMail } from './mail.ts';
import { addItem, bookFor, changeItem, createStudyPlan } from './planner.ts';

export const GROUPS: Record<ActionGroup, { label: string; help: string; default: PermissionLevel; levels: PermissionLevel[] }> = {
  planner: {
    label: 'Planer ändern',
    help: 'Einträge anlegen, verschieben, Lernpläne erstellen',
    default: 'auto', levels: ['auto', 'notify', 'ask', 'never'],
  },
  delete: {
    label: 'Einträge löschen',
    help: 'wenn Stella von sich aus etwas entfernen will',
    default: 'ask', levels: ['auto', 'notify', 'ask', 'never'],
  },
  homework: {
    label: 'HÜs lösen',
    help: 'lösen und in deiner Handschrift ins Heft schreiben',
    default: 'auto', levels: ['auto', 'notify', 'ask', 'never'],
  },
  mail_sort: {
    label: 'Werbung löschen',
    help: 'Spam und Werbung in den Papierkorb (in der Inbox zurückholbar)',
    default: 'auto', levels: ['auto', 'never'],
  },
  mail_send: {
    label: 'Mails senden',
    help: 'Antworten in deinem Namen – Stella zeigt dir den Text immer vorher',
    default: 'ask', levels: ['ask', 'never'],
  },
  memory: {
    label: 'Sich Dinge merken',
    help: 'lernt selbst über dich – alles siehst und änderst du unter „Was Stella weiß“',
    default: 'auto', levels: ['auto', 'notify', 'ask', 'never'],
  },
};

/** Bereiche, in denen auch eine Bitte im Chat noch einmal bestätigt werden muss (z. B. später: Mails senden) */
const SENSITIVE = new Set<ActionGroup>(['mail_send']);

export const isLevel = (v: unknown): v is PermissionLevel => v === 'auto' || v === 'notify' || v === 'ask' || v === 'never';
export const isGroup = (v: unknown): v is ActionGroup => typeof v === 'string' && v in GROUPS;

export function levelFor(user: User, group: ActionGroup): PermissionLevel {
  const set = user.settings.permissions?.[group];
  if (set && GROUPS[group].levels.includes(set)) return set;
  // ältere Schalter aus den Einstellungen
  if (group === 'homework' && user.settings.homeworkAutopilot === false) return 'never';
  if (group === 'mail_sort' && user.settings.mailAutoTrash === false) return 'never';
  return GROUPS[group].default;
}

// ---------- Aktionstypen ----------

type ItemPatch = Partial<Pick<Item, 'title' | 'detail' | 'notes' | 'due' | 'time' | 'status' | 'material' | 'subject' | 'kind' | 'deleted'>>;

export interface ActionParams {
  'item.create': NewItem;
  'item.update': { id: string; patch: ItemPatch };
  'item.delete': { id: string };
  'study_plan.create': { examId: string; material: string };
  'homework.solve': { itemId: string; again?: boolean };
  'mail.send': OutgoingMail;
  'memory.add': NewMemory;
  'memory.update': { id: string; patch: Partial<Pick<Memory, 'text' | 'category' | 'schedule'>> };
  'memory.delete': { id: string };
}
export type ActionType = keyof ActionParams;

interface Def<T extends ActionType> {
  group: (p: ActionParams[T]) => ActionGroup;
  summary: (user: User, p: ActionParams[T]) => string;
  run: (user: User, p: ActionParams[T]) => { result: unknown; undo?: unknown; changed?: Item[] };
  undo?: (user: User, data: any) => Item[] | void;
}

const itemTitle = (user: User, id: string) => getItem(user.id, id)?.title ?? 'Eintrag';

function describePatch(p: ItemPatch): string {
  if (p.deleted) return 'löschen';
  if (p.status === 'done') return 'abhaken';
  if (p.status === 'open') return 'wieder öffnen';
  if (p.due) return `auf ${formatDateDe(p.due)}${p.time ? `, ${p.time}` : ''} verschieben`;
  if (p.time) return `auf ${p.time} verschieben`;
  return 'ändern';
}

const DEFS: { [T in ActionType]: Def<T> } = {
  'item.create': {
    group: () => 'planner',
    summary: (_u, p) => `${p.title}${p.due ? ` am ${formatDateDe(p.due)}` : ''} eintragen`,
    run: (u, p) => {
      const item = addItem(u, p);
      return { result: { id: item.id }, undo: { id: item.id }, changed: [item] };
    },
    undo: (u, d: { id: string }) => [changeItem(u, d.id, { deleted: true })].filter((i): i is Item => !!i),
  },
  'item.update': {
    group: (p) => (p.patch.deleted ? 'delete' : 'planner'),
    summary: (u, p) => `${itemTitle(u, p.id)} ${describePatch(p.patch)}`,
    run: (u, p) => {
      const before = getItem(u.id, p.id);
      if (!before) throw new Error('Eintrag nicht gefunden');
      const prev = Object.fromEntries(Object.keys(p.patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null]));
      const item = changeItem(u, p.id, p.patch);
      return { result: { ok: true }, undo: { id: p.id, prev }, changed: item ? [item] : [] };
    },
    undo: (u, d: { id: string; prev: ItemPatch }) => [changeItem(u, d.id, d.prev)].filter((i): i is Item => !!i),
  },
  'item.delete': {
    group: () => 'delete',
    summary: (u, p) => `${itemTitle(u, p.id)} löschen`,
    run: (u, p) => {
      const item = changeItem(u, p.id, { deleted: true });
      if (!item) throw new Error('Eintrag nicht gefunden');
      return { result: { ok: true }, undo: { id: p.id }, changed: [item] };
    },
    undo: (u, d: { id: string }) => [changeItem(u, d.id, { deleted: false })].filter((i): i is Item => !!i),
  },
  'study_plan.create': {
    group: () => 'planner',
    summary: (u, p) => `Lernplan für ${itemTitle(u, p.examId)} erstellen`,
    run: (u, p) => {
      const before = getItem(u.id, p.examId);
      const exam = changeItem(u, p.examId, { material: p.material });
      if (!exam) throw new Error('Test nicht gefunden');
      const sessions = createStudyPlan(u, exam.id);
      return {
        result: { sessions: sessions.map((s) => ({ date: s.due, focus: s.detail })) },
        undo: { examId: exam.id, material: before?.material ?? null, sessions: sessions.map((s) => s.id) },
        changed: [exam, ...sessions],
      };
    },
    undo: (u, d: { examId: string; material: string | null; sessions: string[] }) =>
      [...d.sessions.map((id) => changeItem(u, id, { deleted: true })), changeItem(u, d.examId, { material: d.material })]
        .filter((i): i is Item => !!i),
  },
  'homework.solve': {
    group: () => 'homework',
    summary: (u, p) => `${itemTitle(u, p.itemId)} lösen und ins Heft schreiben`,
    run: (u, p) => {
      let item = getItem(u.id, p.itemId);
      if (!item) throw new Error('HÜ nicht gefunden');
      if (p.again) {
        // alte Lösung entfernen, damit neu gelöst (und erneut ins Heft geschrieben) wird
        db.prepare('DELETE FROM notes_deliveries WHERE user_id = ? AND item_id = ?').run(u.id, item.id);
        item = changeItem(u, item.id, {
          status: 'open', notes: null, attachments: item.attachments.filter((a) => !a.caption?.startsWith('Lösung')),
        })!;
      }
      if (!item.attachments.length && !(item.page && bookFor(u, item.subject))) {
        throw new Error('Kein Foto und kein Buch hinterlegt – bitte ein Foto der Aufgabe schicken.');
      }
      enqueueJob(u.id, item.attachments.length ? 'solve_homework' : 'book_page', { itemId: item.id });
      return { result: { ok: true, info: 'Wird im Hintergrund gelöst, der Nutzer bekommt eine Nachricht.' }, changed: [item] };
    },
  },
  'mail.send': {
    group: () => 'mail_send',
    summary: (_u, p) => `Mail an ${p.to} senden („${p.subject}“)`,
    run: (u, p) => {
      enqueueJob(u.id, 'send_mail', p);
      return { result: { queued: true } };
    },
  },
  'memory.add': {
    group: () => 'memory',
    summary: (_u, p) => `mir merken: „${p.text}“`,
    run: (u, p) => {
      const { memory, created } = addMemory(u.id, p);
      return { result: { id: memory.id }, undo: created ? { id: memory.id } : undefined };
    },
    undo: (u, d: { id: string }) => { deleteMemory(u.id, d.id); },
  },
  'memory.update': {
    group: () => 'memory',
    summary: (u, p) => `Gedächtnis ändern: „${p.patch.text ?? getMemory(u.id, p.id)?.text ?? ''}“`,
    run: (u, p) => {
      const prev = getMemory(u.id, p.id);
      if (!prev) throw new Error('Nicht gefunden');
      updateMemory(u.id, p.id, p.patch);
      return { result: { ok: true }, undo: { id: p.id, prev: { text: prev.text, category: prev.category, schedule: prev.schedule } } };
    },
    undo: (u, d: { id: string; prev: Partial<Memory> }) => { updateMemory(u.id, d.id, d.prev); },
  },
  'memory.delete': {
    group: () => 'memory',
    summary: (u, p) => `vergessen: „${getMemory(u.id, p.id)?.text ?? ''}“`,
    run: (u, p) => {
      const prev = getMemory(u.id, p.id);
      if (!prev) throw new Error('Nicht gefunden');
      deleteMemory(u.id, p.id);
      return { result: { ok: true }, undo: { prev } };
    },
    undo: (u, d: { prev: Memory }) => {
      db.prepare('INSERT OR IGNORE INTO memories (id, user_id, category, text, source, schedule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(d.prev.id, u.id, d.prev.category, d.prev.text, d.prev.source, d.prev.schedule ? JSON.stringify(d.prev.schedule) : null, d.prev.createdAt, now());
    },
  },
};

// ---------- Protokoll ----------

type Row = { id: string; type: string; summary: string; params: string; status: string; source: string; undo: string | null; created_at: string; updated_at: string };

const UNDO_WINDOW = 7 * 86_400_000;

const toEntry = (r: Row): ActionEntry => {
  const type = r.type as ActionType;
  const params = JSON.parse(r.params);
  return {
    id: r.id, type: r.type, group: DEFS[type]?.group(params) ?? 'planner', summary: r.summary, status: r.status as ActionStatus,
    source: r.source as ActionEntry['source'],
    canUndo: r.status === 'done' && !!r.undo && !!DEFS[type]?.undo && Date.now() - Date.parse(r.created_at) < UNDO_WINDOW,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
};

const getRow = (userId: string, id: string) => db.prepare('SELECT * FROM actions WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined;

export function getAction(userId: string, id: string): ActionEntry | null {
  const r = getRow(userId, id);
  return r ? toEntry(r) : null;
}

export function listActions(userId: string, opts: { since?: string; limit?: number } = {}): ActionEntry[] {
  const rows = opts.since
    ? db.prepare('SELECT * FROM actions WHERE user_id = ? AND updated_at > ? ORDER BY updated_at').all(userId, opts.since)
    : db.prepare('SELECT * FROM actions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, opts.limit ?? 100);
  return (rows as Row[]).map(toEntry);
}

function setStatus(userId: string, id: string, status: ActionStatus, extra: { undo?: unknown; result?: unknown } = {}) {
  db.prepare('UPDATE actions SET status = ?, undo = COALESCE(?, undo), result = COALESCE(?, result), updated_at = ? WHERE user_id = ? AND id = ?')
    .run(status, extra.undo !== undefined ? JSON.stringify(extra.undo) : null, extra.result !== undefined ? JSON.stringify(extra.result) : null, now(), userId, id);
}

// ---------- Ausführen ----------

export type Performed =
  | { status: 'done'; actionId: string; result: unknown; changed: Item[] }
  | { status: 'proposed'; actionId: string; changed: Item[] }
  | { status: 'refused'; reason: string; changed: Item[] };

export interface PerformOptions {
  /** chat = der Nutzer hat darum gebeten; auto = Stella von sich aus */
  source: 'chat' | 'auto';
  /** Text der Rückfrage, sonst aus der Zusammenfassung gebaut */
  question?: string;
  /** keine eigene Chat-Nachricht (der Aufrufer meldet sich selbst) */
  quiet?: boolean;
  /** statt addMessage – z. B. damit die Nachricht in der Chat-Antwort mitkommt */
  say?: (text: string, actionId: string) => void;
}

export function perform<T extends ActionType>(user: User, type: T, params: ActionParams[T], opts: PerformOptions): Performed {
  const def = DEFS[type] as Def<T>;
  const group = def.group(params);
  const level = levelFor(user, group);
  if (level === 'never') {
    return { status: 'refused', reason: `In den Einstellungen ist „${GROUPS[group].label}“ ausgeschaltet.`, changed: [] };
  }
  const summary = def.summary(user, params);
  const id = newId();
  const t = now();
  const mustAsk = level === 'ask' && (opts.source === 'auto' || SENSITIVE.has(group));
  db.prepare('INSERT INTO actions (id, user_id, type, summary, params, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, type, summary, JSON.stringify(params), mustAsk ? 'proposed' : 'done', opts.source, t, t);

  const say = opts.say ?? ((text: string, actionId: string) => { addMessage(user.id, 'assistant', text, { actionId }); });
  if (mustAsk) {
    say(opts.question ?? `❓ Darf ich ${summary}?`, id);
    return { status: 'proposed', actionId: id, changed: [] };
  }
  try {
    const out = def.run(user, params);
    setStatus(user.id, id, 'done', { undo: out.undo ?? null, result: out.result ?? null });
    if (level === 'notify' && !opts.quiet) say(`✓ ${capitalize(summary)}.`, id);
    return { status: 'done', actionId: id, result: out.result, changed: out.changed ?? [] };
  } catch (err) {
    setStatus(user.id, id, 'failed', { result: { error: (err as Error).message } });
    throw err;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Schon Erledigtes ins Protokoll eintragen (z. B. Kurznotiz über den schnellen Weg), damit „Rückgängig“ geht */
export function record<T extends ActionType>(user: User, type: T, params: ActionParams[T], undoData: unknown, result: unknown = null): string {
  const id = newId();
  const t = now();
  db.prepare(`INSERT INTO actions (id, user_id, type, summary, params, status, source, undo, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'done', 'chat', ?, ?, ?, ?)`)
    .run(id, user.id, type, DEFS[type].summary(user, params), JSON.stringify(params), JSON.stringify(undoData), JSON.stringify(result), t, t);
  return id;
}

/** Eintrag der letzten Chat-Aktion (für Korrekturen wie „nein, Donnerstag“) */
export function lastChatItemId(userId: string, withinMs = 15 * 60_000): string | null {
  const since = new Date(Date.now() - withinMs).toISOString();
  const r = db.prepare(`SELECT type, params, result FROM actions WHERE user_id = ? AND source = 'chat' AND status = 'done'
    AND type IN ('item.create', 'item.update') AND created_at > ? ORDER BY created_at DESC LIMIT 1`).get(userId, since) as
    { type: string; params: string; result: string | null } | undefined;
  if (!r) return null;
  if (r.type === 'item.update') return (JSON.parse(r.params) as { id: string }).id;
  return (JSON.parse(r.result ?? 'null') as { id?: string } | null)?.id ?? null;
}

/** Vorschlag annehmen (Karte „Ja“) */
export function approve(userId: string, id: string): { entry: ActionEntry; changed: Item[] } {
  const r = getRow(userId, id);
  const user = getUser(userId);
  if (!r || !user) throw new Error('Nicht gefunden');
  if (r.status !== 'proposed') throw new Error('Schon entschieden');
  const def = DEFS[r.type as ActionType] as Def<ActionType>;
  try {
    const out = def.run(user, JSON.parse(r.params));
    setStatus(userId, id, 'done', { undo: out.undo ?? null, result: out.result ?? null });
    return { entry: getAction(userId, id)!, changed: out.changed ?? [] };
  } catch (err) {
    setStatus(userId, id, 'failed', { result: { error: (err as Error).message } });
    throw err;
  }
}

/** Vorschlag ablehnen (Karte „Nein“) */
export function reject(userId: string, id: string): ActionEntry {
  const r = getRow(userId, id);
  if (!r) throw new Error('Nicht gefunden');
  if (r.status !== 'proposed') throw new Error('Schon entschieden');
  setStatus(userId, id, 'rejected');
  return getAction(userId, id)!;
}

/** Rückgängig machen */
export function undo(userId: string, id: string): { entry: ActionEntry; changed: Item[] } {
  const r = getRow(userId, id);
  const user = getUser(userId);
  if (!r || !user) throw new Error('Nicht gefunden');
  const entry = toEntry(r);
  if (!entry.canUndo) throw new Error(r.status === 'undone' ? 'Ist schon rückgängig gemacht' : 'Das lässt sich nicht rückgängig machen');
  const def = DEFS[r.type as ActionType] as Def<ActionType>;
  const changed = def.undo!(user, JSON.parse(r.undo!)) ?? [];
  setStatus(userId, id, 'undone');
  return { entry: getAction(userId, id)!, changed };
}

/** letzte rückgängig machbare Aktion (für „mach das rückgängig“ im Chat) */
export function lastUndoable(userId: string, withinMs = 2 * 3600_000): ActionEntry | null {
  const since = new Date(Date.now() - withinMs).toISOString();
  const rows = db.prepare(`SELECT * FROM actions WHERE user_id = ? AND status = 'done' AND undo IS NOT NULL AND created_at > ?
    ORDER BY created_at DESC LIMIT 5`).all(userId, since) as Row[];
  return rows.map(toEntry).find((e) => e.canUndo) ?? null;
}
