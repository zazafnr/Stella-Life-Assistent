// Läuft rund um die Uhr auf dem VPS: verschickt Erinnerungen und arbeitet Hintergrund-Jobs ab
// (z. B. digi4school-Seiten holen). Deshalb funktioniert Stella auch, wenn dein Handy offline ist –
// sobald es wieder Netz hat, sind die Nachrichten im Chat und die Push-Mitteilung kommt an.

import { addMessage, db, getItem, getUser, now } from './db.ts';
import { fetchDigi4SchoolPage } from './digi4school.ts';
import { pushToUser } from './push.ts';

type ReminderRow = { id: string; user_id: string; item_id: string | null; message: string; with_attachments: number };
type JobRow = { id: string; user_id: string; type: string; payload: string; attempts: number };

const JOB_HANDLERS: Record<string, (userId: string, payload: any) => Promise<void>> = {
  digi4school_page: (userId, payload) => fetchDigi4SchoolPage(userId, payload.itemId),
};

async function sendDueReminders() {
  const ts = now();
  const due = db.prepare(`SELECT r.* FROM reminders r LEFT JOIN items i ON i.id = r.item_id
      WHERE r.sent_at IS NULL AND r.fire_at <= ? AND (i.id IS NULL OR (i.status = 'open' AND i.deleted = 0))`)
    .all(ts) as ReminderRow[];
  for (const r of due) {
    db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').run(now(), r.id);
    const item = r.item_id ? getItem(r.user_id, r.item_id) : null;
    const attachments = r.with_attachments && item ? item.attachments : [];
    let text = r.message;
    if (item?.kind === 'homework') text += '\nSchreib mir „erledigt“, wenn du fertig bist. 😉';
    addMessage(r.user_id, 'assistant', text, { attachments });
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

let busy = false;
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
  setInterval(tick, 30_000);
  void tick();
}
