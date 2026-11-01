// Nur für den Owner (erster Nutzer): Server-Schlüssel. Die Schlüssel selbst gehen nie zurück an den Client.

import type { FastifyInstance } from 'fastify';
import { HttpError, requireOwner } from './auth.ts';
import { rotateInboundSecret, inboundSecretSet } from './inbound.ts';
import { isKeyName, keyStatus, serverAiSettings, setKey, setServerAiSettings, testKey } from './keys.ts';
import { createInvite, deleteInvite, listInvites, registrationMode } from './signup.ts';
import { isLocale, LOCALES, DEFAULT_LOCALE } from '@stella/shared';
import { renderTemplate, SAMPLE, TEMPLATE_NAMES, type TemplateName } from './email/templates.ts';

export function registerAdminRoutes(api: FastifyInstance) {
  api.get('/api/admin/keys', { preHandler: requireOwner }, async () => ({ keys: keyStatus() }));

  api.put('/api/admin/keys', { preHandler: requireOwner }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isKeyName(b.name)) throw new HttpError(400, 'Unbekannter Schlüssel.');
    setKey(b.name, b.value);
    return { keys: keyStatus() };
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
