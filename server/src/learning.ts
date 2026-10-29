// Nächtliche Lern-Runde: Viele Nachrichten versteht Stella ohne KI (Kurznotizen) – dabei lernt
// sie nichts. Einmal pro Nacht liest die KI deshalb die Nachrichten des Tages und merkt sich,
// was dauerhaft wichtig ist. Kostet eine Anfrage pro Nutzer und Nacht, aus dem Hintergrund-Budget.

import { todayIn } from '@stella/shared';
import { perform } from './actions.ts';
import { db, getUser, notifyOnce } from './db.ts';
import { complete, LlmUnavailable, llmAvailable } from './llm.ts';
import { cleanSchedule, isCategory, listMemories, MEMORY_CATEGORIES } from './memory.ts';

const MIN_MESSAGES = 3;

interface Fact { category?: unknown; text?: unknown; schedule?: unknown }

export function parseFacts(raw: string): Fact[] {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { facts?: unknown };
    return Array.isArray(json.facts) ? (json.facts as Fact[]).slice(0, 10) : [];
  } catch {
    return [];
  }
}

/** Läuft zwischen 2 und 5 Uhr Ortszeit höchstens einmal pro Nacht. */
export async function nightlyLearning(userId: string, at = new Date()) {
  const user = getUser(userId);
  if (!user || !llmAvailable()) return;
  const hour = Number(new Intl.DateTimeFormat('de-AT', { timeZone: user.timeZone, hour: '2-digit', hour12: false }).format(at));
  if (hour < 2 || hour >= 5) return;
  if (!notifyOnce(userId, `learn:${todayIn(user.timeZone)}`)) return;

  const since = new Date(at.getTime() - 24 * 3600_000).toISOString();
  const said = db.prepare(`SELECT text FROM messages WHERE user_id = ? AND role = 'user' AND created_at > ? ORDER BY created_at`)
    .all(userId, since) as { text: string }[];
  if (said.length < MIN_MESSAGES) return;

  const known = listMemories(userId).map((m) => `- ${MEMORY_CATEGORIES[m.category]}: ${m.text}`).join('\n') || '(nichts)';
  try {
    const { message } = await complete([
      {
        role: 'system',
        content: 'Du hilfst einem persönlichen Assistenten, sich Dauerhaftes über seinen Nutzer (Schüler:in in Österreich) zu merken. Antworte nur mit JSON.',
      },
      {
        role: 'user',
        content: `Schon bekannt:\n${known}\n\nNachrichten des Nutzers von heute:\n${said.map((m) => `- ${m.text.slice(0, 300)}`).join('\n')}\n\n` +
          'Welche NEUEN, dauerhaft nützlichen Fakten stecken darin? (Personen und ihre Rolle, feste Routinen mit Wochentag/Uhrzeit, ' +
          'Vorlieben, was schwer/leicht fällt, Ziele.) Keine einmaligen Termine oder Aufgaben, nichts schon Bekanntes, keine Passwörter. ' +
          'Lieber nichts als Unsicheres.\n' +
          'Format: {"facts": [{"category": "person|routine|preference|school|goal|health|other", "text": "kurzer Satz", ' +
          '"schedule": {"days": [2,4], "start": "17:00", "end": "18:30"}}]} – schedule nur bei Routinen mit fester Zeit (1=Mo … 7=So).',
      },
    ], undefined, { json: true, background: true });
    for (const f of parseFacts(message.content ?? '')) {
      const text = String(f.text ?? '').trim();
      if (!text || !isCategory(f.category)) continue;
      perform(user, 'memory.add', { category: f.category, text, source: 'learned', schedule: cleanSchedule(f.schedule) }, { source: 'auto' });
    }
  } catch (err) {
    if (!(err instanceof LlmUnavailable)) console.warn('Lern-Runde:', (err as Error).message);
  }
}
