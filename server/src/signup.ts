// Registrierung: Einladungscode (oder offen), Bestätigung per E-Mail-Code, Konto löschen.
//
//   STELLA_REGISTRATION = closed | invite (Standard) | open
//
// Das allererste Konto (Owner) braucht weder Einladung noch Code – der Mail-Absender wird erst danach
// in den Einstellungen eingetragen.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { addMessage, db, getUser, newId, now, updateUserSettings, type User } from './db.ts';
import { config } from './config.ts';
import { createSession, hashPassword, HttpError, register as registerFirst, userCount, verifyPassword } from './auth.ts';
import { isCountry, isLocale, matchLocale, type Edition, type Locale } from '@stella/shared';
import { requestEdition } from './editions/registry.ts';
import { editionUrl } from './editions/access.ts';
import { tr } from './locale.ts';
import { checkResend, claimByCode, createLoginRequest, pendingCookie, sendLinkMail } from './loginlink.ts';
import { mailerConfigured } from './mailer.ts';
import { filePath } from './files.ts';
import { skipProfile, cleanProfile, applyProfile } from './profile.ts';
import { voiceOf } from './locale.ts';

export type RegistrationMode = 'closed' | 'invite' | 'open';

export function registrationMode(): RegistrationMode {
  const v = process.env.STELLA_REGISTRATION;
  if (v === 'closed' || v === 'invite' || v === 'open') return v;
  return config.allowRegistration ? 'open' : 'invite';
}

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hashCode = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

// ---------- Einladungen ----------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeInvite = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatInvite = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

export function createInvite(createdBy: string, days = 14): { code: string; expiresAt: string } {
  let code = '';
  for (const b of randomBytes(8)) code += ALPHABET[b % ALPHABET.length];
  const expiresAt = new Date(Date.now() + Math.min(Math.max(days, 1), 90) * 86_400_000).toISOString();
  db.prepare('INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)').run(code, createdBy, now(), expiresAt);
  return { code: formatInvite(code), expiresAt };
}

export function listInvites() {
  return (db.prepare(`SELECT i.code, i.created_at AS createdAt, i.expires_at AS expiresAt, u.name AS usedBy FROM invites i
    LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 100`).all() as { code: string; createdAt: string; expiresAt: string | null; usedBy: string | null }[])
    .map((r) => ({ ...r, code: formatInvite(r.code) }));
}

export function deleteInvite(code: string): boolean {
  return db.prepare('DELETE FROM invites WHERE code = ?').run(normalizeInvite(code)).changes > 0;
}

function claimInvite(code: string): string {
  const row = db.prepare('SELECT code, used_by AS usedBy, expires_at AS expiresAt FROM invites WHERE code = ?').get(normalizeInvite(code)) as
    { code: string; usedBy: string | null; expiresAt: string | null } | undefined;
  if (!row || row.usedBy || (row.expiresAt && row.expiresAt < now())) throw new HttpError(403, 'Diese Einladung gibt es nicht oder sie wurde schon benutzt.');
  return row.code;
}

// ---------- Registrieren und bestätigen ----------
// Die Bestätigung läuft über einen Link in der Mail (loginlink.ts). Der 6-stellige Code bleibt für „anderes Gerät“ und ältere Apps.

export async function startSignup(b: { name: string; email: string; password: string; timeZone: string; device?: string; invite?: string; locale?: Locale; country?: string; ip?: string; userAgent?: string; deviceSecret?: string; edition?: Edition }) {
  const edition: Edition = b.edition ?? 'life';
  const base = { locale: b.locale ?? matchLocale(undefined), ...(isCountry(b.country) ? { country: b.country } : {}) };
  const email = b.email.trim().toLowerCase();
  // das erste Konto ist der Owner: ohne Einladung, ohne Bestätigung
  if (userCount() === 0) {
    const { token, user } = registerFirst(b.name || 'Du', email, b.password, b.timeZone, b.device, edition);
    updateUserSettings(user.id, { onboarding: 'pending', ...base });
    const created = getUser(user.id)!;
    addMessage(user.id, 'assistant', voiceOf(created).welcome(created.name));
    return { token, user: created, needsVerification: false as const };
  }
  const mode = registrationMode();
  if (mode === 'closed') throw new HttpError(403, 'Registrierung ist geschlossen.');
  const invite = mode === 'invite' ? claimInvite(b.invite ?? '') : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse an.');
  if (b.password.length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben.');
  if (!mailerConfigured()) throw new HttpError(503, 'Dieser Server kann gerade keine Bestätigungs-Mails verschicken. Bitte melde dich beim Betreiber.');

  // eine nicht bestätigte Anmeldung mit derselben Adresse wird ersetzt (z. B. Tippfehler im Passwort, Mail nie angekommen)
  const old = db.prepare('SELECT id, verified FROM users WHERE email = ?').get(email) as { id: string; verified: number } | undefined;
  if (old?.verified) {
    // gehört das Konto zur anderen App, sagen wir das (mit Link) statt „schon registriert“
    const other = getUser(old.id)!;
    if (other.edition !== edition) throw new HttpError(409, tr(other, `auth.wrongEdition.${other.edition}`), { code: 'wrong_edition', edition: other.edition, url: editionUrl(other.edition) });
    throw new HttpError(409, 'Diese E-Mail ist schon registriert.');
  }
  if (old) db.prepare('DELETE FROM users WHERE id = ?').run(old.id); // Einladung wird dabei wieder frei (ON DELETE SET NULL)

  const id = newId();
  db.prepare('INSERT INTO users (id, name, email, password_hash, time_zone, ingest_token, created_at, role, verified, settings, edition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .run(id, b.name.trim().slice(0, 80) || 'Du', email, hashPassword(b.password), b.timeZone || config.defaultTimeZone, randomBytes(24).toString('base64url'), now(), 'user', JSON.stringify({ onboarding: 'pending', ...base }), edition);
  if (invite) db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(id, invite);
  const user = getUser(id)!;
  try {
    const req = createLoginRequest(user, 'signup', { ip: b.ip, userAgent: b.userAgent, deviceSecret: b.deviceSecret });
    await sendLinkMail(user, 'signup', req);
    return { needsVerification: true as const, email, requestId: req.requestId, deviceSecret: req.deviceSecret };
  } catch (err) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    throw new HttpError(502, `Ich konnte die Bestätigungs-Mail nicht senden (${(err as Error).message}).`);
  }
}

/** Code aus dem Link (anderes Gerät) oder – ältere Apps – E-Mail + Code. Schaltet das Konto frei und meldet an. */
export function verifyEmail(emailRaw: string, code: string, device?: string) {
  const email = emailRaw.trim().toLowerCase();
  const row = db.prepare('SELECT id FROM users WHERE email = ? AND verified = 0').get(email) as { id: string } | undefined;
  if (!row) throw new HttpError(400, 'Zu dieser Adresse wartet keine Anmeldung auf einen Code.');
  const done = claimByCode({ email, code, device });
  return { token: done.token, user: done.user };
}

export async function resendCode(emailRaw: string, meta: { ip?: string; userAgent?: string } = {}) {
  const email = emailRaw.trim().toLowerCase();
  const row = db.prepare('SELECT id FROM users WHERE email = ? AND verified = 0').get(email) as { id: string } | undefined;
  if (!row) throw new HttpError(400, 'Zu dieser Adresse wartet keine Anmeldung auf einen Code.');
  checkResend(row.id, 'signup');
  const user = getUser(row.id)!;
  try {
    const req = createLoginRequest(user, 'signup', meta);
    await sendLinkMail(user, 'signup', req);
    return { ok: true, requestId: req.requestId, deviceSecret: req.deviceSecret };
  } catch (err) {
    throw new HttpError(502, `Ich konnte die Bestätigungs-Mail nicht senden (${(err as Error).message}).`);
  }
}

// ---------- Konto löschen ----------

/** Konto samt allen Daten löschen: Zeilen (über ON DELETE CASCADE), Bilder/Aufnahmen und Dateien mit der Nutzer-Id. */
export function deleteAccount(user: User, password: string) {
  const hash = (db.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(user.id) as { h: string }).h;
  if (!verifyPassword(password, hash)) throw new HttpError(403, 'Das Passwort stimmt nicht.');
  if (user.role === 'owner' && userCount() > 1) throw new HttpError(400, 'Als Owner kannst du dein Konto erst löschen, wenn es keine anderen Konten mehr gibt.');

  const ids = new Set<string>();
  const collect = (json: string) => { for (const a of JSON.parse(json) as { id: string }[]) ids.add(a.id); };
  for (const r of db.prepare('SELECT attachments FROM messages WHERE user_id = ?').all(user.id) as { attachments: string }[]) collect(r.attachments);
  for (const r of db.prepare('SELECT attachments FROM items WHERE user_id = ?').all(user.id) as { attachments: string }[]) collect(r.attachments);
  for (const r of db.prepare("SELECT key FROM notified WHERE user_id = ? AND key LIKE 'file:%'").all(user.id) as { key: string }[]) ids.add(r.key.slice(5));
  for (const id of ids) { const f = filePath(id); if (f) rmSync(f, { force: true }); }
  // Dateien, die die Nutzer-Id im Namen tragen (Bücher-Anmeldung, eigene Handschrift)
  for (const dir of [config.dataDir, path.join(config.dataDir, 'fonts')]) {
    try { for (const f of readdirSync(dir)) if (f.includes(user.id)) rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* Ordner gibt es nicht */ }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

// ---------- Routen ----------

export function registerSignupRoutes(app: FastifyInstance, publicUser: (u: User) => unknown) {
  app.post('/api/auth/register', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    // Sprache: ausdrücklich gewählt, sonst aus dem Browser (Accept-Language), sonst Englisch
    const locale = isLocale(b.locale) ? b.locale : matchLocale(req.headers['accept-language']);
    const res = await startSignup({ name: str(b.name, 80), email: str(b.email), password: typeof b.password === 'string' ? b.password.slice(0, 200) : '', timeZone: str(b.timeZone, 60), device: str(b.device, 80), invite: str(b.invite, 40), locale, country: str(b.country, 10),
      ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), deviceSecret: str(b.deviceSecret, 80), edition: requestEdition(req) });
    if (!res.needsVerification) return { token: res.token, user: publicUser(res.user) };
    // Das Cookie hilft dem Link auf login.stella.evolsior.com, dieses Gerät wiederzuerkennen
    reply.header('Set-Cookie', pendingCookie(res.deviceSecret));
    return res;
  });
  app.post('/api/auth/verify', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { token, user } = verifyEmail(str(b.email), str(b.code, 20), str(b.device, 80));
    return { token, user: publicUser(user) };
  });
  app.post('/api/auth/resend', async (req, reply) => {
    const res = await resendCode(str(((req.body ?? {}) as Record<string, unknown>).email), { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });
    reply.header('Set-Cookie', pendingCookie(res.deviceSecret));
    return res;
  });
}

/** Mit Login: Profil aus der Einführung, Konto löschen */
export function registerProfileRoutes(api: FastifyInstance, publicUser: (u: User) => unknown) {
  api.put('/api/profile', async (req) => publicUser(applyProfile(req.user, cleanProfile(req.body))));
  api.post('/api/profile/skip', async (req) => publicUser(skipProfile(req.user)));
  api.delete('/api/me', async (req) => {
    deleteAccount(req.user, str(((req.body ?? {}) as Record<string, unknown>).password, 200));
    return { ok: true };
  });
}
