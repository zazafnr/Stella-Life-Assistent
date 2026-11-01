// Von sich aus melden: `notify()` wählt nach den Einstellungen der Person (Push, Telegram oder beides).
// `pushToUser` bleibt der Push-Kanal; Telegram ist ein weiterer Kanal. Ist Telegram gewählt, aber nicht verknüpft
// (oder fehlgeschlagen), kommt es trotzdem als Push an – eine Erinnerung soll nie verloren gehen.

import { getUser } from '../db.ts';
import { pushToUser } from '../push.ts';
import type { OutboundButton } from './channel.ts';
import { telegramChannel } from './telegram.ts';

export interface NotifyPayload {
  title: string;
  body: string;
  /** voller Text mit Markdown für Kanäle mit mehr Platz (Telegram); sonst Titel + Text */
  text?: string;
  url?: string;
  tag?: string;
  buttons?: OutboundButton[];
}

let push: typeof pushToUser = pushToUser;
/** Für Tests: anderen Push-Versand einsetzen (ohne Argument: der echte) */
export const setPushForTests = (fn?: typeof pushToUser) => { push = fn ?? pushToUser; };

export const notifyChannels = (userId: string): ('push' | 'telegram')[] => {
  const via = getUser(userId)?.settings.notifyVia;
  return via?.length ? via : ['push'];
};

export async function notify(userId: string, payload: NotifyPayload): Promise<void> {
  const via = notifyChannels(userId);
  let delivered = false;
  if (via.includes('telegram') && telegramChannel.configured()) {
    const text = payload.text ?? (payload.title && payload.title !== 'Stella' ? `**${payload.title}**\n${payload.body}` : payload.body);
    delivered = await telegramChannel.send(userId, { text, ...(payload.buttons ? { buttons: payload.buttons } : {}) }).catch(() => false);
  }
  if (via.includes('push') || !delivered) {
    const { title, body, url, tag } = payload;
    await push(userId, { title, body, ...(url ? { url } : {}), ...(tag ? { tag } : {}) });
  }
}
