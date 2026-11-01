// Wetter in der Web-App: zuletzt gespeichertes Wetter sofort, frisches parallel (Ablauf: shared/src/weather.ts).
// Nichts hiervon blockiert den Start.

import { useSyncExternalStore } from 'react';
import { isAnimMode, isWeatherType, startWeather, type AnimMode, type WeatherState, type WeatherType } from '@stella/shared';
import { api, getState } from './store.ts';

const CACHE_KEY = 'stella.weather';
const FORCE_KEY = 'stella.forceWeather';

function read<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* ohne Speicher geht es auch */ }
}

let current: WeatherState | null = read<WeatherState>(CACHE_KEY);
let forced: { type: WeatherType; day: boolean } | null = (() => {
  const f = read<{ type: unknown; day: unknown }>(FORCE_KEY);
  return f && isWeatherType(f.type) ? { type: f.type, day: f.day !== false } : null;
})();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Owner-Testschalter (Einstellungen → Server → Wetter erzwingen): alle Typen, Tag und Nacht für Screenshots und Abnahme */
export function forceWeather(f: { type: WeatherType; day: boolean } | null) {
  forced = f;
  write(FORCE_KEY, f);
  emit();
}
export const forcedWeather = () => forced;

/** Das Wetter, das die Oberfläche zeigt (erzwungen, sonst echt); null, solange nichts bekannt ist */
export function useWeather(): WeatherState | null {
  const real = useSyncExternalStore(subscribe, () => current);
  const f = useSyncExternalStore(subscribe, () => forced);
  return f ? { type: f.type, day: f.day, temp: real?.temp ?? 15, wind: real?.wind ?? 1, at: Date.now() } : real;
}

let started = false;
/** Einmal pro App-Start, sobald jemand angemeldet ist */
export function startWeatherOnce() {
  if (started) return;
  started = true;
  const granted = () => getState().me?.settings.locationPermission === 'granted';
  startWeather({
    fetch: (url, init) => fetch(url, init),
    cache: { get: () => current, set: (w) => write(CACHE_KEY, w) },
    // Freigegeben: schneller, ungenauer Standort (Browser-Cache bis 30 min). Sonst gar nicht erst fragen.
    geo: () => new Promise((resolve) => {
      if (!granted() || !('geolocation' in navigator)) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => resolve(null),
        { maximumAge: 30 * 60_000, timeout: 1500, enableHighAccuracy: false });
    }),
    approx: () => api<{ weather: WeatherState | null }>('/api/weather/approx').then((r) => r.weather),
    reportPlace: (p) => { void api('/api/weather/place', { method: 'POST', json: p }).catch(() => {}); },
    onChange: (w) => { current = w; emit(); },
  });
}

// ---------- Einstellungen → Darstellung → Wetter-Animationen: an / ruhig / aus ----------

const ANIM_KEY = 'stella.weatherAnim';
let animMode: AnimMode = (() => { try { const v = localStorage.getItem(ANIM_KEY); return isAnimMode(v) ? v : 'on'; } catch { return 'on'; } })();
export function setAnimMode(m: AnimMode) {
  animMode = m;
  try { localStorage.setItem(ANIM_KEY, m); } catch { /* ohne Speicher geht es auch */ }
  emit();
}
export function useAnimMode(): AnimMode {
  return useSyncExternalStore(subscribe, () => animMode);
}
