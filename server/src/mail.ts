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
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { getSecret, setSecret } from './auth.ts';
import { addMessage, db, getUser, newId, now, type User } from './db.ts';
import { complete, LlmUnavailable, llmAvailable } from './llm.ts';
import { accessToken } from './oauth.ts';
import { levelFor, perform } from './actions.ts';
import { formatDateDe, todayIn, voice } from '@stella/shared';
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

export interface Deadline { date: string; time: string | null; what: string }

export interface Verdict {
  category: Category;
  summary: string;
  confidence: number;
  /** warum wichtig (kurz), nur bei wichtigen */
  reason?: string;
  /** Frist oder Termin, der in der Mail steht */
  deadline?: Deadline | null;
  /** erwartet der Absender eine Antwort? */
  needsReply?: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

/** KI-Antwort prüfen: nur gültige Felder übernehmen */
export function cleanVerdict(r: Record<string, unknown>, today: string): Verdict | null {
  if (!['important', 'normal', 'newsletter', 'spam'].includes(String(r.category))) return null;
  const d = r.deadline as Record<string, unknown> | null | undefined;
  const deadline = d && YMD.test(String(d.date)) && String(d.date) >= today && String(d.what ?? '').trim()
    ? { date: String(d.date), time: HHMM.test(String(d.time)) ? String(d.time) : null, what: String(d.what).trim().slice(0, 120) }
    : null;
  return {
    category: r.category as Category, summary: String(r.summary ?? '').slice(0, 200), confidence: Number(r.confidence) || 0,
    reason: r.reason ? String(r.reason).slice(0, 120) : undefined, deadline, needsReply: r.needsReply === true,
  };
}

async function classify(mails: NewMail[], today: string): Promise<Map<number, Verdict>> {
  const result = new Map<number, Verdict>();
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
          content: `Heute ist ${today}. Ordne jede Mail ein:
- "important": braucht Aufmerksamkeit (Schule, Lehrer, Familie, Freunde, Termine, Rechnungen, Sicherheit, persönliche Nachrichten)
- "normal": okay, aber nicht dringend (Bestätigungen, Infos)
- "newsletter": Werbung, Angebote, Newsletter, Rabatte
- "spam": Betrug, Phishing, offensichtlicher Müll
Dazu: "summary" auf Deutsch (max. 15 Wörter), "confidence" 0–1,
bei important zusätzlich "reason" (warum wichtig, max. 8 Wörter, z. B. "Klassenvorstand, Frist Freitag"),
"deadline" falls eine Frist/ein Termin genannt ist ({"date": "YYYY-MM-DD", "time": "HH:MM" oder null, "what": "was zu tun ist, max. 8 Wörter"}, sonst null),
"needsReply" true, wenn der Absender eine Antwort erwartet.

${JSON.stringify(rest.map((m) => ({ id: m.uid, from: m.from, subject: m.subject, text: m.snippet.slice(0, 900), unsubscribeLink: m.hasUnsubscribe })))}

Format: {"mails": [{"id": 123, "category": "important", "summary": "…", "confidence": 0.9, "reason": "…", "deadline": null, "needsReply": false}]}`,
        },
      ], undefined, { json: true, timeoutMs: 90_000, background: true });
      const text = message.content ?? '';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { mails?: Record<string, unknown>[] };
      for (const r of parsed.mails ?? []) {
        const v = cleanVerdict(r, today);
        if (v && rest.some((m) => m.uid === Number(r.id))) result.set(Number(r.id), v);
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
  const autoTrash = levelFor(user, 'mail_sort') !== 'never';
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

    const verdicts = await classify(mails, todayIn(user.timeZone));
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
      const eventId = newId();
      const relevant = v.category === 'important' || v.category === 'normal';
      db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(eventId, userId, v.category === 'social' ? 'social' : 'email', m.from, m.subject, JSON.stringify({
          accountId: account.id, account: account.label, category: v.category, summary: v.summary, action,
          messageId: m.messageId, fromAddress: m.fromAddress, platform: socialSource(m.fromAddress),
          reason: v.reason ?? null, deadline: v.deadline ?? null, needsReply: !!v.needsReply,
          // Text nur von relevanten Mails behalten – für Antwort-Entwürfe
          snippet: relevant ? m.snippet : null,
        }), m.date);
      if (action === 'notify') {
        const extra = [v.reason, v.needsReply ? 'Antwort nötig' : null].filter(Boolean).join(' · ');
        const text = `📧 Wichtige Mail (${account.label}) von **${m.from}**: ${v.summary || m.subject}${extra ? ` _(${extra})_` : ''}`;
        addMessage(userId, 'assistant', text);
        await pushToUser(userId, { title: `Mail von ${m.from}`, body: v.summary || m.subject, tag: `mail-${account.id}-${m.uid}` });
      }
      // Frist in der Mail → Eintrag (je nach Recht sofort oder als Vorschlag)
      if (v.deadline && relevant) offerDeadline(user, eventId, m.from, v.deadline);
    }
    db.prepare('UPDATE mail_state SET last_uid = ?, checked_at = ?, last_error = NULL WHERE user_id = ? AND account_id = ?')
      .run(maxUid, now(), userId, account.id);
  } finally {
    lock.release();
    await c.logout().catch(() => {});
  }
}

/** Frist aus einer Mail als Eintrag anbieten – läuft über die Rechte für den Planer */
export function offerDeadline(user: User, eventId: string, from: string, d: Deadline) {
  const when = `${formatDateDe(d.date)}${d.time ? ` um ${d.time}` : ''}`;
  const v = voice(user.settings.tone);
  const r = perform(user, 'item.create', {
    kind: d.time ? 'event' : 'todo', title: d.what, due: d.date, time: d.time, detail: `aus der Mail von ${from}`, source: 'mail',
  }, { source: 'auto', quiet: true, question: v.mailDeadlineAsk(from, d.what, when) });
  if (r.status === 'done') addMessage(user.id, 'assistant', v.mailDeadlineDone(from, d.what, when), { actionId: r.actionId });
  if (r.status !== 'refused') setEventField(user.id, eventId, { deadlineActionId: r.actionId });
}

/** einzelnes Feld im gespeicherten Mail-Eintrag setzen */
export function setEventField(userId: string, eventId: string, fields: Record<string, unknown>) {
  const row = db.prepare('SELECT payload FROM inbox_events WHERE user_id = ? AND id = ?').get(userId, eventId) as { payload: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE inbox_events SET payload = ? WHERE user_id = ? AND id = ?').run(JSON.stringify({ ...JSON.parse(row.payload), ...fields }), userId, eventId);
  return true;
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

// ---------- Antworten: Entwurf und Senden ----------

const SMTP: Record<MailProvider, (a: MailAccount) => { host: string; port: number; secure: boolean }> = {
  gmail: () => ({ host: 'smtp.gmail.com', port: 465, secure: true }),
  icloud: () => ({ host: 'smtp.mail.me.com', port: 587, secure: false }),
  other: (a) => ({ host: a.host.replace(/^imap\./i, 'smtp.'), port: 587, secure: false }),
};

export interface OutgoingMail { accountId: string; to: string; subject: string; body: string; inReplyTo?: string | null; eventId?: string | null }

export async function sendMail(userId: string, m: OutgoingMail) {
  const account = listAccounts(userId).find((a) => a.id === m.accountId);
  if (!account) throw new Error('Postfach nicht gefunden');
  const auth = account.oauth
    ? { type: 'OAuth2' as const, user: account.user, accessToken: await accessToken(account) }
    : { user: account.user, pass: account.pass };
  const transport = nodemailer.createTransport({ ...SMTP[account.provider](account), auth });
  await transport.sendMail({
    from: account.user, to: m.to, subject: m.subject, text: m.body,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.inReplyTo } : {}),
  });
  if (m.eventId) setEventField(userId, m.eventId, { replied: now(), handled: 1 });
}

type EventRow = { id: string; sender: string | null; text: string | null; payload: string };

export function getMailEvent(userId: string, eventId: string) {
  const r = db.prepare(`SELECT id, sender, text, payload FROM inbox_events WHERE user_id = ? AND id = ? AND source = 'email'`).get(userId, eventId) as EventRow | undefined;
  return r ? { ...r, payload: JSON.parse(r.payload) as Record<string, any> } : null;
}

/** Antwort im Namen des Nutzers entwerfen – Sie-Form für Lehrer:innen, du für Freunde/Familie. Kostet eine KI-Anfrage. */
export async function draftReply(user: User, eventId: string, instruction = '', memories = ''): Promise<OutgoingMail> {
  const ev = getMailEvent(user.id, eventId);
  if (!ev) throw new Error('Mail nicht gefunden');
  const p = ev.payload;
  if (!p.fromAddress) throw new Error('Absender-Adresse fehlt');
  const { message } = await complete([
    {
      role: 'system',
      content: `Du schreibst E-Mail-Antworten im Namen von ${user.name} (Schüler:in in Österreich). Höflich und kurz, passend zum Absender: ` +
        'Lehrer:innen, Schule, Ämter, Firmen in der Sie-Form mit Anrede und Gruß; Freunde und Familie locker in der Du-Form. ' +
        'Erfinde keine Fakten oder Zusagen – wo etwas fehlt, schreib eine neutrale Formulierung. Antworte nur mit dem Text der Mail, ohne Betreff.',
    },
    {
      role: 'user',
      content: `Mail von ${ev.sender} <${p.fromAddress}>\nBetreff: ${ev.text}\n\n${String(p.snippet ?? p.summary ?? '').slice(0, 1500)}\n\n` +
        `${memories ? `Was du über ${user.name} weißt:\n${memories}\n\n` : ''}` +
        `${instruction ? `Was ${user.name} antworten möchte: ${instruction}` : 'Schreib eine passende, kurze Antwort.'}`,
    },
  ], undefined, { timeoutMs: 90_000 });
  const body = (message.content ?? '').trim().replace(/^betreff:.*\n+/iu, '');
  if (!body) throw new Error('Kein Entwurf bekommen – bitte nochmal versuchen');
  const subject = /^re:/iu.test(String(ev.text)) ? String(ev.text) : `Re: ${ev.text ?? ''}`;
  const draft: OutgoingMail = { accountId: p.accountId, to: p.fromAddress, subject, body, inReplyTo: p.messageId ?? null, eventId };
  setEventField(user.id, eventId, { draft: { subject, body } });
  return draft;
}
