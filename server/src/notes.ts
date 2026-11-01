// Verbindung zu FreeNotes (iPad-Heft-App): Gelöste HÜs warten hier, bis FreeNotes sie abholt
// und Strich für Strich in deiner Handschrift ins passende Fach-Heft schreibt.

import { addDays, t, todayIn } from '@stella/shared';
import { db, getUser, notifyOnce, now } from './db.ts';
import { config } from './config.ts';
import { userLocale } from './locale.ts';
import { pushToUser } from './push.ts';
import { mailerConfigured, sendTemplateMail } from './mailer.ts';

export interface NotesEntry {
  id: string;
  subject: string | null;
  title: string;
  page: string | null;
  exercises: string | null;
  due: string | null;
  /** Heft-Text: __unterstrichen__, ==doppelt unterstrichen== */
  text: string;
  created: string;
}

export function usesFreeNotes(userId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM notified WHERE user_id = ? AND key = 'freenotes-connected'`).get(userId);
}

export function notesInbox(userId: string): NotesEntry[] {
  notifyOnce(userId, 'freenotes-connected');
  const user = getUser(userId)!;
  const from = addDays(todayIn(user.timeZone), -14);
  return db.prepare(`SELECT i.id, i.subject, i.title, i.page, i.exercises, i.due, i.notes AS text, i.updated_at AS created
      FROM items i LEFT JOIN notes_deliveries d ON d.item_id = i.id
      WHERE i.user_id = ? AND i.deleted = 0 AND i.kind = 'homework' AND i.status = 'done' AND i.notes IS NOT NULL
        AND i.attachments LIKE '%"caption":"Lösung%' AND (i.due IS NULL OR i.due >= ?) AND d.item_id IS NULL
      ORDER BY i.due, i.updated_at`).all(userId, from) as NotesEntry[];
}

export function ackNotesEntry(userId: string, itemId: string, notebook: string | null, page: number | null): boolean {
  const owned = db.prepare('SELECT 1 FROM items WHERE user_id = ? AND id = ?').get(userId, itemId);
  if (!owned) return false;
  db.prepare('INSERT OR REPLACE INTO notes_deliveries (user_id, item_id, delivered_at, notebook, page) VALUES (?, ?, ?, ?, ?)')
    .run(userId, itemId, now(), notebook, page);
  return true;
}

/** Wer in der Einführung „Benachrichtige mich“ gewählt hat (und noch keine Nachricht bekam) */
export function freenotesWaitlist(): string[] {
  const rows = db.prepare(`SELECT id, settings FROM users`).all() as { id: string; settings: string }[];
  return rows.filter((r) => { try { return !!JSON.parse(r.settings).notify?.freenotes; } catch { return false; } }).map((r) => r.id)
    .filter((id) => !db.prepare(`SELECT 1 FROM notified WHERE user_id = ? AND key = 'freenotes-launch'`).get(id));
}

/**
 * FreeNotes ist da: Push und Mail an alle auf der Warteliste, jede Person genau einmal.
 * Braucht `STELLA_FREENOTES_URL`. Der Owner löst das im Dashboard aus (POST /api/admin/freenotes/announce).
 */
export async function announceFreenotes(): Promise<{ notified: number; failed: number }> {
  if (!config.freenotesUrl) throw new Error('STELLA_FREENOTES_URL ist nicht gesetzt.');
  let notified = 0, failed = 0;
  for (const id of freenotesWaitlist()) {
    const user = getUser(id);
    if (!user) continue;
    const locale = userLocale(user);
    try {
      await pushToUser(id, { title: 'FreeNotes', body: t(locale, 'email.freenotes.title'), url: config.freenotesUrl, tag: 'freenotes-launch' }).catch(() => {});
      if (mailerConfigured()) await sendTemplateMail(user.email, locale, 'freenotes-launch', { name: user.name.split(' ')[0], appUrl: config.freenotesUrl }, 'stella', { userId: id });
      notifyOnce(id, 'freenotes-launch');
      notified++;
    } catch { failed++; }
  }
  return { notified, failed };
}
