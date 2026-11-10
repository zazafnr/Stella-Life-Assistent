// Besucherzahlen der Website (evolsior.com) für das Firmen-Dashboard, nur für den Owner.
// Quelle: Cloudflare Web Analytics (ohne Cookies) über die GraphQL Analytics API, Token mit „Account Analytics: Read“.
// Zugangsdaten: Umgebung vor Eintrag im Dashboard (verschlüsselt im Bereich __system__). Sie verlassen den Server nie.

import type { FastifyInstance } from 'fastify';
import { getSecret, HttpError, requireOwner, setSecret } from './auth.ts';
import { SYSTEM_SCOPE } from './keys.ts';

export interface WebAnalyticsConfig {
  cfApiToken: string;
  cfAccountId: string;
  cfSiteTag: string;
}

const SECRET = 'webanalytics';
const DEFAULT_ACCOUNT = '9c0788d39e8ad88d6f83b4c32f9fb059';
export const CLOUDFLARE_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const graphqlUrl = () => process.env.STELLA_CF_GRAPHQL_URL || CLOUDFLARE_GRAPHQL;

export function webConfig(): WebAnalyticsConfig {
  const stored = getSecret<Partial<WebAnalyticsConfig>>(SYSTEM_SCOPE, SECRET) ?? {};
  const env = process.env;
  return {
    cfApiToken: env.STELLA_CF_API_TOKEN || stored.cfApiToken || '',
    cfAccountId: env.STELLA_CF_ACCOUNT_ID || stored.cfAccountId || DEFAULT_ACCOUNT,
    cfSiteTag: env.STELLA_CF_SITE_TAG || stored.cfSiteTag || '',
  };
}

/** Was der Owner im Dashboard einträgt. Leere Felder lassen den gespeicherten Wert, "-" löscht ihn. */
export function saveWebConfig(patch: Record<string, unknown>) {
  const old = getSecret<Partial<WebAnalyticsConfig>>(SYSTEM_SCOPE, SECRET) ?? {};
  const next: Partial<WebAnalyticsConfig> = { cfApiToken: old.cfApiToken, cfAccountId: old.cfAccountId, cfSiteTag: old.cfSiteTag };
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
  totals?: { visitors: number; pageviews: number };
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
  const res = await fetch(graphqlUrl(), {
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

// ---------- Schnittstelle ----------

const cache = new Map<number, { at: number; value: unknown }>();
const TTL = 10 * 60_000;

export async function webAnalytics(days: number) {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const cloudflare = await cloudflareStats(days);
  const value = { generatedAt: new Date().toISOString(), days, site: 'evolsior.com', cloudflare };
  // Fehler nicht merken, damit eine Korrektur gleich wirkt
  if (cloudflare.ok || !cloudflare.configured) cache.set(days, { at: Date.now(), value });
  return value;
}

/** Was im Dashboard über die Verbindung sichtbar ist: nur gesetzt / fehlt, nie der Token selbst */
export function webConfigStatus() {
  const c = webConfig();
  return { cloudflare: { apiToken: !!c.cfApiToken, accountId: c.cfAccountId, siteTag: c.cfSiteTag } };
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
