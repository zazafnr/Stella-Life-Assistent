import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.ts';
import { perform } from '../actions.ts';
import { addMessage, type User } from '../db.ts';
import { tr } from '../locale.ts';

export interface PlanInput { name: string; when: string; people?: number | null; address?: string | null; phone?: string | null }

/** „In den Planer“: legt einen Termin „Reservierung: <Name>“ an – über die Rechte-Stufen, mit „Rückgängig“ */
export function planReservation(user: User, input: PlanInput) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(input.when ?? ''));
  if (!name || !m) throw new HttpError(400, 'Name und Zeitpunkt (YYYY-MM-DDTHH:MM) fehlen.');
  const detail = [
    input.people ? tr(user, 'errand.people', { count: input.people }) : '', input.address ?? '', input.phone ?? '', tr(user, 'errand.notBooked'),
  ].filter(Boolean).join(' · ');
  const r = perform(user, 'item.create', { kind: 'event', title: `${tr(user, 'errand.reservation')}: ${name}`, subject: null, detail, due: m[1]!, time: m[2]!, material: null, source: 'chat' }, {
    source: 'chat', say: (text, actionId) => { addMessage(user.id, 'assistant', text, { actionId }); },
  });
  return r;
}

export function registerErrandRoutes(api: FastifyInstance) {
  api.post('/api/errands/plan', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = planReservation(req.user, {
      name: String(b.name ?? ''), when: String(b.when ?? ''), people: Number(b.people) || null,
      address: typeof b.address === 'string' ? b.address : null, phone: typeof b.phone === 'string' ? b.phone : null,
    });
    if (r.status === 'refused') throw new HttpError(403, r.reason);
    return { status: r.status, actionId: r.actionId, items: r.changed };
  });
}
