// RSS 2.0, RSS 1.0 (RDF) und Atom lesen, die Feed-Adresse einer Webseite finden und Meldungen Themen zuordnen.
// Gespeichert wird nur, was der Feed selbst liefert: Titel, Teaser (kurz, ohne HTML) und Link.

import { isNewsTopic, type NewsTopic } from './sources.ts';

export interface FeedItem { title: string; url: string; teaser: string; publishedAt: number; categories: string[] }
export interface ParsedFeed { title: string; items: FeedItem[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** CDATA auspacken, Tags entfernen, Entitäten auflösen, Leerraum glätten */
export function plain(s: string | undefined, max = 300): string {
  if (!s) return '';
  let t = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);              // Teaser sind oft doppelt kodiert (&lt;p&gt;…)
  t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const tag = (block: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m?.[1];
};
const allTags = (block: string, name: string): string[] => [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => m[1]!);

/** Atom: <link rel="alternate" href="…"/>; RSS: <link>…</link> */
function itemLink(block: string): string {
  const atom = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]!).filter((a) => /href=/i.test(a));
  if (atom.length) {
    const pick = atom.find((a) => /rel=["']alternate["']/i.test(a)) ?? atom.find((a) => !/rel=/i.test(a)) ?? atom[0]!;
    const href = /href=["']([^"']+)["']/i.exec(pick)?.[1];
    if (href) return decodeEntities(href).trim();
  }
  const text = tag(block, 'link');
  if (text) return plain(text, 2000);
  const guid = tag(block, 'guid');
  return guid && /^https?:\/\//i.test(plain(guid, 2000)) ? plain(guid, 2000) : '';
}

function parseDate(s: string | undefined): number {
  if (!s) return NaN;
  const t = Date.parse(plain(s, 100));
  return t;
}

export function parseFeed(xml: string, now = Date.now()): ParsedFeed {
  const head = xml.slice(0, xml.search(/<item[\s>]|<entry[\s>]/i) > 0 ? xml.search(/<item[\s>]|<entry[\s>]/i) : 2000);
  const feedTitle = plain(tag(head, 'title'), 120);
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!);
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = plain(tag(b, 'title'), 220);
    const url = itemLink(b);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const when = [tag(b, 'pubDate'), tag(b, 'published'), tag(b, 'updated'), tag(b, 'dc:date')].map(parseDate).find((t) => Number.isFinite(t));
    const teaser = plain(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content:encoded') ?? tag(b, 'content'), 280);
    const categories = [...allTags(b, 'category'), ...allTags(b, 'dc:subject')].map((c) => plain(c, 60)).filter(Boolean);
    // Atom-Kategorien stehen im Attribut: <category term="Politik"/>
    for (const m of b.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["']/gi)) categories.push(plain(m[1], 60));
    items.push({ title, url, teaser: teaser === title ? '' : teaser, publishedAt: Math.min(when ?? now, now + 3600_000), categories: [...new Set(categories)] });
  }
  return { title: feedTitle, items };
}

// ---------- Themen ----------

/** Stichwörter (Wortanfänge, Sprachen gemischt: de, en, fr, es, it, pt, tr, pl) je Thema */
const TOPIC_WORDS: Record<NewsTopic, RegExp> = {
  politics: /\b(politik|politic|regierung|government|gouvernement|gobierno|governo|hükümet|rząd|wahl|election|élection|elecci|eleiç|seçim|wybor|parlament|minister|ministro|bundestag|nationalrat|kanzler|präsident|president|kreml|nato|\beu\b|ukraine|krieg|war\b|guerre|guerra|savaş|wojna)/i,
  economy: /\b(wirtschaft|economy|économie|economía|economia|ekonomi|gospodark|börse|stock|bourse|bolsa|borsa|giełd|inflat|inflaci|inflaz|inflaç|enflasyon|zins|interest rate|taux|tipo de interés|tassi|faiz|stopy|unternehm|company|entreprise|empresa|azienda|şirket|firma|konjunktur|dax|euro\b|handel|trade|steuer|tax|impôt|impuesto|tasse|imposto|vergi|podatk)/i,
  tech: /\b(tech|digital|software|künstliche intelligenz|artificial intelligence|\bki\b|\bai\b|intelligence artificielle|inteligencia artificial|intelligenza artificiale|inteligência artificial|yapay zeka|sztuczna inteligencja|internet|app\b|smartphone|cyber|datenschutz|privacy|apple|google|microsoft|meta\b|openai|chip|robot|computer)/i,
  science: /\b(wissenschaft|science|ciencia|scienza|ciência|bilim|nauk|forschung|research|recherche|investigación|ricerca|pesquisa|araştırma|badani|studie|study|étude|estudio|studio|estudo|çalışma|weltraum|space|espace|espacio|spazio|espaço|uzay|kosmos|nasa|esa\b|physik|physics|astronom|archäolog|archaeolog)/i,
  climate: /\b(klima|climate|climat|clima|iklim|klimat|umwelt|environment|environnement|medio ambiente|ambiente|meio ambiente|çevre|środowisk|erderwärmung|global warming|réchauffement|calentamiento|riscaldamento|aquecimento|küresel ısınma|ocieplenie|emission|co2|energie|energy|énergie|energía|energia|enerji|energii|dürre|drought|hochwasser|flood|überschwemm|waldbrand|wildfire)/i,
  health: /\b(gesundheit|health|santé|salud|salute|saúde|sağlık|zdrowi|krankheit|disease|maladie|enfermedad|malattia|doença|hastalık|chorob|medizin|medicine|médecin|medicina|tıp|medycyn|impf|vaccin|virus|pandemie|pandemic|krebs|cancer|kanser|rak\b|spital|hospital|ospedale|hastane|szpital|ärzt|doctor|pflege|nursing)/i,
  sport: /\b(sport|fußball|football|soccer|fútbol|calcio|futebol|futbol|piłka|bundesliga|champions league|olymp|formel 1|formula 1|tennis|ski\b|basketball|handball|rugby|golf|boxen|boxing|wm\b|em\b|world cup|coupe du monde|copa|mondiale|dünya kupası|mistrzostw|tor\b|goal|match|spiel)/i,
  culture: /\b(kultur|culture|cultura|kültür|kultura|film|kino|cinema|cine|sinema|kino\b|musik|music|musique|música|musica|müzik|muzyk|buch|book|livre|libro|livro|kitap|książk|theater|theatre|teatro|tiyatro|teatr|kunst|art\b|arte|sanat|sztuk|konzert|concert|festival|ausstellung|exhibition|oscar|nobelpreis|serie\b|streaming)/i,
  local: /\b(lokal|local|regional|région|región|regione|região|bölge|lokaln|stadt|city|ville|ciudad|città|cidade|şehir|miasto|gemeinde|bürgermeister|mayor|alcalde|sindaco|prefeito|belediye|burmistrz|polizei|police|policía|polizia|polícia|polis|policj|unfall|accident|accidente|incidente|kaza|wypadek)/i,
};

/** Themen einer Meldung: Feed-Kategorien und Titel gegen die Stichwörter prüfen; ohne Treffer „politics“ (Allgemeines) */
export function guessTopics(title: string, categories: string[] = [], teaser = ''): NewsTopic[] {
  const fromCats = categories.map((c) => c.toLowerCase().trim()).filter(isNewsTopic);
  const hay = `${categories.join(' ')} ${title} ${teaser.slice(0, 120)}`;
  const found = (Object.keys(TOPIC_WORDS) as NewsTopic[]).filter((t) => TOPIC_WORDS[t].test(hay));
  const all = [...new Set([...fromCats, ...found])];
  return all.length ? all : ['politics'];
}

// ---------- Feed-Suche ----------

export interface FoundFeed { feedUrl: string; title?: string }

/** `<link rel="alternate" type="application/rss+xml" href="…">` auf der Startseite (Atom und RSS), Adressen absolut machen */
export function findFeedLinks(html: string, baseUrl: string): FoundFeed[] {
  const out: FoundFeed[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (!/rel=["']?alternate["']?/i.test(t) || !/type=["']?application\/(rss|atom)\+xml/i.test(t)) continue;
    const href = /href=["']([^"']+)["']/i.exec(t)?.[1];
    if (!href) continue;
    try {
      const feedUrl = new URL(decodeEntities(href), baseUrl).toString();
      if (/^https?:/i.test(feedUrl) && !out.some((o) => o.feedUrl === feedUrl)) out.push({ feedUrl, title: plain(/title=["']([^"']+)["']/i.exec(t)?.[1], 80) || undefined });
    } catch { /* kaputte Adresse überspringen */ }
  }
  return out;
}
