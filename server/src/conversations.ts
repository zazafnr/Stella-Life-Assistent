// Chats nach Tagen: jeder Tag startet von selbst einen neuen Chat, man kann jederzeit einen neuen beginnen und alte
// ansehen oder fortsetzen. Gibt es mehrere Chats an einem Tag (oder ist einer lang), bekommt er einen kurzen Titel von Groq.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { dayLabel, todayIn, type Conversation } from '@stella/shared';
import { HttpError } from './auth.ts';
import { conversationMessages, createConversation, db, getConversation, getUser, todayConversation, type User } from './db.ts';
import { complete, groqAvailable, llmAvailable } from './llm.ts';

type ListRow = { id: string; title: string | null; day: string; updated_at: string; count: number; last: string | null };

export function listConversations(user: User, opts: { before?: string; limit?: number } = {}): Conversation[] {
  const today = todayIn(user.timeZone);
  const rows = db.prepare(`
    SELECT c.id, c.title, c.day, c.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS count,
      (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last
    FROM conversations c
    WHERE c.user_id = ? ${opts.before ? 'AND c.updated_at < ?' : ''} AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
    ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`).all(...[user.id, ...(opts.before ? [opts.before] : []), Math.min(opts.limit ?? 30, 100)]) as ListRow[];
  return rows.map((r) => ({
    id: r.id, title: r.title, label: r.title || dayLabel(r.day, today), day: r.day,
    lastMessage: r.last ? r.last.replace(/\*\*/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120) : null, updatedAt: r.updated_at, count: r.count,
  }));
}

/** Der Chat, den ein Gerät gerade zeigen soll, wenn es nichts Bestimmtes festhält: der neueste von heute. */
export const currentConversation = (userId: string) => todayConversation(userId, false);

/** Neuer Chat – ein leerer von heute wird wiederverwendet, damit keine leeren Chats entstehen. */
export function startConversation(userId: string): string {
  const current = todayConversation(userId, false);
  if (current && !(db.prepare('SELECT 1 FROM messages WHERE conversation_id = ? LIMIT 1').get(current))) return current;
  return createConversation(userId);
}

// ---------- Titel ----------

export const TITLE_AFTER = 4;
export const LONG_CHAT = 12;

/** Titel nur, wenn es etwas zu unterscheiden gibt: mehrere Chats am Tag oder ein langer Chat – und erst ab 4 Nachrichten. */
export function titleDue(c: { title: string | null; count: number; chatsThatDay: number }): boolean {
  return !c.title && c.count >= TITLE_AFTER && (c.chatsThatDay > 1 || c.count >= LONG_CHAT);
}

export function cleanTitle(raw: string): string | null {
  const words = raw.replace(/^["„“'«»\s]+|["“”'«»\s.!]+$/g, '').replace(/[\n\r]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  const title = words.join(' ').slice(0, 40).trim();
  return title.length >= 3 ? title : null;
}

export async function maybeTitle(userId: string, conversationId: string): Promise<string | null> {
  const c = getConversation(userId, conversationId);
  if (!c || c.title || (!groqAvailable() && !llmAvailable())) return null;
  const count = (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId) as { n: number }).n;
  const chatsThatDay = (db.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE c.user_id = ? AND c.day = ?
    AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`).get(userId, c.day) as { n: number }).n;
  if (!titleDue({ title: c.title, count, chatsThatDay })) return null;
  const msgs = conversationMessages(userId, conversationId, 8);
  try {
    const { message } = await complete([
      { role: 'system', content: 'Du gibst Chats einen kurzen Titel. Antworte nur mit dem Titel: höchstens 5 Wörter, auf Deutsch, ohne Anführungszeichen und ohne Punkt.' },
      { role: 'user', content: msgs.map((m) => `${m.role === 'user' ? 'Nutzer' : 'Stella'}: ${m.text.slice(0, 200)}`).join('\n') },
    ], undefined, { provider: 'groq', task: 'title', userId, background: true, timeoutMs: 20_000 });
    const title = cleanTitle(message.content ?? '');
    if (title) db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND title IS NULL').run(title, conversationId);
    return title;
  } catch {
    return null; // kein Titel ist kein Drama – es steht dann der Tag da
  }
}

/** Beim Tageswechsel: Chats von früher nachträglich betiteln. */
export async function titleOldChats(userId: string) {
  const user = getUser(userId);
  if (!user) return;
  const rows = db.prepare(`SELECT id FROM conversations WHERE user_id = ? AND title IS NULL AND day < ?
    AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = conversations.id) >= ? ORDER BY updated_at DESC LIMIT 5`)
    .all(userId, todayIn(user.timeZone), TITLE_AFTER) as { id: string }[];
  for (const r of rows) await maybeTitle(userId, r.id);
}

// ---------- Routen ----------

export function registerConversationRoutes(api: FastifyInstance) {
  api.post('/api/conversations', async (req) => {
    const id = startConversation(req.user.id);
    return { id, conversations: listConversations(req.user) };
  });

  api.get('/api/conversations', async (req) => {
    const q = req.query as Record<string, string>;
    return listConversations(req.user, { before: q.before || undefined, limit: Number(q.limit) || undefined });
  });

  api.get('/api/conversations/:id/messages', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!getConversation(req.user.id, req.params.id)) throw new HttpError(404, 'Chat nicht gefunden');
    const q = req.query as Record<string, string>;
    return conversationMessages(req.user.id, req.params.id, Math.min(Number(q.limit) || 80, 200), q.before || undefined);
  });
}
