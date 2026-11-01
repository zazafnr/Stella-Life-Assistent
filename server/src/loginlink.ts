// Anmelden und Bestätigen über einen Link in der Mail (login.stella.evolsior.com/v/<token>) – statt Code abtippen.
//
//   Gleiches Gerät  Das wartende Gerät hat beim Anfordern ein zufälliges `deviceSecret` bekommen (Browser: Cookie
//                   `stella_pending` + localStorage, App: Keychain). Passt es zum Link → die Anfrage gilt als bestätigt und das
//                   wartende Gerät holt sich die Sitzung (`claim`). Auch die iOS-App kann Token + Secret direkt schicken.
//   Anderes Gerät   Der Link zeigt nur den 6-stelligen Code (mit Gerät, Browser, Ort und Uhrzeit der Anfrage). Den tippt man am
//                   wartenden Gerät ein. Ein Klick auf einem fremden Gerät meldet das wartende Gerät also NIE an.
//   Scanner         Ein GET verbraucht nichts (Outlook Safe Links, Gmail & Co. rufen Links automatisch auf).
//   Sicherheit      Token und Code nur als Hash, Vergleich mit timingSafeEqual, 15 Minuten, 5 Fehlversuche je Anfrage.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { matchLocale, t, type Locale } from '@stella/shared';
import { config } from './config.ts';
import { createSession, hashPassword, HttpError } from './auth.ts';
import { addMessage, db, getUser, newId, now, type User } from './db.ts';
import { sendTemplateMail, mailerConfigured } from './mailer.ts';
import { userLocale, voiceOf } from './locale.ts';
import { simplePage } from './email/pages.ts';

export type LinkPurpose = 'signup' | 'login' | 'reset' | 'address';

export const LINK_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 6;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const secret = () => `login-code:${config.secret || 'stella-dev-secret-not-for-production'}`;

/** Der 6-stellige Code gehört fest zum Token: so kann ihn die Link-Seite zeigen, ohne ihn im Klartext zu speichern. */
export function codeForToken(token: string): string {
  const n = createHmac('sha256', secret()).update(token).digest().readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

interface Row {
  id: string; user_id: string; purpose: LinkPurpose; token_hash: string; code_hash: string; device_hash: string;
  created_at: string; expires_at: string; used_at: string | null; claimed_at: string | null; attempts: number; ip: string | null; user_agent: string | null;
}

const rowByToken = (token: string) => db.prepare('SELECT * FROM login_requests WHERE token_hash = ?').get(sha256(token)) as Row | undefined;
const rowById = (id: string) => db.prepare('SELECT * FROM login_requests WHERE id = ?').get(id) as Row | undefined;
const expired = (r: Row) => r.expires_at < now();

export interface CreatedRequest { requestId: string; token: string; deviceSecret: string; url: string; code: string }

/** Neue Anfrage; alte offene Anfragen derselben Person und Art werden ungültig */
export function createLoginRequest(user: User, purpose: LinkPurpose, meta: { ip?: string; userAgent?: string; deviceSecret?: string } = {}): CreatedRequest {
  const token = randomBytes(32).toString('base64url');
  const deviceSecret = meta.deviceSecret && /^[A-Za-z0-9_-]{20,80}$/.test(meta.deviceSecret) ? meta.deviceSecret : randomBytes(24).toString('base64url');
  const id = newId();
  db.prepare('DELETE FROM login_requests WHERE user_id = ? AND purpose = ? AND claimed_at IS NULL').run(user.id, purpose);
  db.prepare(`INSERT INTO login_requests (id, user_id, purpose, token_hash, code_hash, device_hash, created_at, expires_at, attempts, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, user.id, purpose, sha256(token), sha256(`${id}:${codeForToken(token)}`), sha256(deviceSecret), now(), new Date(Date.now() + LINK_MINUTES * 60_000).toISOString(),
      (meta.ip ?? '').slice(0, 64), (meta.userAgent ?? '').slice(0, 300));
  return { requestId: id, token, deviceSecret, url: `${config.loginUrl.replace(/\/$/, '')}/v/${token}`, code: codeForToken(token) };
}

/** Frühestens nach 60 Sekunden eine neue Mail; höchstens 6 Anfragen pro Stunde und Person */
export function checkResend(userId: string, purpose: LinkPurpose) {
  const last = db.prepare('SELECT created_at AS at FROM login_requests WHERE user_id = ? AND purpose = ? AND claimed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(userId, purpose) as { at: string } | undefined;
  const wait = last ? Math.ceil((Date.parse(last.at) + RESEND_SECONDS * 1000 - Date.now()) / 1000) : 0;
  if (wait > 0) throw new HttpError(429, `Bitte warte noch ${wait} Sekunden, bevor du eine neue Mail anforderst.`, { retryIn: wait });
  const hour = (db.prepare('SELECT COUNT(*) AS n FROM login_requests WHERE user_id = ? AND created_at > ?').get(userId, new Date(Date.now() - 3600_000).toISOString()) as { n: number }).n;
  if (hour >= MAX_REQUESTS_PER_HOUR) throw new HttpError(429, 'Zu viele Anfragen – bitte versuch es später nochmal.');
}

/** Wann wurde die letzte Anfrage gesendet? (für „erneut senden“ im Anmeldedialog) */
export function lastRequestAt(userId: string, purpose: LinkPurpose): string | null {
  return (db.prepare('SELECT created_at AS at FROM login_requests WHERE user_id = ? AND purpose = ? AND claimed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(userId, purpose) as { at: string } | undefined)?.at ?? null;
}

// ---------- Link öffnen ----------

export type LinkView =
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'done'; purpose: LinkPurpose }
  | { kind: 'same-device'; purpose: LinkPurpose }
  | { kind: 'show-code'; purpose: LinkPurpose; code: string; ip: string | null; userAgent: string | null; at: string };

/** Was soll die Seite unter dem Link zeigen? Verbraucht nichts. `secret`: das Gerätegeheimnis aus Cookie bzw. App. */
export function viewLink(token: string, deviceSecret?: string): LinkView {
  const r = rowByToken(token);
  if (!r) return { kind: 'invalid' };
  if (r.claimed_at || r.used_at) return { kind: 'done', purpose: r.purpose };
  if (expired(r)) return { kind: 'expired' };
  if (deviceSecret && sameHash(sha256(deviceSecret), r.device_hash)) return { kind: 'same-device', purpose: r.purpose };
  return { kind: 'show-code', purpose: r.purpose, code: codeForToken(token), ip: r.ip, userAgent: r.user_agent, at: r.created_at };
}

/** Bestätigen – nur vom Gerät, das gewartet hat (Gerätegeheimnis passt). Gibt die Anfrage-Id zurück. */
export function confirmLink(token: string, deviceSecret: string | undefined): { requestId: string; purpose: LinkPurpose } {
  const r = rowByToken(token);
  if (!r) throw new HttpError(404, 'Dieser Link ist ungültig.');
  if (r.claimed_at || r.used_at) throw new HttpError(409, 'Dieser Link wurde schon benutzt.');
  if (expired(r)) throw new HttpError(410, 'Dieser Link ist abgelaufen.');
  if (!deviceSecret || !sameHash(sha256(deviceSecret), r.device_hash)) throw new HttpError(403, 'Das ist nicht das Gerät, das die Anmeldung gestartet hat. Tippe stattdessen den Code ein.');
  db.prepare('UPDATE login_requests SET used_at = ? WHERE id = ?').run(now(), r.id);
  return { requestId: r.id, purpose: r.purpose };
}

export interface Claimed { token: string; user: User; purpose: LinkPurpose }

/** Das wartende Gerät holt die Sitzung ab, sobald bestätigt wurde. `undefined` = noch nicht bestätigt. */
export function claim(requestId: string, deviceSecret: string, device?: string): Claimed | undefined {
  const r = rowById(String(requestId));
  if (!r || !sameHash(sha256(String(deviceSecret)), r.device_hash)) throw new HttpError(403, 'Unbekannte Anfrage.');
  if (r.claimed_at) throw new HttpError(409, 'Diese Anfrage wurde schon abgeschlossen.');
  if (expired(r)) throw new HttpError(410, 'Der Link ist abgelaufen – fordere einen neuen an.', { needsNewCode: true });
  if (!r.used_at) return undefined;
  return finish(r, device);
}

/** Code am wartenden Gerät eingeben (Link auf anderem Gerät geöffnet). Ohne Gerätegeheimnis nur über E-Mail + Code (ältere Apps). */
export function claimByCode(opts: { requestId?: string; email?: string; deviceSecret?: string; code: string; device?: string }): Claimed {
  let r: Row | undefined;
  if (opts.requestId) r = rowById(opts.requestId);
  else if (opts.email) {
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(opts.email.trim().toLowerCase()) as { id: string } | undefined;
    r = u && (db.prepare('SELECT * FROM login_requests WHERE user_id = ? AND claimed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(u.id) as Row | undefined);
  }
  if (!r) throw new HttpError(400, 'Zu dieser Adresse wartet keine Anmeldung auf einen Code.');
  if (opts.requestId && !(opts.deviceSecret && sameHash(sha256(opts.deviceSecret), r.device_hash))) throw new HttpError(403, 'Unbekannte Anfrage.');
  if (r.claimed_at) throw new HttpError(400, 'Es ist kein Code offen – fordere einen neuen an.', { needsNewCode: true });
  if (expired(r)) throw new HttpError(400, 'Der Code ist abgelaufen – fordere einen neuen an.', { needsNewCode: true });
  const given = sha256(`${r.id}:${String(opts.code ?? '').replace(/\D/g, '')}`);
  if (!sameHash(given, r.code_hash)) {
    const attempts = r.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare('DELETE FROM login_requests WHERE id = ?').run(r.id);
      throw new HttpError(429, 'Zu viele falsche Eingaben – fordere einen neuen Code an.', { needsNewCode: true });
    }
    db.prepare('UPDATE login_requests SET attempts = ? WHERE id = ?').run(attempts, r.id);
    throw new HttpError(400, `Der Code stimmt nicht. Noch ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? 'Versuch' : 'Versuche'}.`);
  }
  return finish(r, opts.device);
}

function finish(r: Row, device?: string): Claimed {
  const user = getUser(r.user_id);
  if (!user) throw new HttpError(410, 'Das Konto gibt es nicht mehr.');
  db.prepare('UPDATE login_requests SET used_at = COALESCE(used_at, ?), claimed_at = ? WHERE id = ?').run(now(), now(), r.id);
  if (!user.verified && r.purpose === 'signup') {
    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(user.id);
    const verified = getUser(user.id)!;
    addMessage(verified.id, 'assistant', voiceOf(verified).welcome(verified.name));
    // Willkommens-Mail mit drei Schritten (nach der Bestätigung)
    if (mailerConfigured()) {
      void sendTemplateMail(verified.email, userLocale(verified), 'welcome', { name: verified.name, appUrl: config.publicUrl }, 'noreply', { purpose: 'welcome', userId: verified.id }).catch(() => {});
    }
  }
  return { token: createSession(user.id, device), user: getUser(user.id)!, purpose: r.purpose };
}

// ---------- Mails ----------

export async function sendLinkMail(user: User, purpose: LinkPurpose, req: CreatedRequest, locale: Locale = userLocale(user)) {
  const template = purpose === 'signup' ? 'verify-signup' : 'login-link';
  await sendTemplateMail(user.email, locale, template, { name: user.name, url: req.url, minutes: LINK_MINUTES, purpose: purpose === 'reset' ? 'reset' : 'login' }, 'noreply',
    { purpose: purpose === 'signup' ? 'verification' : purpose === 'reset' ? 'password_reset' : 'login_link', userId: user.id });
}

// ---------- Routen und Seiten ----------

const COOKIE = 'stella_pending';

export function cookieValue(req: FastifyRequest, name = COOKIE): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie ?? ''));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** Cookie für das wartende Gerät – gilt auch für login.stella.evolsior.com (gleiche Hauptdomain) */
export function pendingCookie(deviceSecret: string): string {
  const url = new URL(config.loginUrl);
  const secure = url.protocol === 'https:';
  const domain = config.loginCookieDomain || (url.hostname.split('.').length >= 3 ? url.hostname.split('.').slice(1).join('.') : '');
  return `${COOKIE}=${encodeURIComponent(deviceSecret)}; Path=/; Max-Age=${LINK_MINUTES * 60}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${domain && domain.includes('.') ? `; Domain=${domain}` : ''}`;
}

export const requestLocale = (req: FastifyRequest): Locale => matchLocale(req.headers['accept-language']);

function describeDevice(ua: string | null): string {
  const s = ua ?? '';
  const os = /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

function linkPage(locale: Locale, token: string, view: LinkView): string {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, `login.${k}`, v);
  switch (view.kind) {
    case 'invalid': return simplePage({ locale, tone: 'warn', title: tt('invalidTitle'), text: tt('invalidText') });
    case 'expired': return simplePage({ locale, tone: 'warn', title: tt('expiredTitle'), text: tt('expiredText'), link: { href: config.publicUrl, label: tt('openStella') } });
    case 'done': return simplePage({ locale, title: tt('doneTitle'), text: tt('doneText'), link: { href: config.publicUrl, label: tt('openStella') } });
    case 'same-device':
      // Mit JavaScript sofort abschließen, ohne JavaScript über den Knopf (Formular)
      return simplePage({ locale, title: tt('sameTitle'), text: tt('sameText'), form: { action: `/v/${token}`, button: tt('finish') } })
        .replace('</body>', `<script>(function(){var f=document.querySelector('form');if(!f)return;fetch(f.action,{method:'POST',headers:{'x-requested-with':'fetch'},credentials:'include'}).then(function(r){return r.text()}).then(function(h){document.open();document.write(h);document.close()}).catch(function(){})})();</script></body>`);
    case 'show-code': {
      const when = new Date(view.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
      const device = describeDevice(view.userAgent);
      return simplePage({ locale, title: tt('codeTitle'), text: tt('codeText'), code: view.code,
        small: `${tt('requestedBy', { device: device || tt('unknownDevice'), when })}${view.ip ? ` · ${view.ip}` : ''}\n${tt('notYou')}`.replace(/\n/g, ' ') });
    }
  }
}

export function registerLoginRoutes(root: FastifyInstance) {
  void root.register(async (app) => {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));

    // Die Seite unter dem Link: GET verbraucht nichts
    app.get<{ Params: { token: string } }>('/v/:token', async (req, reply) => {
      const view = viewLink(req.params.token, cookieValue(req));
      reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
      return reply.code(view.kind === 'invalid' ? 404 : view.kind === 'expired' ? 410 : 200).send(linkPage(requestLocale(req), req.params.token, view));
    });

    // „Anmeldung abschließen“: nur mit dem Cookie des wartenden Geräts
    app.post<{ Params: { token: string } }>('/v/:token', async (req, reply) => {
      const locale = requestLocale(req);
      reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
      try {
        confirmLink(req.params.token, cookieValue(req));
        return reply.send(linkPage(locale, req.params.token, { kind: 'done', purpose: 'login' }));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        return reply.code(err.status).send(linkPage(locale, req.params.token, viewLink(req.params.token, cookieValue(req))));
      }
    });

    // Universal Links: nur mit eingetragener Team-ID (Apple-Developer-Konto)
    app.get('/.well-known/apple-app-site-association', async (_req, reply) => {
      if (!config.appleTeamId) return reply.code(404).send({ error: 'nicht eingerichtet' });
      return reply.type('application/json').send({ applinks: { apps: [], details: [{ appIDs: [`${config.appleTeamId}.app.stella.ios`], components: [{ '/': '/v/*' }] }] } });
    });
  });
}

/** API für die Apps: Link-Anmeldung anfordern, Sitzung abholen, Code eingeben, Link bestätigen, neues Passwort */
export function registerLoginApi(app: FastifyInstance) {
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // „Mit E-Mail-Link anmelden“ / „Passwort vergessen“. Antwortet immer gleich – verrät nicht, ob es das Konto gibt.
  app.post('/api/auth/link/request', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = str(b.email).toLowerCase();
    const purpose: LinkPurpose = b.purpose === 'reset' ? 'reset' : 'login';
    const locale: Locale = b.locale ? matchLocale(String(b.locale)) : requestLocale(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse an.');
    const row = db.prepare('SELECT id FROM users WHERE email = ? AND verified = 1').get(email) as { id: string } | undefined;
    // Gerätegeheimnis immer ausstellen, auch wenn es das Konto nicht gibt – gleiche Antwort in jedem Fall
    const fake = { requestId: newId(), deviceSecret: str(b.deviceSecret, 80) || randomBytes(24).toString('base64url') };
    if (row && mailerConfigured()) {
      const user = getUser(row.id)!;
      checkResend(user.id, purpose);
      const created = createLoginRequest(user, purpose, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), deviceSecret: str(b.deviceSecret, 80) });
      await sendLinkMail(user, purpose, created, user.settings.locale ?? locale).catch((err) => { throw new HttpError(502, `Ich konnte die Mail nicht senden (${(err as Error).message}).`); });
      reply.header('Set-Cookie', pendingCookie(created.deviceSecret));
      return { ok: true, requestId: created.requestId, deviceSecret: created.deviceSecret, email };
    }
    reply.header('Set-Cookie', pendingCookie(fake.deviceSecret));
    return { ok: true, requestId: fake.requestId, deviceSecret: fake.deviceSecret, email };
  });

  // Das wartende Gerät fragt (alle paar Sekunden): schon bestätigt? 202 = noch nicht
  app.post('/api/auth/link/claim', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const done = claim(str(b.requestId, 80), str(b.deviceSecret, 80) || cookieValue(req) || '', str(b.device, 80));
    if (!done) return reply.code(202).send({ pending: true });
    return { token: done.token, user: publicUserFor(done.user), purpose: done.purpose };
  });

  // Code eingeben (Link wurde auf einem anderen Gerät geöffnet)
  app.post('/api/auth/link/code', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const done = claimByCode({ requestId: str(b.requestId, 80), deviceSecret: str(b.deviceSecret, 80), email: str(b.email), code: str(b.code, 20), device: str(b.device, 80) });
    return { token: done.token, user: publicUserFor(done.user), purpose: done.purpose };
  });

  // Die iOS-App (Universal Link) schickt Token und Gerätegeheimnis direkt
  app.post('/api/auth/link/confirm', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { requestId } = confirmLink(str(b.token, 100), str(b.deviceSecret, 80) || cookieValue(req));
    const done = claim(requestId, str(b.deviceSecret, 80) || cookieValue(req) || '', str(b.device, 80))!;
    return { token: done.token, user: publicUserFor(done.user), purpose: done.purpose };
  });
}

let publicUserFor: (u: User) => unknown = (u) => u;
export function setPublicUser(f: (u: User) => unknown) { publicUserFor = f; }

/** Neues Passwort setzen (nach „Passwort vergessen“ oder in den Einstellungen) – mit Sitzung */
export function registerPasswordRoute(api: FastifyInstance) {
  api.put('/api/me/password', async (req) => {
    const password = String(((req.body ?? {}) as { password?: unknown }).password ?? '');
    if (password.length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
    return { ok: true };
  });
}

export const _test = { randomInt };
export type { FastifyReply };
