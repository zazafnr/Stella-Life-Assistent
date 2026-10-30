import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { addDays, isTone, todayIn, voice, type Item } from '@stella/shared';
import { config } from './config.ts';
import {
  deleteSecret, hasSecret, HttpError, login, logout, register, requireUser, setSecret, userByIngestToken, userCount,
} from './auth.ts';
import {
  addMessage, db, getUser, itemsChangedSince, listItems, messagesSince, newId, now, recentMessages, updateUserSettings,
  type User, type UserSettings,
} from './db.ts';
import { handleChat } from './assistant.ts';
import { addItem, changeItem, rescheduleAll } from './planner.ts';
import { modelStatus } from './llm.ts';
import { pushToUser, saveSubscription, vapidPublicKey } from './push.ts';
import { startScheduler } from './scheduler.ts';
import { toICalendar } from './ical.ts';
import { getBookCredentials, listShelf, LOGIN_PAGES, normalizeCookies, PROVIDERS, saveBookCredentials, screenshotPage, secretName } from './books.ts';
import { deleteUserFont, renderHandwriting, saveUserFont, userFontPath } from './handwriting.ts';
import { checkAllMail, draftReply, getMailBody, getMailEvent, isMailCategory, listAccounts, moveMail, PRESETS, publicAccounts, restoreMail, saveAccounts, setEventField, testAccount, type MailAccount } from './mail.ts';
import { lessonsFor, syncUntis, testUntis, type UntisCredentials } from './untis.ts';
import { FILE_TYPES, filePath, saveDataUrl, saveFile } from './files.ts';
import type { BookProvider } from './db.ts';
import { ackNotesEntry, notesInbox, usesFreeNotes } from './notes.ts';
import { finishGoogle, finishTarget, googleAuthUrl, googleConfigured, readState, type OAuthClient } from './oauth.ts';
import { approve, GROUPS, isGroup, isLevel, levelFor, listActions, perform, reject, undo } from './actions.ts';
import { LlmUnavailable } from './llm.ts';
import { buildBriefing } from './briefing.ts';
import { cleanBlocks, planWeek } from './weekplan.ts';
import { acceptHint, dismissHint } from './hints.ts';
import { registerAdminRoutes } from './admin.ts';
import { addMemory, cleanSchedule, deleteMemory, isCategory, listMemories, MEMORY_CATEGORIES, updateMemory } from './memory.ts';

// trustProxy nur für Caddy auf derselben Maschine – sonst ließe sich die Absender-Adresse fälschen
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024, trustProxy: '127.0.0.1' });
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: 'Interner Fehler' });
});

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

function publicUser(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, timeZone: user.timeZone, settings: user.settings, role: user.role,
    ingestUrl: `${config.publicUrl}/api/ingest/${user.ingestToken}`,
    integrations: {
      books: Object.fromEntries((Object.keys(PROVIDERS) as BookProvider[]).map((p) => {
        const c = getBookCredentials(user.id, p);
        return [p, { connected: !!c, cookies: !!c?.cookies?.length, email: c?.email ?? null }];
      })),
      webuntis: hasSecret(user.id, 'webuntis'),
      mailAccounts: listAccounts(user.id).length,
      handwritingFont: !!userFontPath(user.id),
      freeNotes: usesFreeNotes(user.id),
      /** Server kann "Mit Google anmelden" (GOOGLE_CLIENT_ID gesetzt) */
      googleSignIn: googleConfigured(),
    },
  };
}

// ---------- öffentlich ----------

app.get('/api/status', async () => ({
  ok: true, hasUsers: userCount() > 0, registrationOpen: userCount() === 0 || config.allowRegistration,
}));

app.post('/api/auth/register', async (req) => {
  const b = req.body as Record<string, unknown>;
  const { token, user } = register(str(b.name, 80) || 'Du', str(b.email, 200), str(b.password, 200), str(b.timeZone, 60), str(b.device, 80));
  addMessage(user.id, 'assistant', voice(user.settings.tone).welcome(user.name));
  return { token, user: publicUser(user) };
});

app.post('/api/auth/login', async (req) => {
  const b = req.body as Record<string, unknown>;
  const { token, user } = login(str(b.email, 200), str(b.password, 200), str(b.device, 80), req.ip);
  return { token, user: publicUser(user) };
});

// Rückkehr von Google nach "Mit Google anmelden" – der signierte state sagt, wer es war
app.get('/api/oauth/google/callback', async (req, reply) => {
  const q = req.query as Record<string, string>;
  const state = readState(str(q.state));
  if (!state) return reply.code(400).type('text/html; charset=utf-8').send(finishTarget('desktop', false, 'Der Link ist abgelaufen. Bitte in Stella nochmal auf „Mit Google anmelden“ tippen.').html);
  let result: ReturnType<typeof finishTarget>;
  if (q.error || !q.code) {
    result = finishTarget(state.c, false, q.error === 'access_denied' ? 'Du hast die Anmeldung abgebrochen.' : `Google meldet: ${str(q.error, 100) || 'kein Code'}`);
  } else {
    try {
      const account = await finishGoogle(state.u, str(q.code, 2000));
      void checkAllMail(state.u).catch(() => {});
      result = finishTarget(state.c, true, `${account.user} ist verbunden – Stella sortiert ab jetzt deine Mails.`);
    } catch (err) {
      result = finishTarget(state.c, false, (err as Error).message);
    }
  }
  return result.redirect ? reply.redirect(result.redirect) : reply.type('text/html; charset=utf-8').send(result.html);
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

  registerAdminRoutes(api);

  api.get('/api/me', async (req) => publicUser(req.user));

  api.patch('/api/settings', async (req) => {
    const b = req.body as Record<string, unknown>;
    const patch: Partial<UserSettings> = {};
    const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : undefined);
    if (b.eveningTime !== undefined) patch.eveningTime = time(b.eveningTime);
    if (b.studyTime !== undefined) patch.studyTime = time(b.studyTime);
    if (b.stepGoal !== undefined) patch.stepGoal = Math.max(0, Number(b.stepGoal) || 0);
    if (Array.isArray(b.books)) {
      patch.books = b.books.slice(0, 40).map((x: any) => ({
        subject: str(x.subject, 60).trim(), provider: (x.provider in PROVIDERS ? x.provider : 'digi4school') as BookProvider,
        url: str(x.url, 500).trim(), pageOffset: Number(x.pageOffset) || 0,
        pageUrlTemplate: str(x.pageUrlTemplate, 500) || undefined,
      })).filter((x) => x.subject && x.url.startsWith('https://'));
    }
    const permissions = { ...(req.user.settings.permissions ?? {}) };
    if (typeof b.homeworkAutopilot === 'boolean') {
      patch.homeworkAutopilot = b.homeworkAutopilot;
      permissions.homework = b.homeworkAutopilot ? 'auto' : 'never';
    }
    if (typeof b.mailAutoTrash === 'boolean') {
      patch.mailAutoTrash = b.mailAutoTrash;
      permissions.mail_sort = b.mailAutoTrash ? 'auto' : 'never';
    }
    if (b.permissions && typeof b.permissions === 'object') {
      for (const [g, level] of Object.entries(b.permissions as Record<string, unknown>)) {
        if (!isGroup(g) || !isLevel(level) || !GROUPS[g].levels.includes(level)) throw new HttpError(400, `Ungültiges Recht: ${g}`);
        permissions[g] = level;
      }
      // die alten Schalter mitziehen, damit ältere Apps dasselbe anzeigen
      if (permissions.homework) patch.homeworkAutopilot = permissions.homework !== 'never';
      if (permissions.mail_sort) patch.mailAutoTrash = permissions.mail_sort !== 'never';
    }
    if (Object.keys(permissions).length) patch.permissions = permissions;
    if (b.briefing !== undefined) {
      const v = str(b.briefing);
      if (v !== 'auto' && v !== 'off' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, 'Briefing: "auto", "off" oder HH:MM');
      patch.briefing = v;
    }
    if (b.weekPlan !== undefined) {
      if (b.weekPlan !== 'sunday' && b.weekPlan !== 'off') throw new HttpError(400, 'Wochenplan: "sunday" oder "off"');
      patch.weekPlan = b.weekPlan;
    }
    if (b.tone !== undefined) {
      if (!isTone(b.tone)) throw new HttpError(400, 'Ton muss nett, frech oder cool sein');
      patch.tone = b.tone;
    }
    let tz: string | undefined;
    if (b.timeZone) {
      try { new Intl.DateTimeFormat('de', { timeZone: str(b.timeZone) }); tz = str(b.timeZone); } catch { throw new HttpError(400, 'Unbekannte Zeitzone'); }
    }
    updateUserSettings(req.user.id, patch, tz);
    const user = getUser(req.user.id)!;
    // Erinnerungen tragen Uhrzeit und Ton in sich → neu erzeugen
    if (patch.eveningTime || patch.studyTime || (patch.tone && patch.tone !== req.user.settings.tone)) rescheduleAll(user);
    if (patch.tone && patch.tone !== req.user.settings.tone) addMessage(user.id, 'assistant', voice(patch.tone).toneChanged());
    return publicUser(user);
  });

  // Chat
  api.post('/api/chat', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const b = req.body as Record<string, unknown>;
    const text = str(b.text, 4000).trim();
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, 4).map((d) => {
      try { return saveDataUrl(String(d)); } catch { throw new HttpError(400, 'Bild konnte nicht gelesen werden'); }
    });
    if (!text && !images.length) throw new HttpError(400, 'Leere Nachricht');
    return handleChat(req.user, text, str(b.clientId, 100) || null, images);
  });

  api.get('/api/messages', async (req) => {
    const q = req.query as Record<string, string>;
    return recentMessages(req.user.id, Math.min(Number(q.limit) || 50, 200), q.before || undefined);
  });

  // Abgleich für alle Geräte: "gib mir alles, was sich seit X geändert hat"
  // Einträge, an denen Stella gerade im Hintergrund arbeitet (Buchseite holen, HÜ lösen)
  const busyItems = (userId: string) => (db.prepare(`SELECT DISTINCT json_extract(payload, '$.itemId') AS id FROM jobs
      WHERE user_id = ? AND status IN ('queued', 'running') AND type IN ('book_page', 'digi4school_page', 'solve_homework')`)
    .all(userId) as { id: string }[]).map((r) => r.id).filter(Boolean);

  api.get('/api/sync', async (req) => {
    const since = str((req.query as Record<string, string>).since);
    const serverTime = now();
    if (!since) {
      const today = todayIn(req.user.timeZone);
      const items = listItems(req.user.id, { from: addDays(today, -30), includeDone: true });
      return {
        items, messages: recentMessages(req.user.id, 80), serverTime, busyItems: busyItems(req.user.id),
        actions: listActions(req.user.id, { limit: 100 }),
      };
    }
    return {
      items: itemsChangedSince(req.user.id, since), messages: messagesSince(req.user.id, since), serverTime,
      busyItems: busyItems(req.user.id), actions: listActions(req.user.id, { since }),
    };
  });

  // Anstehende Erinnerungen – die iOS-App plant daraus lokale Mitteilungen
  api.get('/api/reminders/upcoming', async (req) => db.prepare(`SELECT r.id, r.item_id AS itemId, r.fire_at AS fireAt, r.message
      FROM reminders r LEFT JOIN items i ON i.id = r.item_id
      WHERE r.user_id = ? AND r.sent_at IS NULL AND r.fire_at > ? AND (i.id IS NULL OR (i.deleted = 0 AND (i.status = 'open' OR r.always = 1)))
      ORDER BY r.fire_at LIMIT 60`).all(req.user.id, now()));

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

  // Bilder (Buchseiten, Fotos, Lösungen) – nur für den Besitzer
  api.get('/api/files/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = req.params.id.replace(/[^a-f0-9-]/g, '');
    const owned = id.length >= 32 && db.prepare(`SELECT 1 FROM items WHERE user_id = ? AND attachments LIKE ?
      UNION SELECT 1 FROM messages WHERE user_id = ? AND attachments LIKE ?
      UNION SELECT 1 FROM notified WHERE user_id = ? AND key = ?`).get(req.user.id, `%${id}%`, req.user.id, `%${id}%`, req.user.id, `file:${id}`);
    const file = filePath(id);
    if (!owned || !file) throw new HttpError(404, 'Nicht gefunden');
    const type = FILE_TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream';
    return reply.type(type).header('Cache-Control', 'private, max-age=31536000, immutable').send(createReadStream(file));
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

  // ----- Schulbücher (digi4school, scook) -----
  const provider = (p: string): BookProvider => {
    if (!(p in PROVIDERS)) throw new HttpError(404, 'Unbekannter Anbieter');
    return p as BookProvider;
  };
  api.put('/api/integrations/books/:provider', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    const b = req.body as Record<string, unknown>;
    const p = provider(req.params.provider);
    let cookies: unknown[] | undefined;
    if (b.cookies) {
      try { cookies = typeof b.cookies === 'string' ? JSON.parse(b.cookies) : b.cookies as unknown[]; } catch { throw new HttpError(400, 'Cookies sind kein gültiges JSON'); }
      if (!Array.isArray(cookies) || !normalizeCookies(cookies).length) throw new HttpError(400, 'Keine gültigen Cookies gefunden');
    }
    if (!cookies && (!str(b.email) || !str(b.password))) throw new HttpError(400, 'E-Mail und Passwort (oder Cookies) nötig');
    saveBookCredentials(req.user.id, p, {
      ...(str(b.email) ? { email: str(b.email, 200), password: str(b.password, 200) } : {}),
      ...(cookies ? { cookies } : {}),
    });
    // aus dem Login-Fenster der Apps: gleich prüfen, ob die Anmeldung trägt, und das Regal mitschicken
    if (b.verify === true) {
      try {
        return { ok: true, shelf: await listShelf(req.user.id, p) };
      } catch (err) {
        throw new HttpError(400, `Anmeldung nicht erkannt – bitte im Fenster fertig einloggen und dann erst schließen. (${(err as Error).message})`);
      }
    }
    return { ok: true };
  });
  api.delete('/api/integrations/books/:provider', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    const p = provider(req.params.provider);
    deleteSecret(req.user.id, secretName(p));
    if (p === 'digi4school') deleteSecret(req.user.id, 'digi4school');
    return { ok: true };
  });
  // Wo die Apps das Login-Fenster öffnen und welche Cookies sie übernehmen
  api.get('/api/integrations/books/login-pages', async () =>
    Object.fromEntries(Object.entries(LOGIN_PAGES).map(([p, v]) => [p, { url: v.url, domains: v.domains.source }])));
  api.get('/api/integrations/books/:provider/shelf', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    try { return await listShelf(req.user.id, provider(req.params.provider)); } catch (err) { throw new HttpError(502, (err as Error).message); }
  });
  // Probe-Screenshot zum Kalibrieren (Seitenversatz)
  api.post('/api/integrations/books/preview', async (req) => {
    const b = req.body as Record<string, unknown>;
    const book = req.user.settings.books?.find((x) => x.subject === str(b.subject));
    if (!book) throw new HttpError(404, 'Kein Buch für dieses Fach');
    const printed = Number(b.page) || 1;
    try {
      const png = await screenshotPage(req.user.id, book.provider, book.url, printed + (book.pageOffset ?? 0), book.pageUrlTemplate);
      const id = saveFile(png, 'png');
      db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)').run(req.user.id, `file:${id}`, now());
      return { fileId: id };
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  });

  // ----- WebUntis -----
  api.put('/api/integrations/webuntis', async (req) => {
    const b = req.body as Record<string, unknown>;
    const creds: UntisCredentials = str(b.qr)
      ? { qr: str(b.qr, 1000) }
      : { server: str(b.server, 200), school: str(b.school, 200), username: str(b.username, 200), password: str(b.password, 200) };
    try { await testUntis(creds); } catch (err) { throw new HttpError(400, `WebUntis-Login fehlgeschlagen: ${(err as Error).message}`); }
    setSecret(req.user.id, 'webuntis', creds);
    void syncUntis(req.user.id).catch((err) => app.log.warn(err));
    return { ok: true };
  });
  api.delete('/api/integrations/webuntis', async (req) => {
    deleteSecret(req.user.id, 'webuntis');
    db.prepare('DELETE FROM lessons WHERE user_id = ?').run(req.user.id);
    return { ok: true };
  });
  api.post('/api/integrations/webuntis/sync', async (req) => {
    try { await syncUntis(req.user.id); } catch (err) { throw new HttpError(502, (err as Error).message); }
    return { ok: true };
  });
  api.get('/api/timetable', async (req) => {
    const q = req.query as Record<string, string>;
    const today = todayIn(req.user.timeZone);
    return lessonsFor(req.user.id, q.from || today, q.to || addDays(today, 6));
  });

  // ----- E-Mail -----
  api.get('/api/mail/accounts', async (req) => publicAccounts(req.user.id));
  api.post('/api/oauth/google/start', async (req) => {
    if (!googleConfigured()) throw new HttpError(400, 'Google-Anmeldung ist auf dem Server noch nicht eingerichtet – siehe docs/google-oauth.md.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const client = (['web', 'desktop', 'ios'].includes(str(b.client)) ? str(b.client) : 'web') as OAuthClient;
    return { url: googleAuthUrl(req.user.id, client, str(b.email, 200) || undefined) };
  });
  api.post('/api/mail/accounts', async (req) => {
    const b = req.body as Record<string, unknown>;
    const prov = (['gmail', 'icloud', 'other'].includes(str(b.provider)) ? str(b.provider) : 'other') as MailAccount['provider'];
    const preset = prov === 'other' ? null : PRESETS[prov];
    const account: MailAccount = {
      id: newId(), provider: prov, label: str(b.label, 60) || str(b.user, 200),
      host: preset?.host ?? str(b.host, 200), port: preset?.port ?? (Number(b.port) || 993),
      user: str(b.user, 200).trim(), pass: str(b.pass, 200).replace(/\s+/g, ''),
    };
    if (!account.host || !account.user || !account.pass) throw new HttpError(400, 'Adresse und App-Passwort nötig');
    try { await testAccount(account); } catch (err) { throw new HttpError(400, `Anmeldung fehlgeschlagen: ${(err as Error).message}`); }
    saveAccounts(req.user.id, [...listAccounts(req.user.id), account]);
    void checkAllMail(req.user.id).catch(() => {});
    return publicAccounts(req.user.id);
  });
  api.delete('/api/mail/accounts/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    saveAccounts(req.user.id, listAccounts(req.user.id).filter((a) => a.id !== req.params.id));
    db.prepare('DELETE FROM mail_state WHERE user_id = ? AND account_id = ?').run(req.user.id, req.params.id);
    return publicAccounts(req.user.id);
  });
  api.post('/api/mail/check', async (req) => {
    await checkAllMail(req.user.id);
    return publicAccounts(req.user.id);
  });

  // ----- Inbox: E-Mails, Social Media, SMS -----
  api.get('/api/inbox', async (req) => {
    const q = req.query as Record<string, string>;
    const where = ['user_id = ?'];
    const args: unknown[] = [req.user.id];
    if (q.source) { where.push('source = ?'); args.push(q.source); }
    if (q.before) { where.push('created_at < ?'); args.push(q.before); }
    const rows = db.prepare(`SELECT id, source, sender, text, payload, created_at FROM inbox_events WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(Number(q.limit) || 100, 300)) as
      { id: string; source: string; sender: string | null; text: string | null; payload: string; created_at: string }[];
    return rows.map((r) => {
      const p = JSON.parse(r.payload) as Record<string, unknown>;
      return {
        id: r.id, source: r.source, sender: r.sender, text: r.text, createdAt: r.created_at,
        summary: p.summary ?? null, category: p.category ?? null, action: p.action ?? null,
        account: p.account ?? null, platform: p.platform ?? null,
        reason: p.reason ?? null, deadline: p.deadline ?? null, needsReply: !!p.needsReply, handled: !!p.handled,
        replied: p.replied ?? null, draft: p.draft ?? null, deadlineActionId: p.deadlineActionId ?? null,
      };
    });
  });
  // Antwort entwerfen (KI), bearbeiten, senden – Senden ist immer ein ausdrücklicher Klick
  api.post('/api/inbox/:id/draft', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const memories = listMemories(req.user.id).filter((m) => m.category === 'person').map((m) => `- ${m.text}`).join('\n');
      return await draftReply(req.user, req.params.id, str(b.instruction, 500), memories);
    } catch (err) {
      throw new HttpError(err instanceof LlmUnavailable ? 503 : 400, (err as Error).message);
    }
  });
  api.post('/api/inbox/:id/send', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = req.body as Record<string, unknown>;
    const ev = getMailEvent(req.user.id, req.params.id);
    if (!ev) throw new HttpError(404, 'Mail nicht gefunden');
    const body = str(b.body, 20_000).trim();
    if (!body) throw new HttpError(400, 'Kein Text');
    const r = perform(req.user, 'mail.send', {
      accountId: ev.payload.accountId, to: str(b.to, 300) || ev.payload.fromAddress, subject: str(b.subject, 300) || `Re: ${ev.text ?? ''}`,
      body, inReplyTo: ev.payload.messageId ?? null, eventId: ev.id,
    }, { source: 'chat', quiet: true });
    if (r.status === 'refused') throw new HttpError(403, r.reason);
    // der Klick auf „Senden“ nach dem Lesen des Textes ist die Zustimmung
    const action = r.status === 'proposed' ? approve(req.user.id, r.actionId).entry : null;
    return { ok: true, action };
  });
  // Volltext einer Mail (bei Bedarf per IMAP geholt, 30 Tage zwischengespeichert)
  api.get('/api/inbox/:id/body', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const ev = getMailEvent(req.user.id, req.params.id);
    if (!ev) throw new HttpError(404, 'Mail nicht gefunden');
    try {
      return await getMailBody(req.user.id, req.params.id);
    } catch (err) {
      // Postfach gerade nicht erreichbar: wenigstens den gespeicherten Auszug zeigen
      if (typeof ev.payload.snippet === 'string' && ev.payload.snippet) return { body: ev.payload.snippet, truncated: true, cached: false, partial: true };
      throw new HttpError(502, `Ich komme gerade nicht an die Mail ran (${(err as Error).message}).`);
    }
  });
  // Von Hand einsortieren: important | normal | newsletter | spam – Stella merkt sich den Absender
  api.post('/api/inbox/:id/category', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isMailCategory(b.category)) throw new HttpError(400, 'Unbekannte Kategorie');
    try { return { ok: true, ...(await moveMail(req.user.id, req.params.id, b.category)) }; } catch (err) { throw new HttpError(404, (err as Error).message); }
  });
  api.post('/api/inbox/:id/handled', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!setEventField(req.user.id, req.params.id, { handled: b.handled === false ? 0 : 1 })) throw new HttpError(404, 'Nicht gefunden');
    return { ok: true };
  });
  api.post('/api/inbox/:id/deadline', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const ev = getMailEvent(req.user.id, req.params.id);
    const d = ev?.payload.deadline as { date: string; time: string | null; what: string } | null | undefined;
    if (!ev || !d) throw new HttpError(404, 'Keine Frist in dieser Mail');
    const r = perform(req.user, 'item.create', {
      kind: d.time ? 'event' : 'todo', title: d.what, due: d.date, time: d.time, detail: `aus der Mail von ${ev.sender}`, source: 'mail',
    }, { source: 'chat', quiet: true });
    if (r.status === 'refused') throw new HttpError(403, r.reason);
    setEventField(req.user.id, ev.id, { deadlineActionId: r.actionId });
    return { ok: true, items: r.changed };
  });
  api.post('/api/inbox/:id/restore', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    try { await restoreMail(req.user.id, req.params.id); } catch (err) { throw new HttpError(400, (err as Error).message); }
    return { ok: true };
  });

  // ----- FreeNotes (iPad-Heft): gelöste HÜs abholen -----
  api.get('/api/notes/inbox', async (req) => notesInbox(req.user.id));
  api.post('/api/notes/inbox/:id/ack', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!ackNotesEntry(req.user.id, req.params.id, str(b.notebook, 200) || null, Number.isFinite(Number(b.page)) ? Number(b.page) : null)) {
      throw new HttpError(404, 'Nicht gefunden');
    }
    return { ok: true };
  });

  // ----- Handschrift -----
  api.put('/api/handwriting/font', async (req) => {
    const ext = str(req.headers['x-filename']).split('.').pop()?.toLowerCase() ?? '';
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Keine Datei');
    try { saveUserFont(req.user.id, req.body, ext); } catch (err) { throw new HttpError(400, (err as Error).message); }
    return { ok: true };
  });
  api.delete('/api/handwriting/font', async (req) => {
    deleteUserFont(req.user.id);
    return { ok: true };
  });
  api.post('/api/handwriting/preview', async (req) => {
    const png = await renderHandwriting(req.user.id, {
      date: 'Fr, 30.10.',
      text: '__S. 45 Nr. 16__\n\n1) Oui, elle y va en avion.\n2) Non, je ne m\'y intéresse pas.\n3) 3 · 4 + 2 = ==14==\nÄpfel, Übung, Größe',
    });
    const id = saveFile(png, 'png');
    db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)').run(req.user.id, `file:${id}`, now());
    return { fileId: id };
  });

  api.get('/api/ai/status', async () => modelStatus());

  // ----- Morning Briefing & Hinweise -----
  api.get('/api/briefing', async (req) => buildBriefing(req.user));

  // ----- Plan my week: Vorschlag ansehen, Blöcke abwählen, übernehmen -----
  api.get('/api/weekplan', async (req) => {
    const q = req.query as Record<string, string>;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '') ? q.from : undefined;
    return planWeek(req.user, { from });
  });
  api.post('/api/weekplan/apply', async (req) => {
    const blocks = cleanBlocks(req.user.id, (req.body as Record<string, unknown> | undefined)?.blocks);
    if (!blocks.length) throw new HttpError(400, 'Keine Blöcke ausgewählt');
    const r = perform(req.user, 'week_plan.apply', { blocks }, { source: 'chat', quiet: true });
    if (r.status === 'refused') throw new HttpError(403, r.reason);
    return { ok: true, actionId: r.actionId, items: r.changed };
  });
  api.post('/api/hints/:key/accept', async (req: FastifyRequest<{ Params: { key: string } }>) => {
    try {
      const r = acceptHint(req.user, req.params.key);
      return { status: r.status, items: r.changed };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });
  api.post('/api/hints/:key/dismiss', async (req: FastifyRequest<{ Params: { key: string } }>) => {
    dismissHint(req.user.id, req.params.key);
    return { ok: true };
  });

  // ----- Was Stella selbst darf -----
  api.get('/api/permissions', async (req) => Object.entries(GROUPS).map(([group, g]) => ({
    group, label: g.label, help: g.help, levels: g.levels, default: g.default, level: levelFor(req.user, group as keyof typeof GROUPS),
  })));

  // ----- Protokoll, Vorschläge, Rückgängig -----
  api.get('/api/actions', async (req) => listActions(req.user.id, { limit: Math.min(Number((req.query as Record<string, string>).limit) || 100, 300) }));
  const decide = (fn: (userId: string, id: string) => unknown) => async (req: FastifyRequest<{ Params: { id: string } }>) => {
    try {
      const out = fn(req.user.id, req.params.id) as { entry?: unknown; changed?: Item[] } | object;
      return 'entry' in out ? { action: out.entry, items: (out as { changed: Item[] }).changed } : { action: out, items: [] };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  };
  api.post('/api/actions/:id/approve', decide(approve));
  api.post('/api/actions/:id/reject', decide(reject));
  api.post('/api/actions/:id/undo', decide(undo));

  // ----- Was Stella über dich weiß -----
  api.get('/api/memories', async (req) => ({ categories: MEMORY_CATEGORIES, memories: listMemories(req.user.id) }));
  api.post('/api/memories', async (req) => {
    const b = req.body as Record<string, unknown>;
    if (!str(b.text).trim()) throw new HttpError(400, 'Text fehlt');
    return addMemory(req.user.id, {
      category: isCategory(b.category) ? b.category : 'other', text: str(b.text, 300), source: 'user', schedule: cleanSchedule(b.schedule),
    }).memory;
  });
  api.patch('/api/memories/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = req.body as Record<string, unknown>;
    const m = updateMemory(req.user.id, req.params.id, {
      ...(b.text !== undefined ? { text: str(b.text, 300) } : {}),
      ...(isCategory(b.category) ? { category: b.category } : {}),
      ...(b.schedule !== undefined ? { schedule: cleanSchedule(b.schedule) } : {}),
    });
    if (!m) throw new HttpError(404, 'Nicht gefunden');
    return m;
  });
  api.delete('/api/memories/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!deleteMemory(req.user.id, req.params.id)) throw new HttpError(404, 'Nicht gefunden');
    return { ok: true };
  });
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
