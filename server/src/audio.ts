// Sprachnachrichten: aufnehmen statt tippen. Die Datei wird gespeichert, Groq (Whisper) schreibt sie ab,
// danach läuft der Text ganz normal durch den Chat. Fällt die Spracherkennung aus, bleibt die Aufnahme
// erhalten und lässt sich mit „Nochmal versuchen“ erneut abschreiben (ohne sie nochmal hochzuladen).

import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Attachment, ChatResponse } from '@stella/shared';
import { handleChat } from './assistant.ts';
import { HttpError } from './auth.ts';
import { db, notifyOnce, type User } from './db.ts';
import { filePath, saveFile } from './files.ts';
import { LlmUnavailable, transcribe } from './llm.ts';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

const EXT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
const MIME_BY_EXT: Record<string, string> = { m4a: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };

/** Abschreiben hat nicht geklappt – die Aufnahme ist gespeichert (`audioId`) und lässt sich nochmal versuchen. */
export class AudioFailed extends Error {
  constructor(message: string, public audioId: string) { super(message); }
}

const fileKey = (id: string) => `file:${id}`;

export interface AudioInput {
  /** neue Aufnahme … */
  audio?: Buffer;
  mime?: string;
  durationSec?: number;
  /** … oder eine schon gespeicherte (nochmal versuchen) */
  audioId?: string;
  clientId?: string | null;
  conversationId?: string | null;
}

export async function handleAudio(user: User, input: AudioInput): Promise<ChatResponse & { transcript: string; audioId: string }> {
  let audioId = input.audioId;
  let mime = input.mime ?? '';
  let data = input.audio;

  if (audioId) {
    // „Nochmal versuchen“: nur Aufnahmen, die dieser Nutzer selbst hochgeladen hat
    const mine = db.prepare('SELECT 1 FROM notified WHERE user_id = ? AND key = ?').get(user.id, fileKey(audioId));
    const file = mine ? filePath(audioId) : null;
    if (!file) throw new HttpError(404, 'Diese Aufnahme gibt es nicht mehr.');
    data = readFileSync(file);
    mime = MIME_BY_EXT[file.split('.').pop() ?? ''] ?? 'audio/mp4';
  } else {
    if (!data || data.length < 200) throw new HttpError(400, 'Die Aufnahme ist leer.');
    if (data.length > MAX_AUDIO_BYTES) throw new HttpError(413, 'Die Aufnahme ist zu groß (höchstens 2 Minuten bzw. 10 MB).');
    if (input.durationSec && input.durationSec > MAX_AUDIO_SECONDS + 5) throw new HttpError(400, 'Sprachnachrichten dürfen höchstens 2 Minuten lang sein.');
    const ext = EXT_BY_MIME[mime.split(';')[0]!.trim().toLowerCase()];
    if (!ext) throw new HttpError(415, 'Dieses Audioformat kenne ich nicht.');
    audioId = saveFile(data, ext);
    notifyOnce(user.id, fileKey(audioId)); // gehört diesem Nutzer (auch für den Abruf der Datei)
  }

  let transcript: string;
  try {
    transcript = await transcribe(data!, mime, { userId: user.id });
  } catch (err) {
    if (err instanceof LlmUnavailable) throw new AudioFailed(err.message, audioId);
    throw err;
  }
  const attachment: Attachment = { id: audioId, kind: 'audio', caption: 'Sprachnachricht' };
  const res = await handleChat(user, transcript, input.clientId ?? null, [], input.conversationId ?? null, { attachments: [attachment] });
  return { ...res, transcript, audioId };
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export function registerAudioRoutes(api: FastifyInstance) {
  // Aufnahme als rohe Bytes (Content-Type = Audioformat), Angaben in der Adresse
  api.addContentTypeParser(/^(audio\/.+|video\/webm)/, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES + 1024 }, (_req, body, done) => done(null, body));

  const failed = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: AudioFailed) =>
    reply.code(503).send({ error: `${err.message} Die Aufnahme ist gespeichert – tipp auf „Nochmal versuchen“.`, audioId: err.audioId, retry: true });

  api.post('/api/chat/audio', { bodyLimit: MAX_AUDIO_BYTES + 1024 }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    try {
      return await handleAudio(req.user, {
        audio: Buffer.isBuffer(req.body) ? req.body : undefined, mime: String(req.headers['content-type'] ?? ''),
        durationSec: Number(q.duration) || undefined, clientId: str(q.clientId, 100) || null, conversationId: str(q.conversationId, 100) || null,
      });
    } catch (err) {
      if (err instanceof AudioFailed) return failed(reply, err);
      throw err;
    }
  });

  api.post('/api/chat/audio/retry', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      return await handleAudio(req.user, { audioId: str(b.audioId, 100), clientId: str(b.clientId, 100) || null, conversationId: str(b.conversationId, 100) || null });
    } catch (err) {
      if (err instanceof AudioFailed) return failed(reply, err);
      throw err;
    }
  });
}
