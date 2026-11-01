// Ruft jede Feed-Adresse aus server/src/news/sources.ts ab und schreibt einen Bericht nach docs/news/feed-pruefung.md.
//   npx tsx scripts/check-news-feeds.ts
// Nicht erreichbare Quellen danach aus dem Katalog streichen. Die Feed-Adressen wurden beim Bauen nicht geprüft (kein Internetzugang).

import { mkdirSync, writeFileSync } from 'node:fs';
import { NEWS_SOURCES } from '../server/src/news/sources.ts';
import { parseFeed } from '../server/src/news/feed.ts';
import { fetchText } from '../server/src/news/net.ts';

async function main() {
  const rows: string[] = [];
  let bad = 0;
  for (const s of NEWS_SOURCES) {
    try {
      const res = await fetchText(s.feedUrl, { timeoutMs: 15_000 });
      const feed = res.status === 200 ? parseFeed(res.body) : null;
      const ok = !!feed && feed.items.length > 0;
      if (!ok) bad++;
      rows.push(`| ${s.id} | ${s.name} | ${s.country} | ${ok ? 'ok' : 'FEHLT'} | ${res.status} | ${feed?.items.length ?? 0} | ${feed?.items[0]?.title.replace(/\|/g, '/').slice(0, 60) ?? ''} |`);
    } catch (err) {
      bad++;
      rows.push(`| ${s.id} | ${s.name} | ${s.country} | FEHLT | – | 0 | ${(err as Error).message.slice(0, 60)} |`);
    }
  }
  const md = `# Prüfung der News-Feeds\n\nErzeugt am ${new Date().toISOString().slice(0, 10)} mit \`scripts/check-news-feeds.ts\`.\n\n| id | Quelle | Land | Stand | HTTP | Meldungen | erste Meldung |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n${bad} von ${NEWS_SOURCES.length} Quellen nicht nutzbar.\n`;
  mkdirSync(new URL('../docs/news/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/news/feed-pruefung.md', import.meta.url), md);
  console.log(md);
}

main().catch((err) => { console.error(err); process.exit(1); });
