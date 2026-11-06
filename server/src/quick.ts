// Schnellaktionen im Chat: statt einer leeren Eingabebox ein paar Chips, passend zum Profil und zur Tageszeit.

import type { FastifyInstance } from 'fastify';
import { timeIn } from '@stella/shared';
import { hasFeature } from './profile.ts';
import { pluginQuickActions } from './editions/registry.ts';
import { tr, userTerms } from './locale.ts';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import type { User } from './db.ts';

export interface QuickAction {
  id: string;
  /** Icon-Name der Web-App */
  icon: string;
  /** SF-Symbol der iOS-App */
  symbol: string;
  label: string;
  /** text = in die Eingabe einfügen, send = sofort schicken, camera = Kamera öffnen, mic = Aufnahme starten, list = Einkaufsliste öffnen */
  kind: 'text' | 'send' | 'camera' | 'mic' | 'list';
  text?: string;
}

// Labels und Sendetexte stehen im Sprachkatalog (quick.<id>.label / .text). „Ausgaben“ (needs: 'finance') bleibt in der
// Liste, hasFeature blendet sie aus, solange der Schalter aus ist.
const ALL: (Omit<QuickAction, 'label' | 'text'> & { needs?: Parameters<typeof hasFeature>[1]; hasText?: boolean })[] = [
  { id: 'briefing', icon: 'sun', symbol: 'sun.max.fill', kind: 'send', hasText: true, needs: 'planner' },
  { id: 'voice', icon: 'mic', symbol: 'mic.fill', kind: 'mic' },
  { id: 'shopping', icon: 'plus', symbol: 'cart.fill', kind: 'list', needs: 'shopping' },
  { id: 'week', icon: 'calendar', symbol: 'calendar.badge.clock', kind: 'send', hasText: true, needs: 'planner' },
  { id: 'mail', icon: 'mail', symbol: 'envelope.fill', kind: 'send', hasText: true, needs: 'mails' },
  { id: 'goal', icon: 'star', symbol: 'star.fill', kind: 'text', hasText: true, needs: 'goals' },
  { id: 'spending', icon: 'steps', symbol: 'eurosign.circle.fill', kind: 'send', hasText: true, needs: 'finance' },
  { id: 'forgot', icon: 'sparkle', symbol: 'questionmark.bubble.fill', kind: 'send', hasText: true, needs: 'planner' },
];

/**
 * Chips für dieses Profil, nach Tageszeit sortiert: morgens zuerst das Briefing, abends „Hab ich was vergessen?“.
 * `cards` sind die ersten vier – sie erscheinen groß, solange der Chat noch leer ist.
 */
export function quickActions(user: User, hour: number): { actions: QuickAction[]; cards: QuickAction[] } {
  const terms = userTerms(user);
  // Einträge des Edition-Plugins (z. B. „Foto“, „Hausübung“) an die gewünschte Stelle setzen
  const all = [...ALL];
  for (const { after, ...extra } of pluginQuickActions(user)) {
    const at = after ? all.findIndex((x) => x.id === after) : -1;
    all.splice(at >= 0 ? at + 1 : all.length, 0, extra as (typeof ALL)[number]);
  }
  const actions: QuickAction[] = all.filter((a) => !a.needs || hasFeature(user, a.needs)).map(({ needs: _n, hasText, ...a }) => ({
    ...a, label: tr(user, `quick.${a.id}.label`),
    ...(hasText ? { text: tr(user, `quick.${a.id}.text`, { homework: capitalize(terms.homework) }) } : {}),
  }));
  const front = hour < 11 ? 'briefing' : hour >= 18 ? 'forgot' : null;
  const ordered = front ? [...actions.filter((a) => a.id === front), ...actions.filter((a) => a.id !== front)] : actions;
  // das Briefing gehört in den Morgen, tagsüber und abends nur ans Ende
  const sorted = hour < 11 ? ordered : [...ordered.filter((a) => a.id !== 'briefing'), ...ordered.filter((a) => a.id === 'briefing')];
  return { actions: sorted, cards: sorted.slice(0, 4) };
}

export function registerQuickRoutes(api: FastifyInstance) {
  api.get('/api/quick-actions', async (req) => quickActions(req.user, Number(timeIn(req.user.timeZone).slice(0, 2))));
}
