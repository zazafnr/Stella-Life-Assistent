// Stellas feste Texte in den übrigen Sprachen (Paket 3). Jede Sprache überschreibt nur, was sie hat – der Rest kommt aus dem Englischen.

import type { Locale } from './i18n/locales.ts';
import type { Tone } from './voice.core.ts';
import type { Voice } from './voice.de.ts';

export const PARTIAL_VOICES: Partial<Record<Locale, (tone: Tone | undefined) => Partial<Voice>>> = {};
