# Stella v2 – Arbeitsplan für Sonnet 5.5

> **So benutzt du diese Datei:** Lade sie herunter und füge sie in einer neuen Session mit dem Repo
> `zazafnr/Stella-Life-Assistent` ein, zusammen mit dem Satz „Arbeite diesen Plan ab, Paket für Paket“.
> Sonnet legt sie in Paket 0 zusätzlich als `docs/plan/stella-v2.md` ins Repo, damit spätere Sessions sie finden.
> Die Pakete werden der Reihe nach abgearbeitet.
>
> **Firma:** Stella wird von **EVOLSIOR** gebaut (aus *Evolic* + *Excelsior*). Leitspruch: **„Built to become“**.

## Kontext

Stella ist ein persönlicher KI-Alltagsassistent (Server auf dem VPS, Website, PC-App, iOS-App). Phasen 1–5
(Lagebild, Aktionen mit Rechten, Gedächtnis, Hinweise, Briefing, natürliche Sprache, intelligente Inbox,
Wochenplaner) sind fertig und auf `main`. Der Nutzer hat neue Ideen gesammelt. Ziel dieser Runde:

- Stella für **jeden Alltag** (Schule, Studium, Job), nicht nur Schüler:innen: Registrierung, Einführung, Profil.
- Mail-Denkfabrik mit **Groq** (billig, große Tageslimits): wichtig / neutral / unwichtig / Werbung.
- Chat wie eine echte App: Tages-Chats mit Titeln, Sprachnachrichten, Schnellaktionen, kurze Antworten, Wolken-Look.
- Neue Lebensbereiche: Einkaufsliste und Erledigungen mit Läden in der Nähe, Ziele, Ausgaben (Apple Pay),
  und eine Übersicht „Was Stella vorhat“ zum Bearbeiten.

**Entscheidungen des Nutzers:**
- Stella wird später eine öffentliche App. Wir entwickeln jetzt dafür, starten aber noch nicht öffentlich.
  Die Registrierung bleibt hinter Einladungscodes.
- Finanzen laufen nur über die iOS-Kurzbefehl-Automation bei Apple-Pay-Zahlungen. Keine Bankanbindung.
- Groq-Key ist vorhanden und wird für Mails, Sprache (Whisper) und Chat-Titel genutzt.
- Standort: Erinnerung nach Uhrzeit. Beim Erinnern schickt Stella Läden in der Nähe über OpenStreetMap,
  Standort nur in diesem Moment. Keine Hintergrund-Ortung.
- Keine Gamification: keine Punkte, Serien oder Abzeichen (Entscheidung aus Phase 1).

---

## Arbeitsweise (für Sonnet, gilt für jedes Paket)

**Repo und Stack:**
- npm-Workspaces `shared/`, `server/` (Fastify + better-sqlite3 via tsx) und `web/` (React/Vite).
- Getrennt davon: `desktop/` (Electron, lädt die Website) und `ios/Stella.swiftpm` (SwiftUI, Swift Playgrounds).

**Prüfen vor jedem Commit:**
- Typecheck: `npx tsc -p shared --noEmit`, `npx tsc -p server --noEmit`, `npx tsc -p web --noEmit`.
- Tests: `STELLA_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test`. Server-Tests nutzen `node:test`, das Muster steht in `server/src/phase4.test.ts`: eigenes `STELLA_DATA_DIR` pro Test und ein Mock-LLM-Server.

**DB-Migrationen** sind ein Array in `server/src/db.ts` (`user_version`, aktuell 6). Neue Tabellen und Spalten kommen immer als **neuer** Eintrag ans Ende, alte Einträge werden nie geändert.

**Muster, die wiederverwendet werden (nicht neu erfinden):**
- `perform()` / `record()` in `server/src/actions.ts`: Aktionen mit Rechte-Stufe, Karte und Rückgängig.
- `buildLagebild()` in `server/src/context.ts`.
- `voice()` in `shared/src/voice.ts`: alle festen Texte in drei Tönen.
- `interpret()` in `shared/src/parser.ts`: Schnellwege ohne KI.
- `addMemory()` in `server/src/memory.ts`.
- `findHints()` / `deliverHint()` in `server/src/hints.ts`.
- `every()` im Scheduler (`server/src/scheduler.ts`).
- `pushToUser()` in `server/src/push.ts`.
- Ingest per Token unter `/api/ingest/:token/...` in `server/src/main.ts` (Vorlage: health).
- iOS: `API.shared.send/get`, `Store`, `Theme`, `SmallButton`, `PrimaryButton`, `Pill`, `Sky` und `Cloud` (Design/).
- Web: `api()`, `sync()`, `useStore`, `Sheet`, `Switch`, `showToast`, `Icon`.

**Sprache und Stil:**
- Texte in der App, Commits und Doku sind **deutsch**.
- Commit-Ende:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: <link>
  ```

**Geheimnisse:**
- Keine Keys, Tokens oder Passwörter in Repo, Commits, Chat oder `deploy/ops exec`-Befehle. Das Repo ist öffentlich.
- Server-Keys trägt der Nutzer in den Einstellungen ein, siehe Paket 1.

**Deploy:** Läuft über den Ops-Agent im Repo `zazafnr/coinchecker` (Skill `vps-ops`, CLI `deploy/ops`). Sonnet legt in Paket 0 das Skript `scripts/deploy-vps.sh` ins Stella-Repo. Es macht Folgendes:
1. `git archive HEAD` ohne `desktop/` und `ios/`.
2. Base64 in 100-KB-Teile splitten und mit `deploy/ops put` nach `/root/stella-upload/` hochladen.
3. Auf dem VPS zusammensetzen, Prüfsumme vergleichen, nach `/root/stella-src` entpacken.
4. `STELLA_DOMAIN=stella.5-189-157-214.sslip.io bash deploy/install-vps.sh` mit `--async` starten.
5. Job abfragen, bis er `done` meldet, dann `systemctl is-active stella` prüfen.

Das Install-Skript ist `deploy/install-vps.sh` im Stella-Repo (App unter `/opt/stella`, Env in `/etc/stella/stella.env`).

**iOS:**
- Jeder Push mit `ios/**` baut in der CI und lädt automatisch zu Appetize hoch: https://appetize.io/app/7hedphqd45epodlt5k6olpxife (Testkonto: `test` / `1`).
- Screenshots nur bei Bedarf über den Skill `.claude/skills/ios-preview`.
- Bei Fehlern im Build: Logs mit dem GitHub-MCP holen (`get_job_logs`).
- Swift: keine Tupel-KeyPaths (`\.0`), stattdessen kleine Structs.

**Pro Paket:**
1. Bauen, mit Tests und Typecheck.
2. Commit und Push auf den Arbeitsbranch, dann PR nach `main` und mergen (der Nutzer hat das so freigegeben).
3. Deploy und iOS-CI prüfen.
4. Kurzer Bericht auf Deutsch.

Fragen an den Nutzer nur bei echten Entscheidungen.

---

## Paket 0 – Vorbereitung
- `scripts/deploy-vps.sh` anlegen (siehe oben).
- Diese Datei als `docs/plan/stella-v2.md` ablegen.
- In `docs/ARCHITEKTUR.md`, Abschnitt 8, auf den Plan verweisen.

**Fertig wenn:** Ein Deploy läuft mit dem Skript aus dem Repo durch.

## Paket 0b – Markenauftritt EVOLSIOR: Intro beim ersten Start und Ladebildschirm
**Ziel:** Ein edler, sauberer erster Eindruck. Beim allerersten Start zeigt die App einmalig das EVOLSIOR-Intro. Danach gibt es nur noch einen kurzen Stella-Ladebildschirm, und der steht nur so lange da, wie die App wirklich lädt.

**1. Intro beim ersten Start** (einmal pro Gerät bzw. Installation, insgesamt etwa 3 Sekunden)
- **Aussehen:** ruhig, edel, viel Leerraum.
  - Tiefer, fast schwarzer Blauton als Hintergrund (z. B. `#0A0F1A`), Schrift in Weiß, nichts sonst auf dem Bildschirm.
  - Oben in der Mitte groß **EVOLSIOR**: dünne, saubere Grotesk (iOS: SF Pro `.ultraLight`/`.light`; Web: „Inter Tight“ 300), sehr weite Laufweite (etwa 0,35–0,45 em), Großbuchstaben.
  - Darunter klein **„Built to become“**: Gewicht 400, Laufweite etwa 0,15 em, Weiß mit 70 % Deckkraft.
- **Ablauf:**
  1. 0,0–0,8 s: EVOLSIOR blendet ein. Die Laufweite zieht sich dabei leicht zusammen, von etwas weiter auf den Endwert, mit sanfter Ease-out-Kurve.
  2. 0,8–2,2 s: Die Buchstaben von „Built to become“ treffen nacheinander ein. Jeder Buchstabe kommt von unscharf (Blur ~8 px) und leicht versetzt (+6 px nach unten, Deckkraft 0) scharf an seinen Platz, etwa 70–90 ms Versatz pro Zeichen. Leerzeichen zählen mit, damit der Rhythmus gleichmäßig bleibt.
  3. Danach steht der ganze Schriftzug etwa 0,7 s still.
  4. Zum Schluss 0,4 s weiches Ausblenden in die App: Einführung (Paket 5) bzw. Login.
- Kein Logo-Gewackel, keine Sounds, keine Partikel. Clean schlägt Effekt.
- „Bewegung reduzieren“ (iOS Accessibility, Web `prefers-reduced-motion`): beide Zeilen blenden nur ein, 1,5 s stehen, dann ausblenden.
- Danach ein Merker: iOS `@AppStorage("evolsiorIntroShown")`, Web/PC `localStorage` (mit try/catch). Ab dann nie wieder.
- Tippen überspringt das Intro nicht, es ist kurz genug und kommt nur einmal.

**2. Ladebildschirm bei jedem weiteren Start**
- Hell, im Stella-Stil: Himmel-Verlauf wie die App, in der Mitte das Stella-Logo, darunter „Stella“ und klein „by EVOLSIOR“ (Laufweite weit, Grau). Das Logo ist der vorhandene Stern: Web `StarMark` in `web/src/ui/Decor.tsx`, iOS das Gegenstück in `Design/Decor.swift`, sonst das App-Icon.
- **Dauer = echte Ladezeit, keine künstliche Mindestzeit.**
  - **Web/PC:** Der Ladebildschirm steht als reines HTML/CSS direkt in `web/index.html`. Er ist also sofort da, bevor das JavaScript lädt. Die App entfernt ihn mit kurzem Ausblenden (200 ms), sobald sie bereit ist: Login-Status bekannt, gecachte Daten angezeigt bzw. erster `sync()` fertig, höchstens nach etwa 4 s.
  - **iOS:** Ein Overlay in `RootView`, solange `Store` noch startet (Cache wiederherstellen, `refreshMe`/erster Sync). Ist alles nach unter 300 ms fertig, erscheint der Ladebildschirm gar nicht bzw. nur als Ausblenden, damit nichts flackert.
  - Beim allerersten Start kommt das EVOLSIOR-Intro statt des Ladebildschirms. Das Intro darf länger dauern als das Laden. Lädt die App länger als das Intro, folgt nahtlos der Stella-Ladebildschirm.
- Die Electron-App lädt die Website und bekommt beides damit automatisch. `desktop/src/offline.html` bekommt dasselbe Logo und „by EVOLSIOR“.

**3. Kleinigkeiten**
- In den Einstellungen eine Zeile „Über Stella“: Version, „Stella by EVOLSIOR – Built to become“ und ein Satz zum Namen (Evolic + Excelsior).
- In README und Website-Fußzeile „by EVOLSIOR“ ergänzen.

**Dateien:**
- iOS: neu `ios/Stella.swiftpm/Views/IntroView.swift` und `Views/LaunchView.swift`, eingebunden in `App/StellaApp.swift` (`RootView`).
- Web: `web/index.html` (Ladebildschirm inline), neu `web/src/components/Intro.tsx`, eingebunden in `web/src/App.tsx`.

**Gestaltung:** Die Design-Skills (z. B. `impeccable`/`animate`, falls im Repo vorhanden) bzw. die Kriterien oben nutzen. Vor dem Abschluss als Video oder Bildfolge prüfen: Playwright mit Zeitstempeln für Web, Appetize für iOS. Der Rhythmus muss ruhig wirken, nicht hektisch.

**Fertig wenn:** Beim ersten Start sauberes Intro (etwa 3 s), bei jedem weiteren Start nur noch der Stella-Ladebildschirm für die echte Ladezeit, bei „Bewegung reduzieren“ ohne Bewegung.

## Paket 1 – Groq-Anbindung und Server-Schlüssel in den Einstellungen
**Ziel:** Günstige, schnelle Modelle für Masse-Aufgaben. Keys trägt der Nutzer in der App ein, nicht per SSH.

**Server:**
- In `server/src/llm.ts` einen zweiten Anbieter neben OpenRouter, OpenAI-kompatibel unter `https://api.groq.com/openai/v1`.
- `complete(messages, tools, { provider: 'groq', task: 'classify' | 'title' | 'extract' })` wählt ein Groq-Modell:
  - Standard `llama-3.1-8b-instant`.
  - Für Extraktion mit mehr Verstand ein größeres Llama (z. B. `llama-3.3-70b-versatile`).
  - Die Modellnamen stehen nur in der Konfiguration, damit man sie tauschen kann.
- Bei 429/5xx automatisch Rückfall auf die bestehende OpenRouter-Kette.
- Neue Funktion `transcribe(audio: Buffer, mime)` über `/audio/transcriptions` (Modell `whisper-large-v3-turbo`, `language: de`).
- Zähler: `llm_usage` per Migration um `provider` und `user_id` erweitern. Das ist für den späteren öffentlichen Betrieb nötig (Limits pro Nutzer). `usageToday()` bleibt kompatibel.
- **Server-Schlüssel (nur Owner):**
  - Der erste registrierte Nutzer bekommt `role = 'owner'` (Migration).
  - Neue Route `GET/PUT /api/admin/keys` für `groq`, `smtp` (für Paket 6) und optional `openrouter`.
  - Ablage verschlüsselt mit dem bestehenden Secret-Mechanismus (`setSecret`/`getSecret` in `server/src/auth.ts`, System-Scope `__system__`).
  - Die Konfiguration liest zuerst aus der Env, dann aus diesen Secrets.

**Web/iOS:**
- Einstellungen, neue Gruppe „Server“ (nur Owner sichtbar).
- Pro Key ein Feld „Groq-API-Key“ mit Status (gesetzt / fehlt / zuletzt OK).
- Knopf „Testen“ macht einen Mini-Request.
- Der Key wird nie zurück an den Client geschickt.

**Tests:**
- Mock-Groq liefert 429, danach greift OpenRouter.
- `transcribe` mit einem Mock.
- Admin-Route ist nur für den Owner erreichbar.

**Nutzer-Aufgabe:** Den Groq-Key in den Einstellungen unter „Server“ eintragen.

## Paket 2 – Mail-Denkfabrik (Groq)
**Ziel:** Alle Mails einordnen in wichtig / neutral / unwichtig / Werbung. Werbung kommt in den Papierkorb (wie bisher über das Recht `mail_sort`). Alle Mails lassen sich in der App lesen und beantworten.

**Server** (`server/src/mail.ts`):
- `classify()` läuft über Groq. Weil es billig ist, werden jetzt **alle** neuen Mails eingeordnet (Batches à 20), nicht nur Auszüge.
- Kategorien intern beibehalten: `important` → Wichtig, `normal` → Neutral, `newsletter` → Unwichtig, `spam` → Werbung.
- Prompt um klare Regeln ergänzen (Beispiele je Klasse) und um Profilwissen aus Paket 6, sobald es da ist.
- Grund, Frist und `needsReply` bleiben (Phase 4).
- Werbung landet weiter im Papierkorb und lässt sich zurückholen.
- Für den Volltext beim Speichern `uid` und `mailbox` im Payload ablegen.
- `GET /api/inbox/:id/body` holt den Text bei Bedarf per IMAP, gekürzt und bereinigt. Er wird 30 Tage im Cache gehalten, danach gelöscht.
- Antworten:
  - „Selbst antworten“ = leerer Editor, dann `POST /api/inbox/:id/send`. Das gibt es schon.
  - „Stella antworten lassen“ = bestehender Entwurf (`draftReply`).
  - Beides gilt jetzt für **jede** Mail, nicht nur „Wichtig für dich“.
- Kategorie per Hand ändern (`POST /api/inbox/:id/category`). Das merkt sich Stella als Absender-Regel in einer neuen Tabelle `mail_rules (user_id, sender, category)`. Diese Regeln gelten vor Groq.

**Web und iOS** (Inbox):
- Tabs Wichtig / Neutral / Unwichtig / Papierkorb.
- „Wichtig für dich“ bleibt oben.
- Tippen auf eine Mail öffnet den Lesebildschirm mit Volltext und den Knöpfen „Antworten“, „Stella antworten lassen“, „Verschieben nach …“ und „Erledigt“.
- iOS: `InboxView.swift` und `InboxFocus.swift` erweitern, `ReplySheet` wiederverwenden. Web: `web/src/components/Inbox.tsx`.

**Tests:**
- Einordnung mit Mock-Groq in alle vier Klassen.
- Absender-Regel überschreibt die KI.
- Werbung → Papierkorb nur bei `mail_sort` = `auto`.
- Body-Route mit IMAP-Mock.

## Paket 3 – Chats nach Tagen mit Titeln
**Ziel:** Jeder Tag startet automatisch einen neuen Chat. Man kann neue Chats beginnen und alte ansehen. Gibt es mehrere Chats an einem Tag, bekommen sie Titel.

**Server:**
- Migration: Tabelle `conversations (id, user_id, title, day, created_at, updated_at)` und Spalte `messages.conversation_id`. Bestehende Nachrichten werden pro Kalendertag (Zeitzone des Nutzers) einer Konversation zugeordnet.
- Regel: Eine Nachricht ohne `conversationId` geht in die neueste Konversation von **heute**. Gibt es heute noch keine, wird eine angelegt. Nachrichten, die Stella selbst schickt (Briefing, Hinweise, Erinnerungen), gehen in die Konversation von heute.
- `POST /api/conversations` (neuer Chat), `GET /api/conversations?before=` (Liste mit Titel, Tag, letzter Nachricht), `GET /api/conversations/:id/messages`. Sync liefert nur die aktuelle Konversation plus die Liste.
- Titel per Groq, höchstens 5 Wörter, deutsch. Sie entstehen nach 4 Nachrichten und beim Tageswechsel, und nur, wenn es an dem Tag mehrere Chats gibt oder der Chat lang ist. Sonst steht als Titel der Tag („Heute“, „Mi, 4.11.“).
- Der Agent bekommt als Verlauf **nur** die aktuelle Konversation (`recentMessages` filtern). Für Zusammenhang sorgen Lagebild und Gedächtnis. `pending_questions` bleiben unabhängig davon.

**Web:**
- `web/src/components/Chat.tsx` bekommt den Knopf „Neuer Chat“ und eine Verlaufsliste: am Computer als Seitenleiste, am Handy als Sheet. Gruppiert nach Tag, mit Titel.
- Ein alter Chat ist lesbar und kann fortgesetzt werden.

**iOS:** In `ChatView.swift` ein Toolbar-Knopf mit Verlauf-Sheet und „Neuer Chat“. `Store` hält `conversationId`.

**Tests:**
- Tageswechsel → neue Konversation.
- „Neuer Chat“ trennt den Verlauf.
- Migration ordnet bestehende Nachrichten richtig zu.
- Titel mit Mock-Groq.
- Der Agent sieht nur die aktuelle Konversation.

## Paket 4 – Sprachnachrichten
**Ziel:** Stella Sprachnachrichten schicken statt tippen. Sie werden abgeschrieben und ganz normal verarbeitet.

**Server:**
- `POST /api/chat/audio` (multipart, höchstens 2 Minuten / 10 MB).
- Speichert die Datei als Anhang `kind: 'audio'` (über die bestehende Dateiablage `server/src/files.ts`).
- `transcribe()` aus Paket 1, danach `handleChat(user, transkript, …)`. Die Nutzernachricht zeigt das Transkript, die Audiodatei hängt an.
- Wenn Groq ausfällt: klare Fehlermeldung, die Audiodatei bleibt erhalten, Knopf „nochmal versuchen“.

**iOS:**
- Mikrofon-Knopf im Eingabefeld: gedrückt halten zum Aufnehmen, loslassen zum Senden, wischen zum Abbrechen.
- Aufnahme mit `AVAudioRecorder` als m4a, dazu eine Pegelanzeige.
- In `Package.swift` die Capability `.microphone(purposeString:)` ergänzen. Die Datei sagt zwar, sie werde automatisch erzeugt, wird aber trotzdem gepflegt wie bisher.
- Die Blase zeigt einen Play-Knopf und darunter das Transkript.

**Web/PC:** `MediaRecorder` (webm/opus), gleicher Ablauf, Knopf neben dem Senden-Feld. Electron braucht die Mikrofon-Berechtigung (`session.setPermissionRequestHandler` in `desktop/src/main.js`).

**Tests:** Audio-Route mit Mock-Transkription erzeugt eine Nutzernachricht und eine Antwort. Größenlimit greift.

## Paket 5 – Registrierung mit E-Mail-Code und Einführung (Profil)
**Ziel:** Neue Nutzer:innen registrieren sich, bestätigen per Code und klicken sich durch eine freundliche Einführung. Danach ist Stella auf ihr Leben eingestellt: Wer arbeitet, sieht keine Schulbücher.

**Server:**
- Registrierungsmodus `STELLA_REGISTRATION = closed | invite | open`, Standard `invite`.
- Tabelle `invites (code, created_by, used_by, created_at, expires_at)`. Der Owner erstellt Codes in den Einstellungen.
- Ablauf:
  1. `POST /api/auth/register` legt den Nutzer mit `verified = 0` an und schickt einen 6-stelligen Code per SMTP.
  2. Der Code gilt 15 Minuten, nach 5 Fehlversuchen ist Schluss, erneut senden geht frühestens nach 60 Sekunden.
  3. `POST /api/auth/verify` liefert die Session.
- Bestehende Nutzer und das Testkonto bekommen per Migration `verified = 1`. Die Login-Sperre aus `auth.ts` gilt auch hier.
- SMTP-Absender kommt aus den Server-Schlüsseln (Paket 1, Eintrag `smtp`), dafür nodemailer wiederverwenden (gibt es schon für `sendMail`).
- `DELETE /api/me` löscht das Konto samt Daten (Kaskade). Das ist für den öffentlichen Betrieb nötig und jetzt günstig zu bauen.
- Profil in `user.settings.profile`:
  - `situation`: school | university | work | apprenticeship | other
  - `ageGroup`
  - `workHours`: Tage + Zeit von/bis
  - `school`: Stufe, nur bei Schule
  - `university`
  - `features[]`: mails, planner, homework, shopping, goals, finance, health
- Beim Speichern:
  - Arbeitszeiten werden eine Gedächtnis-Routine mit `schedule`. Dadurch sind sie im Lagebild belegt, und der Wochenplaner plant nicht in die Arbeit.
  - Schulbücher, HÜ-Autopilot und WebUntis nur bei Schule.
  - Die Standard-Rechte richten sich nach dem Profil.
  - „Nach der Arbeit“ wird zum Ende der Arbeitszeit, sonst 17:30.
- `GET /api/me` liefert das Profil mit. Ein neuer Helfer `hasFeature(user, f)` steuert Server-Logik und Hinweise. Schul-Hinweise gibt es zum Beispiel nur bei Schule.

**Einführung in Web und iOS:** Klickbare Karten im Wolken-Stil, Fortschrittspunkte, jederzeit „Überspringen“. Die Schritte:
1. Willkommen.
2. Name.
3. Lebenssituation als große Karten mit Icon.
4. Altersgruppe.
5. Je nach Situation:
   - Schule: Stufe, WebUntis und Schulbücher (Links zu den vorhandenen Einrichtungen).
   - Studium: Uni, Kalender-Abo.
   - Job: Arbeitstage und -zeiten, Pendeln ja/nein.
6. „Wobei soll Stella helfen?“ als Chips mit Mehrfachauswahl.
7. Mail verbinden (optional, vorhandener Google-/iCloud-Weg).
8. Ton (nett/frech/cool).
9. Briefing-Zeit.
10. Fertig, mit Zusammenfassung „Das macht Stella jetzt für dich“.

Dazu:
- In den Einstellungen „Einführung wiederholen“ und „Profil“ zum Bearbeiten.
- Die Oberfläche blendet nicht passende Bereiche aus. Zum Beispiel: Schulbücher und HÜ-Filter nur bei Schule, Finanzen nur mit `finance`.
- Dateien: neue `web/src/components/Onboarding.tsx` und `ios/.../Views/OnboardingView.swift`. `LoginView.swift` und `App.tsx` werden um den Code-Schritt ergänzt.

**Tests:**
- Registrierung nur mit gültiger Einladung.
- Code-Ablauf: abgelaufen, falsch, Sperre.
- Profil erzeugt die Arbeitszeit-Routine.
- Der Wochenplaner meidet die Arbeitszeit.
- `hasFeature` blendet Schul-Hinweise aus.
- Konto löschen.

**Nutzer-Aufgabe:** Einen Absender für die Bestätigungs-Mails bereitstellen. Empfehlung: ein eigenes Gmail-Konto für Stella mit App-Passwort, eingetragen unter Einstellungen → Server → SMTP. Ein eigener Mail-Dienst geht später auch.

## Paket 6 – Chat-Erlebnis: Schnellaktionen, kurze Antworten, Wolken-Look
**Ziel:** Keine leere Eingabebox, Antworten wie von einem hilfsbereiten Kumpel, ein Chat, der nicht leer wirkt.

**Schnellaktionen:**
- Statt der festen `SUGGESTIONS` in `Chat.tsx` (und ihrem iOS-Gegenstück) kommen Chips nach Profil und Tageszeit.
- Neue Route `GET /api/quick-actions`. Mögliche Aktionen:
  - Foto schicken (Kamera)
  - Sprachnachricht
  - Einkaufsliste
  - Woche planen
  - Was ist neu in der Mail?
  - Ziel-Update
  - Ausgaben diese Woche
  - Hab ich was vergessen?
  - HÜ eintragen (nur Schule)
- Je Chip: Icon, Text und Aktion. Die Aktion fügt Text ein, schickt ihn sofort oder öffnet die Kamera bzw. das Mikrofon.
- Bei leerem Chat werden die Chips groß als Karten gezeigt (Begrüßung + 4 Karten), sonst als Zeile über dem Eingabefeld.

**Antwortstil:**
- Im System-Prompt (`server/src/assistant.ts`) und in `toneInstruction()`:
  - höchstens etwa 6 Zeilen
  - Aufzählungen statt Absätzen
  - Wichtiges **fett**
  - keine Überschriften, keine Floskeln
  - wie ein hilfsbereiter Kumpel, auch im Ton „nett“
- Die festen Texte in `voice.ts` auf Länge prüfen.
- Lange Ergebnisse (Wochenplan, Inbox-Übersicht) als Karten statt als Textblock.

**Wolken-Look:** Der ganze Chat-Hintergrund bekommt den Himmel-Verlauf mit sanften Wolken: Web `web/src/styles.css`, Klasse `.chat` und Seitenhintergrund; iOS `ChatView.swift` mit `Sky` und `Cloud`. Darauf liegt in der Mitte eine leicht durchscheinende, weiche Spalte in Weiß bzw. Milchglas, darin die Nachrichten. Wolken dürfen sich langsam bewegen; bei „Bewegung reduzieren“ stehen sie still. Beide Themes beachten.

**Tests:** quick-actions nach Profil (Schule vs. Job). Den Antwortstil per Mock prüfen: Der System-Prompt enthält die Regeln.

## Paket 7 – Einkaufsliste und Erledigungen mit Läden in der Nähe
**Ziel:** Man sagt Stella über den Tag verteilt, was man braucht. Sie erinnert zur passenden Zeit und schickt die nächsten Läden mit.

**Server:**
- Tabellen:
  - `lists (id, user_id, name, kind)`: kind `shopping` | `custom`, die Einkaufsliste gibt es immer.
  - `list_items (id, list_id, text, qty, done, added_via, created_at)`.
- Schnellwege im Parser (`shared/src/parser.ts`):
  - „schreib Milch auf die Einkaufsliste“, „wir brauchen Eier und Butter“ → mehrere Einträge
  - „was steht auf der Einkaufsliste?“
  - „Milch hab ich“ bzw. „hab eingekauft“ → abhaken
  - Alles mit Rückgängig über `record()`.
- Erledigung mit Ort:
  - „nach der Arbeit Blumen für meine Frau kaufen“ wird ein `reminder` zur Arbeitsende-Zeit (aus dem Profil) mit `place: { category: 'florist', label: 'Blumenladen' }` am Item.
  - Neues Feld `place` (JSON) an `items` per Migration.
- Zuordnung Wort → OpenStreetMap-Tag in `shared/src/places.ts`:
  - Blumen → `shop=florist`
  - Apotheke → `amenity=pharmacy`
  - Supermarkt/Einkauf → `shop=supermarket`
  - Bäcker → `shop=bakery`
  - Drogerie → `shop=chemist`
  - Post → `amenity=post_office`
  - Tankstelle → `amenity=fuel`
  - Baumarkt → `shop=doityourself`
  - Elektronik → `shop=electronics`
  - Trafik → `shop=tobacco`
  - Unbekanntes Wort → Groq schlägt einen Tag vor, mit Cache.
- `GET /api/places?category=&lat=&lon=` fragt die Overpass-API ab:
  - Radius 3 km, eigener User-Agent.
  - 24 h Cache pro Rasterzelle (etwa 500 m), Rate-Limit.
  - Antwort: die nächsten 3 Läden mit Entfernung, Öffnungszeiten (falls vorhanden) und einem Link zu Apple Maps bzw. OSM.

**Ablauf beim Erinnern:**
1. Push wie bisher.
2. Beim Öffnen fragt die App **einmal** den Standort ab (iOS `CLLocationManager.requestLocation`, Web `navigator.geolocation`) und ruft `/api/places` auf.
3. Im Chat erscheint eine Karte „🌸 Blumenläden in der Nähe“ mit 3 Einträgen, offen/geschlossen und dem Knopf „Route“.
4. Bei „Einkaufen“ kommt die Einkaufsliste mit dazu.

Kein Standort im Hintergrund, kein Speichern des Standorts über die Abfrage hinaus.

**UI:**
- Web: neue Komponente `Lists.tsx`.
- iOS: `ListsView.swift`.
- Einkaufsliste zum Abhaken, erreichbar über die Schnellaktion und unter „Heute“.

**Tests:**
- Parser-Fälle (deutsch, mehrere Dinge in einem Satz).
- „nach der Arbeit“ ergibt die Zeit aus dem Profil.
- Places mit Overpass-Mock: Sortierung nach Entfernung, Cache.

**iOS:** In `Package.swift` die Capability `.locationWhenInUse(purposeString:)`.

## Paket 8 – Ziele
**Ziel:** Ziele setzen, Fortschritt notieren, Stella erinnert und hilft beim Planen, ohne Gamification.

**Server:**
- Tabellen:
  - `goals (id, user_id, title, why, metric, unit, target, cadence, check_in, status, created_at)`
    - `metric` z. B. „km“ oder „Einheiten“
    - `cadence`: `daily` | `weekly:n` | `custom`
    - `check_in` z. B. „So 18:00“
    - `status`: active | paused | done
  - `goal_logs (id, goal_id, date, value, note, created_at)`
- Anlegen per Chat („ich will 3x pro Woche laufen gehen“):
  - Groq extrahiert die Struktur als JSON.
  - `perform('goal.create')` legt das Ziel an (neue Aktion in `actions.ts`), mit Karte und Rückgängig.
  - Anlegen geht auch über ein Formular.
- Fortschritt per Chat („war heute 5 km laufen“): Aktion `goal.log` mit Zuordnung zum passenden Ziel, Schnellweg plus Groq.
- Stella unterstützt:
  - Check-in-Erinnerung zur gewählten Zeit (Scheduler `every()` + `pushToUser`).
  - Wochenrückblick im Sonntags-Briefing.
  - Der Wochenplaner (`server/src/weekplan.ts`) plant Blöcke für Ziele mit Zeitbedarf, neuer `PlanBlock.why = 'goal'`.
  - Hinweis in `hints.ts`, wenn ein Ziel 2 Wochen ohne Eintrag ist.
- Bestehende Gedächtnis-Einträge der Kategorie `goal`: Stella schlägt einmal vor, sie in echte Ziele umzuwandeln.

**UI** (Web `Goals.tsx`, iOS `GoalsView.swift`):
- Liste der Ziele mit Fortschritt diese Woche als schlichter Balken und Zahl.
- Verlauf der letzten 8 Wochen als kleine Linie.
- Notizen, Pausieren, Bearbeiten.
- **Keine** Punkte, Serien oder Abzeichen.

**Tests:** Ziel per Chat (Mock-Groq), Fortschritt zuordnen, Check-in-Termin, Wochenplan-Block für ein Ziel.

## Paket 9 – Ausgaben über Apple Pay (Kurzbefehl)
**Ziel:** Stella sieht automatisch, was man mit Apple Pay ausgibt, und gibt einen Überblick.

**Server:**
- `POST /api/ingest/:token/payment` im bestehenden Ingest-Block in `main.ts`, mit `{ amount, currency, merchant, card, date }`.
- Tabellen:
  - `transactions (id, user_id, amount_cents, currency, merchant, category, card_label, occurred_at, source, created_at)`
  - `merchant_categories (user_id, merchant, category)`
- Kategorie: zuerst eigene Regeln, dann Groq einmal pro neuem Händler, mit Cache.
- Kategorien: Lebensmittel, Essen & Trinken, Transport, Shopping, Freizeit, Abos, Gesundheit, Sonstiges.
- Doppelte Meldungen unterdrücken: gleicher Betrag + Händler innerhalb von 2 Minuten.
- Optionales Monatsbudget pro Kategorie, mit Hinweis bei 80 % (`hints.ts`).
- Abo-Erkennung: gleicher Händler und Betrag monatlich.
- Chat-Werkzeug `spending_summary` für „wie viel hab ich diese Woche ausgegeben?“, mit Antwort als Karte.
- Gespeichert werden nur Betrag, Händler und Kartenname, keine Kartennummern.

**Einrichtung:**
- Anleitung in der App (Einstellungen → Ausgaben), nach dem Muster der bestehenden Kurzbefehl-Anleitungen für Gesundheit/SMS.
- Schritte: Kurzbefehle → Automation → „Transaktion“ (Wallet) → Karte wählen → „Sofort ausführen“ → Aktion „Inhalte von URL abrufen“ (POST, JSON mit Betrag/Händler) → URL zum Kopieren.
- Ein Testknopf schickt eine Probebuchung.

**UI** (Web `Finance.tsx`, iOS `FinanceView.swift`):
- Monatssumme, Balken nach Kategorie, Liste der Buchungen.
- Kategorie per Tippen ändern; Stella merkt sich das für den Händler.
- Abos und Budget.

**Tests:** Ingest mit gültigem und ungültigem Token, Duplikat-Schutz, Kategorie aus Regel vor Groq, Wochensumme, Budget-Hinweis.

## Paket 10 – „Was Stella vorhat“ (Aufgaben-Übersicht zum Bearbeiten)
**Ziel:** Man sieht, was Stella diese Woche und dauerhaft tut, und kann jede Aufgabe ändern oder abstellen.

**Server:**
- Daueraufträge: wiederkehrende Erinnerungen über `items.recurrence` per Migration (`daily` | `weekly:1,3` | `monthly:15`).
  - Parser: „erinnere mich jeden Montag an den Müll“, „jeden Tag um 8 Tabletten“.
  - Der Scheduler legt die nächste Instanz nach dem Feuern an.
- `GET /api/stella/plan` sammelt aus vorhandenen Quellen eine Liste `{ id, kind, title, when, recurrence, controls }`:
  - Briefing-Zeit
  - Sonntags-Wochenplan
  - Erinnerungen der nächsten 7 Tage
  - Daueraufträge
  - Ziel-Check-ins
  - Lerneinheiten und Planblöcke
  - automatische Mail-Sortierung
  - HÜ-Autopilot (nur Schule)
  - nächtliches Lernen
  - offene Vorschläge, die auf ein Ja warten
- Steuerung pro Eintrag (vorhandene Routen wiederverwenden):
  - Ein/Aus
  - Zeit ändern
  - Löschen bzw. Pausieren
  - Link zu „Was Stella selbst darf“
  - Änderungen laufen über Aktionen mit Rückgängig.

**UI:**
- „Heute“ bekommt die Karte „Stella diese Woche“ mit den nächsten 3 Dingen und „Alle ansehen“.
- Eigene Seite bzw. eigenes Sheet „Was Stella vorhat“ mit Gruppen „Diese Woche“, „Regelmäßig“ und „Langfristig (Ziele)“.
- Dateien: Web `StellaPlan.tsx`, iOS `StellaPlanView.swift`.

**Tests:** Wiederkehrende Erinnerung erzeugt die nächste Instanz, die Plan-Liste enthält alle Quellen, Abschalten wirkt.

## Später (bewusst nicht in dieser Runde): vor dem öffentlichen Start
- KI-Tageslimits pro Nutzer (die Zähler kommen in Paket 1).
- Datenschutzerklärung und AGB (DSGVO), Datenexport.
- Registrierung auf `open`.
- Missbrauchsschutz und Kosten pro Nutzer.
- Eigene Domain.
- Bankanbindung bzw. CSV-Import für Finanzen.
- Orts-Erinnerungen im Hintergrund.

## Verifikation (pro Paket und am Ende)
- Typecheck und Tests wie oben grün.
- Lokal mit `server/scripts/demo-seed.ts` und Playwright-Screenshots der Website prüfen (iPhone-Breite 430 px).
- Deploy mit `scripts/deploy-vps.sh`, danach `journalctl -u stella` ohne Fehler.
- iOS-CI grün, danach in Appetize mit `test` / `1` durchklicken. Das Testkonto bekommt neue Beispieldaten für Listen, Ziele und Ausgaben (`demo-seed.ts` erweitern).
- Ende zu Ende:
  - frische Installation zeigt einmal das EVOLSIOR-Intro, ein zweiter Start nur kurz Stella / by EVOLSIOR
  - neue Registrierung mit Einladung und Code bis zum fertigen Profil (Job)
  - Sprachnachricht „schreib Milch und Eier auf die Einkaufsliste“
  - „nach der Arbeit Blumen kaufen“ → Erinnerung mit Läden
  - Probebuchung über die Kurzbefehl-URL → erscheint unter Ausgaben
  - „Was Stella vorhat“ zeigt alles und lässt sich abschalten
