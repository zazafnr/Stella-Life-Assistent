import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import { addDays, isCountry, isLocale, isLocationPermission, isTone, todayIn, voice, type Item } from '@stella/shared';
import { userLocale } from './locale.ts';
import type { ActionGroup } from '@stella/shared';
import { pluginIcal, pluginIntegrations, pluginRoutes, pluginSettings, pluginOnboarding, editions, requestEdition } from './editions/registry.ts';
import { loadEditions } from './editions/load.ts';
import { registerWebApps } from './webapps.ts';
import { editionUrl } from './editions/access.ts';
import { registerUndoRoutes } from './email/undo.ts';
import { currentPlanId, maxMailboxes, registerBillingRoutes, registerBillingWebhook } from './billing.ts';
import { tr } from './locale.ts';
import { registerLoginApi, registerLoginRoutes, registerPasswordRoute, setPublicUser } from './loginlink.ts';
import { config } from './config.ts';
import {
  deleteSecret, hasSecret, HttpError, login, logout, register, requireUser, setSecret, userByIngestToken, userCount,
} from './auth.ts';
import {
  addMessage, conversationMessages, conversationMessagesSince, db, getConversation, getUser, itemsChangedSince, listItems, newId, now, recentMessages, updateUserSettings,
  type User, type UserSettings,
} from './db.ts';
import { handleChat } from './assistant.ts';
import { addItem, changeItem, rescheduleAll } from './planner.ts';
import { modelStatus } from './llm.ts';
import { pushToUser, saveSubscription, vapidPublicKey } from './push.ts';
import { startScheduler } from './scheduler.ts';
import { toICalendar } from './ical.ts';
import { checkAllMail, draftReply, getMailBody, getMailEvent, isMailCategory, listAccounts, moveMail, PRESETS, publicAccounts, restoreMail, saveAccounts, setEventField, testAccount, type MailAccount } from './mail.ts';
import { FILE_TYPES, filePath, saveDataUrl, saveFile } from './files.ts';
import type { BookProvider } from './db.ts';
import { finishGoogle, finishGoogleLink, finishTarget, googleAuthUrl, googleConfigured, readState, type OAuthClient } from './oauth.ts';
import { allGroups, approve, groupDef, isGroup, isLevel, levelFor, listActions, perform, reject, undo } from './actions.ts';
import { LlmUnavailable } from './llm.ts';
import { buildBriefing } from './briefing.ts';
import { registerWeatherRoutes, warmWeather } from './weather.ts';
import { registerNewsRoutes } from './news/routes.ts';
import { registerErrandRoutes } from './errands/routes.ts';
import { registerScreenTimeRoutes } from './screentime.ts';
import { buildDigest } from './news/digest.ts';
import { registerTelegramRoutes, registerTelegramWebhook, telegramConfigured } from './channels/telegram.ts';
import { cleanBlocks, planWeek } from './weekplan.ts';
import { acceptHint, dismissHint } from './hints.ts';
import { registerAdminRoutes } from './admin.ts';
import { linkVerifiedAddress, registerAddressRoutes, registerInboundRoute } from './inbound.ts';
import { registerOverviewRoutes } from './overview.ts';
import { registerWebAnalyticsRoutes } from './webanalytics.ts';
import { registerCalendarRoutes } from './calendar.ts';
import { registerFinanceRoutes, recordPayment } from './finance.ts';
import { registerGoalRoutes } from './goals.ts';
import { registerStellaPlanRoutes } from './stellaplan.ts';
import { registerListRoutes } from './lists.ts';
import { registerPlaceRoutes } from './places.ts';
import { registerQuickRoutes } from './quick.ts';
import { registerProfileRoutes, registerSignupRoutes, registrationMode } from './signup.ts';
import { registerAudioRoutes } from './audio.ts';
import { currentConversation, listConversations, registerConversationRoutes } from './conversations.ts';
import { addMemory, cleanSchedule, deleteMemory, isCategory, listMemories, MEMORY_CATEGORIES, updateMemory } from './memory.ts';

// trustProxy nur für Caddy auf derselben Maschine – sonst ließe sich die Absender-Adresse fälschen
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024, trustProxy: '127.0.0.1', maxParamLength: 1000 });
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ ...err.extra, error: err.message });
  if ((err as { statusCode?: number }).statusCode === 413) return reply.code(413).send({ error: 'Das ist zu groß (Sprachnachrichten: höchstens 2 Minuten bzw. 10 MB).' });
  app.log.error(err);
  return reply.code(500).send({ error: 'Interner Fehler' });
});

// Edition-Plugins laden, bevor Routen und Scheduler gebaut werden
await loadEditions();

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Das Profil ohne serverseitig abgeschaltete Funktionen – so blenden alle Oberflächen sie ohne eigenen Code aus. */
function visibleSettings(settings: User['settings']): User['settings'] {
  const p = settings.profile;
  if (!p || config.features.finance) return settings;
  return { ...settings, profile: { ...p, features: p.features.filter((f) => f !== 'finance') } };
}

function publicUser(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, timeZone: user.timeZone, settings: visibleSettings(user.settings), role: user.role, edition: user.edition, editionUrl: editionUrl(user.edition),
    /** Serverweite Funktions-Schalter für die Oberflächen (z. B. Einführung ohne „Ausgaben“) */
    flags: { finance: config.features.finance, freenotesUrl: config.freenotesUrl || null, telegram: telegramConfigured(), studentsUrl: config.studentsUrl },
    ingestUrl: `${config.publicUrl}/api/ingest/${user.ingestToken}`,
    integrations: {
      ...pluginIntegrations(user),
      mailAccounts: listAccounts(user.id).length,
      /** Server kann "Mit Google anmelden" (GOOGLE_CLIENT_ID gesetzt) */
      googleSignIn: googleConfigured(),
    },
  };
}

// ---------- öffentlich ----------

app.get('/api/status', async () => ({
  ok: true, hasUsers: userCount() > 0, registration: registrationMode(), registrationOpen: userCount() === 0 || registrationMode() !== 'closed',
}));

registerSignupRoutes(app, publicUser);
registerInboundRoute(app);
registerUndoRoutes(app);
registerBillingWebhook(app);
registerTelegramWebhook(app);
registerLoginRoutes(app);
registerLoginApi(app);
setPublicUser(publicUser);

// Das Firmen-Dashboard liegt auf eigener Adresse (Cloudflare) und liest nur Admin- und Login-Routen.
const DASHBOARD_ORIGINS = (process.env.STELLA_DASHBOARD_ORIGINS ?? 'https://dashboard.evolsior.com').split(',').map((s) => s.trim()).filter(Boolean);
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (!origin || !DASHBOARD_ORIGINS.includes(origin) || !(req.url.startsWith('/api/admin/') || req.url === '/api/auth/login')) return;
  reply.header('access-control-allow-origin', origin).header('vary', 'origin')
    .header('access-control-allow-headers', 'authorization, content-type').header('access-control-allow-methods', 'GET, POST, OPTIONS').header('access-control-max-age', '600');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

app.post('/api/auth/login', async (req) => {
  const b = req.body as Record<string, unknown>;
  const { token, user } = login(str(b.email, 200), str(b.password, 200), str(b.device, 80), req.ip, requestEdition(req));
  return { token, user: publicUser(user) };
});

// Rückkehr von Google nach "Mit Google anmelden" – der signierte state sagt, wer es war
app.get('/api/oauth/google/callback', async (req, reply) => {
  const q = req.query as Record<string, string>;
  const state = readState(str(q.state));
  if (!state) return reply.code(400).type('text/html; charset=utf-8').send(finishTarget('desktop', false, 'Der Link ist abgelaufen. Bitte in Stella nochmal auf „Mit Google anmelden“ tippen.').html);
  let result: ReturnType<typeof finishTarget>;
  if (q.error || !q.code) {
    result = finishTarget(state.c, false, q.error === 'access_denied' ? 'Du hast die Anmeldung abgebrochen.' : `Google meldet: ${str(q.error, 100) || 'kein Code'}`, state.p === 'link' ? 'link' : 'gmail');
  } else if (state.p === 'link') {
    // nur Adresse bestätigen: Stella antwortet danach auch Mails von dieser Adresse
    try {
      const user = getUser(state.u);
      if (!user) throw new Error('Konto nicht gefunden');
      const email = await finishGoogleLink(str(q.code, 2000));
      linkVerifiedAddress(user, email);
      result = finishTarget(state.c, true, `${email} ist verknüpft – du kannst Stella jetzt von dieser Adresse schreiben.`, 'link');
    } catch (err) {
      result = finishTarget(state.c, false, (err as Error).message, 'link');
    }
  } else {
    try {
      const account = await finishGoogle(state.u, str(q.code, 2000));
      // ein per Google verbundenes Postfach ist als Adresse schon bestätigt
      try { const u = getUser(state.u); if (u) linkVerifiedAddress(u, account.user); } catch { /* gehört schon zu einem Konto oder Limit: egal */ }
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
    return reply.type('text/calendar; charset=utf-8').send(toICalendar(items, req.user.timeZone, pluginIcal(req.user)));
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

  // Apple-Kurzbefehl-Automation „Transaktion“ (Wallet): jede Kartenzahlung → Ausgaben
  ingest.post('/api/ingest/:token/payment', async (req) => recordPayment(req.user, req.body));

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
  pluginRoutes(api);
  registerOverviewRoutes(api);
  registerWebAnalyticsRoutes(api);
  registerCalendarRoutes(api);
  registerAddressRoutes(api);
  registerListRoutes(api);
  registerGoalRoutes(api);
  registerFinanceRoutes(api);
  registerStellaPlanRoutes(api);
  registerPlaceRoutes(api);
  registerQuickRoutes(api);
  registerProfileRoutes(api, publicUser);
  registerPasswordRoute(api);
  registerBillingRoutes(api);
  registerAudioRoutes(api);

  api.get('/api/me', async (req) => publicUser(req.user));

  // Welche Edition-Plugins laufen und was sie an Einstellungen/Einführung beisteuern (die Web-App rendert es)
  api.get('/api/edition', async (req) => ({
    edition: req.user.edition,
    plugins: editions().map((p) => p.id),
    settings: pluginSettings(req.user),
    onboarding: pluginOnboarding(),
  }));

  api.patch('/api/settings', async (req) => {
    const b = req.body as Record<string, unknown>;
    const patch: Partial<UserSettings> = {};
    const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : undefined);
    if (b.eveningTime !== undefined) patch.eveningTime = time(b.eveningTime);
    if (b.studyTime !== undefined) patch.studyTime = time(b.studyTime);
    if (b.stepGoal !== undefined) patch.stepGoal = Math.max(0, Number(b.stepGoal) || 0);
    if (Array.isArray(b.books)) {
      patch.books = b.books.slice(0, 40).map((x: any) => ({
        subject: str(x.subject, 60).trim(), provider: (x.provider === 'scook' ? 'scook' : 'digi4school') as BookProvider,
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
        if (!isGroup(g) || !isLevel(level) || !groupDef(g)!.levels.includes(level)) throw new HttpError(400, `Ungültiges Recht: ${g}`);
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
    if (b.locale !== undefined) {
      if (!isLocale(b.locale)) throw new HttpError(400, 'Unknown language.');
      patch.locale = b.locale;
    }
    if (b.country !== undefined) {
      if (!isCountry(b.country)) throw new HttpError(400, 'Unknown country.');
      patch.country = b.country;
    }
    if (b.notifyVia !== undefined) {
      const via = Array.isArray(b.notifyVia) ? [...new Set(b.notifyVia.filter((v): v is 'push' | 'telegram' => v === 'push' || v === 'telegram'))] : [];
      if (!via.length) throw new HttpError(400, 'notifyVia: push und/oder telegram.');
      patch.notifyVia = via;
    }
    if (b.locationPermission !== undefined) {
      if (!isLocationPermission(b.locationPermission)) throw new HttpError(400, 'Unknown location state.');
      patch.locationPermission = b.locationPermission;
    }
    if (typeof b.notifyFreenotes === 'boolean') patch.notify = { ...(req.user.settings.notify ?? {}), freenotes: b.notifyFreenotes };
    if (b.weekPlan !== undefined) {
      if (b.weekPlan !== 'sunday' && b.weekPlan !== 'off') throw new HttpError(400, 'Wochenplan: "sunday" oder "off"');
      patch.weekPlan = b.weekPlan;
    }
    if (b.tone !== undefined) {
      if (!isTone(b.tone)) throw new HttpError(400, 'Ton muss nett, frech oder cool sein');
      patch.tone = b.tone;
    }
    if (b.name !== undefined) {
      const name = str(b.name, 80).trim();
      if (!name) throw new HttpError(400, 'Der Name darf nicht leer sein.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    }
    let tz: string | undefined;
    if (b.timeZone) {
      try { new Intl.DateTimeFormat('de', { timeZone: str(b.timeZone) }); tz = str(b.timeZone); } catch { throw new HttpError(400, 'Unbekannte Zeitzone'); }
    }
    updateUserSettings(req.user.id, patch, tz);
    const user = getUser(req.user.id)!;
    // Erinnerungen tragen Uhrzeit und Ton in sich → neu erzeugen
    if (patch.eveningTime || patch.studyTime || (patch.tone && patch.tone !== req.user.settings.tone)) rescheduleAll(user);
    if (patch.tone && patch.tone !== req.user.settings.tone) addMessage(user.id, 'assistant', voice(patch.tone, patch.locale ?? userLocale(req.user)).toneChanged());
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
    return handleChat(req.user, text, str(b.clientId, 100) || null, images, str(b.conversationId, 100) || null);
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

  registerConversationRoutes(api);

  // `conversation`: welchen Chat das Gerät gerade hält (sonst der neueste von heute). `current` ist immer der neueste von heute.
  api.get('/api/sync', async (req) => {
    const q = req.query as Record<string, string>;
    const since = str(q.since);
    const serverTime = now();
    const current = currentConversation(req.user.id);
    const conversationId = (q.conversation && getConversation(req.user.id, q.conversation)?.id) || current;
    const messages = !conversationId ? [] : since ? conversationMessagesSince(req.user.id, conversationId, since) : conversationMessages(req.user.id, conversationId, 80);
    const common = { messages, serverTime, busyItems: busyItems(req.user.id), conversationId, current, conversations: listConversations(req.user) };
    if (!since) {
      const today = todayIn(req.user.timeZone);
      return { items: listItems(req.user.id, { from: addDays(today, -30), includeDone: true }), ...common, actions: listActions(req.user.id, { limit: 100 }) };
    }
    return { items: itemsChangedSince(req.user.id, since), ...common, actions: listActions(req.user.id, { since }) };
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
      duration: Number.isFinite(Number(b.duration)) && Number(b.duration) > 0 ? Math.min(Math.round(Number(b.duration)), 24 * 60) : null,
      location: b.location ? str(b.location, 200) : null,
    });
  });

  api.patch('/api/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = req.body as Partial<Item>;
    const allowed: (keyof Item)[] = ['title', 'detail', 'notes', 'due', 'time', 'status', 'material', 'subject', 'kind', 'duration', 'location'];
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
    const allowed = maxMailboxes(req.user);
    if (listAccounts(req.user.id).length >= allowed) {
      const planName = currentPlanId(req.user);
      throw new HttpError(402, tr(req.user, 'paywall.mailboxes', { plan: planName.charAt(0).toUpperCase() + planName.slice(1), count: allowed }), { upgrade: true });
    }
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

  // Kosten aller Nutzer sieht nur der Owner
  api.get('/api/ai/status', async (req) => {
    const { cost, ...status } = await modelStatus();
    return req.user.role === 'owner' ? { ...status, cost } : status;
  });

  // ----- Morning Briefing & Hinweise -----
  api.get('/api/briefing', async (req) => { await warmWeather(req.user); await buildDigest(req.user).catch(() => []); return buildBriefing(req.user); });
  registerWeatherRoutes(api);
  registerTelegramRoutes(api);
  registerNewsRoutes(api);
  registerErrandRoutes(api);
  registerScreenTimeRoutes(api);

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
  api.get('/api/permissions', async (req) => Object.entries(allGroups()).map(([group, g]) => ({
    group, label: g.label, help: g.help, levels: g.levels, default: g.default, level: levelFor(req.user, group as ActionGroup),
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

await registerWebApps(app, { life: config.webDist, students: config.studentsWebDist });

startScheduler();
await app.listen({ port: config.port, host: config.host });
