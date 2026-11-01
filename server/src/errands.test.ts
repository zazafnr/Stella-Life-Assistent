import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { startMockClaude, text, toolUse, type MockRequest } from './testing/mockClaude.ts';

// ---- Overpass-Mock ----
let overpassCalls = 0;
const lat0 = 47.07, lon0 = 15.44;
const el = (id: number, name: string, dLat: number, tags: Record<string, string>) => ({ type: 'node', id, lat: lat0 + dLat, lon: lon0, tags: { name, amenity: 'restaurant', ...tags } });
const ELEMENTS = [
  el(1, 'Trattoria Roma', 0.0018, { cuisine: 'italian', opening_hours: 'Mo-Su 11:00-23:00', website: 'WEB/with-thefork', phone: '+43 316 111' }),
  el(2, 'Sushi Zen', 0.0009, { cuisine: 'japanese', opening_hours: 'Mo-Fr 12:00-14:00', phone: '+43 316 222' }),
  el(3, 'Wirtshaus Alt', 0.0045, { cuisine: 'austrian', website: 'WEB/without-booking' }),
  el(4, 'Pizza Napoli', 0.0072, { cuisine: 'italian;pizza', opening_hours: 'Mo-Su 17:00-22:00', phone: '+43 316 444', website: 'http://127.0.0.1:1/unreachable' }),
  { type: 'node', id: 5, lat: lat0 + 0.0001, lon: lon0, tags: { amenity: 'restaurant' } }, // ohne Namen → ignoriert
];
const web = createServer((req, res) => {
  const url = req.url ?? '';
  res.setHeader('Content-Type', 'text/html');
  if (req.method === 'POST' && url === '/overpass') { overpassCalls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ elements: ELEMENTS })); return; }
  if (url === '/with-thefork') { res.end('<html><body><h1>Trattoria</h1><iframe src="https://widget.thefork.com/de/abcd-1234?x=1&amp;y=2"></iframe></body></html>'); return; }
  if (url === '/without-booking') { res.end('<html><body>Kommt einfach vorbei.<script src="https://cdn.opentable.com/widget.js"></script></body></html>'); return; }
  res.statusCode = 404; res.end('x');
});
await new Promise<void>((r) => web.listen(0, r));
const base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
for (const e of ELEMENTS) { const w = (e.tags as Record<string, string>).website; if (w?.startsWith('WEB/')) (e.tags as Record<string, string>).website = `${base}/${w.slice(4)}`; }

// ---- Claude-Mock mit Ablauf je Test ----
const requests: MockRequest[] = [];
let script: (req: MockRequest, call: number) => ReturnType<typeof text> = () => text('Alles klar.');
let calls = 0;
/** Jeder Test setzt sein Skript neu; `call` zählt ab 0 je Skript */
const setScript = (fn: typeof script) => { calls = 0; script = fn; };
const claude = await startMockClaude((req) => { requests.push(req); return script(req, calls++); });
after(() => { web.close(); return claude.close(); });

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-errands-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OVERPASS_URL = `${base}/overpass`;
process.env.OPENROUTER_API_KEY = ''; process.env.GROQ_API_KEY = '';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';
process.env.STELLA_NEWS_ALLOW_PRIVATE = 'true';

const { register, HttpError, requireUser } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { giftPlan, usedCount } = await import('./billing.ts');
const { findRestaurants, cuisineKey, localToDate } = await import('./errands/restaurants.ts');
const { detectBooking, bookingOptions } = await import('./errands/booking.ts');
const { registerErrandRoutes } = await import('./errands/routes.ts');
const { handleChat } = await import('./assistant.ts');
const { undo } = await import('./actions.ts');
const net = await import('./news/net.ts');

const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerErrandRoutes(api); });
await app.ready();
after(() => app.close());

register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna');
let n = 0;
const mk = (plan: 'free' | 'plus' | 'pro', settings: Record<string, unknown> = {}) => {
  const r = register(`Nutzer${++n}`, `e${n}@example.com`, 'supergeheim', 'Europe/Vienna');
  giftPlan(r.user.id, plan, null);
  updateUserSettings(r.user.id, { locale: 'de', country: 'AT', ...settings });
  return { id: r.user.id, token: r.token, get: () => getUser(r.user.id)! };
};
const place = { lastPlace: { lat: lat0, lon: lon0, at: new Date().toISOString() } };
const lastCard = (res: { messages: { card?: { type: string } }[] }) => res.messages.map((m) => m.card).filter(Boolean).at(-1) as any;

test('Restaurants: nach Entfernung, zur Wunschzeit geöffnet, Küche gefiltert, Namen ohne Namen ignoriert, Zwischenspeicher', async () => {
  const u = mk('plus');
  const all = await findRestaurants(u.id, 'Europe/Vienna', lat0, lon0, { when: '2026-11-14T19:30' });
  // Sushi Zen hat samstags zu → fällt weg; Rest: Trattoria (200 m), Wirtshaus (500 m, Zeiten unbekannt), Pizza (800 m)
  assert.deepEqual(all.items.map((i) => i.name), ['Trattoria Roma', 'Pizza Napoli', 'Wirtshaus Alt'], 'offen bestätigt zuerst, dann unbekannt; nach Entfernung');
  assert.deepEqual(all.items.map((i) => i.openNow), [true, true, null]);
  assert.equal(all.when, '2026-11-14T19:30');
  assert.ok(all.items[0]!.distanceM < all.items[1]!.distanceM);
  assert.ok(all.items[0]!.appleMapsUrl.includes('maps.apple.com') && all.items[0]!.phone === '+43 316 111');
  assert.equal(overpassCalls, 1);

  const weekdayNoon = await findRestaurants(u.id, 'Europe/Vienna', lat0, lon0, { when: '2026-11-12T12:30', limit: 5 });
  assert.ok(weekdayNoon.items.some((i) => i.name === 'Sushi Zen' && i.openNow === true), 'donnerstags mittags ist Sushi Zen offen');
  const italian = await findRestaurants(u.id, 'Europe/Vienna', lat0, lon0, { cuisine: 'Pizza', when: '2026-11-14T19:30' });
  assert.deepEqual(italian.items.map((i) => i.name), ['Trattoria Roma', 'Pizza Napoli'].filter((x) => x), 'Pizza → italienische Küche');
  const named = await findRestaurants(u.id, 'Europe/Vienna', lat0, lon0, { query: 'wirtshaus' });
  assert.equal(named.items[0]!.name, 'Wirtshaus Alt');
  assert.equal(overpassCalls, 1, 'alles aus dem Zwischenspeicher der Rasterzelle');
  assert.equal(cuisineKey('Sushi'), 'japanese');
  assert.equal(cuisineKey('italienisch'), 'italian');
  assert.equal(cuisineKey('włoska'), 'italian');
  assert.equal(localToDate('2026-11-14T19:30', 'Europe/Vienna').toISOString(), '2026-11-14T18:30:00.000Z');
});

test('Buchungs-Erkennung: TheFork-Widget, OpenTable-Link, Quandoo, resmio, Google nur mit „reserve“, Skripte zählen nicht, keiner', () => {
  const b = 'https://lokal.example/start';
  assert.deepEqual(detectBooking('<iframe src="https://widget.thefork.com/de/abcd-1234?x=1&amp;y=2"></iframe>', b), { service: 'thefork', name: 'TheFork', url: 'https://widget.thefork.com/de/abcd-1234?x=1&y=2' });
  assert.equal(detectBooking('<a class="btn" href="https://www.opentable.de/r/lokal-graz">Tisch reservieren</a>', b)!.name, 'OpenTable');
  assert.equal(detectBooking('<a href="https://www.quandoo.at/de/place/lokal-123">x</a>', b)!.service, 'quandoo');
  assert.equal(detectBooking('<script>var u="https://widget.resmio.com/v1/abc";</script>', b)!.service, 'resmio');
  assert.equal(detectBooking('<a href="/book">hier</a><a href="https://www.bookatable.co.uk/x">b</a>', b)!.service, 'bookatable');
  assert.equal(detectBooking('<a href="https://www.google.com/maps/place/xyz">Karte</a>', b), null, 'ein normaler Maps-Link ist keine Reservierung');
  assert.equal(detectBooking('<a href="https://www.google.com/maps/reserve/v/dine/c/abc">Reservieren</a>', b)!.service, 'google');
  assert.equal(detectBooking('<script src="https://cdn.opentable.com/widget.js"></script><link href="https://thefork.com/style.css" rel="stylesheet">', b), null, 'Skript- und Stildateien der Dienste sind keine Buchungsadresse');
  assert.equal(detectBooking('<p>Kommt einfach vorbei.</p>', b), null);
});

test('Buchungsmöglichkeit eines Lokals: Link vom Dienst, sonst Telefon, sonst Webseite, nie ein Absturz; interne Adressen werden nicht abgerufen', async () => {
  const withBooking = await bookingOptions({ name: 'Trattoria Roma', website: `${base}/with-thefork`, phone: '+43 316 111' });
  assert.deepEqual([withBooking.kind, withBooking.service, withBooking.telUrl], ['link', 'TheFork', 'tel:+43316111']);
  const none = await bookingOptions({ name: 'Wirtshaus', website: `${base}/without-booking`, phone: '+43 1 2' });
  assert.equal(none.kind, 'phone');
  const siteOnly = await bookingOptions({ name: 'X', website: `${base}/without-booking` });
  assert.deepEqual([siteOnly.kind, siteOnly.url], ['website', `${base}/without-booking`]);
  assert.equal((await bookingOptions({ name: 'Pizza', website: 'http://127.0.0.1:1/unreachable', phone: '+43 316 444' })).kind, 'phone', 'Webseite weg → Telefon');
  assert.equal((await bookingOptions({ name: 'Nichts' })).kind, 'none');
  net.netOptions.allowPrivate = false;
  try { assert.equal((await bookingOptions({ name: 'Intern', website: `${base}/with-thefork`, phone: '+43 1 1' })).kind, 'phone', 'private Adresse: nicht abgerufen'); } finally { net.netOptions.allowPrivate = true; }
});

test('Chat: Restaurantsuche läuft als Profi-Aufgabe (Sonnet) mit Websuche, Werkzeug liefert Karte, ehrlicher Prompt', async () => {
  const u = mk('plus', place);
  requests.length = 0;
  setScript((req, call) => {
    if (call === 0) return toolUse('find_restaurants', { cuisine: 'italienisch', when: '2026-11-14T19:30', people: 4 });
    return text('Ich habe zwei italienische Lokale gefunden. Reservieren musst du selbst – nimm den Link oder ruf an.');
  });
  const before = usedCount(u.get(), 'pro_task');
  const res = await handleChat(u.get(), 'Such mir ein italienisches Restaurant für Samstag 19:30 für 4 Personen', 'r1');
  const first = requests[0]!.body;
  assert.ok(String(first.model).includes('sonnet'), 'Profi-Aufgabe');
  const toolNames = (first.tools as { name: string }[]).map((t) => t.name);
  assert.ok(['find_restaurants', 'booking_options', 'report_availability', 'web_search', 'web_fetch'].every((x) => toolNames.includes(x)), toolNames.join(','));
  assert.match(JSON.stringify(first.system), /cannot book, buy or pay/);
  assert.match(JSON.stringify(first.system), /Never invent opening hours or stock/);
  const card = lastCard(res);
  assert.equal(card.type, 'restaurants');
  assert.equal(card.people, 4);
  assert.equal(card.items[0].name, 'Trattoria Roma');
  assert.equal(card.items[0].bookingService, 'TheFork', 'Buchungslink wird erkannt');
  assert.ok(card.items[0].bookingUrl.startsWith('https://widget.thefork.com/'));
  assert.equal(usedCount(u.get(), 'pro_task') - before, 1);
});

test('Ohne Ort: Stella fragt einmal nach (Karte), erfindet keinen Ort', async () => {
  const u = mk('plus');
  setScript((_req, call) => (call === 0 ? toolUse('find_restaurants', { cuisine: 'sushi' }) : text('Dafür brauche ich deinen Standort.')));
  const res = await handleChat(u.get(), 'Restaurant in der Nähe bitte', 'r2');
  assert.equal(lastCard(res).type, 'location_ask');
  const res2 = await handleChat(u.get(), 'Noch ein Restaurant bitte', 'r3');
  assert.notEqual(lastCard(res2)?.type, 'location_ask', 'nur einmal gefragt');
});

test('Verfügbarkeit: ohne Quelle kein „lagernd“, Karte mit Zeitpunkt, ehrlich bei „unklar“', async () => {
  const u = mk('pro', place);
  setScript((_req, call) => (call === 0
    ? toolUse('report_availability', { product: 'Switch 2', results: [
      { retailer: 'MediaMarkt', store: 'Graz Center West', status: 'in_stock', source: 'Webseite des Händlers', url: 'https://mediamarkt.example/switch2' },
      { retailer: 'Saturn', status: 'in_stock', source: '' },
      { retailer: 'Amazon', status: 'orderable', source: 'amazon.example', url: 'javascript:alert(1)' },
      { retailer: '', status: 'in_stock', source: 'x' },
    ] })
    : text('MediaMarkt hat sie laut Webseite lagernd, bei Saturn ist es unklar.')));
  const res = await handleChat(u.get(), 'Hat MediaMarkt in der Nähe die Switch 2 lagernd?', 'a1');
  const card = lastCard(res);
  assert.equal(card.type, 'availability');
  assert.equal(card.product, 'Switch 2');
  assert.deepEqual(card.items.map((i: { retailer: string; status: string }) => [i.retailer, i.status]), [['MediaMarkt', 'in_stock'], ['Saturn', 'unclear'], ['Amazon', 'orderable']]);
  assert.equal(card.items[2].url, undefined, 'nur http(s)-Links');
  assert.ok(Math.abs(Date.parse(card.checkedAt) - Date.now()) < 60_000);
});

test('Abo: Free bekommt keine Werkzeuge und keinen Modellaufruf – nur den Hinweis; normale Chats bleiben ohne Alltags-Werkzeuge', async () => {
  const free = mk('free', place);
  requests.length = 0;
  const res = await handleChat(free.get(), 'Wo ist ein gutes Restaurant für heute Abend?', 'f1');
  assert.equal(requests.length, 0, 'kein Modellaufruf, kein Kontingent verbraucht');
  assert.equal(res.messages.at(-1)!.text, 'Restaurants finden, Reservierungen vorbereiten und Verfügbarkeit prüfen gibt es ab dem Plus-Abo.');
  assert.equal(usedCount(free.get(), 'ai_message'), 0);

  const plus = mk('plus', place);
  setScript(() => text('Hallo! Wie kann ich helfen?'));
  requests.length = 0;
  await handleChat(plus.get(), 'Wie geht es dir heute so im Allgemeinen?', 'p1');
  const names = ((requests[0]?.body.tools ?? []) as { name: string }[]).map((t) => t.name);
  assert.ok(!names.includes('find_restaurants') && !names.includes('web_search'), 'ohne Alltagsaufgabe keine Websuche');
});

test('„In den Planer“: legt einen Termin an, mit Rückgängig; nichts wird als gebucht ausgegeben', async () => {
  const u = mk('plus');
  const res = await app.inject({ method: 'POST', url: '/api/errands/plan', headers: { authorization: `Bearer ${u.token}` }, payload: { name: 'Trattoria Roma', when: '2026-11-14T19:30', people: 4, phone: '+43 316 111', address: 'Hauptplatz 1' } });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { status: string; actionId: string; items: { title: string; due: string; time: string; detail: string; kind: string }[] };
  assert.equal(body.status, 'done');
  const item = body.items[0]!;
  assert.deepEqual([item.kind, item.title, item.due, item.time], ['event', 'Reservierung: Trattoria Roma', '2026-11-14', '19:30']);
  assert.match(item.detail, /4 Personen/);
  assert.match(item.detail, /Noch nicht gebucht/);
  const { entry } = undo(u.id, body.actionId);
  assert.equal(entry.status, 'undone');
  assert.equal((db.prepare('SELECT deleted FROM items WHERE id = ?').get((body.items[0] as unknown as { id: string }).id) as { deleted: number }).deleted, 1, 'Rückgängig löscht den Termin wieder');
  assert.equal((await app.inject({ method: 'POST', url: '/api/errands/plan', headers: { authorization: `Bearer ${u.token}` }, payload: { name: '', when: 'morgen' } })).statusCode, 400);
});
