// Katalog der Nachrichtenquellen für das Morgen-Briefing. Nur seriöse Medien, mehrere Blattlinien je Land, kein Boulevard.
//
// Die Adressen wurden am 2026-11-01 vom VPS aus mit `npx tsx scripts/check-news-feeds.ts` geprüft; ausgefallene sind ersetzt oder gestrichen.
// Das Skript ruft jede Adresse ab und schreibt einen Bericht (erreichbar, Anzahl Meldungen, Fehler) – bei Bedarf wiederholen. Nutzungsbedingungen der Feeds bitte je Quelle ansehen (siehe docs/news/quellen.md).
// Gespeichert werden nur Titel, Teaser und Link – nie der Artikeltext.

export const NEWS_TOPICS = ['politics', 'economy', 'tech', 'science', 'climate', 'health', 'sport', 'culture', 'local'] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];
export const isNewsTopic = (v: unknown): v is NewsTopic => typeof v === 'string' && (NEWS_TOPICS as readonly string[]).includes(v);

/** Länder der Quellen; INT = international */
export type NewsCountry = 'AT' | 'DE' | 'CH' | 'INT' | 'GB' | 'US' | 'FR' | 'ES' | 'IT' | 'BR' | 'TR' | 'PL';
export const NEWS_COUNTRIES: NewsCountry[] = ['AT', 'DE', 'CH', 'INT', 'GB', 'US', 'FR', 'ES', 'IT', 'BR', 'TR', 'PL'];

export interface NewsSource {
  id: string;
  name: string;
  country: NewsCountry;
  /** Sprache der Meldungen (ISO 639-1) */
  lang: string;
  /** Themen, die diese Quelle abdeckt (leer = alle; sonst als Hinweis für die Auswahl) */
  topics: NewsTopic[];
  feedUrl: string;
  homepage: string;
}

const s = (id: string, name: string, country: NewsCountry, lang: string, feedUrl: string, homepage: string, topics: NewsTopic[] = []): NewsSource => ({ id, name, country, lang, topics, feedUrl, homepage });

export const NEWS_SOURCES: NewsSource[] = [
  // Österreich
  s('orf', 'ORF', 'AT', 'de', 'https://rss.orf.at/news.xml', 'https://orf.at'),
  s('derstandard', 'Der Standard', 'AT', 'de', 'https://www.derstandard.at/rss', 'https://www.derstandard.at'),
  s('diepresse', 'Die Presse', 'AT', 'de', 'https://www.diepresse.com/rss', 'https://www.diepresse.com'),
  s('kleinezeitung', 'Kleine Zeitung', 'AT', 'de', 'https://www.kleinezeitung.at/rss', 'https://www.kleinezeitung.at'),
  // Deutschland
  s('tagesschau', 'Tagesschau', 'DE', 'de', 'https://www.tagesschau.de/index~rss2.xml', 'https://www.tagesschau.de'),
  s('spiegel', 'Der Spiegel', 'DE', 'de', 'https://www.spiegel.de/schlagzeilen/index.rss', 'https://www.spiegel.de'),
  s('zeit', 'Die Zeit', 'DE', 'de', 'https://newsfeed.zeit.de/index', 'https://www.zeit.de'),
  s('faz', 'FAZ', 'DE', 'de', 'https://www.faz.net/rss/aktuell/', 'https://www.faz.net'),
  s('sz', 'Süddeutsche Zeitung', 'DE', 'de', 'https://rss.sueddeutsche.de/rss/Topthemen', 'https://www.sueddeutsche.de'),
  // Schweiz
  s('srf', 'SRF', 'CH', 'de', 'https://www.srf.ch/news/bnf/rss/1890', 'https://www.srf.ch/news'),
  s('nzz', 'NZZ', 'CH', 'de', 'https://www.nzz.ch/recent.rss', 'https://www.nzz.ch'),
  // International (Reuters und AP bieten keine verlässlichen öffentlichen Feeds mehr; stattdessen DW, Euronews, BBC)
  s('dw-en', 'DW', 'INT', 'en', 'https://rss.dw.com/rdf/rss-en-all', 'https://www.dw.com'),
  s('euronews-en', 'Euronews', 'INT', 'en', 'https://www.euronews.com/rss?format=mrss', 'https://www.euronews.com'),
  s('bbc-world', 'BBC News', 'INT', 'en', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news'),
  // UK
  s('bbc-uk', 'BBC News UK', 'GB', 'en', 'https://feeds.bbci.co.uk/news/uk/rss.xml', 'https://www.bbc.com/news/uk'),
  s('guardian', 'The Guardian', 'GB', 'en', 'https://www.theguardian.com/uk/rss', 'https://www.theguardian.com'),
  // USA
  s('npr', 'NPR', 'US', 'en', 'https://feeds.npr.org/1001/rss.xml', 'https://www.npr.org'),
  s('bbc-us', 'BBC News US & Canada', 'US', 'en', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'https://www.bbc.com/news/world/us_and_canada'),
  // Frankreich
  s('lemonde', 'Le Monde', 'FR', 'fr', 'https://www.lemonde.fr/rss/une.xml', 'https://www.lemonde.fr'),
  s('france24', 'France 24', 'FR', 'fr', 'https://www.france24.com/fr/rss', 'https://www.france24.com/fr'),
  s('franceinfo', 'franceinfo', 'FR', 'fr', 'https://www.francetvinfo.fr/titres.rss', 'https://www.francetvinfo.fr'),
  // Spanien
  s('elpais', 'El País', 'ES', 'es', 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', 'https://elpais.com'),
  s('rtve', 'RTVE', 'ES', 'es', 'https://www.rtve.es/rss/temas_noticias.xml', 'https://www.rtve.es/noticias'),
  // Italien
  s('ansa', 'ANSA', 'IT', 'it', 'https://www.ansa.it/sito/ansait_rss.xml', 'https://www.ansa.it'),
  s('corriere', 'Corriere della Sera', 'IT', 'it', 'https://xml2.corriereobjects.it/rss/homepage.xml', 'https://www.corriere.it'),
  // Brasilien
  s('g1', 'g1', 'BR', 'pt', 'https://g1.globo.com/rss/g1/', 'https://g1.globo.com'),
  s('folha', 'Folha de S.Paulo', 'BR', 'pt', 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', 'https://www.folha.uol.com.br'),
  s('bbc-brasil', 'BBC News Brasil', 'BR', 'pt', 'https://feeds.bbci.co.uk/portuguese/rss.xml', 'https://www.bbc.com/portuguese'),
  // Türkei: öffentlich-rechtlich und international, wegen der Lage der Pressefreiheit dort
  s('bbc-turkce', 'BBC Türkçe', 'TR', 'tr', 'https://feeds.bbci.co.uk/turkce/rss.xml', 'https://www.bbc.com/turkce'),
  s('euronews-tr', 'Euronews Türkçe', 'TR', 'tr', 'https://tr.euronews.com/rss?format=mrss', 'https://tr.euronews.com'),
  // Polen
  // PAP, Rzeczpospolita und TVN24 lieferten beim Prüfen keine nutzbaren Feeds (leer bzw. 403)
  s('polsatnews', 'Polsat News', 'PL', 'pl', 'https://www.polsatnews.pl/rss/wszystkie.xml', 'https://www.polsatnews.pl'),
  s('rmf24', 'RMF24', 'PL', 'pl', 'https://www.rmf24.pl/fakty/feed', 'https://www.rmf24.pl'),
  s('gazeta', 'Gazeta.pl', 'PL', 'pl', 'https://wiadomosci.gazeta.pl/pub/rss/wiadomosci.htm', 'https://wiadomosci.gazeta.pl'),
];

let catalog = NEWS_SOURCES;
/** Für Tests und das Prüfskript: anderen Katalog einsetzen (ohne Argument: der echte) */
export const setSourcesForTests = (list?: NewsSource[]) => { catalog = list ?? NEWS_SOURCES; };
export const allSources = () => catalog;
export const sourceById = (id: string) => catalog.find((x) => x.id === id) ?? null;

/** Land aus dem Profil → Länder der Quellen (immer plus International) */
export const defaultCountries = (country?: string | null): NewsCountry[] => {
  const own = (NEWS_COUNTRIES as string[]).includes(country ?? '') && country !== 'INT' ? [country as NewsCountry] : [];
  // LI und OTHER usw. haben keine eigenen Quellen
  return [...own, 'INT'];
};
