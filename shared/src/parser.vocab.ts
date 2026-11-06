// Wortschatz der Kurznotizen-Erkennung. Der Kern kennt Erwachsenen-Wörter (Prüfung, Klausur, Test, Abgabe, Deadline …);
// Schulwörter (HÜ, Schularbeit, Fächer, „S. 45 Nr. 16“-Hausübungen) bringt ein Edition-Plugin über `ParserExtension` mit.
// `interpret(text, today, now, { extra })` schaltet die Erweiterung für genau diesen Aufruf ein.

import type { ItemKind } from './parser.ts';

export interface ParserExtension {
  /** Fächer: [Anzeigename, Schreibweisen/Kürzel in Kleinbuchstaben] */
  subjects?: [string, string[]][];
  /** Ein-Buchstaben-Kürzel (z. B. aus WebUntis) → Fachname */
  singleLetters?: Record<string, string>;
  /** Art-Wörter auf Deutsch: [Art, Anzeigename, Wörter in Kleinbuchstaben] */
  kinds?: [ItemKind, string, string[]][];
  /** Art-Wörter auf Englisch */
  kindsEn?: [ItemKind, string, string[]][];
  /** Spezifischere Bezeichnung statt der Standard-Bezeichnung der Art, je Wort */
  labels?: Record<string, string>;
  /** Anzeigenamen der Fächer auf Englisch */
  subjectNamesEn?: Record<string, string>;
}

export interface Vocabulary {
  subjects: [string, string[]][];
  singleLetters: Record<string, string>;
  kinds: [ItemKind, string, string[]][];
  kindsEn: [ItemKind, string, string[]][];
  labels: Record<string, string>;
  subjectNamesEn: Record<string, string>;
  /** gibt es die Art „Hausübung“? Nur dann gilt „Fach + Seite/Nummer“ als Hausübung und „nächster Schultag“ als Frist */
  homework: boolean;
}

export const CORE_VOCABULARY: Vocabulary = {
  subjects: [],
  singleLetters: {},
  kinds: [
    ['exam', 'Klausur', ['klausur']],
    ['exam', 'Test', ['test', 'quiz']],
    ['exam', 'Prüfung', ['prüfung', 'pruefung']],
    ['assignment', 'Abgabe', ['abgabe', 'deadline', 'projekt', 'portfolio']],
  ],
  kindsEn: [
    ['exam', 'Exam', ['exam', 'exams', 'midterm', 'final', 'finals']],
    ['exam', 'Test', ['test', 'tests', 'quiz', 'quizzes']],
    ['assignment', 'Presentation', ['presentation', 'talk']],
    ['assignment', 'Assignment', ['assignment', 'project', 'essay', 'report', 'paper']],
  ],
  labels: { quiz: 'Quiz', klausur: 'Klausur', projekt: 'Projekt', portfolio: 'Portfolio' },
  subjectNamesEn: {},
  homework: false,
};

export function mergeVocabulary(extra?: ParserExtension): Vocabulary {
  if (!extra) return CORE_VOCABULARY;
  const kinds = [...(extra.kinds ?? []), ...CORE_VOCABULARY.kinds];
  const kindsEn = [...(extra.kindsEn ?? []), ...CORE_VOCABULARY.kindsEn];
  return {
    subjects: [...CORE_VOCABULARY.subjects, ...(extra.subjects ?? [])],
    singleLetters: { ...CORE_VOCABULARY.singleLetters, ...extra.singleLetters },
    kinds, kindsEn,
    labels: { ...CORE_VOCABULARY.labels, ...extra.labels },
    subjectNamesEn: { ...CORE_VOCABULARY.subjectNamesEn, ...extra.subjectNamesEn },
    homework: [...kinds, ...kindsEn].some(([k]) => k === 'homework'),
  };
}

let active: Vocabulary = CORE_VOCABULARY;
export const vocabulary = (): Vocabulary => active;

/** Führt `fn` mit dem Wortschatz aus Kern + Erweiterung aus (synchron; danach gilt wieder der vorherige) */
export function withVocabulary<T>(extra: ParserExtension | undefined, fn: () => T): T {
  if (!extra) return fn();
  const prev = active;
  active = mergeVocabulary(extra);
  try { return fn(); } finally { active = prev; }
}
