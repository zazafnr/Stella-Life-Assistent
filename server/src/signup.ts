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
import { voice } from '@stella/shared';
import { mailerConfigured, sendSystemMail } from './mailer.ts';
import { filePath } from './files.ts';
import { skipProfile, cleanProfile, applyProfile } from './profile.ts';

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

function issueCode(user: User) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(`INSERT INTO email_codes (user_id, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
    .run(user.id, hashCode(user.id, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), now());
  return code;
}

async function mailCode(user: User, code: string) {
  await sendSystemMail(user.email, `Dein Stella-Code: ${code}`,
    `Hallo ${user.name},\n\ndein Bestätigungs-Code für Stella lautet:\n\n    ${code}\n\nEr gilt ${CODE_MINUTES} Minuten. Falls du dich nicht bei Stella angemeldet hast, kannst du diese Mail einfach ignorieren.\n\nStella by EVOLSIOR – Built to become`, 'noreply', { purpose: 'verification', userId: user.id });
}

export async function startSignup(b: { name: string; email: string; password: string; timeZone: string; device?: string; invite?: string }) {
  const email = b.email.trim().toLowerCase();
  // das erste Konto ist der Owner: ohne Einladung, ohne Code
  if (userCount() === 0) {
    const { token, user } = registerFirst(b.name || 'Du', email, b.password, b.timeZone, b.device);
    updateUserSettings(user.id, { onboarding: 'pending' });
    addMessage(user.id, 'assistant', voice(user.settings.tone).welcome(user.name));
    return { token, user: getUser(user.id)!, needsVerification: false as const };
  }
  const mode = registrationMode();
  if (mode === 'closed') throw new HttpError(403, 'Registrierung ist geschlossen.');
  const invite = mode === 'invite' ? claimInvite(b.invite ?? '') : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse an.');
  if (b.password.length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben.');
  if (!mailerConfigured()) throw new HttpError(503, 'Dieser Server kann gerade keine Bestätigungs-Mails verschicken. Bitte melde dich beim Betreiber.');

  // eine nicht bestätigte Anmeldung mit derselben Adresse wird ersetzt (z. B. Tippfehler im Passwort, Code nie angekommen)
  const old = db.prepare('SELECT id, verified FROM users WHERE email = ?').get(email) as { id: string; verified: number } | undefined;
  if (old?.verified) throw new HttpError(409, 'Diese E-Mail ist schon registriert.');
  if (old) db.prepare('DELETE FROM users WHERE id = ?').run(old.id); // Einladung wird dabei wieder frei (ON DELETE SET NULL)

  const id = newId();
  db.prepare('INSERT INTO users (id, name, email, password_hash, time_zone, ingest_token, created_at, role, verified, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, b.name.trim().slice(0, 80) || 'Du', email, hashPassword(b.password), b.timeZone || config.defaultTimeZone, randomBytes(24).toString('base64url'), now(), 'user', JSON.stringify({ onboarding: 'pending' }));
  if (invite) db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(id, invite);
  const user = getUser(id)!;
  try {
    await mailCode(user, issueCode(user));
  } catch (err) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    throw new HttpError(502, `Ich konnte die Bestätigungs-Mail nicht senden (${(err as Error).message}).`);
  }
  return { needsVerification: true as const, email };
}

export function verifyEmail(emailRaw: string, code: string, device?: string) {
  const email = emailRaw.trim().toLowerCase();
  const row = db.prepare('SELECT id, name FROM users WHERE email = ? AND verified = 0').get(email) as { id: string; name: string } | undefined;
  if (!row) throw new HttpError(400, 'Zu dieser Adresse wartet keine Anmeldung auf einen Code.');
  const c = db.prepare('SELECT code_hash AS hash, expires_at AS expiresAt, attempts FROM email_codes WHERE user_id = ?').get(row.id) as
    { hash: string; expiresAt: string; attempts: number } | undefined;
  if (!c) throw new HttpError(400, 'Es ist kein Code offen – fordere einen neuen an.', { needsNewCode: true });
  if (c.expiresAt < now()) throw new HttpError(400, 'Der Code ist abgelaufen – fordere einen neuen an.', { needsNewCode: true });
  const given = Buffer.from(hashCode(row.id, code.replace(/\D/g, '')));
  const real = Buffer.from(c.hash);
  if (given.length !== real.length || !timingSafeEqual(given, real)) {
    const attempts = c.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(row.id);
      throw new HttpError(429, 'Zu viele falsche Eingaben – fordere einen neuen Code an.', { needsNewCode: true });
    }
    db.prepare('UPDATE email_codes SET attempts = ? WHERE user_id = ?').run(attempts, row.id);
    throw new HttpError(400, `Der Code stimmt nicht. Noch ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? 'Versuch' : 'Versuche'}.`);
  }
  db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(row.id);
  db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(row.id);
  const user = getUser(row.id)!;
  addMessage(user.id, 'assistant', voice(user.settings.tone).welcome(user.name));
  return { token: createSession(user.id, device), user };
}

export async function resendCode(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const row = db.prepare('SELECT id FROM users WHERE email = ? AND verified = 0').get(email) as { id: string } | undefined;
  if (!row) throw new HttpError(400, 'Zu dieser Adresse wartet keine Anmeldung auf einen Code.');
  const last = db.prepare('SELECT sent_at AS sentAt FROM email_codes WHERE user_id = ?').get(row.id) as { sentAt: string } | undefined;
  const wait = last ? Math.ceil((Date.parse(last.sentAt) + RESEND_SECONDS * 1000 - Date.now()) / 1000) : 0;
  if (wait > 0) throw new HttpError(429, `Bitte warte noch ${wait} Sekunden, bevor du einen neuen Code anforderst.`, { retryIn: wait });
  const user = getUser(row.id)!;
  try {
    await mailCode(user, issueCode(user));
  } catch (err) {
    throw new HttpError(502, `Ich konnte die Bestätigungs-Mail nicht senden (${(err as Error).message}).`);
  }
  return { ok: true };
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
  app.post('/api/auth/register', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const res = await startSignup({ name: str(b.name, 80), email: str(b.email), password: typeof b.password === 'string' ? b.password.slice(0, 200) : '', timeZone: str(b.timeZone, 60), device: str(b.device, 80), invite: str(b.invite, 40) });
    return res.needsVerification ? res : { token: res.token, user: publicUser(res.user) };
  });
  app.post('/api/auth/verify', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { token, user } = verifyEmail(str(b.email), str(b.code, 20), str(b.device, 80));
    return { token, user: publicUser(user) };
  });
  app.post('/api/auth/resend', async (req) => resendCode(str(((req.body ?? {}) as Record<string, unknown>).email)));
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
