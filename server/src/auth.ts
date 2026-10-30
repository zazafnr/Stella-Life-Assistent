import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { db, getUser, newId, now, type User } from './db.ts';

// ---------- Passwörter ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------- Sitzungen (ein Token pro Gerät) ----------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function createSession(userId: string, device?: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, device ?? null, now(), now());
  return token;
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function register(name: string, email: string, password: string, timeZone: string, device?: string) {
  if (userCount() > 0 && !config.allowRegistration) throw new HttpError(403, 'Registrierung ist geschlossen.');
  if (password.length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben.');
  const id = newId();
  const role = userCount() === 0 ? 'owner' : 'user';
  try {
    db.prepare('INSERT INTO users (id, name, email, password_hash, time_zone, ingest_token, created_at, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, name.trim(), email.trim().toLowerCase(), hashPassword(password), timeZone || config.defaultTimeZone,
        randomBytes(24).toString('base64url'), now(), role);
  } catch {
    throw new HttpError(409, 'Diese E-Mail ist schon registriert.');
  }
  return { token: createSession(id, device), user: getUser(id)! };
}

// Schutz gegen Passwort-Raten: nach 8 Fehlversuchen je Adresse bzw. je E-Mail 15 Minuten Pause.
const FAIL_LIMIT = 8;
const FAIL_WINDOW = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

function checkLocked(keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k);
    if (f && f.until > now && f.count >= FAIL_LIMIT) {
      throw new HttpError(429, `Zu viele Fehlversuche – bitte in ${Math.ceil((f.until - now) / 60_000)} Minuten nochmal.`);
    }
  }
}

function noteFailure(keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k);
    failures.set(k, f && f.until > now ? { count: f.count + 1, until: f.until } : { count: 1, until: now + FAIL_WINDOW });
  }
  if (failures.size > 10_000) for (const [k, f] of failures) if (f.until <= now) failures.delete(k);
}

export function login(email: string, password: string, device?: string, ip = '') {
  const mail = email.trim().toLowerCase();
  const keys = [`mail:${mail}`, ...(ip ? [`ip:${ip}`] : [])];
  checkLocked(keys);
  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(mail) as
    { id: string; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    noteFailure(keys);
    throw new HttpError(401, 'E-Mail oder Passwort falsch.');
  }
  keys.forEach((k) => failures.delete(k));
  return { token: createSession(row.id, device), user: getUser(row.id)! };
}

export function logout(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const row = token
    ? db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(sha256(token)) as { user_id: string } | undefined
    : undefined;
  const user = row && getUser(row.user_id);
  if (!user) return reply.code(401).send({ error: 'Nicht angemeldet.' });
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), sha256(token));
  req.user = user;
}

export function userByIngestToken(token: string): User | null {
  const row = db.prepare('SELECT id FROM users WHERE ingest_token = ?').get(token) as { id: string } | undefined;
  return row ? getUser(row.id) : null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ---------- Verschlüsselte Zugangsdaten (digi4school, E-Mail-Konten …) ----------

const key = createHash('sha256').update(config.secret || 'stella-insecure-dev-secret').digest();

export function setSecret(userId: string, name: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const packed = [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  db.prepare('INSERT OR REPLACE INTO secrets (user_id, name, value) VALUES (?, ?, ?)').run(userId, name, packed);
}

export function getSecret<T>(userId: string, name: string): T | null {
  const row = db.prepare('SELECT value FROM secrets WHERE user_id = ? AND name = ?').get(userId, name) as { value: string } | undefined;
  if (!row) return null;
  const [iv, tag, data] = row.value.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

export function hasSecret(userId: string, name: string): boolean {
  return !!db.prepare('SELECT 1 FROM secrets WHERE user_id = ? AND name = ?').get(userId, name);
}

export function deleteSecret(userId: string, name: string) {
  db.prepare('DELETE FROM secrets WHERE user_id = ? AND name = ?').run(userId, name);
}
