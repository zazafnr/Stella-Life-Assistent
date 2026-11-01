# Nachrichtenquellen im Morgen-Briefing

Der Katalog steht in `server/src/news/sources.ts`. Jede Quelle hat `id`, `name`, `country`, `lang`, `topics`, `feedUrl`, `homepage`.

## Ehrlicher Stand

- **Geprüft am 2026-11-01 vom VPS aus:** 28 von 34 Adressen liefen. Ersetzt: Die Presse (`/rss`), RTVE (`/rss/temas_noticias.xml`). Gestrichen: DW Türkçe (leer), PAP, Rzeczpospolita und TVN24 (leer bzw. 403), in Polen stattdessen Polsat News, RMF24 und Gazeta.pl. Folha liefert ISO-8859-1; der Abruf liest jetzt den Zeichensatz aus.
- Dafür gibt es `npx tsx scripts/check-news-feeds.ts`. Es ruft jede Adresse ab, liest sie mit dem echten Parser und schreibt `docs/news/feed-pruefung.md`.
  Quellen, die dort „FEHLT“ zeigen, bitte aus dem Katalog streichen oder die Adresse korrigieren. **Das ist eine Aufgabe für dich** (einmal, vor dem Start).
- **Reuters und AP** sind bewusst nicht im Katalog: sie bieten keine verlässlichen öffentlichen RSS-Feeds mehr. Stattdessen International: DW, Euronews, BBC.
- **Nutzungsbedingungen:** Wir speichern nur Titel, Teaser (höchstens 280 Zeichen) und Link und löschen nach 3 Tagen. Das ist die übliche Nutzung von RSS-Feeds
  (Überschriften mit Link zur Quelle). Die Bedingungen der einzelnen Feeds (z. B. BBC, Guardian, Spiegel, FAZ, NZZ, Le Monde) schließen teils die
  gewerbliche Weiterverwendung aus oder verlangen eine Genehmigung. Weil Stella ein bezahltes Produkt wird, bitte je Quelle kurz nachlesen
  (meist unter „RSS“ im Fußbereich der Webseite) und bei Zweifel die Quelle streichen oder um Erlaubnis bitten.
- Türkei: bewusst nur öffentlich-rechtliche bzw. internationale Quellen (BBC Türkçe, DW Türkçe, Euronews Türkçe), wegen der Lage der Pressefreiheit dort.

## Themen

Politik, Wirtschaft, Tech, Wissenschaft, Klima, Gesundheit, Sport, Kultur, Lokales. Die Zuordnung kommt aus den Feed-Kategorien, sonst aus Stichwörtern
im Titel (acht Sprachen, ohne KI-Aufruf pro Meldung). Ohne Treffer gilt „Politik“ (Allgemeines).

## Ablauf

1. Alle 30 Minuten ruft der Server alle Quellen ab (mit ETag und If-Modified-Since) und die Lieblingsquellen der Nutzer.
2. Meldungen zur selben Geschichte (Titel-Wörter, Jaccard ≥ 0,5 in 12 Stunden) kommen in eine Gruppe.
3. Beim Briefing wählt der Server je Person aus (neu, passend zu Themen und Ländern, eine Meldung pro Gruppe, Lieblingsquelle zuerst, dann Zahl der Quellen, dann Aktualität),
   Free 3, sonst 5. Ein Haiku-Aufruf schreibt je Meldung einen neutralen Satz in der Sprache der Person (bei Unglücken, Krieg und Tod immer sachlich).
