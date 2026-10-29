// E-Mail-Postfächer (Gmail, iCloud, …) über IMAP.
//
// Stella schaut alle paar Minuten nach neuen Mails und sortiert sie:
//   wichtig     → Nachricht im Chat + Push
//   social      → Bereich "Inbox → Social" (Instagram/TikTok/… schicken Benachrichtigungs-Mails)
//   newsletter/spam → Papierkorb (nicht endgültig gelöscht, in der App wiederherstellbar)
//   normal      → bleibt einfach liegen
//
// Gmail geht mit "Mit Google anmelden" (oauth.ts, IMAP über XOAUTH2) oder einem App-Passwort.
// iCloud kennt keine Anmeldung für fremde Apps – dort braucht es ein App-Passwort:
//   Gmail:  myaccount.google.com → Sicherheit → 2-Faktor an → "App-Passwörter"
//   iCloud: account.apple.com → Anmeldung & Sicherheit → "App-spezifische Passwörter"

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getSecret, setSecret } from './auth.ts';
import { addMessage, db, getUser, newId, now } from './db.ts';
import { complete, LlmUnavailable, llmAvailable } from './llm.ts';
import { accessToken } from './oauth.ts';
import { pushToUser } from './push.ts';

export type MailProvider = 'gmail' | 'icloud' | 'other';

export interface MailAccount {
  id: string;
  label: string;
  provider: MailProvider;
  host: string;
  port: number;
  user: string;
  /** App-Passwort; leer bei Google-Anmeldung */
  pass: string;
  /** "Mit Google anmelden": Refresh-Token statt Passwort */
  oauth?: { provider: 'google'; refreshToken: string };
}

export const PRESETS: Record<Exclude<MailProvider, 'other'>, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 },
};

type Category = 'important' | 'normal' | 'social' | 'newsletter' | 'spam';

interface NewMail {
  uid: number;
  messageId: string | null;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  snippet: string;
  hasUnsubscribe: boolean;
}

const SOCIAL_DOMAINS: [RegExp, string][] = [
  [/instagram\.com$/i, 'Instagram'], [/tiktok\.com$/i, 'TikTok'], [/snapchat\.com$/i, 'Snapchat'],
  [/facebook(mail)?\.com$/i, 'Facebook'], [/youtube\.com$/i, 'YouTube'], [/discord(app)?\.com$/i, 'Discord'],
  [/twitter\.com$|x\.com$/i, 'X'], [/pinterest\.com$/i, 'Pinterest'], [/twitch\.tv$/i, 'Twitch'], [/bereal/i, 'BeReal'],
];

// Wird nie automatisch gelöscht, egal was die KI meint
const PROTECTED = /schule|lehrer|direktion|elternverein|webuntis|digi4school|scook|rechnung|bestell|lieferung|zahlung|konto|bank|sicherheit|passwort|password|anmeld|login|verifiz|code|bestätig|termin|arzt|ticket|bewerbung|vertrag/i;

export function listAccounts(userId: string): MailAccount[] {
  return getSecret<MailAccount[]>(userId, 'mail:accounts') ?? [];
}

export function saveAccounts(userId: string, accounts: MailAccount[]) {
  setSecret(userId, 'mail:accounts', accounts);
}

export function publicAccounts(userId: string) {
  const state = db.prepare('SELECT account_id, last_error, checked_at FROM mail_state WHERE user_id = ?').all(userId) as
    { account_id: string; last_error: string | null; checked_at: string | null }[];
  return listAccounts(userId).map(({ pass: _pass, oauth, ...a }) => {
    const s = state.find((x) => x.account_id === a.id);
    return { ...a, auth: oauth ? 'google' : 'password', lastError: s?.last_error ?? null, checkedAt: s?.checked_at ?? null };
  });
}

async function client(a: MailAccount) {
  const auth = a.oauth ? { user: a.user, accessToken: await accessToken(a) } : { user: a.user, pass: a.pass };
  return new ImapFlow({ host: a.host, port: a.port, secure: true, auth, logger: false });
}

export async function testAccount(a: MailAccount) {
  const c = await client(a);
  await c.connect();
  await c.logout();
}

async function trashPath(c: ImapFlow): Promise<string | null> {
  const boxes = await c.list();
  return boxes.find((b) => b.specialUse === '\\Trash')?.path ?? null;
}

function socialSource(address: string): string | null {
  const domain = address.split('@')[1] ?? '';
  return SOCIAL_DOMAINS.find(([re]) => re.test(domain))?.[1] ?? null;
}

async function classify(mails: NewMail[]): Promise<Map<number, { category: Category; summary: string; confidence: number }>> {
  const result = new Map<number, { category: Category; summary: string; confidence: number }>();
  for (const m of mails) {
    const social = socialSource(m.fromAddress);
    if (social) result.set(m.uid, { category: 'social', summary: m.subject, confidence: 1 });
  }
  const rest = mails.filter((m) => !result.has(m.uid));
  if (!rest.length) return result;

  if (llmAvailable()) {
    try {
      const { message } = await complete([
        { role: 'system', content: 'Du sortierst E-Mails für einen Schüler in Österreich. Antworte nur mit JSON.' },
        {
          role: 'user',
          content: `Ordne jede Mail ein:
- "important": braucht Aufmerksamkeit (Schule, Lehrer, Familie, Freunde, Termine, Rechnungen, Sicherheit, persönliche Nachrichten)
- "normal": okay, aber nicht dringend (Bestätigungen, Infos)
- "newsletter": Werbung, Angebote, Newsletter, Rabatte
- "spam": Betrug, Phishing, offensichtlicher Müll
Dazu eine Zusammenfassung auf Deutsch (max. 15 Wörter) und "confidence" 0–1.

${JSON.stringify(rest.map((m) => ({ id: m.uid, from: m.from, subject: m.subject, text: m.snippet.slice(0, 600), unsubscribeLink: m.hasUnsubscribe })))}

Format: {"mails": [{"id": 123, "category": "newsletter", "summary": "…", "confidence": 0.9}]}`,
        },
      ], undefined, { json: true, timeoutMs: 90_000, background: true });
      const text = message.content ?? '';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { mails?: { id: number; category: Category; summary: string; confidence: number }[] };
      for (const r of parsed.mails ?? []) {
        if (rest.some((m) => m.uid === r.id) && ['important', 'normal', 'newsletter', 'spam'].includes(r.category)) {
          result.set(r.id, { category: r.category, summary: String(r.summary ?? ''), confidence: Number(r.confidence) || 0 });
        }
      }
    } catch (err) {
      if (!(err instanceof LlmUnavailable)) console.warn('Mail-Einordnung fehlgeschlagen:', (err as Error).message);
    }
  }
  // Ohne KI: nur offensichtliche Newsletter erkennen, sonst "normal"
  for (const m of rest) {
    if (!result.has(m.uid)) result.set(m.uid, { category: m.hasUnsubscribe ? 'newsletter' : 'normal', summary: m.subject, confidence: m.hasUnsubscribe ? 0.6 : 0.5 });
  }
  return result;
}

async function checkAccount(userId: string, account: MailAccount) {
  const user = getUser(userId)!;
  const autoTrash = user.settings.mailAutoTrash !== false;
  const c = await client(account);
  await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  try {
    const box = c.mailbox as { uidValidity: bigint; uidNext: number };
    const state = db.prepare('SELECT uid_validity, last_uid FROM mail_state WHERE user_id = ? AND account_id = ?').get(userId, account.id) as
      { uid_validity: string; last_uid: number } | undefined;
    const validity = String(box.uidValidity);
    // Beim ersten Mal (oder nach Postfach-Umbau) nicht die ganze Vergangenheit durchgehen
    if (!state || state.uid_validity !== validity) {
      db.prepare(`INSERT OR REPLACE INTO mail_state (user_id, account_id, uid_validity, last_uid, checked_at) VALUES (?, ?, ?, ?, ?)`)
        .run(userId, account.id, validity, box.uidNext - 1, now());
      return;
    }
    if (box.uidNext - 1 <= state.last_uid) {
      db.prepare('UPDATE mail_state SET checked_at = ?, last_error = NULL WHERE user_id = ? AND account_id = ?').run(now(), userId, account.id);
      return;
    }

    const mails: NewMail[] = [];
    let maxUid = state.last_uid;
    for await (const msg of c.fetch(`${state.last_uid + 1}:*`, { uid: true, envelope: true, source: { maxLength: 60_000 } }, { uid: true })) {
      if (msg.uid <= state.last_uid) continue;
      maxUid = Math.max(maxUid, msg.uid);
      if (mails.length >= 40) continue;
      const parsed = msg.source ? await simpleParser(msg.source).catch(() => null) : null;
      const from = msg.envelope?.from?.[0];
      mails.push({
        uid: msg.uid,
        messageId: msg.envelope?.messageId ?? null,
        from: from?.name || from?.address || 'Unbekannt',
        fromAddress: from?.address ?? '',
        subject: msg.envelope?.subject ?? '(kein Betreff)',
        date: new Date(msg.envelope?.date ?? Date.now()).toISOString(),
        snippet: (parsed?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200),
        hasUnsubscribe: !!parsed?.headers.get('list-unsubscribe'),
      });
    }

    const verdicts = await classify(mails);
    const trash = autoTrash ? await trashPath(c) : null;
    const trashed: NewMail[] = [];
    for (const m of mails) {
      const v = verdicts.get(m.uid)!;
      const deletable = (v.category === 'spam' || (v.category === 'newsletter' && m.hasUnsubscribe))
        && v.confidence >= 0.75 && !PROTECTED.test(`${m.subject} ${m.from}`);
      let action: 'trash' | 'notify' | 'keep' = 'keep';
      if (trash && deletable) {
        await c.messageMove(String(m.uid), trash, { uid: true });
        action = 'trash';
        trashed.push(m);
      } else if (v.category === 'important') {
        action = 'notify';
      }
      db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), userId, v.category === 'social' ? 'social' : 'email', m.from, m.subject, JSON.stringify({
          accountId: account.id, account: account.label, category: v.category, summary: v.summary, action,
          messageId: m.messageId, fromAddress: m.fromAddress, platform: socialSource(m.fromAddress),
        }), m.date);
      if (action === 'notify') {
        const text = `📧 Wichtige Mail (${account.label}) von **${m.from}**: ${v.summary || m.subject}`;
        addMessage(userId, 'assistant', text);
        await pushToUser(userId, { title: `Mail von ${m.from}`, body: v.summary || m.subject, tag: `mail-${account.id}-${m.uid}` });
      }
    }
    db.prepare('UPDATE mail_state SET last_uid = ?, checked_at = ?, last_error = NULL WHERE user_id = ? AND account_id = ?')
      .run(maxUid, now(), userId, account.id);
  } finally {
    lock.release();
    await c.logout().catch(() => {});
  }
}

export async function checkAllMail(userId: string) {
  for (const account of listAccounts(userId)) {
    try {
      await checkAccount(userId, account);
    } catch (err) {
      const message = (err as Error).message;
      const prev = db.prepare('SELECT last_error FROM mail_state WHERE user_id = ? AND account_id = ?').get(userId, account.id) as { last_error: string | null } | undefined;
      db.prepare(`INSERT INTO mail_state (user_id, account_id, uid_validity, last_uid, last_error, checked_at) VALUES (?, ?, '', 0, ?, ?)
        ON CONFLICT(user_id, account_id) DO UPDATE SET last_error = excluded.last_error, checked_at = excluded.checked_at`)
        .run(userId, account.id, message, now());
      if (!prev?.last_error) addMessage(userId, 'assistant', `⚠️ Ich komme nicht in dein Postfach „${account.label}“: ${message}`);
    }
  }
}

/** Von Stella gelöschte Mail zurück in den Posteingang holen. */
export async function restoreMail(userId: string, eventId: string) {
  const row = db.prepare('SELECT payload FROM inbox_events WHERE user_id = ? AND id = ?').get(userId, eventId) as { payload: string } | undefined;
  if (!row) throw new Error('Nicht gefunden');
  const payload = JSON.parse(row.payload) as { accountId: string; messageId: string | null; action: string };
  const account = listAccounts(userId).find((a) => a.id === payload.accountId);
  if (!account || !payload.messageId || payload.action !== 'trash') throw new Error('Kann nicht wiederhergestellt werden');
  const c = await client(account);
  await c.connect();
  try {
    const trash = await trashPath(c);
    if (!trash) throw new Error('Papierkorb nicht gefunden');
    const lock = await c.getMailboxLock(trash);
    try {
      const uids = await c.search({ header: { 'message-id': payload.messageId } }, { uid: true });
      if (!uids || !uids.length) throw new Error('Mail ist nicht mehr im Papierkorb');
      await c.messageMove(uids.join(','), 'INBOX', { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
  db.prepare('UPDATE inbox_events SET payload = ? WHERE id = ?').run(JSON.stringify({ ...payload, action: 'restored' }), eventId);
}
