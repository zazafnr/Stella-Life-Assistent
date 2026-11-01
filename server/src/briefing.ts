// Morning Briefing: ein kurzer Überblick über den Tag – Schule (mit Entfall), was heute fällig ist,
// Lernblöcke, Routinen, was Stella über Nacht erledigt hat, wichtige Nachrichten und alles, was ihr
// aufgefallen ist. Kommt als Chat-Nachricht + Push und als Karte oben auf „Heute“.
//
// Zeit (Einstellungen): "auto" = 45 Minuten vor der ersten Stunde (sonst 7:00, am Wochenende 9:30),
// "HH:MM" = feste Zeit, "off" = aus. Ohne KI gebaut – kommt also immer.

import { timeIn, weekdayName, weekdayOf, type Briefing, type BriefingSection } from '@stella/shared';
import { buildLagebild, isoWeekday, toHhmm, toMin, type Lagebild } from './context.ts';
import { addMessage, db, getUser, notifyOnce, type User } from './db.ts';
import { goalBriefingLines } from './goals.ts';
import { deliverHint, findHints, isDelivered } from './hints.ts';
import { notify } from './channels/deliver.ts';
import { tr, userLocale, voiceOf } from './locale.ts';
import { warmWeather, weatherLine } from './weather.ts';
import { buildDigest, digestOf } from './news/digest.ts';

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
  const v = voiceOf(user);
  const today = lb.days[0]!;
  const tomorrow = lb.days[1];
  const sections: BriefingSection[] = [];

  // Wetter (aus dem Zwischenspeicher; maybeSendBriefing und die Route holen es vorher)
  const weather = weatherLine(user);
  if (weather) sections.push({ id: 'weather', title: tr(user, 'briefing.section.weather'), lines: [weather] });

  // News: aus dem Zwischenspeicher (maybeSendBriefing und die Route bauen sie vorher)
  const news = digestOf(user);
  if (news.length) {
    const hhmm = (iso: string) => new Intl.DateTimeFormat('de-AT', { timeZone: user.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    sections.push({ id: 'news', title: tr(user, 'briefing.section.news'), lines: news.map((n) => `${n.sentence} ([${n.source}](${n.url}), ${hhmm(n.publishedAt)})`) });
  }

  // Schule
  const lessons = today.lessons;
  if (lessons.length) {
    const held = lessons.filter((l) => l.status !== 'cancelled');
    const lines = held.length ? [`${held[0]!.start}–${held.at(-1)!.end} · ${tr(user, 'briefing.lessons', { count: held.length })}`] : [tr(user, 'briefing.allCancelled')];
    for (const l of lessons.filter((x) => x.status === 'cancelled')) lines.push(tr(user, 'briefing.cancelled', { subject: String(l.subject ?? l.code), start: l.start }));
    for (const l of lessons.filter((x) => x.status === 'irregular' && x.info)) lines.push(`${l.subject ?? l.code}: ${l.info}`);
    sections.push({ id: 'school', title: tr(user, 'briefing.section.school'), lines });
  }

  // Heute fällig (Tests zuerst)
  const due = today.items.filter((i) => i.status === 'open' && i.kind !== 'study')
    .sort((a, b) => (a.kind === 'exam' ? -1 : b.kind === 'exam' ? 1 : (a.time ?? '99').localeCompare(b.time ?? '99')));
  if (due.length) {
    sections.push({
      id: 'due', title: tr(user, 'briefing.section.today'),
      lines: due.map((i) => `${i.kind === 'exam' ? '🍀 ' : ''}${i.title}${i.time ? ` · ${i.time}` : ''}${i.detail ? ` – ${i.detail}` : ''}`),
    });
  }

  // Lernblöcke und Routinen heute
  const plan: string[] = [];
  for (const s of today.items.filter((i) => i.kind === 'study' && i.status === 'open')) plan.push(`${s.time ?? ''} ${s.detail ?? s.title}`.trim());
  for (const m of lb.memories.filter((x) => x.schedule?.days.includes(isoWeekday(lb.today)))) plan.push(`${m.schedule!.start} ${m.text}`);
  if (plan.length) sections.push({ id: 'plan', title: tr(user, 'briefing.section.plan'), lines: plan.sort() });

  // Morgen fällig – mit Stand
  if (tomorrow) {
    const next = tomorrow.items.filter((i) => i.status !== 'cancelled' && ['homework', 'assignment', 'exam'].includes(i.kind));
    if (next.length) {
      sections.push({
        id: 'tomorrow', title: tr(user, 'briefing.section.tomorrow'),
        lines: next.map((i) => `${i.title}${i.detail ? ` (${i.detail})` : ''} – ${i.status === 'done' ? (i.attachments.some((a) => a.caption?.startsWith('Lösung')) ? tr(user, 'briefing.inNotebook') : tr(user, 'briefing.doneMark')) : tr(user, 'briefing.open')}`),
      });
    }
  }

  // Sonntags: Rückblick auf die Wochenziele
  const goalLines = goalBriefingLines(user, lb.today);
  if (goalLines.length) sections.push({ id: 'goals', title: tr(user, 'briefing.section.goals'), lines: goalLines });

  // Was Stella seit gestern Abend erledigt hat
  const since = new Date(Date.now() - 14 * 3600_000).toISOString();
  const done = (db.prepare(`SELECT summary FROM actions WHERE user_id = ? AND source = 'auto' AND status = 'done' AND created_at > ?
    AND type != 'memory.add' ORDER BY created_at`).all(user.id, since) as { summary: string }[]).map((r) => r.summary);
  const solvedCount = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND kind = 'homework' AND status = 'done'
    AND updated_at > ? AND attachments LIKE '%Lösung%'`).get(user.id, since) as { n: number }).n;
  const trashed = (db.prepare(`SELECT COUNT(*) AS n FROM inbox_events WHERE user_id = ? AND created_at > ? AND json_extract(payload, '$.action') = 'trash'`)
    .get(user.id, since) as { n: number }).n;
  const doneLines = [...done.map((d) => d.charAt(0).toUpperCase() + d.slice(1))];
  if (solvedCount) doneLines.push(tr(user, 'briefing.solved', { count: solvedCount }));
  if (trashed) doneLines.push(tr(user, 'briefing.trashed', { count: trashed }));
  if (doneLines.length) sections.push({ id: 'done', title: tr(user, 'briefing.section.done'), lines: doneLines.slice(0, 5) });

  // Wichtige Nachrichten
  if (lb.importantInbox.length) {
    sections.push({
      id: 'inbox', title: tr(user, 'briefing.section.inbox'),
      lines: lb.importantInbox.slice(0, 3).map((m) => `${m.sender ?? m.source}: ${m.summary}`),
    });
  }

  const hints = findHints(user, buildLagebild(user, 8)).map(({ action: _a, pending: _p, ...h }) => h);
  const weekday = weekdayName(userLocale(user), weekdayOf(lb.today));
  const greeting = v.briefingGreeting(user.name.split(' ')[0]!, weekday);
  const busy = sections.some((s) => ['due', 'tomorrow', 'plan'].includes(s.id)) || hints.length > 0;
  const closing = v.briefingClosing(busy);
  const body = sectionsText(sections);
  if (hints.length) body.push(`**${tr(user, 'briefing.noticed')}**\n${hints.map((h) => `• ${h.text}`).join('\n')}`);
  const text = [greeting, ...(body.length ? body : [v.briefingQuiet()]), closing].join('\n\n');
  const time = briefingTime(user, lb);
  return { date: lb.today, greeting, sections, hints, closing, text, time, sent: isSent(user.id, lb.today), ...(news.length ? { news } : {}) };
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

  await warmWeather(user);
  await buildDigest(user).catch(() => []);
  const b = buildBriefing(user, lb);
  // Die Hinweise kommen gleich danach als eigene Nachrichten – mit Vorschlag als Karte (Ja/Nein)
  const pending = findHints(user, buildLagebild(user, 8)).filter((h) => !isDelivered(userId, h.key));
  const fullText = [b.greeting, ...(b.sections.length ? sectionsText(b.sections) : [voiceOf(user).briefingQuiet()]),
    pending.length ? tr(user, 'briefing.alsoNoticed', { count: pending.length }) : b.closing,
  ].join('\n\n');
  addMessage(userId, 'assistant', fullText);
  for (const h of pending) await deliverHint(user, h, false);
  const summary = b.sections.flatMap((s) => s.lines).slice(0, 3).join(' · ') || tr(user, 'briefing.nothing');
  await notify(userId, { title: b.greeting.replace(/:$/, ''), body: summary, text: fullText, tag: `briefing-${lb.today}` });
  return true;
}

const sectionsText = (sections: BriefingSection[]) => sections.map((s) => `**${s.title}**\n${s.lines.map((l) => `• ${l}`).join('\n')}`);

/** „Briefing“ / „was steht heute an?“ im Chat */
export function briefingText(user: User): string {
  return buildBriefing(user).text;
}
