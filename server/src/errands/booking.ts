// Reservieren: Stella bucht nicht selbst. Sie sucht auf der Webseite des Lokals nach bekannten Buchungsdiensten
// (TheFork, OpenTable, Quandoo, resmio, Bookatable, Tablein, Google „Reservieren“) und liefert den direkten Link, sonst die Telefonnummer.

import type { BookingOption } from '@stella/shared';
import { fetchText, UnsafeUrl } from '../news/net.ts';

interface Service { id: string; name: string; host: RegExp; fallback?: string }

export const BOOKING_SERVICES: Service[] = [
  { id: 'thefork', name: 'TheFork', host: /(?:^|\.)(?:thefork\.[a-z.]+|lafourchette\.com)$/i },
  { id: 'opentable', name: 'OpenTable', host: /(?:^|\.)opentable\.[a-z.]+$/i },
  { id: 'quandoo', name: 'Quandoo', host: /(?:^|\.)quandoo\.[a-z.]+$/i },
  { id: 'resmio', name: 'resmio', host: /(?:^|\.)resmio\.(?:com|de)$/i },
  { id: 'bookatable', name: 'Bookatable', host: /(?:^|\.)bookatable\.[a-z.]+$/i },
  { id: 'tablein', name: 'Tablein', host: /(?:^|\.)tablein\.com$/i },
  { id: 'google', name: 'Google', host: /(?:^|\.)(?:reservewithgoogle\.com|g\.page)$|^(?:www\.)?google\.[a-z.]+$/i },
];

/** Alle http(s)-Adressen in href=, src=, data-…= und Skripten */
function urlsIn(html: string, baseUrl: string): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/(?:href|src|data-src|data-url|action)\s*=\s*["']([^"'#][^"']*)["']|(https?:\/\/[^\s"'<>\\)]+)/gi)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/&amp;/g, '&');
    try { out.push(new URL(raw, baseUrl)); } catch { /* kaputte Adresse */ }
  }
  return out;
}

/** Erkennt Buchungsdienste im HTML einer Lokal-Webseite (rein, ohne Netz) */
export function detectBooking(html: string, baseUrl: string): { service: string; name: string; url: string } | null {
  const urls = urlsIn(html, baseUrl);
  for (const svc of BOOKING_SERVICES) {
    for (const u of urls) {
      if (!/^https?:$/.test(u.protocol) || !svc.host.test(u.hostname)) continue;
      // Google nur, wenn es wirklich um Reservierungen geht (nicht jeder Maps-Link)
      if (svc.id === 'google' && !/reserve|booking|book/i.test(u.toString())) continue;
      // Skript-Dateien und Bilder der Dienste sind keine Buchungsadresse
      if (/\.(js|css|png|jpe?g|svg|gif|woff2?)(\?|$)/i.test(u.pathname)) continue;
      return { service: svc.id, name: svc.name, url: u.toString() };
    }
  }
  return null;
}

const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Buchungsmöglichkeit eines Lokals: direkter Link, sonst Telefon, sonst Webseite */
export async function bookingOptions(place: { name: string; website?: string | null; phone?: string | null }): Promise<BookingOption> {
  const phone = place.phone ? { phone: place.phone, telUrl: telLink(place.phone) } : {};
  if (place.website && /^https?:\/\//i.test(place.website)) {
    try {
      const page = await fetchText(place.website, { strict: true, timeoutMs: 8000 });
      if (page.status === 200) {
        const hit = detectBooking(page.body, page.url);
        if (hit) return { kind: 'link', service: hit.name, url: hit.url, ...phone };
        return { kind: place.phone ? 'phone' : 'website', url: page.url, ...phone };
      }
    } catch (err) {
      if (!(err instanceof UnsafeUrl)) { /* Webseite nicht erreichbar → weiter mit Telefon */ }
    }
    if (!place.phone) return { kind: 'website', url: place.website };
  }
  return place.phone ? { kind: 'phone', ...phone } : { kind: 'none' };
}
