// „Plan my week“: verteilt, was diese Woche Zeit braucht – Lernen für Tests, HÜs, Abgaben –
// auf die freien Zeitfenster aus dem Lagebild. Regeln statt KI: Aufwand je Art, Tageslimit,
// Puffer zwischen Blöcken, kein Lernen am Testtag, am Tag davor „Alles wiederholen“.
// Die KI hilft nur beim Aufteilen von langem Stoff in Lerneinheiten (planWeek mit refine).
//
// Übernehmen läuft als Aktion (week_plan.apply) – mit Rechte-Stufe und Rückgängig.
// Sonntagabend bietet Stella den Plan von selbst an, verpasste Blöcke plant sie neu ein.

import {
  addDays, formatDateDe, splitTopics, timeIn, todayIn, voice,
  type Item, type Memory, type PlanBlock, type WeekPlan,
} from '@stella/shared';
import { levelFor, perform } from './actions.ts';
import { activeGoals, countLogs, getGoal, weekStart } from './goals.ts';
import { afterWorkTime, hasFeature } from './profile.ts';
import { buildLagebild, freeSlots, isoWeekday, toHhmm, toMin, type DayContext, type Interval, type Lagebild } from './context.ts';
import { addMessage, db, getItem, getUser, type User } from './db.ts';
import { isDelivered, markDelivered } from './hints.ts';
import { complete, llmAvailable } from './llm.ts';
import { pushToUser } from './push.ts';

const MINUTES = { exam: 45, homework: 30, assignment: 60, goal: 30 } as const;
/** Pause zwischen zwei Dingen */
const GAP = 10;
/** höchstens so viel Geplantes pro Tag */
const DAY_CAP = { weekday: 120, weekend: 150 };
/** Blöcke enden spätestens hier */
const LATEST_END = '21:00';
const REVIEW = 'Alles wiederholen';

const isBigExam = (i: Item) => /schularbeit|\bsa\b|klausur|\bka\b/iu.test(`${i.title} ${i.detail ?? ''}`);

/** Lernzeit: Vorliebe aus dem Gedächtnis („lernt lieber abends“) schlägt die eingestellte Zeit */
export function preferredStart(user: User, memories: Memory[]): string {
  const prefs = memories.filter((m) => m.category === 'preference' || m.category === 'routine').map((m) => m.text.toLowerCase()).join('\n');
  if (/lern\w*[^\n.]{0,40}\babends?\b|\babends?\b[^\n.]{0,40}lern/u.test(prefs)) return '18:30';
  if (/lern\w*[^\n.]{0,40}nachmittags?|nachmittags?[^\n.]{0,40}lern/u.test(prefs)) return '15:00';
  if (/lern\w*[^\n.]{0,40}(morgens|in der früh|vormittags?)|(morgens|vormittags?)[^\n.]{0,40}lern/u.test(prefs)) return '09:00';
  return user.settings.studyTime ?? '16:30';
}

interface DayState {
  day: DayContext;
  window: Interval;
  placed: Interval[];
  planned: number;
  cap: number;
}

const round5 = (min: number) => Math.ceil(min / 5) * 5;
/** auf die nächste Viertelstunde – „16:15“ statt „16:10“ */
const roundQ = (min: number) => Math.ceil(min / 15) * 15;

/** passender Start in einem Tag – möglichst nah an der Wunschzeit, mit Puffer zu allem anderen */
function slotIn(s: DayState, minutes: number, preferred: string): string | null {
  if (s.planned + minutes > s.cap) return null;
  const busy = [...s.day.busy, ...s.placed].map((b) => ({ start: toHhmm(Math.max(0, toMin(b.start) - GAP)), end: toHhmm(Math.min(24 * 60 - 1, toMin(b.end) + GAP)) }));
  const want = toMin(preferred);
  let best: number | null = null;
  for (const f of freeSlots(s.window, busy, minutes)) {
    const lo = roundQ(toMin(f.start));
    const hi = toMin(f.end) - minutes;
    if (hi < lo) continue;
    const at = Math.min(Math.max(roundQ(want), lo), hi - (hi % 15));
    if (at < lo) continue;
    if (best === null || Math.abs(at - want) < Math.abs(best - want)) best = at;
  }
  return best === null ? null : toHhmm(best);
}

function take(s: DayState, start: string, minutes: number) {
  s.placed.push({ start, end: toHhmm(toMin(start) + minutes) });
  s.planned += minutes;
}

/** Tage im Plan, ab `from` (heute nur, wenn noch genug vom Tag übrig ist) */
function dayStates(lb: Lagebild, from: string, to: string): DayState[] {
  const out: DayState[] = [];
  for (const day of lb.days) {
    if (day.date < from || day.date > to) continue;
    const weekend = isoWeekday(day.date) >= 6;
    let start = weekend ? '09:00' : '07:00';
    if (day.date === lb.today) start = toHhmm(Math.max(toMin(start), round5(toMin(lb.now) + 15)));
    // bestehende Lern-/Arbeitsblöcke zählen zum Tageslimit
    const planned = day.items.filter((i) => i.kind === 'study' && i.status === 'open').length * MINUTES.exam;
    out.push({ day, window: { start, end: LATEST_END }, placed: [], planned, cap: weekend ? DAY_CAP.weekend : DAY_CAP.weekday });
  }
  return out;
}

const children = (userId: string, parentId: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND parent_id = ? AND kind = 'study' AND deleted = 0 AND status != 'cancelled'`)
    .get(userId, parentId) as { n: number }).n;

/** Tage zum Verteilen: gleichmäßig, mit dem letzten möglichst am Ende (Wiederholung am Vortag) */
function spread(days: DayState[], n: number): DayState[][] {
  if (!days.length || n <= 0) return [];
  const order: DayState[][] = [];
  for (let k = 0; k < n; k++) {
    const ideal = n === 1 ? days.length - 1 : Math.round((days.length - 1) * (1 - k / (n - 1)));
    // ideale Tage zuerst, danach die nächstgelegenen
    order.push([...days].sort((a, b) => Math.abs(days.indexOf(a) - ideal) - Math.abs(days.indexOf(b) - ideal) || days.indexOf(a) - days.indexOf(b)));
  }
  return order;
}

interface Need {
  deadline: string;
  run: () => void;
}

export interface PlanOptions {
  /** erster Tag (Standard: heute, ab 19 Uhr morgen) */
  from?: string;
  /** Stoff-Aufteilung je Test (z. B. von der KI) */
  focuses?: Record<string, string[]>;
}

export function buildWeekPlan(user: User, opts: PlanOptions = {}, lb: Lagebild = buildLagebild(user, 16)): WeekPlan {
  const late = toMin(lb.now) >= toMin('19:00');
  const from = opts.from ?? (late ? addDays(lb.today, 1) : lb.today);
  const to = addDays(from, 6);
  const states = dayStates(lb, from, to);
  const preferred = preferredStart(user, lb.memories);
  const blocks: PlanBlock[] = [];
  const notes: string[] = [];
  const needs: Need[] = [];
  const homeworkAutopilot = ['auto', 'notify'].includes(levelFor(user, 'homework'));

  const before = (date: string) => states.filter((s) => s.day.date < date);

  // Tests: 3 Einheiten, Schularbeit 4 – bestehende zählen mit
  for (const e of lb.exams) {
    if (e.daysLeft < 1) continue;
    const exam = e.exam;
    const target = isBigExam(exam) ? 4 : 3;
    let need = target - e.sessions.total;
    // Test erst nach dieser Woche: die letzten zwei Einheiten (inkl. Wiederholung) plant die nächste Woche
    const beyond = exam.due! > addDays(to, 1);
    if (beyond) need = Math.min(need, target - 2 - e.sessions.total);
    if (need <= 0) continue;
    needs.push({
      deadline: exam.due!,
      run: () => {
        const days = before(exam.due!);
        // nicht zweimal dasselbe am selben Tag – bei wenig Zeit lieber weniger Einheiten
        need = Math.min(need, days.length);
        const topics = opts.focuses?.[exam.id] ?? (exam.material ? splitTopics(exam.material) : []);
        const placedDays: DayState[] = [];
        const used = new Set<DayState>();
        for (const candidates of spread(days, need)) {
          for (const s of candidates) {
            if (used.has(s)) continue;
            const at = slotIn(s, MINUTES.exam, preferred);
            if (!at) continue;
            take(s, at, MINUTES.exam);
            used.add(s);
            placedDays.push(s);
            blocks.push({
              key: '', date: s.day.date, start: at, end: toHhmm(toMin(at) + MINUTES.exam),
              title: `Lernen: ${exam.title}`, focus: null, subject: exam.subject, parentId: exam.id, why: 'exam',
            });
            break;
          }
        }
        // Schwerpunkte in zeitlicher Reihenfolge: Themen verteilen, am Vortag wiederholen
        const mine = blocks.filter((b) => b.parentId === exam.id).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        const review = !beyond && mine.length >= 2 && mine.at(-1)!.date === addDays(exam.due!, -1);
        const learn = review ? mine.slice(0, -1) : mine;
        if (review) mine.at(-1)!.focus = REVIEW;
        if (!exam.material?.trim()) {
          if (learn[0]) learn[0].focus = 'Stoff klären, Überblick verschaffen';
        } else if (topics.length) {
          learn.forEach((b, i) => {
            const a = Math.floor((i * topics.length) / learn.length);
            const z = Math.max(a + 1, Math.floor(((i + 1) * topics.length) / learn.length));
            b.focus = topics.slice(a, z).join(', ');
          });
        }
        mine.forEach((b, i) => { b.key = `${exam.id}:${e.sessions.total + i}`; });
        if (mine.length < need) {
          notes.push(mine.length
            ? `Für „${exam.title}“ passen diese Woche nur ${mine.length} von ${need} Lerneinheiten.`
            : `Für „${exam.title}“ finde ich vor dem Test keinen freien Platz mehr.`);
        }
      },
    });
  }

  // HÜs: ein halbe Stunde, am liebsten am Tag davor
  const open = db.prepare(`SELECT id FROM items WHERE user_id = ? AND deleted = 0 AND status = 'open' AND kind IN ('homework', 'assignment')
    AND due > ? AND due <= ?`).all(user.id, from, addDays(from, 14)) as { id: string }[];
  for (const { id } of open) {
    const item = getItem(user.id, id);
    if (!item?.due) continue;
    const have = children(user.id, item.id);
    if (item.kind === 'homework') {
      if (item.due > addDays(to, 1) || have) continue;
      if (item.attachments.some((a) => a.caption?.startsWith('Lösung'))) continue;
      if (homeworkAutopilot && item.attachments.length) continue; // löst Stella ohnehin
      needs.push({
        deadline: item.due,
        run: () => {
          const days = before(item.due!).reverse();
          for (const s of days) {
            const at = slotIn(s, MINUTES.homework, preferred);
            if (!at) continue;
            take(s, at, MINUTES.homework);
            blocks.push({
              key: `${item.id}:0`, date: s.day.date, start: at, end: toHhmm(toMin(at) + MINUTES.homework),
              title: `Erledigen: ${item.title}`, focus: item.detail, subject: item.subject, parentId: item.id, why: 'homework',
            });
            return;
          }
          notes.push(`Für „${item.title}“ ist vor der Abgabe kein Platz mehr frei.`);
        },
      });
    } else {
      const daysLeft = Math.round((Date.parse(item.due) - Date.parse(from)) / 86_400_000);
      const need = (daysLeft >= 4 ? 2 : 1) - have;
      if (need <= 0) continue;
      needs.push({
        deadline: item.due,
        run: () => {
          const days = before(item.due!);
          let n = 0;
          const used = new Set<DayState>();
          for (const candidates of spread(days, need)) {
            for (const s of candidates) {
              if (used.has(s)) continue;
              const at = slotIn(s, MINUTES.assignment, preferred);
              if (!at) continue;
              take(s, at, MINUTES.assignment);
              used.add(s);
              blocks.push({
                key: `${item.id}:${have + n}`, date: s.day.date, start: at, end: toHhmm(toMin(at) + MINUTES.assignment),
                title: `Arbeiten an: ${item.title}`, focus: item.detail, subject: item.subject, parentId: item.id, why: 'assignment',
              });
              n++;
              break;
            }
          }
          if (n < need) notes.push(`Für „${item.title}“ ist diese Woche zu wenig Zeit frei.`);
        },
      });
    }
  }

  // Ziele mit Zeitbedarf („3× pro Woche laufen, 45 Minuten“): fehlende Einheiten dieser Woche verteilen – nach allem mit Frist
  const lastDay = states.at(-1)?.day.date;
  for (const g of lastDay && hasFeature(user, 'goals') ? activeGoals(user.id) : []) {
    const per = /^weekly:(\d+)$/.exec(g.cadence)?.[1];
    if (!per || !g.minutes) continue;
    const minutes = g.minutes;
    const planned = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND parent_id = ? AND deleted = 0 AND status = 'open' AND due >= ? AND due <= ?`)
      .get(user.id, g.id, from, to) as { n: number }).n;
    const need = Number(per) - countLogs(g.id, weekStart(from), from > lb.today ? addDays(from, -1) : lb.today) - planned;
    if (need <= 0) continue;
    needs.push({
      deadline: addDays(to, 1),
      run: () => {
        let n = 0;
        const used = new Set<DayState>();
        for (const candidates of spread(states, need)) {
          for (const s of candidates) {
            if (used.has(s)) continue;
            const at = slotIn(s, minutes, afterWorkTime(user));
            if (!at) continue;
            take(s, at, minutes);
            used.add(s);
            blocks.push({
              key: `${g.id}:${weekStart(from)}:${n}`, date: s.day.date, start: at, end: toHhmm(toMin(at) + minutes),
              title: `Ziel: ${g.title}`, focus: g.why, subject: null, parentId: g.id, why: 'goal',
            });
            n++;
            break;
          }
        }
        if (n < need) notes.push(`Für „${g.title}“ finde ich diese Woche nur ${n} von ${need} freien Terminen.`);
      },
    });
  }

  // Dringendes zuerst
  for (const n of needs.sort((a, b) => a.deadline.localeCompare(b.deadline))) n.run();

  blocks.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    from, to, blocks, notes,
    load: states.map((s) => ({ date: s.day.date, freeMinutes: s.day.freeMinutes, plannedMinutes: s.planned })),
  };
}

/** Wie buildWeekPlan, aber langer Stoff wird von der KI in sinnvolle Lerneinheiten geteilt */
export async function planWeek(user: User, opts: PlanOptions = {}): Promise<WeekPlan> {
  const draft = buildWeekPlan(user, opts);
  if (!llmAvailable()) return draft;
  const focuses: Record<string, string[]> = { ...opts.focuses };
  for (const parentId of new Set(draft.blocks.filter((b) => b.why === 'exam').map((b) => b.parentId))) {
    const exam = getItem(user.id, parentId);
    const n = draft.blocks.filter((b) => b.parentId === parentId && b.focus !== REVIEW).length;
    if (!exam?.material || n < 2 || splitTopics(exam.material).length >= n || exam.material.length < 25) continue;
    try {
      const { message } = await complete([
        { role: 'system', content: 'Du teilst Prüfungsstoff in Lerneinheiten auf. Antworte nur mit JSON: {"units": ["…", "…"]} – genau so viele Einträge wie verlangt, je höchstens 8 Wörter, in sinnvoller Lernreihenfolge.' },
        { role: 'user', content: `Test: ${exam.title}\nStoff: ${exam.material.slice(0, 1500)}\nAnzahl Lerneinheiten: ${n}` },
      ], undefined, { json: true, timeoutMs: 45_000, background: true });
      const units = (JSON.parse(message.content ?? '{}') as { units?: unknown }).units;
      if (Array.isArray(units) && units.length >= n) focuses[parentId] = units.slice(0, n).map((u) => String(u).slice(0, 80));
    } catch { /* ohne KI bleibt die einfache Aufteilung */ }
  }
  return Object.keys(focuses).length ? buildWeekPlan(user, { ...opts, focuses }) : draft;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** kompakt für Chat und Push */
export function weekPlanText(plan: WeekPlan, today: string): string {
  const days = new Map<string, PlanBlock[]>();
  for (const b of plan.blocks) days.set(b.date, [...(days.get(b.date) ?? []), b]);
  const lines = [...days].map(([date, bs]) => `**${capitalize(formatDateDe(date, today))}**: ` +
    bs.map((b) => `${b.start} ${b.title}${b.focus ? ` (${b.focus})` : ''}`).join(' · '));
  return [...lines, ...plan.notes.map((n) => `⚠️ ${n}`)].join('\n');
}

/** prüft Blöcke vom Client: nur eigene Tests/HÜs, gültige Zeiten */
export function cleanBlocks(userId: string, raw: unknown): PlanBlock[] {
  if (!Array.isArray(raw)) return [];
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const out: PlanBlock[] = [];
  for (const r of raw.slice(0, 60) as Record<string, unknown>[]) {
    const goal = r.why === 'goal' && typeof r.parentId === 'string' ? getGoal(userId, r.parentId) : null;
    const parent = goal ? null : typeof r.parentId === 'string' ? getItem(userId, r.parentId) : null;
    if (!goal && (!parent || parent.deleted)) continue;
    if (typeof r.date !== 'string' || !ymd.test(r.date) || typeof r.start !== 'string' || !hhmm.test(r.start)) continue;
    const why = goal ? 'goal' : r.why === 'homework' || r.why === 'assignment' ? r.why : 'exam';
    const end = typeof r.end === 'string' && hhmm.test(r.end) ? r.end : toHhmm(toMin(r.start) + (goal?.minutes ?? MINUTES[why]));
    out.push({
      key: String(r.key ?? '').slice(0, 80), date: r.date, start: r.start, end,
      title: String(r.title ?? goal?.title ?? parent!.title).slice(0, 160), focus: r.focus ? String(r.focus).slice(0, 200) : null,
      subject: parent?.subject ?? null, parentId: (goal ?? parent!).id, why,
    });
  }
  return out;
}

/** Plan vorschlagen (Karte mit Ja/Nein) – im Chat auf Bitte, sonntags von selbst */
export function offerWeekPlan(user: User, plan: WeekPlan, opts: { intro: string; source: 'chat' | 'auto'; say?: (text: string, actionId: string) => void }) {
  const v = voice(user.settings.tone);
  const text = `${opts.intro}\n\n${weekPlanText(plan, todayIn(user.timeZone))}\n\n${v.weekPlanQuestion()}`;
  return { text, result: perform(user, 'week_plan.apply', { blocks: plan.blocks }, { source: opts.source, confirm: true, question: text, say: opts.say }) };
}

/** Sonntag zwischen 18 und 20:30: Plan für die neue Woche anbieten (einmal) */
export async function maybeOfferWeek(userId: string): Promise<void> {
  const user = getUser(userId);
  if (!user || user.settings.weekPlan === 'off') return;
  const today = todayIn(user.timeZone);
  const now = timeIn(user.timeZone);
  if (isoWeekday(today) !== 7 || now < '18:00' || now > '20:30') return;
  const key = `weekplan:${today}`;
  if (isDelivered(userId, key)) return;
  const plan = await planWeek(user, { from: addDays(today, 1) });
  if (!plan.blocks.length) { markDelivered(userId, key); return; }
  const v = voice(user.settings.tone);
  const { result } = offerWeekPlan(user, plan, { intro: v.weekPlanOffer(), source: 'auto' });
  markDelivered(userId, key, result.status === 'refused' ? undefined : result.actionId);
  if (result.status !== 'refused') {
    await pushToUser(userId, { title: 'Stella', body: `${v.weekPlanOffer()} ${plan.blocks.length} Blöcke – schau kurz drüber.`, tag: key });
  }
}

/**
 * Verpasste Lern-/Arbeitsblöcke neu einplanen – vor dem Test bzw. der Abgabe.
 * Steht „Planer ändern“ auf selbst/melden, macht Stella das sofort (mit Rückgängig);
 * auf „fragen“ bleibt es beim Hinweis mit Vorschlag.
 */
export function replanMissed(userId: string): number {
  const user = getUser(userId);
  if (!user) return 0;
  const level = levelFor(user, 'planner');
  if (level !== 'auto' && level !== 'notify') return 0;
  const lb = buildLagebild(user, 16);
  if (toMin(lb.now) < toMin('07:00')) return 0;
  const missed = db.prepare(`SELECT id FROM items WHERE user_id = ? AND deleted = 0 AND status = 'open' AND kind = 'study'
    AND parent_id IS NOT NULL AND due < ? AND due >= ?`).all(userId, lb.today, addDays(lb.today, -3)) as { id: string }[];
  const states = dayStates(lb, lb.today, addDays(lb.today, 14));
  const preferred = preferredStart(user, lb.memories);
  const v = voice(user.settings.tone);
  let moved = 0;
  for (const { id } of missed) {
    const key = `missed_study:${id}`;
    if (isDelivered(userId, key)) continue;
    const block = getItem(userId, id);
    const parent = block?.parentId ? getItem(userId, block.parentId) : null;
    if (!block || !parent?.due || parent.status !== 'open' || parent.deleted || parent.due <= lb.today) continue;
    const minutes = parent.kind === 'homework' ? MINUTES.homework : parent.kind === 'assignment' ? MINUTES.assignment : MINUTES.exam;
    let slot: { s: DayState; at: string } | null = null;
    for (const s of states) {
      if (s.day.date >= parent.due) break;
      const at = slotIn(s, minutes, preferred);
      if (at) { slot = { s, at }; break; }
    }
    if (!slot) continue;
    take(slot.s, slot.at, minutes);
    const r = perform(user, 'item.update', { id, patch: { due: slot.s.day.date, time: slot.at } }, { source: 'auto', quiet: true });
    if (r.status !== 'done') continue;
    addMessage(userId, 'assistant', v.replanned(block.title, `${formatDateDe(slot.s.day.date, lb.today)} ${slot.at}`), { actionId: r.actionId });
    markDelivered(userId, key, r.actionId);
    moved++;
  }
  return moved;
}
