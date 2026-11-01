// Grundlagen für die Töne: Typ, Liste, Varianten-Auswahl. (In eigener Datei, damit voice.ts und die Sprachdateien sich nicht im Kreis importieren.)

export type Tone = 'nett' | 'frech' | 'cool';
export const TONES: Tone[] = ['nett', 'frech', 'cool'];

/** ein Satz aus mehreren Varianten – stabil für denselben Text, damit Tests nicht flackern */
export function pick(options: string[], seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length]!;
}

