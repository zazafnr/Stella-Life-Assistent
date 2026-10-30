import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-oauth-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_PUBLIC_URL = 'https://stella.example.at';
process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'geheim';

const { register } = await import('./auth.ts');
const { listAccounts, publicAccounts, saveAccounts } = await import('./mail.ts');
const { accessToken, finishGoogle, finishTarget, googleAuthUrl, makeState, readState } = await import('./oauth.ts');

const { user } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');

// Google nachbauen: Token-Endpunkt antwortet je nach grant_type
const calls: URLSearchParams[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string, init?: { body?: URLSearchParams }) => {
  const body = new URLSearchParams(String(init?.body));
  calls.push(body);
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'lukas@gmail.com', email_verified: true })).toString('base64url')}.y`;
  const data = body.get('grant_type') === 'authorization_code'
    ? { access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1', id_token: idToken }
    : { access_token: 'access-2', expires_in: 3600 };
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

test('state ist signiert, läuft ab und lässt sich nicht fälschen', () => {
  const s = makeState(user.id, 'ios');
  assert.deepEqual({ u: readState(s)!.u, c: readState(s)!.c }, { u: user.id, c: 'ios' });
  const [body] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'jemand-anders', c: 'web', n: 'x', exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(readState(`${forged}.${s.split('.')[1]}`), null);
  assert.equal(readState(`${body}.kaputt`), null);
  assert.equal(readState('quatsch'), null);
});

test('Anmelde-Link fragt nach Gmail-Zugriff mit Refresh-Token', () => {
  const url = new URL(googleAuthUrl(user.id, 'web'));
  assert.equal(url.host, 'accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://stella.example.at/api/oauth/google/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope')!, /https:\/\/mail\.google\.com\//);
  assert.ok(readState(url.searchParams.get('state')!));
});

test('Callback-Code → Gmail-Postfach mit Refresh-Token, App-Passwort-Postfach wird umgestellt', async () => {
  saveAccounts(user.id, [{ id: 'alt', provider: 'gmail', label: 'Privat', host: 'imap.gmail.com', port: 993, user: 'Lukas@gmail.com', pass: 'app-passwort' }]);
  const account = await finishGoogle(user.id, 'code-xyz');
  assert.equal(calls.at(-1)!.get('code'), 'code-xyz');
  const saved = listAccounts(user.id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.id, 'alt');
  assert.equal(saved[0]!.label, 'Privat');
  assert.equal(saved[0]!.pass, '');
  assert.deepEqual(saved[0]!.oauth, { provider: 'google', refreshToken: 'refresh-1' });
  assert.equal(account.user, 'lukas@gmail.com');

  // nach außen nie Token oder Passwort
  const pub = publicAccounts(user.id)[0] as Record<string, unknown>;
  assert.equal(pub.auth, 'google');
  assert.ok(!('oauth' in pub) && !('pass' in pub));
});

test('Access-Token kommt aus dem Zwischenspeicher oder per Refresh', async () => {
  const account = listAccounts(user.id)[0]!;
  assert.equal(await accessToken(account), 'access-1');
  const other = { ...account, id: 'neu' };
  assert.equal(await accessToken(other), 'access-2');
  assert.equal(calls.at(-1)!.get('grant_type'), 'refresh_token');
  assert.equal(calls.at(-1)!.get('refresh_token'), 'refresh-1');
});

test('Rückweg: iOS über stella-auth://, Web zurück in die Einstellungen, PC bekommt eine Abschlussseite', () => {
  assert.match(finishTarget('ios', true, 'ok').redirect!, /^stella-auth:\/\/done\?provider=gmail&ok=1/);
  assert.match(finishTarget('web', false, 'nein').redirect!, /^https:\/\/stella\.example\.at\/\?.*ok=0.*#settings$/);
  const html = finishTarget('desktop', true, '<b>x</b>').html!;
  assert.match(html, /Gmail ist verbunden/);
  assert.ok(!html.includes('<b>x</b>'));
  globalThis.fetch = realFetch;
});
