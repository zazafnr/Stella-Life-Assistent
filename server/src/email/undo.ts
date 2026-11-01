// „Rückgängig machen“ per Link in Stellas Antwort-Mail: signiert (HMAC), 7 Tage gültig.
// Ein GET zeigt nur eine Bestätigungsseite – Mail-Scanner rufen Links automatisch auf und dürfen nichts auslösen.
// Erst der Knopf (POST) macht die Aktionen rückgängig.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { getUser } from '../db.ts';
import { undo } from '../actions.ts';
import { tr } from '../locale.ts';
import { simplePage } from './pages.ts';

const secret = () => `undo:${config.secret || 'stella-dev-secret-not-for-production'}`;
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function undoToken(userId: string, actionIds: string[], days = 7, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, a: actionIds.slice(0, 10), e: Math.floor(nowMs / 1000) + days * 86_400 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export type UndoCheck = { ok: true; userId: string; actionIds: string[] } | { ok: false; reason: 'invalid' | 'expired' };

export function checkUndoToken(token: string, nowMs = Date.now()): UndoCheck {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: string; a?: string[]; e?: number };
    if (!d.u || !Array.isArray(d.a) || typeof d.e !== 'number') return { ok: false, reason: 'invalid' };
    if (d.e * 1000 < nowMs) return { ok: false, reason: 'expired' };
    return { ok: true, userId: d.u, actionIds: d.a };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export const undoUrl = (token: string) => `${config.publicUrl}/api/mail/undo/${token}`;

const anon = { settings: {} };

export function registerUndoRoutes(root: FastifyInstance) {
  // Eigener Bereich: Formulare schicken application/x-www-form-urlencoded, das Fastify sonst ablehnt
  void root.register(async (app) => {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  app.get<{ Params: { token: string } }>('/api/mail/undo/:token', async (req, reply) => {
    const c = checkUndoToken(req.params.token);
    reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
    if (!c.ok) {
      return reply.code(c.reason === 'invalid' ? 403 : 410).send(simplePage({
        locale: 'en', tone: 'warn', title: tr(anon, c.reason === 'invalid' ? 'email.undo.invalidTitle' : 'email.undo.expiredTitle'),
        text: tr(anon, c.reason === 'invalid' ? 'email.undo.invalidText' : 'email.undo.expiredText'),
      }));
    }
    const user = getUser(c.userId);
    const u = user ?? anon;
    return reply.send(simplePage({
      locale: (user?.settings.locale ?? 'en'), title: tr(u, 'email.undo.confirmTitle'), text: tr(u, 'email.undo.confirmText'),
      form: { action: `/api/mail/undo/${req.params.token}`, button: tr(u, 'email.undo.confirmButton') },
    }));
  });

  app.post<{ Params: { token: string } }>('/api/mail/undo/:token', async (req, reply) => {
    const c = checkUndoToken(req.params.token);
    reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
    if (!c.ok) {
      return reply.code(c.reason === 'invalid' ? 403 : 410).send(simplePage({
        locale: 'en', tone: 'warn', title: tr(anon, c.reason === 'invalid' ? 'email.undo.invalidTitle' : 'email.undo.expiredTitle'),
        text: tr(anon, c.reason === 'invalid' ? 'email.undo.invalidText' : 'email.undo.expiredText'),
      }));
    }
    const user = getUser(c.userId);
    if (!user) return reply.code(410).send(simplePage({ locale: 'en', tone: 'warn', title: tr(anon, 'email.undo.expiredTitle'), text: tr(anon, 'email.undo.expiredText') }));
    let undone = 0;
    for (const id of c.actionIds) {
      try { undo(user.id, id); undone++; } catch { /* schon rückgängig oder nicht mehr möglich */ }
    }
    return reply.send(simplePage({
      locale: user.settings.locale ?? 'en', title: tr(user, 'email.undo.doneTitle'),
      text: undone ? tr(user, 'email.undo.doneText') : tr(user, 'email.undo.alreadyText'),
    }));
  });
  });
}
