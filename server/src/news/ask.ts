// Die Frage am ersten Tag: „Soll ich dir morgens kurz sagen, was in der Welt los ist?“
// Frühestens 3 Stunden nach der Registrierung, nur zwischen 10 und 20 Uhr Ortszeit (sonst am nächsten Tag ab 10 Uhr), für Konten unter 36 Stunden.
// Kommt als Chat-Nachricht mit Karte und als Push bzw. Telegram – auch wenn die App gerade nicht offen ist. Genau einmal.

import { timeIn } from '@stella/shared';
import { notify } from '../channels/deliver.ts';
import { addMessage, db, getUser, notifyOnce } from '../db.ts';
import { tr } from '../locale.ts';
import { newsSettings } from './digest.ts';

export const ASK_MIN_AGE_MS = 3 * 3600_000;
export const ASK_MAX_AGE_MS = 36 * 3600_000;

/** Ist jetzt der Zeitpunkt für die Frage? (rein, ohne Nebenwirkung) */
export function askDue(createdAtMs: number, timeZone: string, nowMs = Date.now()): boolean {
  const age = nowMs - createdAtMs;
  if (age < ASK_MIN_AGE_MS || age > ASK_MAX_AGE_MS) return false;
  const hour = Number(timeIn(timeZone, new Date(nowMs)).slice(0, 2));
  return hour >= 10 && hour < 20;
}

export async function maybeAskNews(userId: string, nowMs = Date.now()): Promise<boolean> {
  const user = getUser(userId);
  if (!user) return false;
  const s = newsSettings(user);
  if (s.asked || s.enabled) return false;
  const row = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as { created_at: string } | undefined;
  if (!row || !askDue(Date.parse(row.created_at), user.timeZone, nowMs)) return false;
  if (!notifyOnce(userId, 'news-ask')) return false;
  const text = tr(user, 'news.ask.text');
  addMessage(userId, 'assistant', text, { card: { type: 'news_ask' } });
  await notify(userId, {
    title: 'Stella', body: text, text, tag: 'news-ask',
    buttons: [{ label: tr(user, 'news.ask.yes'), action: 'n:y' }, { label: tr(user, 'news.ask.no'), action: 'n:n' }],
  });
  return true;
}
