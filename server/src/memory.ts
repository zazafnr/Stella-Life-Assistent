// Stellas Gedächtnis: dauerhafte Fakten über den Nutzer (Personen, Routinen, Vorlieben,
// Schule, Ziele). Stella lernt selbst – im Chat über das Werkzeug `remember` und einmal pro
// Nacht aus den Nachrichten des Tages. Der Nutzer sieht alles in den Einstellungen und kann
// jeden Eintrag ändern oder löschen. Einmalige Dinge („Freitag Zahnarzt“) sind Einträge im
// Planer, keine Erinnerungen an den Menschen.

import type { Memory, MemoryCategory } from '@stella/shared';
import { db, newId, now } from './db.ts';

export const MEMORY_CATEGORIES: Record<MemoryCategory, string> = {
  person: 'Personen',
  routine: 'Routinen',
  preference: 'Vorlieben',
  school: 'Schule',
  goal: 'Ziele',
  health: 'Gesundheit',
  other: 'Sonstiges',
};

const MAX_PER_USER = 200;

type Row = { id: string; category: string; text: string; source: string; schedule: string | null; created_at: string; updated_at: string };

const toMemory = (r: Row): Memory => ({
  id: r.id, category: r.category as MemoryCategory, text: r.text, source: r.source as Memory['source'],
  schedule: r.schedule ? JSON.parse(r.schedule) : null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const isCategory = (c: unknown): c is MemoryCategory => typeof c === 'string' && c in MEMORY_CATEGORIES;

/** "Di/Do 17:00–18:30" → { days: [2, 4], start, end } – Wochentage 1 = Montag … 7 = Sonntag */
export function cleanSchedule(raw: unknown): Memory['schedule'] {
  const s = raw as { days?: unknown; start?: unknown; end?: unknown } | null;
  if (!s || !Array.isArray(s.days)) return null;
  const days = [...new Set(s.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort();
  const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null);
  const start = time(s.start);
  const end = time(s.end);
  return days.length && start && end && end > start ? { days, start, end } : null;
}

export function listMemories(userId: string): Memory[] {
  return (db.prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY category, updated_at DESC').all(userId) as Row[]).map(toMemory);
}

export function getMemory(userId: string, id: string): Memory | null {
  const r = db.prepare('SELECT * FROM memories WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined;
  return r ? toMemory(r) : null;
}

/** Kurz-IDs aus dem Prompt ("m3f2a91c") auf die echte ID abbilden */
export function findMemory(userId: string, idOrPrefix: string): Memory | null {
  const key = idOrPrefix.replace(/^m:/, '').trim();
  if (key.length < 4) return null;
  const r = db.prepare('SELECT * FROM memories WHERE user_id = ? AND id LIKE ? LIMIT 2').all(userId, `${key}%`) as Row[];
  return r.length === 1 ? toMemory(r[0]!) : null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** fast gleicher Text schon da? (verhindert, dass Stella dasselbe zehnmal lernt) */
function findSimilar(userId: string, text: string): Memory | null {
  const n = normalize(text);
  return listMemories(userId).find((m) => {
    const o = normalize(m.text);
    return o === n || (n.length > 12 && (o.includes(n) || n.includes(o)));
  }) ?? null;
}

export interface NewMemory {
  category: MemoryCategory;
  text: string;
  source: Memory['source'];
  schedule?: Memory['schedule'];
}

/** Merken – bei sehr ähnlichem Text wird der vorhandene Eintrag aktualisiert statt verdoppelt. */
export function addMemory(userId: string, m: NewMemory): { memory: Memory; created: boolean } {
  const text = m.text.trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!text) throw new Error('Leerer Text');
  const existing = findSimilar(userId, text);
  if (existing) {
    const updated = updateMemory(userId, existing.id, { text, category: m.category, schedule: m.schedule ?? existing.schedule })!;
    return { memory: updated, created: false };
  }
  // ältestes Gelerntes verwerfen, statt unbegrenzt zu wachsen
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM memories WHERE user_id = ?').get(userId) as { n: number };
  if (n >= MAX_PER_USER) {
    db.prepare(`DELETE FROM memories WHERE id = (SELECT id FROM memories WHERE user_id = ? AND source = 'learned' ORDER BY updated_at LIMIT 1)`).run(userId);
  }
  const id = newId();
  const t = now();
  db.prepare('INSERT INTO memories (id, user_id, category, text, source, schedule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, m.category, text, m.source, m.schedule ? JSON.stringify(m.schedule) : null, t, t);
  return { memory: getMemory(userId, id)!, created: true };
}

export function updateMemory(userId: string, id: string, patch: Partial<Pick<Memory, 'text' | 'category' | 'schedule'>>): Memory | null {
  const cur = getMemory(userId, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.prepare('UPDATE memories SET category = ?, text = ?, schedule = ?, updated_at = ? WHERE user_id = ? AND id = ?')
    .run(next.category, next.text.trim().slice(0, 300), next.schedule ? JSON.stringify(next.schedule) : null, now(), userId, id);
  return getMemory(userId, id);
}

export function deleteMemory(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM memories WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

/** Routinen mit Zeiten – für freie Zeitfenster und Hinweise */
export function routines(userId: string): (Memory & { schedule: NonNullable<Memory['schedule']> })[] {
  return listMemories(userId).filter((m): m is Memory & { schedule: NonNullable<Memory['schedule']> } => !!m.schedule);
}

const WD = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** für den KI-Prompt: kompakt, mit Kurz-IDs zum Ändern/Löschen */
export function memoryPrompt(userId: string): string {
  const list = listMemories(userId);
  if (!list.length) return '(noch nichts)';
  return list.slice(0, 80).map((m) => {
    const when = m.schedule ? ` [${m.schedule.days.map((d) => WD[d]).join('/')} ${m.schedule.start}–${m.schedule.end}]` : '';
    return `- (m:${m.id.slice(0, 8)}) ${MEMORY_CATEGORIES[m.category]}: ${m.text}${when}`;
  }).join('\n');
}
