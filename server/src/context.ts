// Das Lagebild: alles, was für die nächsten Tage zählt, an einer Stelle – Stundenplan mit
// Entfall, Einträge, Tests samt Lernstand, wichtige Nachrichten, Gedächtnis und die freien
// Zeitfenster. Chat, Hinweise, Briefing und Wochenplanung lesen alle hieraus, damit sie sich
// nicht widersprechen. Kommt ohne KI aus.

import { addDays, formatDateDe, timeIn, todayIn, WEEKDAYS_DE, weekdayOf, type Item, type Memory, type Ymd } from '@stella/shared';
import { db, listItems, type User } from './db.ts';
import { listMemories, MEMORY_CATEGORIES } from './memory.ts';
import { lessonsFor } from './untis.ts';
import { isSchool } from './profile.ts';

export interface Interval { start: string; end: string }
export interface Busy extends Interval { label: string }

type Lesson = ReturnType<typeof lessonsFor>[number];

export interface DayContext {
  date: Ymd;
  lessons: Lesson[];
  /** Einträge mit Fälligkeit an diesem Tag (offen und erledigt) */
  items: Item[];
  busy: Busy[];
  free: Interval[];
  freeMinutes: number;
}

export interface ExamContext {
  exam: Item;
  daysLeft: number;
  hasMaterial: boolean;
  sessions: { total: number; done: number; missed: number };
}

export interface InboxHighlight { id: string; source: string; sender: string | null; summary: string; createdAt: string; needsReply: boolean; reason: string | null }

export interface Lagebild {
  today: Ymd;
  now: string;
  days: DayContext[];
  exams: ExamContext[];
  /** offene Einträge mit Datum in der Vergangenheit */
  overdue: Item[];
  importantInbox: InboxHighlight[];
  memories: Memory[];
}

/** Zeitraum, in dem Stella Dinge einplanen darf (später einstellbar) */
const DAY_WINDOW: Interval = { start: '07:00', end: '21:30' };
const WEEKEND_WINDOW: Interval = { start: '09:00', end: '21:30' };
/** Länge eines Termins ohne Endzeit */
const DEFAULT_MINUTES: Record<string, number> = { study: 45, event: 60, todo: 30, exam: 60, homework: 30, assignment: 60 };
const MIN_FREE = 20;

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 1 = Montag … 7 = Sonntag */
export const isoWeekday = (ymd: Ymd) => ((weekdayOf(ymd) + 6) % 7) + 1;

/** freie Lücken im Fenster nach Abzug der belegten Zeiten */
export function freeSlots(window: Interval, busy: Interval[], minMinutes = MIN_FREE): Interval[] {
  const sorted = busy.map((b) => [toMin(b.start), toMin(b.end)] as const).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let cursor = toMin(window.start);
  const end = toMin(window.end);
  for (const [s, e] of sorted) {
    if (e <= cursor) continue;
    if (s >= end) break;
    if (s - cursor >= minMinutes) out.push({ start: toHhmm(cursor), end: toHhmm(Math.min(s, end)) });
    cursor = Math.max(cursor, e);
  }
  if (end - cursor >= minMinutes) out.push({ start: toHhmm(cursor), end: toHhmm(end) });
  return out;
}

function dayContext(user: User, date: Ymd, today: Ymd, nowHhmm: string, lessons: Lesson[], items: Item[], memories: Memory[]): DayContext {
  const wd = isoWeekday(date);
  const weekend = wd >= 6;
  const busy: Busy[] = [];
  for (const l of lessons) if (l.status !== 'cancelled') busy.push({ start: l.start, end: l.end, label: l.subject ?? l.code ?? 'Unterricht' });
  for (const m of memories) {
    if (m.schedule?.days.includes(wd)) busy.push({ start: m.schedule.start, end: m.schedule.end, label: m.text });
  }
  for (const i of items) {
    if (!i.time || i.status !== 'open') continue;
    busy.push({ start: i.time, end: toHhmm(Math.min(toMin(i.time) + (DEFAULT_MINUTES[i.kind] ?? 30), 24 * 60 - 1)), label: i.title });
  }
  // Schule ohne WebUntis: Vormittag an Schultagen als belegt annehmen
  if (!weekend && !lessons.length && isSchool(user) && hasNoTimetable(user.id)) busy.push({ start: '07:30', end: '13:30', label: 'Schule (geschätzt)' });

  const window = { ...(weekend ? WEEKEND_WINDOW : DAY_WINDOW) };
  if (date === today && toMin(nowHhmm) > toMin(window.start)) window.start = nowHhmm;
  const free = toMin(window.start) < toMin(window.end) ? freeSlots(window, busy) : [];
  return {
    date, lessons, items, busy: busy.sort((a, b) => a.start.localeCompare(b.start)), free,
    freeMinutes: free.reduce((s, f) => s + toMin(f.end) - toMin(f.start), 0),
  };
}

const hasNoTimetable = (userId: string) => !(db.prepare('SELECT 1 FROM lessons WHERE user_id = ? LIMIT 1').get(userId));

export function buildLagebild(user: User, days = 7): Lagebild {
  const today = todayIn(user.timeZone);
  const now = timeIn(user.timeZone);
  const to = addDays(today, days - 1);
  const memories = listMemories(user.id);
  const allLessons = lessonsFor(user.id, today, to);
  const items = listItems(user.id, { from: addDays(today, -14), includeDone: true });

  const dayList: DayContext[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    dayList.push(dayContext(user, date, today, now, allLessons.filter((l) => l.date === date), items.filter((i) => i.due === date), memories));
  }

  const exams: ExamContext[] = items
    .filter((i) => i.kind === 'exam' && i.status === 'open' && i.due && i.due >= today)
    .map((exam) => {
      const sessions = items.filter((i) => i.kind === 'study' && i.parentId === exam.id);
      return {
        exam,
        daysLeft: Math.round((Date.parse(exam.due!) - Date.parse(today)) / 86_400_000),
        hasMaterial: !!exam.material?.trim(),
        sessions: {
          total: sessions.length,
          done: sessions.filter((s) => s.status === 'done').length,
          missed: sessions.filter((s) => s.status === 'open' && s.due! < today).length,
        },
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const overdue = items.filter((i) => i.status === 'open' && i.due && i.due < today && i.kind !== 'study');

  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const importantInbox = (db.prepare(`SELECT id, source, sender, text, payload, created_at FROM inbox_events WHERE user_id = ? AND created_at > ?
    AND (json_extract(payload, '$.category') = 'important' OR source = 'sms') AND COALESCE(json_extract(payload, '$.handled'), 0) = 0
    ORDER BY created_at DESC LIMIT 8`).all(user.id, since) as { id: string; source: string; sender: string | null; text: string | null; payload: string; created_at: string }[])
    .map((r) => {
      const p = JSON.parse(r.payload) as { summary?: string; needsReply?: boolean; reason?: string };
      return { id: r.id, source: r.source, sender: r.sender, summary: p.summary || r.text || '', createdAt: r.created_at, needsReply: !!p.needsReply, reason: p.reason ?? null };
    });

  return { today, now, days: dayList, exams, overdue, importantInbox, memories };
}

const ICON: Record<string, string> = { homework: 'HÜ', exam: 'TEST', assignment: 'ABGABE', event: 'TERMIN', todo: 'TODO', study: 'LERNEN' };

/** kompakt für den KI-Prompt – IDs in eckigen Klammern, damit die KI Einträge ändern kann */
export function lagebildPrompt(lb: Lagebild): string {
  const lines: string[] = [];
  for (const d of lb.days) {
    const head = `${WEEKDAYS_DE[weekdayOf(d.date)]} ${formatDateDe(d.date, lb.today)} (${d.date})`;
    const school = d.lessons.length
      ? `Schule ${d.lessons[0]!.start}–${d.lessons.at(-1)!.end}${d.lessons.some((l) => l.status === 'cancelled') ? `, entfällt: ${d.lessons.filter((l) => l.status === 'cancelled').map((l) => `${l.subject ?? l.code} ${l.start}`).join(', ')}` : ''}`
      : 'keine Stunden bekannt';
    const items = d.items.filter((i) => i.status !== 'cancelled')
      .map((i) => `[${i.id}] ${ICON[i.kind] ?? i.kind} ${i.title}${i.detail ? ` (${i.detail})` : ''}${i.time ? ` ${i.time}` : ''}${i.status === 'done' ? ' ✓' : ''}`);
    const free = d.free.map((f) => `${f.start}–${f.end}`).join(', ') || 'keine';
    lines.push(`${head}: ${school}. Frei: ${free}.${items.length ? `\n  ${items.join('\n  ')}` : ''}`);
  }
  const exams = lb.exams.map((e) => `- [${e.exam.id}] ${e.exam.title} in ${e.daysLeft} Tagen – Stoff: ${e.hasMaterial ? e.exam.material : 'UNBEKANNT'}; ` +
    `Lerneinheiten ${e.sessions.done}/${e.sessions.total} erledigt${e.sessions.missed ? `, ${e.sessions.missed} verpasst` : ''}`);
  const overdue = lb.overdue.map((i) => `- [${i.id}] ${i.title} (war fällig ${i.due})`);
  const inbox = lb.importantInbox.map((m) => `- [${m.id}] ${m.source} von ${m.sender ?? '?'}: ${m.summary}${m.needsReply ? ' (wartet auf Antwort)' : ''}`);
  const mem = lb.memories.slice(0, 80).map((m) => `- (m:${m.id.slice(0, 8)}) ${MEMORY_CATEGORIES[m.category]}: ${m.text}` +
    (m.schedule ? ` [${m.schedule.days.map((x) => ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][x]).join('/')} ${m.schedule.start}–${m.schedule.end}]` : ''));

  return [
    `NÄCHSTE TAGE:\n${lines.join('\n')}`,
    `TESTS:\n${exams.join('\n') || '(keine)'}`,
    `ÜBERFÄLLIG:\n${overdue.join('\n') || '(nichts)'}`,
    `WICHTIGE NACHRICHTEN (3 Tage):\n${inbox.join('\n') || '(keine)'}`,
    `WAS DU ÜBER DEN NUTZER WEISST:\n${mem.join('\n') || '(noch nichts)'}`,
  ].join('\n\n');
}
