// Echte News für den PC-Demo-Modus: holt die Feeds der Demo-Länder, schaltet News ein und verwirft die
// News von heute, damit „Heute“ sie beim ersten Öffnen neu baut – mit dem echten Hauptbild jedes Artikels.
// Läuft bei jedem Start von `stella-pc.ps1 -Demo`; dadurch gibt es jeden Tag neue Meldungen und Bilder.
// Ohne KI-Schlüssel steht statt des Ein-Satz-Texts die Schlagzeile da, und Artikel ganz ohne Bild bekommen
// ein gezeichnetes Platzhalterbild (mit Schlüssel: ein KI-Bild).
//
//   STELLA_DATA_DIR=… npx tsx server/scripts/demo-news.ts

process.env.OPENROUTER_API_KEY ??= '';
const EMAIL = process.env.DEMO_EMAIL || 'demo@stella.local';

const { db, getUser, updateUserSettings } = await import('../src/db.ts');
const { newsSettings, saveNews } = await import('../src/news/digest.ts');
const { allSources, defaultCountries } = await import('../src/news/sources.ts');
const { fetchSource, purgeNews } = await import('../src/news/store.ts');

const row = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string } | undefined;
let user = row && getUser(row.id);
if (!user) {
  console.error(`Demo-Konto ${EMAIL} nicht gefunden – erst demo-seed.ts laufen lassen`);
  process.exit(0);
}
// Ältere Demo-Daten haben kein Land – ohne Land gibt es offline kein ungefähres Wetter und keine passenden Zeitungen
if (!user.settings.country) { updateUserSettings(user.id, { country: user.settings.locale === 'en' ? 'GB' : 'AT' }); user = getUser(user.id)!; }

const s = newsSettings(user);
const countries = s.countries.length ? s.countries : defaultCountries(user.settings.country);
const sources = allSources().filter((x) => countries.includes(x.country));
const results = await Promise.all(sources.map((src) => fetchSource(src).catch(() => ({ status: 'error' as const, added: 0 }))));
purgeNews();
const ok = results.filter((r) => typeof r.status === 'number' && r.status < 400).length;

// News an, gestrige Auswahl-Grenze weg (sonst wären nur Meldungen seit dem letzten Bau dabei), heutige Auswahl neu bauen lassen
saveNews(user, { enabled: true, asked: true, lastAt: undefined, topics: s.topics.length ? s.topics : ['politics', 'economy', 'tech', 'science', 'sport', 'climate'] });
db.prepare('DELETE FROM news_digest WHERE user_id = ?').run(user.id);
console.log(`News: ${ok}/${sources.length} Zeitungen erreicht${ok ? '' : ' (kein Internet? Dann bleibt „Deine News“ leer)'}`);
process.exit(0);
