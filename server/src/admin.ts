// Nur für den Owner (erster Nutzer): Server-Schlüssel. Die Schlüssel selbst gehen nie zurück an den Client.

import type { FastifyInstance } from 'fastify';
import { HttpError, requireOwner } from './auth.ts';
import { rotateInboundSecret, inboundSecretSet } from './inbound.ts';
import { isKeyName, keyStatus, serverAiSettings, setKey, setServerAiSettings, testKey } from './keys.ts';
import { createInvite, deleteInvite, listInvites, registrationMode } from './signup.ts';
import { isLocale, isPlanId, LOCALES, DEFAULT_LOCALE, PLAN_IDS, PLANS } from '@stella/shared';
import { billingOverview, giftPlan, planFor, planOverrides, setPlanOverrides, subscriptionOf } from './billing.ts';
import { db } from './db.ts';
import { registerWebhook, unregisterWebhook } from './channels/telegram.ts';
import { renderTemplate, SAMPLE, TEMPLATE_NAMES, type TemplateName } from './email/templates.ts';

export function registerAdminRoutes(api: FastifyInstance) {
  api.get('/api/admin/keys', { preHandler: requireOwner }, async () => ({ keys: keyStatus() }));

  api.put('/api/admin/keys', { preHandler: requireOwner }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isKeyName(b.name)) throw new HttpError(400, 'Unbekannter Schlüssel.');
    const empty = b.value === null || b.value === '' || b.value === undefined;
    if (b.name === 'telegram' && empty) await unregisterWebhook();
    setKey(b.name, b.value);
    // Telegram: nach dem Speichern den Webhook setzen (Ergebnis steht danach im Schlüssel-Status)
    const webhook = b.name === 'telegram' && !empty ? await registerWebhook() : undefined;
    return { keys: keyStatus(), ...(webhook ? { webhook } : {}) };
  });

  api.post<{ Params: { name: string } }>('/api/admin/keys/:name/test', { preHandler: requireOwner }, async (req) => {
    if (!isKeyName(req.params.name)) throw new HttpError(400, 'Unbekannter Schlüssel.');
    const result = await testKey(req.params.name);
    return { ...result, keys: keyStatus() };
  });

  // Vorschau aller Mail-Vorlagen mit Beispieldaten (HTML, `?locale=de`; ohne Vorlage: Liste)
  api.get('/api/admin/mail-preview', { preHandler: requireOwner }, async () => ({ templates: TEMPLATE_NAMES, locales: LOCALES }));
  api.get<{ Params: { template: string }; Querystring: { locale?: string; format?: string } }>('/api/admin/mail-preview/:template', { preHandler: requireOwner }, async (req, reply) => {
    if (!TEMPLATE_NAMES.includes(req.params.template as TemplateName)) throw new HttpError(404, 'Unbekannte Vorlage.');
    const locale = isLocale(req.query.locale) ? req.query.locale : DEFAULT_LOCALE;
    const mail = renderTemplate(req.params.template as TemplateName, locale, SAMPLE);
    if (req.query.format === 'json') return mail;
    return reply.type('text/html; charset=utf-8').send(mail.html);
  });

  // Abos: schenken, Limits ändern (ohne Deploy), Zahlen für das Dashboard
  api.post('/api/admin/billing/gift', { preHandler: requireOwner }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const row = db.prepare('SELECT id FROM users WHERE email = ? OR id = ?').get(email, String(b.userId ?? '')) as { id: string } | undefined;
    if (!row) throw new HttpError(404, 'Konto nicht gefunden.');
    if (!isPlanId(b.plan)) throw new HttpError(400, 'Unbekanntes Abo.');
    const days = b.days === null || b.days === undefined || b.days === '' ? null : Number(b.days);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) throw new HttpError(400, 'Tage: 1 bis 3650 oder leer für unbegrenzt.');
    giftPlan(row.id, b.plan, days);
    return { ok: true, subscription: subscriptionOf(row.id) };
  });
  api.get('/api/admin/plans', { preHandler: requireOwner }, async () => ({ defaults: PLANS, overrides: planOverrides(), effective: PLAN_IDS.map((id) => planFor(id)) }));
  api.put('/api/admin/plans', { preHandler: requireOwner }, async (req) => {
    const overrides = setPlanOverrides(req.body);
    return { overrides, effective: PLAN_IDS.map((id) => planFor(id)) };
  });
  api.get<{ Querystring: { days?: string } }>('/api/admin/billing-overview', { preHandler: requireOwner }, async (req) =>
    billingOverview(Math.min(Math.max(Number(req.query.days) || 30, 1), 365)));

  // KI-Einstellungen des Servers: Notfall-Ausweichen auf Gratis-Modelle ein/aus
  api.get('/api/admin/ai', { preHandler: requireOwner }, async () => serverAiSettings());
  api.put('/api/admin/ai', { preHandler: requireOwner }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    return setServerAiSettings({ allowFreeFallback: typeof b.allowFreeFallback === 'boolean' ? b.allowFreeFallback : undefined });
  });

  // Schlüssel zwischen dem Cloudflare-Worker für stella@ und diesem Server. Wird nur beim Erzeugen angezeigt.
  api.get('/api/admin/inbound', { preHandler: requireOwner }, async () => ({ configured: inboundSecretSet() }));
  api.post('/api/admin/inbound-secret', { preHandler: requireOwner }, async () => ({ secret: rotateInboundSecret(), configured: true }));

  // Einladungscodes für neue Konten (Registrierungsmodus „invite“)
  api.get('/api/admin/invites', { preHandler: requireOwner }, async () => ({ mode: registrationMode(), invites: listInvites() }));
  api.post('/api/admin/invites', { preHandler: requireOwner }, async (req) => {
    const days = Number(((req.body ?? {}) as Record<string, unknown>).days) || 14;
    return { ...createInvite(req.user.id, days), invites: listInvites() };
  });
  api.delete<{ Params: { code: string } }>('/api/admin/invites/:code', { preHandler: requireOwner }, async (req) => {
    if (!deleteInvite(req.params.code)) throw new HttpError(404, 'Einladung nicht gefunden.');
    return { invites: listInvites() };
  });
}
