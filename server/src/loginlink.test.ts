import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-link-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_REGISTRATION = 'open';
process.env.STELLA_LOGIN_URL = 'https://login.stella.evolsior.com';
process.env.STELLA_APPLE_TEAM_ID = 'TEAM123456';

const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const { setMailTransportFactory } = await import('./mailer.ts');
setMailTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string; html?: string }) => { sent.push(m); return {} as never; } }));
const { setKey } = await import('./keys.ts');
setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'noreply@evolsior.com', pass: 'x', from: 'Stella <noreply@evolsior.com>' });

const { registerSignupRoutes } = await import('./signup.ts');
const { registerLoginApi, registerLoginRoutes, registerPasswordRoute, setPublicUser, codeForToken } = await import('./loginlink.ts');
const { HttpError, register, requireUser, login } = await import('./auth.ts');
const { db, getUser } = await import('./db.ts');

register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna');

const app = Fastify({ maxParamLength: 1000 });
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message, ...(err instanceof HttpError ? err.extra : {}) }));
const publicUser = (u: { id: string; name: string; email: string; settings: unknown }) => ({ id: u.id, name: u.name, email: u.email, settings: u.settings });
registerSignupRoutes(app, publicUser as never);
registerLoginApi(app);
registerLoginRoutes(app);
setPublicUser(publicUser as never);
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerPasswordRoute(api); });
await app.ready();
after(() => app.close());

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const tokenOf = (text: string) => /\/v\/([\w-]+)/.exec(text)![1]!;
const setCookie = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie'] ?? '');
const cookieOf = (res: { headers: Record<string, unknown> }) => /stella_pending=([^;]+)/.exec(setCookie(res))![1]!;

async function signup(email: string, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1') {
  const res = await post('/api/auth/register', { name: 'Mia', email, password: 'supergeheim', timeZone: 'Europe/Vienna', locale: 'en' }, { 'user-agent': ua });
  assert.equal(res.statusCode, 200, res.body);
  return { res, ...res.json() as { requestId: string; deviceSecret: string } };
}

test('Registrieren: Mail mit Link auf login.stella.evolsior.com, Cookie fürs wartende Gerät, Token und Code nur als Hash gespeichert', async () => {
  const { res, requestId, deviceSecret } = await signup('mia@example.com');
  const mail = sent.at(-1)!;
  const token = tokenOf(mail.text);
  assert.match(mail.text, /https:\/\/login\.stella\.evolsior\.com\/v\//);
  assert.ok(!mail.text.includes(codeForToken(token)), 'der Code steht nicht in der Mail');
  const cookie = setCookie(res);
  assert.match(cookie, /^stella_pending=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=900', 'Domain=stella.evolsior.com']) assert.ok(cookie.includes(flag), `Cookie ohne ${flag}: ${cookie}`);
  const row = db.prepare('SELECT * FROM login_requests WHERE id = ?').get(requestId) as Record<string, string>;
  assert.ok(row.token_hash && row.token_hash !== token && row.code_hash !== codeForToken(token) && row.device_hash !== deviceSecret, 'nur Hashes in der Datenbank');
  assert.ok(!JSON.stringify(row).includes(token) && !JSON.stringify(row).includes(deviceSecret));
});

test('GET auf den Link verbraucht nichts (Mail-Scanner), zeigt auf fremdem Gerät nur den Code mit Angaben zur Anfrage', async () => {
  // Die Seite nennt das Gerät, das die Anmeldung ANGEFORDERT hat (hier ein iPhone) – so erkennt man fremde Versuche
  const { requestId, deviceSecret } = await signup('scan@example.com');
  const token = tokenOf(sent.at(-1)!.text);
  for (let i = 0; i < 3; i++) {
    const page = await app.inject({ method: 'GET', url: `/v/${token}`, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' } });
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes(codeForToken(token)), 'Code wird gezeigt');
    assert.match(page.body, /Safari · iPhone\/iPad/);
    assert.match(page.body, /Not you\?/);
  }
  const row = db.prepare('SELECT used_at, claimed_at FROM login_requests WHERE id = ?').get(requestId) as { used_at: string | null; claimed_at: string | null };
  assert.equal(row.used_at, null, 'GET hat nichts verbraucht');
  // das wartende Gerät bekommt keine Sitzung, nur weil jemand den Link geöffnet hat
  const waiting = await post('/api/auth/link/claim', { requestId, deviceSecret });
  assert.equal(waiting.statusCode, 202);
});

test('gleiches Gerät: Cookie passt → Seite schließt ab → wartendes Gerät holt die Sitzung (einmal), Konto ist bestätigt, Willkommensnachricht und -mail', async () => {
  const { requestId, deviceSecret } = await signup('same@example.com');
  const token = tokenOf(sent.at(-1)!.text);
  const before = sent.length;
  const page = await app.inject({ method: 'GET', url: `/v/${token}`, headers: { cookie: `stella_pending=${deviceSecret}` } });
  assert.match(page.body, /Finish signing in/);
  assert.match(page.body, /<form method="post"/, 'ohne JavaScript gibt es den Knopf');
  const done = await app.inject({ method: 'POST', url: `/v/${token}`, headers: { cookie: `stella_pending=${deviceSecret}`, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  assert.equal(done.statusCode, 200);
  assert.match(done.body, /You are signed in/);

  const claimed = await post('/api/auth/link/claim', { requestId, deviceSecret });
  assert.equal(claimed.statusCode, 200, claimed.body);
  assert.ok(claimed.json().token);
  const user = getUser(claimed.json().user.id)!;
  assert.equal(user.verified, true);
  assert.equal((await post('/api/auth/link/claim', { requestId, deviceSecret })).statusCode, 409, 'nur einmal abholbar');
  assert.ok(sent.length > before, 'Willkommens-Mail');
  assert.equal(sent.at(-1)!.subject, 'Welcome to Stella');
  const again = await app.inject({ method: 'GET', url: `/v/${token}` });
  assert.match(again.body, /You are signed in/, 'benutzter Link zeigt freundlich "erledigt"');
});

test('anderes Gerät: Klick meldet das wartende Gerät NICHT an – nur der abgetippte Code, einmal, mit Fehlversuch-Sperre', async () => {
  const a = await signup('other@example.com');
  const token = tokenOf(sent.at(-1)!.text);
  // fremdes Gerät (falsches oder fehlendes Cookie) versucht zu bestätigen
  const foreign = await app.inject({ method: 'POST', url: `/v/${token}`, headers: { cookie: 'stella_pending=falschesGeheimnisFalschesGeheimnis', 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  assert.notEqual(foreign.statusCode, 500);
  assert.equal((await post('/api/auth/link/claim', { requestId: a.requestId, deviceSecret: a.deviceSecret })).statusCode, 202, 'wartendes Gerät bleibt abgemeldet');
  assert.equal((await post('/api/auth/link/confirm', { token, deviceSecret: 'falschesGeheimnisFalschesGeheimnis' })).statusCode, 403);

  // Code: falsch → Zähler, richtig → Sitzung; mit falschem Gerätegeheimnis geht es nicht
  const code = codeForToken(token);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await post('/api/auth/link/code', { requestId: a.requestId, deviceSecret: 'x'.repeat(24), code })).statusCode, 403);
  const bad = await post('/api/auth/link/code', { requestId: a.requestId, deviceSecret: a.deviceSecret, code: wrong });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /Noch 4 Versuche/);
  const ok = await post('/api/auth/link/code', { requestId: a.requestId, deviceSecret: a.deviceSecret, code });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().token);
  assert.equal((await post('/api/auth/link/code', { requestId: a.requestId, deviceSecret: a.deviceSecret, code })).statusCode, 400, 'Code ist nur einmal verwendbar');

  // 5 Fehlversuche sperren die Anfrage
  const b = await signup('lock@example.com');
  const tokenB = tokenOf(sent.at(-1)!.text);
  const wrongB = codeForToken(tokenB) === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) await post('/api/auth/link/code', { requestId: b.requestId, deviceSecret: b.deviceSecret, code: wrongB });
  const locked = await post('/api/auth/link/code', { requestId: b.requestId, deviceSecret: b.deviceSecret, code: wrongB });
  assert.equal(locked.statusCode, 429);
  assert.equal((await post('/api/auth/link/code', { requestId: b.requestId, deviceSecret: b.deviceSecret, code: codeForToken(tokenB) })).statusCode, 400, 'danach gilt auch der richtige Code nicht mehr');
});

test('abgelaufen und ungültig: freundliche Seiten, kein Absturz', async () => {
  const a = await signup('late@example.com');
  const token = tokenOf(sent.at(-1)!.text);
  db.prepare('UPDATE login_requests SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), a.requestId);
  const page = await app.inject({ method: 'GET', url: `/v/${token}` });
  assert.equal(page.statusCode, 410);
  assert.match(page.body, /expired/);
  assert.equal((await post('/api/auth/link/claim', { requestId: a.requestId, deviceSecret: a.deviceSecret })).statusCode, 410);
  const invalid = await app.inject({ method: 'GET', url: '/v/gibtEsNichtGibtEsNichtGibtEsNicht12345678901' });
  assert.equal(invalid.statusCode, 404);
  assert.match(invalid.body, /does not work/);
  // die Seite spricht die Sprache der Anfrage
  const de = await app.inject({ method: 'GET', url: '/v/gibtEsNicht', headers: { 'accept-language': 'de-AT,de;q=0.9' } });
  assert.match(de.body, /funktioniert nicht/);
  const tr = await app.inject({ method: 'GET', url: '/v/gibtEsNicht', headers: { 'accept-language': 'tr-TR' } });
  assert.match(tr.body, /çalışmıyor/);
});

test('„Passwort vergessen“ Ende zu Ende: Link anfordern (gleiche Antwort für unbekannte Adressen) → Mail → bestätigen → neues Passwort → Login', async () => {
  const { requestId, deviceSecret } = await signup('forgot@example.com');
  const token0 = tokenOf(sent.at(-1)!.text);
  await post('/api/auth/link/code', { requestId, deviceSecret, code: codeForToken(token0) }); // Konto bestätigt

  const unknown = await post('/api/auth/link/request', { email: 'niemand@example.com', purpose: 'reset' });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.json().ok, true, 'verrät nicht, ob es das Konto gibt');
  const before = sent.length;

  db.prepare("UPDATE login_requests SET created_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'forgot@example.com')").run(new Date(Date.now() - 120_000).toISOString());
  const req = await post('/api/auth/link/request', { email: 'forgot@example.com', purpose: 'reset', locale: 'de' });
  assert.equal(req.statusCode, 200, req.body);
  assert.equal(sent.length, before + 1);
  const mail = sent.at(-1)!;
  assert.equal(mail.subject, 'Reset your Stella password', 'Mail in der Sprache des Kontos (en), nicht der Anfrage');
  assert.match(mail.text, /\/v\//);
  const { requestId: rid, deviceSecret: secret } = req.json();
  const token = tokenOf(mail.text);
  assert.equal((await post('/api/auth/link/claim', { requestId: rid, deviceSecret: secret })).statusCode, 202);
  await app.inject({ method: 'POST', url: `/v/${token}`, headers: { cookie: `stella_pending=${secret}`, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  const claimed = await post('/api/auth/link/claim', { requestId: rid, deviceSecret: secret });
  assert.equal(claimed.statusCode, 200);
  assert.equal(claimed.json().purpose, 'reset');

  const changed = await app.inject({ method: 'PUT', url: '/api/me/password', headers: { authorization: `Bearer ${claimed.json().token}` }, payload: { password: 'neuesPasswort123' } });
  assert.equal(changed.statusCode, 200);
  assert.throws(() => login('forgot@example.com', 'supergeheim'), HttpError);
  assert.ok(login('forgot@example.com', 'neuesPasswort123').token);
  // zu kurz wird abgelehnt
  assert.equal((await app.inject({ method: 'PUT', url: '/api/me/password', headers: { authorization: `Bearer ${claimed.json().token}` }, payload: { password: 'kurz' } })).statusCode, 400);
});

test('Anmelden mit E-Mail-Link, 60-Sekunden-Pause und Universal-Link-Datei', async () => {
  const first = await post('/api/auth/link/request', { email: 'forgot@example.com', purpose: 'login' });
  assert.equal(first.statusCode, 200);
  const tooSoon = await post('/api/auth/link/request', { email: 'forgot@example.com', purpose: 'login' });
  assert.equal(tooSoon.statusCode, 429);
  assert.ok(tooSoon.json().retryIn > 0);
  // iOS: Token + Gerätegeheimnis direkt bestätigen
  const token = tokenOf(sent.at(-1)!.text);
  const ios = await post('/api/auth/link/confirm', { token, deviceSecret: first.json().deviceSecret });
  assert.equal(ios.statusCode, 200, ios.body);
  assert.ok(ios.json().token);
  // Apple-Datei
  const aasa = await app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
  assert.equal(aasa.statusCode, 200);
  assert.equal(aasa.json().applinks.details[0].appIDs[0], 'TEAM123456.app.stella.ios');
});
