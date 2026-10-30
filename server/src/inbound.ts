// Mit Stella per E-Mail schreiben: stella@evolsior.com.
//
//   Eingang:  Cloudflare Email Routing → Email Worker (workers/stella-mail) → POST /api/inbound/email (mit geheimem Schlüssel)
//   Wer:      Stella antwortet nur Adressen, die zu einem Konto gehören (Konto-Adresse oder unter „Meine Adressen“ bestätigt).
//             Alle anderen bekommen höchstens einmal am Tag einen Hinweis, dass sie ein Konto brauchen.
//   Antwort:  über Resend von stella@, im selben Verlauf. Aufgaben kurz bestätigt, Fragen ausführlich.
//   Schutz:   keine automatischen Mails beantworten (Schleifen), Limits pro Absender und insgesamt, fehlgeschlagene Echtheit ablehnen.

import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { handleChat } from './assistant.ts';
import { HttpError, getSecret, setSecret } from './auth.ts';
import { db, getUser, newId, now, type User } from './db.ts';
import { SYSTEM_SCOPE } from './keys.ts';
import { logMail } from './maillog.ts';
import { mailerConfigured, sendSystemMail } from './mailer.ts';
import { googleConfigured, googleLinkUrl, type OAuthClient } from './oauth.ts';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const MAX_ADDRESSES = 5;
const MAX_PER_SENDER_HOUR = 20;
const MAX_NOTICES_PER_DAY = 200;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

const clean = (v: unknown) => String(v ?? '').trim().toLowerCase();
const hashCode = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');

// ---------- verknüpfte Adressen ----------

export interface LinkedAddress { id: string; email: string; verified: boolean; primary: boolean }

export function listAddresses(user: User): LinkedAddress[] {
  const rows = db.prepare('SELECT id, email, verified FROM user_emails WHERE user_id = ? ORDER BY created_at').all(user.id) as { id: string; email: string; verified: number }[];
  const primary = db.prepare('SELECT verified FROM users WHERE id = ?').get(user.id) as { verified: number } | undefined;
  return [{ id: 'primary', email: user.email, verified: !!primary?.verified, primary: true }, ...rows.map((r) => ({ id: r.id, email: r.email, verified: !!r.verified, primary: false }))];
}

/** Welches Konto gehört zu dieser Absender-Adresse? Nur bestätigte Adressen zählen. */
export function findUserByAddress(address: string): User | null {
  const a = clean(address);
  const own = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND verified = 1').get(a) as { id: string } | undefined;
  const linked = own ?? db.prepare('SELECT user_id AS id FROM user_emails WHERE email = ? AND verified = 1').get(a) as { id: string } | undefined;
  return linked ? getUser(linked.id) : null;
}

export async function addAddress(user: User, raw: unknown): Promise<LinkedAddress[]> {
  const email = clean(raw);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse an.');
  if (clean(user.email) === email) throw new HttpError(409, 'Das ist schon deine Konto-Adresse.');
  if (db.prepare('SELECT 1 FROM user_emails WHERE email = ? AND verified = 1').get(email) || db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND verified = 1').get(email)) {
    throw new HttpError(409, 'Diese Adresse gehört schon zu einem Konto.');
  }
  if (!mailerConfigured()) throw new HttpError(503, 'Dieser Server kann gerade keine Bestätigungs-Mails verschicken.');
  const mine = db.prepare('SELECT id, sent_at FROM user_emails WHERE user_id = ? AND email = ?').get(user.id, email) as { id: string; sent_at: string | null } | undefined;
  if (!mine && (db.prepare('SELECT COUNT(*) AS n FROM user_emails WHERE user_id = ?').get(user.id) as { n: number }).n >= MAX_ADDRESSES) {
    throw new HttpError(400, `Du kannst höchstens ${MAX_ADDRESSES} zusätzliche Adressen verknüpfen.`);
  }
  if (mine?.sent_at && Date.now() - Date.parse(mine.sent_at) < 60_000) throw new HttpError(429, 'Der Code ist gerade erst unterwegs. Warte kurz und versuch es nochmal.');
  // dieselbe, noch unbestätigte Adresse bei jemand anderem wird frei
  db.prepare('DELETE FROM user_emails WHERE email = ? AND verified = 0 AND user_id != ?').run(email, user.id);

  const id = mine?.id ?? newId();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(`INSERT INTO user_emails (id, user_id, email, verified, code_hash, code_expires, attempts, sent_at, created_at) VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET code_hash = excluded.code_hash, code_expires = excluded.code_expires, attempts = 0, sent_at = excluded.sent_at`)
    .run(id, user.id, email, hashCode(id, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), now(), now());
  try {
    await sendSystemMail(email, `Dein Stella-Code: ${code}`,
      `Hallo ${user.name},\n\num diese Adresse mit deinem Stella-Konto zu verknüpfen, gib diesen Code ein:\n\n    ${code}\n\nEr gilt ${CODE_MINUTES} Minuten. Danach kannst du Stella von dieser Adresse aus schreiben: stella@evolsior.com.\nFalls du das nicht warst, ignoriere diese Mail.\n\nStella by EVOLSIOR – Built to become`,
      'noreply', { purpose: 'address_verification', userId: user.id });
  } catch (err) {
    db.prepare('DELETE FROM user_emails WHERE id = ? AND verified = 0').run(id);
    throw new HttpError(502, `Die Mail mit dem Code ließ sich nicht verschicken: ${(err as Error).message}`);
  }
  return listAddresses(user);
}

export function verifyAddress(user: User, id: string, rawCode: unknown): LinkedAddress[] {
  const row = db.prepare('SELECT id, email, verified, code_hash, code_expires, attempts FROM user_emails WHERE id = ? AND user_id = ?').get(id, user.id) as
    { id: string; email: string; verified: number; code_hash: string | null; code_expires: string | null; attempts: number } | undefined;
  if (!row) throw new HttpError(404, 'Adresse nicht gefunden.');
  if (row.verified) return listAddresses(user);
  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (!row.code_hash || !row.code_expires || row.code_expires < now()) throw new HttpError(400, 'Der Code ist abgelaufen. Fordere einen neuen an.');
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Zu viele Versuche. Fordere einen neuen Code an.');
  db.prepare('UPDATE user_emails SET attempts = attempts + 1 WHERE id = ?').run(id);
  if (hashCode(id, code) !== row.code_hash) throw new HttpError(400, 'Der Code stimmt nicht.');
  try {
    db.prepare('UPDATE user_emails SET verified = 1, code_hash = NULL, code_expires = NULL WHERE id = ?').run(id);
  } catch {
    throw new HttpError(409, 'Diese Adresse gehört inzwischen zu einem anderen Konto.');
  }
  return listAddresses(user);
}

/** Eine Adresse, die ein Anbieter (z. B. Google) schon bestätigt hat, sofort verknüpfen – ohne Code. */
export function linkVerifiedAddress(user: User, raw: string): LinkedAddress[] {
  const email = clean(raw);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Das ist keine gültige E-Mail-Adresse.');
  const owner = findUserByAddress(email);
  if (owner && owner.id !== user.id) throw new HttpError(409, 'Diese Adresse gehört schon zu einem anderen Konto.');
  if (!owner) {
    db.prepare('DELETE FROM user_emails WHERE email = ? AND verified = 0').run(email);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM user_emails WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count >= MAX_ADDRESSES) throw new HttpError(400, `Du kannst höchstens ${MAX_ADDRESSES} zusätzliche Adressen verknüpfen.`);
    db.prepare('INSERT INTO user_emails (id, user_id, email, verified, attempts, created_at) VALUES (?, ?, ?, 1, 0, ?)').run(newId(), user.id, email, now());
  }
  return listAddresses(user);
}

export function removeAddress(user: User, id: string): LinkedAddress[] {
  if (db.prepare('DELETE FROM user_emails WHERE id = ? AND user_id = ?').run(id, user.id).changes === 0) throw new HttpError(404, 'Adresse nicht gefunden.');
  return listAddresses(user);
}

// ---------- Schlüssel zwischen Worker und Server ----------

export const inboundSecretSet = () => !!getSecret<string>(SYSTEM_SCOPE, 'inbound');

/** Neuen Schlüssel erzeugen (wird nur dieses eine Mal angezeigt) */
export function rotateInboundSecret(): string {
  const secret = randomBytes(32).toString('base64url');
  setSecret(SYSTEM_SCOPE, 'inbound', secret);
  return secret;
}

export function inboundSecretMatches(given: unknown): boolean {
  const have = getSecret<string>(SYSTEM_SCOPE, 'inbound');
  if (!have || typeof given !== 'string') return false;
  const a = Buffer.from(have), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- eingehende Mail ----------

export interface InboundPayload {
  from?: string; to?: string; subject?: string; text?: string; messageId?: string; inReplyTo?: string; references?: string;
  /** Ergebnis der Echtheitsprüfung, falls im Mail-Kopf vorhanden: spf, dkim, dmarc = pass | fail | … */
  auth?: { spf?: string; dkim?: string; dmarc?: string } | null;
  autoSubmitted?: string; precedence?: string; listId?: string; size?: number;
}

export type InboundOutcome = 'replied' | 'unknown_sender' | 'unknown_sender_silent' | 'ignored_automated' | 'ignored_recipient' | 'rejected_auth' | 'rate_limited' | 'duplicate' | 'error';

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?|newsletter|info-?noreply)\b/i;

export function authVerdict(auth: InboundPayload['auth']): 'pass' | 'fail' | 'unknown' {
  const v = (x: unknown) => String(x ?? '').toLowerCase().trim();
  const [dmarc, dkim, spf] = [v(auth?.dmarc), v(auth?.dkim), v(auth?.spf)];
  if ([dmarc, dkim, spf].includes('pass')) return 'pass';
  if (dmarc === 'fail' || (dkim && spf)) return 'fail';
  return 'unknown';
}

/** Zitate, Signatur und „Am … schrieb …“ entfernen; nur das, was die Person neu geschrieben hat */
export function cleanMailText(text: string): string {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^--\s*$/.test(line)) break;
    if (/^(am .{5,80} schrieb .{0,100}:|on .{5,80} wrote:|-{3,}\s*(original message|ursprüngliche nachricht|weitergeleitete nachricht)\s*-{3,}|von: .+|from: .+@.+)$/i.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

const isQuestion = (t: string) => t.length > 20 && (/\?/.test(t) || /^(wie|was|warum|wieso|weshalb|wann|wo|wer|welche[rsmn]?|kannst du|könntest du|erkläre?|erzähl|how|what|why|when|where|who|can you)\b/i.test(t.trim()));

/** Markdown aus der App-Antwort → einfacher Text */
const plain = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').replace(/^#+\s*/gm, '').trim();

const NOTICE = (publicUrl: string) => `Hallo!

Ich bin Stella, eine persönliche Assistentin. Ich kenne diese Adresse noch nicht und kann deshalb nicht antworten.

So geht's: Lege ein Konto an unter ${publicUrl} und verknüpfe diese Adresse dort unter Einstellungen → Meine E-Mail-Adressen. Danach beantworte ich deine Mails.

Hi! I'm Stella, a personal assistant. I don't know this address yet, so I can't reply. Create an account at ${publicUrl} and link this address under Settings → My email addresses. After that I'll answer your emails.

Stella by EVOLSIOR`;

export async function processInbound(p: InboundPayload): Promise<{ outcome: InboundOutcome }> {
  const sender = clean(/<([^>]+)>/.exec(String(p.from ?? ''))?.[1] ?? p.from);
  const messageId = String(p.messageId ?? '').trim() || `generated:${createHash('sha256').update(`${sender}|${p.subject}|${p.text}`).digest('hex').slice(0, 32)}`;
  const finish = (outcome: InboundOutcome) => {
    db.prepare('UPDATE inbound_mail SET outcome = ? WHERE message_id = ?').run(outcome, messageId);
    if (outcome !== 'duplicate') logMail('in', outcome, outcome === 'error' ? 'failed' : 'ok', { to: sender });
    return { outcome };
  };

  if (!/(^|[<,\s])stella@/i.test(String(p.to ?? ''))) { logMail('in', 'ignored_recipient', 'ok'); return { outcome: 'ignored_recipient' }; }
  if (!EMAIL_RE.test(sender)) { logMail('in', 'ignored_automated', 'ok'); return { outcome: 'ignored_automated' }; }
  if (db.prepare('SELECT 1 FROM inbound_mail WHERE message_id = ?').get(messageId)) return { outcome: 'duplicate' };
  db.prepare('INSERT INTO inbound_mail (message_id, at, sender, outcome) VALUES (?, ?, ?, ?)').run(messageId, now(), sender, 'received');

  const auto = (p.autoSubmitted && clean(p.autoSubmitted) !== 'no') || /^(bulk|list|junk)$/i.test(String(p.precedence ?? '')) || !!p.listId || AUTOMATED_SENDER.test(sender.split('@')[0]!);
  if (auto) return finish('ignored_automated');
  if (authVerdict(p.auth) === 'fail') return finish('rejected_auth');
  const lastHour = new Date(Date.now() - 3600_000).toISOString();
  if ((db.prepare('SELECT COUNT(*) AS n FROM inbound_mail WHERE sender = ? AND at > ?').get(sender, lastHour) as { n: number }).n > MAX_PER_SENDER_HOUR) return finish('rate_limited');

  const subject = String(p.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const replySubject = /^(re|aw|antwort):/i.test(subject) ? subject : `Re: ${subject || 'Deine Nachricht an Stella'}`;
  const refs = [...String(p.references ?? '').split(/\s+/).filter(Boolean), ...(messageId.startsWith('generated:') ? [] : [messageId])].slice(-10);
  const threading = messageId.startsWith('generated:') ? {} : { inReplyTo: messageId, references: refs };

  const user = findUserByAddress(sender);
  try {
    if (!user) {
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const already = db.prepare("SELECT 1 FROM inbound_mail WHERE sender = ? AND outcome = 'unknown_sender' AND at > ? AND message_id != ?").get(sender, dayAgo, messageId);
      const today = (db.prepare("SELECT COUNT(*) AS n FROM inbound_mail WHERE outcome = 'unknown_sender' AND at > ?").get(dayAgo) as { n: number }).n;
      if (already || today >= MAX_NOTICES_PER_DAY || !mailerConfigured()) return finish('unknown_sender_silent');
      await sendSystemMail(sender, replySubject, NOTICE(config.publicUrl), 'stella', { purpose: 'unknown_sender_notice', ...threading });
      return finish('unknown_sender');
    }
    const body = cleanMailText(p.text ?? '');
    const isReply = /^(re|aw|antwort):/i.test(subject);
    const text = body ? (!isReply && subject && body.length < 200 && !/^(hallo|hi|hey)\b/i.test(subject) ? `${subject}\n${body}` : body) : subject;
    if (!text) return finish('ignored_automated');
    const res = await handleChat(user, text, `mail:${messageId}`.slice(0, 200), [], null, { detailed: isQuestion(text) });
    const answers = res.messages.filter((m) => m.role === 'assistant').map((m) => plain(m.text)).filter(Boolean);
    const undoable = res.messages.some((m) => m.actionId);
    const reply = `${answers.join('\n\n') || 'Erledigt.'}${undoable ? '\n\nFalsch verstanden? Antworte einfach mit „rückgängig“.' : ''}\n\n– Stella`;
    await sendSystemMail(sender, replySubject, reply, 'stella', { purpose: 'stella_reply', userId: user.id, ...threading });
    return finish('replied');
  } catch (err) {
    logMail('in', 'error', 'failed', { to: sender, userId: user?.id, detail: (err as Error).message });
    db.prepare('UPDATE inbound_mail SET outcome = ? WHERE message_id = ?').run('error', messageId);
    return { outcome: 'error' };
  }
}

// ---------- Routen ----------

/** Öffentlich, aber nur mit dem geheimen Schlüssel aus dem Cloudflare-Worker */
export function registerInboundRoute(app: FastifyInstance) {
  app.post('/api/inbound/email', { bodyLimit: 1_000_000 }, async (req: FastifyRequest, reply) => {
    if (!inboundSecretMatches(req.headers['x-inbound-secret'])) return reply.code(401).send({ error: 'unauthorized' });
    const b = (req.body ?? {}) as InboundPayload;
    // sofort annehmen, Stella antwortet danach – der Worker muss nicht auf die KI warten
    void processInbound(b).catch((err) => console.warn('Eingehende Mail:', (err as Error).message));
    return reply.code(202).send({ accepted: true });
  });
}

/** Meine Adressen (mit Login) */
export function registerAddressRoutes(api: FastifyInstance) {
  api.get('/api/me/emails', async (req) => ({ emails: listAddresses(req.user) }));
  api.post('/api/me/emails', async (req) => ({ emails: await addAddress(req.user, (req.body as { email?: unknown } | undefined)?.email) }));
  /** „Mit Google bestätigen“: Google sagt, dass die Adresse dem Nutzer gehört, kein Code nötig */
  api.post('/api/me/emails/google', async (req) => {
    if (!googleConfigured()) throw new HttpError(400, 'Die Google-Anmeldung ist auf diesem Server noch nicht eingerichtet.');
    const c = String(((req.body ?? {}) as { client?: unknown }).client ?? '');
    return { url: googleLinkUrl(req.user.id, (['web', 'desktop', 'ios'].includes(c) ? c : 'web') as OAuthClient) };
  });
  api.post<{ Params: { id: string } }>('/api/me/emails/:id/verify', async (req) => ({ emails: verifyAddress(req.user, req.params.id, (req.body as { code?: unknown } | undefined)?.code) }));
  api.delete<{ Params: { id: string } }>('/api/me/emails/:id', async (req) => ({ emails: removeAddress(req.user, req.params.id) }));
}
