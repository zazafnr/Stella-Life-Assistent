// "Mit Google anmelden" für Gmail – statt App-Passwort.
//
// Ablauf (OAuth 2.0, Authorization Code):
//   App fragt /api/oauth/google/start → bekommt die Google-Adresse mit signiertem `state`
//   → Nutzer meldet sich bei Google an → Google schickt ihn zu /api/oauth/google/callback
//   → Stella tauscht den Code gegen ein Refresh-Token und legt das Postfach an.
// Das Refresh-Token liegt verschlüsselt wie alle Zugangsdaten (setSecret). Für IMAP holt
// Stella daraus jeweils ein kurzlebiges Access-Token (XOAUTH2).
//
// Einmalig nötig: ein OAuth-Client in der Google Cloud Console → GOOGLE_CLIENT_ID und
// GOOGLE_CLIENT_SECRET in /etc/stella/stella.env (Anleitung: docs/google-oauth.md).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { newId } from './db.ts';
import { listAccounts, PRESETS, saveAccounts, type MailAccount } from './mail.ts';

export type OAuthClient = 'web' | 'desktop' | 'ios';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** volles IMAP-Postfach (lesen, verschieben, Papierkorb) + E-Mail-Adresse */
const SCOPES = ['https://mail.google.com/', 'openid', 'email'];

export const googleConfigured = () => !!(config.google.clientId && config.google.clientSecret);
export const redirectUri = () => `${config.publicUrl}/api/oauth/google/callback`;

interface State { u: string; c: OAuthClient; n: string; exp: number; /** 'link': nur eine E-Mail-Adresse bestätigen, kein Postfachzugriff */ p?: 'link' }

const sign = (data: string) => createHmac('sha256', `oauth:${config.secret || 'stella'}`).update(data).digest('base64url');

export function makeState(userId: string, client: OAuthClient, purpose?: 'link'): string {
  const body = Buffer.from(JSON.stringify({ u: userId, c: client, n: randomBytes(8).toString('hex'), exp: Date.now() + 15 * 60_000, ...(purpose ? { p: purpose } : {}) } satisfies State))
    .toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readState(state: string): State | null {
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as State;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function googleAuthUrl(userId: string, client: OAuthClient, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // ohne "consent" liefert Google beim zweiten Mal kein Refresh-Token
    prompt: 'consent select_account',
    state: makeState(userId, client),
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `${AUTH_URL}?${q}`;
}

/** Nur die Adresse bestätigen (Bereiche openid + email): kein Zugriff auf das Postfach, braucht keine Prüfung durch Google. */
export function googleLinkUrl(userId: string, client: OAuthClient): string {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email',
    prompt: 'select_account',
    state: makeState(userId, client, 'link'),
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({})) as TokenResponse;
  if (!res.ok || data.error) throw new Error(data.error_description || data.error || `Google antwortet mit ${res.status}`);
  return data;
}

/** E-Mail-Adresse aus dem ID-Token. Das Token kommt direkt von Google über TLS – eine Signaturprüfung ist hier nicht nötig. */
function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string; email_verified?: boolean };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

/** Code aus dem Callback einlösen: die von Google bestätigte Adresse zurückgeben (für „Mail an Stella“). */
export async function finishGoogleLink(code: string): Promise<string> {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  const payload = tokens.id_token?.split('.')[1];
  let claims: { email?: string; email_verified?: boolean } = {};
  try { claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()); } catch { /* unten abgelehnt */ }
  if (!claims.email) throw new Error('Google hat keine E-Mail-Adresse mitgeschickt');
  if (claims.email_verified === false) throw new Error('Google hat diese Adresse nicht als bestätigt gemeldet');
  return claims.email.toLowerCase();
}

/** Code aus dem Callback einlösen und das Gmail-Postfach anlegen (oder ein App-Passwort-Postfach umstellen). */
export async function finishGoogle(userId: string, code: string): Promise<MailAccount> {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  const email = emailFromIdToken(tokens.id_token);
  if (!email) throw new Error('Google hat keine E-Mail-Adresse mitgeschickt');
  const existing = listAccounts(userId);
  const old = existing.find((a) => a.user.toLowerCase() === email.toLowerCase());
  const refreshToken = tokens.refresh_token ?? old?.oauth?.refreshToken;
  if (!refreshToken) throw new Error('Google hat kein Refresh-Token geschickt – bitte unter myaccount.google.com → Sicherheit → Drittanbieter-Zugriff Stella entfernen und nochmal verbinden.');

  const account: MailAccount = {
    id: old?.id ?? newId(), provider: 'gmail', label: old?.label ?? email, ...PRESETS.gmail,
    user: email, pass: '', oauth: { provider: 'google', refreshToken },
  };
  saveAccounts(userId, old ? existing.map((a) => (a.id === old.id ? account : a)) : [...existing, account]);
  cache.set(account.id, { token: tokens.access_token, exp: Date.now() + (tokens.expires_in - 60) * 1000 });
  return account;
}

const cache = new Map<string, { token: string; exp: number }>();

/** gültiges Access-Token für IMAP (aus dem Zwischenspeicher oder frisch per Refresh-Token) */
export async function accessToken(account: MailAccount): Promise<string> {
  const hit = cache.get(account.id);
  if (hit && hit.exp > Date.now()) return hit.token;
  if (!account.oauth) throw new Error('Kein Google-Zugang hinterlegt');
  if (!googleConfigured()) throw new Error('Google-Anmeldung ist auf dem Server nicht eingerichtet (GOOGLE_CLIENT_ID fehlt)');
  try {
    const t = await tokenRequest({ refresh_token: account.oauth.refreshToken, grant_type: 'refresh_token' });
    cache.set(account.id, { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
    return t.access_token;
  } catch (err) {
    throw new Error(`Google-Zugang abgelaufen oder entzogen – bitte in den Einstellungen neu verbinden (${(err as Error).message})`);
  }
}

// ----- Seiten nach der Anmeldung -----

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Wohin es nach Google zurückgeht: Web-App, iOS-App (fängt stella-auth:// ab) oder eine Abschlussseite für den Browser. */
export function finishTarget(client: OAuthClient, ok: boolean, message: string, what: 'gmail' | 'link' = 'gmail'): { redirect?: string; html?: string } {
  const q = new URLSearchParams({ provider: what === 'link' ? 'address' : 'gmail', ok: ok ? '1' : '0', message });
  if (client === 'ios') return { redirect: `stella-auth://done?${q}` };
  if (client === 'web') return { redirect: `${config.publicUrl}/?${q}#settings` };
  return {
    html: `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stella</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#0F2A4A;
background:linear-gradient(180deg,#CFE6FF,#E8F3FF 45%,#F5F9FF)}
.card{background:#fff;border-radius:24px;padding:36px 40px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(31,111,235,.15)}
h1{font-size:22px;margin:12px 0 8px}p{color:#5B7190;line-height:1.5;margin:0}.big{font-size:44px}
</style></head><body><div class="card"><div class="big">${ok ? '✅' : '😕'}</div>
<h1>${ok ? (what === 'link' ? 'Adresse ist verknüpft' : 'Gmail ist verbunden') : 'Das hat nicht geklappt'}</h1><p>${esc(message)}</p>
<p style="margin-top:14px">Du kannst dieses Fenster schließen und zu Stella zurückgehen.</p></div></body></html>`,
  };
}
