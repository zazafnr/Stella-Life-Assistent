import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-inbound-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STELLA_PUBLIC_URL = 'https://stella.example.org';

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db } = await import('./db.ts');
const { setKey } = await import('./keys.ts');
const { setMailTransportFactory } = await import('./mailer.ts');
const { registerAddressRoutes, registerInboundRoute, processInbound, cleanMailText, authVerdict, findUserByAddress, rotateInboundSecret } = await import('./inbound.ts');
const { registerAdminRoutes } = await import('./admin.ts');
const { registerOverviewRoutes, buildOverview } = await import('./overview.ts');
const Fastify = (await import('fastify')).default;

interface Sent { to: string; from: string; subject: string; text: string; inReplyTo?: string; replyTo?: string }
const sent: Sent[] = [];
setMailTransportFactory(() => ({ sendMail: async (m: Sent) => { sent.push(m); return {} as never; } }));
setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'resend', pass: 'geheim', from: 'Stella <noreply@evolsior.com>' });

const { user: owner, token: ownerToken } = register('Lukas', 'lukas@example.com', 'passwort-123', 'Europe/Vienna');
const { user: other, token: otherToken } = register('Anna', 'anna@example.com', 'passwort-123', 'Europe/Vienna');

const app = Fastify();
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ ...err.extra, error: err.message });
  return reply.code(500).send({ error: (err as Error).message });
});
registerInboundRoute(app);
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerAddressRoutes(api); registerAdminRoutes(api); registerOverviewRoutes(api); });
await app.ready();

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
const lastCode = () => /\n\s{4}(\d{6})\n/.exec(sent.at(-1)!.text)![1]!;
let n = 0;
const mail = (over: Record<string, unknown> = {}) => ({ from: 'Lukas <lukas@example.com>', to: 'stella@evolsior.com', subject: 'Notiz', text: 'Erinnere mich morgen um 9 Uhr an den Zahnarzt', messageId: `<m${++n}@x>`, ...over });

test('Text bereinigen: Zitate, Signatur und „Am … schrieb“ fliegen raus', () => {
  const t = 'Bitte Milch auf die Liste\n\n-- \nLukas\n\n> alt';
  assert.equal(cleanMailText(t), 'Bitte Milch auf die Liste');
  assert.equal(cleanMailText('Ja\n\nAm Mo., 3. Mai 2026 um 10:00 schrieb Stella <stella@evolsior.com>:\n> Hallo'), 'Ja');
  assert.equal(cleanMailText('x'.repeat(9000)).length, 4000);
});

test('Echtheit: pass/unknown ja, fail nein', () => {
  assert.equal(authVerdict(null), 'unknown');
  assert.equal(authVerdict({ dmarc: 'pass' }), 'pass');
  assert.equal(authVerdict({ spf: 'pass', dkim: 'none' }), 'pass');
  assert.equal(authVerdict({ dmarc: 'fail' }), 'fail');
  assert.equal(authVerdict({ spf: 'fail', dkim: 'fail' }), 'fail');
});

test('Adresse verknüpfen: Code per Mail, falscher Code, richtiger Code', async () => {
  assert.equal(findUserByAddress('arbeit@firma.at'), null);
  const before = sent.length;
  const add = await call('POST', '/api/me/emails', ownerToken, { email: 'Arbeit@Firma.at' });
  assert.equal(add.statusCode, 200);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)!.to, 'arbeit@firma.at');
  assert.equal(sent.at(-1)!.from, 'Stella <noreply@evolsior.com>');
  const list = add.json().emails as { id: string; email: string; verified: boolean; primary: boolean }[];
  assert.equal(list[0]!.primary, true);
  const entry = list.find((e) => e.email === 'arbeit@firma.at')!;
  assert.equal(entry.verified, false);
  assert.equal(findUserByAddress('arbeit@firma.at'), null, 'unbestätigt zählt nicht');

  assert.equal((await call('POST', `/api/me/emails/${entry.id}/verify`, ownerToken, { code: '000000' })).statusCode, 400);
  // fremdes Konto kommt nicht an die Adresse
  assert.equal((await call('POST', `/api/me/emails/${entry.id}/verify`, otherToken, { code: lastCode() })).statusCode, 404);
  const ok = await call('POST', `/api/me/emails/${entry.id}/verify`, ownerToken, { code: lastCode() });
  assert.equal(ok.statusCode, 200);
  assert.equal(findUserByAddress('arbeit@firma.at')?.id, owner.id);

  // dieselbe Adresse nicht ein zweites Mal
  assert.equal((await call('POST', '/api/me/emails', otherToken, { email: 'arbeit@firma.at' })).statusCode, 409);
  assert.equal((await call('POST', '/api/me/emails', ownerToken, { email: 'lukas@example.com' })).statusCode, 409, 'Konto-Adresse ist schon da');
  assert.equal((await call('POST', '/api/me/emails', ownerToken, { email: 'kaputt' })).statusCode, 400);
});

test('Code erneut anfordern: höchstens einmal pro Minute', async () => {
  assert.equal((await call('POST', '/api/me/emails', ownerToken, { email: 'zweite@firma.at' })).statusCode, 200);
  assert.equal((await call('POST', '/api/me/emails', ownerToken, { email: 'zweite@firma.at' })).statusCode, 429);
});

test('Mail von verknüpfter Adresse: Stella erledigt es und antwortet im selben Verlauf von stella@', async () => {
  const before = sent.length;
  const r = await processInbound(mail({ from: 'Lukas <ARBEIT@firma.at>', messageId: '<w1@x>', subject: 'Zahnarzt' }));
  assert.equal(r.outcome, 'replied');
  assert.equal(sent.length, before + 1);
  const m = sent.at(-1)!;
  assert.equal(m.to, 'arbeit@firma.at');
  assert.equal(m.from, 'Stella <stella@evolsior.com>');
  assert.equal(m.replyTo, 'stella@evolsior.com');
  assert.match(m.subject, /^Re: Zahnarzt/);
  assert.equal(m.inReplyTo, '<w1@x>');
  assert.match(m.text, /– Stella$/);
  const items = db.prepare("SELECT COUNT(*) AS n FROM items WHERE user_id = ?").get(owner.id) as { n: number };
  assert.ok(items.n >= 1, 'Stella hat eine Erinnerung angelegt');
});

test('Dieselbe Mail zweimal (gleiche Message-ID): nur einmal bearbeitet', async () => {
  const before = sent.length;
  assert.equal((await processInbound(mail({ messageId: '<dup@x>' }))).outcome, 'replied');
  assert.equal((await processInbound(mail({ messageId: '<dup@x>' }))).outcome, 'duplicate');
  assert.equal(sent.length, before + 1);
});

test('Unbekannter Absender: ein kurzer Hinweis, danach 24 Stunden Ruhe', async () => {
  const before = sent.length;
  assert.equal((await processInbound(mail({ from: 'fremd@irgendwo.com' }))).outcome, 'unknown_sender');
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)!.to, 'fremd@irgendwo.com');
  assert.match(sent.at(-1)!.text, /https:\/\/stella\.example\.org/);
  assert.match(sent.at(-1)!.text, /account/i);
  assert.equal((await processInbound(mail({ from: 'fremd@irgendwo.com' }))).outcome, 'unknown_sender_silent');
  assert.equal(sent.length, before + 1);
});

test('Automatische Mails und Newsletter bekommen keine Antwort (keine Schleifen)', async () => {
  const before = sent.length;
  for (const over of [{ autoSubmitted: 'auto-replied' }, { precedence: 'bulk' }, { listId: '<news.x.com>' }, { from: 'noreply@shop.com' }, { from: 'MAILER-DAEMON@x.com' }]) {
    assert.equal((await processInbound(mail(over))).outcome, 'ignored_automated', JSON.stringify(over));
  }
  assert.equal(sent.length, before);
});

test('Falsche Echtheit wird abgelehnt, andere Empfänger ignoriert', async () => {
  const before = sent.length;
  assert.equal((await processInbound(mail({ auth: { dmarc: 'fail' } }))).outcome, 'rejected_auth');
  assert.equal((await processInbound(mail({ auth: { spf: 'pass' } }))).outcome, 'replied');
  assert.equal((await processInbound(mail({ to: 'team@evolsior.com' }))).outcome, 'ignored_recipient');
  assert.equal(sent.length, before + 1);
});

test('Zu viele Mails von einem Absender in einer Stunde: Limit', async () => {
  const outcomes: string[] = [];
  for (let i = 0; i < 25; i++) outcomes.push((await processInbound(mail({ from: 'anna@example.com', messageId: `<rl${i}@x>`, text: 'hallo' }))).outcome);
  // Anna hat ein Konto (Konto-Adresse ist bestätigt), ab >20 greift das Limit
  assert.ok(outcomes.includes('rate_limited'));
});

test('Eingang über HTTP braucht den geheimen Schlüssel', async () => {
  const noSecret = await app.inject({ method: 'POST', url: '/api/inbound/email', payload: mail() as object });
  assert.equal(noSecret.statusCode, 401);

  assert.equal((await call('POST', '/api/admin/inbound-secret', otherToken)).statusCode, 403, 'nur der Owner');
  const made = await call('POST', '/api/admin/inbound-secret', ownerToken);
  assert.equal(made.statusCode, 200);
  const secret = made.json().secret as string;
  assert.ok(secret.length >= 32);
  assert.equal((await call('GET', '/api/admin/inbound', ownerToken)).json().configured, true);

  const wrong = await app.inject({ method: 'POST', url: '/api/inbound/email', payload: mail() as object, headers: { 'x-inbound-secret': secret + 'x' } });
  assert.equal(wrong.statusCode, 401);
  const before = sent.length;
  const ok = await app.inject({ method: 'POST', url: '/api/inbound/email', payload: mail({ messageId: '<http1@x>' }) as object, headers: { 'x-inbound-secret': secret } });
  assert.equal(ok.statusCode, 202);
  for (let i = 0; i < 50 && sent.length === before; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, before + 1);

  // neuer Schlüssel macht den alten ungültig
  const secret2 = (await call('POST', '/api/admin/inbound-secret', ownerToken)).json().secret as string;
  assert.notEqual(secret2, secret);
  const old = await app.inject({ method: 'POST', url: '/api/inbound/email', payload: mail() as object, headers: { 'x-inbound-secret': secret } });
  assert.equal(old.statusCode, 401);
  void rotateInboundSecret;
});

test('Dashboard-Zahlen: nur für den Owner, ohne Inhalte', async () => {
  assert.equal((await call('GET', '/api/admin/overview', otherToken)).statusCode, 403);
  const res = await call('GET', '/api/admin/overview?days=14', ownerToken);
  assert.equal(res.statusCode, 200);
  const o = res.json();
  assert.equal(o.app, 'stella');
  assert.equal(o.users.total, 2);
  assert.equal(o.users.linkedAddresses, 1);
  assert.equal(o.registrations.length, 14);
  assert.equal(o.mail.perDay.length, 14);
  assert.ok(o.mail.byPurpose.stella_reply.ok >= 3);
  assert.ok(o.mail.byPurpose.address_verification.ok >= 2);
  assert.equal(o.mail.byPurpose.unknown_sender_notice.ok, 1);
  assert.ok(o.mail.inboundByOutcome.replied >= 3);
  assert.ok(o.mail.inboundByOutcome.unknown_sender_silent >= 1);
  assert.equal(o.setup.mailConfigured, true);
  assert.equal(o.setup.inboundConfigured, true);
  const text = JSON.stringify(o);
  assert.ok(!text.includes('firma.at') && !text.includes('irgendwo.com'), 'nur Domains der Empfänger, nie volle Adressen');
  assert.ok(!text.includes('Zahnarzt'), 'keine Inhalte');
  assert.equal(buildOverview(30).days, 30);
});

test('Adresse entfernen', async () => {
  const list = (await call('GET', '/api/me/emails', ownerToken)).json().emails as { id: string; email: string }[];
  const e = list.find((x) => x.email === 'arbeit@firma.at')!;
  assert.equal((await call('DELETE', `/api/me/emails/${e.id}`, ownerToken)).statusCode, 200);
  assert.equal(findUserByAddress('arbeit@firma.at'), null);
  assert.equal((await call('DELETE', `/api/me/emails/${e.id}`, ownerToken)).statusCode, 404);
});
