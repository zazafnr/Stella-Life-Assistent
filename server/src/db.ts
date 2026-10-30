import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { todayIn, type ActionGroup, type Attachment, type ChatMessage, type Item, type ItemKind, type ItemStatus, type PermissionLevel, type Tone } from '@stella/shared';
import { config } from './config.ts';

export const db = new Database(path.join(config.dataDir, 'stella.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    ingest_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    subject TEXT,
    title TEXT NOT NULL,
    detail TEXT,
    notes TEXT,
    page TEXT,
    exercises TEXT,
    book TEXT,
    due TEXT,
    time TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    material TEXT,
    parent_id TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX items_user_due ON items(user_id, due);
  CREATE INDEX items_user_updated ON items(user_id, updated_at);
  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    fire_at TEXT NOT NULL,
    message TEXT NOT NULL,
    with_attachments INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT
  );
  CREATE INDEX reminders_due ON reminders(sent_at, fire_at);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, client_id)
  );
  CREATE INDEX messages_user_created ON messages(user_id, created_at);
  CREATE TABLE pending_questions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    run_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    last_error TEXT
  );
  CREATE INDEX jobs_due ON jobs(status, run_at);
  CREATE TABLE secrets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  CREATE TABLE health_days (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    steps INTEGER,
    sleep_hours REAL,
    active_minutes INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    sender TEXT,
    text TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX inbox_user_created ON inbox_events(user_id, created_at);
  `,
  `
  ALTER TABLE reminders ADD COLUMN always INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN external_id TEXT;
  CREATE UNIQUE INDEX items_external ON items(user_id, external_id) WHERE external_id IS NOT NULL;
  CREATE TABLE lessons (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    subject TEXT,
    subject_code TEXT,
    status TEXT NOT NULL DEFAULT 'normal',
    info TEXT
  );
  CREATE INDEX lessons_user_date ON lessons(user_id, date);
  CREATE TABLE mail_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    uid_validity TEXT NOT NULL,
    last_uid INTEGER NOT NULL,
    last_error TEXT,
    checked_at TEXT,
    PRIMARY KEY (user_id, account_id)
  );
  CREATE TABLE notified (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
  `
  CREATE TABLE notes_deliveries (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    delivered_at TEXT NOT NULL,
    notebook TEXT,
    page INTEGER,
    PRIMARY KEY (user_id, item_id)
  );
  `,
  `
  CREATE TABLE llm_usage (
    day TEXT PRIMARY KEY,
    requests INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  -- Stellas Gedächtnis: was sie über den Nutzer weiß (lernt selbst, Nutzer sieht und ändert alles)
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    schedule TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX memories_user ON memories(user_id, updated_at);
  -- Alles, was Stella tut oder vorschlägt – mit Daten zum Rückgängigmachen
  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    params TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    undo TEXT,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX actions_user ON actions(user_id, updated_at);
  ALTER TABLE messages ADD COLUMN action_id TEXT;
  `,
  `
  -- Hinweise („Was hast du vergessen?“): wann zugestellt, welcher Vorschlag dazu, weggeklickt?
  CREATE TABLE hints_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    delivered_at TEXT,
    action_id TEXT,
    dismissed_at TEXT,
    PRIMARY KEY (user_id, key)
  );
  `,
  `
  -- Paket 1: Rolle (der erste Nutzer ist Owner), KI-Zähler je Anbieter und Nutzer, Server-Schlüssel ohne Nutzerbezug
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
  UPDATE users SET role = 'owner' WHERE rowid = (SELECT rowid FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1);
  CREATE TABLE llm_usage_v2 (
    day TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    user_id TEXT NOT NULL DEFAULT '',
    requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, provider, user_id)
  );
  INSERT INTO llm_usage_v2 (day, requests) SELECT day, requests FROM llm_usage;
  DROP TABLE llm_usage;
  ALTER TABLE llm_usage_v2 RENAME TO llm_usage;
  -- secrets bekommt einen Bereich "__system__" (Server-Schlüssel); dafür fällt der Fremdschlüssel weg,
  -- das Löschen mit dem Konto übernimmt ein Trigger
  CREATE TABLE secrets_v2 (
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  INSERT INTO secrets_v2 (user_id, name, value) SELECT user_id, name, value FROM secrets;
  DROP TABLE secrets;
  ALTER TABLE secrets_v2 RENAME TO secrets;
  CREATE TRIGGER secrets_on_user_delete AFTER DELETE ON users BEGIN
    DELETE FROM secrets WHERE user_id = OLD.id;
    DELETE FROM llm_usage WHERE user_id = OLD.id;
  END;
  `,
  `
  -- Paket 2: Absender-Regeln für Mails (gelten vor der KI) und Zwischenspeicher für den Volltext (30 Tage)
  CREATE TABLE mail_rules (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, sender)
  );
  CREATE TABLE mail_bodies (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    body TEXT NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_id)
  );
  `,
  `
  -- Paket 3: Chats nach Tagen. Jede Nachricht gehört zu einem Chat (conversation); alte Nachrichten ordnet backfillConversations() pro Tag zu.
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX conversations_user ON conversations(user_id, updated_at);
  ALTER TABLE messages ADD COLUMN conversation_id TEXT;
  CREATE INDEX messages_conversation ON messages(conversation_id, created_at);
  `,
];

function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

// ---------- Users ----------

export type BookProvider = 'digi4school' | 'scook';

export interface BookConfig {
  subject: string;
  provider: BookProvider;
  url: string;
  /** gedruckte Seitenzahl + Versatz = Seite im E-Book-Viewer */
  pageOffset?: number;
  /** optional: direkte Seiten-URL mit {page} */
  pageUrlTemplate?: string;
}

export interface UserSettings {
  eveningTime?: string;
  studyTime?: string;
  books?: BookConfig[];
  /** veraltet – wird beim Lesen in `books` übernommen */
  digi4schoolBooks?: Omit<BookConfig, 'provider'>[];
  stepGoal?: number;
  /** HÜs automatisch lösen und in Handschrift ins Heft schreiben */
  homeworkAutopilot?: boolean;
  /** Werbung/Spam automatisch in den Papierkorb */
  mailAutoTrash?: boolean;
  /** wie Stella schreibt: nett, frech oder cool */
  tone?: Tone;
  /** Morning Briefing: "auto" = vor der ersten Stunde, "HH:MM" = feste Zeit, "off" = aus */
  briefing?: string;
  /** Sonntagabend den Wochenplan anbieten: "sunday" (Standard) oder "off" */
  weekPlan?: 'sunday' | 'off';
  /** was Stella von sich aus darf (je Bereich), siehe actions.ts */
  permissions?: Partial<Record<ActionGroup, PermissionLevel>>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  timeZone: string;
  settings: UserSettings;
  ingestToken: string;
  /** der erste Nutzer ist 'owner' (darf Server-Schlüssel eintragen), alle anderen 'user' */
  role: 'owner' | 'user';
}

type UserRow = { id: string; name: string; email: string; time_zone: string; settings: string; ingest_token: string; role: string };
function readSettings(json: string): UserSettings {
  const s = JSON.parse(json) as UserSettings;
  if (!s.books && s.digi4schoolBooks) s.books = s.digi4schoolBooks.map((b) => ({ ...b, provider: 'digi4school' }));
  delete s.digi4schoolBooks;
  return s;
}

const toUser = (r: UserRow): User => ({
  id: r.id, name: r.name, email: r.email, timeZone: r.time_zone,
  settings: readSettings(r.settings), ingestToken: r.ingest_token,
  role: r.role === 'owner' ? 'owner' : 'user',
});

export function allUserIds(): string[] {
  return (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((r) => r.id);
}

export function getUser(id: string): User | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function updateUserSettings(id: string, patch: Partial<UserSettings>, timeZone?: string) {
  const user = getUser(id)!;
  const settings = { ...user.settings, ...patch };
  db.prepare('UPDATE users SET settings = ?, time_zone = ? WHERE id = ?')
    .run(JSON.stringify(settings), timeZone ?? user.timeZone, id);
}

// ---------- Items ----------

type ItemRow = {
  id: string; kind: string; subject: string | null; title: string; detail: string | null; notes: string | null;
  page: string | null; exercises: string | null; book: string | null; due: string | null; time: string | null; status: string;
  material: string | null; parent_id: string | null; attachments: string; updated_at: string; deleted: number;
};

export const toItem = (r: ItemRow): Item => ({
  id: r.id, kind: r.kind as ItemKind, subject: r.subject, title: r.title, detail: r.detail, notes: r.notes,
  page: r.page, exercises: r.exercises, due: r.due, time: r.time, status: r.status as ItemStatus,
  material: r.material, parentId: r.parent_id, attachments: JSON.parse(r.attachments),
  updatedAt: r.updated_at, deleted: !!r.deleted,
});

export interface NewItem {
  kind: ItemKind; title: string; subject?: string | null; detail?: string | null; notes?: string | null;
  page?: string | null; exercises?: string | null; book?: string | null; due?: string | null; time?: string | null;
  material?: string | null; parentId?: string | null; source?: string; externalId?: string | null;
}

export function createItem(userId: string, n: NewItem): Item {
  const id = newId();
  const ts = now();
  db.prepare(`INSERT INTO items (id, user_id, kind, subject, title, detail, notes, page, exercises, book, due, time,
      material, parent_id, source, external_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, n.kind, n.subject ?? null, n.title, n.detail ?? null, n.notes ?? null, n.page ?? null,
      n.exercises ?? null, n.book ?? null, n.due ?? null, n.time ?? null, n.material ?? null, n.parentId ?? null,
      n.source ?? 'chat', n.externalId ?? null, ts, ts);
  return getItem(userId, id)!;
}

export function getItem(userId: string, id: string): Item | null {
  const r = db.prepare('SELECT * FROM items WHERE user_id = ? AND id = ?').get(userId, id) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function getItemByExternalId(userId: string, externalId: string): Item | null {
  const r = db.prepare('SELECT * FROM items WHERE user_id = ? AND external_id = ?').get(userId, externalId) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function getItemRaw(userId: string, id: string) {
  return db.prepare('SELECT * FROM items WHERE user_id = ? AND id = ?').get(userId, id) as (ItemRow & { book: string | null }) | undefined;
}

const ITEM_COLUMNS: Record<string, string> = {
  kind: 'kind', subject: 'subject', title: 'title', detail: 'detail', notes: 'notes', page: 'page',
  exercises: 'exercises', due: 'due', time: 'time', status: 'status', material: 'material', deleted: 'deleted',
};

export function updateItem(userId: string, id: string, patch: Partial<Item>): Item | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = ITEM_COLUMNS[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(typeof value === 'boolean' ? Number(value) : value);
  }
  if (patch.attachments) { sets.push('attachments = ?'); values.push(JSON.stringify(patch.attachments)); }
  if (!sets.length) return getItem(userId, id);
  sets.push('updated_at = ?');
  values.push(now(), userId, id);
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`).run(...values);
  return getItem(userId, id);
}

export function addAttachment(userId: string, itemId: string, att: Attachment) {
  const item = getItem(userId, itemId);
  if (!item) return;
  updateItem(userId, itemId, { attachments: [...item.attachments, att] });
}

export function listItems(userId: string, opts: { from?: string; to?: string; includeDone?: boolean; kind?: string } = {}): Item[] {
  const where = ['user_id = ?', 'deleted = 0'];
  const args: unknown[] = [userId];
  if (opts.from) { where.push('(due IS NULL OR due >= ?)'); args.push(opts.from); }
  if (opts.to) { where.push('due <= ?'); args.push(opts.to); }
  if (!opts.includeDone) where.push(`status = 'open'`);
  if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
  const rows = db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY due IS NULL, due, time`).all(...args) as ItemRow[];
  return rows.map(toItem);
}

export function itemsChangedSince(userId: string, since: string): Item[] {
  return (db.prepare('SELECT * FROM items WHERE user_id = ? AND updated_at > ? ORDER BY updated_at')
    .all(userId, since) as ItemRow[]).map(toItem);
}

// ---------- Chats (Konversationen) und Nachrichten ----------

/** In welchem Chat gerade geantwortet wird – gilt für alles, was während einer Chat-Anfrage passiert (auch tief in Hilfsfunktionen). */
export const chatContext = new AsyncLocalStorage<{ userId: string; conversationId: string }>();

type ConversationRow = { id: string; user_id: string; title: string | null; day: string; created_at: string; updated_at: string };

export function getConversation(userId: string, id: string): ConversationRow | null {
  return (db.prepare('SELECT * FROM conversations WHERE user_id = ? AND id = ?').get(userId, id) as ConversationRow | undefined) ?? null;
}

export function createConversation(userId: string, day?: string, createdAt = now()): string {
  const user = getUser(userId);
  const id = newId();
  db.prepare('INSERT INTO conversations (id, user_id, title, day, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)')
    .run(id, userId, day ?? todayIn(user?.timeZone ?? 'Europe/Vienna'), createdAt, createdAt);
  return id;
}

/** Der neueste Chat von heute (Zeitzone des Nutzers) – gibt es noch keinen, wird einer angelegt. */
export function todayConversation(userId: string, create = true): string | null {
  const today = todayIn(getUser(userId)?.timeZone ?? 'Europe/Vienna');
  const row = db.prepare('SELECT id FROM conversations WHERE user_id = ? AND day = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(userId, today) as { id: string } | undefined;
  return row?.id ?? (create ? createConversation(userId, today) : null);
}

/** Alte Nachrichten ohne Chat pro Kalendertag (Zeitzone des Nutzers) einem Chat zuordnen. Läuft beim Start und ist danach ein No-op. */
export function backfillConversations() {
  const users = db.prepare('SELECT DISTINCT user_id FROM messages WHERE conversation_id IS NULL').all() as { user_id: string }[];
  for (const { user_id } of users) {
    const tz = getUser(user_id)?.timeZone;
    if (!tz) continue;
    const rows = db.prepare('SELECT id, created_at FROM messages WHERE user_id = ? AND conversation_id IS NULL ORDER BY created_at, rowid').all(user_id) as { id: string; created_at: string }[];
    const byDay = new Map<string, { id: string; created_at: string }[]>();
    for (const r of rows) {
      const day = todayIn(tz, new Date(r.created_at));
      byDay.set(day, [...(byDay.get(day) ?? []), r]);
    }
    db.transaction(() => {
      for (const [day, msgs] of byDay) {
        const first = msgs[0]!.created_at, last = msgs.at(-1)!.created_at;
        const existing = db.prepare('SELECT id FROM conversations WHERE user_id = ? AND day = ? ORDER BY created_at LIMIT 1').get(user_id, day) as { id: string } | undefined;
        const id = existing?.id ?? newId();
        if (!existing) db.prepare('INSERT INTO conversations (id, user_id, title, day, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').run(id, user_id, day, first, last);
        const set = db.prepare('UPDATE messages SET conversation_id = ? WHERE id = ?');
        for (const m of msgs) set.run(id, m.id);
      }
    })();
  }
}
backfillConversations();

type MsgRow = { id: string; client_id: string | null; role: string; text: string; attachments: string; created_at: string; action_id?: string | null };
const toMessage = (r: MsgRow): ChatMessage => ({
  id: r.id, clientId: r.client_id, role: r.role as ChatMessage['role'], text: r.text,
  attachments: JSON.parse(r.attachments), createdAt: r.created_at,
  ...(r.action_id ? { actionId: r.action_id } : {}),
});

export function findMessageByClientId(userId: string, clientId: string): ChatMessage | null {
  const r = db.prepare('SELECT * FROM messages WHERE user_id = ? AND client_id = ?').get(userId, clientId) as MsgRow | undefined;
  return r ? toMessage(r) : null;
}

/**
 * Nachricht speichern. Ohne `conversationId` landet sie im Chat, in dem gerade geantwortet wird (siehe chatContext),
 * sonst im neuesten Chat von heute – so auch alles, was Stella von sich aus schickt (Briefing, Hinweise, Erinnerungen).
 */
export function addMessage(userId: string, role: ChatMessage['role'], text: string,
  opts: { clientId?: string | null; attachments?: Attachment[]; createdAt?: string; actionId?: string; conversationId?: string } = {}): ChatMessage {
  const id = newId();
  const ctx = chatContext.getStore();
  const conversationId = opts.conversationId ?? (ctx?.userId === userId ? ctx.conversationId : todayConversation(userId)!);
  const createdAt = opts.createdAt ?? now();
  db.prepare('INSERT INTO messages (id, user_id, client_id, role, text, attachments, created_at, action_id, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, opts.clientId ?? null, role, text, JSON.stringify(opts.attachments ?? []), createdAt, opts.actionId ?? null, conversationId);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND updated_at < ?').run(createdAt, conversationId, createdAt);
  return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MsgRow);
}

export function recentMessages(userId: string, limit = 50, before?: string): ChatMessage[] {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?').all(userId, before, limit)
    : db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
  return (rows as MsgRow[]).map(toMessage).reverse();
}

/** Die letzten Nachrichten eines einzelnen Chats (älteste zuerst) – nur das sieht die KI als Verlauf. */
export function conversationMessages(userId: string, conversationId: string, limit = 50, before?: string): ChatMessage[] {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(userId, conversationId, before, limit)
    : db.prepare('SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(userId, conversationId, limit);
  return (rows as MsgRow[]).map(toMessage).reverse();
}

export function conversationMessagesSince(userId: string, conversationId: string, since: string): ChatMessage[] {
  return (db.prepare('SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? AND created_at > ? ORDER BY created_at, rowid')
    .all(userId, conversationId, since) as MsgRow[]).map(toMessage);
}

export function messagesSince(userId: string, since: string): ChatMessage[] {
  return (db.prepare('SELECT * FROM messages WHERE user_id = ? AND created_at > ? ORDER BY created_at')
    .all(userId, since) as MsgRow[]).map(toMessage);
}

// ---------- Reminders ----------

export function addReminder(userId: string, itemId: string | null, fireAt: Date, message: string, withAttachments = false,
  always = false) {
  db.prepare('INSERT INTO reminders (id, user_id, item_id, fire_at, message, with_attachments, always) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), userId, itemId, fireAt.toISOString(), message, Number(withAttachments), Number(always));
}

export function clearOpenReminders(userId: string, itemId: string) {
  db.prepare('DELETE FROM reminders WHERE user_id = ? AND item_id = ? AND sent_at IS NULL').run(userId, itemId);
}

/** Einmal-Benachrichtigungen (z. B. "Stunde entfällt") nicht doppelt schicken */
export function notifyOnce(userId: string, key: string): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)').run(userId, key, now());
  return r.changes > 0;
}

// ---------- Pending questions ----------

export type PendingType = 'exam_material' | 'due_date';

export function setPending(userId: string, type: PendingType, itemId: string) {
  db.prepare('INSERT OR REPLACE INTO pending_questions (user_id, type, item_id, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, type, itemId, now());
}

export function getPending(userId: string): { type: PendingType; itemId: string; createdAt: string } | null {
  const r = db.prepare('SELECT type, item_id, created_at FROM pending_questions WHERE user_id = ?').get(userId) as
    { type: PendingType; item_id: string; created_at: string } | undefined;
  return r ? { type: r.type, itemId: r.item_id, createdAt: r.created_at } : null;
}

export function clearPending(userId: string) {
  db.prepare('DELETE FROM pending_questions WHERE user_id = ?').run(userId);
}

// ---------- Jobs ----------

export function enqueueJob(userId: string, type: string, payload: unknown, runAt = new Date()) {
  db.prepare('INSERT INTO jobs (id, user_id, type, payload, run_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId(), userId, type, JSON.stringify(payload), runAt.toISOString());
}
