// Morning Briefing: ein kurzer Überblick über den Tag – Schule (mit Entfall), was heute fällig ist,
// Lernblöcke, Routinen, was Stella über Nacht erledigt hat, wichtige Nachrichten und alles, was ihr
// aufgefallen ist. Kommt als Chat-Nachricht + Push und als Karte oben auf „Heute“.
//
// Zeit (Einstellungen): "auto" = 45 Minuten vor der ersten Stunde (sonst 7:00, am Wochenende 9:30),
// "HH:MM" = feste Zeit, "off" = aus. Ohne KI gebaut – kommt also immer.

import { timeIn, voice, WEEKDAYS_DE, weekdayOf, type Briefing, type BriefingSection } from '@stella/shared';
import { buildLagebild, isoWeekday, toHhmm, toMin, type Lagebild } from './context.ts';
import { addMessage, db, getUser, notifyOnce, type User } from './db.ts';
import { deliverHint, findHints, isDelivered } from './hints.ts';
import { pushToUser } from './push.ts';

const LEAD_MINUTES = 45;

/** wann das Briefing heute kommt (HH:MM) oder null, wenn aus */
export function briefingTime(user: User, lb: Lagebild): string | null {
  const setting = user.settings.briefing ?? 'auto';
  if (setting === 'off') return null;
  if (/^\d{2}:\d{2}$/.test(setting)) return setting;
  const weekend = isoWeekday(lb.today) >= 6;
  const first = lb.days[0]!.lessons.filter((l) => l.status !== 'cancelled')[0];
  if (first) return toHhmm(Math.max(toMin('06:00'), toMin(first.start) - LEAD_MINUTES));
  return weekend ? '09:30' : '07:00';
}

export function buildBriefing(user: User, lb: Lagebild = buildLagebild(user, 3)): Briefing {
  const v = voice(user.settings.tone);
  const today = lb.days[0]!;
  const tomorrow = lb.days[1];
  const sections: BriefingSection[] = [];

  // Schule
  const lessons = today.lessons;
  if (lessons.length) {
    const held = lessons.filter((l) => l.status !== 'cancelled');
    const lines = held.length ? [`${held[0]!.start}–${held.at(-1)!.end} · ${held.length} Stunden`] : ['Alle Stunden entfallen 🎉'];
    for (const l of lessons.filter((x) => x.status === 'cancelled')) lines.push(`${l.subject ?? l.code} (${l.start}) entfällt`);
    for (const l of lessons.filter((x) => x.status === 'irregular' && x.info)) lines.push(`${l.subject ?? l.code}: ${l.info}`);
    sections.push({ id: 'school', title: 'Schule', lines });
  }

  // Heute fällig (Tests zuerst)
  const due = today.items.filter((i) => i.status === 'open' && i.kind !== 'study')
    .sort((a, b) => (a.kind === 'exam' ? -1 : b.kind === 'exam' ? 1 : (a.time ?? '99').localeCompare(b.time ?? '99')));
  if (due.length) {
    sections.push({
      id: 'due', title: 'Heute',
      lines: due.map((i) => `${i.kind === 'exam' ? '🍀 ' : ''}${i.title}${i.time ? ` · ${i.time}` : ''}${i.detail ? ` – ${i.detail}` : ''}`),
    });
  }

  // Lernblöcke und Routinen heute
  const plan: string[] = [];
  for (const s of today.items.filter((i) => i.kind === 'study' && i.status === 'open')) plan.push(`${s.time ?? ''} ${s.detail ?? s.title}`.trim());
  for (const m of lb.memories.filter((x) => x.schedule?.days.includes(isoWeekday(lb.today)))) plan.push(`${m.schedule!.start} ${m.text}`);
  if (plan.length) sections.push({ id: 'plan', title: 'Eingeplant', lines: plan.sort() });

  // Morgen fällig – mit Stand
  if (tomorrow) {
    const next = tomorrow.items.filter((i) => i.status !== 'cancelled' && ['homework', 'assignment', 'exam'].includes(i.kind));
    if (next.length) {
      sections.push({
        id: 'tomorrow', title: 'Morgen fällig',
        lines: next.map((i) => `${i.title}${i.detail ? ` (${i.detail})` : ''} – ${i.status === 'done' ? (i.attachments.some((a) => a.caption?.startsWith('Lösung')) ? 'im Heft ✓' : 'erledigt ✓') : 'offen'}`),
      });
    }
  }

  // Was Stella seit gestern Abend erledigt hat
  const since = new Date(Date.now() - 14 * 3600_000).toISOString();
  const done = (db.prepare(`SELECT summary FROM actions WHERE user_id = ? AND source = 'auto' AND status = 'done' AND created_at > ?
    AND type != 'memory.add' ORDER BY created_at`).all(user.id, since) as { summary: string }[]).map((r) => r.summary);
  const solvedCount = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND kind = 'homework' AND status = 'done'
    AND updated_at > ? AND attachments LIKE '%Lösung%'`).get(user.id, since) as { n: number }).n;
  const trashed = (db.prepare(`SELECT COUNT(*) AS n FROM inbox_events WHERE user_id = ? AND created_at > ? AND json_extract(payload, '$.action') = 'trash'`)
    .get(user.id, since) as { n: number }).n;
  const doneLines = [...done.map((d) => d.charAt(0).toUpperCase() + d.slice(1))];
  if (solvedCount) doneLines.push(`${solvedCount} ${solvedCount === 1 ? 'HÜ' : 'HÜs'} gelöst und ins Heft geschrieben`);
  if (trashed) doneLines.push(`${trashed} Werbemails in den Papierkorb`);
  if (doneLines.length) sections.push({ id: 'done', title: 'Hab ich schon erledigt', lines: doneLines.slice(0, 5) });

  // Wichtige Nachrichten
  if (lb.importantInbox.length) {
    sections.push({
      id: 'inbox', title: 'Wichtige Nachrichten',
      lines: lb.importantInbox.slice(0, 3).map((m) => `${m.sender ?? m.source}: ${m.summary}`),
    });
  }

  const hints = findHints(user, buildLagebild(user, 8)).map(({ action: _a, pending: _p, ...h }) => h);
  const weekday = WEEKDAYS_DE[weekdayOf(lb.today)]!;
  const greeting = v.briefingGreeting(user.name.split(' ')[0]!, weekday);
  const busy = sections.some((s) => ['due', 'tomorrow', 'plan'].includes(s.id)) || hints.length > 0;
  const closing = v.briefingClosing(busy);
  const body = sectionsText(sections);
  if (hints.length) body.push(`**Mir ist aufgefallen**\n${hints.map((h) => `• ${h.text}`).join('\n')}`);
  const text = [greeting, ...(body.length ? body : [v.briefingQuiet()]), closing].join('\n\n');
  const time = briefingTime(user, lb);
  return { date: lb.today, greeting, sections, hints, closing, text, time, sent: isSent(user.id, lb.today) };
}

const isSent = (userId: string, date: string) => !!(db.prepare('SELECT 1 FROM notified WHERE user_id = ? AND key = ?').get(userId, `briefing:${date}`));

/** Läuft im Scheduler: zur Briefing-Zeit einmal am Tag zustellen (nicht mehr nach Mittag nachholen). */
export async function maybeSendBriefing(userId: string): Promise<boolean> {
  const user = getUser(userId);
  if (!user) return false;
  const lb = buildLagebild(user, 3);
  const time = briefingTime(user, lb);
  const nowHhmm = timeIn(user.timeZone);
  if (!time || nowHhmm < time || nowHhmm >= '12:00') return false;
  if (!notifyOnce(userId, `briefing:${lb.today}`)) return false;

  const b = buildBriefing(user, lb);
  // Die Hinweise kommen gleich danach als eigene Nachrichten – mit Vorschlag als Karte (Ja/Nein)
  const pending = findHints(user, buildLagebild(user, 8)).filter((h) => !isDelivered(userId, h.key));
  addMessage(userId, 'assistant', [b.greeting, ...(b.sections.length ? sectionsText(b.sections) : [voice(user.settings.tone).briefingQuiet()]),
    pending.length ? `Dazu ${pending.length === 1 ? 'eine Sache, die mir aufgefallen ist' : `${pending.length} Sachen, die mir aufgefallen sind`}:` : b.closing,
  ].join('\n\n'));
  for (const h of pending) await deliverHint(user, h, false);
  const summary = b.sections.flatMap((s) => s.lines).slice(0, 3).join(' · ') || 'Heute steht nichts Besonderes an.';
  await pushToUser(userId, { title: b.greeting.replace(/:$/, ''), body: summary, tag: `briefing-${lb.today}` });
  return true;
}

const sectionsText = (sections: BriefingSection[]) => sections.map((s) => `**${s.title}**\n${s.lines.map((l) => `• ${l}`).join('\n')}`);

/** „Briefing“ / „was steht heute an?“ im Chat */
export function briefingText(user: User): string {
  return buildBriefing(user).text;
}
