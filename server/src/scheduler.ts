// Läuft rund um die Uhr auf dem VPS: verschickt Erinnerungen und arbeitet Hintergrund-Jobs ab
// (z. B. digi4school-Seiten holen). Deshalb funktioniert Stella auch, wenn dein Handy offline ist –
// sobald es wieder Netz hat, sind die Nachrichten im Chat und die Push-Mitteilung kommt an.

import { todayIn } from '@stella/shared';
import { hasSecret } from './auth.ts';
import { addMessage, allUserIds, db, getItem, getUser, notifyOnce, now } from './db.ts';
import { nightlyLearning } from './learning.ts';
import { maybeSendBriefing } from './briefing.ts';
import { deliverHints } from './hints.ts';
import { maybeOfferWeek, replanMissed } from './weekplan.ts';
import { titleOldChats } from './conversations.ts';
import { checkAllMail, listAccounts, purgeMailBodies, sendMail } from './mail.ts';
import { syncUntis } from './untis.ts';
import { fetchBookPage } from './books.ts';
import { solveHomework } from './homework.ts';
import { sendGoalCheckIns } from './goals.ts';
import { pushToUser } from './push.ts';

type ReminderRow = { id: string; user_id: string; item_id: string | null; message: string; with_attachments: number; always: number };
type JobRow = { id: string; user_id: string; type: string; payload: string; attempts: number };

const JOB_HANDLERS: Record<string, (userId: string, payload: any) => Promise<void>> = {
  book_page: (userId, p) => fetchBookPage(userId, p.itemId, p.pageDelta ?? 0, p.thenSolveAttempt ?? 0),
  digi4school_page: (userId, p) => fetchBookPage(userId, p.itemId),
  solve_homework: (userId, p) => solveHomework(userId, p.itemId, p.attempt ?? 0),
  send_mail: async (userId, p) => {
    await sendMail(userId, p);
    addMessage(userId, 'assistant', `✉️ Gesendet an ${p.to}: „${p.subject}“`);
  },
};

export async function sendDueReminders() {
  const ts = now();
  const due = db.prepare(`SELECT r.* FROM reminders r LEFT JOIN items i ON i.id = r.item_id
      WHERE r.sent_at IS NULL AND r.fire_at <= ?
        AND (i.id IS NULL OR (i.deleted = 0 AND (i.status = 'open' OR r.always = 1)))`)
    .all(ts) as ReminderRow[];
  for (const r of due) {
    db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').run(now(), r.id);
    const item = r.item_id ? getItem(r.user_id, r.item_id) : null;
    const attachments = r.with_attachments && item ? item.attachments : [];
    let text = r.message;
    if (item?.kind === 'homework' && !r.always) text += '\nSchreib mir „erledigt“, wenn du fertig bist. 😉';
    // Erledigung mit Ort: eine Karte „Läden in der Nähe“ – der Standort wird erst beim Öffnen und nur einmal abgefragt
    const card = item?.place ? { type: 'places' as const, category: item.place.category, label: item.place.label, itemId: item.id } : undefined;
    addMessage(r.user_id, 'assistant', text, { attachments, card });
    await pushToUser(r.user_id, { title: 'Stella', body: r.message, url: '/', tag: r.item_id ?? r.id });
  }
  // Erinnerungen zu erledigten Einträgen still verwerfen
  db.prepare(`UPDATE reminders SET sent_at = ? WHERE sent_at IS NULL AND fire_at <= ?`).run(ts, ts);
}

async function runJobs() {
  const jobs = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 3`).all(now()) as JobRow[];
  for (const job of jobs) {
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?`).run(job.id);
    try {
      const handler = JOB_HANDLERS[job.type];
      if (!handler) throw new Error(`Unbekannter Job-Typ ${job.type}`);
      await handler(job.user_id, JSON.parse(job.payload));
      db.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(job.id);
    } catch (err) {
      const message = (err as Error).message;
      const retry = job.attempts + 1 < 3;
      db.prepare(`UPDATE jobs SET status = ?, last_error = ?, run_at = ? WHERE id = ?`)
        .run(retry ? 'queued' : 'failed', message, new Date(Date.now() + 10 * 60_000 * (job.attempts + 1)).toISOString(), job.id);
      console.warn(`Job ${job.type} fehlgeschlagen (Versuch ${job.attempts + 1}):`, message);
      if (!retry && getUser(job.user_id)) {
        addMessage(job.user_id, 'assistant', `⚠️ Ich konnte eine Aufgabe nicht erledigen (${job.type}): ${message}`);
      }
    }
  }
}

// Regelmäßige Abgleiche pro Nutzer (Postfächer, WebUntis)
const lastRun = new Map<string, number>();
async function every(key: string, ms: number, fn: () => Promise<void>) {
  if (Date.now() - (lastRun.get(key) ?? 0) < ms) return;
  lastRun.set(key, Date.now());
  await fn();
}

async function periodic() {
  await every('mail-bodies', 6 * 3600_000, async () => { purgeMailBodies(); }).catch((err) => console.warn('Mail-Cache:', err.message));
  for (const userId of allUserIds()) {
    if (listAccounts(userId).length) {
      await every(`mail:${userId}`, 5 * 60_000, () => checkAllMail(userId)).catch((err) => console.warn('Mail:', err.message));
    }
    await every(`titles:${userId}`, 30 * 60_000, () => titleOldChats(userId)).catch((err) => console.warn('Chat-Titel:', err.message));
    await every(`learn:${userId}`, 30 * 60_000, () => nightlyLearning(userId)).catch((err) => console.warn('Lernen:', err.message));
    await every(`briefing:${userId}`, 2 * 60_000, async () => { await maybeSendBriefing(userId); }).catch((err) => console.warn('Briefing:', err.message));
    await every(`hints:${userId}`, 10 * 60_000, () => deliverHints(userId)).catch((err) => console.warn('Hinweise:', err.message));
    await every(`goals:${userId}`, 2 * 60_000, () => sendGoalCheckIns(userId)).catch((err) => console.warn('Ziele:', err.message));
    await every(`replan:${userId}`, 30 * 60_000, async () => { replanMissed(userId); }).catch((err) => console.warn('Neu planen:', err.message));
    await every(`weekplan:${userId}`, 10 * 60_000, () => maybeOfferWeek(userId)).catch((err) => console.warn('Wochenplan:', err.message));
    if (hasSecret(userId, 'webuntis')) {
      await every(`untis:${userId}`, 2 * 3600_000, () => syncUntis(userId)).catch((err) => {
        console.warn('WebUntis:', err.message);
        const user = getUser(userId);
        if (user && notifyOnce(userId, `untis-error-${todayIn(user.timeZone)}`)) {
          addMessage(userId, 'assistant', `⚠️ WebUntis-Abgleich klappt gerade nicht: ${err.message}`);
        }
      });
    }
  }
}

let busy = false;
let periodicBusy = false;
export function startScheduler() {
  // Jobs, die beim letzten Neustart mittendrin waren, nochmal einreihen
  db.prepare(`UPDATE jobs SET status = 'queued' WHERE status = 'running'`).run();
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await sendDueReminders();
      await runJobs();
    } catch (err) {
      console.error('Scheduler-Fehler:', err);
    } finally {
      busy = false;
    }
  };
  // Postfächer & WebUntis getrennt, damit langsame Server keine Erinnerung verzögern
  const slowTick = async () => {
    if (periodicBusy) return;
    periodicBusy = true;
    try {
      await periodic();
    } finally {
      periodicBusy = false;
    }
  };
  setInterval(tick, 30_000);
  setInterval(slowTick, 60_000);
  void tick();
  void slowTick();
}
