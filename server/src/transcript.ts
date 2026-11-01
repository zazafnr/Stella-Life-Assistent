// Sprachnachrichten: aus dem rohen Whisper-Text wird ein sauberer Chat-Text (Satzzeichen, Groß-/Kleinschreibung, ohne Füllwörter).
// Haiku (light, Effort low) macht das; es zählt nicht als KI-Nachricht. Fällt es aus oder verändert es Zahlen, gilt der Rohtext –
// ohne Fehlermeldung für die Person.

import { complete } from './llm.ts';
import type { User } from './db.ts';

/** unter so vielen Wörtern setzen wir nur Satzzeichen */
export const SHORT_WORDS = 6;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const BASE = `You clean up the speech-to-text transcript of a voice message so it reads like a message someone typed.
Rules:
- Keep the language of the transcript. Never translate.
- Add punctuation and correct capitalization. Start a new paragraph (blank line) when the topic changes.
- Remove filler words and hesitations ("um", "uh", "like", "you know", "ähm", "also", "halt", "sozusagen", "eh", "este", "euh", "bah", "tipo", "né", "yani", "no", "ee" when they are only fillers), repeated words and false starts. Smooth out slips of the tongue.
- NEVER add content, NEVER interpret, summarize or reorder. Keep every number, date, time, amount and name exactly as spoken.
- Keep the speaker's wording and tone; do not make it more formal.
- Output only the cleaned text, nothing else.

Examples:
Input: ähm also ich muss halt morgen um 15 Uhr zum Zahnarzt ähm zum Zahnarzt und danach äh einkaufen
Output: Ich muss morgen um 15 Uhr zum Zahnarzt und danach einkaufen.

Input: so I um need to to finish the math homework page 45 number 3 and and then I'll text you
Output: I need to finish the math homework, page 45, number 3, and then I'll text you.`;

const SHORT = `You add punctuation and capitalization to a very short speech-to-text transcript. Keep the language. Do not change, add or remove any word. Output only the text.`;

/** Zahlen (auch mit Komma/Punkt/Doppelpunkt) als sortierte Liste, zum Vergleichen vor und nach dem Aufräumen */
export const numbersIn = (s: string): string[] => (s.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/[.,]$/, '')).sort();

/** Ist der aufgeräumte Text glaubwürdig (gleiche Zahlen, ähnliche Länge)? */
export function looksFaithful(raw: string, cleaned: string): boolean {
  if (!cleaned.trim()) return false;
  if (JSON.stringify(numbersIn(raw)) !== JSON.stringify(numbersIn(cleaned))) return false;
  const r = raw.trim().length, c = cleaned.trim().length;
  return c <= r * 1.35 + 10 && c >= r * 0.3;
}

export interface CleanedTranscript { text: string; raw: string; cleaned: boolean }

export async function cleanTranscript(raw: string, user: Pick<User, 'id'>): Promise<CleanedTranscript> {
  const original = raw.trim();
  const fallback: CleanedTranscript = { text: original, raw: original, cleaned: false };
  if (!original) return fallback;
  try {
    const { message } = await complete([
      { role: 'system', content: wordCount(original) < SHORT_WORDS ? SHORT : BASE },
      { role: 'user', content: original },
    ], undefined, { tier: 'light', effort: 'low', timeoutMs: 15_000, maxTokens: 1024, userId: user.id, private: true, background: true });
    const out = (message.content ?? '').trim().replace(/^["„“]|["“”]$/g, '').trim();
    if (!looksFaithful(original, out)) return fallback;
    return { text: out, raw: original, cleaned: out !== original };
  } catch {
    return fallback; // Aufräumen ist nie wichtig genug, um die Nachricht zu verlieren
  }
}
