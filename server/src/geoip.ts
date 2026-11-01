// Ungefährer Ort aus der IP-Adresse – lokal, über die Datenbank DB-IP Lite (City, mmdb, CC BY 4.0, kostenlos auch kommerziell).
// Es geht keine Adresse an Dritte. Die Datei lädt scripts/update-geoip.sh monatlich; fehlt sie, gibt es einfach keinen IP-Ort.

import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { config } from './config.ts';

export interface GeoHit { lat: number; lon: number; country?: string }
interface Reader { get(ip: string): { location?: { latitude?: number; longitude?: number }; country?: { iso_code?: string } } | null }

let reader: Reader | null | undefined;

/** Für Tests: eigener Leser (oder null = keine Datenbank) */
export function setGeoReader(r: Reader | null | undefined) { reader = r; }

async function load(): Promise<Reader | null> {
  if (reader !== undefined) return reader;
  if (!existsSync(config.weather.geoipDb)) return (reader = null);
  try {
    const maxmind = await import('maxmind');
    reader = (await maxmind.open(config.weather.geoipDb)) as unknown as Reader;
  } catch {
    reader = null;
  }
  return reader;
}

/** Heim-, Firmen- und Loopback-Adressen sagen nichts über den Ort */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return true;
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

export async function lookupIp(ip: string | undefined): Promise<GeoHit | null> {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/i, '');
  if (isPrivateIp(clean)) return null;
  const r = await load();
  if (!r) return null;
  try {
    const hit = r.get(clean);
    const lat = hit?.location?.latitude, lon = hit?.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    return { lat, lon, ...(hit?.country?.iso_code ? { country: hit.country.iso_code } : {}) };
  } catch {
    return null;
  }
}
