// Kalender: GET /api/calendar?from=&to= liefert je Tag Blöcke (Termine, To-dos, Prüfungen, Lerneinheiten, Fristen, Ziel-Check-ins,
// Routinen und Unterricht als Hintergrundstreifen) plus freie Zeitfenster aus dem Lagebild. Die App muss nichts selbst rechnen;
// offline rechnet sie aus dem lokalen Speicher weiter (shared/src/calendar.ts).
// Anlegen und Verschieben laufen über die Aktionen (Rechte-Stufe, Karte, 7 Tage Rückgängig).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addDays, blocksForItems, dayLoad, diffDays, timeIn, todayIn, weekdayOf, type CalendarBlock, type CalendarDay, type Item, type Ymd } from '@stella/shared';
import { HttpError } from './auth.ts';
import { dayContext, isoWeekday, toHhmm, toMin } from './context.ts';
import { getItem, listItems, type User } from './db.ts';
import { pluginLessons } from './editions/registry.ts';
import { listGoals } from './goals.ts';
import { listMemories } from './memory.ts';
import { perform } from './actions.ts';

const MAX_DAYS = 62;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHORT_DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export interface CalendarResponse { today: Ymd; from: Ymd; to: Ymd; days: CalendarDay[] }

export function buildCalendar(user: User, from: Ymd, to: Ymd): CalendarResponse {
  if (!YMD.test(from) || !YMD.test(to) || to < from) throw new HttpError(400, 'from und to müssen Daten (JJJJ-MM-TT) sein, to nicht vor from.');
  if (diffDays(from, to) + 1 > MAX_DAYS) throw new HttpError(400, `Höchstens ${MAX_DAYS} Tage auf einmal.`);
  const today = todayIn(user.timeZone);
  const nowHhmm = timeIn(user.timeZone);
  const items = listItems(user.id, { from, to, includeDone: true }).filter((i) => i.due && i.due >= from && i.due <= to);
  const lessons = pluginLessons(user.id, from, to);
  const memories = listMemories(user.id);
  const goals = listGoals(user, false, today).filter((g) => g.status === 'active' && g.checkIn);

  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dayItems = items.filter((i) => i.due === date);
    const dayLessons = lessons.filter((l) => l.date === date);
    const blocks: CalendarBlock[] = blocksForItems(dayItems);

    for (const l of dayLessons) {
      blocks.push({
        id: `lesson:${date}:${l.start}`, kind: 'lesson', title: l.subject ?? l.code ?? '', date, start: l.start, end: l.end,
        status: l.status === 'cancelled' ? 'cancelled' : 'open', subject: l.subject, detail: l.info, soft: true,
      });
    }
    const wd = isoWeekday(date);
    for (const m of memories) {
      if (m.schedule?.days.includes(wd)) blocks.push({ id: `routine:${m.id}:${date}`, kind: 'routine', title: m.text, date, start: m.schedule.start, end: m.schedule.end, status: 'open', soft: true });
    }
    if (date >= today) {
      for (const g of goals) {
        const m = /^(?:(Mo|Di|Mi|Do|Fr|Sa|So)\s+)?(\d{2}:\d{2})$/.exec(g.checkIn!);
        if (!m || (m[1] && SHORT_DAYS[weekdayOf(date)] !== m[1])) continue;
        blocks.push({ id: `goal:${g.id}:${date}`, kind: 'goal', title: g.title, date, start: m[2]!, end: toHhmm(toMin(m[2]!) + (g.minutes ?? 15)), status: 'open' });
      }
    }
    blocks.sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || a.title.localeCompare(b.title));

    const ctx = date >= today ? dayContext(user, date, today, nowHhmm, dayLessons, dayItems, memories) : null;
    days.push({ date, blocks, free: ctx?.free ?? [], freeMinutes: ctx?.freeMinutes ?? 0, load: dayLoad(blocks) });
  }
  return { today, from, to, days };
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function registerCalendarRoutes(api: FastifyInstance) {
  api.get('/api/calendar', async (req) => {
    const q = req.query as Record<string, string>;
    const today = todayIn(req.user.timeZone);
    return buildCalendar(req.user, q.from || today, q.to || q.from || today);
  });

  /** Neuer Termin (z. B. Ziehen auf eine freie Stelle) – als Aktion mit Rückgängig */
  api.post('/api/calendar/items', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'title fehlt');
    if (!YMD.test(str(b.due))) throw new HttpError(400, 'due muss ein Datum sein');
    if (b.time !== undefined && b.time !== null && !HHMM.test(str(b.time))) throw new HttpError(400, 'time muss HH:MM sein');
    const duration = Number(b.duration);
    const res = perform(req.user, 'item.create', {
      kind: b.kind === 'todo' || b.kind === 'study' || b.kind === 'exam' || b.kind === 'assignment' ? b.kind : 'event',
      title, due: str(b.due), time: b.time ? str(b.time) : null, detail: b.detail ? str(b.detail, 500) : null,
      location: b.location ? str(b.location) : null, source: 'app',
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 24 * 60) : null,
    }, { source: 'chat', quiet: true });
    if (res.status === 'refused') throw new HttpError(403, res.reason);
    return { item: res.changed[0] ?? null, actionId: res.actionId ?? null };
  });

  /** Verschieben, dehnen, umbenennen – als Aktion mit Rückgängig (die App zeigt „Rückgängig“ mit der actionId) */
  api.patch('/api/calendar/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!getItem(req.user.id, req.params.id)) throw new HttpError(404, 'Nicht gefunden');
    const patch: Partial<Pick<Item, 'due' | 'time' | 'duration' | 'title' | 'location'>> = {};
    if (b.due !== undefined) { if (!YMD.test(str(b.due))) throw new HttpError(400, 'due muss ein Datum sein'); patch.due = str(b.due); }
    if (b.time !== undefined) { if (b.time !== null && !HHMM.test(str(b.time))) throw new HttpError(400, 'time muss HH:MM sein'); patch.time = b.time === null ? null : str(b.time); }
    if (b.duration !== undefined) { const d = Number(b.duration); if (!Number.isFinite(d) || d < 5 || d > 24 * 60) throw new HttpError(400, 'duration: 5 bis 1440 Minuten'); patch.duration = Math.round(d); }
    if (b.title !== undefined) { if (!str(b.title)) throw new HttpError(400, 'title darf nicht leer sein'); patch.title = str(b.title); }
    if (b.location !== undefined) patch.location = b.location ? str(b.location) : null;
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nichts zu ändern.');
    const res = perform(req.user, 'item.update', { id: req.params.id, patch }, { source: 'chat', quiet: true });
    if (res.status === 'refused') throw new HttpError(403, res.reason);
    return { item: res.changed[0] ?? getItem(req.user.id, req.params.id), actionId: res.actionId ?? null };
  });
}
