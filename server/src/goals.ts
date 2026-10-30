// Ziele: setzen, Fortschritt notieren, Stella erinnert und hilft beim Planen – ohne Punkte, Serien oder Abzeichen.
//
//   „ich will 3x pro Woche laufen gehen“   → Groq liest die Struktur heraus, Stella legt das Ziel an (mit Rückgängig)
//   „war heute 5 km laufen“                → Fortschritt, dem passenden Ziel zugeordnet
// Der Stand ist immer: diese Woche (Montag bis Sonntag) gegen das Wochenziel, dazu die letzten 8 Wochen als Verlauf.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addDays, timeIn, todayIn, weekdayOf, type Goal, type GoalLog, type GoalProgress } from '@stella/shared';
import { HttpError } from './auth.ts';
import { isoWeekday } from './context.ts';
import { addMessage, db, getUser, newId, notifyOnce, now, type User } from './db.ts';
import { complete, groqAvailable, llmAvailable } from './llm.ts';
import { hasFeature } from './profile.ts';
import { pushToUser } from './push.ts';

type Row = { id: string; title: string; why: string | null; metric: string; unit: string; target: number; cadence: string; minutes: number | null; check_in: string | null; status: string; created_at: string };
const toGoal = (r: Row): Goal => ({
  id: r.id, title: r.title, why: r.why, metric: r.metric, unit: r.unit, target: r.target, cadence: r.cadence, minutes: r.minutes,
  checkIn: r.check_in, status: r.status === 'paused' ? 'paused' : r.status === 'done' ? 'done' : 'active', createdAt: r.created_at,
});

export interface NewGoal { title: string; why?: string | null; metric?: string; unit?: string; target?: number; cadence?: string; minutes?: number | null; checkIn?: string | null }

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// ---------- prüfen ----------

export function cleanCadence(c: unknown): string {
  const s = String(c ?? '').trim().toLowerCase();
  const m = /^weekly:(\d{1,2})$/.exec(s);
  if (s === 'daily') return 'daily';
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 14) return s;
  return s === 'custom' ? 'custom' : 'weekly:1';
}

function cleanCheckIn(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const m = /^(?:(Mo|Di|Mi|Do|Fr|Sa|So)\s+)?([01]\d|2[0-3]):([0-5]\d)$/i.exec(s);
  return m ? `${m[1] ? m[1][0]!.toUpperCase() + m[1][1]!.toLowerCase() + ' ' : ''}${m[2]}:${m[3]}` : null;
}

/** Eingaben (Formular oder KI) auf gültige Werte bringen */
export function cleanGoal(raw: Record<string, unknown>): NewGoal {
  const title = String(raw.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (title.length < 2) throw new HttpError(400, 'Wie soll das Ziel heißen?');
  const cadence = cleanCadence(raw.cadence);
  const n = Number(/^weekly:(\d+)$/.exec(cadence)?.[1] ?? 1);
  let target = Number(String(raw.target ?? '').replace(',', '.'));
  if (!Number.isFinite(target) || target <= 0) target = cadence.startsWith('weekly:') ? n : 1;
  const minutes = Math.round(Number(raw.minutes));
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    why: raw.why ? String(raw.why).trim().slice(0, 200) || null : null,
    metric: String(raw.metric ?? '').trim().slice(0, 30) || 'Einheiten',
    unit: String(raw.unit ?? '').trim().slice(0, 12) || 'x',
    target: Math.min(target, 100_000), cadence,
    minutes: Number.isFinite(minutes) && minutes >= 5 && minutes <= 480 ? minutes : null,
    checkIn: cleanCheckIn(raw.checkIn),
  };
}

export function describeCadence(g: { cadence?: string; target?: number; unit?: string }): string {
  if (g.cadence === 'daily') return 'täglich';
  const n = /^weekly:(\d+)$/.exec(g.cadence ?? '')?.[1];
  if (n) return `${n}× pro Woche`;
  return `${g.target ?? 1} ${g.unit ?? 'x'} pro Woche`;
}

// ---------- speichern ----------

export function createGoal(userId: string, n: NewGoal): Goal {
  const id = newId();
  const t = now();
  db.prepare(`INSERT INTO goals (id, user_id, title, why, metric, unit, target, cadence, minutes, check_in, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, userId, n.title, n.why ?? null, n.metric ?? 'Einheiten', n.unit ?? 'x', n.target ?? 1, n.cadence ?? 'weekly:1', n.minutes ?? null, n.checkIn ?? null, t, t);
  return getGoal(userId, id)!;
}

export function getGoal(userId: string, id: string): Goal | null {
  const r = db.prepare('SELECT * FROM goals WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined;
  return r ? toGoal(r) : null;
}

export function activeGoals(userId: string): Goal[] {
  return (db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at").all(userId) as Row[]).map(toGoal);
}

export function updateGoal(userId: string, id: string, patch: Partial<NewGoal> & { status?: Goal['status'] }): Goal | null {
  const cur = getGoal(userId, id);
  if (!cur) return null;
  const merged = cleanGoal({ ...cur, ...patch });
  const status = patch.status && ['active', 'paused', 'done'].includes(patch.status) ? patch.status : cur.status;
  db.prepare('UPDATE goals SET title = ?, why = ?, metric = ?, unit = ?, target = ?, cadence = ?, minutes = ?, check_in = ?, status = ?, updated_at = ? WHERE user_id = ? AND id = ?')
    .run(merged.title, merged.why ?? null, merged.metric, merged.unit, merged.target, merged.cadence, merged.minutes ?? null, merged.checkIn ?? null, status, now(), userId, id);
  return getGoal(userId, id);
}

export function deleteGoal(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM goals WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export function logGoal(userId: string, goalId: string, value: number, date: string, note: string | null = null): GoalLog {
  if (!getGoal(userId, goalId)) throw new HttpError(404, 'Ziel nicht gefunden');
  const id = newId();
  db.prepare('INSERT INTO goal_logs (id, goal_id, date, value, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, goalId, date, value, note?.trim().slice(0, 300) || null, now());
  return { id, date, value, note: note?.trim() || null };
}

export function deleteLog(userId: string, logId: string): boolean {
  return db.prepare('DELETE FROM goal_logs WHERE id = ? AND goal_id IN (SELECT id FROM goals WHERE user_id = ?)').run(logId, userId).changes > 0;
}

// ---------- Fortschritt ----------

/** Montag der Woche, in der `date` liegt */
export const weekStart = (date: string) => addDays(date, -(isoWeekday(date) - 1));

export function weekTarget(g: Pick<Goal, 'cadence' | 'target'>): number {
  return g.cadence === 'daily' ? g.target * 7 : g.target;
}

const sum = (goalId: string, from: string, to: string) =>
  (db.prepare('SELECT COALESCE(SUM(value), 0) AS v FROM goal_logs WHERE goal_id = ? AND date >= ? AND date <= ?').get(goalId, from, to) as { v: number }).v;

export function countLogs(goalId: string, from: string, to: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM goal_logs WHERE goal_id = ? AND date >= ? AND date <= ?').get(goalId, from, to) as { n: number }).n;
}

export function progress(user: User, g: Goal, today = todayIn(user.timeZone)): GoalProgress {
  const monday = weekStart(today);
  const history = Array.from({ length: 8 }, (_, i) => { const from = addDays(monday, -7 * (7 - i)); return sum(g.id, from, addDays(from, 6)); });
  const recent = (db.prepare('SELECT id, date, value, note FROM goal_logs WHERE goal_id = ? ORDER BY date DESC, created_at DESC LIMIT 10').all(g.id) as GoalLog[]);
  return { ...g, weekValue: history[7]!, weekTarget: weekTarget(g), history, recent };
}

export function listGoals(user: User, includeDone = true, today = todayIn(user.timeZone)): GoalProgress[] {
  const rows = db.prepare(`SELECT * FROM goals WHERE user_id = ? ${includeDone ? '' : "AND status != 'done'"} ORDER BY status = 'active' DESC, created_at`).all(user.id) as Row[];
  return rows.map((r) => progress(user, toGoal(r), today));
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
export const amountText = (g: Pick<Goal, 'unit' | 'cadence'>, v: number) => g.unit === 'x' ? `${fmt(v)}×` : `${fmt(v)} ${g.unit}`;

// ---------- Chat: erkennen, zuordnen ----------

const stem = (w: string) => w.toLowerCase().replace(/^ge/, '').replace(/(en|e|t|st|n)$/u, '').slice(0, 6);
const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map(stem).filter((w) => w.length >= 3);
const STOP = new Set(['heut', 'gest', 'ster', 'habe', 'war', 'dem', 'der', 'die', 'das', 'und', 'mit', 'mal', 'pro', 'woch', 'viel', 'gehe', 'geh']);

/** Welches aktive Ziel ist gemeint? Nur, wenn es eindeutig ist (sonst fragt Stella bzw. die KI). */
export function matchGoal(goals: Goal[], text: string): Goal | null {
  const said = new Set(tokens(text).filter((w) => !STOP.has(w)));
  const scored = goals.map((g) => ({ g, hits: tokens(g.title).filter((w) => !STOP.has(w) && said.has(w)).length })).filter((x) => x.hits > 0);
  scored.sort((a, b) => b.hits - a.hits);
  return scored.length === 1 || (scored.length > 1 && scored[0]!.hits > scored[1]!.hits) ? scored[0]!.g : null;
}

const LOG_LEAD = /^\s*(?:ich\s+)?(?:war|bin|hab|habe|hatte|machte|hab(?:e)?\s+(?:heute|gestern))\b|^\s*(?:heute|gestern|vorhin)\b/iu;
const QTY_RE = /(\d+(?:[.,]\d+)?)\s*(km|kilometer|seiten|minuten|min|stunden|std|h|liter|l|mal|x|einheiten?|kapitel|kg)\b/iu;

/** „war heute 5 km laufen“ → { value: 5, unit: 'km', date } – ohne KI */
export function parseLogQuick(text: string, today: string): { value: number; unit: string | null; date: string } | null {
  if (text.split(/\s+/).length > 14 || !LOG_LEAD.test(text)) return null;
  const date = /\bgestern\b/iu.test(text) ? addDays(today, -1) : today;
  const m = QTY_RE.exec(text);
  if (!m) return { value: 1, unit: null, date };
  const unit = m[2]!.toLowerCase();
  const canon = unit === 'kilometer' ? 'km' : unit === 'min' ? 'minuten' : unit === 'std' || unit === 'h' ? 'stunden' : unit === 'l' ? 'liter' : unit === 'mal' || unit === 'x' || unit.startsWith('einheit') ? 'x' : unit;
  return { value: Number(m[1]!.replace(',', '.')), unit: canon, date };
}

export const GOAL_RE = /^\s*(?:ich\s+(?:will|möchte|moechte|werde|nehme\s+mir\s+vor)|mein\s+ziel(?:\s+ist)?|ziel\s*[:,])\s+(.+)$/iu;
const FREQ_RE = /\b(\d+)\s*(?:x|mal)\s*(?:pro|die|in\s+der|jede)\s*woche\b|\b(?:jeden\s+tag|täglich|taeglich)\b|\b(?:jede|pro)\s+woche\b|\b(\d+(?:[.,]\d+)?)\s*(km|kilometer|seiten|minuten|min|stunden|std|liter|kapitel|kg)\s*(?:pro|in\s+der|jede)\s*woche\b/iu;

/** Klingt der Satz nach einem Ziel mit Rhythmus oder Menge? („ich will besser in Mathe werden“ lieber der KI überlassen) */
export const looksLikeGoal = (text: string) => GOAL_RE.test(text) && FREQ_RE.test(text);

/** Ziel ohne KI aus dem Satz lesen – für die Fälle, in denen Groq nicht erreichbar ist */
export function parseGoalQuick(text: string): NewGoal | null {
  const m = GOAL_RE.exec(text);
  if (!m || !FREQ_RE.test(text)) return null;
  const f = FREQ_RE.exec(text)!;
  const title = m[1]!.replace(FREQ_RE, ' ').replace(/\b(pro|in der|jede)\s*woche\b/giu, ' ').replace(/\s+/g, ' ').replace(/[.!]+$/u, '').trim();
  if (title.length < 2) return null;
  if (f[1]) return { title, metric: 'Einheiten', unit: 'x', target: Number(f[1]), cadence: `weekly:${f[1]}` };
  if (f[2]) return { title, metric: f[3]!.toLowerCase(), unit: f[3]!.toLowerCase(), target: Number(f[2].replace(',', '.')), cadence: 'custom' };
  if (/tag|täglich|taeglich/iu.test(f[0]!)) return { title, metric: 'Einheiten', unit: 'x', target: 1, cadence: 'daily' };
  return { title, metric: 'Einheiten', unit: 'x', target: 1, cadence: 'weekly:1' };
}

const parseJson = (s: string | null) => { const t = s ?? ''; return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as Record<string, unknown>; };

/** Ziel-Struktur mit Groq herauslesen (Rückfall: ohne KI per Muster) */
export async function extractGoal(user: User, text: string): Promise<NewGoal | null> {
  if (groqAvailable() || llmAvailable()) {
    try {
      const { message } = await complete([
        { role: 'system', content: 'Du liest aus einem Satz ein persönliches Ziel heraus. Antworte nur mit JSON.' },
        { role: 'user', content: `Satz: „${text}“

Format: {"title": "kurz, Großbuchstabe, ohne „ich will“, z. B. „Laufen gehen“", "why": "Grund oder null", "metric": "was gezählt wird, z. B. „Einheiten“ oder „km“", "unit": "x, km, Seiten, Minuten …", "target": Zahl pro Woche (bei daily: pro Tag), "cadence": "daily" | "weekly:N" (N-mal pro Woche) | "custom" (eine Menge pro Woche), "minutes": Minuten pro Einheit oder null, "checkIn": "HH:MM" oder "So 18:00" oder null}
Gibt der Satz kein Ziel her, antworte {"title": ""}.` },
      ], undefined, { json: true, provider: 'groq', task: 'extract', userId: user.id, timeoutMs: 30_000 });
      const raw = parseJson(message.content);
      if (String(raw.title ?? '').trim()) return cleanGoal(raw);
    } catch {
      // Groq weg oder Antwort unbrauchbar → das Muster unten
    }
  }
  const quick = parseGoalQuick(text);
  return quick ? cleanGoal({ ...quick }) : null;
}

/** Fortschritt mit Groq dem richtigen Ziel zuordnen, wenn der Schnellweg nicht eindeutig war */
export async function extractLog(user: User, text: string, goals: Goal[], today: string): Promise<{ goal: Goal; value: number; date: string; note: string | null } | null> {
  if (!goals.length || !(groqAvailable() || llmAvailable())) return null;
  try {
    const { message } = await complete([
      { role: 'system', content: 'Du ordnest eine Fortschrittsmeldung einem Ziel zu. Antworte nur mit JSON.' },
      { role: 'user', content: `Heute ist ${today}. Ziele:\n${goals.map((g) => `- ${g.id}: ${g.title} (${describeCadence(g)}, gezählt in ${g.unit})`).join('\n')}\n\nMeldung: „${text}“\nFormat: {"goalId": "…" oder null, "value": Zahl (Standard 1), "date": "YYYY-MM-DD", "note": "kurz oder null"}\nPasst die Meldung zu keinem Ziel, ist goalId null.` },
    ], undefined, { json: true, provider: 'groq', task: 'extract', userId: user.id, timeoutMs: 30_000 });
    const raw = parseJson(message.content);
    const goal = goals.find((g) => g.id === raw.goalId);
    const value = Number(raw.value);
    if (!goal || !Number.isFinite(value) || value <= 0 || value > 100_000) return null;
    const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && raw.date <= today && raw.date >= addDays(today, -14) ? raw.date : today;
    return { goal, value, date, note: raw.note ? String(raw.note).slice(0, 200) : null };
  } catch {
    return null;
  }
}

// ---------- Erinnerungen, Rückblick, Hinweise ----------

/** „So 18:00“ oder „18:00“ – ist es Zeit, und wurde heute noch nicht erinnert? */
export function checkInDue(goal: Goal, today: string, nowHhmm: string): boolean {
  const m = goal.checkIn && /^(?:(Mo|Di|Mi|Do|Fr|Sa|So)\s+)?(\d{2}:\d{2})$/.exec(goal.checkIn);
  if (!m) return false;
  if (m[1] && WEEKDAYS[weekdayOf(today)] !== m[1]) return false;
  return nowHhmm >= m[2]!;
}

export function checkInText(user: User, g: GoalProgress): string {
  const left = Math.max(0, g.weekTarget - g.weekValue);
  const stand = `${amountText(g, g.weekValue)} von ${amountText(g, g.weekTarget)}`;
  const tone = user.settings.tone ?? 'nett';
  if (left === 0) return tone === 'cool' ? `🎯 ${g.title}: Wochenziel erreicht (${stand}). Stark.` : tone === 'frech' ? `🎯 ${g.title}: ${stand} – Wochenziel geschafft. Doch, du kannst das. 😏` : `🎯 ${g.title}: Wochenziel erreicht (${stand}) – schön gemacht! 💫`;
  return tone === 'cool' ? `🎯 ${g.title}: ${stand}. Noch ${amountText(g, left)}. Wie läuft's?`
    : tone === 'frech' ? `🎯 ${g.title}: erst ${stand}. Noch ${amountText(g, left)} – oder war das nur eine Idee? 😏`
      : `🎯 Wie läuft **${g.title}**? Diese Woche: ${stand}. Noch ${amountText(g, left)} bis zum Ziel.`;
}

/** Läuft im Scheduler: zur gewählten Zeit einmal am Tag erinnern */
export async function sendGoalCheckIns(userId: string) {
  const user = getUser(userId);
  if (!user || !hasFeature(user, 'goals')) return;
  const today = todayIn(user.timeZone);
  const nowHhmm = timeIn(user.timeZone);
  for (const g of activeGoals(userId)) {
    if (!checkInDue(g, today, nowHhmm) || !notifyOnce(userId, `goal-checkin:${g.id}:${today}`)) continue;
    const text = checkInText(user, progress(user, g, today));
    addMessage(userId, 'assistant', text);
    await pushToUser(userId, { title: 'Stella', body: text.replace(/\*\*/g, ''), tag: `goal-${g.id}` });
  }
}

/** Zeilen für das Briefing: sonntags der Wochenrückblick, sonst nichts */
export function goalBriefingLines(user: User, today: string): string[] {
  if (isoWeekday(today) !== 7 || !hasFeature(user, 'goals')) return [];
  return listGoals(user, false, today).filter((g) => g.status === 'active')
    .map((g) => `${g.title}: ${amountText(g, g.weekValue)} von ${amountText(g, g.weekTarget)}${g.weekValue >= g.weekTarget ? ' ✓' : ''}`);
}

/** Aktive Ziele ohne Eintrag seit mindestens 14 Tagen (und mindestens so lange angelegt), mit der Zahl der Wochen */
export function staleGoals(user: User, today: string): { goal: Goal; weeks: number }[] {
  const cutoff = addDays(today, -14);
  const out: { goal: Goal; weeks: number }[] = [];
  for (const g of activeGoals(user.id)) {
    const created = g.createdAt.slice(0, 10);
    if (created > cutoff) continue;
    const last = (db.prepare('SELECT MAX(date) AS d FROM goal_logs WHERE goal_id = ?').get(g.id) as { d: string | null }).d ?? created;
    if (last > cutoff) continue;
    out.push({ goal: g, weeks: Math.floor((Date.parse(today) - Date.parse(last)) / (7 * 86_400_000)) });
  }
  return out;
}

// ---------- Routen (Ziele-Ansicht) ----------

export function registerGoalRoutes(api: FastifyInstance) {
  api.get('/api/goals', async (req) => ({ goals: listGoals(req.user) }));

  api.post('/api/goals', async (req) => {
    const goal = createGoal(req.user.id, cleanGoal((req.body ?? {}) as Record<string, unknown>));
    return { goal: progress(req.user, goal) };
  });

  api.patch('/api/goals/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const goal = updateGoal(req.user.id, req.params.id, { ...b, status: b.status as Goal['status'] | undefined } as Partial<NewGoal>);
    if (!goal) throw new HttpError(404, 'Ziel nicht gefunden');
    return { goal: progress(req.user, goal) };
  });

  api.delete('/api/goals/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!deleteGoal(req.user.id, req.params.id)) throw new HttpError(404, 'Ziel nicht gefunden');
    return { ok: true };
  });

  api.post('/api/goals/:id/log', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const goal = getGoal(req.user.id, req.params.id);
    if (!goal) throw new HttpError(404, 'Ziel nicht gefunden');
    const value = b.value === undefined ? 1 : Number(String(b.value).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) throw new HttpError(400, 'Das ist keine gültige Menge.');
    const today = todayIn(req.user.timeZone);
    const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.date <= today ? b.date : today;
    logGoal(req.user.id, goal.id, value, date, typeof b.note === 'string' ? b.note : null);
    return { goal: progress(req.user, goal) };
  });

  api.delete('/api/goal-logs/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!deleteLog(req.user.id, req.params.id)) throw new HttpError(404, 'Eintrag nicht gefunden');
    return { ok: true };
  });
}
