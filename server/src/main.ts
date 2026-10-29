import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { addDays, todayIn, type Item } from '@stella/shared';
import { config } from './config.ts';
import {
  deleteSecret, hasSecret, HttpError, login, logout, register, requireUser, setSecret, userByIngestToken, userCount,
} from './auth.ts';
import {
  addMessage, db, getUser, itemsChangedSince, listItems, messagesSince, newId, now, recentMessages, updateUserSettings,
  type User, type UserSettings,
} from './db.ts';
import { handleChat } from './assistant.ts';
import { addItem, changeItem } from './planner.ts';
import { modelStatus } from './llm.ts';
import { pushToUser, saveSubscription, vapidPublicKey } from './push.ts';
import { startScheduler } from './scheduler.ts';
import { listDigi4SchoolBooks } from './digi4school.ts';
import { toICalendar } from './ical.ts';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: 'Interner Fehler' });
});

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

function publicUser(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, timeZone: user.timeZone, settings: user.settings,
    ingestUrl: `${config.publicUrl}/api/ingest/${user.ingestToken}`,
    integrations: { digi4school: hasSecret(user.id, 'digi4school') },
  };
}

// ---------- öffentlich ----------

app.get('/api/status', async () => ({
  ok: true, hasUsers: userCount() > 0, registrationOpen: userCount() === 0 || config.allowRegistration,
}));

app.post('/api/auth/register', async (req) => {
  const b = req.body as Record<string, unknown>;
  const { token, user } = register(str(b.name, 80) || 'Du', str(b.email, 200), str(b.password, 200), str(b.timeZone, 60), str(b.device, 80));
  addMessage(user.id, 'assistant',
    `Hi ${user.name}! 👋 Ich bin Stella. Schreib mir einfach kurz, was ansteht – zum Beispiel:\n` +
    `• „Latein HÜ S. 45 Nr. 3 Freitag“\n• „Mathe SA 12.11.“\n• „was steht an?“\n` +
    `Ich trag's ein, erinnere dich rechtzeitig und mach dir Lernpläne. 💫`);
  return { token, user: publicUser(user) };
});

app.post('/api/auth/login', async (req) => {
  const b = req.body as Record<string, unknown>;
  const { token, user } = login(str(b.email, 200), str(b.password, 200), str(b.device, 80));
  return { token, user: publicUser(user) };
});

// ---------- Kurzbefehle / Webhooks (Token in der URL statt Login) ----------

app.register(async (ingest) => {
  ingest.addHook('preHandler', async (req: FastifyRequest<{ Params: { token: string } }>, reply) => {
    const user = userByIngestToken(req.params.token);
    if (!user) return reply.code(404).send({ error: 'Unbekannt' });
    req.user = user;
  });

  // Kalender-Abo: iPhone → Einstellungen → Kalender → Accounts → Kalenderabo hinzufügen
  ingest.get('/api/ingest/:token/calendar.ics', async (req, reply) => {
    const items = listItems(req.user.id, { from: addDays(todayIn(req.user.timeZone), -30), includeDone: true });
    return reply.type('text/calendar; charset=utf-8').send(toICalendar(items, req.user.timeZone));
  });

  // Apple-Kurzbefehl "Gesundheit an Stella" – z. B. täglich um 21:00
  ingest.post('/api/ingest/:token/health', async (req) => {
    const b = req.body as Record<string, unknown>;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : todayIn(req.user.timeZone);
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(',', '.')));
    db.prepare(`INSERT INTO health_days (user_id, date, steps, sleep_hours, active_minutes, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET steps = COALESCE(excluded.steps, steps),
        sleep_hours = COALESCE(excluded.sleep_hours, sleep_hours), active_minutes = COALESCE(excluded.active_minutes, active_minutes),
        updated_at = excluded.updated_at`)
      .run(req.user.id, date, num(b.steps), num(b.sleepHours), num(b.activeMinutes), now());
    return { ok: true };
  });

  // Apple-Kurzbefehl-Automation "Wenn ich eine Nachricht erhalte" → SMS/iMessage weiterleiten
  ingest.post('/api/ingest/:token/:source', async (req: FastifyRequest<{ Params: { token: string; source: string } }>) => {
    const b = req.body as Record<string, unknown>;
    const source = req.params.source.replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'other';
    const sender = str(b.sender, 200) || null;
    db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), req.user.id, source, sender, str(b.text, 4000) || null, JSON.stringify(b).slice(0, 8000), now());

    // Jemand meldet sich auffällig oft → Bescheid geben (höchstens einmal pro Stunde je Absender)
    if (sender) {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM inbox_events WHERE user_id = ? AND sender = ? AND created_at > ?')
        .get(req.user.id, sender, since) as { n: number };
      if (n === 3) {
        const label = source === 'call' ? 'angerufen' : 'geschrieben';
        const text = `🔔 ${sender} hat dich in der letzten halben Stunde ${n}× ${label}. Vielleicht ist es wichtig?`;
        addMessage(req.user.id, 'assistant', text);
        await pushToUser(req.user.id, { title: 'Stella', body: text, tag: `burst-${sender}` });
      }
    }
    return { ok: true };
  });
});

// ---------- mit Login ----------

app.register(async (api) => {
  api.addHook('preHandler', requireUser);

  api.post('/api/auth/logout', async (req) => {
    logout((req.headers.authorization ?? '').slice(7));
    return { ok: true };
  });

  api.get('/api/me', async (req) => publicUser(req.user));

  api.patch('/api/settings', async (req) => {
    const b = req.body as Record<string, unknown>;
    const patch: Partial<UserSettings> = {};
    const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : undefined);
    if (b.eveningTime !== undefined) patch.eveningTime = time(b.eveningTime);
    if (b.studyTime !== undefined) patch.studyTime = time(b.studyTime);
    if (b.stepGoal !== undefined) patch.stepGoal = Math.max(0, Number(b.stepGoal) || 0);
    if (Array.isArray(b.digi4schoolBooks)) {
      patch.digi4schoolBooks = b.digi4schoolBooks.slice(0, 40).map((x: any) => ({
        subject: str(x.subject, 60), url: str(x.url, 500), pageOffset: Number(x.pageOffset) || 0,
        pageUrlTemplate: str(x.pageUrlTemplate, 500) || undefined,
      })).filter((x) => x.subject && x.url.startsWith('https://'));
    }
    let tz: string | undefined;
    if (b.timeZone) {
      try { new Intl.DateTimeFormat('de', { timeZone: str(b.timeZone) }); tz = str(b.timeZone); } catch { throw new HttpError(400, 'Unbekannte Zeitzone'); }
    }
    updateUserSettings(req.user.id, patch, tz);
    return publicUser(getUser(req.user.id)!);
  });

  // Chat
  api.post('/api/chat', async (req) => {
    const b = req.body as Record<string, unknown>;
    const text = str(b.text, 4000).trim();
    if (!text) throw new HttpError(400, 'Leere Nachricht');
    return handleChat(req.user, text, str(b.clientId, 100) || null);
  });

  api.get('/api/messages', async (req) => {
    const q = req.query as Record<string, string>;
    return recentMessages(req.user.id, Math.min(Number(q.limit) || 50, 200), q.before || undefined);
  });

  // Abgleich für alle Geräte: "gib mir alles, was sich seit X geändert hat"
  api.get('/api/sync', async (req) => {
    const since = str((req.query as Record<string, string>).since);
    const serverTime = now();
    if (!since) {
      const today = todayIn(req.user.timeZone);
      const items = listItems(req.user.id, { from: addDays(today, -30), includeDone: true });
      return { items, messages: recentMessages(req.user.id, 80), serverTime };
    }
    return { items: itemsChangedSince(req.user.id, since), messages: messagesSince(req.user.id, since), serverTime };
  });

  // Planer
  api.get('/api/items', async (req) => {
    const q = req.query as Record<string, string>;
    return listItems(req.user.id, { from: q.from, to: q.to, kind: q.kind, includeDone: q.includeDone === 'true' });
  });

  api.post('/api/items', async (req) => {
    const b = req.body as Partial<Item>;
    if (!b.title || !b.kind) throw new HttpError(400, 'title und kind sind Pflicht');
    return addItem(req.user, {
      kind: b.kind, title: str(b.title, 200), subject: b.subject ?? null, detail: b.detail ?? null, notes: b.notes ?? null,
      due: b.due ?? null, time: b.time ?? null, material: b.material ?? null, source: 'app',
    });
  });

  api.patch('/api/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = req.body as Partial<Item>;
    const allowed: (keyof Item)[] = ['title', 'detail', 'notes', 'due', 'time', 'status', 'material', 'subject', 'kind'];
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k as keyof Item)));
    const item = changeItem(req.user, req.params.id, patch);
    if (!item) throw new HttpError(404, 'Nicht gefunden');
    return item;
  });

  api.delete('/api/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const item = changeItem(req.user, req.params.id, { deleted: true });
    if (!item) throw new HttpError(404, 'Nicht gefunden');
    return { ok: true };
  });

  // Bilder (z. B. digi4school-Screenshots) – nur für den Besitzer
  api.get('/api/files/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = req.params.id.replace(/[^a-f0-9-]/g, '');
    const owned = db.prepare(`SELECT 1 FROM items WHERE user_id = ? AND attachments LIKE ?
      UNION SELECT 1 FROM messages WHERE user_id = ? AND attachments LIKE ?`).get(req.user.id, `%${id}%`, req.user.id, `%${id}%`);
    const file = path.join(config.dataDir, 'files', `${id}.png`);
    if (!owned || !existsSync(file)) throw new HttpError(404, 'Nicht gefunden');
    return reply.type('image/png').header('Cache-Control', 'private, max-age=31536000, immutable').send(createReadStream(file));
  });

  // Push
  api.get('/api/push/key', async () => ({ publicKey: vapidPublicKey }));
  api.post('/api/push/subscribe', async (req) => {
    const sub = req.body as { endpoint?: string; keys?: { p256dh: string; auth: string } };
    if (!sub?.endpoint?.startsWith('https://') || !sub.keys) throw new HttpError(400, 'Ungültiges Abo');
    saveSubscription(req.user.id, sub as never);
    return { ok: true };
  });
  api.post('/api/push/test', async (req) => {
    await pushToUser(req.user.id, { title: 'Stella', body: 'Push funktioniert! 🎉' });
    return { ok: true };
  });

  // Gesundheit
  api.get('/api/health', async (req) => {
    const days = Math.min(Number((req.query as Record<string, string>).days) || 14, 365);
    const from = addDays(todayIn(req.user.timeZone), -days + 1);
    return db.prepare(`SELECT date, steps, sleep_hours AS sleepHours, active_minutes AS activeMinutes
      FROM health_days WHERE user_id = ? AND date >= ? ORDER BY date`).all(req.user.id, from);
  });

  // Integrationen
  api.put('/api/integrations/digi4school', async (req) => {
    const b = req.body as Record<string, unknown>;
    if (!str(b.email) || !str(b.password)) throw new HttpError(400, 'E-Mail und Passwort nötig');
    setSecret(req.user.id, 'digi4school', { email: str(b.email, 200), password: str(b.password, 200) });
    return { ok: true };
  });
  api.delete('/api/integrations/digi4school', async (req) => {
    deleteSecret(req.user.id, 'digi4school');
    return { ok: true };
  });
  api.get('/api/integrations/digi4school/books', async (req) => {
    try {
      return await listDigi4SchoolBooks(req.user.id);
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  });

  api.get('/api/ai/status', async () => modelStatus());
});

// ---------- Web-App ausliefern ----------

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    wildcard: false,
    setHeaders: (res, filePath) => {
      // Service Worker & HTML immer frisch, gehashte Assets ewig cachen
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}

startScheduler();
await app.listen({ port: config.port, host: config.host });
