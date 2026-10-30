// Nur für den Owner (erster Nutzer): Server-Schlüssel. Die Schlüssel selbst gehen nie zurück an den Client.

import type { FastifyInstance } from 'fastify';
import { HttpError, requireOwner } from './auth.ts';
import { rotateInboundSecret, inboundSecretSet } from './inbound.ts';
import { isKeyName, keyStatus, setKey, testKey } from './keys.ts';
import { createInvite, deleteInvite, listInvites, registrationMode } from './signup.ts';

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
