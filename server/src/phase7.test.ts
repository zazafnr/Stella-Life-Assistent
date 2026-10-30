import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock: Overpass (Läden), Groq (unbekannte Wörter), OpenRouter (Agent)
let overpassCalls = 0;
let groqCalls = 0;
const queries: string[] = [];
const shop = (id: number, name: string | undefined, dLat: number, hours?: string) => ({ type: 'node', id, lat: 48.2 + dLat, lon: 16.37, tags: { ...(name ? { name } : {}), ...(hours ? { opening_hours: hours } : {}), 'addr:street': 'Hauptstraße', 'addr:housenumber': String(id) } });
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/overpass') {
      overpassCalls++;
      queries.push(decodeURIComponent(body));
      res.end(JSON.stringify({ elements: [shop(1, 'Blumen Weit', 0.02, 'Mo-Su 00:00-24:00'.replace('24:00', '23:59')), shop(2, 'Blume 7', 0.002, 'Mo-Fr 08:00-18:00; Sa 08:00-13:00'), shop(3, undefined, 0.004), shop(4, 'Rosenhof', 0.01, 'Mo-Su 09:00-18:00; PH off'), shop(5, 'Noch weiter', 0.025)] }));
      return;
    }
    if (req.url === '/groq/chat/completions') {
      groqCalls++;
      const prompt = String(JSON.parse(body).messages[1].content);
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ category: /Gartenerde/.test(prompt) ? 'diy' : 'none' }) } }] }));
      return;
    }
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Das weiß ich nicht.' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p7-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = base;
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;
process.env.OVERPASS_URL = `${base}/overpass`;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db, getUser, listItems, recentMessages } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { undo } = await import('./actions.ts');
const { allLists, openItems, registerListRoutes } = await import('./lists.ts');
const { applyProfile } = await import('./profile.ts');
const { cellKey, nearbyPlaces, openNow, resolvePlace, distanceM } = await import('./places.ts');
const { sendDueReminders } = await import('./scheduler.ts');
const { todayIn, timeIn } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const lukas = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const mia = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(lukas.user.id)!;
const say = (text: string) => handleChat(user(), text, null);
const open = () => openItems(lukas.user.id).map((i) => i.text);

test('Einkaufsliste im Chat: aufschreiben, mehrere Dinge, nicht doppelt, mit Rückgängig', async () => {
  const one = await say('schreib Milch auf die Einkaufsliste');
  assert.match(one.messages[0]!.text, /Milch/);
  assert.ok(one.messages[0]!.actionId, 'Karte mit Rückgängig');
  assert.deepEqual(open(), ['Milch']);

  const two = await say('wir brauchen Eier und 2 Liter Butter');
  assert.deepEqual(open().sort(), ['Butter', 'Eier', 'Milch']);
  assert.equal(openItems(lukas.user.id).find((i) => i.text === 'Butter')!.qty, '2 Liter');

  const dup = await say('schreib Milch auf die Einkaufsliste');
  assert.match(dup.messages[0]!.text, /schon/);
  assert.equal(open().filter((t) => t === 'Milch').length, 1);

  undo(lukas.user.id, two.messages[0]!.actionId!);
  assert.deepEqual(open(), ['Milch']);
});

test('Einkaufsliste anzeigen, abhaken, alles abhaken – jeweils mit Rückgängig', async () => {
  await say('wir brauchen Eier, Butter und Brot');
  const shown = await say('was steht auf der Einkaufsliste?');
  assert.match(shown.messages[0]!.text, /Einkaufsliste\*\* \(4\)/);
  assert.match(shown.messages[0]!.text, /- Milch/);

  const one = await say('Milch hab ich');
  assert.match(one.messages[0]!.text, /Abgehakt: Milch/);
  assert.ok(!open().includes('Milch'));
  undo(lukas.user.id, one.messages[0]!.actionId!);
  assert.ok(open().includes('Milch'), 'Rückgängig öffnet wieder');

  const unknown = await say('Spaghetti hab ich');
  assert.match(unknown.messages[0]!.text, /weiß ich nicht/, 'nicht auf der Liste → die KI antwortet');

  const all = await say('hab eingekauft');
  assert.match(all.messages[0]!.text, /Alles abgehakt \(4\)/);
  assert.equal(open().length, 0);
  const empty = await say('Einkaufsliste');
  assert.match(empty.messages[0]!.text, /leer/);
});

test('Erledigung: „nach der Arbeit Blumen kaufen“ → Erinnerung zum Arbeitsende, Ort am Eintrag', async () => {
  // ohne Profil: 17:30
  const first = await say('nach der Arbeit Blumen für meine Frau kaufen');
  const item = listItems(lukas.user.id, { kind: 'reminder' }).find((i) => i.title === 'Blumen für meine Frau kaufen')!;
  assert.equal(item.time, '17:30');
  assert.deepEqual(item.place, { category: 'florist', label: 'Blumenladen' });
  assert.match(first.messages[0]!.text, /Blumenläden in der Nähe/);
  const rem = db.prepare('SELECT message FROM reminders WHERE item_id = ?').get(item.id) as { message: string } | undefined;
  assert.match(rem?.message ?? '', /Blumen/);

  // mit Arbeitszeit im Profil: Ende der Arbeit
  applyProfile(user(), { situation: 'work', features: ['planner'], workHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '16:15' } });
  await say('nach der Arbeit Hustensaft holen');
  const second = listItems(lukas.user.id, { kind: 'reminder' }).find((i) => i.title === 'Hustensaft holen')!;
  assert.equal(second.time, '16:15');
  assert.equal(second.place?.category, 'pharmacy');
  const expectedDue = '16:15' > timeIn('Europe/Vienna') ? todayIn('Europe/Vienna') : todayIn('Europe/Vienna', new Date(Date.now() + 86_400_000));
  assert.equal(second.due, expectedDue);
});

test('unbekanntes Wort: Groq schlägt ein Geschäft vor – und merkt es sich', async () => {
  groqCalls = 0;
  const gardening = await resolvePlace(lukas.user.id, 'Gartenerde für den Balkon kaufen');
  assert.equal(gardening?.category, 'diy');
  assert.deepEqual(await resolvePlace(lukas.user.id, 'Gartenerde für den Balkon kaufen'), gardening);
  assert.equal(groqCalls, 1, 'zweites Mal aus dem Cache');
  assert.equal(await resolvePlace(lukas.user.id, 'ein Geschenk besorgen'), null, 'kein typisches Geschäft');
});

test('Erinnerung feuert → Karte „Läden in der Nähe“ an der Nachricht', async () => {
  const item = listItems(lukas.user.id, { kind: 'reminder' }).find((i) => i.title === 'Blumen für meine Frau kaufen')!;
  db.prepare('UPDATE reminders SET fire_at = ? WHERE item_id = ?').run(new Date(Date.now() - 1000).toISOString(), item.id);
  await sendDueReminders();
  const msg = recentMessages(lukas.user.id, 5).find((m) => m.card);
  assert.deepEqual(msg?.card, { type: 'places', category: 'florist', label: 'Blumenladen', itemId: item.id });
});

// ----- Läden in der Nähe -----

test('Läden: die nächsten drei, nach Entfernung, mit Öffnungszeiten und Karten-Links; zweite Anfrage aus dem Cache', async () => {
  overpassCalls = 0;
  queries.length = 0;
  const lat = 48.2, lon = 16.37;
  const at = new Date('2026-10-28T10:00:00+01:00'); // Mittwoch 10:00 Wien
  const r = await nearbyPlaces(mia.user.id, 'Europe/Vienna', 'florist', lat, lon, at);
  assert.equal(r.plural, 'Blumenläden');
  assert.deepEqual(r.places.map((p) => p.name), ['Blume 7', 'Blumenladen', 'Rosenhof'], 'ohne Namen steht die Art des Ladens');
  assert.deepEqual(r.places.map((p) => p.distanceM), [distanceM(lat, lon, 48.202, 16.37), distanceM(lat, lon, 48.204, 16.37), distanceM(lat, lon, 48.21, 16.37)]);
  assert.ok(r.places[0]!.distanceM < r.places[1]!.distanceM && r.places[1]!.distanceM < r.places[2]!.distanceM);
  assert.equal(r.places[0]!.openNow, true);
  assert.equal(r.places[1]!.openNow, null, 'keine Zeiten bekannt');
  assert.equal(r.places[2]!.openNow, null, 'Feiertags-Regel nicht lesbar → unbekannt');
  assert.match(r.places[0]!.appleMapsUrl, /^https:\/\/maps\.apple\.com\/\?daddr=48\.202,16\.37&q=Blume%207$/);
  assert.match(r.places[0]!.osmUrl, /openstreetmap\.org\/\?mlat=48\.202/);
  assert.match(queries[0]!, /\["shop"="florist"\]/);
  assert.match(queries[0]!, /around:3000/);

  // 200 m weiter, gleiche Zelle → Cache
  await nearbyPlaces(mia.user.id, 'Europe/Vienna', 'florist', lat + 0.001, lon, at);
  assert.equal(overpassCalls, 1);
  assert.equal(cellKey('florist', lat, lon), cellKey('florist', lat + 0.001, lon));
  assert.notEqual(cellKey('florist', lat, lon), cellKey('florist', lat + 0.02, lon));
  // der Standort selbst wird nirgends gespeichert
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM places_cache').all()).includes('48.2000'));
});

test('Öffnungszeiten lesen: Wochentage, Mittagspause, Nacht, 24/7, Unlesbares', () => {
  const wed10 = new Date('2026-10-28T10:00:00+01:00');
  const sun10 = new Date('2026-11-01T10:00:00+01:00');
  const wed20 = new Date('2026-10-28T20:00:00+01:00');
  assert.equal(openNow('Mo-Fr 08:00-18:00; Sa 08:00-13:00', wed10, 'Europe/Vienna'), true);
  assert.equal(openNow('Mo-Fr 08:00-18:00; Sa 08:00-13:00', sun10, 'Europe/Vienna'), false);
  assert.equal(openNow('Mo-Fr 08:00-18:00', wed20, 'Europe/Vienna'), false);
  assert.equal(openNow('Mo-Fr 08:00-12:00,14:00-18:00', new Date('2026-10-28T13:00:00+01:00'), 'Europe/Vienna'), false);
  assert.equal(openNow('Mo-Su 22:00-02:00', new Date('2026-10-28T23:30:00+01:00'), 'Europe/Vienna'), true);
  assert.equal(openNow('24/7', sun10, 'Europe/Vienna'), true);
  assert.equal(openNow('Mo-Fr 08:00-18:00; We off', wed10, 'Europe/Vienna'), false, 'spätere Regel gewinnt');
  assert.equal(openNow('sunrise-sunset', wed10, 'Europe/Vienna'), null);
  assert.equal(openNow(null, wed10, 'Europe/Vienna'), null);
});

test('Läden: unbekannte Kategorie, ungültiger Standort, Limit pro Stunde', async () => {
  await assert.rejects(nearbyPlaces(mia.user.id, 'Europe/Vienna', 'casino', 48, 16), (e: unknown) => e instanceof HttpError && e.status === 400);
  await assert.rejects(nearbyPlaces(mia.user.id, 'Europe/Vienna', 'florist', 123, 16), (e: unknown) => e instanceof HttpError && e.status === 400);
  const other = register('Tim', 'tim@example.com', 'supergeheim', 'Europe/Vienna').user;
  let last = 0;
  for (let i = 0; i < 31; i++) {
    try { await nearbyPlaces(other.id, 'Europe/Vienna', 'florist', 48.2, 16.37); } catch (e) { last = (e as InstanceType<typeof HttpError>).status; }
  }
  assert.equal(last, 429);
});

// ----- Listen-Ansicht -----

test('Listen-Routen: eigene Liste lesen, hinzufügen, abhaken, löschen, Erledigtes aufräumen – fremde nicht', async () => {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
  await app.register(async (api) => { api.addHook('preHandler', requireUser); registerListRoutes(api); });
  await app.ready();
  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  const lists = (await app.inject({ method: 'GET', url: '/api/lists', headers: as(lukas.token) })).json().lists;
  assert.equal(lists[0].kind, 'shopping');
  const listId = lists[0].id as string;

  const add = await app.inject({ method: 'POST', url: `/api/lists/${listId}/items`, headers: as(lukas.token), payload: { text: 'Apfelsaft', qty: '2 Flaschen' } });
  assert.equal(add.statusCode, 200);
  const created = add.json().created[0] as { id: string; addedVia: string };
  assert.equal(created.addedVia, 'app');

  assert.equal((await app.inject({ method: 'GET', url: '/api/lists', headers: as(mia.token) })).json().lists[0].items.length, 0, 'Mia sieht Lukas’ Liste nicht');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/list-items/${created.id}`, headers: as(mia.token), payload: { done: true } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/lists/${listId}/items`, headers: as(mia.token), payload: { text: 'Klau' } })).statusCode, 404);

  const done = await app.inject({ method: 'PATCH', url: `/api/list-items/${created.id}`, headers: as(lukas.token), payload: { done: true } });
  assert.equal(done.json().list.items.at(-1).done, true, 'Erledigtes steht unten');
  const cleared = await app.inject({ method: 'POST', url: `/api/lists/${listId}/clear-done`, headers: as(lukas.token) });
  assert.ok(cleared.json().removed >= 1, 'Erledigtes ist weg');
  assert.equal(allLists(lukas.user.id)[0]!.items.some((i) => i.id === created.id), false);
  assert.equal((await app.inject({ method: 'POST', url: `/api/lists/${listId}/items`, headers: as(lukas.token), payload: { text: '  ' } })).statusCode, 400);
  await app.close();
});
