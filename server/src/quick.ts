// Schnellaktionen im Chat: statt einer leeren Eingabebox ein paar Chips, passend zum Profil und zur Tageszeit.

import type { FastifyInstance } from 'fastify';
import { timeIn } from '@stella/shared';
import { hasFeature } from './profile.ts';
import type { User } from './db.ts';

export interface QuickAction {
  id: string;
  /** Icon-Name der Web-App */
  icon: string;
  /** SF-Symbol der iOS-App */
  symbol: string;
  label: string;
  /** text = in die Eingabe einfügen, send = sofort schicken, camera = Kamera öffnen, mic = Aufnahme starten */
  kind: 'text' | 'send' | 'camera' | 'mic';
  text?: string;
}

const ALL: (QuickAction & { needs?: Parameters<typeof hasFeature>[1] })[] = [
  { id: 'briefing', icon: 'sun', symbol: 'sun.max.fill', label: 'Briefing', kind: 'send', text: 'Briefing', needs: 'planner' },
  { id: 'photo', icon: 'camera', symbol: 'camera.fill', label: 'Foto schicken', kind: 'camera', needs: 'homework' },
  { id: 'homework', icon: 'book', symbol: 'book.fill', label: 'HÜ eintragen', kind: 'text', text: 'Mathe HÜ S. ', needs: 'homework' },
  { id: 'voice', icon: 'mic', symbol: 'mic.fill', label: 'Sprachnachricht', kind: 'mic' },
  { id: 'shopping', icon: 'plus', symbol: 'cart.fill', label: 'Einkaufsliste', kind: 'send', text: 'Was steht auf der Einkaufsliste?', needs: 'shopping' },
  { id: 'week', icon: 'calendar', symbol: 'calendar.badge.clock', label: 'Woche planen', kind: 'send', text: 'Plan meine Woche', needs: 'planner' },
  { id: 'mail', icon: 'mail', symbol: 'envelope.fill', label: 'Was ist neu in der Mail?', kind: 'send', text: 'Was ist neu in der Mail?', needs: 'mails' },
  { id: 'goal', icon: 'star', symbol: 'star.fill', label: 'Ziel-Update', kind: 'text', text: 'Ziel-Update: ', needs: 'goals' },
  { id: 'spending', icon: 'steps', symbol: 'eurosign.circle.fill', label: 'Ausgaben diese Woche', kind: 'send', text: 'Wie viel hab ich diese Woche ausgegeben?', needs: 'finance' },
  { id: 'forgot', icon: 'sparkle', symbol: 'questionmark.bubble.fill', label: 'Hab ich was vergessen?', kind: 'send', text: 'Hab ich was vergessen?', needs: 'planner' },
];

/**
 * Chips für dieses Profil, nach Tageszeit sortiert: morgens zuerst das Briefing, abends „Hab ich was vergessen?“.
 * `cards` sind die ersten vier – sie erscheinen groß, solange der Chat noch leer ist.
 */
export function quickActions(user: User, hour: number): { actions: QuickAction[]; cards: QuickAction[] } {
  const actions = ALL.filter((a) => !a.needs || hasFeature(user, a.needs)).map(({ needs: _n, ...a }) => a);
  const front = hour < 11 ? 'briefing' : hour >= 18 ? 'forgot' : null;
  const ordered = front ? [...actions.filter((a) => a.id === front), ...actions.filter((a) => a.id !== front)] : actions;
  // das Briefing gehört in den Morgen, tagsüber und abends nur ans Ende
  const sorted = hour < 11 ? ordered : [...ordered.filter((a) => a.id !== 'briefing'), ...ordered.filter((a) => a.id === 'briefing')];
  return { actions: sorted, cards: sorted.slice(0, 4) };
}

export function registerQuickRoutes(api: FastifyInstance) {
  api.get('/api/quick-actions', async (req) => quickActions(req.user, Number(timeIn(req.user.timeZone).slice(0, 2))));
}
