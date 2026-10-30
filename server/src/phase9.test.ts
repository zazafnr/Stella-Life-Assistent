import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock: Groq (Kategorie für neue Händler) und OpenRouter (Agent)
let groqCalls = 0;
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/groq/chat/completions') {
      const prompt = String(JSON.parse(body).messages[1].content);
      if (prompt.startsWith('Händler:')) {
        groqCalls++;
        if (/Zzz/.test(prompt)) { res.statusCode = 500; res.end('{"error":"kaputt"}'); return; }
        const category = /Hirschen/.test(prompt) ? 'Essen & Trinken' : /Kletter/.test(prompt) ? 'Freizeit' : 'Quatsch';
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ category }) } }] }));
        return;
      }
    }
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Das weiß ich nicht.' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p9-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = base;
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;

const { register, requireUser, userByIngestToken, HttpError } = await import('./auth.ts');
const { db, getUser } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const fin = await import('./finance.ts');
const { applyProfile } = await import('./profile.ts');
const { findHints } = await import('./hints.ts');
const { todayIn, addDays } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const lukas = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const mia = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(lukas.user.id)!;
const today = () => todayIn(user().timeZone);
const ago = (days: number, minutes = 0) => new Date(Date.now() - days * 86_400_000 - minutes * 60_000).toISOString();
const rows = (userId = lukas.user.id) => db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY occurred_at').all(userId) as { id: string; merchant: string; category: string; amount_cents: number; card_label: string | null; day: string }[];

const app = Fastify();
app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
// Der Ingest-Block aus main.ts (Token in der URL), nur mit der Zahlungs-Route
await app.register(async (ingest) => {
  ingest.addHook('preHandler', async (req: any, reply) => {
    const u = userByIngestToken(req.params.token);
    if (!u) return reply.code(404).send({ error: 'Unbekannt' });
    req.user = u;
  });
  ingest.post('/api/ingest/:token/payment', async (req) => fin.recordPayment(req.user, req.body));
});
await app.register(async (api) => { api.addHook('preHandler', requireUser); fin.registerFinanceRoutes(api); });
await app.ready();
const as = (t: string) => ({ authorization: `Bearer ${t}` });
const pay = (payload: Record<string, unknown>, token = lukas.user.ingestToken) =>
  app.inject({ method: 'POST', url: `/api/ingest/${token}/payment`, payload });

test('Beträge lesen: Komma, Punkt, Tausender, Währung und Vorzeichen', () => {
  const cents = (v: unknown) => fin.parseAmount(v)?.cents ?? null;
  assert.equal(cents('12,50'), 1250);
  assert.equal(cents('12.50'), 1250);
  assert.equal(cents('12,50 €'), 1250);
  assert.equal(cents('€ 3,2'), 320);
  assert.equal(cents('1.234,56'), 123456);
  assert.equal(cents('1,234.56'), 123456);
  assert.equal(cents('1.234'), 123400);
  assert.equal(cents('0,99'), 99);
  assert.equal(cents('-7,10'), 710, 'Vorzeichen zählt nicht');
  assert.equal(cents(4.2), 420);
  assert.equal(fin.parseAmount('9,90 €')?.currency, 'EUR');
  assert.equal(fin.parseAmount('$ 5.00')?.currency, 'USD');
  for (const bad of ['', 'abc', '0', '0,00', null, undefined, '99999999999']) assert.equal(fin.parseAmount(bad), null, `„${bad}“ ist kein Betrag`);
});

test('Kurzbefehl: gültiger Token speichert Betrag, Händler und Kartenname – nie die Kartennummer', async () => {
  const r = await pay({ amount: '12,50 €', merchant: 'BILLA 1234 WIEN', card: 'Visa •••• 5678', currency: 'EUR', date: ago(0, 30) });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().duplicate, false);
  assert.equal(r.json().category, 'Lebensmittel');
  const [t] = rows();
  assert.equal(t!.amount_cents, 1250);
  assert.equal(t!.merchant, 'BILLA 1234 WIEN');
  assert.equal(t!.card_label, 'Visa');
  assert.equal(t!.day, today());
  assert.ok(!JSON.stringify(rows()).includes('5678'), 'Kartennummer steht nirgends');
  assert.equal(fin.cleanCard('N26 Mastercard'), 'N26 Mastercard', 'kurze Zahlen im Namen bleiben');
  assert.equal(fin.cleanCard('1234 5678 9012 3456'), null);
});

test('Kurzbefehl: ungültiger Token → 404, fehlender Betrag oder Händler → 400', async () => {
  assert.equal((await pay({ amount: '5', merchant: 'Billa' }, 'gibt-es-nicht')).statusCode, 404);
  const noMerchant = await pay({ amount: '5' });
  assert.equal(noMerchant.statusCode, 400);
  assert.match(noMerchant.json().error, /Händler/);
  const noAmount = await pay({ merchant: 'Billa', amount: 'abc' });
  assert.equal(noAmount.statusCode, 400);
  assert.match(noAmount.json().error, /Betrag/);
  assert.equal(rows().length, 1, 'nichts davon wurde gespeichert');
  assert.equal(rows(mia.user.id).length, 0);
});

test('Doppelte Meldung (gleicher Betrag + Händler innerhalb von 2 Minuten) wird verworfen', async () => {
  const again = await pay({ amount: '12,50', merchant: 'Billa 4711 Wien', date: ago(0, 29) });
  assert.equal(again.json().duplicate, true, 'Filialnummer und Schreibweise ändern nichts');
  assert.equal(rows().length, 1);
  const later = await pay({ amount: '12,50', merchant: 'Billa', date: ago(0, 33) });
  assert.equal(later.json().duplicate, false, 'drei Minuten Abstand ist eine neue Zahlung');
  const other = await pay({ amount: '12,51', merchant: 'Billa', date: ago(0, 33) });
  assert.equal(other.json().duplicate, false, 'anderer Betrag');
  assert.equal(rows().length, 3);
});

test('Kategorie: Regel vor Groq, Groq nur einmal pro neuem Händler, ohne Groq „Sonstiges“', async () => {
  const before = groqCalls;
  await pay({ amount: '8,90', merchant: 'Netflix', date: ago(3) });
  await pay({ amount: '4,20', merchant: 'Café Central', date: ago(4) });
  assert.equal(groqCalls, before, 'bekannte Händler brauchen kein Groq');

  const first = await pay({ amount: '23,00', merchant: 'Zum Goldenen Hirschen', date: ago(5) });
  assert.equal(first.json().category, 'Essen & Trinken');
  assert.equal(groqCalls, before + 1);
  const second = await pay({ amount: '31,00', merchant: 'ZUM GOLDENEN HIRSCHEN 77', date: ago(6) });
  assert.equal(second.json().category, 'Essen & Trinken');
  assert.equal(groqCalls, before + 1, 'gemerkt – kein zweiter Aufruf');
  assert.equal((db.prepare('SELECT source FROM merchant_categories WHERE user_id = ? AND merchant = ?').get(lukas.user.id, fin.merchantKey('Zum Goldenen Hirschen')) as { source: string }).source, 'groq');

  // Groq antwortet Unsinn → Sonstiges, nicht gemerkt
  const nonsense = await pay({ amount: '15,00', merchant: 'Kletterhalle Süd', date: ago(7) });
  assert.equal(nonsense.json().category, 'Freizeit');
  const down = await pay({ amount: '2,00', merchant: 'Zzz Kiosk', date: ago(8) });
  assert.equal(down.json().category, 'Sonstiges');
  assert.equal(db.prepare('SELECT 1 FROM merchant_categories WHERE user_id = ? AND merchant = ?').get(lukas.user.id, fin.merchantKey('Zzz Kiosk')), undefined, 'Fehlschlag wird nicht gemerkt');
});

test('Kategorie per Tippen ändern: gilt für den ganzen Händler, auch für neue Buchungen', async () => {
  const billa = rows().filter((r) => r.merchant.toLowerCase().startsWith('billa'));
  assert.ok(billa.length >= 3);
  assert.equal(fin.merchantKey('BILLA 1234 WIEN'), fin.merchantKey('Billa'), 'Filialnummer und Ort gehören nicht zum Händler');
  const patch = await app.inject({ method: 'PATCH', url: `/api/finance/transactions/${billa[0]!.id}`, headers: as(lukas.token), payload: { category: 'Gesundheit' } });
  assert.equal(patch.statusCode, 200);
  assert.ok(rows().filter((r) => r.merchant.toLowerCase().startsWith('billa')).every((r) => r.category === 'Gesundheit'), 'frühere Buchungen ziehen mit');
  const next = await pay({ amount: '6,00', merchant: 'BILLA 99', date: ago(0, 100) });
  assert.equal(next.json().category, 'Gesundheit', 'eigene Zuordnung schlägt die Regel');

  assert.equal((await app.inject({ method: 'PATCH', url: `/api/finance/transactions/${billa[0]!.id}`, headers: as(lukas.token), payload: { category: 'Quatsch' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/finance/transactions/${billa[0]!.id}`, headers: as(mia.token), payload: { category: 'Shopping' } })).statusCode, 404, 'fremde Buchung');
});

test('Summen: Woche und Monat, nur eigene Buchungen, Vormonat zum Vergleich', async () => {
  // Die Woche: nur heutige Buchungen sind sicher darin
  const week = fin.spendingPeriod('wie viel hab ich diese Woche ausgegeben?', today());
  const sum = (from: string, to: string) => rows().filter((r) => r.day >= from && r.day <= to).reduce((a, r) => a + r.amount_cents, 0);
  const card = fin.spendingCard(user(), week, week.label);
  assert.equal(card.totalCents, sum(week.from, week.to));
  assert.equal(card.categories.reduce((a, c) => a + c.cents, 0), card.totalCents);
  assert.equal(card.currency, 'EUR');
  assert.ok(card.totalCents > 0);

  assert.deepEqual(fin.spendingPeriod('was hab ich heute ausgegeben', '2026-10-30'), { from: '2026-10-30', to: '2026-10-30', label: 'Heute' });
  assert.deepEqual(fin.spendingPeriod('wie viel diese woche', '2026-10-30'), { from: '2026-10-26', to: '2026-10-30', label: 'Diese Woche' });
  assert.deepEqual(fin.spendingPeriod('wie viel letzte woche', '2026-10-30'), { from: '2026-10-19', to: '2026-10-25', label: 'Letzte Woche' });
  assert.deepEqual(fin.spendingPeriod('meine ausgaben', '2026-10-30'), { from: '2026-10-01', to: '2026-10-30', label: 'Dieser Monat' });
  assert.deepEqual(fin.spendingPeriod('wie viel im letzten monat ausgegeben', '2026-10-30'), { from: '2026-09-01', to: '2026-09-30', label: 'Letzter Monat' });
  assert.deepEqual(fin.spendingPeriod('wie viel letzten monat', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31', label: 'Letzter Monat' });

  const month = await app.inject({ method: 'GET', url: `/api/finance?month=${today().slice(0, 7)}`, headers: as(lukas.token) });
  const m = month.json();
  assert.equal(m.totalCents, sum(`${today().slice(0, 7)}-01`, `${today().slice(0, 7)}-31`));
  assert.equal(m.transactions.length, rows().filter((r) => r.day.startsWith(today().slice(0, 7))).length);
  assert.ok(m.categories.length >= 2);
  const mias = await app.inject({ method: 'GET', url: '/api/finance', headers: as(mia.token) });
  assert.equal(mias.json().totalCents, 0);
  assert.equal(mias.json().transactions.length, 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/finance?month=Quatsch', headers: as(lukas.token) })).statusCode, 200, 'ungültiger Monat → aktueller');
});

test('Chat: „wie viel hab ich diese Woche ausgegeben?“ – ohne die Funktion normal, mit der Funktion als Karte', async () => {
  const off = await handleChat(user(), 'wie viel hab ich diese Woche ausgegeben?', null);
  assert.equal(off.messages[0]!.card, undefined, 'ohne Profil-Funktion „Finanzen“ antwortet die KI');
  assert.match(off.messages[0]!.text, /weiß ich nicht/);

  applyProfile(user(), { situation: 'work', features: ['planner', 'finance'] });
  const r = await handleChat(user(), 'wie viel hab ich diese Woche ausgegeben?', null);
  const msg = r.messages[0]!;
  assert.equal(msg.card?.type, 'spending');
  if (msg.card?.type !== 'spending') throw new Error('keine Karte');
  assert.equal(msg.card.label, 'Diese Woche');
  assert.equal(msg.card.totalCents, fin.spendingCard(user(), fin.spendingPeriod('diese woche', today()), 'x').totalCents);
  assert.match(msg.text, /Diese Woche/);
  assert.match(msg.text, /€/);

  const none = await handleChat(user(), 'was hab ich gestern ausgegeben?', null);
  assert.match(none.messages[0]!.text, /Gestern/);
  assert.match(none.messages[0]!.text, /Kurzbefehl|Zahlungen?/);
  assert.equal(none.messages[0]!.card?.type, 'spending');
});

test('Budget: Hinweis ab 80 % und noch einmal bei 100 %, einstellbar und löschbar', async () => {
  await pay({ amount: '85,00', merchant: 'Lidl', date: ago(0, 200) });
  const lebensmittel = () => fin.budgetStatus(user(), today().slice(0, 7)).find((b) => b.category === 'Lebensmittel');
  const month = today().slice(0, 7);
  const hint = (suffix: string) => findHints(user()).find((h) => h.key === `budget:Lebensmittel:${month}:${suffix}`);
  assert.equal(hint('80'), undefined, 'ohne Budget kein Hinweis');

  const spent = fin.sumByCategory(lukas.user.id, { from: `${month}-01`, to: `${month}-31` }).categories.find((c) => c.category === 'Lebensmittel')!.cents;
  const set = async (cents: number) => (await app.inject({ method: 'PUT', url: '/api/finance/budgets/Lebensmittel', headers: as(lukas.token), payload: { amount: (cents / 100).toFixed(2).replace('.', ',') } })).statusCode;
  assert.equal(await set(Math.floor(spent / 0.85)), 200);
  assert.equal(lebensmittel()!.limitCents, Math.floor(spent / 0.85));
  assert.ok(hint('80'), 'über 80 %');
  assert.match(hint('80')!.text, /Lebensmittel/);
  assert.match(hint('80')!.text, /\d+ %/);
  assert.equal(hint('80')!.open?.tab, 'finance');
  assert.equal(hint('100'), undefined);

  assert.equal(await set(spent - 100), 200);
  assert.ok(hint('100'), 'Budget aufgebraucht');
  assert.equal(hint('80'), undefined, 'bei 100 % gilt nur noch der zweite Hinweis');

  assert.equal(await set(spent * 3), 200);
  assert.equal(hint('80'), undefined);
  assert.equal(hint('100'), undefined);

  assert.equal((await app.inject({ method: 'PUT', url: '/api/finance/budgets/Quatsch', headers: as(lukas.token), payload: { amount: 5 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/finance/budgets/Lebensmittel', headers: as(lukas.token), payload: { amount: -5 } })).statusCode, 400);
  await app.inject({ method: 'PUT', url: '/api/finance/budgets/Lebensmittel', headers: as(lukas.token), payload: { amount: null } });
  assert.equal(lebensmittel(), undefined, 'ohne Betrag wird das Budget gelöscht');
  assert.deepEqual(fin.budgetStatus({ ...user(), id: mia.user.id }, month), [], 'Mia hat keine Budgets');
});

test('Abos: gleicher Händler und Betrag im Monatsabstand', async () => {
  for (const d of [62, 31, 1]) await pay({ amount: '12,99', merchant: 'Netflix', date: ago(d) });
  await pay({ amount: '3,00', merchant: 'Bäckerei Mayer', date: ago(60) });
  await pay({ amount: '3,00', merchant: 'Bäckerei Mayer', date: ago(2) });
  const subs = fin.subscriptions(user());
  const n = subs.find((s) => s.merchant === 'Netflix' && s.amountCents === 1299)!;
  assert.ok(n, 'Netflix erkannt');
  assert.equal(n.count, 3);
  assert.ok(n.nextDay >= addDays(n.lastDay, 29) && n.nextDay <= addDays(n.lastDay, 33), 'nächste Abbuchung in etwa einem Monat');
  assert.ok(!subs.some((s) => s.merchant.startsWith('Bäckerei')), 'zwei Zahlungen im Abstand von 58 Tagen sind kein Abo');
  assert.ok(!subs.some((s) => s.amountCents === 890), 'ein einzelnes Netflix zu anderem Betrag nicht');
  const month = (await app.inject({ method: 'GET', url: '/api/finance', headers: as(lukas.token) })).json();
  assert.ok(month.subscriptions.some((s: { merchant: string }) => s.merchant === 'Netflix'));
});

test('Testknopf und Löschen', async () => {
  const first = await app.inject({ method: 'POST', url: '/api/finance/test', headers: as(lukas.token) });
  assert.equal(first.json().duplicate, false);
  assert.match(first.json().message, /angekommen/);
  const second = await app.inject({ method: 'POST', url: '/api/finance/test', headers: as(lukas.token) });
  assert.equal(second.json().duplicate, true, 'zweimal kurz hintereinander zählt einmal');
  const test = rows().find((r) => r.merchant === 'Testbuchung')!;
  assert.equal((db.prepare('SELECT source FROM transactions WHERE id = ?').get(test.id) as { source: string }).source, 'test');

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/finance/transactions/${test.id}`, headers: as(mia.token) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/finance/transactions/${test.id}`, headers: as(lukas.token) })).statusCode, 200);
  assert.ok(!rows().some((r) => r.id === test.id));
});

test('Konto löschen nimmt Buchungen, Händler-Zuordnungen und Budgets mit', () => {
  const m = register('Max', 'max@example.com', 'supergeheim', 'Europe/Vienna');
  db.prepare("INSERT INTO transactions (id, user_id, amount_cents, currency, merchant, merchant_key, category, occurred_at, day, created_at) VALUES ('t1', ?, 100, 'EUR', 'X', 'x', 'Sonstiges', ?, ?, ?)").run(m.user.id, ago(0), today(), ago(0));
  fin.rememberMerchant(m.user.id, 'x', 'Freizeit', 'user');
  fin.setBudget(m.user.id, 'Freizeit', 5000);
  db.prepare('DELETE FROM users WHERE id = ?').run(m.user.id);
  for (const table of ['transactions', 'merchant_categories', 'budgets']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(m.user.id) as { n: number }).n, 0, table);
  }
});
