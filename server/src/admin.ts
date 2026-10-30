// Nur für den Owner (erster Nutzer): Server-Schlüssel. Die Schlüssel selbst gehen nie zurück an den Client.

import type { FastifyInstance } from 'fastify';
import { HttpError, requireOwner } from './auth.ts';
import { isKeyName, keyStatus, setKey, testKey } from './keys.ts';

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
}
