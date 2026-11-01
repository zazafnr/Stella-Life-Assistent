import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';

// Simuliertes Open-Meteo: zählt Abrufe, Antwort mit Regen ab 15 Uhr
const calls: URL[] = [];
const hourly = { precipitation_probability: Array.from({ length: 24 }, (_, h) => (h >= 15 ? 90 : 5)), weather_code: Array.from({ length: 24 }, () => 61) };
const meteo = createServer((req, res) => {
  calls.push(new URL(req.url ?? '', 'http://x'));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ current: { weather_code: 3, temperature_2m: 14.4, is_day: 1, wind_speed_10m: 20 }, hourly }));
});
await new Promise<void>((r) => meteo.listen(0, r));

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-weather-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STELLA_WEATHER_URL = `http://127.0.0.1:${(meteo.address() as AddressInfo).port}`;

const { register, HttpError, requireUser } = await import('./auth.ts');
const { getUser, updateUserSettings } = await import('./db.ts');
const { setGeoReader, lookupIp, isPrivateIp } = await import('./geoip.ts');
const w = await import('./weather.ts');
const { buildBriefing } = await import('./briefing.ts');

const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); w.registerWeatherRoutes(api); });
await app.ready();
after(async () => { await app.close(); meteo.close(); });

const user = (name: string, settings: Record<string, unknown> = {}) => {
  const { user: u, token } = register(name, `${name.toLowerCase()}@example.com`, 'supergeheim', 'Europe/Vienna') as { user: { id: string }; token: string };
  updateUserSettings(u.id, { locale: 'de', ...settings });
  return { get: () => getUser(u.id)!, headers: { authorization: `Bearer ${token}` } };
};
const get = (u: ReturnType<typeof user>, ip = '203.0.113.9') => app.inject({ method: 'GET', url: '/api/weather/approx', headers: u.headers, remoteAddress: ip });

test('IP-Ort: private Adressen zählen nicht, ohne Datenbank gibt es keinen Treffer', async () => {
  assert.ok(isPrivateIp('192.168.1.5') && isPrivateIp('10.0.0.1') && isPrivateIp('127.0.0.1') && isPrivateIp('::1') && isPrivateIp('172.20.1.1'));
  assert.ok(!isPrivateIp('203.0.113.9'));
  setGeoReader(null);
  assert.equal(await lookupIp('203.0.113.9'), null);
  setGeoReader({ get: (ip) => (ip === '203.0.113.9' ? { location: { latitude: 47.0707, longitude: 15.4395 }, country: { iso_code: 'AT' } } : null) });
  assert.deepEqual(await lookupIp('203.0.113.9'), { lat: 47.0707, lon: 15.4395, country: 'AT' });
  assert.equal(await lookupIp('192.168.1.5'), null);
  assert.equal(await lookupIp('::ffff:203.0.113.9') !== null, true, 'IPv4 in IPv6-Schreibweise');
});

test('Ort ohne Freigabe: letzter guter Ort (unter 7 Tagen) → IP-Ort → Hauptstadt', async () => {
  setGeoReader({ get: () => ({ location: { latitude: 47.0707, longitude: 15.4395 } }) });
  const none = user('Nora', { country: 'AT' });
  assert.equal((await w.approxPlace(none.get(), '203.0.113.9'))!.source, 'ip');
  assert.deepEqual(await w.approxPlace(none.get(), '203.0.113.9'), { lat: 47.07, lon: 15.44, source: 'ip' });
  assert.deepEqual(await w.approxPlace(none.get(), '10.0.0.2'), { ...w.CAPITALS.AT, source: 'capital' });

  w.rememberPlace(none.get(), 48.208491, 16.372082);
  assert.deepEqual(none.get().settings.lastPlace && { lat: none.get().settings.lastPlace!.lat, lon: none.get().settings.lastPlace!.lon }, { lat: 48.21, lon: 16.37 }, 'nur gerundet gespeichert');
  assert.equal((await w.approxPlace(none.get(), '203.0.113.9'))!.source, 'last', 'frischer letzter Ort schlägt die IP');

  updateUserSettings(none.get().id, { lastPlace: { lat: 48.21, lon: 16.37, at: new Date(Date.now() - 8 * 86400_000).toISOString() } });
  assert.equal((await w.approxPlace(none.get(), '203.0.113.9'))!.source, 'ip', 'älter als 7 Tage zählt nicht');

  assert.equal(await w.approxPlace(user('Omar', { country: 'OTHER' }).get(), '10.0.0.2'), null);
});

test('GET /api/weather/approx liefert die Szene und merkt sich pro Rasterzelle 10 Minuten', async () => {
  w.clearWeatherCache(); calls.length = 0;
  setGeoReader(null);
  const a = user('Anna', { country: 'DE' });
  const res = await get(a);
  assert.equal(res.statusCode, 200);
  const body = res.json() as { weather: { type: string; temp: number; wind: number; place: { lat: number } }; source: string };
  assert.equal(body.source, 'capital');
  assert.deepEqual([body.weather.type, body.weather.temp, body.weather.wind], ['cloudy', 14, 1]);
  assert.equal(body.weather.place.lat, 52.52);
  const q = calls[0]!.searchParams;
  assert.equal(q.get('current'), 'weather_code,temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover');
  assert.ok(q.get('hourly')!.includes('precipitation_probability'));

  await get(a); await get(user('Ben', { country: 'DE' }));
  assert.equal(calls.length, 1, 'zweiter und dritter Abruf kommen aus dem Zwischenspeicher');
});

test('Ort melden: gerundet gespeichert, abgelehnter Standort wird nicht gespeichert', async () => {
  const c = user('Clara', { locationPermission: 'granted' });
  const ok = await app.inject({ method: 'POST', url: '/api/weather/place', headers: c.headers, payload: { lat: 47.123456, lon: 8.987654 } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([c.get().settings.lastPlace!.lat, c.get().settings.lastPlace!.lon], [47.12, 8.99]);
  assert.equal((await app.inject({ method: 'POST', url: '/api/weather/place', headers: c.headers, payload: { lat: 'x' } })).statusCode, 400);
  const d = user('Dora', { locationPermission: 'denied' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/weather/place', headers: d.headers, payload: { lat: 47.1, lon: 8.9 } })).statusCode, 403);
  assert.equal(d.get().settings.lastPlace, undefined);
});

test('Briefing: Wetterzeile im Ton der Nutzerin, mit Regen ab 15 Uhr', async () => {
  w.clearWeatherCache();
  const e = user('Eva', { country: 'AT', tone: 'nett' });
  assert.equal(w.weatherLine(e.get()), null, 'ohne Abruf keine Zeile');
  await w.warmWeather(e.get());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Vienna' }).format(new Date()));
  const line = w.weatherLine(e.get())!;
  if (hour < 15) { assert.match(line, /^Heute 14°, ab 15:00 Regen\. Pack einen Schirm ein\.$/); }
  else assert.match(line, /Heute 14°/);
  const b = buildBriefing(e.get());
  assert.equal(b.sections[0]!.id, 'weather');
  updateUserSettings(e.get().id, { tone: 'frech' });
  if (hour < 15) assert.match(w.weatherLine(e.get())!, /Sag nicht, ich hätte dich nicht gewarnt/);
  updateUserSettings(e.get().id, { locale: 'en' });
  if (hour < 15) assert.match(w.weatherLine(e.get())!, /^Today 14°, rain from 15:00\./);
});

test('Briefing ohne Ort und ohne Land: keine Wetterzeile, kein Fehler', async () => {
  const f = user('Finn', { country: 'OTHER' });
  await w.warmWeather(f.get());
  assert.equal(w.weatherLine(f.get()), null);
  assert.ok(!buildBriefing(f.get()).sections.some((s) => s.id === 'weather'));
});
