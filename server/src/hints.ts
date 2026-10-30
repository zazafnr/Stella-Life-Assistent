// „Was hast du vergessen?“ – Regeln, die über das Lagebild laufen und Probleme finden, bevor sie
// eins werden. Jeder Hinweis hat einen stabilen Schlüssel (kommt nie doppelt) und – wo möglich –
// einen fertigen Lösungsvorschlag, der über die Aktionen mit Rechte-Stufen läuft.
//
// Zustellung (deliverHints, alle paar Minuten):
//   wichtig  → sofort als Chat-Nachricht + Push, außer nachts, höchstens 3 pro Tag
//   normal   → gesammelt im nächsten Morning Briefing
// Kommt ohne KI aus.

import { addDays, formatDateDe, timeIn, voice, type Hint, type Item } from '@stella/shared';
import { levelFor, perform, type ActionParams, type ActionType, type Performed } from './actions.ts';
import { buildLagebild, toMin, type Lagebild } from './context.ts';
import { hasFeature, isLearner, isSchool } from './profile.ts';
import { addMessage, db, getUser, now, setPending, type PendingType, type User } from './db.ts';
import { bookFor } from './planner.ts';
import { pushToUser } from './push.ts';
import { nextLessonDate } from './untis.ts';
import { activeGoals, parseGoalQuick, staleGoals } from './goals.ts';

export interface FoundHint extends Hint {
  action?: { type: ActionType; params: ActionParams[ActionType]; label: string };
  /** beim Zustellen: Rückfrage im Chat merken (z. B. Stoff für den Test) */
  pending?: { type: PendingType; itemId: string };
}

const QUIET_FROM = '21:30';
const QUIET_UNTIL = '07:00';
const MAX_PUSH_PER_DAY = 3;
const STUDY_MINUTES = 45;

/** nächster freier Platz für eine Lerneinheit (vor `before`), bevorzugt zur Lernzeit */
export function findSlot(lb: Lagebild, minutes: number, before: string, preferred: string): { date: string; time: string } | null {
  for (const day of lb.days) {
    if (day.date >= before) break;
    const fits = day.free.filter((f) => toMin(f.end) - toMin(f.start) >= minutes);
    if (!fits.length) continue;
    const at = fits.find((f) => f.start <= preferred && toMin(f.end) - toMin(preferred) >= minutes);
    return { date: day.date, time: at ? preferred : fits[0]!.start };
  }
  return null;
}

export function findHints(user: User, lb: Lagebild = buildLagebild(user, 8)): FoundHint[] {
  const v = voice(user.settings.tone);
  const out: FoundHint[] = [];
  const tomorrow = addDays(lb.today, 1);
  const studyTime = user.settings.studyTime ?? '16:30';
  const tomorrowDay = lb.days.find((d) => d.date === tomorrow);
  const today = lb.days[0]!;

  // Tests: Stoff fehlt / kein Lernplan (nur Schule und Studium)
  for (const e of isLearner(user) ? lb.exams : []) {
    if (e.daysLeft < 1) continue;
    if (!e.hasMaterial && e.daysLeft <= 10) {
      out.push({
        key: `exam_no_material:${e.exam.id}`, priority: e.daysLeft <= 5 ? 'high' : 'normal', itemId: e.exam.id,
        text: v.hintNoMaterial(e.exam.title, e.daysLeft), pending: { type: 'exam_material', itemId: e.exam.id },
        open: { tab: 'chat', label: 'Stoff sagen' },
      });
    } else if (e.hasMaterial && e.sessions.total === 0 && e.daysLeft >= 2 && e.daysLeft <= 14) {
      out.push({
        key: `exam_no_plan:${e.exam.id}`, priority: e.daysLeft <= 5 ? 'high' : 'normal', itemId: e.exam.id,
        text: v.hintNoPlan(e.exam.title, e.daysLeft),
        action: { type: 'study_plan.create', params: { examId: e.exam.id, material: e.exam.material! }, label: 'Lernplan machen' },
      });
    }
  }

  // Verpasste Lerneinheiten neu einplanen
  const allItems = (!isLearner(user) ? [] : db.prepare(`SELECT id, title, due, parent_id FROM items WHERE user_id = ? AND deleted = 0 AND status = 'open'
    AND kind = 'study' AND due < ? AND due >= ?`).all(user.id, lb.today, addDays(lb.today, -7))) as { id: string; title: string; due: string; parent_id: string | null }[];
  for (const s of allItems) {
    const exam = lb.exams.find((e) => e.exam.id === s.parent_id);
    if (!exam) continue;
    const slot = findSlot(lb, STUDY_MINUTES, exam.exam.due!, studyTime);
    if (!slot) continue;
    const label = `${formatDateDe(slot.date, lb.today)} ${slot.time}`;
    out.push({
      key: `missed_study:${s.id}`, priority: exam.daysLeft <= 3 ? 'high' : 'normal', itemId: s.id,
      text: v.hintMissedStudy(s.title, label),
      action: { type: 'item.update', params: { id: s.id, patch: { due: slot.date, time: slot.time } }, label: `Auf ${label}` },
    });
  }

  // Überfällige HÜs/Abgaben/To-dos
  for (const i of lb.overdue) {
    if (!['homework', 'assignment', 'todo'].includes(i.kind) || i.due! < addDays(lb.today, -14)) continue;
    out.push({
      key: `overdue:${i.id}`, priority: 'normal', itemId: i.id,
      text: v.hintOverdue(i.title, formatDateDe(i.due!, lb.today)),
      action: { type: 'item.update', params: { id: i.id, patch: { status: 'done' } }, label: 'Abhaken' },
    });
  }

  if (tomorrowDay) {
    const dueTomorrow = tomorrowDay.items.filter((i) => i.status === 'open');

    // Stunde entfällt, die HÜ dafür ist aber noch für morgen eingetragen
    const cancelled = !isSchool(user) ? [] : tomorrowDay.lessons.filter((l) => l.status === 'cancelled' && l.subject);
    for (const l of cancelled) {
      const stillThere = tomorrowDay.lessons.some((x) => x.subject === l.subject && x.status !== 'cancelled');
      if (stillThere) continue;
      for (const hw of dueTomorrow.filter((i) => i.kind === 'homework' && i.subject === l.subject)) {
        const next = nextLessonDate(user.id, l.subject!, tomorrow);
        if (!next) continue;
        out.push({
          key: `cancelled:${hw.id}:${tomorrow}`, priority: 'high', itemId: hw.id,
          text: v.hintCancelled(l.subject!, hw.title, formatDateDe(next, lb.today)),
          action: { type: 'item.update', params: { id: hw.id, patch: { due: next } }, label: `Auf ${formatDateDe(next, lb.today)}` },
        });
      }
    }

    // HÜ für morgen, aber weder Foto noch Buchseite – Autopilot kann nichts tun
    const afternoon = toMin(lb.now) >= toMin('14:00');
    if (afternoon && isSchool(user) && levelFor(user, 'homework') !== 'never') {
      for (const hw of dueTomorrow.filter((i) => i.kind === 'homework')) {
        if (hw.attachments.length || (hw.page && bookFor(user, hw.subject))) continue;
        out.push({ key: `no_source:${hw.id}`, priority: 'high', itemId: hw.id, text: v.hintNoSource(hw.title), open: { tab: 'chat', label: 'Foto schicken' } });
      }
    }

    // Morgen viel fällig, heute kaum Zeit
    const heavy = dueTomorrow.filter((i) => ['homework', 'assignment', 'exam'].includes(i.kind) && !solved(i));
    if (heavy.length >= 3 && today.freeMinutes < 120) {
      out.push({ key: `overloaded:${tomorrow}`, priority: 'normal', text: v.hintOverloaded(heavy.length, today.freeMinutes) });
    }
  }

  // Mails, die auf eine Antwort warten (älter als ein halber Tag)
  const halfDay = Date.now() - 12 * 3600_000;
  for (const m of hasFeature(user, 'mails') ? lb.importantInbox : []) {
    if (!m.needsReply || m.source !== 'email' || Date.parse(m.createdAt) > halfDay) continue;
    out.push({ key: `reply:${m.id}`, priority: 'normal', text: v.hintReply(m.sender ?? 'Jemand', m.summary), open: { tab: 'inbox', label: 'Antwort schreiben' } });
  }

  // Ziele ohne Eintrag seit zwei Wochen (höchstens einmal im Monat je Ziel)
  for (const { goal, weeks } of staleGoals(user, lb.today)) {
    out.push({ key: `goal_stale:${goal.id}:${lb.today.slice(0, 7)}`, priority: 'normal', text: v.goalStale(goal.title, weeks), open: { tab: 'goals', label: 'Ziele ansehen' } });
  }

  // Gedächtnis-Einträge der Kategorie „Ziel“: einmal anbieten, sie als echtes Ziel anzulegen
  const haveGoal = new Set(activeGoals(user.id).map((g) => g.title.toLowerCase()));
  for (const m of lb.memories.filter((x) => x.category === 'goal').slice(0, 3)) {
    const bare = m.text.replace(/^\s*(ich\s+)?(will|möchte|moechte|werde|plane|mein ziel( ist)?)[:,]?\s+/iu, '').trim();
    const parsed = parseGoalQuick(`ich will ${bare}`);
    const title = (parsed?.title ?? bare).replace(/[.!]+$/u, '').slice(0, 80);
    if (title.length < 3 || haveGoal.has(title.toLowerCase())) continue;
    out.push({
      key: `goal_memory:${m.id}`, priority: 'normal', text: v.goalFromMemory(title),
      action: { type: 'goal.create', params: { ...parsed, title: title.charAt(0).toUpperCase() + title.slice(1) }, label: 'Als Ziel anlegen' },
    });
    break;
  }

  // bekannter Zustand: Vorschlag schon verschickt / weggeklickt / abgelehnt
  const state = new Map((db.prepare('SELECT key, action_id, dismissed_at FROM hints_state WHERE user_id = ?').all(user.id) as
    { key: string; action_id: string | null; dismissed_at: string | null }[]).map((r) => [r.key, r]));
  return out.filter((h) => {
    const s = state.get(h.key);
    if (s?.dismissed_at) return false;
    if (s?.action_id) {
      const status = (db.prepare('SELECT status FROM actions WHERE id = ?').get(s.action_id) as { status: string } | undefined)?.status;
      if (status && status !== 'proposed') return false;
      h.actionId = s.action_id;
    }
    if (h.action) h.actionLabel = h.action.label;
    return true;
  }).sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
}

const solved = (i: Item) => i.attachments.some((a) => a.caption?.startsWith('Lösung'));

export function markDelivered(userId: string, key: string, actionId?: string) {
  db.prepare(`INSERT INTO hints_state (user_id, key, delivered_at, action_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET delivered_at = COALESCE(delivered_at, excluded.delivered_at), action_id = COALESCE(excluded.action_id, action_id)`)
    .run(userId, key, now(), actionId ?? null);
}

export function isDelivered(userId: string, key: string): boolean {
  return !!(db.prepare('SELECT 1 FROM hints_state WHERE user_id = ? AND key = ? AND delivered_at IS NOT NULL').get(userId, key));
}

export function dismissHint(userId: string, key: string) {
  db.prepare(`INSERT INTO hints_state (user_id, key, dismissed_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET dismissed_at = excluded.dismissed_at`).run(userId, key, now());
}

/**
 * Hinweis zustellen: mit Vorschlag über die Rechte-Stufe (Karte oder gleich erledigt),
 * sonst als Nachricht. `push` = zusätzlich aufs Handy.
 */
export async function deliverHint(user: User, h: FoundHint, push: boolean): Promise<void> {
  if (isDelivered(user.id, h.key)) return;
  let actionId: string | undefined;
  let text = h.text;
  if (h.action) {
    const r = perform(user, h.action.type, h.action.params as never, { source: 'auto', question: h.text, quiet: true });
    if (r.status === 'done') {
      actionId = r.actionId;
      text = voice(user.settings.tone).hintDone((db.prepare('SELECT summary FROM actions WHERE id = ?').get(r.actionId) as { summary: string }).summary);
      addMessage(user.id, 'assistant', text, { actionId });
    } else if (r.status === 'proposed') {
      actionId = r.actionId;
    } else {
      addMessage(user.id, 'assistant', h.text);
    }
  } else {
    addMessage(user.id, 'assistant', h.text);
  }
  if (h.pending) setPending(user.id, h.pending.type, h.pending.itemId);
  markDelivered(user.id, h.key, actionId);
  if (push) await pushToUser(user.id, { title: 'Stella', body: text.replace(/\*\*/g, ''), tag: h.key });
}

/** Hinweis über den Knopf auf „Heute“ erledigen lassen – das ist Zustimmung des Nutzers */
export function acceptHint(user: User, key: string): Performed | { status: 'pending'; changed: Item[] } {
  const h = findHints(user).find((x) => x.key === key);
  // Rückfrage (z. B. Stoff): die nächste Chat-Nachricht beantwortet sie
  if (h && !h.action && h.pending) {
    setPending(user.id, h.pending.type, h.pending.itemId);
    markDelivered(user.id, key);
    return { status: 'pending', changed: [] };
  }
  if (!h?.action) throw new Error('Diesen Vorschlag gibt es nicht mehr');
  const r = perform(user, h.action.type, h.action.params as never, { source: 'chat', quiet: true });
  if (r.status === 'refused') throw new Error(r.reason);
  markDelivered(user.id, key, r.status === 'done' || r.status === 'proposed' ? r.actionId : undefined);
  return r;
}

const quiet = (hhmm: string) => hhmm >= QUIET_FROM || hhmm < QUIET_UNTIL;

/** Wichtige Hinweise sofort zustellen (außer nachts, max. 3 Pushes am Tag) – läuft im Scheduler. */
export async function deliverHints(userId: string) {
  const user = getUser(userId);
  if (!user) return;
  const nowHhmm = timeIn(user.timeZone);
  if (quiet(nowHhmm)) return;
  const dayStart = new Date(Date.now() - (toMin(nowHhmm) * 60_000)).toISOString();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM hints_state WHERE user_id = ? AND delivered_at > ?').get(userId, dayStart) as { n: number };
  let budget = MAX_PUSH_PER_DAY - n;
  for (const h of findHints(user)) {
    if (budget <= 0) break;
    if (h.priority !== 'high' || isDelivered(userId, h.key)) continue;
    await deliverHint(user, h, true);
    budget--;
  }
}
