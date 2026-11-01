// Telegram: mit Stella schreiben wie im App-Chat (Text, Sprachnachrichten, Fotos, Vorschläge mit Ja/Nein, Rückgängig),
// und Stella meldet sich dort von selbst (Briefing, Erinnerungen, Hinweise), wenn man das möchte.
//
// Ablauf: Owner trägt den Bot-Token unter Einstellungen → Server ein → wir setzen den Webhook (mit geheimem Token im Header).
// Person tippt in der App „Mit Telegram verbinden“ → Einmal-Link t.me/<Bot>?start=<token> → /start <token> verknüpft den Chat.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { matchLocale, type ChatMessage, type ChatResponse } from '@stella/shared';
import { config } from '../config.ts';
import { db, getUser, now, type User } from '../db.ts';
import { saveFile } from '../files.ts';
import { approve, getAction, reject, undo } from '../actions.ts';
import { HttpError } from '../auth.ts';
import { AudioFailed, handleAudio } from '../audio.ts';
import { handleChat } from '../assistant.ts';
import { briefingText } from '../briefing.ts';
import { recordKeyResult, saveTelegramUsername, telegramKey } from '../keys.ts';
import { tr } from '../locale.ts';
import { defaultNews, saveNews } from '../news/digest.ts';
import type { Channel, OutboundMessage } from './channel.ts';
import { markdownToTelegramHtml, splitForTelegram } from './telegramHtml.ts';

export const TOKEN_TTL_MS = 10 * 60_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Unbekannte Chats bekommen höchstens so viele Erklärungen pro Stunde */
const UNKNOWN_LIMIT = 3;

export const telegramConfigured = () => !!telegramKey();
export const botUsername = () => telegramKey()?.username ?? null;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Telegram-API ----------

interface TgResult<T> { ok: boolean; result?: T; description?: string; error_code?: number }

async function tg<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const key = telegramKey();
  if (!key) throw new Error('Telegram ist nicht eingerichtet.');
  const res = await fetch(`${config.telegram.baseUrl}/bot${key.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as TgResult<T>;
  if (!res.ok || !body.ok) throw new Error(body.description ?? `Telegram: Fehler ${res.status}`);
  return body.result as T;
}

/** Webhook setzen (nach dem Speichern des Tokens) und den Benutzernamen des Bots merken */
export async function registerWebhook(): Promise<{ ok: boolean; message: string }> {
  const key = telegramKey();
  if (!key) return { ok: false, message: 'Telegram ist noch nicht eingetragen.' };
  try {
    const me = await tg<{ username?: string }>('getMe');
    if (me.username) saveTelegramUsername(me.username);
    const url = `${config.publicUrl}/api/channels/telegram/webhook`;
    await tg('setWebhook', { url, secret_token: key.secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    recordKeyResult('telegram', true, undefined, true);
    return { ok: true, message: `Der Bot @${me.username ?? '?'} ist verbunden (${url}).` };
  } catch (err) {
    recordKeyResult('telegram', false, (err as Error).message, true);
    return { ok: false, message: (err as Error).message };
  }
}

/** Beim Entfernen des Tokens: Webhook abmelden (Fehler egal) */
export async function unregisterWebhook() {
  try { await tg('deleteWebhook'); } catch { /* Token war ohnehin ungültig */ }
}

// ---------- Verknüpfung ----------

export const chatOf = (userId: string): string | null =>
  (db.prepare(`SELECT external_id AS id FROM channel_links WHERE user_id = ? AND channel = 'telegram'`).get(userId) as { id: string } | undefined)?.id ?? null;

export function userByChat(chatId: string): User | null {
  const r = db.prepare(`SELECT user_id AS id FROM channel_links WHERE channel = 'telegram' AND external_id = ?`).get(chatId) as { id: string } | undefined;
  return r ? getUser(r.id) : null;
}

/** Einmal-Token (10 Minuten) und der Link, der Telegram mit /start <token> öffnet */
export function createLinkToken(userId: string): { token: string; url: string | null; expiresAt: string } {
  const token = randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare(`DELETE FROM channel_tokens WHERE user_id = ? AND channel = 'telegram'`).run(userId);
  db.prepare(`INSERT INTO channel_tokens (hash, user_id, channel, expires_at) VALUES (?, ?, 'telegram', ?)`).run(sha(token), userId, expiresAt);
  const name = botUsername();
  return { token, url: name ? `https://t.me/${name}?start=${token}` : null, expiresAt };
}

function consumeToken(token: string): string | null {
  const row = db.prepare(`SELECT user_id, expires_at FROM channel_tokens WHERE hash = ? AND channel = 'telegram'`).get(sha(token)) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM channel_tokens WHERE hash = ?').run(sha(token));
  return Date.parse(row.expires_at) > Date.now() ? row.user_id : null;
}

function link(userId: string, chatId: string) {
  db.transaction(() => {
    db.prepare(`DELETE FROM channel_links WHERE channel = 'telegram' AND (user_id = ? OR external_id = ?)`).run(userId, chatId);
    db.prepare(`INSERT INTO channel_links (user_id, channel, external_id, created_at) VALUES (?, 'telegram', ?, ?)`).run(userId, chatId, now());
  })();
}

export function unlink(userId: string) {
  db.prepare(`DELETE FROM channel_links WHERE user_id = ? AND channel = 'telegram'`).run(userId);
  // Wer nur Telegram wollte, bekommt wieder Push
  const u = getUser(userId);
  const via = u?.settings.notifyVia;
  if (u && via?.includes('telegram')) {
    const rest = via.filter((v) => v !== 'telegram');
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify({ ...u.settings, notifyVia: rest.length ? rest : ['push'] }), userId);
  }
}

// ---------- Senden (höchstens eine Nachricht pro Sekunde und Chat) ----------

const queues = new Map<string, Promise<unknown>>();
const lastSent = new Map<string, number>();

function throttled<T>(chat: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(chat) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const wait = (lastSent.get(chat) ?? 0) + config.telegram.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { lastSent.set(chat, Date.now()); }
  });
  queues.set(chat, run);
  return run;
}

export async function sendTo(chatId: string, msg: OutboundMessage): Promise<void> {
  const chunks = splitForTelegram(markdownToTelegramHtml(msg.text));
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    const base = {
      chat_id: chatId, text: chunks[i]!, disable_web_page_preview: true,
      ...(last && msg.buttons?.length ? { reply_markup: { inline_keyboard: [msg.buttons.map((b) => ({ text: b.label, callback_data: b.action }))] } } : {}),
    };
    await throttled(chatId, async () => {
      try { await tg('sendMessage', { ...base, parse_mode: 'HTML' }); }
      catch (err) {
        // Telegram versteht das HTML nicht → als einfacher Text, damit nichts verloren geht
        if (/parse entities/i.test((err as Error).message)) await tg('sendMessage', { ...base, text: msg.text });
        else throw err;
      }
    });
  }
}

/** Eine Chat-Nachricht von Stella → Telegram-Nachricht (Vorschläge mit Ja/Nein, Erledigtes mit „Rückgängig“) */
export function toOutbound(user: User, m: ChatMessage): OutboundMessage {
  let text = m.text;
  const buttons: OutboundMessage['buttons'] = [];
  if (m.actionId) {
    const a = getAction(user.id, m.actionId);
    if (a?.status === 'proposed') buttons.push({ label: tr(user, 'telegram.yes'), action: `a:${a.id}` }, { label: tr(user, 'telegram.no'), action: `r:${a.id}` });
    else if (a?.canUndo) buttons.push({ label: tr(user, 'telegram.undo'), action: `u:${a.id}` });
  }
  if (m.card?.type === 'places') text += `\n\n${tr(user, 'telegram.places', { link: config.publicUrl })}`;
  return { text, ...(buttons.length ? { buttons } : {}) };
}

export const telegramChannel: Channel = {
  id: 'telegram',
  configured: telegramConfigured,
  async send(userId, message) {
    const chat = chatOf(userId);
    if (!chat || !telegramConfigured()) return false;
    await sendTo(chat, message);
    return true;
  },
};

async function reply(user: User, res: Pick<ChatResponse, 'messages'>) {
  const chat = chatOf(user.id);
  if (!chat) return;
  for (const m of res.messages) await sendTo(chat, toOutbound(user, m));
}

// ---------- Eingehend ----------

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number; chat: { id: number; type: string }; from?: { language_code?: string }; text?: string; caption?: string;
    voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
    photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

async function download(fileId: string): Promise<Buffer> {
  const key = telegramKey()!;
  const f = await tg<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
  if (!f.file_path || (f.file_size ?? 0) > MAX_FILE_BYTES) throw new Error('Datei nicht abrufbar oder zu groß.');
  const res = await fetch(`${config.telegram.baseUrl}/file/bot${key.token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Telegram-Datei: Fehler ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error('Datei zu groß.');
  return buf;
}

/** Für Chats ohne Konto: die Sprache, die Telegram meldet (sonst Englisch) */
const anon = (lang?: string) => ({ settings: { locale: matchLocale(lang) } }) as User;

const unknownSeen = new Map<string, number[]>();
/** Darf dieser unbekannte Chat noch eine Erklärung bekommen? (Limit pro Chat und Stunde) */
function unknownAllowed(chat: string): boolean {
  const hour = Date.now() - 3600_000;
  const list = (unknownSeen.get(chat) ?? []).filter((t) => t > hour);
  if (list.length >= UNKNOWN_LIMIT) { unknownSeen.set(chat, list); return false; }
  list.push(Date.now());
  unknownSeen.set(chat, list);
  return true;
}

const seenUpdates = new Set<number>();
const chains = new Map<string, Promise<unknown>>();

/** Eine Aktualisierung von Telegram verarbeiten (je Chat nacheinander; Wiederholungen von Telegram werden erkannt) */
export function handleUpdate(u: TgUpdate): Promise<void> {
  if (seenUpdates.has(u.update_id)) return Promise.resolve();
  seenUpdates.add(u.update_id);
  if (seenUpdates.size > 2000) seenUpdates.delete(seenUpdates.values().next().value as number);
  const chat = String(u.message?.chat.id ?? u.callback_query?.message?.chat.id ?? 'none');
  const run = (chains.get(chat) ?? Promise.resolve()).catch(() => {}).then(() => process(u, chat));
  chains.set(chat, run);
  return run;
}

async function process(u: TgUpdate, chat: string): Promise<void> {
  try {
    if (u.callback_query) return await onCallback(u.callback_query, chat);
    const m = u.message;
    if (!m || m.chat.type !== 'private') return; // Gruppen und Kanäle ignorieren wir
    const text = (m.text ?? '').trim();

    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
    if (start) return await onStart(chat, start[1], m.from?.language_code);

    const user = userByChat(chat);
    if (!user) {
      if (unknownAllowed(chat)) await sendTo(chat, { text: tr(anon(m.from?.language_code), 'telegram.unlinked') });
      return;
    }
    if (/^\/stop(?:@\w+)?$/i.test(text)) {
      unlink(user.id);
      await sendTo(chat, { text: tr(user, 'telegram.stopped') });
      return;
    }
    if (/^\/briefing(?:@\w+)?$/i.test(text)) return await sendTo(chat, { text: briefingText(user) });

    void tg('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {});
    const clientId = `tg-${u.update_id}`;
    if (m.voice) {
      try {
        const audio = await download(m.voice.file_id);
        await reply(user, await handleAudio(user, { audio, mime: m.voice.mime_type ?? 'audio/ogg', durationSec: m.voice.duration, clientId, via: 'telegram' }));
      } catch (err) {
        if (err instanceof AudioFailed || (err as Error).message) await sendTo(chat, { text: tr(user, 'telegram.voiceFailed') });
      }
      return;
    }
    if (m.photo?.length) {
      const biggest = [...m.photo].sort((a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height))[0]!;
      const id = saveFile(await download(biggest.file_id), 'jpg');
      return await reply(user, await handleChat(user, (m.caption ?? '').trim(), clientId, [id], null, { via: 'telegram' }));
    }
    if (text) return await reply(user, await handleChat(user, text, clientId, [], null, { via: 'telegram' }));
    await sendTo(chat, { text: tr(user, 'telegram.unsupported') });
  } catch (err) {
    const user = userByChat(chat);
    if (user) await sendTo(chat, { text: tr(user, 'telegram.error') }).catch(() => {});
    console.error('Telegram:', (err as Error).message);
  }
}

async function onStart(chat: string, token?: string, lang?: string) {
  if (!token) {
    const known = userByChat(chat);
    if (known) await sendTo(chat, { text: tr(known, 'telegram.welcomeBack') });
    else if (unknownAllowed(chat)) await sendTo(chat, { text: tr(anon(lang), 'telegram.unlinked') });
    return;
  }
  const userId = consumeToken(token);
  const user = userId ? getUser(userId) : null;
  if (!user) {
    if (unknownAllowed(chat)) await sendTo(chat, { text: tr(anon(lang), 'telegram.tokenExpired') });
    return;
  }
  link(user.id, chat);
  const tone = user.settings.tone ?? 'nett';
  await sendTo(chat, { text: tr(user, `telegram.welcome.${tone}`, { name: user.name.split(' ')[0]! }) });
}

async function onCallback(cb: NonNullable<TgUpdate['callback_query']>, chat: string) {
  const user = userByChat(chat);
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) }).catch(() => {});
  if (!user) return void (await answer());
  const news = /^n:([yn])$/.exec(cb.data ?? '');
  if (news) {
    if (news[1] === 'y') saveNews(user, defaultNews(user)); else saveNews(user, { enabled: false, asked: true });
    await answer();
    return void (await sendTo(chat, { text: tr(user, news[1] === 'y' ? 'news.ask.yesDone' : 'news.ask.noDone') }));
  }
  const m = /^([aru]):([0-9a-f-]{36})$/.exec(cb.data ?? '');
  if (!m) return void (await answer());
  try {
    if (m[1] === 'a') { approve(user.id, m[2]!); await answer(tr(user, 'telegram.done')); await sendTo(chat, { text: tr(user, 'telegram.done') }); }
    else if (m[1] === 'r') { reject(user.id, m[2]!); await answer(tr(user, 'telegram.rejected')); await sendTo(chat, { text: tr(user, 'telegram.rejected') }); }
    else { undo(user.id, m[2]!); await answer(tr(user, 'telegram.undone')); await sendTo(chat, { text: tr(user, 'telegram.undone') }); }
  } catch (err) {
    await answer();
    await sendTo(chat, { text: tr(user, 'telegram.actionFailed', { reason: (err as Error).message }) });
  }
}

/** Webhook ohne Anmeldung, aber mit geheimem Header – registriert am Wurzel-Server, nicht im Auth-Bereich */
export function registerTelegramWebhook(root: FastifyInstance) {
  const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  root.post('/api/channels/telegram/webhook', { bodyLimit: 1_000_000 }, async (req, reply) => {
    const key = telegramKey();
    const given = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
    if (!key || !key.secret || !equal(given, key.secret)) return reply.code(401).send({ error: 'Nicht erlaubt.' });
    const update = req.body as TgUpdate;
    if (typeof update?.update_id !== 'number') return reply.code(400).send({ error: 'Ungültig.' });
    // sofort antworten (Telegram wiederholt sonst nach einer Weile), die Arbeit läuft im Hintergrund
    pendingWork = handleUpdate(update);
    return { ok: true };
  });
}

/** Für Tests: wartet, bis die zuletzt angenommene Aktualisierung fertig ist */
export let pendingWork: Promise<void> = Promise.resolve();

/** Routen für die App (angemeldet): Stand, verbinden, trennen */
export function registerTelegramRoutes(api: FastifyInstance) {
  const status = (user: User) => ({
    configured: telegramConfigured(), bot: botUsername(), linked: !!chatOf(user.id),
    notifyVia: user.settings.notifyVia?.length ? user.settings.notifyVia : ['push'],
  });
  api.get('/api/channels/telegram', async (req) => status(req.user));
  api.post('/api/channels/telegram/link', async (req) => {
    if (!telegramConfigured() || !botUsername()) throw new HttpError(409, 'Telegram ist auf diesem Server noch nicht eingerichtet.');
    return createLinkToken(req.user.id);
  });
  api.delete('/api/channels/telegram', async (req) => { unlink(req.user.id); return status(getUser(req.user.id)!); });
}
