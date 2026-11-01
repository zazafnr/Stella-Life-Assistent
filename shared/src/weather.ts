// Wetter: Abbildung der WMO-Codes von Open-Meteo auf die Szenen von Stella und der Ablauf beim Start.
// Die Datenregeln stehen hier einmal (Web, Server und Tests); iOS hat dieselbe Abbildung in Weather.swift.

export const WEATHER_TYPES = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'heavy_rain', 'thunder', 'snow', 'sleet'] as const;
export type WeatherType = (typeof WEATHER_TYPES)[number];
export const isWeatherType = (v: unknown): v is WeatherType => typeof v === 'string' && (WEATHER_TYPES as readonly string[]).includes(v);

/** Wind in Stufen 0–3 (für den Winkel von Regen und Schnee) */
export type WindLevel = 0 | 1 | 2 | 3;

export interface WeatherState {
  type: WeatherType;
  day: boolean;
  /** °C, gerundet */
  temp: number;
  wind: WindLevel;
  /** gerundeter Ort (2 Nachkommastellen, etwa 1 km) */
  place?: { lat: number; lon: number };
  /** Zeitpunkt der Messung (ms seit 1970) */
  at: number;
  /** Sonnenaufgang und -untergang heute (ms seit 1970), für Dämmerung in den Szenen */
  sunrise?: number;
  sunset?: number;
}

/** Älter als 3 Stunden: nur noch Startbild, wird gleich ersetzt */
export const WEATHER_STALE_MS = 3 * 3600_000;
export const isStaleWeather = (w: Pick<WeatherState, 'at'>, now = Date.now()) => now - w.at > WEATHER_STALE_MS;

/** WMO-Wettercode (https://open-meteo.com/en/docs) → Szene */
export function wmoToType(code: number): WeatherType {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet';
  if (code === 61 || code === 80) return 'rain';
  if (code === 63 || code === 81) return 'rain';
  if (code === 65 || code === 82) return 'heavy_rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'cloudy';
}

/** km/h → Stufe 0–3 */
export const windLevel = (kmh: number): WindLevel => (kmh < 15 ? 0 : kmh < 30 ? 1 : kmh < 50 ? 2 : 3);

export const roundCoord = (n: number) => Math.round(n * 100) / 100;
export const roundPlace = (lat: number, lon: number) => ({ lat: roundCoord(lat), lon: roundCoord(lon) });
export const isPlace = (p: unknown): p is { lat: number; lon: number } => {
  const q = p as { lat?: unknown; lon?: unknown } | null;
  return !!q && typeof q.lat === 'number' && typeof q.lon === 'number' && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180;
};

export const OPEN_METEO = 'https://api.open-meteo.com';

/** Abruf für die Szene (aktuell) und – mit `hourly` – für die Wetterzeile im Briefing */
export function openMeteoUrl(lat: number, lon: number, opts: { base?: string; hourly?: boolean; timezone?: string } = {}): string {
  const q = new URLSearchParams({
    latitude: String(roundCoord(lat)), longitude: String(roundCoord(lon)),
    current: 'weather_code,temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover',
    daily: 'sunrise,sunset', timezone: opts.timezone ?? 'auto', forecast_days: '1',
  });
  if (opts.hourly) q.set('hourly', 'precipitation_probability,temperature_2m,weather_code');
  return `${opts.base ?? OPEN_METEO}/v1/forecast?${q}`;
}

interface OpenMeteoDaily { sunrise?: string[]; sunset?: string[] }
interface OpenMeteoCurrent { weather_code?: number; temperature_2m?: number; is_day?: number; wind_speed_10m?: number; time?: string }

/** Antwort von Open-Meteo → Szene; null, wenn die Antwort nicht passt */
export function parseOpenMeteo(json: unknown, place?: { lat: number; lon: number }, now = Date.now()): WeatherState | null {
  const root = json as { current?: OpenMeteoCurrent; daily?: OpenMeteoDaily; utc_offset_seconds?: number } | null;
  const c = root?.current;
  if (!c || typeof c.weather_code !== 'number' || typeof c.temperature_2m !== 'number') return null;
  // „2026-11-01T06:58“ ist Ortszeit (timezone=auto); mit dem Versatz der Antwort wird daraus ein echter Zeitpunkt
  const local = (s?: string) => {
    const ms = s ? Date.parse(`${s}:00Z`) : NaN;
    return Number.isFinite(ms) ? ms - (root?.utc_offset_seconds ?? 0) * 1000 : undefined;
  };
  const sunrise = local(root?.daily?.sunrise?.[0]), sunset = local(root?.daily?.sunset?.[0]);
  return {
    ...(sunrise !== undefined ? { sunrise } : {}), ...(sunset !== undefined ? { sunset } : {}),
    type: wmoToType(c.weather_code), day: c.is_day !== 0, temp: Math.round(c.temperature_2m),
    wind: windLevel(typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 0), ...(place ? { place: roundPlace(place.lat, place.lon) } : {}), at: now,
  };
}

// ---------- Briefing: Wetterzeile ----------

export interface DayForecast {
  /** aktuelle Temperatur oder Tageshöchstwert, °C */
  temp: number;
  type: WeatherType;
  /** erste volle Stunde (0–23) ab jetzt mit Regen/Schnee (Wahrscheinlichkeit ≥ 50 %), sonst undefined */
  wetFrom?: number;
  wetKind?: 'rain' | 'snow';
}

/** Aus dem stündlichen Verlauf von Open-Meteo: ab wann ist heute Niederschlag zu erwarten? */
export function parseDayForecast(json: unknown, hourNow: number): DayForecast | null {
  const j = json as { current?: OpenMeteoCurrent; hourly?: { precipitation_probability?: (number | null)[]; weather_code?: (number | null)[] } } | null;
  const now = parseOpenMeteo(j);
  if (!now) return null;
  const prob = j?.hourly?.precipitation_probability ?? [];
  const codes = j?.hourly?.weather_code ?? [];
  let wetFrom: number | undefined;
  let wetKind: 'rain' | 'snow' | undefined;
  for (let h = Math.max(0, hourNow); h < Math.min(24, prob.length); h++) {
    if ((prob[h] ?? 0) >= 50) {
      wetFrom = h;
      wetKind = ['snow', 'sleet'].includes(wmoToType(codes[h] ?? 0)) ? 'snow' : 'rain';
      break;
    }
  }
  return { temp: now.temp, type: now.type, ...(wetFrom !== undefined ? { wetFrom, wetKind } : {}) };
}

// ---------- Ablauf beim Start (Web; iOS macht dasselbe in Weather.swift) ----------

export interface WeatherDeps {
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  cache: { get(): WeatherState | null; set(w: WeatherState): void };
  /** Standort, nur wenn freigegeben; null = nicht verfügbar. Darf lange dauern, wir warten höchstens `geoTimeoutMs`. */
  geo: () => Promise<{ lat: number; lon: number } | null>;
  /** ungefähres Wetter vom Server (IP-Ort, letzter Ort oder Hauptstadt) */
  approx: () => Promise<WeatherState | null>;
  /** gerundeten Ort an den Server melden (für Briefing und News) */
  reportPlace?: (p: { lat: number; lon: number }) => void;
  onChange: (w: WeatherState) => void;
  now?: () => number;
  base?: string;
  geoTimeoutMs?: number;
  fetchTimeoutMs?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

const same = (a: WeatherState | null, b: WeatherState) => !!a && a.type === b.type && a.day === b.day && a.temp === b.temp && a.wind === b.wind && a.sunrise === b.sunrise && a.sunset === b.sunset;

/**
 * 1. zuletzt gespeichertes Wetter sofort zeigen (`onChange` noch vor dem ersten await),
 * 2. parallel: Standort → Open-Meteo, sonst Server-Näherung; nie blockierend, jede Stufe hat ein Zeitlimit.
 * `done` wird immer erfüllt (auch wenn alles hängt oder fehlschlägt).
 */
export function startWeather(d: WeatherDeps): { initial: WeatherState | null; done: Promise<void> } {
  const now = d.now ?? Date.now;
  const initial = d.cache.get();
  if (initial) d.onChange(initial);
  let shown = initial;
  const show = (w: WeatherState) => {
    d.cache.set(w);
    if (!same(shown, w)) d.onChange(w);
    shown = w;
  };
  const done = (async () => {
    try {
      const pos = await withTimeout(d.geo(), d.geoTimeoutMs ?? 1500);
      if (pos && isPlace(pos)) {
        const place = roundPlace(pos.lat, pos.lon);
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const res = await withTimeout(d.fetch(openMeteoUrl(place.lat, place.lon, { base: d.base }), ctl ? { signal: ctl.signal } : undefined).then((r) => (r.ok ? r.json() : null)), d.fetchTimeoutMs ?? 2000);
        if (!res) ctl?.abort();
        const w = parseOpenMeteo(res, place, now());
        if (w) { show(w); d.reportPlace?.(place); return; }
      }
      const approx = await withTimeout(d.approx(), (d.fetchTimeoutMs ?? 2000) + 1000);
      if (approx) show({ ...approx, at: now() });
    } catch { /* das Wetter ist nie wichtig genug, um zu stören */ }
  })();
  return { initial, done };
}
