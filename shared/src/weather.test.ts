import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wmoToType, windLevel, parseOpenMeteo, parseDayForecast, openMeteoUrl, roundPlace, startWeather, isStaleWeather, WEATHER_STALE_MS,
  type WeatherState, type WeatherType,
} from './index.ts';

test('WMO-Codes werden auf die zehn Szenen abgebildet', () => {
  const expect: [number, WeatherType][] = [
    [0, 'clear'], [1, 'clear'], [2, 'partly'], [3, 'cloudy'], [45, 'fog'], [48, 'fog'], [51, 'drizzle'], [55, 'drizzle'], [56, 'sleet'], [66, 'sleet'],
    [61, 'rain'], [63, 'rain'], [80, 'rain'], [65, 'heavy_rain'], [82, 'heavy_rain'], [71, 'snow'], [75, 'snow'], [86, 'snow'], [95, 'thunder'], [99, 'thunder'], [999, 'cloudy'],
  ];
  for (const [code, type] of expect) assert.equal(wmoToType(code), type, `Code ${code}`);
});

test('Wind in Stufen', () => {
  assert.deepEqual([0, 14, 15, 29, 30, 49, 50, 90].map(windLevel), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('Open-Meteo-Antwort → Szene, Ort auf etwa 1 km gerundet, Tag/Nacht', () => {
  const json = { current: { weather_code: 63, temperature_2m: 13.6, is_day: 0, wind_speed_10m: 33 } };
  const w = parseOpenMeteo(json, { lat: 48.20849, lon: 16.37208 }, 1000)!;
  assert.deepEqual(w, { type: 'rain', day: false, temp: 14, wind: 2, place: { lat: 48.21, lon: 16.37 }, at: 1000 });
  assert.equal(parseOpenMeteo({ current: {} }), null);
  assert.equal(parseOpenMeteo(null), null);
  assert.deepEqual(roundPlace(47.123456, 8.987654), { lat: 47.12, lon: 8.99 });
});

test('Die Abfrage fragt genau die Felder aus dem Plan an', () => {
  const url = new URL(openMeteoUrl(48.2085, 16.3721, { hourly: true }));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('current'), 'weather_code,temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover');
  assert.equal(url.searchParams.get('daily'), 'sunrise,sunset');
  assert.ok(url.searchParams.get('hourly')!.includes('precipitation_probability'));
  assert.equal(url.searchParams.get('latitude'), '48.21');
});

test('Wetterzeile: erste Stunde mit Regen ab jetzt, Schnee wird erkannt', () => {
  const hourly = { precipitation_probability: Array.from({ length: 24 }, (_, h) => (h >= 15 ? 80 : 10)), weather_code: Array.from({ length: 24 }, () => 61) };
  const f = parseDayForecast({ current: { weather_code: 3, temperature_2m: 14.2, is_day: 1 }, hourly }, 8)!;
  assert.deepEqual(f, { temp: 14, type: 'cloudy', wetFrom: 15, wetKind: 'rain' });
  const snow = parseDayForecast({ current: { weather_code: 3, temperature_2m: -1, is_day: 1 }, hourly: { ...hourly, weather_code: hourly.weather_code.map(() => 73) } }, 20)!;
  assert.equal(snow.wetKind, 'snow');
  assert.equal(parseDayForecast({ current: { weather_code: 0, temperature_2m: 20 }, hourly: { precipitation_probability: Array(24).fill(0) } }, 6)!.wetFrom, undefined);
});

test('Veraltet nach 3 Stunden', () => {
  assert.ok(!isStaleWeather({ at: 1000 }, 1000 + WEATHER_STALE_MS));
  assert.ok(isStaleWeather({ at: 1000 }, 1001 + WEATHER_STALE_MS));
});

const saved: WeatherState = { type: 'cloudy', day: true, temp: 9, wind: 0, at: 1 };
const sunny = { current: { weather_code: 0, temperature_2m: 21.2, is_day: 1, wind_speed_10m: 4 } };
const mk = (over: Partial<Parameters<typeof startWeather>[0]> = {}) => {
  const changes: WeatherState[] = [];
  const stored: WeatherState[] = [];
  const reported: { lat: number; lon: number }[] = [];
  const deps = {
    fetch: async () => ({ ok: true, json: async () => sunny }),
    cache: { get: () => saved, set: (w: WeatherState) => { stored.push(w); } },
    geo: async () => ({ lat: 48.2085, lon: 16.3721 }), approx: async () => null,
    reportPlace: (p: { lat: number; lon: number }) => { reported.push(p); },
    onChange: (w: WeatherState) => { changes.push(w); }, now: () => 5000, geoTimeoutMs: 40, fetchTimeoutMs: 40, ...over,
  };
  return { deps, changes, stored, reported };
};

test('Start: das gespeicherte Wetter erscheint sofort, das frische ersetzt es', async () => {
  const { deps, changes, stored, reported } = mk();
  const { initial, done } = startWeather(deps);
  assert.deepEqual(initial, saved);
  assert.deepEqual(changes, [saved], 'vor dem ersten await da');
  await done;
  assert.equal(changes.length, 2);
  assert.equal(changes[1]!.type, 'clear');
  assert.equal(stored.at(-1)!.temp, 21);
  assert.deepEqual(reported, [{ lat: 48.21, lon: 16.37 }]);
});

test('Das Wetter blockiert den Start nicht: hängender Standort und hängender Abruf', async () => {
  const hang = () => new Promise<never>(() => {});
  const t0 = Date.now();
  const a = mk({ geo: hang });
  await startWeather(a.deps).done;
  assert.ok(Date.now() - t0 < 1000, 'wartet höchstens auf die Zeitlimits');
  assert.deepEqual(a.changes, [saved], 'ohne Antwort bleibt das gespeicherte Wetter');

  const b = mk({ fetch: hang, approx: async () => ({ type: 'rain', day: true, temp: 11, wind: 1, at: 0 }) });
  await startWeather(b.deps).done;
  assert.equal(b.changes.at(-1)!.type, 'rain', 'Rückfall auf die Server-Näherung');
  assert.equal(b.changes.at(-1)!.at, 5000);
});

test('Kein Standort → Server-Näherung; Fehler werfen nie', async () => {
  const a = mk({ geo: async () => null, approx: async () => ({ type: 'fog', day: false, temp: 3, wind: 0, at: 0 }) });
  await startWeather(a.deps).done;
  assert.equal(a.changes.at(-1)!.type, 'fog');
  assert.deepEqual(a.reported, []);
  const b = mk({ cache: { get: () => null, set: () => {} }, geo: async () => { throw new Error('kaputt'); }, approx: async () => { throw new Error('auch kaputt'); } });
  await startWeather(b.deps).done;
  assert.deepEqual(b.changes, []);
});

test('Gleiches Wetter löst keine neue Überblendung aus', async () => {
  const same: WeatherState = { type: 'clear', day: true, temp: 21, wind: 0, at: 1 };
  const { deps, changes } = mk({ cache: { get: () => same, set: () => {} } });
  await startWeather(deps).done;
  assert.equal(changes.length, 1);
});

test('iOS kennt dieselben Wettertypen und dieselbe WMO-Abbildung wie shared', async () => {
  const { readFileSync } = await import('node:fs');
  const { WEATHER_TYPES } = await import('./index.ts');
  const swift = readFileSync(new URL('../../ios/Stella.swiftpm/Core/Weather.swift', import.meta.url), 'utf8');
  const types = /static let types = \[([^\]]+)\]/.exec(swift)![1]!.split(',').map((s) => s.trim().replace(/"/g, ''));
  assert.deepEqual(types, [...WEATHER_TYPES]);
  // jede Zeile „case 51...55: return "drizzle"“ prüfen
  for (const m of swift.matchAll(/case ([0-9., ]+(?:\.\.\.[0-9]+)?[0-9, .]*): return "([a-z_]+)"/g)) {
    for (const part of m[1]!.split(',').map((s) => s.trim())) {
      const [from, to] = part.includes('...') ? part.split('...').map(Number) : [Number(part), Number(part)];
      for (let code = from!; code <= to!; code++) assert.equal(wmoToType(code), m[2], `Code ${code}`);
    }
  }
});
