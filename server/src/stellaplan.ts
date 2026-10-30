// „Was Stella vorhat“: alles, was Stella diese Woche und dauerhaft von selbst tut – an einem Ort,
// jeder Punkt lässt sich ändern oder abstellen. Die Liste wird aus den vorhandenen Quellen gebaut
// (Briefing, Wochenplan, Erinnerungen, Daueraufträge, Ziele, Lerneinheiten, Automatiken, offene Vorschläge).
// Änderungen laufen über Aktionen im Protokoll – mit „Rückgängig“.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addDays, describeRecurrence, formatDateDe, timeIn, todayIn, weekdayOf,
  type StellaPlanControl, type StellaPlanEntry,
} from '@stella/shared';
import { applyPlanSetting, GROUPS, isGroup, levelFor, planSettingValue, record, type PlanSettingKey } from './actions.ts';
import { HttpError } from './auth.ts';
import { briefingTime } from './briefing.ts';
import { buildLagebild } from './context.ts';
import { db, getItem, getUser, type User } from './db.ts';
import { getGoal, listGoals, updateGoal } from './goals.ts';
import { changeItem } from './planner.ts';
import { hasFeature, isSchool } from './profile.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Zeitpunkt in der Zeitzone der Person: Datum + Uhrzeit */
function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

const whenLabel = (date: string, time: string | null, today: string) => `${capitalize(formatDateDe(date, today))}${time ? ` um ${time}` : ''}`;

/** nächster Check-in eines Ziels („So 18:00“ oder „18:00“) als lokales Datum + Uhrzeit */
function nextCheckIn(checkIn: string, today: string, nowHhmm: string): string | null {
  const m = /^(?:(Mo|Di|Mi|Do|Fr|Sa|So)\s+)?(\d{2}:\d{2})$/.exec(checkIn);
  if (!m) return null;
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    if (m[1] && WEEKDAY_SHORT[weekdayOf(date)] !== m[1]) continue;
    if (i === 0 && m[2]! <= nowHhmm) continue;
    return `${date} ${m[2]}`;
  }
  return null;
}

const toggle = (on: boolean, label: string): StellaPlanControl => ({ type: 'toggle', on, label });
const timeControl = (value: string, label = 'Uhrzeit'): StellaPlanControl => ({ type: 'time', value, label });
const permLink: StellaPlanControl = { type: 'link', target: 'permissions', label: 'Was Stella selbst darf' };

export function buildStellaPlan(user: User): { entries: StellaPlanEntry[]; soon: StellaPlanEntry[] } {
  const tz = user.timeZone;
  const today = todayIn(tz);
  const now = timeIn(tz);
  const nowStamp = `${today} ${now}`;
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const week: StellaPlanEntry[] = [];
  const regular: StellaPlanEntry[] = [];
  const longterm: StellaPlanEntry[] = [];

  // offene Vorschläge, die auf ein Ja warten
  for (const a of db.prepare(`SELECT id, summary FROM actions WHERE user_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 10`).all(user.id) as { id: string; summary: string }[]) {
    week.push({ id: `proposal:${a.id}`, kind: 'proposal', group: 'week', title: capitalize(a.summary), when: 'wartet auf dein Ja', at: null, recurrence: null, enabled: true, controls: [{ type: 'decision' }] });
  }

  // Lerneinheiten und Planblöcke der nächsten 7 Tage
  const blocks = db.prepare(`SELECT id FROM items WHERE user_id = ? AND deleted = 0 AND status = 'open' AND recurrence IS NULL AND (kind = 'study' OR source = 'plan')
    AND due >= ? AND due <= ? ORDER BY due, time LIMIT 20`).all(user.id, today, addDays(today, 7)) as { id: string }[];
  const blockIds = new Set(blocks.map((b) => b.id));
  for (const { id } of blocks) {
    const item = getItem(user.id, id)!;
    const at = `${item.due} ${item.time ?? '09:00'}`;
    week.push({
      id: `study:${id}`, kind: 'study', group: 'week', title: item.detail && item.kind === 'study' ? `${item.title} – ${item.detail}` : item.title,
      when: whenLabel(item.due!, item.time, today), at, recurrence: null, enabled: true,
      controls: [timeControl(item.time ?? '09:00', 'Beginn'), { type: 'remove', label: 'Entfernen' }],
    });
  }

  // Erinnerungen der nächsten 7 Tage (je Eintrag die nächste)
  const reminders = db.prepare(`SELECT r.item_id AS id, MIN(r.fire_at) AS fire_at FROM reminders r JOIN items i ON i.id = r.item_id
    WHERE r.user_id = ? AND r.sent_at IS NULL AND r.fire_at > ? AND r.fire_at <= ? AND i.deleted = 0 AND i.status = 'open' AND i.recurrence IS NULL
    GROUP BY r.item_id ORDER BY fire_at LIMIT 12`).all(user.id, new Date().toISOString(), horizon) as { id: string; fire_at: string }[];
  for (const r of reminders) {
    if (blockIds.has(r.id)) continue;
    const item = getItem(user.id, r.id);
    if (!item) continue;
    const at = localParts(r.fire_at, tz);
    const own = item.kind === 'reminder';
    week.push({
      id: `item:${item.id}`, kind: 'reminder', group: 'week', title: item.title, when: whenLabel(at.date, at.time, today), at: `${at.date} ${at.time}`, recurrence: null, enabled: true,
      controls: own ? [timeControl(item.time ?? at.time), { type: 'remove', label: 'Löschen' }] : [{ type: 'link', target: 'planner', label: 'Im Planer ansehen' }],
    });
  }
  week.sort((a, b) => (a.at ?? '9999').localeCompare(b.at ?? '9999') || a.title.localeCompare(b.title));

  // Regelmäßig: Briefing, Wochenplan, Automatiken
  const lb = buildLagebild(user, 3);
  const bt = briefingTime(user, lb);
  regular.push({
    id: 'briefing', kind: 'briefing', group: 'regular', title: 'Morning Briefing',
    when: bt ? `täglich um ${bt}${(user.settings.briefing ?? 'auto') === 'auto' ? ' (automatisch)' : ''}` : 'ausgeschaltet',
    at: bt ? `${bt > now ? today : addDays(today, 1)} ${bt}` : null, recurrence: 'daily', enabled: bt !== null,
    controls: [toggle(bt !== null, 'An'), timeControl(bt ?? '07:00', 'Uhrzeit')],
  });
  if (hasFeature(user, 'planner')) {
    const on = (user.settings.weekPlan ?? 'sunday') !== 'off';
    const daysToSunday = (7 - weekdayOf(today)) % 7;
    const sunday = daysToSunday === 0 && now >= '18:00' ? addDays(today, 7) : addDays(today, daysToSunday);
    regular.push({
      id: 'weekplan', kind: 'weekplan', group: 'regular', title: 'Wochenplan vorschlagen', when: on ? 'sonntags am Abend – du sagst Ja oder Nein' : 'ausgeschaltet',
      at: on ? `${sunday} 18:00` : null, recurrence: 'weekly:7', enabled: on, controls: [toggle(on, 'An')],
    });
  }
  const automatic = (key: Extract<PlanSettingKey, `perm:${string}`>, title: string, when: string) => {
    const level = levelFor(user, key.slice(5) as keyof typeof GROUPS);
    regular.push({ id: key, kind: 'automation', group: 'regular', title, when: level === 'never' ? 'ausgeschaltet' : when, at: null, recurrence: null, enabled: level !== 'never', controls: [toggle(level !== 'never', 'An'), permLink] });
  };
  if (hasFeature(user, 'mails')) automatic('perm:mail_sort', 'Werbung automatisch löschen', 'laufend – in der Inbox zurückholbar');
  if (isSchool(user) && hasFeature(user, 'homework')) automatic('perm:homework', 'HÜ-Autopilot', 'sobald ein Foto oder Buch da ist');
  automatic('perm:memory', 'Nächtliches Lernen', 'nachts zwischen 2 und 5 Uhr');

  // Daueraufträge
  for (const { id } of db.prepare(`SELECT id FROM items WHERE user_id = ? AND deleted = 0 AND recurrence IS NOT NULL ORDER BY due, time`).all(user.id) as { id: string }[]) {
    const item = getItem(user.id, id)!;
    const paused = !!item.recurrencePaused;
    const time = item.time ?? '09:00';
    regular.push({
      id: `recurring:${id}`, kind: 'recurring', group: 'regular', title: item.title, when: `${describeRecurrence(item.recurrence!)} um ${time}${paused ? ' – pausiert' : ''}`,
      at: paused || !item.due ? null : `${item.due} ${time}`, recurrence: item.recurrence!, enabled: !paused,
      controls: [toggle(!paused, 'Aktiv'), timeControl(time), { type: 'remove', label: 'Löschen' }],
    });
  }

  // Langfristig: Ziele und ihre Check-ins
  for (const g of hasFeature(user, 'goals') ? listGoals(user, false) : []) {
    const at = g.checkIn ? nextCheckIn(g.checkIn, today, now) : null;
    longterm.push({
      id: `goal:${g.id}`, kind: 'goal', group: 'longterm', title: g.title,
      when: `${g.status === 'active' ? '' : 'pausiert · '}${g.cadence === 'daily' ? 'täglich' : /^weekly:(\d+)$/.test(g.cadence) ? `${g.cadence.slice(7)}× pro Woche` : `${g.target} ${g.unit} pro Woche`}${g.checkIn ? ` · Erinnerung ${g.checkIn}` : ''}`,
      at: g.status === 'active' ? at : null, recurrence: null, enabled: g.status === 'active',
      controls: [toggle(g.status === 'active', 'Aktiv'), timeControl(g.checkIn?.slice(-5) ?? '18:00', 'Erinnerung'), { type: 'link', target: 'goals', label: 'Zu den Zielen' }],
    });
  }

  const entries = [...week, ...regular, ...longterm];
  const horizonStamp = `${addDays(today, 7)} ${now}`;
  const soon = entries.filter((e) => e.enabled && e.kind !== 'proposal' && e.at && e.at > nowStamp && e.at <= horizonStamp)
    .sort((a, b) => a.at!.localeCompare(b.at!)).slice(0, 3);
  return { entries, soon };
}

export interface PlanChange { on?: boolean; time?: string; remove?: boolean }

/** Eine Änderung aus „Was Stella vorhat“ umsetzen und als Aktion ins Protokoll schreiben (Rückgängig geht) */
export function changePlanEntry(user: User, id: string, change: PlanChange): { actionId: string } {
  if (change.time !== undefined && !HHMM.test(change.time)) throw new HttpError(400, 'Die Uhrzeit muss HH:MM sein.');
  if (change.on === undefined && change.time === undefined && !change.remove) throw new HttpError(400, 'Es gibt nichts zu ändern.');
  const [type, ref = ''] = [id.split(':')[0]!, id.slice(id.indexOf(':') + 1)];

  const setting = (key: PlanSettingKey, value: string) => {
    const prev = applyPlanSetting(user.id, key, value);
    return { actionId: record(user, 'plan.setting', { key, value }, { key, prev }) };
  };

  switch (type) {
    case 'briefing':
      if (change.time !== undefined) return setting('briefing', change.time);
      return setting('briefing', change.on ? 'auto' : 'off');
    case 'weekplan':
      return setting('weekPlan', change.on ? 'sunday' : 'off');
    case 'perm': {
      if (!isGroup(ref) || !['homework', 'mail_sort', 'memory'].includes(ref)) throw new HttpError(404, 'Unbekannt');
      const current = planSettingValue(user, `perm:${ref}` as PlanSettingKey);
      return setting(`perm:${ref}` as PlanSettingKey, change.on ? (current === 'never' ? GROUPS[ref].default : current) : 'never');
    }
    case 'recurring':
    case 'item':
    case 'study': {
      const before = getItem(user.id, ref);
      if (!before || before.deleted || (type === 'recurring') !== !!before.recurrence) throw new HttpError(404, 'Nicht gefunden');
      if (change.remove) {
        changeItem(user, ref, { deleted: true });
        return { actionId: record(user, 'item.delete', { id: ref }, { id: ref }) };
      }
      const patch: { time?: string; recurrencePaused?: boolean } = {};
      if (change.time !== undefined) patch.time = change.time;
      if (change.on !== undefined && type === 'recurring') patch.recurrencePaused = !change.on;
      const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, k === 'recurrencePaused' ? !!before.recurrencePaused : before.time]));
      changeItem(user, ref, patch);
      return { actionId: record(user, 'item.update', { id: ref, patch }, { id: ref, prev }) };
    }
    case 'goal': {
      const goal = getGoal(user.id, ref);
      if (!goal) throw new HttpError(404, 'Nicht gefunden');
      const patch: { status?: 'active' | 'paused'; checkIn?: string } = {};
      if (change.on !== undefined) patch.status = change.on ? 'active' : 'paused';
      // Wochentag der Erinnerung („So 18:00“) bleibt, nur die Uhrzeit ändert sich
      if (change.time !== undefined) patch.checkIn = `${/^[A-Z][a-z] /.test(goal.checkIn ?? '') ? `${goal.checkIn!.slice(0, 2)} ` : ''}${change.time}`;
      const prev = { status: goal.status, checkIn: goal.checkIn };
      updateGoal(user.id, ref, patch);
      return { actionId: record(user, 'goal.update', { id: ref, patch }, { id: ref, prev }) };
    }
    default:
      throw new HttpError(404, 'Unbekannt');
  }
}

export function registerStellaPlanRoutes(api: FastifyInstance) {
  api.get('/api/stella/plan', async (req) => buildStellaPlan(req.user));

  api.post('/api/stella/plan/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { actionId } = changePlanEntry(req.user, req.params.id, {
      on: typeof b.on === 'boolean' ? b.on : undefined,
      time: typeof b.time === 'string' ? b.time : undefined,
      remove: b.remove === true,
    });
    // der Nutzer hat sich gerade geändert (Einstellungen) – frisch laden, sonst zeigt die Liste den alten Stand
    return { ok: true, actionId, ...buildStellaPlan(getUser(req.user.id) ?? req.user) };
  });
}
