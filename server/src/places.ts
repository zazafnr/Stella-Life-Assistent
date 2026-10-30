// Läden in der Nähe über OpenStreetMap (Overpass-API) – nur in dem Moment, in dem eine Erledigung erinnert wird.
// Der Standort kommt mit der Anfrage und wird nicht gespeichert: im Cache liegen nur Läden je Rasterzelle (etwa 500 m).

import type { FastifyInstance } from 'fastify';
import { PLACE_KINDS, placeFor, placeKind, todayIn, type NearbyPlace, type NearbyPlaces, type PlaceRef } from '@stella/shared';
import { config } from './config.ts';
import { HttpError } from './auth.ts';
import { db, now } from './db.ts';
import { complete, groqAvailable, llmAvailable } from './llm.ts';

const RADIUS_M = 3000;
const CACHE_MS = 24 * 3600_000;
const CELL_DEG = 0.0045; // ≈ 500 m
const PER_HOUR = 30;

const overpassUrls = () => (process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
const userAgent = () => `StellaLifeAssistant/2.0 (persoenlicher Assistent; Kontakt ueber ${config.publicUrl})`;

// ---------- Entfernung, Zelle ----------

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(a)));
}

export const cellKey = (category: string, lat: number, lon: number) =>
  `${category}:${Math.round(lat / CELL_DEG)}:${Math.round(lon / (CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))))}`;

// ---------- Öffnungszeiten (einfache OSM-Syntax) ----------

const DAY_IDX: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** true = offen, false = zu, null = nicht lesbar (z. B. Feiertage, Sonnenstand, Wochenzahlen) */
export function openNow(hours: string | null | undefined, at: Date, timeZone: string): boolean | null {
  if (!hours) return null;
  const text = hours.trim();
  if (/^24\/7$/i.test(text)) return true;
  const wd = (new Date(`${todayIn(timeZone, at)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const minutes = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);

  let result: boolean | null = null;
  let parsedAny = false;
  for (const rule of text.split(';').map((r) => r.trim()).filter(Boolean)) {
    const m = /^(?:((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+)?(off|closed|\d{2}:\d{2}\s*-\s*\d{2}:\d{2}(?:\s*,\s*\d{2}:\d{2}\s*-\s*\d{2}:\d{2})*)$/i.exec(rule);
    if (!m) return null; // etwas, das wir nicht verstehen → lieber „unbekannt“ als falsch
    parsedAny = true;
    const days = new Set<number>();
    if (m[1]) {
      for (const seg of m[1].split(',')) {
        const [a, b] = seg.split('-').map((x) => DAY_IDX[x.trim().toLowerCase()]!);
        if (b === undefined) days.add(a!);
        else for (let d = a!; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
      }
    } else for (let d = 0; d < 7; d++) days.add(d);
    if (!days.has(wd)) continue;
    if (/^(off|closed)$/i.test(m[2]!)) { result = false; continue; }
    result = m[2]!.split(',').some((range) => {
      const [s, e] = range.split('-').map((x) => toMin(x.trim()));
      return e! > s! ? minutes >= s! && minutes < e! : minutes >= s! || minutes < e!;
    });
  }
  return parsedAny ? (result ?? false) : null;
}

// ---------- Overpass ----------

interface RawPlace { name: string | null; lat: number; lon: number; hours: string | null; address: string | null }

let lastCall = 0;
let chain: Promise<unknown> = Promise.resolve();
/** Overpass ist ein geteilter Gratis-Dienst: höchstens eine Anfrage gleichzeitig, mit Abstand */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCall + (process.env.OVERPASS_URL ? 0 : 1500) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastCall = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

async function fetchPlaces(tag: string, lat: number, lon: number): Promise<RawPlace[]> {
  const [k, v] = tag.split('=');
  const around = `(around:${RADIUS_M},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const query = `[out:json][timeout:20];(node${around}["${k}"="${v}"];way${around}["${k}"="${v}"];);out center tags 60;`;
  let lastError = '';
  for (const url of overpassUrls()) {
    try {
      const res = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': userAgent(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) { lastError = `${res.status}`; continue; }
      const json = (await res.json()) as { elements?: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
      return (json.elements ?? []).flatMap((e) => {
        const p = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
        if (!p) return [];
        const t = e.tags ?? {};
        const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
        const town = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
        return [{ name: t.name ?? t.brand ?? t.operator ?? null, lat: p.lat, lon: p.lon, hours: t.opening_hours ?? null, address: [street, town].filter(Boolean).join(', ') || null }];
      });
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  throw new HttpError(502, `Die Kartendaten sind gerade nicht erreichbar (${lastError}).`);
}

const hourly = new Map<string, number[]>();
function limit(userId: string) {
  const cutoff = Date.now() - 3600_000;
  const list = (hourly.get(userId) ?? []).filter((t) => t > cutoff);
  if (list.length >= PER_HOUR) throw new HttpError(429, 'Zu viele Ladensuchen in kurzer Zeit – versuch es später nochmal.');
  hourly.set(userId, [...list, Date.now()]);
}

const r5 = (n: number) => Number(n.toFixed(5));

export const mapsLinks = (name: string, lat0: number, lon0: number) => ({
  appleMapsUrl: `https://maps.apple.com/?daddr=${r5(lat0)},${r5(lon0)}&q=${encodeURIComponent(name)}`,
  osmUrl: `https://www.openstreetmap.org/?mlat=${r5(lat0)}&mlon=${r5(lon0)}#map=18/${r5(lat0)}/${r5(lon0)}`,
});

/** Die nächsten drei Läden – aus dem 24-Stunden-Cache der Rasterzelle oder frisch von Overpass. */
export async function nearbyPlaces(userId: string, timeZone: string, category: string, lat: number, lon: number, at = new Date()): Promise<NearbyPlaces> {
  const kind = placeKind(category);
  if (!kind) throw new HttpError(400, 'Unbekannte Art von Geschäft.');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Ungültiger Standort.');
  limit(userId);
  const key = cellKey(category, lat, lon);
  const hit = db.prepare('SELECT data, fetched_at AS at FROM places_cache WHERE key = ?').get(key) as { data: string; at: string } | undefined;
  let raw: RawPlace[];
  if (hit && Date.parse(hit.at) > Date.now() - CACHE_MS) {
    raw = JSON.parse(hit.data) as RawPlace[];
  } else {
    raw = await serial(() => fetchPlaces(kind.tag, lat, lon));
    db.prepare('INSERT OR REPLACE INTO places_cache (key, data, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(raw), now());
  }
  const places: NearbyPlace[] = raw
    .map((p) => ({ p, d: distanceM(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ p, d }) => ({
      name: p.name ?? kind.label, distanceM: d, openingHours: p.hours, openNow: openNow(p.hours, at, timeZone),
      address: p.address, lat: p.lat, lon: p.lon, ...mapsLinks(p.name ?? kind.label, p.lat, p.lon),
    }));
  return { category: kind.category, label: kind.label, plural: kind.plural, emoji: kind.emoji, places };
}

// ---------- unbekannte Wörter: Groq schlägt ein Geschäft vor (mit Cache) ----------

const normText = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);

export async function resolvePlace(userId: string, text: string): Promise<PlaceRef | null> {
  const known = placeFor(text);
  if (known) return known;
  const key = normText(text);
  const cached = db.prepare('SELECT category FROM place_words WHERE word = ?').get(key) as { category: string | null } | undefined;
  if (cached) return cached.category && cached.category !== 'none' ? { category: cached.category, label: placeKind(cached.category)?.label ?? cached.category } : null;
  if (!groqAvailable() && !llmAvailable()) return null;
  try {
    const { message } = await complete([
      { role: 'system', content: 'Du ordnest Erledigungen einem Geschäft zu. Antworte nur mit JSON.' },
      { role: 'user', content: `Erledigung: „${text}“\nWelches Geschäft braucht man dafür? Wähle genau eine Kategorie aus: ${PLACE_KINDS.map((k) => `${k.category} (${k.label})`).join(', ')} – oder "none", wenn es kein typisches Geschäft gibt.\nFormat: {"category": "florist"}` },
    ], undefined, { json: true, provider: 'groq', task: 'classify', userId, timeoutMs: 20_000, background: true });
    const out = message.content ?? '';
    const category = String((JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { category?: unknown }).category ?? 'none');
    const valid = placeKind(category) ? category : 'none';
    db.prepare('INSERT OR REPLACE INTO place_words (word, category) VALUES (?, ?)').run(key, valid);
    return valid === 'none' ? null : { category: valid, label: placeKind(valid)!.label };
  } catch {
    return null;
  }
}

export function registerPlaceRoutes(api: FastifyInstance) {
  api.get('/api/places', async (req) => {
    const q = req.query as Record<string, string>;
    return nearbyPlaces(req.user.id, req.user.timeZone, String(q.category ?? ''), Number(q.lat), Number(q.lon));
  });
}
