# Sprachstil: Stella in acht Sprachen

Gilt für alle Texte in `shared/src/i18n/catalog/*.json`, `voice.*.ts` und `voice.more.ts`. Ziel: **Stella klingt, als wäre sie in jeder Sprache erfunden worden** – nicht übersetzt, sondern übertragen.

## Regeln

1. **Sinn und Wirkung zuerst.** Erst verstehen, was der Text bewirken soll, dann so schreiben, wie eine Muttersprachlerin im Alter von Schüler:innen bis jungen Berufstätigen es sagen würde.
2. **Anrede: du.** es *tú*, fr *tu*, it *tu*, pt-BR *você*, tr *sen*, pl *ty*. Ausnahme: förmliche Mails an Schulen und Ämter, die Stella für jemanden entwirft.
3. **Spanisch** ist neutral: weder rein spanisch noch rein lateinamerikanisch (z. B. *deberes*, *vale*, kein *vosotros*, kein *vos*).
4. **Drei Töne, drei Persönlichkeiten.** *Nett* ist warm, *frech* neckt (nie beleidigend, nie bei ernsten Themen), *cool* ist kurz und entspannt. „Frech“ darf in jeder Sprache anders frech sein.
5. **Schule je Land.** Schulbegriffe kommen aus dem Land der Nutzerin (`schoolTerms(locale, country)`): fr *devoirs/contrôle*, es *deberes/examen*, it *compiti/verifica*, pt-BR *lição de casa/prova*, tr *ödev/sınav*, pl *zadanie domowe/sprawdzian/kartkówka*, de-AT *Hausübung/Schularbeit*, de sonst *Hausaufgabe/Klassenarbeit*.
6. **Länge.** Tabs und Ton-Namen höchstens 1,6 × (mindestens 12 Zeichen) der englischen Länge (Test in `i18n.test.ts`). Bei längeren Sprachen (de, pl, pt) kürzer formulieren statt die Schrift zu verkleinern.
7. **Markenkern bleibt englisch:** **EVOLSIOR** und **„Built to become“**. Der Stella-Slogan wird übertragen (siehe Tabelle).
8. **Geschlecht.** Stella spricht von sich weiblich (*Gentille, Sfacciata, Atrevida, Zadziorna*). Wo die Nutzerin/der Nutzer vorkommt, geschlechtsneutral formulieren (pl *Czy coś mi umknęło?*, nicht *zapomniałem/zapomniałam*).
9. **Platzhalter** `{name}` bleiben unverändert und in jeder Sprache vorhanden (Test). Mehrzahl über `key#one/#other`, Polnisch zusätzlich `#few/#many`.
10. **Keine Emojis in Mails** (Paket 4); in der App nur dort, wo auch Deutsch und Englisch sie haben.

## Slogans

| Sprache | Slogan |
|---|---|
| en | Let Stella handle your life. |
| de | Stella kümmert sich um den Rest. |
| es | Deja que Stella se encargue. |
| fr | Laisse Stella s'en occuper. |
| it | Lascia fare a Stella. |
| pt-BR | Deixa com a Stella. |
| tr | Gerisini Stella halleder. |
| pl | Zostaw to Stelli. |

## Neue Texte

Jeder neue Schlüssel kommt **in alle acht Kataloge** (der Test scheitert sonst). Ablauf: zuerst `en.json`, dann `de.json`, dann die sechs übrigen mit den Entscheidungen aus `docs/i18n/<sprache>-notizen.md`. Danach `npx tsx scripts/gen-i18n.ts` (iOS-Katalog) und `npx tsx scripts/i18n-review.ts` (Prüfliste für Muttersprachler:innen).
