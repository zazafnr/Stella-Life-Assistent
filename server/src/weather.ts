// Wetter auf dem Server: ungefähres Wetter ohne Standortfreigabe, Wetterzeile im Briefing, gerundeter letzter Ort.
// Mit Freigabe holt die App das Wetter selbst direkt bei Open-Meteo (shared/src/weather.ts) – der Server sieht dann nur den gerundeten Ort.

import type { FastifyInstance } from 'fastify';
import { isPlace, openMeteoUrl, parseDayForecast, parseOpenMeteo, roundPlace, timeIn, type WeatherState } from '@stella/shared';
import { config } from './config.ts';
import { getUser, updateUserSettings, type User } from './db.ts';
import { HttpError } from './auth.ts';
import { lookupIp } from './geoip.ts';
import { tr } from './locale.ts';

/** Hauptstadt je Land – der letzte Rückfall, wenn weder Standort noch IP-Ort da sind */
export const CAPITALS: Record<string, { lat: number; lon: number }> = {
  AT: { lat: 48.21, lon: 16.37 }, DE: { lat: 52.52, lon: 13.41 }, CH: { lat: 46.95, lon: 7.45 }, LI: { lat: 47.14, lon: 9.52 },
  IT: { lat: 41.89, lon: 12.51 }, FR: { lat: 48.86, lon: 2.35 }, ES: { lat: 40.42, lon: -3.7 }, PT: { lat: 38.72, lon: -9.14 },
  BR: { lat: -15.79, lon: -47.88 }, TR: { lat: 39.93, lon: 32.86 }, PL: { lat: 52.23, lon: 21.01 }, GB: { lat: 51.51, lon: -0.13 },
  IE: { lat: 53.35, lon: -6.26 }, US: { lat: 38.91, lon: -77.04 }, CA: { lat: 45.42, lon: -75.7 }, AU: { lat: -35.28, lon: 149.13 },
  MX: { lat: 19.43, lon: -99.13 }, AR: { lat: -34.6, lon: -58.38 },
};

const CACHE_MS = 10 * 60_000;
const LAST_PLACE_MAX_AGE_MS = 7 * 24 * 3600_000;
interface Cached { at: number; json: unknown }
const cache = new Map<string, Cached>();
/** Für Tests */
export const clearWeatherCache = () => cache.clear();

/** Raster von etwa 10 km: Nutzer in der gleichen Zelle teilen sich den Abruf (10 Minuten) */
const cell = (p: { lat: number; lon: number }) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;

async function forecastJson(place: { lat: number; lon: number }): Promise<unknown | null> {
  const key = cell(place);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.json;
  try {
    const res = await fetch(openMeteoUrl(place.lat, place.lon, { base: config.weather.baseUrl, hourly: true }), { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return hit?.json ?? null;
    const json = await res.json();
    cache.set(key, { at: Date.now(), json });
    return json;
  } catch {
    return hit?.json ?? null;
  }
}

export async function weatherAt(place: { lat: number; lon: number }): Promise<WeatherState | null> {
  const p = roundPlace(place.lat, place.lon);
  return parseOpenMeteo(await forecastJson(p), p);
}

export type PlaceSource = 'last' | 'ip' | 'capital';

/** Ort ohne Freigabe: zuletzt bekannter guter Ort (unter 7 Tagen) → IP-Ort → Hauptstadt des Landes aus dem Profil */
export async function approxPlace(user: User, ip?: string): Promise<{ lat: number; lon: number; source: PlaceSource } | null> {
  const last = user.settings.lastPlace;
  if (last && Date.now() - Date.parse(last.at) < LAST_PLACE_MAX_AGE_MS) return { ...roundPlace(last.lat, last.lon), source: 'last' };
  const hit = await lookupIp(ip);
  if (hit) return { ...roundPlace(hit.lat, hit.lon), source: 'ip' };
  const cap = CAPITALS[user.settings.country ?? ''];
  return cap ? { ...cap, source: 'capital' } : null;
}

/** Gerundeten Ort merken (nie den genauen) */
export function rememberPlace(user: User, lat: number, lon: number) {
  updateUserSettings(user.id, { lastPlace: { ...roundPlace(lat, lon), at: new Date().toISOString() } });
}

/** Ort für das Briefing (kein Request da, also ohne IP): letzter Ort, sonst Hauptstadt */
function briefingPlace(user: User): { lat: number; lon: number } | null {
  const last = user.settings.lastPlace;
  if (last && Date.now() - Date.parse(last.at) < LAST_PLACE_MAX_AGE_MS) return last;
  return CAPITALS[user.settings.country ?? ''] ?? null;
}

/** Vor dem Bauen des Briefings: Vorhersage in den Zwischenspeicher holen (Fehler sind egal) */
export async function warmWeather(user: User): Promise<void> {
  const p = briefingPlace(user);
  if (p) await forecastJson(roundPlace(p.lat, p.lon));
}

/** Wetterzeile fürs Briefing aus dem Zwischenspeicher, im Ton der Nutzerin; null, wenn nichts bekannt ist */
export function weatherLine(user: User): string | null {
  const p = briefingPlace(user);
  const hit = p ? cache.get(cell(roundPlace(p.lat, p.lon))) : undefined;
  if (!hit) return null;
  const f = parseDayForecast(hit.json, Number(timeIn(user.timeZone).slice(0, 2)));
  if (!f) return null;
  if (f.wetFrom === undefined) return tr(user, 'weather.line.dry', { temp: f.temp });
  const hour = `${String(f.wetFrom).padStart(2, '0')}:00`;
  const line = tr(user, f.wetKind === 'snow' ? 'weather.line.snow' : 'weather.line.rain', { temp: f.temp, hour });
  return f.wetKind === 'snow' ? line : `${line} ${tr(user, `weather.umbrella.${user.settings.tone ?? 'nett'}`)}`;
}

export function registerWeatherRoutes(api: FastifyInstance) {
  // Ohne Standortfreigabe: ungefähres Wetter vom Server
  api.get('/api/weather/approx', async (req) => {
    const place = await approxPlace(req.user, req.ip);
    if (!place) return { weather: null, source: null };
    const weather = await weatherAt(place);
    return { weather, source: place.source };
  });

  // Die App meldet den (vom Gerät gerundeten) Ort nach einem Wetter-Abruf mit Freigabe
  api.post('/api/weather/place', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isPlace(b)) throw new HttpError(400, 'lat/lon fehlen.');
    if (getUser(req.user.id)?.settings.locationPermission === 'denied') throw new HttpError(403, 'Standort ist nicht freigegeben.');
    rememberPlace(req.user, b.lat, b.lon);
    return { ok: true };
  });
}
