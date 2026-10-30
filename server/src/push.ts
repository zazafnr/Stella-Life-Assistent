// Web-Push: funktioniert auf dem iPhone/iPad, sobald Stella zum Home-Bildschirm hinzugefügt ist (iOS ≥ 16.4),
// sowie in Chrome/Edge/Firefox am PC – ohne Apple-Entwicklerkonto.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { config } from './config.ts';
import { db, now } from './db.ts';

const keyFile = path.join(config.dataDir, 'vapid.json');
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 });
const vapid = JSON.parse(readFileSync(keyFile, 'utf8')) as { publicKey: string; privateKey: string };

const contact = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:stella@localhost';
webpush.setVapidDetails(contact, vapid.publicKey, vapid.privateKey);

export const vapidPublicKey = vapid.publicKey;

export function saveSubscription(userId: string, sub: webpush.PushSubscription) {
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, subscription, created_at) VALUES (?, ?, ?, ?)')
    .run(sub.endpoint, userId, JSON.stringify(sub), now());
}

export async function pushToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  const subs = db.prepare('SELECT endpoint, subscription FROM push_subscriptions WHERE user_id = ?').all(userId) as
    { endpoint: string; subscription: string }[];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify(payload), { TTL: 6 * 3600 });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Abo abgelaufen oder App gelöscht
      if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
      else console.warn('Push fehlgeschlagen:', (err as Error).message);
    }
  }));
}
