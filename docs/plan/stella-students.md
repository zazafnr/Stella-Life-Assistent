# Stella for Students: Arbeitsplan (Aufteilung in zwei Apps)

> **So benutzt du diese Datei:** Öffne eine neue Session mit **beiden** Repos
> (`zazafnr/Stella-Life-Assistent` und `zazafnr/Stella-for-Students`), füge diese Datei ein und schreib dazu:
> „Arbeite diesen Plan ab, Paket für Paket.“
> Die Pakete werden **der Reihe nach** abgearbeitet. Jedes Paket ist für sich lieferbar und endet mit grüner
> Typprüfung und grünen Tests in beiden Repos.
> Dieselbe Datei liegt auch im Students-Repo unter `docs/plan/stella-students.md`.

---

## Kontext

Stella v3 ist fertig und auf `main`: ein Assistent, der Schule **und** Alltag abdeckt. Das ist zu viel für eine App:
Erwachsene sehen Stundenplan, Hausübungen und Schulbücher, die sie nie brauchen; Schüler:innen und Studierende sehen
Arbeitszeiten und Restaurantreservierungen.

**Ziel dieser Runde:** aus Stella werden **zwei Apps** mit getrenntem Code, aber einem Server:

| | normales Stella | Stella for Students |
|---|---|---|
| Für wen | Alltag, Beruf, Haushalt | Schule, Lehre, Studium |
| Repo | `zazafnr/Stella-Life-Assistent` | `zazafnr/Stella-for-Students` |
| Web-App | `stella.evolsior.com` | `students.stella.evolsior.com` |
| iOS-App | Stella (`app.stella.ios`) | Stella for Students (`app.stella.students.ios`) |
| Website | `evolsior.com/stella` | `evolsior.com/stella-students` |
| Konto | eigenes Konto | eigenes Konto (getrennt) |

Server, Datenbank, Stripe und VPS bleiben **einmal** vorhanden.

---

## Entscheidungen des Nutzers (stehen fest, nicht neu diskutieren)

1. **Ein Server, eine Datenbank, ein Stripe, ein VPS.** Aber **zwei Web-Apps**, **zwei iOS-Apps**, **zwei Repos** mit
   getrenntem Code, und auf der Website werden **beide Apps vorgestellt**.
2. **Getrennte Konten.** Ein Students-Konto ist ein eigenes Konto mit eigener Registrierung. Kein gemeinsamer Verlauf.
3. **Domain:** `students.stella.evolsior.com`.
4. **Umfang Students:** alles Schulische zieht um, dazu **Uni-Grundlagen** (Semester, Vorlesungen, Prüfungstermine,
   Stundenplan per ICS-Abo, Abgabefristen, Notenschnitt) **und** als Zusatzfunktionen **Lernkarten mit
   Wiederholungsrhythmus**, **Abfrage-Modus** und **Mitschrift aus Fotos zusammenfassen**.
5. **Normales Stella:** statt Stundenplan gibt es einen **Kalender** – Tage anklickbar, darin die genauen Uhrzeiten.
   **Die Oberfläche dort soll sehr gut aussehen**, das ist ausdrücklich Teil der Aufgabe.
   **Prüfungen und Lernpläne bleiben** im normalen Stella, aber mit erwachsenem Vokabular
   (Prüfung, Kurs, Abgabe, Lerneinheit – kein HÜ, keine Schularbeit).
6. **Alles andere Schulische ist im normalen Stella weg:** WebUntis, Schulbücher (scook, digi4school), HÜ-Autopilot,
   Handschrift, FreeNotes-Anbindung, Hausübungen als Eintragsart, Schulvokabular im Parser und in den KI-Prompts.
7. **Keine Gamification** (gilt seit Phase 1 und auch für die Lernkarten): keine Punkte, keine Serien, keine Abzeichen.
   Lernkarten zeigen, was heute dran ist, und sonst nichts.

---

## Architektur: wie zwei Repos einen Server teilen

Der Server ist **ein Prozess** (ein Scheduler, eine SQLite-Datei, ein Stripe-Webhook). Trotzdem soll der Schul-Code
nicht mehr im normalen Repo liegen. Deshalb:

```
Stella-Life-Assistent  (Repo A – der Kern und das normale Stella)
├── shared/                  gemeinsamer Kern: Typen, Parser, Datumslogik, i18n-Katalog, Abos, voice()
├── web-core/      ← NEU     gemeinsame Oberflächen-Bausteine für beide Web-Apps (Paket 4)
├── server/                  API, DB, Scheduler, KI, Abos  + Edition-Schnittstelle (Paket 1)
│   ├── src/plugin-api.ts    ← NEU  was ein Edition-Plugin benutzen darf
│   └── src/editions/        ← NEU  Registry und Einhängepunkte
├── editions/students/       ← NEU  Git-Submodul auf Repo B (nur beim Bauen/Deployen nötig)
├── web/                     die normale Web-App (Shell, Theme, Heute, Kalender)
├── ios/Stella.swiftpm       die normale iOS-App
├── site-src/ → site/        Website evolsior.com (beide Apps)
├── deploy/                  Docker, Caddy, install-vps.sh
└── dashboard/               Firmen-Dashboard (Zahlen je Edition)

Stella-for-Students  (Repo B – alles Studentische)
├── core/                    READ-ONLY Spiegel von Repo A (shared, web-core, server, iOS Core/Design)
│   └── CORE_COMMIT          der gespiegelte Commit von Repo A
├── server-plugin/           WebUntis, Schulbücher, HÜ-Autopilot, Handschrift, FreeNotes,
│                            Semester/Uni, Lernkarten, Mitschriften  (wird vom Server geladen)
├── web/                     die Studenten-Web-App (eigene Shell, eigenes Theme, eigene Tabs)
├── ios/StellaStudents.swiftpm   die Studenten-iOS-App
├── site-src/                die Bausteine für evolsior.com/stella-students
└── docs/
```

**Die drei Regeln dahinter:**

1. **`core/` in Repo B wird nie von Hand geändert.** Es ist eine eingecheckte Kopie, damit Repo B allein
   typprüfen, testen und in Swift Playgrounds laufen kann. Erzeugt mit `npm run sync:core` (schreibt auch
   `core/CORE_COMMIT`). Die CI in Repo B prüft mit `npm run sync:core -- --check`, dass niemand im Spiegel
   gearbeitet hat. Jede Änderung am Kern passiert in Repo A.
2. **Ausgeliefert wird immer Repo A** mit dem Submodul. Der Spiegel ist nur fürs Entwickeln.
3. **Der Server lädt das Plugin, wenn es da ist** (`editions/students/server-plugin`). Ohne Plugin läuft das
   normale Stella vollständig – das ist die Rückfall-Garantie und wird in Paket 1 mit einem Test abgesichert.

> **Wenn Submodule im Weg sind:** erlaubte Alternative ist, dass `deploy/` und die CI Repo B beim Bauen klonen
> (`git clone -b main … editions/students`). Dann entfällt das Submodul, alles andere bleibt gleich.
> Diese Entscheidung trifft Paket 2 und schreibt sie in `docs/ARCHITEKTUR.md`.

---

## Arbeitsweise (gilt für jedes Paket)

**Branches:** in beiden Repos `claude/affectionate-johnson-gcxgpw`. Nie auf `main` pushen.
Pull Requests nur, wenn der Nutzer sie verlangt.

**Prüfen vor jedem Commit:**

Repo A:
```bash
npx tsc -p shared --noEmit && npx tsc -p web-core --noEmit && npx tsc -p server --noEmit && npx tsc -p web --noEmit
```
```bash
STELLA_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test
```
Repo B:
```bash
npm run sync:core -- --check && npx tsc -p server-plugin --noEmit && npx tsc -p web --noEmit && npm test
```
Zusammenspiel (ab Paket 3, in Repo A mit Submodul):
```bash
STELLA_EDITION_STUDENTS=editions/students npm test
```

**Regeln, die weiter gelten:**
- **DB-Migrationen** nur **ans Ende** von `MIGRATIONS` in `server/src/db.ts` anhängen, alte nie ändern.
  Plugin-Migrationen laufen in einem **eigenen** `user_version`-Zähler (`PRAGMA user_version` bleibt dem Kern;
  das Plugin bekommt eine Tabelle `edition_migrations`), damit die Reihenfolge der beiden Repos sich nicht beißt.
- **Alles, was Stella selbst tut,** ist eine Aktion über `perform()`/`record()` in `server/src/actions.ts`
  mit Rechte-Stufe (*selbst · melden · fragen · nie*), Karte und 7 Tagen Rückgängig. Das gilt auch für jede
  neue Funktion aus diesem Plan.
- **Acht Sprachen**: jeder neue Text kommt in alle acht Kataloge (`shared/src/i18n/catalog/*.json`,
  bzw. für Students in `server-plugin/i18n/*.json`). Echtes Übertragen, keine wörtliche Übersetzung –
  Stil siehe `docs/i18n-stil.md`. iOS-Katalog mit `scripts/gen-i18n.ts` neu erzeugen, CI prüft mit `--check`.
- **Keine Gamification.**
- **Datenschutz:** private Inhalte (Mails, Mitschriften, Fotos von Arbeitsblättern) gehen nie an
  Gratis-Anbieter (`private: true` in `complete()`). Jede neue Adresse, die der Nutzer eintragen kann
  (ICS-Abo!), läuft über den SSRF-Schutz aus `server/src/news/net.ts`.
- **Commits:** deutsche, kurze Betreffzeile wie bisher („Students: Lernkarten mit Wiederholung“), dazu die
  Attribution-Zeilen aus der Session.

**Vorhandenes wiederverwenden, nicht neu erfinden:**

| Was | Wo |
|---|---|
| Aktionen mit Rechte-Stufe, Karte, Rückgängig | `server/src/actions.ts` |
| Lagebild (freie Zeitfenster, Tage, Fristen) | `server/src/context.ts` |
| Chat-Einstieg | `server/src/assistant.ts` |
| Kurznotizen ohne KI | `shared/src/parser.ts`, `parser.en.ts` |
| Wochenplanung nach Regeln | `server/src/weekplan.ts` |
| Hinweise („was hast du vergessen?“) | `server/src/hints.ts` |
| Was Stella vorhat | `server/src/stellaplan.ts` |
| Profil und Funktionsschalter | `shared/src/types.ts` (`profileHas`, `profileIsSchool`, `profileIsLearner`), `server/src/profile.ts` |
| Abos und Limits | `shared/src/plans.ts`, `server/src/billing.ts` |
| Modellwahl und Kosten | `server/src/router.ts`, `claude.ts`, `costs.ts` |
| Kanäle (Push, Telegram) | `server/src/channels/deliver.ts` |

---

## Die Funktionslandkarte

**Nur im normalen Stella**
Arbeitszeiten im Profil · Alltagsaufgaben (Restaurants, Verfügbarkeit) · Finanzen (bleibt ausgeblendet) ·
der neue **Kalender** als Hauptansicht

**Nur in Stella for Students**
WebUntis · Schulbücher (scook, digi4school) · HÜ-Autopilot · Handschrift · FreeNotes-Anbindung ·
Hausübungen als Eintragsart · Fächer mit Farben · Semester, Vorlesungen, ECTS, Notenschnitt ·
ICS-Stundenplan-Abo der Uni · Lernkarten mit Wiederholung · Abfrage-Modus · Mitschrift aus Fotos

**In beiden (gemeinsamer Kern)**
Chat mit Kurznotizen und Fotos · Sprachnachrichten · Planer (Termine, To-dos, Erinnerungen, Daueraufträge) ·
**Kalender** · Prüfungen und Lernpläne · Lagebild · Aktionen mit Rechte-Stufen und Rückgängig · Gedächtnis ·
Morning Briefing · Hinweise · Inbox mit Mail-Sortierung und Antwort-Entwürfen · Ziele · Listen/Einkauf ·
Gesundheit und Schritte · Bildschirmzeit · News · Wetter · Telegram · Push · Kalender-Abo (ical) ·
Abos und Stripe · acht Sprachen · Anmelde-Link und Mail-Vorlagen · Offline-Betrieb

---

## Paket 0 – Plan ablegen, Weichen stellen

**Ziel:** Beide Repos wissen, was kommt.

1. Diese Datei als `docs/plan/stella-students.md` in **beide** Repos legen (in Repo B zusätzlich als
   Verweis in der README).
2. In Repo B eine README schreiben: was die App ist, wie sie zum Kern steht, wie man sie startet.
3. In Repo A in `docs/ARCHITEKTUR.md` einen Abschnitt „Zwei Editionen“ anlegen (nur die Entscheidungen,
   Details kommen in Paket 2).
4. Begriffe festlegen und überall gleich benutzen: **Edition** `life` und `students`, Plugin heißt
   **Edition-Plugin**, der Spiegel heißt **Kern-Spiegel**.

**Abnahme:** Beide Repos haben den Plan auf dem Branch, beide pushen grün.

---

## Paket 1 – Edition-Schnittstelle im Server, Konten je Edition

**Ziel:** Der Server kann Funktionen einer Edition aufnehmen, ohne dass sie in seinem Code stehen.
Konten gehören ab jetzt zu genau einer Edition.

**1a. Schnittstelle**

Neu: `server/src/plugin-api.ts` – exportiert gebündelt, was ein Plugin benutzen darf (`db`, `getUser`,
`updateUserSettings`, `addMessage`, `createItem`/`updateItem`, `perform`, `record`, `notify`, `complete`,
`getSecret`/`setSecret`, `tr`, `enqueueJob`, `config`, Typen). Nichts anderes darf das Plugin importieren.

Neu: `server/src/editions/registry.ts` mit diesen Einhängepunkten:

| Einhängepunkt | Wofür |
|---|---|
| `migrations` | eigene Tabellen (eigener Zähler in `edition_migrations`) |
| `routes(app)` | eigene API-Pfade (Präfix `/api/students/…` oder bestehende Pfade wie `/api/untis/…`) |
| `tools` | Werkzeuge für den Chat-Agenten (Name, Beschreibung, Schema, Ausführung) |
| `prompt(user)` | Zusatz zum System-Prompt (Schulvokabular, Fächer) |
| `parser` | zusätzliche Wörter und Eintragsarten für `interpret()` |
| `context(user, lb)` | Teile für das Lagebild (Stunden, Entfall) |
| `hints(user, lb)` | eigene Hinweise |
| `briefing(user)` | eigene Abschnitte im Morning Briefing |
| `stellaPlan(user)` | eigene Zeilen in „Was Stella vorhat“ |
| `quickActions(user)` | eigene Schnellwege |
| `scheduler` | eigene Jobs (Stundenplan holen, Lernkarten fällig stellen) |
| `catalog` | eigene i18n-Schlüssel, in allen acht Sprachen |
| `settings` | eigene Abschnitte in den Einstellungen (als Beschreibung, gerendert von der Web-App) |
| `onboarding` | eigene Schritte der Einführung |
| `ical(user)` | eigene Einträge im Kalender-Abo |

Geladen über `STELLA_EDITION_STUDENTS` (Pfad, Standard `editions/students/server-plugin`). Fehlt der Pfad,
läuft der Server ohne Plugin – mit einem Test, der genau das prüft.

**1b. Umbau der Aufrufstellen**

Diese Dateien rufen heute Schul-Module direkt auf und müssen auf die Registry umgestellt werden:
`context.ts` (`lessonsFor`), `assistant.ts` (`lessonsFor`, `PROVIDERS`, `solve_homework`), `scheduler.ts`
(`syncUntis`, `fetchBookPage`, `solveHomework`), `hints.ts` + `planner.ts` (`nextLessonDate`), `main.ts`
(Untis-, Bücher-, Handschrift-, Notes-Routen), `admin.ts` (`announceFreenotes`), `ical.ts`, `quick.ts`,
`stellaplan.ts`, `briefing.ts`.
In diesem Paket wird nur **umgestellt**, nicht gelöscht – die Module bleiben vorerst in Repo A liegen und
registrieren sich selbst als eingebautes Plugin. Dadurch bleibt jedes Zwischenergebnis lauffähig.

**1c. Konten je Edition**

- Migration: `users.edition TEXT NOT NULL DEFAULT 'life'` (bestehende Konten mit Profil `situation='school'`
  bleiben `life`, sie behalten über das Plugin ihre Schulsachen – niemand verliert etwas).
- `server/src/signup.ts`: Registrierung nimmt die Edition aus dem Host (`students.*`) bzw. aus dem Feld
  `edition` und schreibt sie ins Konto.
- `server/src/auth.ts`: Anmeldung auf der falschen Oberfläche → `409` mit klarer Meldung
  („Dieses Konto gehört zu Stella for Students“) plus Link. Nie durchlassen.
- `GET /api/me` liefert `edition`; die Web-App prüft beim Start und zeigt sonst einen freundlichen Umleitungs-Hinweis.
- Owner-Konto bleibt Owner für beide Editionen (Dashboard, Server-Einstellungen).
- Mail-Vorlagen: Absendername und Produktname je Edition (`Stella` / `Stella for Students`) in
  `server/src/email/templates.ts`, ein neuer Platzhalter statt fest verdrahtet.

**Abnahme:** Tests in `server/src/editions.test.ts`: ohne Plugin keine Schul-Routen und keine Schul-Werkzeuge;
mit Plugin alles wie heute; Anmeldung über Kreuz wird abgelehnt; Registrierung über den Students-Host erzeugt
ein Students-Konto. Typprüfung und `npm test` grün.

---

## Paket 2 – Students-Repo aufsetzen, Kern spiegeln

**Ziel:** Repo B kann allein gebaut, geprüft und getestet werden; Repo A kann es einhängen.

1. Struktur in Repo B anlegen (siehe Architektur oben), `package.json` mit Workspaces
   `server-plugin`, `web`, `core/*`.
2. **`scripts/sync-core.ts`** in Repo B: kopiert aus einem lokalen Klon von Repo A
   (`STELLA_CORE_PATH`, Standard `../Stella-Life-Assistent`) nach `core/`:
   `shared/`, `web-core/` (ab Paket 4), `server/`, `ios/Stella.swiftpm/Core`,
   `ios/Stella.swiftpm/Design`. Jede kopierte Datei bekommt oben einen Hinweis
   „Kern-Spiegel – nicht hier ändern, Änderungen in Stella-Life-Assistent“.
   Schreibt `core/CORE_COMMIT`. Mit `--check` vergleicht es nur und schlägt bei Unterschieden fehl.
3. CI in Repo B (`.github/workflows/ci.yml`): `sync:core --check`, Typprüfung, Tests.
4. In Repo A: Submodul `editions/students` auf Repo B, Branch `main`; `.gitmodules`;
   `Dockerfile` und `deploy/install-vps.sh` holen die Submodule mit; CI in Repo A checkt
   mit `submodules: recursive` aus.
5. `docs/ARCHITEKTUR.md` (Repo A) und `docs/AUFBAU.md` (Repo B): wie der Spiegel funktioniert,
   wo man was ändert, wie man beide Repos nebeneinander auscheckt.

**Abnahme:** `npm run sync:core` in Repo B erzeugt einen Spiegel, `--check` ist danach grün;
Repo A baut mit Submodul; beide CIs grün.

---

## Paket 3 – Schul-Module umziehen (Server)

**Ziel:** Nach diesem Paket ist im Server-Code von Repo A **kein Schul-Code mehr**.

**Zieht nach `server-plugin/` in Repo B (mit Tests und i18n-Schlüsseln):**

| von Repo A | was es ist |
|---|---|
| `server/src/untis.ts` | WebUntis: Stundenplan, Entfall, HÜ und Tests übernehmen |
| `server/src/books.ts` | Schulbücher scook/digi4school |
| `server/src/browser.ts` | unsichtbarer Browser (nur noch von Büchern und Handschrift gebraucht) |
| `server/src/homework.ts` | HÜ-Autopilot |
| `server/src/handwriting.ts` | Handschrift-Vorschau |
| `server/src/notes.ts` | FreeNotes-Anbindung |
| Schul-Teile aus `hints.ts`, `briefing.ts`, `stellaplan.ts`, `context.ts`, `quick.ts`, `actions.ts`, `ical.ts` | Hinweise zu HÜ und Entfall, Briefing-Abschnitt „Schule“, Autopilot-Zeile, Stunden im Lagebild, Schnellwege, Aktionsgruppe `homework`, Stunden im Kalender-Abo |
| Werkzeug `solve_homework` und das Schulvokabular aus dem System-Prompt in `assistant.ts` | Chat-Agent |
| `server/src/weekplan.ts`: der HÜ-Teil | Hausübungen im Wochenplan (Prüfungen und Abgaben bleiben im Kern) |
| Tests: die schulischen Teile aus `phase3/4/6.test.ts`, `hints.test.ts`, `actions.test.ts`, `agent.test.ts`, `integrations.test.ts` | ziehen als eigene Tests ins Plugin |

**Parser aufteilen** (`shared/src/parser.ts`, `parser.en.ts`):
- Im Kern bleiben: `event`, `todo`, `reminder`, `study`, `assignment` und `exam` mit **erwachsenen** Wörtern
  (Prüfung, Klausur, Test, Abgabe, Deadline).
- Ins Plugin ziehen: `homework` und die Schulwörter (HÜ, Hausübung, Hausaufgabe, Schularbeit, SA, Schulübung …),
  dazu Seiten- und Nummernerkennung („S. 45 Nr. 16“), Fächerlisten und „nächste Lateinstunde“.
- `interpret(text, prefs, extra?)` bekommt die Zusatzwörter von der Registry. Ohne Plugin erkennt
  das normale Stella „Französisch HÜ S. 45“ **nicht** als Hausübung – das ist gewollt und wird getestet.
- Dieselbe Trennung in der Offline-Erkennung der Web-Apps (`web-core` nutzt den Kern-Parser,
  die Students-Web-App zusätzlich die Plugin-Wörter).

**Datenbank:** Tabellen bleiben, wo sie sind (nichts umbenennen, nichts löschen – sonst verlieren bestehende
Konten Daten). Neu dazukommende Tabellen des Plugins laufen über `edition_migrations`.
`items.kind = 'homework'` bleibt als Wert erlaubt; ohne Plugin entsteht er nur nicht mehr.

**Löschen in Repo A:** die oben gelisteten Dateien, die zugehörigen Web-Einstellungsseiten kommen in Paket 7,
`FEATURES`-Eintrag `homework` wandert ins Plugin, `profileIsSchool` entfällt im Kern,
`profileIsLearner` bleibt (Prüfungen und Lernpläne gibt es weiter).

**Abnahme:** In Repo A: `grep -ri "untis\|scook\|digi4school\|freenotes\|hausübung" server shared` findet nur noch
Hinweise in alten Plan-Dokumenten. Tests grün in A allein, in B allein und im Zusammenspiel.
Ein Test prüft, dass ein bestehendes Schüler-Konto mit Plugin genau dieselben Antworten bekommt wie vorher.

---

## Paket 4 – Gemeinsamer Oberflächen-Kern (`web-core`)

**Ziel:** Beide Web-Apps teilen die Bausteine, aber nicht das Aussehen.

Neuer Workspace `web-core/` in Repo A. Dorthin ziehen aus `web/src/`:
`store.ts`, `i18n.ts`, `push.ts`, `audio.ts`, `platform.ts`, `weather/*`,
`ui/Icon.tsx`, `ui/Decor.tsx`, `ui/Shell.tsx`,
`components/`: `Chat.tsx`, `Rich.tsx`, `ActionCard.tsx`, `BriefingCard.tsx`, `Inbox.tsx`, `Goals.tsx`,
`Lists.tsx`, `Health.tsx`, `ScreenTime.tsx`, `StellaPlan.tsx`, `NewsAsk.tsx`, `PlacesCard.tsx`,
`ErrandCards.tsx`, `Login.tsx`, `WeekPlanSheet.tsx`, `settings/*` (ohne die schulischen),
`components/Onboarding.tsx` als Gerüst mit einsteckbaren Schritten.

In der jeweiligen App bleiben: `App.tsx` (Shell, Tabs, Navigation), `main.tsx`, das Theme
(`styles.css` mit den Farbvariablen), `Today.tsx`, `Planner.tsx`/`Kalender`, `Intro.tsx`,
`manifest.webmanifest`, `sw.js`, Icons.

**Theme nur über Variablen:** `web-core` benutzt ausschließlich die CSS-Variablen aus `:root`
(`--blue`, `--pink`, `--bg`, `--radius` …). Keine festen Farbwerte in gemeinsamen Komponenten.
Dasselbe für iOS: `Theme.swift` bleibt pro App, `Core/` und die gemeinsamen Views lesen nur daraus.

**Abnahme:** Die normale Web-App sieht und tut genau wie vorher (`scripts/ui-check/` läuft grün),
`npx tsc -p web-core --noEmit` grün, `web` importiert nur noch aus `@stella/web-core` und eigenen Dateien.

---

## Paket 5 – Die Studenten-Web-App

**Ziel:** `students.stella.evolsior.com` ist benutzbar und sieht nach Schule und Uni aus, nicht nach Büro.

**Aussehen** (Vorschlag, Nutzer kann die Farbe noch ändern): gleicher Stern, gleiche Schrift, aber eigene
Farbwelt – Akzent **Violett `#6D4AFF`**, warmes Gelb `#FFC94A` für Fristen, Grün wie bisher für Erledigtes.
Größere, runde Karten, Fächer bekommen je eine Farbe (wie in FreeNotes), kräftigere Überschriften.
Hell wie das normale Stella. Kein Dunkelmodus in diesem Paket.

**Tabs:** `Heute` · `Chat` · `Planer` · `Lernen` · `Inbox` · mehr (Gesundheit, Bildschirmzeit, Was Stella
vorhat, Einstellungen).

- **Heute:** oben der Stundenplan des Tages mit Entfall und Raum, darunter „heute fällig“ (HÜ, Abgaben),
  „morgen“, nächste Prüfung mit Lernstand, Hinweise. Eine Karte „Für dich erledigt“ für den HÜ-Autopilot.
- **Planer:** Filter nach Fach und Art (HÜ, Prüfung, Abgabe, Lernen, Termin), Fächerfarben, Wochenansicht
  mit Stundenplan im Hintergrund, der **Kalender** aus `web-core` als zweite Ansicht.
- **Lernen** (neu, füllt sich in den Paketen 11–13): Lernplan der Woche, fällige Lernkarten,
  Mitschriften, Stoff je Prüfung.
- **Einstellungen:** Schule (WebUntis, Schulbücher, Handschrift, FreeNotes, Fächer), Uni (Semester, Kurse,
  Stundenplan-Abo), dazu die gemeinsamen Abschnitte aus `web-core`.
- **Einführung:** Schritte `sprache · willkommen · name · schule-oder-uni · schule/uni-details · fächer ·
  freenotes · funktionen · standort · mail · ton · briefing · fertig`. Der Schritt „Arbeitszeiten“ fällt weg.
- **PWA:** eigenes `manifest.webmanifest` (Name „Stella for Students“, eigene Icons), eigener Service Worker,
  eigener Offline-Speicher-Schlüssel (sonst überschreiben sich die beiden Apps nichts, aber die
  Namensräume müssen getrennt sein).

**Abnahme:** `npm run dev -w web` in Repo B startet gegen einen lokalen Kern-Server mit Plugin; alle Tabs
funktionieren; `scripts/ui-check` in Repo B macht Screenshots in beiden Sprachen.

---

## Paket 6 – Betrieb: `students.stella.evolsior.com`

**Ziel:** Beide Oberflächen laufen aus einem Server, unter zwei Adressen.

1. **Caddy** (`deploy/Caddyfile`): Block für `students.{$STELLA_DOMAIN}` (also
   `students.stella.evolsior.com`) → derselbe `stella:8787`. HTTPS holt Caddy automatisch.
2. **Server** liefert die statischen Dateien je Host aus: Host `students.*` → Bundle der Studenten-App
   (`editions/students/web/dist`), sonst `web/dist`. Pfad per Env (`STELLA_STUDENTS_WEB_DIR`).
3. **Vercel** (falls weiter genutzt): zweites Projekt mit `vercel.students.json`, `outputDirectory`
   `editions/students/web/dist`, gleiche `/api`-Umschreibung.
4. **Anmelde-Links** (`login.<domain>`) kennen die Edition und leiten auf die richtige Oberfläche.
5. `deploy/install-vps.sh`, `Dockerfile`, `deploy/backup.sh` und `scripts/deploy-vps.sh` bauen beide
   Web-Apps und holen das Submodul.
6. `docs/WEBSITE.md` und `README.md` um die zweite Adresse ergänzen.

**Abnahme:** Auf dem VPS erreichbar: `stella.evolsior.com` (normale App) und
`students.stella.evolsior.com` (Studenten-App), beide mit funktionierender Anmeldung, Push und Offline-Start.
Ein Students-Konto kann sich auf der normalen Oberfläche **nicht** anmelden und bekommt den Hinweis.

---

## Paket 7 – Normales Stella: Kalender statt Stundenplan

**Ziel:** Die Hauptansicht des normalen Stella ist ein Kalender, der wirklich gut aussieht.
Das ist das Schaufenster-Paket; hier darf Zeit in die Oberfläche fließen.

**Funktion**
- Drei Ansichten: **Monat** (Standard), **Woche**, **Tag**. Umschalten oben, Wischen wechselt den Zeitraum.
- **Monat:** Tage als Raster, je Tag bis zu drei farbige Punkte oder Mini-Balken nach Art
  (Termin, To-do, Prüfung, Lerneinheit, Frist, Ziel-Check-in). Heute hervorgehoben, Wochenenden ruhiger.
  **Tippen auf einen Tag öffnet die Tagesansicht** mit den genauen Uhrzeiten.
- **Tag:** Zeitachse von der ersten bis zur letzten Belegung (sonst 7–22 Uhr), Blöcke mit Uhrzeit, Dauer,
  Ort und Farbe; Routinen aus dem Gedächtnis als sanfte Hintergrundstreifen; **freie Zeitfenster** aus dem
  Lagebild sichtbar und antippbar („hier einplanen“). Darunter ohne Uhrzeit: To-dos und Fristen des Tages.
  Oben Wetter und, wenn vorhanden, der Briefing-Hinweis des Tages.
- **Woche:** sieben Spalten mit Zeitachse, am Kopf die Tagesauslastung (aus `load` des Wochenplans).
- **Anlegen und Verschieben:** Ziehen auf eine freie Stelle legt einen Termin an (Web und PC-App),
  Blöcke lassen sich ziehen und an den Rändern dehnen; auf dem Handy über ein Sheet. Jede Änderung läuft
  über die bestehenden Aktionen mit Rückgängig.
- Sprunglink aus Chat-Karten und Briefing in den Kalendertag.

**Umsetzung**
- Neu in `web-core/src/calendar/`: `Month.tsx`, `Week.tsx`, `Day.tsx`, `useCalendar.ts`
  (fasst Einträge, Erinnerungen, Routinen, Lerneinheiten, Ziele und freie Fenster zu Tagesblöcken zusammen)
  und `calendar.css` (nur Variablen, keine festen Farben) – damit kann Students ihn mitbenutzen.
- Serverseite: `GET /api/calendar?from=&to=` liefert Blöcke aus dem Lagebild, statt dass die App alles
  selbst rechnet; offline rechnet die App aus dem lokalen Speicher weiter.
- In `web/src/App.tsx` ersetzt der Tab `Kalender` den Planer-Tab; der Planer bleibt als Listenansicht
  im Tab erreichbar (Umschalter „Liste / Kalender“).
- Barrierefreiheit: Tastaturbedienung (Pfeile, Enter), `aria-current`, sinnvolle Vorlesetexte.
  Ansehnlich in hell, sauber bei 320 px Breite.

**Abnahme:** Screenshots in `scripts/ui-check` für Monat, Woche, Tag in Deutsch und Englisch.
Ein Test für `useCalendar` (Blöcke, Überlappungen, Zeitzonen über Sommerzeit hinweg).

---

## Paket 8 – Normales Stella: erwachsenes Lern-Vokabular

**Ziel:** Prüfungen und Lernpläne bleiben, klingen aber nicht mehr nach Schule.

- i18n: alle Schlüssel mit Schulvokabular bekommen neutrale Texte in allen acht Sprachen
  („Prüfung“, „Kurs“, „Abgabe“, „Lerneinheit“, „Stoff“). Die schulischen Varianten (Schularbeit, HÜ)
  leben nur noch im Katalog des Plugins.
- `shared/src/voice.*.ts`: Schul-Sätze im Kern ersetzen; `voice.test.ts` anpassen.
- `server/src/assistant.ts`: der Satz über Schulwörter im System-Prompt entfällt im Kern
  (kommt über `prompt(user)` aus dem Plugin).
- `profile.ts`: `situation` behält `school`/`university` **nicht** mehr im normalen Stella –
  die Auswahl in der Einführung ist `work · apprenticeship · other`, plus ein Hinweis
  „Du gehst zur Schule oder studierst? → Stella for Students“ mit Link.
- `weekplan.ts`: Regeln bleiben, Texte werden neutral (Prüfung 3 Einheiten, Abgabe 2×60 min).
- `hints.ts`: Hinweise zu Prüfung ohne Stoff und ohne Lernplan bleiben, die zu Entfall und HÜ sind weg
  (die stecken schon im Plugin).

**Abnahme:** `npm test` grün; `grep -ri "schularbeit\|hausübung\|HÜ\b" shared web web-core server` findet
in Repo A nichts mehr außer in Plan-Dokumenten.

---

## Paket 9 – Die Studenten-iOS-App

**Ziel:** Eine zweite, eigene App – gleiche Technik wie die erste.

1. In Repo B: `ios/StellaStudents.swiftpm` mit `App/`, `Views/` (eigene Shell, eigenes Theme, Heute mit
   Stundenplan, Planer mit Fächern, Lernen-Tab) und `Core/`+`Design/` aus dem Kern-Spiegel.
   Swift Playgrounds muss die Dateien physisch finden – deshalb die Kopie, nicht ein Verweis.
2. `ios/project.yml` (XcodeGen) mit `PRODUCT_BUNDLE_IDENTIFIER: app.stella.students.ios`,
   App-Gruppe `group.app.stella.students.ios`, Bildschirmzeit-Erweiterungen analog, eigenes
   `AppIcon`/`AccentColor`, `CFBundleDisplayName: Stella for Students`,
   `Resources/<sprache>.lproj/InfoPlist.strings` über `scripts/gen-infoplist.ts`.
3. `.github/workflows/ios.yml` in Repo B (Vorbild: Repo A) – Build auf macOS, Appetize-Upload,
   Klick-Vorschau auf Branch `ios-preview`.
4. Den Skill `.claude/skills/ios-preview` nach Repo B kopieren und auf die Studenten-App zeigen lassen.
5. `server/scripts/demo-seed.ts` bekommt im Plugin ein Gegenstück mit Studenten-Beispieldaten
   (Fächer, Stundenplan, HÜ, Prüfung, Lernkarten) für Screenshots und Website-Bilder.

**Abnahme:** CI baut die App grün; die Klick-Vorschau zeigt alle Screens in Deutsch und Englisch.

---

## Paket 10 – Normale iOS-App: Schule raus, Kalender rein

- Entfernen: die schulischen Teile aus `ConnectionsView.swift` (WebUntis, Bücher, Handschrift, FreeNotes),
  `PlannerView.swift` (HÜ-Filter, Stunden), `SettingsView.swift`, `OnboardingView.swift` (Schritt FreeNotes,
  Schule/Uni), `TodayView.swift` (Stundenplan), `ItemDetail.swift` (Seite/Nummer), `WeekPlanSheet.swift` (HÜ),
  `Models.swift`/`Store.swift` (Untis-Typen), `AuthImage.swift` (Buchseiten).
- Neu: `Views/CalendarView.swift` mit Monat → Tag (gleiches Verhalten wie im Web, native Gesten,
  Tagesansicht als Zeitachse), ersetzt den Stundenplan auf „Heute“ und im Planer.
- i18n-Katalog neu erzeugen (`scripts/gen-i18n.ts`), `ios/README.md` anpassen.

**Abnahme:** CI in Repo A baut grün; Klick-Vorschau zeigt den neuen Kalender.

---

## Paket 11 – Uni-Grundlagen (Students)

**Ziel:** Stella for Students taugt auch für Studierende, nicht nur für die Schule.

- **Semester und Kurse:** Tabellen `terms` (Name, von, bis) und `courses` (Name, Kürzel, Dozent:in, ECTS,
  Farbe, Ort, Termine als Wiederholungsregel). Fächer der Schule und Kurse der Uni sind dieselbe Sache mit
  zwei Oberflächen.
- **Prüfungstermine:** nutzen den vorhandenen Eintragstyp `exam` mit Bezug auf einen Kurs, dazu Anmeldefrist
  (eigene Erinnerung) und Ort.
- **Stundenplan per ICS-Abo:** `POST /api/students/timetable/ics` mit Adresse, Abruf alle 6 Stunden,
  Zuordnung der Termine zu Kursen über den Titel; **SSRF-Schutz zwingend** (`news/net.ts` benutzen),
  nur `https`, Größenbegrenzung, Fehler sichtbar in den Einstellungen. Entfall erkennt Stella über
  verschwundene oder umbenannte Termine (`CANCELLED`).
- **Abgabefristen:** `assignment` mit Kursbezug, mehrstufigen Erinnerungen (7 / 2 / 1 Tag) und
  Wochenplan-Blöcken (Regeln aus `weekplan.ts` wiederverwenden).
- **Noten und Schnitt:** Tabelle `grades` (Kurs, Note, Gewicht/ECTS, Datum), Schnitt nach ECTS gewichtet,
  Anzeige im Lernen-Tab und als Chat-Antwort („Wie steht mein Schnitt?“). Keine Prognosen, keine Abzeichen.
- **Einführung:** bei „Studium“ Semesterdaten und Stundenplan-Adresse abfragen, bei „Schule“ wie bisher.
- Lagebild, Briefing und Hinweise lernen die Kurse (Vorlesung entfällt, Anmeldefrist läuft ab,
  Abgabe in 2 Tagen ohne Lernblock).

**Abnahme:** Tests für ICS-Abruf (inkl. abgelehnter interner Adressen), Kurszuordnung, Schnittberechnung
und die neuen Hinweise.

---

## Paket 12 – Lernkarten mit Wiederholung und Abfrage-Modus (Students)

**Ziel:** Stella fragt ab, statt nur zu erinnern. Ohne Punkte, ohne Serien.

- **Datenhaltung:** `decks` (Fach/Kurs, Titel, Quelle) und `cards` (Vorder-, Rückseite, Fälligkeit,
  Stufe, letzte Antwort). Wiederholungsrhythmus **Leitner mit fünf Stufen**
  (1 Tag → 3 → 7 → 16 → 35, falsch setzt auf Stufe 1 zurück) – einfach, erklärbar, ohne Bibliothek.
- **Karten entstehen** aus dem Stoff einer Prüfung, aus einer Mitschrift (Paket 13), aus einem Foto
  („mach Karten daraus“) oder von Hand. Erzeugen läuft über Haiku mit festem JSON-Schema, Prüfung der
  Felder, höchstens 40 Karten pro Aufruf, zählt als KI-Nachricht gegen das Abo-Limit.
- **Abfragen:**
  - im **Lernen-Tab**: „Heute dran: 23 Karten“, eine Karte nach der anderen, Antwort aufdecken,
    „gewusst / nicht gewusst“;
  - **im Chat**: „Frag mich Französisch ab“ – Stella stellt die Karten als Nachrichten, versteht die Antwort
    und bewertet freundlich (das ist die schon lange geplante „Lernplan-Abfrage“);
  - **in der Lernzeit**: Zu einer Lerneinheit aus dem Wochenplan schickt Stella über
    `channels/deliver.ts` einen Anstoß („20 Minuten Vokabeln?“) – nur, wenn das Recht dafür nicht `nie` ist,
    höchstens einmal je Einheit.
- **Fällige Karten** stellt ein Scheduler-Job nachts bereit und nennt sie im Briefing (eine Zeile, keine Karte).
- iOS: eigener Screen mit Wischen nach links/rechts, Haptik, große Schrift.

**Abnahme:** Tests für den Rhythmus (Stufen, Fälligkeiten über Zeitzonen), für das Erzeugen aus Stoff
(Mock-KI) und dafür, dass ohne Recht kein Anstoß verschickt wird.

---

## Paket 13 – Mitschrift aus Fotos zusammenfassen (Students)

**Ziel:** Fotos von der Tafel oder vom Heft werden zu etwas Brauchbarem.

- **Eingang:** Fotos (mehrere auf einmal) oder ein PDF im Chat, oder im Lernen-Tab „Mitschrift hinzufügen“;
  Kurs/Fach und Datum werden erkannt oder gefragt.
- **Verarbeitung:** Bildmodell liest die Seiten (`private: true`, nie an Gratis-Anbieter), daraus entstehen
  **Zusammenfassung** (Gliederung, Merksätze, Fachbegriffe mit Erklärung), **offene Fragen** („das war auf
  dem Bild unleserlich“) und auf Wunsch **Lernkarten** (Paket 12). Mehrseitig: Seiten nacheinander,
  dann eine Zusammenfassung über alles.
- **Speichern:** Tabelle `notes_summaries` (Kurs, Datum, Titel, Text, Quelle-Dateien). Die Originalbilder
  liegen wie bisher in `files.ts` und werden nach der eingestellten Frist gelöscht.
- **Ausgeben:** im Lernen-Tab lesbar; „Ins Heft schreiben“ schickt es über die FreeNotes-Anbindung in das
  Heft des Fachs; als Prüfungsstoff übernehmen („das ist der Stoff für die Bio-Prüfung“) füllt `material`
  und löst den Lernplan aus.
- **Kosten:** eine Profi-Aufgabe je Mitschrift (Sonnet), damit es gut wird; im Free-Abo ein Hinweis
  statt eines Modellaufrufs. Fortschritt als Karte im Chat, Abbrechen möglich.

**Abnahme:** Test mit zwei Beispielbildern gegen die Mock-KI: Zusammenfassung entsteht, Karten entstehen,
Stoff landet an der Prüfung, Abbruch räumt auf.

---

## Paket 14 – Abos und Preise je Edition

**Ziel:** Students hat eigene, günstigere Abos. Eine Stripe-Einrichtung bleibt.

- `shared/src/plans.ts` bekommt Pläne je Edition: `PLANS.life` und `PLANS.students`.
  **Vorschlag** (bitte vom Nutzer bestätigen, bis dahin so umsetzen):
  Free 0 € · Plus **5 €** · Pro **9 €** · Max **19 €**; Jahresabo weiter „zwei Monate gratis“.
- Neue Limits für Students: Lernkarten-Erzeugungen pro Monat (Free 2, Plus 15, Pro 50, Max 200),
  Mitschriften pro Monat (Free 1, Plus 8, Pro 25, Max 100). HÜ-Autopilot bleibt auch im Free-Abo
  nutzbar (wie heute über `proTasksHomeworkOnly`).
- `billing.ts`: Checkout nimmt den Preis aus der Edition des Kontos; Webhook bleibt wie er ist.
  Überschreibungen im Server-Bereich gelten je Edition.
- Upgrade-Seiten in beiden Web-Apps und beiden iOS-Apps zeigen die Pläne der eigenen Edition.
- Firmen-Dashboard: Zahlen je Edition (Konten, Abos, Umsatz, KI-Kosten) und eine Summe.

**Abnahme:** Tests für Limits je Edition, Checkout mit dem richtigen Preis, Dashboard trennt sauber.

---

## Paket 15 – Website: zwei Apps

**Ziel:** `evolsior.com` stellt beide Apps vor.

- **Startseite** (`site-src/index.body.html`): zwei Karten – „Stella“ (Alltag und Beruf) und
  „Stella for Students“ (Schule, Lehre, Studium), beide mit eigenem Bild und eigener Farbe.
- **`/stella`**: Schul-Inhalte raus, der neue **Kalender** rein, dazu Mails, Ziele, Listen, Gesundheit,
  News, Wetter, Alltagsaufgaben, Telegram. Preise der `life`-Pläne. Am Ende ein Hinweis
  „Du gehst zur Schule oder studierst? → Stella for Students“.
- **`/stella-students`** (neu, `site-src/students.body.html` + `students.css` + `students.js`):
  Stundenplan und Entfall, Hausübungen mit Autopilot und Handschrift, Schulbücher, Prüfungen mit Lernplan,
  Lernkarten, Mitschriften, Semester und Noten, Mails, Briefing, Telegram; Preise der `students`-Pläne;
  Knöpfe „Web-App öffnen“ (`students.stella.evolsior.com`) und „Im App Store“ (später).
- `scripts/build-site.py`: neue Seite, neue Platzhalter (`__STUDENTS__`), `sitemap.xml`,
  `_redirects` (`/students` → `/stella-students`), eigenes `og`-Bild.
- **Bilder:** iPhone-Aufnahmen (1179×2556) aus beiden Apps mit Beispieldaten, englisch beschriftet,
  nach `site/public/assets/stella/` und `site/public/assets/students/`.
- `docs/WEBSITE.md` ergänzen.

**Abnahme:** `python3 scripts/build-site.py` läuft, `site/public/` enthält beide Seiten,
Links und Umleitungen stimmen, Seiten sehen auf dem Handy gut aus.

---

## Paket 16 – Abschluss

1. `docs/ARCHITEKTUR.md` (Repo A) und `docs/AUFBAU.md` (Repo B) auf den Endstand bringen:
   Editionen, Plugin-Schnittstelle, Kern-Spiegel, zwei Apps, zwei Adressen, Abos.
2. `README.md` in beiden Repos neu: was die App ist, was sie kann, wie man sie startet und ausliefert.
3. Beide alten Plan-Dokumente (`stella-v2.md`, `stella-v3.md`) mit einem Satz oben versehen:
   „Schulische Teile sind seit dieser Runde in Stella for Students.“
4. **Bericht** `docs/plan/stella-students-bericht.md`: was gebaut wurde, was offen blieb, welche Aufgaben
   beim Nutzer liegen (Apple-Entwicklerkonto für die zweite App, Stripe-Preise, DNS-Eintrag für
   `students.stella.evolsior.com`, Cloudflare-Seite, App-Store-Eintrag).
5. Prüfliste durchgehen: beide Typprüfungen, beide Testläufe, beide CIs, beide Web-Apps von Hand
   geöffnet, Anmeldung über Kreuz abgelehnt, Offline-Start, Push in beiden Apps, Kalender in allen
   drei Ansichten, ein HÜ-Durchlauf von der Kurznotiz bis ins FreeNotes-Heft.

---

## Reihenfolge, Risiken, Rückfall

**Reihenfolge einhalten.** 1 → 2 → 3 ist die Grundlage; vor Paket 3 darf nichts gelöscht werden.
Nach jedem Paket ist der Stand lauffähig und ausgeliefert werden kann jederzeit.

| Risiko | Gegenmittel |
|---|---|
| Die Plugin-Schnittstelle reicht nicht für alles | Paket 1 stellt zuerst **alle** heutigen Aufrufstellen um, mit den Schul-Modulen noch an Ort und Stelle. Fehlt ein Einhängepunkt, fällt es dort auf, nicht erst beim Umzug. |
| Kern-Spiegel läuft auseinander | `CORE_COMMIT` plus `sync:core --check` in der CI von Repo B. |
| Bestehende Schüler-Konten verlieren Daten | Keine Tabelle wird umbenannt oder gelöscht. Bestehende Konten bleiben `life` und behalten über das Plugin alles. Ein Test vergleicht Antworten vor und nach dem Umzug. |
| Zwei Oberflächen überschreiben sich im Browser | Getrennte Herkunft (eigene Subdomain) und getrennte Namen im lokalen Speicher und Service Worker. |
| Submodul nervt beim Entwickeln | Erlaubte Alternative: Klonen beim Bauen (siehe Architektur). |

---

## Offene Punkte (Standardannahme getroffen, Arbeit wird nicht blockiert)

| Punkt | Annahme, bis der Nutzer etwas anderes sagt |
|---|---|
| Preise Students | Free 0 € · Plus 5 € · Pro 9 € · Max 19 € |
| Farbe Students | Violett `#6D4AFF`, warmes Gelb für Fristen, gleicher Stern und gleiche Schrift |
| Website-Pfad | `/stella-students`, `/students` leitet dorthin um |
| App-Name im Store | „Stella for Students“, Bundle `app.stella.students.ios` |
| Umzug eines bestehenden Kontos | Nicht automatisch. Wer wechselt, registriert sich neu; ein Knopf „Daten mitnehmen“ kommt erst, wenn jemand danach fragt. |
| FreeNotes | bleibt im Repo `zazafnr/notes`; die Stella-Anbindung dort zeigt künftig auf Stella for Students |
| Dunkelmodus | später, in beiden Apps gemeinsam |
