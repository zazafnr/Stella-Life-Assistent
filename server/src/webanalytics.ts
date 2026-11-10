// Besucherzahlen der Website (evolsior.com) für das Firmen-Dashboard, nur für den Owner.
// Zwei Quellen:
//  - Cloudflare Web Analytics: ohne Cookies, zählt fast alle Besuche (GraphQL Analytics API, Token mit „Account Analytics: Read“)
//  - Google Analytics 4: nur Besucher, die im Cookie-Hinweis „Allow“ geklickt haben (Data API, Dienstkonto mit Leserechten)
// Zugangsdaten: Umgebung vor Eintrag im Dashboard (verschlüsselt im Bereich __system__). Sie verlassen den Server nie.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { getSecret, HttpError, requireOwner, setSecret } from './auth.ts';
import { SYSTEM_SCOPE } from './keys.ts';

export interface WebAnalyticsConfig {
  cfApiToken: string;
  cfAccountId: string;
  cfSiteTag: string;
  gaPropertyId: string;
  /** JSON-Schlüssel des Google-Dienstkontos (client_email, private_key) */
  gaServiceAccount: string;
}

const SECRET = 'webanalytics';
const DEFAULTS = { cfAccountId: '9c0788d39e8ad88d6f83b4c32f9fb059', gaPropertyId: '562989593' };

export const endpoints = {
  cloudflare: process.env.STELLA_CF_GRAPHQL_URL || 'https://endpoints.cloudflare.com/client/v4/graphql',
  googleToken: process.env.STELLA_GA_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  googleData: process.env.STELLA_GA_DATA_URL || 'https://analyticsdata.googleapis.com/v1beta',
};

function readServiceAccount(v: string): string {
  const s = v.trim();
  if (!s || s.startsWith('{')) return s;
  try { return readFileSync(s, 'utf8'); } catch { return ''; } // Pfad zu einer JSON-Datei
}

export function webConfig(): WebAnalyticsConfig {
  const stored = getSecret<Partial<WebAnalyticsConfig>>(SYSTEM_SCOPE, SECRET) ?? {};
  const env = process.env;
  return {
    cfApiToken: env.STELLA_CF_API_TOKEN || stored.cfApiToken || '',
    cfAccountId: env.STELLA_CF_ACCOUNT_ID || stored.cfAccountId || DEFAULTS.cfAccountId,
    cfSiteTag: env.STELLA_CF_SITE_TAG || stored.cfSiteTag || '',
    gaPropertyId: env.STELLA_GA_PROPERTY_ID || stored.gaPropertyId || DEFAULTS.gaPropertyId,
    gaServiceAccount: readServiceAccount(env.STELLA_GA_SERVICE_ACCOUNT || stored.gaServiceAccount || ''),
  };
}

interface ServiceAccount { client_email: string; private_key: string }
function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const o = JSON.parse(json) as Partial<ServiceAccount>;
    return typeof o.client_email === 'string' && typeof o.private_key === 'string' && o.private_key.includes('PRIVATE KEY') ? { client_email: o.client_email, private_key: o.private_key } : null;
  } catch { return null; }
}

/** Was der Owner im Dashboard einträgt. Leere Felder lassen den gespeicherten Wert, "-" löscht ihn. */
export function saveWebConfig(patch: Record<string, unknown>) {
  const old = getSecret<Partial<WebAnalyticsConfig>>(SYSTEM_SCOPE, SECRET) ?? {};
  const next: Partial<WebAnalyticsConfig> = { ...old };
  const field = (k: keyof WebAnalyticsConfig, check: (s: string) => boolean, msg: string) => {
    const raw = patch[k];
    if (typeof raw !== 'string' || !raw.trim()) return;
    const s = raw.trim();
    if (s === '-') { delete next[k]; return; }
    if (!check(s)) throw new HttpError(400, msg);
    next[k] = s;
  };
  field('cfApiToken', (s) => /^[A-Za-z0-9_-]{30,80}$/.test(s), 'That does not look like a Cloudflare API token.');
  field('cfAccountId', (s) => /^[0-9a-f]{32}$/.test(s), 'The Cloudflare account ID has 32 characters (0-9, a-f).');
  field('cfSiteTag', (s) => /^[0-9a-f]{32}$/.test(s), 'The site tag has 32 characters (0-9, a-f). You find it in the address of the site in Web Analytics.');
  field('gaPropertyId', (s) => /^\d{6,12}$/.test(s), 'The Google Analytics property ID is a number, e.g. 562989593.');
  field('gaServiceAccount', (s) => !!parseServiceAccount(s), 'Paste the whole JSON key of the Google service account (with client_email and private_key).');
  setSecret(SYSTEM_SCOPE, SECRET, next);
  cache.clear();
}

// ---------- Cloudflare ----------

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
function dayRange(days: number): string[] {
  return Array.from({ length: days }, (_, i) => dayOf(new Date(Date.now() - (days - 1 - i) * 86_400_000)));
}

interface Count { key: string; n: number }
export interface SourceResult {
  configured: boolean;
  ok: boolean;
  error?: string;
  totals?: { visitors: number; pageviews: number; sessions?: number };
  perDay?: { day: string; visitors: number; pageviews: number }[];
  pages?: Count[];
  countries?: Count[];
  referrers?: Count[];
}

const CF_FILTER = '{ siteTag: $siteTag, datetime_geq: $start, datetime_lt: $end }';
const CF_QUERY = `query($account: string!, $siteTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: rumPageloadEventsAdaptiveGroups(limit: 100, filter: ${CF_FILTER}, orderBy: [date_ASC]) { count sum { visits } dimensions { date } }
    pages: rumPageloadEventsAdaptiveGroups(limit: 10, filter: ${CF_FILTER}, orderBy: [count_DESC]) { count dimensions { requestPath } }
    countries: rumPageloadEventsAdaptiveGroups(limit: 8, filter: ${CF_FILTER}, orderBy: [count_DESC]) { count dimensions { countryName } }
    referrers: rumPageloadEventsAdaptiveGroups(limit: 8, filter: ${CF_FILTER}, orderBy: [count_DESC]) { count dimensions { refererHost } }
  } }
}`;

type CfGroup = { count: number; sum?: { visits: number }; dimensions: Record<string, string> };

async function cfChunk(c: WebAnalyticsConfig, from: Date, to: Date) {
  const res = await fetch(endpoints.cloudflare, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${c.cfApiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CF_QUERY, variables: { account: c.cfAccountId, siteTag: c.cfSiteTag, start: from.toISOString(), end: to.toISOString() } }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { viewer?: { accounts?: Record<string, CfGroup[]>[] } }; errors?: { message: string }[] | null };
  if (!res.ok || body.errors?.length) {
    throw new Error(res.status === 401 || res.status === 403 ? 'Cloudflare rejects the API token (it needs “Account Analytics: Read”).' : `Cloudflare: ${body.errors?.[0]?.message ?? `error ${res.status}`}`);
  }
  return body.data?.viewer?.accounts?.[0] ?? {};
}

function addCounts(into: Map<string, number>, groups: CfGroup[] | undefined, dim: string) {
  for (const g of groups ?? []) {
    const k = g.dimensions[dim] || (dim === 'refererHost' ? '(direct)' : '(unknown)');
    into.set(k, (into.get(k) ?? 0) + g.count);
  }
}
const top = (m: Map<string, number>, n: number): Count[] => [...m].map(([key, v]) => ({ key, n: v })).sort((a, b) => b.n - a.n).slice(0, n);

export async function cloudflareStats(days: number, c = webConfig()): Promise<SourceResult> {
  if (!c.cfApiToken || !c.cfSiteTag) return { configured: false, ok: false };
  try {
    // Cloudflare erlaubt pro Abfrage nur einen begrenzten Zeitraum: in Stücken von höchstens 30 Tagen fragen
    const end = new Date(); end.setUTCHours(24, 0, 0, 0);
    const start = new Date(end.getTime() - days * 86_400_000);
    const byDay = new Map<string, { visitors: number; pageviews: number }>();
    const pages = new Map<string, number>(), countries = new Map<string, number>(), referrers = new Map<string, number>();
    for (let from = start; from < end;) {
      const to = new Date(Math.min(end.getTime(), from.getTime() + 30 * 86_400_000));
      const a = await cfChunk(c, from, to);
      for (const g of a.days ?? []) {
        const d = byDay.get(g.dimensions.date) ?? { visitors: 0, pageviews: 0 };
        d.visitors += g.sum?.visits ?? 0; d.pageviews += g.count;
        byDay.set(g.dimensions.date, d);
      }
      addCounts(pages, a.pages, 'requestPath'); addCounts(countries, a.countries, 'countryName'); addCounts(referrers, a.referrers, 'refererHost');
      from = to;
    }
    const perDay = dayRange(days).map((day) => ({ day, ...(byDay.get(day) ?? { visitors: 0, pageviews: 0 }) }));
    return {
      configured: true, ok: true,
      totals: { visitors: perDay.reduce((s, d) => s + d.visitors, 0), pageviews: perDay.reduce((s, d) => s + d.pageviews, 0) },
      perDay, pages: top(pages, 10), countries: top(countries, 8), referrers: top(referrers, 8),
    };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

// ---------- Google Analytics 4 ----------

let gToken: { email: string; token: string; until: number } | null = null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** OAuth-Zugriffstoken per signiertem JWT des Dienstkontos (ohne Google-Bibliothek) */
export async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  if (gToken && gToken.email === sa.client_email && gToken.until > Date.now() + 60_000) return gToken.token;
  const nowS = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: endpoints.googleToken, iat: nowS, exp: nowS + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key).toString('base64url');
  const res = await fetch(endpoints.googleToken, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in of the service account failed${body.error_description ? `: ${body.error_description}` : ''}.`);
  gToken = { email: sa.client_email, token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return gToken.token;
}

type GaRow = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
type GaReport = { rows?: GaRow[]; totals?: GaRow[] };

export async function googleStats(days: number, c = webConfig()): Promise<SourceResult> {
  const sa = parseServiceAccount(c.gaServiceAccount);
  if (!sa || !c.gaPropertyId) return { configured: false, ok: false };
  try {
    const token = await googleAccessToken(sa);
    const dateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }];
    const res = await fetch(`${endpoints.googleData}/properties/${c.gaPropertyId}:batchRunReports`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [
        { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }], metricAggregations: ['TOTAL'], limit: 400 },
        { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 },
        { dateRanges, dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 8 },
        { dateRanges, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
      ] }),
    });
    const body = (await res.json().catch(() => ({}))) as { reports?: GaReport[]; error?: { message?: string } };
    if (!res.ok || !body.reports) {
      throw new Error(res.status === 403 ? `Google denies access. Add ${sa.client_email} as a Viewer to the Analytics property.` : `Google Analytics: ${body.error?.message ?? `error ${res.status}`}`);
    }
    const [daily, pagesR, countriesR, sourcesR] = body.reports;
    const num = (r: GaRow | undefined, i: number) => Number(r?.metricValues?.[i]?.value ?? 0);
    const byDay = new Map((daily.rows ?? []).map((r) => {
      const v = r.dimensionValues?.[0]?.value ?? '';
      return [`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, { visitors: num(r, 0), pageviews: num(r, 1) }];
    }));
    const perDay = dayRange(days).map((day) => ({ day, ...(byDay.get(day) ?? { visitors: 0, pageviews: 0 }) }));
    const list = (rep: GaReport | undefined): Count[] => (rep?.rows ?? []).map((r) => ({ key: r.dimensionValues?.[0]?.value || '(not set)', n: num(r, 0) }));
    const t = daily.totals?.[0];
    return {
      configured: true, ok: true,
      totals: { visitors: num(t, 0), pageviews: num(t, 1), sessions: num(t, 2) },
      perDay, pages: list(pagesR), countries: list(countriesR), referrers: list(sourcesR),
    };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

// ---------- Schnittstelle ----------

const cache = new Map<number, { at: number; value: unknown }>();
const TTL = 10 * 60_000;

export async function webAnalytics(days: number) {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const c = webConfig();
  const [cloudflare, google] = await Promise.all([cloudflareStats(days, c), googleStats(days, c)]);
  const value = { generatedAt: new Date().toISOString(), days, site: 'evolsior.com', cloudflare, google };
  // Fehler nicht lange merken, damit eine Korrektur gleich wirkt
  if (cloudflare.ok || google.ok || (!cloudflare.configured && !google.configured)) cache.set(days, { at: Date.now(), value });
  return value;
}

/** Was im Dashboard über die Verbindung sichtbar ist: nur gesetzt / fehlt, nie die Werte selbst */
export function webConfigStatus() {
  const c = webConfig(), sa = parseServiceAccount(c.gaServiceAccount);
  return {
    cloudflare: { apiToken: !!c.cfApiToken, accountId: c.cfAccountId, siteTag: c.cfSiteTag },
    google: { propertyId: c.gaPropertyId, serviceAccount: sa?.client_email ?? null },
  };
}

export function registerWebAnalyticsRoutes(app: FastifyInstance) {
  app.get('/api/admin/web-analytics', { preHandler: requireOwner }, async (req) => {
    const d = Number((req.query as Record<string, string>).days);
    return webAnalytics(Number.isFinite(d) ? Math.min(90, Math.max(7, Math.round(d))) : 30);
  });
  app.get('/api/admin/web-analytics/config', { preHandler: requireOwner }, async () => webConfigStatus());
  app.post('/api/admin/web-analytics/config', { preHandler: requireOwner }, async (req) => {
    saveWebConfig((req.body ?? {}) as Record<string, unknown>);
    return webConfigStatus();
  });
}
