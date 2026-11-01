// Abos, Limits und Bezahlung (Stripe). Keine Gamification: nur Grenzen und Funktionen.
//
//   Limits    KI-Nachrichten pro Tag (Haiku) und Profi-Aufgaben pro Monat (Sonnet) je Abo – Zähler in der Zeitzone der Nutzerin.
//             Leere Profi-Aufgaben → Haiku macht weiter; leeres Tageslimit → freundlicher Hinweis, Kurznotizen gehen weiter.
//   Bezahlen  Stripe Checkout (Abo, EUR, Stripe Tax), Kundenportal, Webhook mit Signatur und Idempotenz (Ereignis-Id).
//   Geschenke Der Owner kann Abos schenken (provider 'gift', mit Ablaufdatum). Bestehende Konten haben per Migration Max ohne Ablauf.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { effectivePlan, isPlanId, PLAN_IDS, todayIn, yearlyPriceCents, type Plan, type PlanId, type PlanLimits, type PlanOverrides } from '@stella/shared';
import { config } from './config.ts';
import { costPerUser } from './costs.ts';
import { db, getUser, notifyOnce, now, type User } from './db.ts';
import { getSecret, HttpError, setSecret } from './auth.ts';
import { stripeKey, SYSTEM_SCOPE } from './keys.ts';
import { userLocale } from './locale.ts';
import { sendTemplateMail, mailerConfigured } from './mailer.ts';

export type QuotaKind = 'ai_message' | 'pro_task';
export type SubStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';

export interface Subscription {
  userId: string; plan: PlanId; status: SubStatus; provider: 'stripe' | 'gift'; customer: string | null; sub: string | null;
  currentPeriodEnd: string | null; cancelAt: string | null; updatedAt: string;
}

type Row = { user_id: string; plan: string; status: string; provider: string; provider_customer: string | null; provider_sub: string | null; current_period_end: string | null; cancel_at: string | null; updated_at: string };
const toSub = (r: Row): Subscription => ({
  userId: r.user_id, plan: isPlanId(r.plan) ? r.plan : 'free', status: r.status as SubStatus, provider: r.provider as 'stripe' | 'gift',
  customer: r.provider_customer, sub: r.provider_sub, currentPeriodEnd: r.current_period_end, cancelAt: r.cancel_at, updatedAt: r.updated_at,
});

export const subscriptionOf = (userId: string): Subscription | null => {
  const r = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) as Row | undefined;
  return r ? toSub(r) : null;
};

// ---------- Welches Abo gilt gerade? ----------

const PAYING: SubStatus[] = ['active', 'trialing', 'past_due'];

/** Das Abo, das heute gilt: bezahlt (oder geschenkt und nicht abgelaufen), sonst Free. */
export function currentPlanId(user: Pick<User, 'id'>, at = Date.now()): PlanId {
  const s = subscriptionOf(user.id);
  if (!s) {
    // ohne Abo-Eintrag: der Owner (erstes Konto) hat Max, alle anderen das Standard-Abo des Servers (Free)
    const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(user.id) as { role: string } | undefined)?.role;
    return role === 'owner' ? 'max' : isPlanId(config.defaultPlan) ? config.defaultPlan : 'free';
  }
  if (!PAYING.includes(s.status)) return 'free';
  // Geschenke laufen ab; ein gekündigtes Stripe-Abo läuft bis zum Periodenende
  if (s.provider === 'gift' && s.currentPeriodEnd && Date.parse(s.currentPeriodEnd) < at) return 'free';
  if (s.cancelAt && Date.parse(s.cancelAt) < at) return 'free';
  return s.plan;
}

export function planOverrides(): PlanOverrides {
  return getSecret<PlanOverrides>(SYSTEM_SCOPE, 'setting:plans') ?? {};
}

const LIMIT_KEYS: (keyof PlanLimits)[] = ['aiMessagesPerDay', 'proTasksPerMonth', 'proTasksHomeworkOnly', 'mailboxes', 'newsCount', 'newsFavorites', 'screenTime', 'webTasks', 'priority'];

/** Überschreibungen prüfen und speichern (nur bekannte Abos und Felder, sinnvolle Werte) */
export function setPlanOverrides(raw: unknown): PlanOverrides {
  const out: PlanOverrides = {};
  for (const id of PLAN_IDS) {
    const o = ((raw ?? {}) as Record<string, unknown>)[id];
    if (!o || typeof o !== 'object') continue;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'priceCents') { if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000) clean[k] = v; continue; }
      if (!(LIMIT_KEYS as string[]).includes(k)) continue;
      if (typeof v === 'boolean') clean[k] = v;
      else if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000) clean[k] = v;
    }
    if (Object.keys(clean).length) out[id] = clean as PlanOverrides[PlanId];
  }
  setSecret(SYSTEM_SCOPE, 'setting:plans', out);
  return out;
}

export const planFor = (id: PlanId): Plan => effectivePlan(id, planOverrides());
export const planOf = (user: Pick<User, 'id'>): Plan => planFor(currentPlanId(user));

// ---------- Zähler und Kontingente ----------

const period = (user: Pick<User, 'timeZone'>, kind: QuotaKind) => {
  const day = todayIn(user.timeZone || config.defaultTimeZone);
  return kind === 'ai_message' ? day : day.slice(0, 7);
};

export function usedCount(user: Pick<User, 'id' | 'timeZone'>, kind: QuotaKind): number {
  return (db.prepare('SELECT count FROM usage_counters WHERE user_id = ? AND period = ? AND kind = ?').get(user.id, period(user, kind), kind) as { count: number } | undefined)?.count ?? 0;
}

export function consumeQuota(user: Pick<User, 'id' | 'timeZone'>, kind: QuotaKind, n = 1) {
  db.prepare(`INSERT INTO usage_counters (user_id, period, kind, count) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, period, kind) DO UPDATE SET count = count + excluded.count`).run(user.id, period(user, kind), kind, n);
}

export interface QuotaCheck { ok: boolean; used: number; limit: number; plan: PlanId; reason?: 'limit' | 'homework_only' }

/** Darf diese Nutzerin noch? `homework`: die Profi-Aufgabe ist das Lösen einer Hausübung (im Free-Abo erlaubt). */
export function quotaFor(user: User, kind: QuotaKind, opts: { homework?: boolean } = {}): QuotaCheck {
  const planId = currentPlanId(user);
  const limits = planFor(planId).limits;
  const used = usedCount(user, kind);
  const limit = kind === 'ai_message' ? limits.aiMessagesPerDay : limits.proTasksPerMonth;
  if (kind === 'pro_task' && limits.proTasksHomeworkOnly && !opts.homework) return { ok: false, used, limit, plan: planId, reason: 'homework_only' };
  return used < limit ? { ok: true, used, limit, plan: planId } : { ok: false, used, limit, plan: planId, reason: 'limit' };
}

export type PlanFlag = 'screenTime' | 'webTasks' | 'newsFavorites' | 'priority';
export const planAllows = (user: Pick<User, 'id'>, flag: PlanFlag): boolean => !!planOf(user).limits[flag];
export const maxMailboxes = (user: Pick<User, 'id'>): number => planOf(user).limits.mailboxes;

export function usageOverview(user: User) {
  const plan = planOf(user);
  return {
    aiToday: usedCount(user, 'ai_message'), aiLimit: plan.limits.aiMessagesPerDay,
    proMonth: usedCount(user, 'pro_task'), proLimit: plan.limits.proTasksPerMonth, proHomeworkOnly: plan.limits.proTasksHomeworkOnly,
  };
}

/** Der Upgrade-Hinweis kommt höchstens einmal am Tag (sonst wird er aufdringlich) */
export function paywallHintDue(user: User): boolean {
  return notifyOnce(user.id, `paywall-hint:${todayIn(user.timeZone || config.defaultTimeZone)}`);
}

/** Nächstes Abo nach oben (für den Hinweis) */
export const nextPlan = (id: PlanId): PlanId | null => PLAN_IDS[PLAN_IDS.indexOf(id) + 1] ?? null;

// ---------- Abos setzen, schenken ----------

export function setSubscription(userId: string, p: Partial<Omit<Subscription, 'userId' | 'updatedAt'>> & { plan: PlanId; status: SubStatus; provider: 'stripe' | 'gift' }) {
  db.prepare(`INSERT INTO subscriptions (user_id, plan, status, provider, provider_customer, provider_sub, current_period_end, cancel_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, provider = excluded.provider,
      provider_customer = COALESCE(excluded.provider_customer, provider_customer), provider_sub = COALESCE(excluded.provider_sub, provider_sub),
      current_period_end = excluded.current_period_end, cancel_at = excluded.cancel_at, updated_at = excluded.updated_at`)
    .run(userId, p.plan, p.status, p.provider, p.customer ?? null, p.sub ?? null, p.currentPeriodEnd ?? null, p.cancelAt ?? null, now());
}

/** Abo schenken (Tester, Freunde): `days` leer = ohne Ablauf */
export function giftPlan(userId: string, plan: PlanId, days: number | null) {
  if (!getUser(userId)) throw new HttpError(404, 'Konto nicht gefunden.');
  const end = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const before = subscriptionOf(userId);
  // ein laufendes Stripe-Abo bleibt unberührt – Geschenke ersetzen nur Geschenke oder Free
  if (before?.provider === 'stripe' && PAYING.includes(before.status) && before.plan !== 'free') throw new HttpError(409, 'Dieses Konto hat ein bezahltes Abo. Erst kündigen, dann schenken.');
  setSubscription(userId, { plan, status: 'active', provider: 'gift', currentPeriodEnd: end, cancelAt: null, customer: null, sub: null });
}

// ---------- Stripe ----------

/** Verschachtelte Felder als Formular, wie Stripe sie erwartet: a[b][0][c]=… */
export function stripeForm(obj: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) stripeForm(v, prefix ? `${prefix}[${k}]` : k, out);
  } else out.push([prefix, String(obj)]);
  return out;
}

async function stripeCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const k = stripeKey();
  if (!k) throw new HttpError(503, 'Bezahlen ist noch nicht eingerichtet.');
  const res = await fetch(`${config.stripe.baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${k.secretKey}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(stripeForm(body)).toString() } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, `Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

export type Interval = 'month' | 'year';

export async function createCheckout(user: User, planId: PlanId, interval: Interval, returnUrl = config.publicUrl): Promise<{ url: string }> {
  if (planId === 'free') throw new HttpError(400, 'Das Free-Abo braucht keine Bezahlung.');
  const plan = planFor(planId);
  const sub = subscriptionOf(user.id);
  if (sub?.provider === 'stripe' && sub.sub && PAYING.includes(sub.status)) throw new HttpError(409, 'Du hast schon ein Abo. Wechseln oder kündigen geht im Kundenportal.');
  const unit = interval === 'year' ? yearlyPriceCents(plan) : plan.priceCents;
  const session = await stripeCall<{ url: string }>('POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    client_reference_id: user.id,
    ...(sub?.customer ? { customer: sub.customer } : { customer_email: user.email }),
    success_url: `${returnUrl}/#settings`,
    cancel_url: `${returnUrl}/#settings`,
    locale: userLocale(user) === 'pt-BR' ? 'pt-BR' : userLocale(user),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur', unit_amount: unit, recurring: { interval },
        product_data: { name: `Stella ${planId.charAt(0).toUpperCase()}${planId.slice(1)}`, ...(config.stripe.automaticTax ? { tax_code: config.stripe.taxCode } : {}) },
        ...(config.stripe.automaticTax ? { tax_behavior: 'inclusive' } : {}),
      },
    }],
    subscription_data: { metadata: { user_id: user.id, plan: planId } },
    metadata: { user_id: user.id, plan: planId },
    ...(config.stripe.automaticTax ? { automatic_tax: { enabled: true }, ...(sub?.customer ? { customer_update: { address: 'auto' } } : {}) } : {}),
  });
  return { url: session.url };
}

export async function createPortal(user: User, returnUrl = config.publicUrl): Promise<{ url: string }> {
  const sub = subscriptionOf(user.id);
  if (!sub?.customer) throw new HttpError(404, 'Du hast noch kein bezahltes Abo.');
  return stripeCall<{ url: string }>('POST', '/v1/billing_portal/sessions', { customer: sub.customer, return_url: `${returnUrl}/#settings` });
}

/** Stripe-Signatur prüfen: Header `t=…,v1=…`, HMAC-SHA256 über „t.Nutzlast“, höchstens 5 Minuten alt */
export function verifyStripeSignature(raw: Buffer | string, header: string | undefined, secret: string, nowMs = Date.now(), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => { const [k, ...v] = p.split('='); return [k!.trim(), v.join('=')]; }));
  const t = Number(parts.t);
  const v1 = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!Number.isFinite(t) || !v1.length || Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${typeof raw === 'string' ? raw : raw.toString('utf8')}`).digest('hex');
  return v1.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

interface StripeEvent { id: string; type: string; data: { object: Record<string, any> } }

const iso = (unix: unknown) => (typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null);

async function notifySubscription(userId: string, event: 'started' | 'changed' | 'cancelled', plan: PlanId, until?: string | null) {
  const user = getUser(userId);
  if (!user || !mailerConfigured()) return;
  const locale = userLocale(user);
  await sendTemplateMail(user.email, locale, 'subscription', {
    name: user.name, event, plan: plan.charAt(0).toUpperCase() + plan.slice(1),
    until: until ? new Date(until).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '', appUrl: config.publicUrl,
  }, 'noreply', { purpose: 'subscription', userId }).catch((err) => console.warn('Abo-Mail:', (err as Error).message));
}

/** Ein Stripe-Ereignis verarbeiten – idempotent: dieselbe Ereignis-Id wirkt nur einmal. */
export async function handleStripeEvent(ev: StripeEvent): Promise<'done' | 'duplicate' | 'ignored'> {
  if (db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(ev.id)) return 'duplicate';
  db.prepare('INSERT INTO stripe_events (id, type, at) VALUES (?, ?, ?)').run(ev.id, ev.type, now());
  const o = ev.data.object;
  const userIdOf = (): string | null => {
    const meta = o.metadata?.user_id ?? o.client_reference_id;
    if (typeof meta === 'string' && getUser(meta)) return meta;
    const bySub = db.prepare('SELECT user_id FROM subscriptions WHERE provider_sub = ? OR (provider_customer = ? AND ? IS NOT NULL)').get(o.id ?? null, o.customer ?? null, o.customer ?? null) as { user_id: string } | undefined;
    return bySub?.user_id ?? null;
  };

  if (ev.type === 'checkout.session.completed') {
    const userId = userIdOf();
    const plan = o.metadata?.plan;
    if (!userId || !isPlanId(plan) || o.mode !== 'subscription') return 'ignored';
    setSubscription(userId, { plan, status: 'active', provider: 'stripe', customer: o.customer ?? null, sub: o.subscription ?? null, currentPeriodEnd: null, cancelAt: null });
    await notifySubscription(userId, 'started', plan);
    return 'done';
  }

  if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const userId = userIdOf();
    if (!userId) return 'ignored';
    const before = subscriptionOf(userId);
    const metaPlan = o.metadata?.plan;
    const plan: PlanId = isPlanId(metaPlan) ? metaPlan : before?.plan ?? 'free';
    const deleted = ev.type === 'customer.subscription.deleted';
    const status = (deleted ? 'canceled' : String(o.status ?? 'active')) as SubStatus;
    const periodEnd = iso(o.current_period_end ?? o.items?.data?.[0]?.current_period_end);
    const cancelAt = deleted ? now() : o.cancel_at_period_end ? periodEnd : iso(o.cancel_at);
    setSubscription(userId, { plan, status, provider: 'stripe', customer: o.customer ?? before?.customer ?? null, sub: o.id ?? before?.sub ?? null, currentPeriodEnd: periodEnd, cancelAt });
    if (deleted || (cancelAt && !before?.cancelAt)) await notifySubscription(userId, 'cancelled', plan, periodEnd);
    else if (before && before.plan !== plan && PAYING.includes(status)) await notifySubscription(userId, 'changed', plan);
    return 'done';
  }
  return 'ignored';
}

// ---------- Zahlen für das Firmen-Dashboard ----------

/** Was von einem Abo nach 20 % Umsatzsteuer und Stripe-Gebühr (≈ 1,5 % + 0,25 €) übrig bleibt, in Cent */
export const netCents = (grossCents: number) => (grossCents === 0 ? 0 : Math.round(grossCents / 1.2 - (grossCents * 0.015 + 25)));

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0);

export function billingOverview(days = 30) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const users = db.prepare('SELECT id, name FROM users WHERE verified = 1').all() as { id: string; name: string }[];
  const cost = new Map(costPerUser(from, to).map((c) => [c.userId, c.costMicroUsd]));
  const eur = config.pricing.eurPerUsd;
  const perPlan = Object.fromEntries(PLAN_IDS.map((id) => [id, { users: 0, paying: 0, costs: [] as number[] }])) as Record<PlanId, { users: number; paying: number; costs: number[] }>;
  const table: { id: string; name: string; plan: PlanId; costEur: number }[] = [];
  for (const u of users) {
    const plan = currentPlanId(u);
    const eurCost = ((cost.get(u.id) ?? 0) / 1e6) * eur;
    perPlan[plan].users++;
    perPlan[plan].costs.push(eurCost);
    if (subscriptionOf(u.id)?.provider === 'stripe' && plan !== 'free') perPlan[plan].paying++;
    table.push({ id: u.id, name: u.name, plan, costEur: eurCost });
  }
  let mrrCents = 0;
  const plans = PLAN_IDS.map((id) => {
    const p = perPlan[id];
    const sorted = [...p.costs].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const price = planFor(id).priceCents;
    mrrCents += p.paying * price;
    // Kosten sind für `days` Tage gemessen – auf einen Monat hochrechnen
    const monthly = avg * (30 / days);
    return {
      plan: id, users: p.users, paying: p.paying, priceCents: price,
      avgCostEur: avg, p95CostEur: percentile(sorted, 0.95), totalCostEur: sorted.reduce((a, b) => a + b, 0),
      marginPerUserEur: price === 0 ? -monthly : netCents(price) / 100 - monthly,
    };
  });
  return {
    days, mrrCents, plans,
    totalCostEur: plans.reduce((a, p) => a + p.totalCostEur, 0),
    topUsers: table.sort((a, b) => b.costEur - a.costEur).slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.name, plan: r.plan, costEur: r.costEur })),
  };
}

// ---------- Routen ----------

export function billingStatus(user: User) {
  const sub = subscriptionOf(user.id);
  const planId = currentPlanId(user);
  const ov = planOverrides();
  return {
    plan: planId, subscription: sub && { status: sub.status, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd, cancelAt: sub.cancelAt },
    usage: usageOverview(user),
    plans: PLAN_IDS.map((id) => effectivePlan(id, ov)),
    canCheckout: !!stripeKey() && sub?.provider !== 'gift',
    canManage: !!sub?.customer,
  };
}

/** Mit Login: Stand, Checkout, Kundenportal */
export function registerBillingRoutes(api: FastifyInstance) {
  api.get('/api/billing/status', async (req) => billingStatus(req.user));

  api.post('/api/billing/checkout', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isPlanId(b.plan)) throw new HttpError(400, 'Unbekanntes Abo.');
    return createCheckout(req.user, b.plan, b.interval === 'year' ? 'year' : 'month');
  });

  api.post('/api/billing/portal', async (req) => createPortal(req.user));
}

/**
 * Webhook: öffentlich, aber nur mit gültiger Stripe-Signatur über den unveränderten Rohtext.
 * Muss auf oberster Ebene registriert werden – nicht innerhalb des Login-Bereichs, sonst greift dessen Anmelde-Prüfung.
 */
export function registerBillingWebhook(root: FastifyInstance) {
  void root.register(async (app) => {
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    app.post('/api/billing/webhook', { bodyLimit: 1_000_000 }, async (req, reply) => {
      const key = stripeKey();
      const raw = req.body as Buffer;
      if (!key?.webhookSecret || !verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, key.webhookSecret)) {
        return reply.code(401).send({ error: 'invalid signature' });
      }
      let ev: StripeEvent;
      try { ev = JSON.parse(raw.toString('utf8')) as StripeEvent; } catch { return reply.code(400).send({ error: 'invalid json' }); }
      try {
        return { received: true, result: await handleStripeEvent(ev) };
      } catch (err) {
        // Stripe wiederholt bei Fehlern; das Ereignis wurde noch nicht als verarbeitet gemerkt
        db.prepare('DELETE FROM stripe_events WHERE id = ?').run(ev.id);
        req.log.error(err);
        return reply.code(500).send({ error: 'failed' });
      }
    });
  });
}
