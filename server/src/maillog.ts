// Protokoll aller Mails, die Stella verschickt oder bekommt – nur Zahlen für das Firmen-Dashboard,
// nie Inhalt und nie die volle Adresse (nur die Domain des Empfängers).

import { db, newId, now } from './db.ts';

export type MailPurpose = 'verification' | 'address_verification' | 'stella_reply' | 'unknown_sender_notice' | 'system';

export function logMail(direction: 'out' | 'in', purpose: string, status: 'ok' | 'failed', opts: { to?: string; userId?: string | null; detail?: string } = {}) {
  const domain = opts.to?.split('@')[1]?.toLowerCase().slice(0, 100) ?? null;
  db.prepare('INSERT INTO mail_log (id, at, direction, purpose, status, user_id, domain, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), now(), direction, purpose, status, opts.userId ?? null, domain, opts.detail?.slice(0, 200) ?? null);
}
