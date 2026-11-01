// Server-Schlüssel (Groq, OpenRouter, SMTP). Reihenfolge: zuerst die Umgebung (/etc/stella/stella.env),
// dann was der Owner in den Einstellungen unter „Server“ eingetragen hat – verschlüsselt im Bereich __system__.
// Ein Schlüssel verlässt den Server nie: die Oberfläche bekommt nur „gesetzt / fehlt / zuletzt OK“.

import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from './config.ts';
import { deleteSecret, getSecret, HttpError, setSecret } from './auth.ts';
import { now } from './db.ts';

export const SYSTEM_SCOPE = '__system__';
export const KEY_NAMES = ['anthropic', 'groq', 'openrouter', 'smtp', 'stripe', 'telegram'] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export const isKeyName = (v: unknown): v is KeyName => KEY_NAMES.includes(v as KeyName);

export interface SmtpKey { host: string; port: number; user: string; pass: string; from?: string }
/** Stripe: geheimer Schlüssel (sk_…) und Signatur-Geheimnis des Webhooks (whsec_…) */
export interface StripeKey { secretKey: string; webhookSecret: string }

/** Telegram: Bot-Token von @BotFather, geheimes Webhook-Token (wir erzeugen es) und der Benutzername des Bots */
export interface TelegramKey { token: string; secret: string; username?: string }

type ApiKeyName = 'anthropic' | 'groq' | 'openrouter';

const ENV_KEY: Record<ApiKeyName, () => string> = {
  anthropic: () => config.anthropic.apiKey,
  groq: () => config.groq.apiKey,
  openrouter: () => config.openrouter.apiKey,
};

/** API-Schlüssel für Groq bzw. OpenRouter: Umgebung vor App-Eintrag. Leer = nicht gesetzt. */
export function serverKey(name: ApiKeyName): string {
  return ENV_KEY[name]() || getSecret<string>(SYSTEM_SCOPE, name) || '';
}

export function smtpKey(): SmtpKey | null {
  return getSecret<SmtpKey>(SYSTEM_SCOPE, 'smtp');
}

export function stripeKey(): StripeKey | null {
  const stored = getSecret<StripeKey>(SYSTEM_SCOPE, 'stripe');
  const secretKey = process.env.STRIPE_SECRET_KEY || stored?.secretKey || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || stored?.webhookSecret || '';
  return secretKey ? { secretKey, webhookSecret } : null;
}

export function telegramKey(): TelegramKey | null {
  const stored = getSecret<TelegramKey>(SYSTEM_SCOPE, 'telegram');
  const token = process.env.TELEGRAM_BOT_TOKEN || stored?.token || '';
  return token ? { token, secret: stored?.secret ?? '', ...(stored?.username ? { username: stored.username } : {}) } : null;
}

/** Benutzernamen des Bots merken (nach getMe) */
export function saveTelegramUsername(username: string) {
  const k = telegramKey();
  if (k) setSecret(SYSTEM_SCOPE, 'telegram', { ...k, username });
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
    const fromEnv = name !== 'smtp' && name !== 'stripe' && name !== 'telegram' && !!ENV_KEY[name]();
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

function cleanStripe(v: unknown): StripeKey {
  const o = (v ?? {}) as Record<string, unknown>;
  const secretKey = typeof o.secretKey === 'string' ? o.secretKey.trim() : '';
  const webhookSecret = typeof o.webhookSecret === 'string' ? o.webhookSecret.trim() : '';
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(secretKey)) throw new HttpError(400, 'Das sieht nicht nach einem geheimen Stripe-Schlüssel aus (sk_live_… oder sk_test_…).');
  if (webhookSecret && !/^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(webhookSecret)) throw new HttpError(400, 'Das Webhook-Geheimnis beginnt mit whsec_.');
  return { secretKey, webhookSecret };
}

function cleanTelegram(v: unknown): TelegramKey {
  const token = typeof v === 'string' ? v.trim() : typeof (v as { token?: unknown })?.token === 'string' ? (v as { token: string }).token.trim() : '';
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new HttpError(400, 'Das sieht nicht nach einem Bot-Token von @BotFather aus (123456:ABC…).');
  const old = getSecret<TelegramKey>(SYSTEM_SCOPE, 'telegram');
  return { token, secret: old?.token === token && old.secret ? old.secret : randomBytes(24).toString('hex') };
}

/** Eintragen oder (mit null/leer) löschen. */
export function setKey(name: KeyName, value: unknown) {
  const empty = value === null || value === '' || value === undefined;
  if (empty) { deleteSecret(SYSTEM_SCOPE, name); deleteSecret(SYSTEM_SCOPE, `status:${name}`); return; }
  setSecret(SYSTEM_SCOPE, name, name === 'smtp' ? cleanSmtp(value) : name === 'stripe' ? cleanStripe(value) : name === 'telegram' ? cleanTelegram(value) : cleanKey(value));
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
    } else if (name === 'telegram') {
      const k = telegramKey();
      if (!k) return { ok: false, message: 'Telegram ist noch nicht eingetragen.' };
      const res = await fetch(`${config.telegram.baseUrl}/bot${k.token}/getMe`, { signal: AbortSignal.timeout(15_000) });
      const me = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string } };
      if (res.ok && me.ok && me.result?.username) { saveTelegramUsername(me.result.username); result = { ok: true, message: `Der Bot @${me.result.username} antwortet.` }; }
      else result = { ok: false, message: res.status === 401 ? 'Telegram lehnt den Token ab.' : `Telegram antwortet mit Fehler ${res.status}.` };
    } else if (name === 'stripe') {
      const k = stripeKey();
      if (!k) return { ok: false, message: 'Stripe ist noch nicht eingetragen.' };
      const res = await fetch(`${config.stripe.baseUrl}/v1/balance`, { signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${k.secretKey}` } });
      result = res.ok
        ? { ok: true, message: `Der Schlüssel funktioniert (${k.secretKey.startsWith('sk_live') || k.secretKey.startsWith('rk_live') ? 'Live' : 'Test'}-Modus)${k.webhookSecret ? '' : ' – das Webhook-Geheimnis fehlt noch.'}` }
        : { ok: false, message: res.status === 401 ? 'Stripe lehnt den Schlüssel ab.' : `Stripe antwortet mit Fehler ${res.status}.` };
    } else {
      const key = serverKey(name as 'anthropic' | 'groq' | 'openrouter');
      if (!key) return { ok: false, message: 'Dafür ist noch kein Schlüssel eingetragen.' };
      const res = name === 'anthropic'
        ? await fetch(`${config.anthropic.baseUrl || 'https://api.anthropic.com'}/v1/models?limit=1`, {
          signal: AbortSignal.timeout(15_000), headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        })
        : name === 'groq'
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

// ---------- Einstellungen des Servers (nur Owner) ----------
// Kleine Schalter, die man ohne Neustart ändern können soll – gleiche verschlüsselte Ablage wie die Schlüssel.

export interface ServerAiSettings {
  /** Notfall: Wenn Claude ausfällt, darf Stella auf die Gratis-Modelle von OpenRouter ausweichen. Mails gehen nie dorthin. */
  allowFreeFallback: boolean;
}

export function serverAiSettings(): ServerAiSettings {
  const stored = getSecret<Partial<ServerAiSettings>>(SYSTEM_SCOPE, 'setting:ai') ?? {};
  return { allowFreeFallback: stored.allowFreeFallback ?? process.env.STELLA_ALLOW_FREE_FALLBACK === 'true' };
}

export function setServerAiSettings(patch: Partial<ServerAiSettings>): ServerAiSettings {
  const next = { ...serverAiSettings(), ...(typeof patch.allowFreeFallback === 'boolean' ? { allowFreeFallback: patch.allowFreeFallback } : {}) };
  setSecret(SYSTEM_SCOPE, 'setting:ai', next);
  return next;
}
