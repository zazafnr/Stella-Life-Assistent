// Bild für eine News-Karte – es muss ein echtes Bild des Artikels sein, in dieser Reihenfolge:
//  1. das echte Hauptbild des Artikels (og:image / twitter:image der Artikelseite)
//  2. das Bild aus dem Feed
//  3. nur im PC-Demo-Modus ohne echtes Bild: ein gezeichnetes Platzhalterbild zum Thema
// Ohne Bild kommt der Artikel nicht in die Ausgabe, es wird der nächstwichtigste genommen. KI-Bilder gibt es nicht mehr.
// Den Ausschnitt bestimmt die KI bei der Tagesausgabe (Bildpunkt `focus`, siehe digest.ts); die Karte richtet sich danach.

import type { NewsTopic } from './sources.ts';

const DEMO_TOPIC: Partial<Record<NewsTopic, string>> = { politics: 'politik', economy: 'politik', tech: 'tech', science: 'wissenschaft', health: 'wissenschaft', climate: 'klima', sport: 'sport' };

export interface ImageInput { url: string; feedImage?: string | null; topic?: NewsTopic }

/** Ergebnis: absolute https-Adresse des echten Bildes, im Demo-Modus ein Pfad auf diesem Server, sonst undefined */
export async function newsImage(item: ImageInput, articleImage: (url: string) => Promise<string | undefined>): Promise<string | undefined> {
  const real = [await articleImage(item.url), item.feedImage].find(isArticlePhoto);
  if (real) return real;
  if (process.env.STELLA_DEMO_BILDER) return demoImage(item.topic);
  return undefined;
}

export const demoImage = (topic?: NewsTopic) => `/demo-bilder/news-${DEMO_TOPIC[topic as NewsTopic] ?? 'wissenschaft'}.svg`;

/** Kein echtes Artikelbild: das allgemeine Logo-/Ersatzbild, das manche Zeitungen bei jedem Artikel angeben */
export const isArticlePhoto = (u: string | null | undefined): u is string =>
  !!u && !/(fallback|placeholder|default[-_]?(image|share|og)|\blogo\b|[-_/]logo[-_.]|og[-_]default|share[-_]default)/i.test(u);
