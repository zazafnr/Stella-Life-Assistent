// Bildschirmzeit-Ziele (iOS). Apple erlaubt keinen Zugriff auf die Nutzungsdaten: das Gerät meldet nur, welche vorher festgelegte Schwelle
// heute erreicht wurde. Hierher kommen deshalb nur Ziel-Id, Schwelle (Minuten) und Zeitpunkt – keine App-Namen, keine Auswahl.
// Nutzen: Wochenrückblick im Sonntags-Briefing, Hinweise und (bei Verbindung) Telegram. Keine Punkte, Serien oder Abzeichen.

import type { FastifyInstance } from 'fastify';
import { addDays, thresholdPercent, todayIn } from '@stella/shared';
import { isoWeekday } from './context.ts';
import { HttpError } from './auth.ts';
import { planAllows } from './billing.ts';
import { db, newId, now, type User } from './db.ts';
import { tr } from './locale.ts';
import { telegramChannel } from './channels/telegram.ts';

export interface ScreenGoal { id: string; name: string; limitMinutes: number; shield: boolean; createdAt: string }

interface GoalRow { id: string; name: string; limit_minutes: number; shield: number; created_at: string }
const toGoal = (r: GoalRow): ScreenGoal => ({ id: r.id, name: r.name, limitMinutes: r.limit_minutes, shield: !!r.shield, createdAt: r.created_at });

export const screenTimeAllowed = (user: User) => planAllows(user, 'screenTime');

export const listScreenGoals = (userId: string): ScreenGoal[] =>
  (db.prepare('SELECT * FROM screentime_goals WHERE user_id = ? AND deleted = 0 ORDER BY created_at').all(userId) as GoalRow[]).map(toGoal);

const cleanName = (v: unknown) => String(v ?? '').trim().slice(0, 40);
const cleanLimit = (v: unknown) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 5 || n > 16 * 60) throw new HttpError(400, 'Das Limit muss zwischen 5 Minuten und 16 Stunden liegen.');
  return n;
};
const MAX_GOALS = 10;

export function createScreenGoal(user: User, input: { name: unknown; limitMinutes: unknown; shield?: unknown; id?: unknown }): ScreenGoal {
  const name = cleanName(input.name);
  if (!name) throw new HttpError(400, 'Das Ziel braucht einen Namen.');
  if (listScreenGoals(user.id).length >= MAX_GOALS) throw new HttpError(400, `Höchstens ${MAX_GOALS} Bildschirmzeit-Ziele.`);
  // Die App darf die Id selbst vergeben (die Auswahl liegt unter dieser Id in der App Group)
  const id = typeof input.id === 'string' && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : newId();
  if (db.prepare('SELECT 1 FROM screentime_goals WHERE id = ?').get(id)) throw new HttpError(409, 'Diese Id gibt es schon.');
  const t = now();
  db.prepare('INSERT INTO screentime_goals (id, user_id, name, limit_minutes, shield, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, name, cleanLimit(input.limitMinutes), input.shield ? 1 : 0, t, t);
  return listScreenGoals(user.id).find((g) => g.id === id)!;
}

export function updateScreenGoal(user: User, id: string, patch: { name?: unknown; limitMinutes?: unknown; shield?: unknown }): ScreenGoal {
  const cur = listScreenGoals(user.id).find((g) => g.id === id);
  if (!cur) throw new HttpError(404, 'Ziel nicht gefunden.');
  db.prepare('UPDATE screentime_goals SET name = ?, limit_minutes = ?, shield = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(patch.name !== undefined ? cleanName(patch.name) || cur.name : cur.name, patch.limitMinutes !== undefined ? cleanLimit(patch.limitMinutes) : cur.limitMinutes,
      patch.shield !== undefined ? (patch.shield ? 1 : 0) : Number(cur.shield), now(), id, user.id);
  return listScreenGoals(user.id).find((g) => g.id === id)!;
}

export const deleteScreenGoal = (userId: string, id: string) =>
  db.prepare('UPDATE screentime_goals SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(now(), id, userId).changes > 0;

// ---------- Ereignisse ----------

export interface ScreenEventInput { goalId: string; minutes: number; at: string }

/** Ereignisse der App speichern; unbekannte Ziele und Doppelte (gleiches Ziel, Tag, Schwelle) werden übergangen */
export async function storeScreenEvents(user: User, events: ScreenEventInput[]): Promise<{ stored: number; limitReached: string[] }> {
  const goals = new Map(listScreenGoals(user.id).map((g) => [g.id, g]));
  const insert = db.prepare('INSERT OR IGNORE INTO screentime_events (id, user_id, goal_id, day, minutes, percent, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let stored = 0;
  const limitReached: string[] = [];
  for (const e of events.slice(0, 200)) {
    const goal = goals.get(String(e.goalId));
    const at = new Date(String(e.at));
    const minutes = Math.round(Number(e.minutes));
    if (!goal || Number.isNaN(at.getTime()) || !Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) continue;
    if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - 14 * 86_400_000) continue; // Zukunft und alte Reste
    const percent = thresholdPercent(minutes, goal.limitMinutes);
    const r = insert.run(newId(), user.id, goal.id, todayIn(user.timeZone, at), minutes, percent, at.toISOString());
    if (r.changes) {
      stored++;
      // Telegram: nur wenn das Limit heute zum ersten Mal erreicht wurde und das Ereignis frisch ist (kein Nachrichtenregen nach einer Synchronisierung)
      if (minutes === goal.limitMinutes && Date.now() - at.getTime() < 3 * 3600_000) limitReached.push(goal.id);
    }
  }
  for (const id of limitReached) await telegramLimit(user, goals.get(id)!);
  return { stored, limitReached };
}

/** „TikTok-Limit erreicht.“ – nur in Telegram, wenn verbunden und gewählt. Auf dem Gerät hat die App schon selbst benachrichtigt. */
async function telegramLimit(user: User, goal: ScreenGoal) {
  if (!user.settings.notifyVia?.includes('telegram') || !telegramChannel.configured()) return;
  await telegramChannel.send(user.id, { text: tr(user, 'screentime.telegram.limit', { name: goal.name }) }).catch(() => false);
}

// ---------- Überblick, Wochenrückblick, Hinweis ----------

export interface DayStat { date: string; maxMinutes: number; percent: number; reachedLimit: boolean }

/** Je Ziel und Tag: höchste gemeldete Schwelle. Tage ohne Ereignis gelten als „im Limit“ (die App meldet nur Überschreitungen von Schwellen). */
export function screenOverview(user: User, days = 14, today = todayIn(user.timeZone)): { goal: ScreenGoal; days: DayStat[] }[] {
  const from = addDays(today, -(days - 1));
  return listScreenGoals(user.id).map((goal) => {
    const rows = db.prepare('SELECT day, MAX(minutes) AS m FROM screentime_events WHERE goal_id = ? AND day >= ? GROUP BY day').all(goal.id, from) as { day: string; m: number }[];
    const byDay = new Map(rows.map((r) => [r.day, r.m]));
    const created = goal.createdAt.slice(0, 10);
    const list: DayStat[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      if (date < created) continue;
      const max = byDay.get(date) ?? 0;
      list.push({ date, maxMinutes: max, percent: thresholdPercent(max, goal.limitMinutes), reachedLimit: max >= goal.limitMinutes });
    }
    return { goal, days: list };
  });
}

/** Sonntags im Briefing: „TikTok: 3 von 7 Tagen im Limit“ (ohne Punkte, Serien oder Abzeichen) */
export function screentimeWeekLines(user: User, today: string): string[] {
  if (isoWeekday(today) !== 7 || !screenTimeAllowed(user)) return [];
  return screenOverview(user, 7, today).filter((o) => o.days.length >= 2).map((o) => {
    const inLimit = o.days.filter((d) => !d.reachedLimit).length;
    return tr(user, 'screentime.week', { name: o.goal.name, n: inLimit, total: o.days.length });
  });
}

/** Hinweis (in der App): das Limit war an mindestens 3 der letzten 4 Tage erreicht */
export function screentimeHints(user: User, today: string): { key: string; goal: ScreenGoal; count: number }[] {
  if (!screenTimeAllowed(user)) return [];
  const week = addDays(today, -(isoWeekday(today) - 1));
  return screenOverview(user, 4, today).flatMap((o) => {
    const count = o.days.filter((d) => d.reachedLimit).length;
    return o.days.length >= 4 && count >= 3 ? [{ key: `screentime_over:${o.goal.id}:${week}`, goal: o.goal, count }] : [];
  });
}

// ---------- Routen ----------

export function registerScreenTimeRoutes(api: FastifyInstance) {
  const need = (user: User) => { if (!screenTimeAllowed(user)) throw new HttpError(402, tr(user, 'screentime.upgrade')); };

  api.get('/api/screentime/goals', async (req) => ({ allowed: screenTimeAllowed(req.user), goals: screenTimeAllowedGoals(req.user) }));
  api.post('/api/screentime/goals', async (req) => { need(req.user); return createScreenGoal(req.user, (req.body ?? {}) as Record<string, unknown> as never); });
  api.put<{ Params: { id: string } }>('/api/screentime/goals/:id', async (req) => { need(req.user); return updateScreenGoal(req.user, req.params.id, (req.body ?? {}) as Record<string, unknown>); });
  api.delete<{ Params: { id: string } }>('/api/screentime/goals/:id', async (req) => ({ ok: deleteScreenGoal(req.user.id, req.params.id) }));
  api.post('/api/screentime/events', async (req) => {
    need(req.user);
    const events = (req.body as { events?: unknown } | null)?.events;
    if (!Array.isArray(events)) throw new HttpError(400, 'events fehlt.');
    const r = await storeScreenEvents(req.user, events as ScreenEventInput[]);
    return { stored: r.stored };
  });
  api.get('/api/screentime/overview', async (req) => {
    const days = Math.max(1, Math.min(60, Number((req.query as Record<string, string>).days) || 14));
    return { allowed: screenTimeAllowed(req.user), overview: screenTimeAllowed(req.user) ? screenOverview(req.user, days) : [] };
  });
}

const screenTimeAllowedGoals = (user: User) => (screenTimeAllowed(user) ? listScreenGoals(user.id) : []);
