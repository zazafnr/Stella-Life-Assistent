import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { startMockClaude, text } from './testing/mockClaude.ts';

// Simuliertes Stripe: merkt sich die Anfragen
const stripeCalls: { path: string; body: URLSearchParams }[] = [];
const stripe = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    stripeCalls.push({ path: req.url ?? '', body: new URLSearchParams(raw) });
    if (req.url === '/v1/balance') { res.end('{"object":"balance"}'); return; }
    if (req.url === '/v1/checkout/sessions') { res.end(JSON.stringify({ url: 'https://checkout.stripe.test/c/pay_123' })); return; }
    if (req.url === '/v1/billing_portal/sessions') { res.end(JSON.stringify({ url: 'https://billing.stripe.test/p/session' })); return; }
    res.statusCode = 404; res.end('{"error":{"message":"nicht gefunden"}}');
  });
});
await new Promise<void>((r) => stripe.listen(0, r));
const claude = await startMockClaude(() => text('Antwort von Haiku'));

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-billing-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STRIPE_BASE_URL = `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';

const { config } = await import('./config.ts');
const { register, HttpError, requireUser } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { setKey, testKey } = await import('./keys.ts');
const { setMailTransportFactory } = await import('./mailer.ts');
const billing = await import('./billing.ts');
const { handleChat } = await import('./assistant.ts');
const { resolveTier } = await import('./router.ts');
const { recordCost } = await import('./costs.ts');
const { effectivePlan, PLANS } = await import('@stella/shared');

const sent: { to: string; subject: string; text: string }[] = [];
setMailTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return {} as never; } }));
setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'noreply@evolsior.com', pass: 'x', from: 'Stella <noreply@evolsior.com>' });
const WEBHOOK_SECRET = 'whsec_test_secret_1234567890';
setKey('stripe', { secretKey: 'sk_test_abcdefghijklmnop', webhookSecret: WEBHOOK_SECRET });
config.defaultPlan = 'free'; // diese Tests prüfen die Limits des Free-Abos

const owner = register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna').user; // erstes Konto = Owner (Max)
const mk = (name: string) => {
  const { user } = register(name, `${name.toLowerCase()}@example.com`, 'supergeheim', 'Europe/Vienna');
  updateUserSettings(user.id, { locale: 'de' });
  return () => getUser(user.id)!;
};

const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
billing.registerBillingWebhook(app);
await app.register(async (api) => { api.addHook('preHandler', requireUser); billing.registerBillingRoutes(api); });
await app.ready();
after(async () => { await app.close(); stripe.close(); await claude.close(); });

test('Abos und Limits: Free, Plus, Pro, Max – der Owner hat Max, Overrides gelten ohne Code-Änderung', () => {
  const mia = mk('Mia');
  assert.equal(billing.currentPlanId(mia()), 'free');
  assert.equal(billing.currentPlanId(owner), 'max', 'Owner (erstes Konto) hat Max');
  assert.equal(billing.planOf(mia()).limits.aiMessagesPerDay, 15);
  assert.equal(PLANS.plus.limits.aiMessagesPerDay, 60);
  assert.equal(PLANS.pro.limits.proTasksPerMonth, 40);
  assert.equal(PLANS.max.limits.mailboxes, 999);
  assert.deepEqual([PLANS.free, PLANS.plus, PLANS.pro, PLANS.max].map((p) => p.priceCents), [0, 800, 1500, 3500]);
  // hasFeature je Abo: Bildschirmzeit erst ab Plus
  assert.equal(billing.planAllows(mia(), 'screenTime'), false);
  billing.giftPlan(mia().id, 'plus', null);
  assert.equal(billing.planAllows(mia(), 'screenTime'), true);
  assert.equal(billing.maxMailboxes(mia()), 2);
  // Owner ändert Limits ohne Deploy
  billing.setPlanOverrides({ plus: { aiMessagesPerDay: 100, bogus: 5 }, free: { aiMessagesPerDay: -3 } });
  assert.equal(billing.planFor('plus').limits.aiMessagesPerDay, 100);
  assert.equal(billing.planFor('free').limits.aiMessagesPerDay, 15, 'Unsinn wird verworfen');
  billing.setPlanOverrides({});
  assert.equal(billing.planFor('plus').limits.aiMessagesPerDay, 60);
  assert.equal(effectivePlan('pro').limits.newsFavorites, true);
});

test('Tageswechsel in der Zeitzone: gleicher Moment, zwei Zeitzonen, zwei Zähler', () => {
  const a = mk('Ost');
  const b = mk('West');
  db.prepare('UPDATE users SET time_zone = ? WHERE id = ?').run('Pacific/Kiritimati', a().id); // UTC+14
  db.prepare('UPDATE users SET time_zone = ? WHERE id = ?').run('Pacific/Pago_Pago', b().id);  // UTC-11
  billing.consumeQuota(a(), 'ai_message');
  billing.consumeQuota(b(), 'ai_message');
  const days = db.prepare("SELECT period FROM usage_counters WHERE user_id IN (?, ?) AND kind = 'ai_message' ORDER BY period").all(a().id, b().id) as { period: string }[];
  assert.equal(days.length, 2);
  assert.notEqual(days[0]!.period, days[1]!.period, 'verschiedene Kalendertage');
  // ein Zähler von gestern zählt heute nicht mehr
  db.prepare("UPDATE usage_counters SET period = '2020-01-01' WHERE user_id = ?").run(a().id);
  assert.equal(billing.usedCount(a(), 'ai_message'), 0);
  // Profi-Aufgaben zählen pro Monat
  billing.consumeQuota(b(), 'pro_task', 2);
  assert.equal(billing.usedCount(b(), 'pro_task'), 2);
  assert.match((db.prepare("SELECT period FROM usage_counters WHERE user_id = ? AND kind = 'pro_task'").get(b().id) as { period: string }).period, /^\d{4}-\d{2}$/);
});

test('Limits je Abo: Free 15 KI-Nachrichten am Tag; freundlicher Hinweis, Kurznotizen gehen weiter, Upgrade-Hinweis nur einmal am Tag', async () => {
  const lena = mk('Lena');
  for (let i = 0; i < 15; i++) {
    const r = await handleChat(lena(), `Erzähl mir etwas Nettes Nummer ${i}`, `fr${i}`);
    assert.equal(r.messages.at(-1)!.text, 'Antwort von Haiku', `Nachricht ${i + 1} geht noch`);
  }
  assert.equal(billing.usedCount(lena(), 'ai_message'), 15);
  const over = await handleChat(lena(), 'Und noch eine freie Frage ohne Schlagwort', 'fr16');
  assert.match(over.messages.at(-1)!.text, /15 KI-Nachrichten für heute/);
  assert.match(over.messages.at(-1)!.text, /Plus .* 60 KI-Nachrichten pro Tag/, 'Hinweis auf das nächste Abo');
  const over2 = await handleChat(lena(), 'Noch eine freie Frage ohne Schlagwort', 'fr17');
  assert.match(over2.messages.at(-1)!.text, /15 KI-Nachrichten/);
  assert.ok(!/Plus/.test(over2.messages.at(-1)!.text), 'der Upgrade-Hinweis kommt höchstens einmal am Tag');
  // Kurznotizen gehen weiter und zählen nicht
  const note = await handleChat(lena(), 'Mathe HÜ S. 45 Nr. 3 Freitag', 'fr18');
  assert.match(note.messages[0]!.text, /Notiert/);
  assert.equal(billing.usedCount(lena(), 'ai_message'), 15);
  // Plus: 60 am Tag, es geht wieder
  billing.giftPlan(lena().id, 'plus', 30);
  assert.equal((await handleChat(lena(), 'Eine weitere freie Frage ohne Schlagwort', 'fr19')).messages.at(-1)!.text, 'Antwort von Haiku');
});

test('leere Profi-Aufgaben: Haiku macht weiter und Stella sagt das in einem Satz; Free nur für Hausübungen', async () => {
  const max = mk('Tom');
  billing.giftPlan(max().id, 'plus', null);
  billing.consumeQuota(max(), 'pro_task', billing.planOf(max()).limits.proTasksPerMonth);
  assert.deepEqual(resolveTier(max(), 'heavy'), { tier: 'light', downgraded: true, reason: 'limit' });
  const n0 = claude.requests.length;
  const r = await handleChat(max(), 'Bitte plane das ganz gründlich für mich durch', 'pro1');
  assert.match(r.messages.at(-1)!.text, /Profi-Aufgaben für diesen Monat sind aufgebraucht/);
  assert.deepEqual(claude.requests.slice(n0).map((q) => q.body.model), ['claude-haiku-5-5'], 'nur Haiku lief');

  const free = mk('Eva');
  assert.deepEqual(resolveTier(free(), 'heavy'), { tier: 'light', downgraded: true, reason: 'homework_only' });
  assert.deepEqual(resolveTier(free(), 'heavy', { homework: true }), { tier: 'heavy', downgraded: false });
  const n1 = claude.requests.length;
  const r2 = await handleChat(free(), 'Bitte erkläre mir das ganz gründlich und genau', 'pro2');
  assert.match(r2.messages.at(-1)!.text, /Free-Abo nur fürs Lösen von Hausübungen/);
  assert.equal(claude.requests[n1]!.body.model, 'claude-haiku-5-5');
});

test('Postfächer je Abo: Free 1, Plus 2', async () => {
  const mia = getUser((db.prepare("SELECT id FROM users WHERE email = 'mia@example.com'").get() as { id: string }).id)!;
  assert.equal(billing.maxMailboxes(mia), 2);
  const sub = billing.subscriptionOf(mia.id)!;
  assert.equal(sub.provider, 'gift');
});

test('Geschenkte Abos laufen ab', () => {
  const gast = mk('Gast');
  billing.giftPlan(gast().id, 'pro', 7);
  assert.equal(billing.currentPlanId(gast()), 'pro');
  assert.equal(billing.currentPlanId(gast(), Date.now() + 8 * 86_400_000), 'free', 'nach Ablauf wieder Free');
  billing.giftPlan(gast().id, 'max', null);
  assert.equal(billing.currentPlanId(gast(), Date.now() + 3650 * 86_400_000), 'max', 'ohne Ablauf bleibt es');
});

const signed = (body: object, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify(body);
  return { raw, header: `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` };
};
const webhook = (body: object, opts: { secret?: string; t?: number } = {}) => {
  const { raw, header } = signed(body, opts.secret, opts.t);
  return app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload: raw });
};

test('Checkout: Stripe-Sitzung mit Preis, Steuer und Nutzer; Jahresabo = 10 Monate; Portal braucht ein Abo', async () => {
  const kai = mk('Kai');
  const token = (await import('./auth.ts')).createSession(kai().id, 'test');
  const auth = { authorization: `Bearer ${token}` };
  const res = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth, payload: { plan: 'plus', interval: 'month' } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().url, 'https://checkout.stripe.test/c/pay_123');
  const body = stripeCalls.filter((c) => c.path === '/v1/checkout/sessions').at(-1)!.body;
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('client_reference_id'), kai().id);
  assert.equal(body.get('customer_email'), 'kai@example.com');
  assert.equal(body.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '800');
  assert.equal(body.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(body.get('automatic_tax[enabled]'), 'true', 'Stripe Tax');
  assert.equal(body.get('subscription_data[metadata][plan]'), 'plus');
  await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth, payload: { plan: 'pro', interval: 'year' } });
  assert.equal(stripeCalls.filter((c) => c.path === '/v1/checkout/sessions').at(-1)!.body.get('line_items[0][price_data][unit_amount]'), '15000');
  assert.equal((await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth, payload: { plan: 'gold' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/billing/portal', headers: auth })).statusCode, 404, 'ohne Abo kein Portal');
  assert.equal((await testKey('stripe')).ok, true);
});

test('Webhook: Signatur prüfen, Abo starten, ändern, kündigen – idempotent über die Ereignis-Id; Abo-Mail kommt', async () => {
  const joe = mk('Joe');
  const userId = joe().id;
  const checkout = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: userId, customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: userId, plan: 'plus' } } } };

  assert.equal((await webhook(checkout, { secret: 'whsec_falsch_falsch_falsch' })).statusCode, 401, 'falsche Signatur');
  assert.equal((await webhook(checkout, { t: Math.floor(Date.now() / 1000) - 3600 })).statusCode, 401, 'zu alt');
  assert.equal((await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode, 401, 'ohne Signatur');
  assert.equal(billing.currentPlanId(joe()), 'free');

  const before = sent.length;
  const ok = await webhook(checkout);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(billing.currentPlanId(joe()), 'plus');
  assert.equal(billing.subscriptionOf(userId)!.customer, 'cus_1');
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)!.subject, 'Dein Stella-Abo Plus ist aktiv');
  assert.equal((await webhook(checkout)).json().result, 'duplicate', 'dasselbe Ereignis wirkt nur einmal');
  assert.equal(sent.length, before + 1, 'keine zweite Mail');

  const period = Math.floor(Date.now() / 1000) + 30 * 86_400;
  // Wechsel auf Pro
  await webhook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: period, metadata: { user_id: userId, plan: 'pro' } } } });
  assert.equal(billing.currentPlanId(joe()), 'pro');
  assert.equal(sent.at(-1)!.subject, 'Dein Stella-Abo wurde auf Pro umgestellt');
  // Kündigung zum Periodenende: Pro bleibt bis dahin
  await webhook({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, current_period_end: period, metadata: { user_id: userId, plan: 'pro' } } } });
  assert.equal(billing.currentPlanId(joe()), 'pro');
  assert.equal(billing.currentPlanId(joe(), Date.now() + 40 * 86_400_000), 'free', 'danach Free');
  assert.equal(sent.at(-1)!.subject, 'Dein Stella-Abo wurde gekündigt');
  // endgültig gelöscht
  await webhook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { user_id: userId, plan: 'pro' } } } });
  assert.equal(billing.currentPlanId(joe()), 'free');
  // Portal geht, solange eine Stripe-Kundennummer da ist
  const token = (await import('./auth.ts')).createSession(userId, 'test');
  const portal = await app.inject({ method: 'POST', url: '/api/billing/portal', headers: { authorization: `Bearer ${token}` } });
  assert.equal(portal.json().url, 'https://billing.stripe.test/p/session');
  // unbekanntes Ereignis wird quittiert
  assert.equal((await webhook({ id: 'evt_5', type: 'invoice.created', data: { object: {} } })).json().result, 'ignored');
});

test('Dashboard-Zahlen: Nutzer je Abo, MRR, Kosten je Nutzer, Marge, teuerste Nutzer', () => {
  recordCost('claude-haiku-5-5', { input: 1_000_000, output: 100_000 }, (db.prepare("SELECT id FROM users WHERE email = 'lena@example.com'").get() as { id: string }).id); // 0,15 $
  const ov = billing.billingOverview(30);
  assert.ok(ov.plans.find((p) => p.plan === 'free')!.users >= 1);
  const plus = ov.plans.find((p) => p.plan === 'plus')!;
  assert.equal(plus.priceCents, 800);
  assert.equal(billing.netCents(800), 630, '8 € → 6,30 € nach Steuer und Gebühr');
  assert.ok(ov.topUsers.length >= 1 && ov.topUsers[0]!.rank === 1);
  assert.ok(ov.mrrCents >= 0);
  assert.equal(ov.topUsers[0]!.name, 'Lena', 'Lena hat die höchsten Kosten');
  assert.ok(ov.plans.find((p) => p.plan === 'plus')!.avgCostEur > 0);
});
