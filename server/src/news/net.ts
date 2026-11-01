// Abrufe für Nachrichten. Adressen, die Nutzer selbst eintragen (Lieblingszeitung), dürfen nie auf interne Rechner zeigen (SSRF):
// Der Name wird aufgelöst, private/Loopback-Adressen werden abgelehnt, Weiterleitungen werden einzeln geprüft.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateIp } from '../geoip.ts';

export const MAX_BYTES = 2 * 1024 * 1024;

/** Nur für Tests: lokale Mock-Server erlauben */
export const netOptions = { allowPrivate: process.env.STELLA_NEWS_ALLOW_PRIVATE === 'true' };

export class UnsafeUrl extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrl('Das ist keine gültige Adresse.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UnsafeUrl('Nur http und https.');
  if (u.username || u.password) throw new UnsafeUrl('Adressen mit Zugangsdaten sind nicht erlaubt.');
  if (netOptions.allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new UnsafeUrl('Diese Adresse finde ich nicht.');
  if (addrs.some(isPrivateIp)) throw new UnsafeUrl('Diese Adresse ist nicht erlaubt.');
  return u;
}

export interface Fetched { status: number; body: string; etag?: string; lastModified?: string; url: string }

/** Abruf mit Zeitlimit, Größenlimit und (bei `strict`) Prüfung jeder Weiterleitung */
export async function fetchText(url: string, opts: { strict?: boolean; etag?: string; lastModified?: string; timeoutMs?: number } = {}): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (opts.strict) await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        'User-Agent': 'StellaNewsBot/1.0 (+https://stella.evolsior.com)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
        ...(opts.etag ? { 'If-None-Match': opts.etag } : {}), ...(opts.lastModified ? { 'If-Modified-Since': opts.lastModified } : {}),
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location')!, current).toString(); continue; }
    if (res.status === 304) return { status: 304, body: '', url: current, etag: opts.etag, lastModified: opts.lastModified };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Antwort zu groß.');
    return { status: res.status, body: buf.toString('utf8'), url: current, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
  }
  throw new Error('Zu viele Weiterleitungen.');
}
