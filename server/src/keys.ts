// Server-Schlüssel (Groq, OpenRouter, SMTP). Reihenfolge: zuerst die Umgebung (/etc/stella/stella.env),
// dann was der Owner in den Einstellungen unter „Server“ eingetragen hat – verschlüsselt im Bereich __system__.
// Ein Schlüssel verlässt den Server nie: die Oberfläche bekommt nur „gesetzt / fehlt / zuletzt OK“.

import nodemailer from 'nodemailer';
import { config } from './config.ts';
import { deleteSecret, getSecret, HttpError, setSecret } from './auth.ts';
import { now } from './db.ts';

export const SYSTEM_SCOPE = '__system__';
export const KEY_NAMES = ['groq', 'openrouter', 'smtp'] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export const isKeyName = (v: unknown): v is KeyName => KEY_NAMES.includes(v as KeyName);

export interface SmtpKey { host: string; port: number; user: string; pass: string; from?: string }

const ENV_KEY: Record<'groq' | 'openrouter', () => string> = {
  groq: () => config.groq.apiKey,
  openrouter: () => config.openrouter.apiKey,
};

/** API-Schlüssel für Groq bzw. OpenRouter: Umgebung vor App-Eintrag. Leer = nicht gesetzt. */
export function serverKey(name: 'groq' | 'openrouter'): string {
  return ENV_KEY[name]() || getSecret<string>(SYSTEM_SCOPE, name) || '';
}

export function smtpKey(): SmtpKey | null {
  return getSecret<SmtpKey>(SYSTEM_SCOPE, 'smtp');
}

interface Health { ok: boolean; at: string; error?: string }
const lastRecorded = new Map<string, number>();

/** Merkt sich, ob der Schlüssel zuletzt funktioniert hat. Erfolge höchstens alle 5 Minuten, Fehler sofort. */
export function recordKeyResult(name: KeyName, ok: boolean, error?: string, force = false) {
  const last = lastRecorded.get(name) ?? 0;
  if (ok && !force && Date.now() - last < 5 * 60_000) return;
  lastRecorded.set(name, Date.now());
  setSecret(SYSTEM_SCOPE, `status:${name}`, { ok, at: now(), ...(error ? { error: error.slice(0, 200) } : {}) } satisfies Health);
}

export interface KeyStatus { set: boolean; source: 'env' | 'app' | null; lastOk: string | null; lastError: string | null }

export function keyStatus(): Record<KeyName, KeyStatus> {
  const out = {} as Record<KeyName, KeyStatus>;
  for (const name of KEY_NAMES) {
    const fromEnv = name !== 'smtp' && !!ENV_KEY[name]();
    const fromApp = !!getSecret(SYSTEM_SCOPE, name);
    const h = getSecret<Health>(SYSTEM_SCOPE, `status:${name}`);
    out[name] = {
      set: fromEnv || fromApp,
      source: fromEnv ? 'env' : fromApp ? 'app' : null,
      lastOk: h?.ok ? h.at : null,
      lastError: h && !h.ok ? (h.error ?? 'Fehler') : null,
    };
  }
  return out;
}

function cleanKey(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 8 || s.length > 300 || /\s/.test(s)) throw new HttpError(400, 'Das sieht nicht nach einem API-Schlüssel aus.');
  return s;
}

function cleanSmtp(v: unknown): SmtpKey {
  const o = (v ?? {}) as Record<string, unknown>;
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  const port = Number(o.port);
  const user = typeof o.user === 'string' ? o.user.trim() : '';
  const pass = typeof o.pass === 'string' ? o.pass : '';
  const from = typeof o.from === 'string' ? o.from.trim() : '';
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, 'SMTP braucht Server, Port, Benutzer und Passwort.');
  }
  return { host, port, user, pass, ...(from ? { from } : {}) };
}

/** Eintragen oder (mit null/leer) löschen. */
export function setKey(name: KeyName, value: unknown) {
  const empty = value === null || value === '' || value === undefined;
  if (empty) { deleteSecret(SYSTEM_SCOPE, name); deleteSecret(SYSTEM_SCOPE, `status:${name}`); return; }
  setSecret(SYSTEM_SCOPE, name, name === 'smtp' ? cleanSmtp(value) : cleanKey(value));
  deleteSecret(SYSTEM_SCOPE, `status:${name}`);
  lastRecorded.delete(name);
}

/** Mini-Anfrage, ob der Schlüssel funktioniert. */
export async function testKey(name: KeyName): Promise<{ ok: boolean; message: string }> {
  let result: { ok: boolean; message: string };
  try {
    if (name === 'smtp') {
      const smtp = smtpKey();
      if (!smtp) return { ok: false, message: 'SMTP ist noch nicht eingetragen.' };
      const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000 });
      await transport.verify();
      result = { ok: true, message: 'Anmeldung beim Mail-Server hat geklappt.' };
    } else {
      const key = serverKey(name);
      if (!key) return { ok: false, message: 'Dafür ist noch kein Schlüssel eingetragen.' };
      const res = name === 'groq'
        ? await fetch(`${config.groq.baseUrl}/chat/completions`, {
          method: 'POST', signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.groq.models.classify, messages: [{ role: 'user', content: 'Antworte nur mit: ok' }], max_tokens: 3 }),
        })
        : await fetch(`${config.openrouter.baseUrl}/key`, { signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${key}` } });
      result = res.ok ? { ok: true, message: 'Der Schlüssel funktioniert.' }
        : { ok: false, message: res.status === 401 || res.status === 403 ? 'Der Anbieter lehnt den Schlüssel ab.' : `Der Anbieter antwortet mit Fehler ${res.status}.` };
    }
  } catch (err) {
    result = { ok: false, message: `Nicht erreichbar: ${(err as Error).message}`.slice(0, 200) };
  }
  recordKeyResult(name, result.ok, result.ok ? undefined : result.message, true);
  return result;
}
