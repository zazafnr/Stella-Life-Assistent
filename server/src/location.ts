// Standort: Die Einführung erklärt, wofür Stella ihn nutzt, und merkt sich die Antwort. Wer „Später“ gewählt hat,
// wird beim ersten Erledigungs-Reminder oder der ersten Restaurant-Frage noch einmal gefragt – mit derselben Erklärung.

import { type LocationPermission } from '@stella/shared';
import { updateUserSettings, type User } from './db.ts';
import { tr } from './locale.ts';

export const locationState = (user: Pick<User, 'settings'>): LocationPermission | null => user.settings.locationPermission ?? null;

/** Soll Stella jetzt (zum ersten Bedarf) noch einmal nach dem Standort fragen? Nur bei „Später“ oder wenn nie gefragt wurde. */
export const shouldAskLocation = (user: Pick<User, 'settings'>): boolean => {
  const s = locationState(user);
  return s === 'later' || s === null;
};

/** Text der Karte im Chat (Knopf „Standort freigeben“ / „Später“ zeichnen die Apps) */
export const locationAskText = (user: User): string => tr(user, 'location.ask.text');

/** Antwort der App merken (Systemabfrage ausgegangen wie) */
export function recordLocationAnswer(user: User, answer: LocationPermission) {
  updateUserSettings(user.id, { locationPermission: answer });
}
