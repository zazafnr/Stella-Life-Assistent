// Ort für Alltagsaufgaben (Restaurants, Läden): der zuletzt bekannte gerundete Ort (Paket 7), sonst die Hauptstadt des Landes.
// Der genaue Standort wird nie gespeichert; dafür gibt es die Karte „Läden in der Nähe“ (der Standort kommt dort nur in dem Moment).

import type { User } from '../db.ts';
import { CAPITALS } from '../weather.ts';

const MAX_AGE_MS = 14 * 24 * 3600_000;

export function errandPlace(user: Pick<User, 'settings'>): { lat: number; lon: number; approximate: boolean } | null {
  const last = user.settings.lastPlace;
  if (last && Date.now() - Date.parse(last.at) < MAX_AGE_MS) return { lat: last.lat, lon: last.lon, approximate: true };
  // Ohne Freigabe oder bekannten Ort fragen wir lieber nach, als in der Hauptstadt zu suchen
  return null;
}

export { CAPITALS };
