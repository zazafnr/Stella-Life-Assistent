// Zahlen für das Firmen-Dashboard (nur Owner): Nutzer, Mails, KI-Nutzung, Fehler. Nie Inhalte, nie volle Adressen.

import type { FastifyInstance } from 'fastify';
import { requireOwner } from './auth.ts';
import { db } from './db.ts';
import { inboundSecretSet } from './inbound.ts';
import { mailerConfigured } from './mailer.ts';
import { registrationMode } from './signup.ts';

const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

/** Lückenlose Tagesreihe der letzten `days` Tage (UTC), älteste zuerst */
function dayRange(days: number): string[] {
  return Array.from({ length: days }, (_, i) => dayOf(daysAgo(days - 1 - i)));
}

export function buildOverview(days = 30) {
  const range = dayRange(days);
  const since = daysAgo(days);

  const regRows = db.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day').all(since) as { day: string; n: number }[];
  const regByDay = new Map(regRows.map((r) => [r.day, r.n]));

  const mailRows = db.prepare('SELECT substr(at, 1, 10) AS day, direction, purpose, status, COUNT(*) AS n FROM mail_log WHERE at >= ? GROUP BY day, direction, purpose, status').all(since) as
    { day: string; direction: string; purpose: string; status: string; n: number }[];
  const outByPurpose: Record<string, { ok: number; failed: number }> = {};
  const inByOutcome: Record<string, number> = {};
  const outByDay = new Map<string, { ok: number; failed: number }>();
  const inByDay = new Map<string, number>();
  for (const r of mailRows) {
    if (r.direction === 'out') {
      const p = (outByPurpose[r.purpose] ??= { ok: 0, failed: 0 });
      p[r.status === 'ok' ? 'ok' : 'failed'] += r.n;
      const d = outByDay.get(r.day) ?? { ok: 0, failed: 0 };
      d[r.status === 'ok' ? 'ok' : 'failed'] += r.n;
      outByDay.set(r.day, d);
    } else {
      inByOutcome[r.purpose] = (inByOutcome[r.purpose] ?? 0) + r.n;
      inByDay.set(r.day, (inByDay.get(r.day) ?? 0) + r.n);
    }
  }

  const aiRows = db.prepare('SELECT day, provider, SUM(requests) AS n FROM llm_usage WHERE day >= ? GROUP BY day, provider').all(dayOf(since)) as { day: string; provider: string; n: number }[];
  const aiByProvider: Record<string, number> = {};
  const aiByDay = new Map<string, number>();
  for (const r of aiRows) {
    aiByProvider[r.provider] = (aiByProvider[r.provider] ?? 0) + r.n;
    aiByDay.set(r.day, (aiByDay.get(r.day) ?? 0) + r.n);
  }

  const invites = { total: one('SELECT COUNT(*) AS n FROM invites'), used: one('SELECT COUNT(*) AS n FROM invites WHERE used_by IS NOT NULL'), open: one('SELECT COUNT(*) AS n FROM invites WHERE used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)', new Date().toISOString()) };

  return {
    generatedAt: new Date().toISOString(),
    days,
    app: 'stella',
    users: {
      total: one('SELECT COUNT(*) AS n FROM users'),
      verified: one('SELECT COUNT(*) AS n FROM users WHERE verified = 1'),
      new7d: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', daysAgo(7)),
      active1d: one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen >= ?', daysAgo(1)),
      active7d: one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen >= ?', daysAgo(7)),
      active30d: one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen >= ?', daysAgo(30)),
      linkedAddresses: one('SELECT COUNT(*) AS n FROM user_emails WHERE verified = 1'),
    },
    registrations: range.map((day) => ({ day, n: regByDay.get(day) ?? 0 })),
    mail: {
      sent: { ok: one("SELECT COUNT(*) AS n FROM mail_log WHERE direction = 'out' AND status = 'ok' AND at >= ?", since), failed: one("SELECT COUNT(*) AS n FROM mail_log WHERE direction = 'out' AND status = 'failed' AND at >= ?", since) },
      byPurpose: outByPurpose,
      received: one("SELECT COUNT(*) AS n FROM mail_log WHERE direction = 'in' AND at >= ?", since),
      inboundByOutcome: inByOutcome,
      perDay: range.map((day) => ({ day, ok: outByDay.get(day)?.ok ?? 0, failed: outByDay.get(day)?.failed ?? 0, received: inByDay.get(day) ?? 0 })),
      recentFailures: db.prepare("SELECT at, direction, purpose, domain, detail FROM mail_log WHERE status = 'failed' ORDER BY at DESC LIMIT 10").all(),
    },
    ai: { total: Object.values(aiByProvider).reduce((a, b) => a + b, 0), byProvider: aiByProvider, perDay: range.map((day) => ({ day, n: aiByDay.get(day) ?? 0 })) },
    content: {
      messages: one('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', since),
      items: one('SELECT COUNT(*) AS n FROM items'),
      goals: one('SELECT COUNT(*) AS n FROM goals'),
      payments: one('SELECT COUNT(*) AS n FROM transactions'),
    },
    invites,
    setup: { registration: registrationMode(), mailConfigured: mailerConfigured(), inboundConfigured: inboundSecretSet() },
  };
}

export function registerOverviewRoutes(api: FastifyInstance) {
  api.get('/api/admin/overview', { preHandler: requireOwner }, async (req) => {
    const d = Number((req.query as Record<string, string>).days);
    return buildOverview(Number.isFinite(d) ? Math.min(90, Math.max(7, Math.round(d))) : 30);
  });
}
