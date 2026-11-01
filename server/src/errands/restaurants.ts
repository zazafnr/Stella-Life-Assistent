// Restaurants, Cafés und Bars in der Nähe über OpenStreetMap (Overpass), gleicher Zwischenspeicher und gleiche Bremse wie bei den Läden.
// Stella kann NICHT selbst reservieren: sie findet, sortiert nach Entfernung und „geöffnet zur gewünschten Zeit“ und liefert den nächsten Schritt.

import { todayIn, type RestaurantCardItem } from '@stella/shared';
import { HttpError } from '../auth.ts';
import { db, now } from '../db.ts';
import { cellKey, distanceM, limit, mapsLinks, openNow, overpassUrls, serial, userAgent } from '../places.ts';

const RADIUS_M = 3000;
const CACHE_MS = 24 * 3600_000;

export interface RawRestaurant {
  name: string | null; lat: number; lon: number; amenity: string; cuisine: string[]; hours: string | null;
  website: string | null; phone: string | null; address: string | null; osmId: string;
}

async function fetchRestaurants(lat: number, lon: number): Promise<RawRestaurant[]> {
  const around = `(around:${RADIUS_M},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const query = `[out:json][timeout:25];nwr${around}["amenity"~"^(restaurant|cafe|bar)$"]["name"];out center tags 120;`;
  let lastError = '';
  for (const url of overpassUrls()) {
    try {
      const res = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': userAgent(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) { lastError = `${res.status}`; continue; }
      const json = (await res.json()) as { elements?: { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
      return (json.elements ?? []).flatMap((e) => {
        const p = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
        const t = e.tags ?? {};
        if (!p || !t.name) return [];
        const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
        const town = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
        return [{
          name: t.name, lat: p.lat, lon: p.lon, amenity: t.amenity ?? 'restaurant',
          cuisine: (t.cuisine ?? '').split(/[;,]/).map((c) => c.trim().toLowerCase()).filter(Boolean),
          hours: t.opening_hours ?? null, website: t.website ?? t['contact:website'] ?? null, phone: t.phone ?? t['contact:phone'] ?? null,
          address: [street, town].filter(Boolean).join(', ') || null, osmId: `${e.type ?? 'n'}${e.id ?? ''}`,
        }];
      });
    } catch (err) { lastError = (err as Error).message; }
  }
  throw new HttpError(502, `Die Kartendaten sind gerade nicht erreichbar (${lastError}).`);
}

/** Küchen-Wörter in mehreren Sprachen → OSM-Küche */
const CUISINE_ALIASES: Record<string, string[]> = {
  italian: ['italian', 'italienisch', 'italiano', 'italien', 'italiana', 'pizza', 'pasta', 'italyan', 'włoska'],
  asian: ['asian', 'asiatisch', 'asiático', 'asiatique', 'asiatico', 'asya', 'azjatycka'],
  chinese: ['chinese', 'chinesisch', 'chino', 'chinois', 'cinese', 'chinês', 'çin', 'chińska'],
  japanese: ['japanese', 'japanisch', 'sushi', 'japonés', 'japonais', 'giapponese', 'japonês', 'japon', 'japońska'],
  indian: ['indian', 'indisch', 'indio', 'indien', 'indiano', 'hint', 'indyjska'],
  thai: ['thai', 'thailändisch', 'tailandés', 'thaï', 'tailandese', 'tailandês', 'tayland', 'tajska'],
  greek: ['greek', 'griechisch', 'griego', 'grec', 'greco', 'grego', 'yunan', 'grecka'],
  turkish: ['turkish', 'türkisch', 'turco', 'turc', 'turca', 'türk', 'turecka', 'kebab'],
  mexican: ['mexican', 'mexikanisch', 'mexicano', 'mexicain', 'messicano', 'meksika', 'meksykańska'],
  burger: ['burger', 'hamburger'],
  vegan: ['vegan', 'vegetarisch', 'vegetarian', 'vegano', 'végétarien', 'vegetariano', 'vejetaryen', 'wegańska'],
  austrian: ['austrian', 'österreichisch', 'wirtshaus', 'schnitzel'],
  german: ['german', 'deutsch', 'alemán', 'allemand', 'tedesco', 'alemão', 'alman', 'niemiecka'],
  french: ['french', 'französisch', 'francés', 'français', 'francese', 'francês', 'fransız', 'francuska'],
  spanish: ['spanish', 'spanisch', 'tapas', 'español', 'espagnol', 'spagnolo', 'espanhol', 'ispanyol', 'hiszpańska'],
};
export function cuisineKey(word?: string | null): string | null {
  const w = (word ?? '').toLowerCase().trim();
  if (!w) return null;
  for (const [key, list] of Object.entries(CUISINE_ALIASES)) if (list.some((a) => w.includes(a))) return key;
  return w;
}

export interface FindArgs { query?: string; cuisine?: string; when?: string; people?: number; limit?: number }

/** `when`: ISO-Zeitpunkt ("2026-11-14T19:30") in der Zeitzone der Person, oder leer = jetzt */
export async function findRestaurants(userId: string, timeZone: string, lat: number, lon: number, args: FindArgs = {}, at = new Date()): Promise<{ items: RestaurantCardItem[]; when: string | null }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'Ungültiger Ort.');
  limit(userId);
  const key = cellKey('restaurant', lat, lon);
  const hit = db.prepare('SELECT data, fetched_at AS at FROM places_cache WHERE key = ?').get(key) as { data: string; at: string } | undefined;
  let raw: RawRestaurant[];
  if (hit && Date.parse(hit.at) > Date.now() - CACHE_MS) raw = JSON.parse(hit.data) as RawRestaurant[];
  else {
    raw = await serial(() => fetchRestaurants(lat, lon));
    db.prepare('INSERT OR REPLACE INTO places_cache (key, data, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(raw), now());
  }
  // gewünschter Zeitpunkt: wir prüfen die Öffnungszeiten für genau diesen Moment
  const when = args.when && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(args.when) ? args.when.slice(0, 16) : null;
  const target = when ? localToDate(when, timeZone) : at;
  const cuisine = cuisineKey(args.cuisine);
  const q = (args.query ?? '').toLowerCase().trim();

  const all = raw
    .map((p) => ({ p, d: distanceM(lat, lon, p.lat, p.lon), open: openNow(p.hours, target, timeZone) }))
    .filter(({ p }) => !cuisine || p.cuisine.some((c) => c.includes(cuisine)) || (p.name ?? '').toLowerCase().includes(cuisine))
    .filter(({ open }) => open !== false); // zur gewünschten Zeit geschlossen: nicht vorschlagen
  // ein Name im Suchtext („Mama Mia“) schlägt die allgemeine Suche
  const named = q ? all.filter(({ p }) => (p.name ?? '').toLowerCase().includes(q)) : [];
  // offen bestätigt vor „unbekannt“, dann nach Entfernung
  const scored = (named.length ? named : all)
    .sort((a, b) => (Number(b.open === true) - Number(a.open === true)) || a.d - b.d)
    .slice(0, Math.max(1, Math.min(args.limit ?? 3, 5)));

  const items: RestaurantCardItem[] = scored.map(({ p, d, open }) => ({
    id: `${p.osmId}`, name: p.name!, kind: p.amenity, cuisine: p.cuisine.slice(0, 3), distanceM: d, openNow: open, openingHours: p.hours,
    address: p.address, phone: p.phone, website: p.website, lat: p.lat, lon: p.lon, ...mapsLinks(p.name!, p.lat, p.lon),
  }));
  return { items, when };
}

/** „2026-11-14T19:30“ (Ortszeit) → Date (UTC), mit dem Versatz der Zeitzone an diesem Tag */
export function localToDate(local: string, timeZone: string): Date {
  const guess = new Date(`${local}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

export { todayIn };
