# Bericht: Stella for Students (Plan `stella-students.md`)

Stand: 2026-11-05. Entwicklungsbranch in beiden Repos: `claude/nice-goldberg-0c4br0` (nichts nach `main`, keine Pull Requests).
Dieselbe Datei liegt in beiden Repos.

## Kurzfassung

Es gibt jetzt **eine Codebasis, zwei Apps**: das normale Stella (Repo `Stella-Life-Assistent`, Kern) und Stella for Students
(Repo `Stella-for-Students`, Edition-Plugin + eigene Web-Oberfläche). Ein Server, eine Datenbank, ein Stripe, ein VPS; Konten sind je Edition getrennt.
Die **Web-Apps, der Server, der Kalender, die Abos, Uni, Lernkarten, Mitschriften und die Website sind gebaut und getestet.**
Die **beiden iOS-Apps (Pakete 9 und 10) sind bewusst nicht gebaut**: dafür fehlen hier Xcode und ein Gerät; sie lassen sich ohne
Simulator nicht ehrlich abnehmen.

## Was gebaut wurde

| Paket | Stand |
|---|---|
| 0 Plan ablegen | ✅ `docs/plan/stella-students.md` in beiden Repos |
| 1 Edition-Schnittstelle, Konten je Edition | ✅ `plugin-api.ts`, `editions/registry.ts`, `users.edition`, 409 bei falscher Oberfläche, Mails mit Produktnamen |
| 2 Students-Repo, Kern-Spiegel | ✅ `sync:core` (+ `--check`), `fetch-edition.sh` (Klonen statt Submodul), CI in beiden Repos |
| 3 Schul-Module ins Plugin | ✅ WebUntis, Bücher, HÜ-Autopilot, Handschrift, FreeNotes, Stundenplan; Reste siehe unten |
| 4 web-core | ✅ gemeinsame Bausteine; Rest: einzelne feste Farben in `core.css` |
| 5 Studenten-Web-App | ✅ eigene Shell, Theme, Tabs (Heute, Planer, Kalender, Lernen, Chat …) |
| 6 Betrieb | ✅ Host-basierte Auslieferung (Caddy, Vercel-Datei, Build `build:students`), Kreuz-Login getestet; DNS und echte Auslieferung beim Nutzer |
| 7 Kalender | ✅ Monat/Woche/Tag, Ziehen, Dehnen, Rückgängig, ICS-Quellen |
| 8 Erwachsenes Vokabular | ✅ Mechanismus (`extendEditionCatalogs`) und Hauptstellen; Rest-Sweep offen |
| 9 / 10 iOS-Apps | ⏸ nicht gebaut (siehe „Offen“) |
| 11 Uni | ✅ Semester, Kurse, Stundenplan per ICS, Noten mit gewichtetem Schnitt, Oberfläche in Einstellungen und Lernen-Tab; Einführungsschritt offen |
| 12 Lernkarten | ✅ Leitner-Wiederholung (1/3/7/16/35 Tage), Erzeugen mit KI, Abfrage im Chat, Anstoß in der Lernzeit, Karten-Ansicht im Lernen-Tab; iOS offen |
| 13 Mitschrift aus Fotos | ✅ Seiten lesen, Zusammenfassung, offene Fragen; als Karten / Prüfungsstoff / Heft; Abbrechen räumt auf; Oberfläche im Lernen-Tab; Eingang über den Chat offen |
| 14 Abos je Edition | ✅ Kern (Pläne, Überschreibungen, Mengen `flashcards`/`notes`); Upgrade-Seite Web für Students; iOS offen |
| 15 Website | ✅ zwei Karten, `/stella` ohne Schul-Inhalte, `/stella-students`, Sitemap, Umleitungen; noch ohne iPhone-Bilder |
| 16 Abschluss | ✅ diese Datei, README/Aufbau/Architektur, Hinweis in den alten Plänen |

Wichtige Regeln, die eingehalten wurden: Datenbank-Migrationen nur angehängt (Plugin im eigenen Zähler), jede Aktion über `perform()`/`record()` mit
Rückgängig, private Inhalte mit `private: true` (nie an Gratis-Anbieter), Schutz vor SSRF bei vom Nutzer eingegebenen Adressen (Uni-ICS), alle neuen
Texte in acht Sprachen, keine Gamification.

## Prüfliste

| Punkt | Ergebnis |
|---|---|
| Typprüfung Kern (`shared`, `web-core`, `server`, `web`) | ✅ grün |
| Typprüfung Students (`server-plugin`, `web`) | ✅ grün |
| Tests Kern | ✅ 75 (shared) + 278 (server) |
| Tests Students | ✅ 73 (der Testlauf fand vorher die Tests in Unterordnern nicht; jetzt `src/**/*.test.ts`) |
| Kern-Test mit dem echten Plugin (`editions.test.ts`) | ✅ 12 |
| Spiegel-Prüfung `sync:core --check` | ✅ |
| Beide Web-Apps von Hand (Playwright, Desktop und Handy, de/en) | ✅ Bilder geprüft |
| Anmeldung über Kreuz abgelehnt (echtes HTTP) | ✅ 409 `wrong_edition` |
| Kalender in drei Ansichten | ✅ Skript `scripts/ui-check/calendar.cjs` |
| Website auf Handy und Desktop | ✅ (auf `/stella` gab es schon vorher einen kleinen waagrechten Überlauf am Desktop, nicht von dieser Arbeit) |
| CI auf GitHub, Push in beiden Apps, Offline-Start, HÜ-Durchlauf bis ins FreeNotes-Heft | ⚠ nicht von hier aus prüfbar (CI-Läufe, Geräte, FreeNotes-App) – bitte einmal von Hand |

## Offen (Arbeit)

1. **iOS-Apps (Pakete 9/10)**: normale App ohne Schule und mit Kalender; Students-App `app.stella.students.ios` mit eigenem Design. Außerdem iOS-Teile der Pakete 12 und 14 (Karten, Upgrade-Seite).
2. **Reste aus Paket 3/8**: im Kern stehen noch Schul-Wörter (z. B. in `context.ts`, `quick.ts`, `assistant.ts`, `planner.ts`, `parser`), weil Hausübung und Prüfung weiter Elemente-Arten des Kerns sind; die Suche aus der Abnahme ergibt deshalb nicht null. Ein Rest-Sweep der Texte im normalen Stella steht aus.
3. **Raum im Stundenplan** (Anzeige und Entfall-Hinweise mit Raum) fehlt.
4. **Einführung (Paket 11)**: Schritt „Semester und Stundenplan-Adresse“ beim ersten Start.
5. **Mitschrift über den Chat (Paket 13)**: Fotos im Chat werden noch nicht als Mitschrift erkannt; heute geht es über Lernen-Tab → „Mitschrift hinzufügen“. Dafür braucht der Kern einen Einhängepunkt für Chat-Fotos.
6. **Upgrade-Seite und Dashboard (Paket 14)** für Students in iOS; das Dashboard zeigt Zahlen je Edition noch nicht getrennt.
7. **Website-Bilder**: `/stella-students` zeigt Chips statt iPhone-Bildern, bis es die iOS-App gibt.
8. **Eine E-Mail = ein Konto**: dieselbe Adresse kann nicht in beiden Apps ein Konto haben (so entschieden, jetzt als Einschränkung dokumentiert); wer beide will, braucht zwei Adressen.

## Aufgaben für dich (Betreiber)

1. **Apple-Entwicklerkonto** für die zweite App: Bundle `app.stella.students.ios`, Name „Stella for Students“, App-Store-Eintrag, Datenschutz-Angaben (bestehende `/privacy`-Seite gilt).
2. **Stripe**: je Edition und Plan Preise anlegen (Students: Plus 5 €, Pro 9 €, Max 19 € je Monat, Jahr = zwei Monate gratis) und die IDs eintragen; die angenommenen Preise bitte bestätigen oder ändern (`shared/src/plans.ts`, `PLANS_BY_EDITION.students`, dazu die Website `site-src/students.body.html`).
3. **DNS**: A-Record `students.stella.evolsior.com` auf die VPS-IP (HTTPS holt Caddy), danach `deploy/install-vps.sh` erneut ausführen bzw. Docker neu bauen.
4. **Cloudflare**: Website neu veröffentlichen (Push von `site/public/` nach `main`, wenn der Branch gemergt ist); Weiterleitung `/students` → `/stella-students` ist in `_redirects`.
5. **Auslieferung**: Branch nach `main` mergen (zuerst das Kern-Repo, danach im Students-Repo `sync:core`), `STELLA_STUDENTS_REF` auf `main` oder einen Tag setzen.
6. **FreeNotes** (Repo `zazafnr/notes`): die Stella-Anbindung dort zeigt künftig auf Stella for Students; bei Mitschriften liefert `/api/notes/inbox` jetzt auch Zusammenfassungen (Eintrag mit `page`/`exercises` = `null`).
7. Bestehende Schüler-Konten bleiben im normalen Stella (`life`) und behalten ihre Daten; einen Umzug in die Students-App gibt es nicht automatisch.
