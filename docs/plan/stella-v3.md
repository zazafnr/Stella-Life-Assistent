# Stella v3: Arbeitsplan

> **So benutzt du diese Datei:** Öffne eine neue Session mit dem Repo `zazafnr/Stella-Life-Assistent`, füge diese Datei ein und schreib dazu: „Arbeite diesen Plan ab, Paket für Paket.“
> In Paket 0 legt die Session die Datei zusätzlich als `docs/plan/stella-v3.md` ins Repo, damit spätere Sessions sie finden.
> Die Pakete werden **der Reihe nach** abgearbeitet. Jedes Paket ist für sich lieferbar.

---

## Kontext

Stella v2 ist fertig und auf `main`: Pakete 0–12 aus `docs/plan/stella-v2.md`, also Registrierung mit Profil, Groq, Tages-Chats, Sprachnachrichten, Listen, Ziele, Ausgaben, „Was Stella vorhat“, Mail an Stella und das Firmen-Dashboard.

Der Nutzer hat neue Ideen gesammelt. Ziel dieser Runde ist es, Stella **bereit für zahlende Kund:innen** zu machen:
- echte Abos mit Limits und ein Modell-Router, der nach Kosten arbeitet (Claude Haiku 5.5 für leichte Aufgaben, Claude Sonnet 5.5 für schwere)
- Stella in mehreren Sprachen
- professionelle E-Mails mit Anmelde-Link
- Wetter-Animationen
- News im Briefing
- Telegram als Messenger
- Alltagsaufgaben wie Reservierungen und Verfügbarkeit
- Bildschirmzeit-Ziele

**Entscheidungen des Nutzers (stehen fest, nicht neu diskutieren):**
- **Abos:** Free, 8 €, 15 € und 35 € im Monat. Für den Start laufen fast alle Aufgaben über **Claude Haiku 5.5**. **Claude Sonnet 5.5** gibt es nur für schwere Aufgaben und nur mit Kontingent. Mehr Sonnet kommt erst, wenn Geld reinkommt. Alle Limits stehen in der Konfiguration, damit man sie ohne Code-Änderung anpassen kann.
- **Messenger:** zuerst **Telegram** (kostenlos, KI-Bots erlaubt). WhatsApp kommt später über dieselbe Kanal-Schnittstelle. Grund: Meta erlaubt allgemeine KI-Assistenten in der EU nur vorläufig und verlangt eine Gebühr pro Nachricht.
- **Finanzen:** bleiben vorerst **raus**. Der Bereich wird ausgeblendet, der Code bleibt erhalten (Paket 0).
- **FreeNotes:** ist noch nicht im App Store. Die Einführung zeigt deshalb eine Folie „Bald verfügbar“ mit dem Knopf „Benachrichtige mich“.
- **Sprachen:** Englisch ist Standard. Dazu kommen Deutsch, Spanisch, Französisch, Italienisch, Portugiesisch (Brasilien), Türkisch und Polnisch. Gefragt ist **echtes Übertragen statt wörtlicher Übersetzung**: Slogans und Texte müssen in jeder Sprache natürlich klingen.
- **Standort:** wird in der Einführung mit einer ehrlichen Erklär-Folie abgefragt. Stella **rät den Standort nicht aus den Chats**. Ohne Freigabe nimmt sie den ungefähren Ort aus der IP-Adresse, sonst das Land aus der Registrierung.
- **E-Mails:** HTML im Stil der Marke, mit Bildern und ohne Emojis. Die Bestätigung läuft über einen Link auf `login.stella.evolsior.com`. Auf demselben Gerät meldet der Link direkt an, auf einem anderen Gerät zeigt die Seite einen Code.
- **Keine Gamification:** keine Punkte, Serien oder Abzeichen (gilt seit Phase 1).

---

## Arbeitsweise (gilt für jedes Paket)

**Repo und Stack:**
- npm-Workspaces `shared/`, `server/` (Fastify + better-sqlite3 via tsx) und `web/` (React/Vite).
- Getrennt davon: `desktop/` (Electron, lädt die Website), `ios/Stella.swiftpm` (SwiftUI, Swift Playgrounds), `site-src/` → `site/` (Website evolsior.com), `dashboard/` (Firmen-Dashboard) und `workers/stella-mail` (Cloudflare-Worker für eingehende Mails an stella@).

**Prüfen vor jedem Commit:**
- `npx tsc -p shared --noEmit`, `npx tsc -p server --noEmit`, `npx tsc -p web --noEmit`
- `STELLA_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test`
- Server-Tests nutzen `node:test`. Muster: `server/src/phase4.test.ts` mit eigenem `STELLA_DATA_DIR` und einem Mock-LLM-Server. Für Claude kommt ein eigener Mock-Server dazu (Paket 1).

**DB-Migrationen:**
- Liegen im Array `MIGRATIONS` in `server/src/db.ts` (`user_version`).
- Neue Einträge **nur ans Ende** anhängen, alte nie ändern.

**Vorhandenes wiederverwenden, nicht neu erfinden:**

| Was | Wo |
|---|---|
| Aktionen mit Rechte-Stufe, Karte und Rückgängig: `perform()` / `record()` | `server/src/actions.ts` |
| Lagebild: `buildLagebild()` | `server/src/context.ts` |
| Feste Texte in drei Tönen: `voice()` (wird in Paket 2 mehrsprachig) | `shared/src/voice.ts` |
| Schnellwege ohne KI: `interpret()` | `shared/src/parser.ts` |
| Chat-Einstieg: `handleChat()` | `server/src/assistant.ts` |
| Sprachnachrichten: `handleAudio()` | `server/src/audio.ts` |
| LLM: `complete()`, `transcribe()`, `modelChain()`, Zähler `llm_usage` | `server/src/llm.ts` |
| Server-Schlüssel: `serverKey()`, `smtpKey()`, `KEY_NAMES` (Ablage verschlüsselt im System-Scope) | `server/src/keys.ts` |
| Mailversand: `sendSystemMail()` mit `MailKind` `noreply` / `stella`, Protokoll | `server/src/mailer.ts`, `maillog.ts` |
| Registrierung, Codes, Einladungen | `server/src/signup.ts` |
| Mail an Stella | `server/src/inbound.ts` |
| Läden in der Nähe (Overpass): `nearbyPlaces()`, `resolvePlace()` | `server/src/places.ts`, `shared/src/places.ts` |
| Unsichtbarer Browser | `server/src/browser.ts` |
| Briefing: `buildBriefing()`, `maybeSendBriefing()` | `server/src/briefing.ts` |
| Hinweise: `findHints()` / `deliverHint()` | `server/src/hints.ts` |
| Ziele | `server/src/goals.ts` |
| Scheduler: `every()` | `server/src/scheduler.ts` |
| Push: `pushToUser()` | `server/src/push.ts` |
| Dateien und Anhänge | `server/src/files.ts` |
| Web-Bausteine: `api()`, `sync()`, `useStore`, `Sheet`, `Switch`, `showToast`, `Icon`, `StarMark`, Himmel und Wolken | `web/src/ui/Decor.tsx` |
| iOS-Bausteine: `API.shared.send/get`, `Store`, `Theme`, `SmallButton`, `PrimaryButton`, `Pill`, `Sky`, `Cloud` | `Design/Decor.swift` |
| Einführung | `web/src/components/Onboarding.tsx`, `ios/.../Views/OnboardingView.swift` |
| Ladebildschirm | `ios/.../Views/LaunchView.swift`, Inline-HTML in `web/index.html` |

**Sprache und Stil:**
- Commits und Doku sind **deutsch**.
- App-Texte entstehen ab Paket 2 **nur noch über die Sprachkataloge**, nie fest im Code.
- Commit-Ende genau so, wie es die jeweilige Session vorgibt.

**Geheimnisse:**
- Keine Keys, Tokens oder Passwörter in Repo, Commits, Chat oder `deploy/ops exec`-Befehle. Das Repo ist öffentlich.
- Neue Server-Keys (`anthropic`, `stripe`, `telegram`) kommen in `KEY_NAMES` und werden in der App unter Einstellungen → Server eingetragen. Das gilt nur für den Owner, die Ablage ist verschlüsselt, Status und „Testen“ gibt es wie bei Groq.

**Deploy:**
- `scripts/deploy-vps.sh` über den Ops-Agent (Skill `vps-ops`, CLI `deploy/ops`).
- Danach `systemctl is-active stella` und `journalctl -u stella` prüfen.

**iOS:**
- Jeder Push mit `ios/**` baut in der CI (`.github/workflows/ios.yml`) und lädt zu Appetize hoch: https://appetize.io/app/7hedphqd45epodlt5k6olpxife (Testkonto `test` / `1`).
- Screenshots über den Skill `ios-preview`. Build-Fehler holst du mit `get_job_logs`.
- Swift: keine Tupel-KeyPaths.

**Pro Paket:**
1. Bauen, mit Tests und Typecheck.
2. Commit und Push auf den Arbeitsbranch, dann PR nach `main` und mergen (der Nutzer hat das so freigegeben).
3. Deploy und iOS-CI prüfen.
4. Kurzer Bericht auf Deutsch, mit Screenshots, wenn sich etwas sichtbar geändert hat.

Fragen an den Nutzer nur bei echten Entscheidungen. **Nutzer-Aufgaben** (Konten, DNS, Keys) stehen am Ende jedes Pakets. Wenn eine davon fehlt, das Paket fertig bauen, hinter einem Schalter lassen und die Aufgabe im Bericht nennen.

---

## Kosten und Abos (Grundlage für Paket 1 und 5)

**Preise laut Anthropic (pro 1 Mio. Tokens):**

| Modell | Eingabe | Ausgabe | Wiederholte Eingabe (Cache) | Hinweis |
|---|---|---|---|---|
| Haiku 5.5 (`claude-haiku-5-5`) | $0,10 | $0,50 | – | gilt bis 100K Tokens Prompt |
| Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | $0,20 | |

**Kosten pro KI-Nachricht** (rund 2 Modell-Aufrufe à 8K Tokens Eingabe, mit Werkzeugen):
- Haiku: etwa **0,2 Cent**
- Sonnet: etwa **3 Cent**
- Profi-Aufgabe mit Bild oder Websuche: etwa **5 Cent**
- Hintergrund (Mails, Lernen, Briefing, News): **0,30–0,80 € pro Nutzer und Monat**
- Etwa 40 % der Nachrichten kosten nichts, weil der Parser sie ohne KI versteht.

**Was pro Abo übrig bleibt** (20 % Umsatzsteuer, Stripe etwa 1,5 % + 0,25 €):

| Abo | bleibt übrig |
|---|---|
| 8 € | ≈ 6,30 € |
| 15 € | ≈ 11,80 € |
| 35 € | ≈ 28,60 € |

Bei einem Kauf über Apple (später) gehen weitere 15 % ab.

**Abos und Limits** (Startwerte in `shared/src/plans.ts`, vom Owner im Firmen-Dashboard bzw. in den Einstellungen änderbar):

| | **Free** | **Plus** 8 € | **Pro** 15 € | **Max** 35 € |
|---|---|---|---|---|
| KI-Nachrichten (Haiku) pro Tag | 15 | 60 | 120 | 300 |
| Profi-Aufgaben (Sonnet) pro Monat | 3 (nur HÜ lösen) | 15 | 40 | 150 |
| Kurznotizen, Planer, Erinnerungen ohne KI | unbegrenzt | unbegrenzt | unbegrenzt | unbegrenzt |
| Verbundene Postfächer | 1 | 2 | 4 | unbegrenzt |
| Telegram | ✓ | ✓ | ✓ | ✓ |
| News im Briefing | 3 Meldungen | 5 | 5 + Lieblingsquellen | 5 + Lieblingsquellen |
| Wetter-Animationen | ✓ | ✓ | ✓ | ✓ |
| Bildschirmzeit-Ziele | – | ✓ | ✓ | ✓ |
| Reservieren und Verfügbarkeit (Websuche) | – | zählt als Profi-Aufgabe | ✓ (zählt als Profi-Aufgabe) | ✓ (zählt als Profi-Aufgabe) |
| Vorrang bei Last, neue Funktionen früher | – | – | – | ✓ |
| **Kosten im schlimmsten Fall** | ≈ 1 € | ≈ 4,50 € | ≈ 10 € | ≈ 25 € |
| **Kosten im Durchschnitt** | ≈ 0,50 € | ≈ 1,50 € | ≈ 3 € | ≈ 6 € |

**Eine KI-Nachricht** ist eine Nutzernachricht, die ein Modell braucht. Werkzeug-Runden zählen nicht extra, Hintergrund-Arbeit zählt nicht.

**Eine Profi-Aufgabe** ist alles, was der Router auf Sonnet legt (Paket 1). Ist das Kontingent leer, macht Haiku weiter, und Stella sagt das in einem Satz.

---

## Paket 0 – Vorbereitung und Finanzen ausblenden

- Diese Datei als `docs/plan/stella-v3.md` ablegen. In `docs/ARCHITEKTUR.md`, Abschnitt 8, darauf verweisen.
- **Finanzen ausblenden, nicht löschen:**
  - Neuer Server-Schalter `features.finance = false` in `config.ts` (Env `STELLA_FEATURE_FINANCE`).
  - Ist er aus, liefert `hasFeature(user, 'finance')` immer `false`.
  - Der Chip „Ausgaben“ fehlt in der Einführung (`DEFAULT_FEATURES` / `FEATURES` in `Onboarding.tsx` und in `OnboardingView.swift`).
  - Ausgeblendet werden außerdem: der Tab bzw. Seitenlink (`App.tsx` Zeile mit `meHas(me, 'finance')`, iOS `FinanceView`-Einstieg), die Schnellaktion „Ausgaben diese Woche“, das KI-Werkzeug `spending_summary`, die Budget-Hinweise und der Eintrag in „Was Stella vorhat“.
  - Ingest-Route, Tabellen und Tests bleiben erhalten. Die Tests setzen den Schalter auf an.
- `README.md`: Finanzen aus „Was schon geht“ nehmen.

**Fertig wenn:** Ohne den Schalter taucht Finanzen nirgends mehr auf, und alle Tests sind grün.

---

## Paket 1 – Claude-Anbindung und Modell-Router nach Kosten

**Ziel:** Haiku 5.5 übernimmt den Großteil, Sonnet 5.5 die schweren Aufgaben. Jede Anfrage wird in Cent pro Nutzer gezählt. OpenRouter bleibt nur Notfall.

**Vorher lesen:**
- Den Skill `claude-api`: aktuelle Modell-IDs, Thinking/Effort, Prompt-Caching, Fallbacks, Websuche-Tool. **Nie aus dem Gedächtnis.**
- Das offizielle SDK `@anthropic-ai/sdk` nutzen, keinen OpenAI-Shim.

**Server:**
- Neuer Anbieter in `server/src/llm.ts`, oder sauberer in einer neuen Datei `server/src/claude.ts`, die `llm.ts` aufruft:
  - Umwandlung `LlmMessage[]`/`ToolDef[]` (OpenAI-Format, das der Agent heute benutzt) ↔ Anthropic-Messages: `tool_use`/`tool_result`-Blöcke, Bilder als `image`-Blöcke (base64 aus `files.ts`). Tool-Eingaben immer mit `JSON.parse` lesen.
  - `complete()` bekommt `opts.tier: 'light' | 'heavy'` und `opts.userId`. Die bestehenden Aufrufer bleiben kompatibel.
  - **light:**
    - Modell `claude-haiku-5-5`.
    - `output_config.effort`: `low` für Aufräumen, Titel und Kurzfassungen, `medium` für den Chat-Agenten.
  - **heavy:**
    - Modell `claude-sonnet-5-5`, Effort `medium`.
    - Fallback bei Ablehnung: `betas: ["server-side-fallback-2026-07-01"]` und `fallbacks: "default"`.
    - `stop_reason` immer prüfen (`refusal`, `max_tokens`).
  - **Keine Zwangs-Werkzeuge:** `tool_choice` nur `auto`. Die Werkzeuge bekommen `strict: true`.
  - **Prompt-Caching:**
    - Werkzeuge und der feste Teil des System-Prompts bekommen `cache_control`.
    - Lagebild, Datum und Gedächtnis kommen als **zweiter System-Block nach** dem Cache-Punkt. Keine Zeitstempel im festen Teil.
    - Mit `usage.cache_read_input_tokens` im Test prüfen.
  - Neuer Server-Key `anthropic` in `KEY_NAMES` (Env `ANTHROPIC_API_KEY`), mit „Testen“ in Einstellungen → Server.
- **Ausweichkette:**
  - Claude 429/5xx → einmal mit Backoff wiederholen → Haiku statt Sonnet → OpenRouter, aber **nur**, wenn der Owner `allowFreeFallback` eingeschaltet hat.
  - Mail-Inhalte gehen nie an Gratis-Anbieter (Datenschutz).
- **Router** (neue Datei `server/src/router.ts`), `pickTier(user, input)`:
  - **heavy**, wenn
    - ein Bild dabei ist und gelöst werden soll (HÜ-Autopilot, Arbeitsblatt-Foto),
    - der Wochenplaner die KI braucht (Stoff in Einheiten teilen),
    - eine Recherche ansteht (Paket 12) oder
    - die Nutzerin ausdrücklich „gründlich“ bzw. „genau“ sagt.
  - Sonst **light**.
  - Die Nachricht im Chat-Agenten ist also immer Haiku. Stellt Haiku fest, dass die Aufgabe zu schwer ist, ruft er das Werkzeug `escalate(reason)` auf. Dann wird der Turn einmal mit Sonnet wiederholt, sofern Kontingent da ist.
  - Kontingente prüft `checkQuota()` aus Paket 5. Bis dahin gibt es einen Stub, der alles erlaubt.
- **Kosten zählen:**
  - Migration: `llm_usage` um `model`, `input_tokens`, `output_tokens`, `cache_read_tokens` und `cost_micro_usd` erweitern.
  - Die Preise stehen in `config.ts`, `pricing` pro Modell und pro Mio. Tokens, damit man sie anpassen kann.
  - `usageToday()` bleibt kompatibel.
  - Neu: `costForUser(userId, from, to)` und `costTotals(from, to)`.
- **Groq** bleibt für Whisper und die Mail-Einordnung (sehr billig).
- Die Einstellungen → KI zeigen neu: Modell pro Stufe, Kosten heute und diesen Monat.

**Tests:**
- Neuer Mock-Server `server/src/testing/mockClaude.ts` im Format der Anthropic-Messages (Werkzeuge, `refusal`, 429).
- Umwandlung mit Werkzeug-Runde und Bild.
- Router: Bild → heavy, Text → light, `escalate` → Wiederholung mit Sonnet.
- Kosten-Rechnung.
- 429 → Ausweichkette.
- Caching: Der feste Teil ändert sich zwischen zwei Anfragen nicht (Snapshot des Prompts).

**Nutzer-Aufgabe:**
- Konto bei console.anthropic.com anlegen, 20–50 $ Guthaben laden.
- Den Key unter Einstellungen → Server → Anthropic eintragen.
- Ein Ausgabenlimit in der Console setzen.

---

## Paket 2 – Mehrsprachigkeit: Grundgerüst, Englisch und Deutsch

**Ziel:**
- Alle festen Texte (Web, iOS, Server, Mails, Push) kommen aus Sprachkatalogen.
- Englisch ist Standard. Deutsch ist komplett, und zwar als **österreichisches Deutsch für Schule** (HÜ, Schularbeit), wenn das Land AT ist, sonst „Hausaufgabe“ und „Klassenarbeit“.

**Aufbau:**
- `shared/src/i18n/`:
  - `locales.ts`: `LOCALES = ['en','de','es','fr','it','pt-BR','tr','pl']`, `DEFAULT_LOCALE = 'en'`, Name jeder Sprache in ihrer eigenen Sprache.
  - Kataloge `catalog/<locale>.json`: flache Schlüssel nach Bereich, z. B. `onboarding.situation.school.label`.
  - Platzhalter in der Form `{name}`, Mehrzahl über `Intl.PluralRules` (Schlüssel mit `#one/#other`).
  - `t(locale, key, vars)`: fehlt ein Schlüssel, zuerst Englisch, dann der Schlüssel selbst. In Tests schlägt ein fehlender Schlüssel fehl.
  - **Töne:** `voice.ts` wird zu Katalogschlüsseln mit Ton-Endung (`briefing.greeting.nett`, `.frech`, `.cool`). `voice(tone, locale)` behält seine Signatur und bekommt `locale` dazu. Alle Aufrufer bekommen `user.settings.locale`.
  - Datum und Zahlen über `Intl.DateTimeFormat` / `Intl.NumberFormat` mit Locale. Bei Datums-Texten in `shared/src/dates.ts` prüfen, ob sie in den Katalog gehören.
- **Länder-Wortschatz:** `school.terms` je Land (AT/DE/CH/…). Die Sprache bestimmt die Wörter, das Land die Schul-Begriffe.
- **Web:**
  - `web/src/i18n.ts` mit dem Hook `useT()`.
  - Alle Komponenten umstellen (`Chat.tsx`, `Planner.tsx`, `Settings.tsx`, `Onboarding.tsx` …). Das ist viel, aber mechanisch. Am besten Datei für Datei mit einem Such-Skript, das deutsche Texte in JSX findet.
  - `<html lang>` setzen.
- **iOS:**
  - Dieselben JSON-Kataloge als Ressource. Das neue Skript `scripts/gen-i18n.ts` kopiert sie nach `ios/Stella.swiftpm/Resources/i18n/`, und die CI prüft, ob sie aktuell sind.
  - `L("key", ["name": …])` in `Core/`.
  - Keine `.xcstrings`, damit Swift Playgrounds weiter funktioniert und alle Plattformen **eine** Quelle haben.
- **Server:**
  - Neue Einstellung `user.settings.locale` (Migration für Bestehende: `de`).
  - Neue Einstellung `country` (aus der Registrierung bzw. Einführung).
  - Pushes, Briefing, Hinweise und Mails nutzen die Sprache der Nutzerin.
- **KI:**
  - Der System-Prompt bleibt englisch (besser für das Modell). Dazu kommt die Regel: „Antworte immer auf {Sprache}, außer die Nutzerin schreibt in einer anderen Sprache, dann in dieser.“
  - `toneInstruction()` bekommt Beispiele je Sprache.
- **Parser** (`shared/src/parser.ts`):
  - Die deutschen Muster bleiben.
  - Englische Muster für den Kern kommen dazu: add to list, remind me, what's up, done, move/cancel, homework/test with date.
  - Für alle anderen Sprachen greift der Schnellweg nicht, und die Nachricht geht an Haiku. Das ist billig und schon im Kostenplan eingerechnet.
  - `interpret(text, { locale })`.
- **Whisper:** Die Sprache nicht mehr fest auf `de` setzen, sondern `user.settings.locale` als Hinweis geben (`language`-Parameter mit ISO-Code).
- **Sprache wählen:**
  - Erster Schritt der Einführung (Paket 6).
  - Einstellungen → Sprache.
  - Voreinstellung = Gerätesprache, falls unterstützt, sonst Englisch.

**Tests:**
- Jeder Schlüssel aus `en.json` existiert in `de.json` (Test schlägt sonst fehl).
- Kein deutscher Text mehr fest im Web-JSX. Heuristik-Test: Umlaute bzw. typische Wörter in `.tsx` außerhalb von Kommentaren.
- `voice()` für en/de in allen Tönen.
- Englische Parser-Fälle.
- Datumsformat je Locale.

---

## Paket 3 – Mehrsprachigkeit: die übrigen sechs Sprachen (echtes Übertragen)

**Ziel:** es, fr, it, pt-BR, tr und pl komplett, und zwar **so, als wäre Stella in der jeweiligen Sprache erfunden worden**.

**Regeln für die Texte** (gehören auch als `docs/i18n-stil.md` ins Repo):
- Nicht Wort für Wort übersetzen. Erst den Sinn und die Wirkung verstehen, dann so schreiben, wie eine Muttersprachlerin in dem Alter (Schüler:innen bis junge Berufstätige) es sagen würde.
- **Anrede:**
  - es, fr, it, pt-BR, tr, pl: per du (tú, tu, tu, você, sen, ty). Ausnahme: förmliche Mails an Schulen und Ämter, die Stella für jemanden entwirft.
  - Im Spanischen neutrales Spanisch, weder rein spanisch noch rein lateinamerikanisch.
- **Die drei Töne** haben in jeder Sprache ihren eigenen Witz. „Frech“ darf in Türkisch und Polnisch anders frech sein als im Deutschen. Nie beleidigend.
- **Schule je Land:** Schulbegriffe aus dem Land der Nutzerin, z. B. fr *devoirs*/*contrôle*, es *deberes*/*examen*, it *compiti*/*verifica*, pt-BR *lição de casa*/*prova*, tr *ödev*/*sınav*, pl *zadanie domowe*/*sprawdzian*/*kartkówka*.
- Die Länge muss in die Oberfläche passen. Bei längeren Sprachen (de, pl, pt) kürzer formulieren statt die Schrift zu verkleinern.
- **Slogans:**
  - Der Markenname **EVOLSIOR** und der Leitspruch **„Built to become“** bleiben in allen Sprachen englisch (Markenkern).
  - Der Stella-Slogan „Let Stella handle your life.“ wird übertragen. Vorschläge, beim Bauen prüfen und verbessern:

| Sprache | Slogan |
|---|---|
| de | „Stella kümmert sich um den Rest.“ |
| es | „Deja que Stella se encargue.“ |
| fr | „Laisse Stella s'en occuper.“ |
| it | „Lascia fare a Stella.“ |
| pt-BR | „Deixa com a Stella.“ |
| tr | „Gerisini Stella halleder.“ |
| pl | „Zostaw to Stelli.“ |

- Zu jeder Sprache kommt eine Datei `docs/i18n/<locale>-notizen.md` mit den Entscheidungen (Anrede, Schulbegriffe, Ton-Beispiele). Spätere Texte bleiben dadurch einheitlich.
- **Muttersprachliche Prüfung:** In den Bericht kommt eine Liste der 30 wichtigsten Texte je Sprache (Einführung, Slogan, Paywall, Briefing-Gruß, Fehlertexte). Die kann der Nutzer von Muttersprachlern gegenlesen lassen.

**Website:** `site-src/` bekommt die Sprachumschaltung für die Stella-Seite (`stella.body.html`) in allen acht Sprachen, mit `hreflang`. Firmenseite und Impressum bleiben englisch bzw. deutsch.

**Tests:**
- Alle Kataloge vollständig.
- Platzhalter stimmen überall mit `en` überein (gleiche `{…}`-Namen).
- Kein Text ist länger als 1,6 × die englische Länge, für Schlüssel mit `#short`.
- Screenshots der Einführung in allen acht Sprachen (Playwright, 430 px).

---

## Paket 4 – Neue E-Mails: Gestaltung und alle Vorlagen

**Ziel:** Jede Mail sieht aus wie von einer professionellen Firma: Marke, Bild, klarer Knopf, keine Emojis, in der Sprache der Nutzerin, mit einer Textversion für alte Mail-Programme.

**Wie die Mails heute aussehen**, nur reiner Text:
- Bestätigung (`signup.ts`): „Dein Stella-Code: 482913“ mit Code im Text.
- Adresse verknüpfen (`inbound.ts`): Code als Text.
- Antwort von Stella (`inbound.ts`): Text mit „– Stella“.
- Hinweis für unbekannte Absender (`NOTICE`).

**Bauen:**
- `server/src/email/`:
  - `layout.ts`: ein Grundgerüst, `renderEmail({ locale, preheader, hero, title, body[], button?, code?, footerNote? }) → { html, text }`. Keine schwere Abhängigkeit wie MJML.
    - Tabellen-Layout mit Inline-CSS, 600 px breit.
    - Bulletproof-Button (mit VML-Rückfall für Outlook).
    - `<meta name="color-scheme" content="light dark">` und dunkle Varianten über `@media (prefers-color-scheme: dark)`.
    - Unsichtbarer Vorschautext (Preheader).
  - `templates/`: je Mail eine Datei, die Texte kommen aus dem Sprachkatalog (Bereich `email.*`).
  - `markdown.ts`: Stellas Antworten (Markdown: fett, Listen, Links) als sicheres E-Mail-HTML, mit Escape.
- `sendSystemMail()` bekommt die Variante `sendTemplateMail(to, template, data, kind, extra)`. Nodemailer verschickt `html` + `text`. Die alte Text-Variante bleibt für Tests.
- **Gestaltung** im Stil der Website (`site-src/common.css`):
  - Kopf: schwarz `#09090B`, Stella-Stern und „Stella“ in Weiß, rechts klein „EVOLSIOR“ in Grau (Laufweite weit).
  - Bild: 1200×400 px (Retina), je Mailtyp ein ruhiger Himmel mit Wolken und Stern im App-Stil.
    - Erzeugt per Playwright aus einer kleinen HTML-Vorlage (`scripts/mail-art.ts`).
    - Abgelegt als PNG unter `site/public/mail/` (öffentlich auf `https://stella.evolsior.com/mail/…`).
    - **Keine SVG**, weil Gmail sie nicht zeigt.
    - Jedes Bild hat einen Alt-Text. Die Mail muss auch mit blockierten Bildern gut aussehen (Hintergrundfarbe statt Bild).
  - Inhalt: weiße Karte, Überschrift 26 px halbfett, Text 16 px, `#3F3F46`, Zeilenhöhe 1,55.
    - Schrift: `Geist` mit Rückfall auf Helvetica, Arial, sans-serif. Webfont nur dort, wo das Programm sie lädt.
  - Knopf: schwarz, weiße Schrift, 14 px Radius, 52 px hoch, ganze Breite auf dem Handy.
  - Code-Feld, wo nötig: Mono-Schrift, groß, mit Abstand zwischen den Ziffern, grauer Rahmen.
  - Fuß:
    - „Stella by EVOLSIOR · Built to become“
    - Firmenadresse und Impressum-Link (Pflicht für geschäftliche Mails in AT/DE)
    - Datenschutz-Link
    - „Du bekommst diese Mail, weil …“
- **Vorlagen:**
  1. `verify-signup`: „Bestätige deine Anmeldung“ mit Knopf, Link gilt 15 Minuten (Ablauf in Paket 5).
  2. `verify-address`: weitere Adresse für „Mail an Stella“ verknüpfen, mit Knopf.
  3. `login-link`: „Mit E-Mail-Link anmelden“ / „Passwort vergessen“ (neu, Paket 5).
  4. `welcome`: nach der Bestätigung. Drei Schritte zum Start als Karten mit kleinen Icons als PNG: „Stella in Telegram“, „App aufs Handy“, „Dein erstes Briefing“.
  5. `stella-reply`: Antwort auf eine Mail an Stella.
     - Antworttext gerendert.
     - Darunter **Karten** für das, was Stella getan hat, z. B. ein grauer Kasten „Eingetragen: Mathe-Schularbeit · Do, 12.11.“.
     - Unten der Knopf „Rückgängig machen“: ein signierter Link mit 7 Tagen Gültigkeit, der `undo` auslöst und eine kleine Bestätigungsseite zeigt.
     - Der Verlauf bleibt (In-Reply-To wie bisher).
  6. `unknown-sender`: Stella stellt sich vor und erklärt, wie man sich anmeldet.
  7. `subscription`: Abo gestartet, geändert oder gekündigt (Paket 5). Die Rechnungen schickt Stripe selbst.
- **Vorschau:**
  - Owner-Route `GET /api/admin/mail-preview/:template?locale=` zeigt das HTML mit Beispieldaten.
  - Dazu eine Seite im Firmen-Dashboard „E-Mails“ mit allen Vorlagen nebeneinander, hell und dunkel, Desktop- und Handy-Breite.
- **Zustellbarkeit:**
  - SPF, DKIM und DMARC für evolsior.com prüfen und im Bericht nennen.
  - `List-Unsubscribe` nur bei Werbe-Mails (gibt es nicht).
  - Text-Teil immer dabei.

**Tests:**
- Jede Vorlage rendert in allen acht Sprachen ohne fehlende Schlüssel.
- HTML enthält keinen ungeescapten Nutzertext (Test mit `<script>` im Namen).
- Textversion enthält Link bzw. Code.
- Rückgängig-Link: falsche Signatur → 403, abgelaufen → freundliche Seite.
- Screenshot-Test der Vorschau mit Playwright, damit das Layout nicht kaputtgeht.

**Nutzer-Aufgabe:** Firmenadresse für den Mail-Fuß angeben, mit `team@evolsior.com` als Antwortadresse.

---

## Paket 5 – Anmelde-Link statt Code und Abos mit Limits

### 5a – Bestätigung über `login.stella.evolsior.com`

**Ablauf:**
1. **Registrieren** (`startSignup` in `signup.ts`): Der Server legt einen Eintrag in der neuen Tabelle `login_requests` an:
   - `id`, `user_id`, `purpose` (`signup` | `login` | `address`), `token_hash`, `code_hash`, `device_hash`, `created_at`, `expires_at`, `used_at`, `attempts`, `ip`, `user_agent`.
   - Das Gerät bekommt zurück:
     - `requestId` und ein zufälliges `deviceSecret`. Die App speichert es im Keychain, der Browser im `localStorage`.
     - Im Browser zusätzlich ein **Cookie** `stella_pending` mit `Domain=stella.evolsior.com; HttpOnly; Secure; SameSite=Lax; Max-Age=900`. Dadurch kommt es auch auf `login.stella.evolsior.com` an.
2. **Die Mail** (`verify-signup`) enthält den Knopf mit `https://login.stella.evolsior.com/v/<token>` (32 Byte, base64url, nur der Hash wird gespeichert).
3. **Die Seite unter dem Link** liefert der Stella-Server aus (neuer Host im Caddy-Block, Route nach `Host`):
   - Ein GET **verbraucht nichts**. Mail-Scanner (Outlook Safe Links, Gmail) öffnen Links automatisch.
   - **Gleiches Gerät:** Das Cookie `stella_pending` passt zur Anfrage. Die Seite schickt per JavaScript `POST /api/auth/link/confirm`, die Anmeldung ist bestätigt, die Session wird gesetzt, und es geht weiter auf `stella.evolsior.com` („Du bist angemeldet“, weiter zur Einführung). Ohne JavaScript gibt es einen Knopf „Anmeldung abschließen“.
   - **iOS-App:** Ist die App installiert, öffnet der Link sie über einen **Universal Link** (`applinks:login.stella.evolsior.com`, Datei `/.well-known/apple-app-site-association`). Die App schickt Token und `deviceSecret` und ist angemeldet.
   - **Anderes Gerät** (kein Cookie, kein passendes Secret): Die Seite zeigt groß den **6-stelligen Code**, gültig 15 Minuten.
     - Text: „Gib diesen Code auf dem Gerät ein, auf dem du dich gerade anmeldest.“
     - Darunter Gerät, Browser, ungefährer Ort und Uhrzeit der Anfrage: „Das warst nicht du? Dann ignoriere die Mail.“
   - Das wartende Gerät zeigt „Wir haben dir einen Link geschickt“, ein Code-Feld und den Knopf „Mail erneut senden“ (frühestens nach 60 s).
4. **Sicherheit:**
   - Ein Klick auf einem fremden Gerät meldet **nie** das wartende Gerät an. Sonst könnte jemand Fremdes eine Anmeldung starten, die das Opfer per Klick freigibt.
   - Die Freigabe geht nur über den abgetippten Code.
   - Bestehende Regeln: 5 Fehlversuche, 15 Minuten, Login-Sperre aus `auth.ts`.
   - Token und Code nur als Hash speichern, Vergleich mit `timingSafeEqual`.
5. **Dasselbe gilt für:**
   - Adresse verknüpfen (`inbound.ts`). Die Code-Variante dort bleibt als Rückfall.
   - **Neu:** „Passwort vergessen“ / „Mit E-Mail-Link anmelden“ im Login (Web und iOS). Danach kann man ein neues Passwort setzen.
6. **Website-Seiten** für `/v/…`: im Schwarz-Weiß-Stil der Website, mehrsprachig (Sprache der Anfrage) und für das Handy gebaut.

**Infrastruktur:**
- `deploy/Caddyfile` und `deploy/install-vps.sh`: zusätzlicher Name `login.stella.evolsior.com` im Stella-Block.
- `config.loginUrl`, Env `STELLA_LOGIN_URL`.
- iOS:
  - Associated Domains brauchen die Team-ID (`teamIdentifier` in `Package.swift`, heute leer).
  - Ohne Team-ID öffnet sich Safari, die Seite zeigt den Code, und man tippt ihn in die App. Das funktioniert also auch ohne bezahltes Konto.

**Tests:**
- Gleicher Browser → direkt angemeldet.
- Fremdes Gerät → Code wird gezeigt, ist einmal verwendbar und meldet nur das wartende Gerät an.
- GET verbraucht nichts.
- Abgelaufen, falscher Code, Sperre.
- „Passwort vergessen“ Ende zu Ende mit Mail-Mock.

**Nutzer-Aufgaben:**
- In Cloudflare-DNS `login.stella` als A-Record auf die VPS-IP eintragen.
- Für Universal Links: Apple-Developer-Konto (99 $/Jahr) und Team-ID mitteilen.

### 5b – Abos, Limits und Bezahlung

**Server:**
- `shared/src/plans.ts`: `PLANS` mit `id` (`free` | `plus` | `pro` | `max`), Preisen, Limits und Funktionen, genau wie in der Tabelle oben. `planFeatures(plan)`.
- Migration:
  - `subscriptions (user_id PK, plan, status, provider, provider_customer, provider_sub, current_period_end, cancel_at, updated_at)`
  - `usage_counters (user_id, period, kind, count)`. `kind` ist `ai_message` (Tag) bzw. `pro_task` (Monat), Zeitzone der Nutzerin.
- `checkQuota(user, kind)` und `consume(user, kind)`, angebunden an den Router aus Paket 1:
  - Ist das Tageslimit für KI-Nachrichten erreicht, gibt es eine freundliche Nachricht im Ton der Nutzerin. Kurznotizen gehen weiter, mit Hinweis auf das nächste Abo, das kommt aber höchstens einmal am Tag.
  - Profi-Aufgaben leer → Haiku macht weiter, und Stella sagt das in einem Satz.
- `hasFeature()` berücksichtigt das Abo (z. B. Bildschirmzeit erst ab Plus, Zahl der Postfächer).
- **Stripe:**
  - Neuer Server-Key `stripe`: Secret Key + Webhook-Secret.
  - Produkte und Preise per Skript `scripts/stripe-setup.ts` anlegen, in EUR und monatlich. Jahresabo mit 2 Monaten gratis als Option.
  - Steuer über **Stripe Tax**, damit die Umsatzsteuer in der EU je Land stimmt (OSS).
  - Routen:
    - `POST /api/billing/checkout` → Stripe Checkout
    - `POST /api/billing/portal` → Kundenportal (kündigen, wechseln, Rechnungen)
    - `POST /api/billing/webhook`: Signatur prüfen, `checkout.session.completed`, `customer.subscription.updated/deleted` verarbeiten und dabei idempotent bleiben (Event-ID speichern).
- Der Owner kann Abos **schenken** (Tester, Freunde): `provider = 'gift'` mit Ablaufdatum, in den Einstellungen bzw. im Dashboard.
- Bestehende Nutzer bekommen per Migration `max` als `gift` ohne Ablauf.

**App (Web, iOS):**
- Einstellungen → **Abo**:
  - Aktuelles Abo.
  - Verbrauchsbalken: „Heute 12 von 60 KI-Nachrichten“, „Diesen Monat 3 von 15 Profi-Aufgaben“.
  - Vergleichstabelle der Abos.
- Web: Knopf „Upgrade“ → Checkout.
- **iOS:** Vorerst **kein** Kauf in der App (Apple-Regeln). Die App zeigt nur Abo und Verbrauch; „Abo verwalten“ gibt es erst, wenn In-App-Kauf gebaut ist (siehe „Später“). Für TestFlight und die Testphase reicht das.
- Die Paywall-Texte stehen im Sprachkatalog, in allen Tönen, nie aufdringlich.

**Firmen-Dashboard** (`dashboard/`):
- Nutzer pro Abo, Umsatz pro Monat (MRR).
- KI-Kosten pro Abo und pro Nutzer (Durchschnitt und 95. Perzentil).
- Marge pro Abo.
- Top 10 der teuersten Nutzer.
- Limits ändern ohne Deploy (Overrides in `settings` des System-Scopes, `plans.ts` liefert die Startwerte).

**Tests:**
- Limits je Abo.
- Wechsel des Tages in der Zeitzone.
- Webhook mit Stripe-Testsignatur (Mock).
- Geschenkte Abos laufen ab.
- Leere Profi-Aufgaben → Haiku-Rückfall.
- `hasFeature` je Abo.

**Nutzer-Aufgaben:**
- Stripe-Konto für EVOLSIOR mit Firmendaten und Bankkonto anlegen.
- Stripe Tax aktivieren.
- Keys unter Einstellungen → Server eintragen.
- Webhook-URL `https://stella.evolsior.com/api/billing/webhook` in Stripe hinterlegen.

---

## Paket 6 – Einführung: Sprache, Standort, FreeNotes

Erweiterung der bestehenden Einführung (`StepId` in `Onboarding.tsx`, `OnboardingView.swift`). Neue Reihenfolge:

1. **Sprache** (neu, vor „Willkommen“): große Karten mit dem Namen der Sprache in der eigenen Sprache. Die Gerätesprache ist vorgewählt, sonst Englisch. Ab dann ist die ganze Einführung in dieser Sprache. Dazu kommt das **Land** (für Schulbegriffe, News und Wetter-Rückfall): vorgewählt aus der Region des Geräts bzw. `Accept-Language`, änderbar.
2. Willkommen
3. Name
4. Lebenssituation
5. **Bei „Schule“ (neu): FreeNotes**
   - Eine Folie mit Bild der FreeNotes-App: Heft mit Handschrift, als Screenshot aus dem Notes-Repo bzw. ein gestaltetes Mockup.
   - Text: „Stella schreibt deine Hausübungen in deiner Handschrift in FreeNotes.“ (Schulwort je Land)
   - Da FreeNotes **noch nicht verfügbar** ist: Knopf „Benachrichtige mich, wenn's losgeht“. Er setzt `settings.notify.freenotes = true`, und Stella schickt später eine Push-Nachricht und eine Mail.
   - Dazu „Weiter“.
   - Der Server-Schalter `config.freenotesUrl` stellt die Folie auf „Jetzt laden“ um, sobald es einen Link gibt.
6. Altersgruppe
7. Details je Situation
8. „Wobei soll Stella helfen?“ (ohne Ausgaben, siehe Paket 0)
9. **Standort (neu):** eine eigene Erklär-Folie **vor** der Systemabfrage. iOS fragt nur einmal; wer ablehnt, muss es danach selbst in den iOS-Einstellungen ändern.
   - Überschrift sinngemäß: „Damit Stella weiß, was um dich herum los ist“.
   - Drei ehrliche Gründe mit Icons, so formuliert, dass sie wirklich überzeugen:
     1. Läden und Apotheken in der Nähe, wenn sie dich an Erledigungen erinnert.
     2. Restaurants finden und Reservierungen vorbereiten.
     3. Wetter und lokale News für dein Morgen-Briefing („Nimm einen Schirm mit“).
   - Klein darunter: „Nur während du Stella benutzt. Dein genauer Standort wird nicht gespeichert.“
   - **Wichtig:** Hier darf **nichts** stehen, wofür Stella den Standort nicht wirklich nutzt. Apple lehnt Apps mit irreführenden Begründungen ab (Richtlinie 5.1.1).
   - Knöpfe: „Standort freigeben“ (löst die Systemabfrage aus) und „Später“.
   - Der Begründungstext in `Package.swift` (`.locationWhenInUse(purposeString:)`) wird angepasst, inhaltlich gleich, englisch als Standard. iOS zeigt den Begründungstext in der Systemsprache. Zur Mehrsprachigkeit dieser Systemtexte siehe die Notiz in Paket 13.
10. Mail verbinden, Ton, Briefing-Zeit (wie bisher)
11. Fertig

**Server:** Das Profil speichert `locale`, `country` und `locationPermission` (`granted` | `denied` | `later`). Wer „Später“ gewählt hat, wird beim ersten Erledigungs-Reminder oder der ersten Restaurant-Frage noch einmal gefragt, mit derselben Erklärung als Karte im Chat.

**Tests:** Die Schritt-Reihenfolge stimmt je Situation (Schule zeigt FreeNotes, Job nicht). Sprache wechseln schaltet alle Texte sofort um. „Benachrichtige mich“ setzt das Flag.

---

## Paket 7 – Wetter und Standort (Daten)

**Ziel:** Beim Start ist das Wetter **sofort** da, ohne Warten. Der Ladebildschirm dauert nur so lange, wie die App lädt, also etwa eine Sekunde.

**Ablauf beim Start:**
1. Die App zeigt **sofort** das zuletzt gespeicherte Wetter: iOS `@AppStorage("lastWeather")`, Web `localStorage` mit try/catch. Gespeichert werden Wettertyp, Tag oder Nacht, Temperatur, Ort (gerundet) und Zeitpunkt. Ist es älter als 3 Stunden, gilt es nur noch als Startbild.
2. Parallel dazu, nie blockierend:
   - **Standort freigegeben:** iOS `CLLocationManager.requestLocation()` mit `kCLLocationAccuracyKilometer` (schnell), Web `getCurrentPosition({ maximumAge: 30 min, timeout: 1500, enableHighAccuracy: false })`.
   - Danach Wetter direkt bei **Open-Meteo** abrufen (kostenlos, ohne Key, CORS erlaubt): `current=weather_code,temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover` und `daily=sunrise,sunset`. Timeout 2 s.
   - **Kein Standort:** `GET /api/weather/approx`. Der Server bestimmt den ungefähren Ort aus der **IP-Adresse** über die lokale Datenbank **DB-IP Lite (City)**: mmdb, kostenlos auch kommerziell nutzbar, Quellenangabe in den Datenschutzinfos. Die Datenbank wird monatlich per Skript aktualisiert, die Bibliothek ist `maxmind`. Danach Open-Meteo vom Server aus, 10 Minuten Cache pro Rasterzelle.
   - Klappt das nicht: Hauptstadt des Landes aus dem Profil.
   - Bei mobilen Netzen kann die IP-Adresse weit danebenliegen. Deshalb kommt für Nutzer ohne Freigabe der zuletzt bekannte gute Ort (gerundet) dazu, wenn er weniger als 7 Tage alt ist.
3. Weicht das neue Wetter ab, blendet die Szene weich über (2 s).

**Wettertypen** (Abbildung der WMO-Codes in `shared/src/weather.ts`):
- `clear`, `partly`, `cloudy`, `fog`
- `drizzle`, `rain`, `heavy_rain`
- `thunder`
- `snow`, `sleet`
- jeweils mit `day`/`night` und Wind in Stufen 0–3 (für Regen- bzw. Schneewinkel)

**Speichern:**
- Server: nur der **gerundete Ort** (2 Nachkommastellen, etwa 1 km) in `user.settings.lastPlace`, für Briefing, News und Wetter. Der genaue Standort wird nur in dem Moment genutzt (Läden, Restaurants) und nicht gespeichert, wie bisher.
- Datenschutzinfos aktualisieren.

**Briefing:**
- Eine Wetterzeile kommt dazu, z. B. „Heute 14°, ab 15 Uhr Regen“ bzw. im Ton des Nutzers „Schirm einpacken“.
- Daten von Open-Meteo `hourly=precipitation_probability` für den gerundeten Ort.

**Owner-Testschalter:** Einstellungen → Entwickler → „Wetter erzwingen“ (alle Typen, Tag und Nacht). Wird für Screenshots und Abnahme gebraucht.

**Tests:**
- WMO-Abbildung.
- IP-Rückfall mit Test-mmdb oder Mock.
- Cache.
- Das Wetter blockiert den Start nicht (Test: Fetch hängt → die App ist trotzdem bereit).

---

## Paket 8 – Wetter-Animationen (Chat und Ladebildschirm)

**Ziel:** Das soll der Moment sein, in dem Leute die App ihren Freunden zeigen. **Mach dir hier richtig Arbeit.** Aufwendig gemacht, aber nicht kitschig, und die Chat-Blasen bleiben immer gut lesbar.

**Technik:**
- **Web/PC:** `web/src/weather/` mit einer kleinen eigenen Engine auf **`<canvas>`** (2D, `devicePixelRatio` beachten) hinter dem Chat bzw. Ladebildschirm.
  - `requestAnimationFrame`, Pause bei `visibilitychange`.
  - Keine fremde Bibliothek nötig.
  - Der Inline-Ladebildschirm in `web/index.html` bekommt eine abgespeckte Fassung (CSS + kleines Inline-Skript) mit dem gespeicherten Wetter aus `localStorage`.
- **iOS:** `Design/Weather/` mit SwiftUI **`TimelineView(.animation)` + `Canvas`**. Für viele Teilchen ist SpriteKit (`SpriteView`) erlaubt, wenn `Canvas` nicht flüssig genug ist.
  - Eingebunden hinter `ChatView` und in `LaunchView`.
  - Die vorhandenen `Sky`/`Cloud` werden Teil der neuen Szene, nicht doppelt.
- Die Szene hat Schichten (von hinten nach vorn):
  1. Himmelsverlauf
  2. Sonne bzw. Mond und Sterne
  3. ferne Wolken
  4. nahe Wolken
  5. Niederschlag
  6. Effekte am Glas: Tropfen bzw. Schneerand
  7. Blitz-Licht

**Die Szenen:**
- **Sonnig (Tag):**
  - Warmer Verlauf (oben hellblau, zum Horizont fast weiß).
  - Weiches Sonnenleuchten oben rechts mit ganz langsam pulsierendem Schein.
  - Feine Lichtstrahlen (God Rays) mit niedriger Deckkraft, die sich minimal drehen.
  - Ein bis zwei kleine Schönwetterwolken ziehen sehr langsam.
- **Leicht bewölkt / bewölkt:**
  - 3 Wolkenebenen mit Parallaxe: hinten langsam und blass, vorn schneller und voller.
  - Wolken als weiche Formen aus mehreren überlagerten Kreisen mit Blur, keine Clipart.
  - Bei „bewölkt“ ist der Himmel grauer und dichter.
- **Nebel:** 2–3 große, halbtransparente Rausch-Schwaden (Perlin bzw. Simplex), die seitlich gleiten. Der Himmel wird entsättigt.
- **Nieselregen / Regen / Starkregen:**
  - Tropfen als kurze, leicht schräge Striche (Winkel aus der Windstufe) in **3 Tiefenebenen**: hinten dünn, langsam und blass, vorn länger, schneller und heller.
  - Bei Starkregen mehr Tropfen und zusätzlich Schleier-Böen.
  - **Am unteren Rand** kleine Aufprall-Spritzer (2–3 Punkte, die kurz auseinanderfliegen).
  - **Glaseffekt** oben über der Kopfzeile: einige große Tropfen „auf der Scheibe“. Sie stehen, wachsen ab und zu, rutschen dann mit leichter Schlangenlinie nach unten und hinterlassen eine Spur, mit leichter Lichtbrechung (Glanzpunkt + dunkler Rand).
  - Der Himmel ist dunkler blaugrau, die Wolken dicht.
  - Teilchenzahl: Niesel ~60, Regen ~180, Starkregen ~350 auf dem Handy, mehr auf großen Bildschirmen, gedeckelt.
- **Gewitter:**
  - Wie Starkregen, dazu **Blitze**: ein prozedural gezeichneter Blitz (verzweigter Pfad aus zufällig versetzten Segmenten, heller Kern, weicher Schein), 80–150 ms sichtbar, mit Nachglühen.
  - Gleichzeitig hellt der ganze Himmel kurz auf (2 Stufen: Hauptblitz und kleiner Nachblitz).
  - Abstand zufällig 6–20 s.
  - **Höchstens 1 Blitz in 5 Sekunden** und nie mehr als 3 Lichtwechsel pro Sekunde (WCAG 2.3.1 zu Lichtblitzen).
  - Die Helligkeit des Aufhellens ist gedeckelt, sodass die Blasen lesbar bleiben.
  - Optional ein leichtes haptisches Feedback auf iOS beim Hauptblitz. Standard aus, in den Einstellungen.
- **Schnee:**
  - Flocken in 3 Größen bzw. Tiefen. Sie fallen langsam und pendeln seitlich (Sinus mit eigener Phase), drehen sich leicht (größere Flocken als 6-strahlige Sterne, kleine als weiche Punkte).
  - Wind schiebt sie schräg.
  - Am unteren Rand bildet sich über einige Minuten ein ganz flacher Schneerand (gedeckelt, nicht über dem Eingabefeld).
  - Kühler, heller Himmel.
- **Schneeregen:** gemischt, wenige Flocken und dünne Tropfen.
- **Nacht** (alle Typen, Sonnenauf- und -untergang von Open-Meteo):
  - Tiefblauer Verlauf und Mond (Phase grob nach Datum).
  - Bei klarem Himmel ein **Sternenhimmel** mit leichtem Funkeln. *Stella* heißt Stern, das ist der Markenmoment.
  - Selten (etwa alle 1–3 Minuten) eine **Sternschnuppe**, die quer zieht.
  - In der Dämmerung (±45 Minuten um Sonnenauf- und -untergang) warme Orange- und Rosatöne am Horizont.

**Lesbarkeit und Gestaltung:**
- Der Niederschlag liegt **hinter** den Blasen. Die Chat-Spalte bleibt das leicht durchscheinende Milchglas aus v2 Paket 6.
- Bei dunklen Szenen (Gewitter, Nacht) gelten kontraststarke Blasenfarben (Text-Kontrast ≥ 4,5:1, mit Test). Beide Themes (hell/dunkel) beachten.
- Übergänge zwischen Wetterlagen werden weich überblendet (2 s), nie springen.

**Leistung und Akku:**
- Ziel 60 Bilder pro Sekunde auf einem iPhone 12. Bei Bilderverlust automatisch weniger Teilchen.
- Im Stromsparmodus (`ProcessInfo.isLowPowerModeEnabled`) und auf schwachen Geräten: halbe Teilchenzahl, keine Glas-Tropfen.
- Animation pausieren, wenn die App im Hintergrund ist, oder auf dem Web der Tab verborgen.
- **„Bewegung reduzieren“** (iOS, Web `prefers-reduced-motion`): ein ruhiges Standbild der Szene, keine Blitze und kein Funkeln.
- Einstellungen → Darstellung → „Wetter-Animationen“: an / ruhig / aus.

**Ladebildschirm:** dieselbe Szene, darüber Stern und „Stella by EVOLSIOR“ wie bisher. Die Dauer bleibt **die echte Ladezeit** (v2 Paket 0b), das Wetter verlängert sie nicht.

**Abnahme:**
- Für jede Szene (11 Typen × Tag und Nacht) gibt es kurze Videos bzw. Bildfolgen: Web per Playwright mit Zeitstempeln, iOS per Appetize bzw. `ios-preview`.
- Die Bilder kommen in den Bericht. Kriterium: wirkt hochwertig und ruhig, nicht hektisch, Text immer lesbar.
- FPS-Messung im Web per Playwright-Trace dokumentieren.

---

## Paket 9 – Sprachnachrichten: sauberer Text im Chat

**Stand heute:** `handleAudio()` schreibt per Groq/Whisper ab und zeigt Audio-Player plus Rohtext (`Chat.tsx`, `ChatView.swift`).

**Neu:**
- **Aufräumen:**
  - Nach Whisper bereinigt Haiku den Text (`tier: 'light'`, Effort `low`): Satzzeichen, Groß- und Kleinschreibung, Füllwörter raus („ähm“, „also“, „halt“ am Satzanfang …), Wiederholungen und Versprecher glätten, Absätze bei Themenwechsel.
  - Der Text bleibt in der gesprochenen Sprache.
  - **Nie** Inhalt dazuerfinden oder umdeuten, Zahlen, Daten und Namen unverändert lassen. Prompt mit Beispielen.
  - Bei sehr kurzen Nachrichten (unter 6 Wörtern) nur Satzzeichen setzen.
  - Zählt **nicht** als KI-Nachricht.
- **Speichern:** `transcript_raw` und `transcript` am Anhang. Der Agent bekommt den bereinigten Text.
- **Anzeige** (Web und iOS):
  - Die Blase sieht aus wie eine getippte Nachricht, mit demselben Stil, normalem Text und Markdown.
  - Darüber eine kleine, dezente Zeile: Mikrofon-Icon + „Per Sprachnachricht · 0:12“ + kleiner Play-Knopf. Antippen spielt das Original ab.
  - Langes Drücken → „Original-Abschrift anzeigen“.
- Fällt die Bereinigung aus, gilt der Rohtext. Es gibt keinen Fehler für die Nutzerin.

**Tests:** Bereinigung mit Mock (Zahlen bleiben gleich), kurze Nachricht, Ausfall → Rohtext, Anzeige-Zeile vorhanden.

---

## Paket 10 – Telegram (und Grundlage für WhatsApp)

**Ziel:** Mit Stella in Telegram schreiben, genau wie im App-Chat: Text, Sprachnachrichten, Fotos, Einträge, Rückgängig. Stella meldet sich dort auch von selbst (Briefing, Erinnerungen, Hinweise), wenn man das will.

**Kanal-Schnittstelle** (`server/src/channels/`):
- `channel.ts`:
  - Interface `Channel { id: 'telegram' | 'whatsapp' | 'email'; send(userId, message: OutboundMessage); }`
  - `OutboundMessage = { text, buttons?: { label, action }[], card? }`
- `deliver.ts`:
  - `notify(userId, payload)` wählt nach `user.settings.notifyVia` (`push`, `telegram`, mehrere möglich) und ersetzt die direkten `pushToUser()`-Aufrufe in `briefing.ts`, `hints.ts`, Erinnerungen und Zielen.
  - `pushToUser` bleibt der Push-Kanal.
- Karten werden pro Kanal umgewandelt: Telegram als Text mit Inline-Knöpfen. Die App-Karte bleibt im App-Chat.
- `inbound.ts` (Mail) **nicht** umbauen. Es darf aber `deliver` nutzen, wenn es passt.

**Telegram:**
- Server-Key `telegram` (Bot-Token von @BotFather), eingetragen unter Einstellungen → Server.
- Beim Speichern ruft der Server `setWebhook` auf, mit `https://stella.evolsior.com/api/channels/telegram/webhook` und `secret_token`. Der Header `X-Telegram-Bot-Api-Secret-Token` wird geprüft.
- **Verknüpfen:**
  - Einstellungen → Telegram → „Mit Telegram verbinden“ erzeugt einen Einmal-Token (10 Minuten) und öffnet `https://t.me/<BotName>?start=<token>`.
  - Der Bot bekommt `/start <token>` und speichert die Verknüpfung in der neuen Tabelle `channel_links (user_id, channel, external_id, created_at)` (eindeutig je Kanal und externer ID).
  - Danach begrüßt Stella die Nutzerin in Telegram, in ihrer Sprache und ihrem Ton.
  - Trennen geht in der App oder mit `/stop` im Bot.
- **Eingehend:**
  - **Text** → `handleChat()`. Die Nachrichten landen in derselben Tages-Konversation wie in der App, mit Markierung `via: 'telegram'`, in der App als kleines Telegram-Symbol.
  - **Sprachnachricht** (OGG/Opus) → `getFile` → `handleAudio()` mit Bereinigung aus Paket 9.
  - **Foto** → Anhang (`files.ts`) → `handleChat()` mit Bild, also auch der HÜ-Autopilot.
  - Unbekannte Chats bekommen eine kurze Erklärung, wie man sich verbindet. Dafür gilt ein Limit pro Chat.
  - Limits aus Paket 5 gelten genauso.
- **Ausgehend:**
  - Markdown → Telegram-HTML (`parse_mode: 'HTML'`, sicher escapen).
  - Aktionskarten mit Inline-Knöpfen „Ja“ / „Nein“ / „Rückgängig“ (`callback_query` → `perform` bzw. `undo`).
  - Orte und Restaurants als Text mit Link.
  - Rate-Limit-Puffer: höchstens 1 Nachricht pro Sekunde pro Chat.
- In der Einführung unter „Fertig“ und in der Willkommens-Mail kommt der Hinweis „Stella auch in Telegram“.

**WhatsApp vorbereiten, nicht bauen:**
- `channels/whatsapp.ts` als Gerüst mit TODO und Verweis auf diesen Plan.
- Kurzer Abschnitt in `docs/ARCHITEKTUR.md`:
  - Meta erlaubt allgemeine KI-Assistenten in der EU nur vorläufig (seit 2026, 12 Monate) und gegen eine Gebühr pro Nachricht.
  - Proaktive Nachrichten brauchen freigegebene Vorlagen (etwa 2–5 Cent pro Stück).
  - Nötig wären Meta-Unternehmensverifizierung und eine eigene Nummer.
  - Wenn es kommt, dann nur ab Pro.

**Tests:**
- Webhook mit falschem Secret → 401.
- `/start` mit gültigem bzw. abgelaufenem Token.
- Text, Sprache und Foto landen im Chat.
- Callback „Rückgängig“.
- `notify()` geht an Push + Telegram nach Einstellung.
- HTML-Escape.

**Nutzer-Aufgabe:** Bei @BotFather einen Bot anlegen (Name z. B. „Stella by EVOLSIOR“, Benutzername z. B. `StellaEvolsiorBot`), mit Profilbild, Beschreibung und Befehlen (`/start`, `/briefing`, `/stop`). Den Token unter Einstellungen → Server → Telegram eintragen.

---

## Paket 11 – News im Morgen-Briefing

**Ziel:** Wer will, bekommt morgens ein paar Meldungen zu den eigenen Themen und Ländern, jeweils in einem Satz und mit Link zum Artikel. Die Quellen sind nur seriöse Medien.

**Quellen** (`server/src/news/sources.ts`, Katalog mit `id`, `name`, `country`, `lang`, `topics`, `feedUrl`, `homepage`):
- Ausgewogen, mehrere Blattlinien je Land, **keine Boulevard-Medien**. Beispiele:

| Land | Quellen |
|---|---|
| AT | ORF, Der Standard, Die Presse, Kleine Zeitung |
| DE | Tagesschau, Der Spiegel, Die Zeit, FAZ, Süddeutsche |
| CH | SRF, NZZ |
| International | Reuters, AP, DW, Euronews, BBC |
| UK | BBC, The Guardian |
| US | AP, NPR |
| FR | Le Monde, France 24, franceinfo |
| ES | El País, RTVE |
| IT | ANSA, Corriere della Sera |
| BR | g1, Folha, BBC News Brasil |
| TR | BBC Türkçe, DW Türkçe, Euronews Türkçe (öffentlich-rechtlich und international, wegen der Lage der Pressefreiheit dort) |
| PL | PAP, Rzeczpospolita, TVN24 |

- Jede Feed-URL beim Bauen prüfen. Nicht erreichbare Feeds rausnehmen. Bei jeder Quelle kurz die Nutzungsbedingungen der RSS-Feeds ansehen und Auffälliges im Bericht nennen.
- **Themen:** Politik, Wirtschaft, Tech, Wissenschaft, Klima, Gesundheit, Sport, Kultur, Lokales. Die Zuordnung kommt aus Feed-Kategorien, sonst aus Haiku-Stichworten.

**Abruf:**
- Alle 30 Minuten zentral für alle Nutzer (`every()`), mit ETag/If-Modified-Since.
- Tabelle `news_items (id, source_id, url UNIQUE, title, teaser, published_at, topics, cluster_id, fetched_at)`. Gespeichert werden **nur Titel, Teaser und Link**, kein Artikeltext. Löschen nach 3 Tagen.
- **Gruppieren:** Meldungen zur selben Geschichte kommen in eine Gruppe (normalisierte Titel-Wörter, Jaccard ≥ 0,5 in 12 Stunden).

**Pro Nutzer:**
- `settings.news = { enabled, topics[], countries[], sources[], favorites: { name, feedUrl }[], count }`
- Auswahl beim Briefing:
  - Neu seit dem letzten Briefing.
  - Passt zu den Themen und Ländern.
  - Rangfolge: Lieblingsquelle zuerst, dann wie viele Quellen dieselbe Geschichte bringen, dann Aktualität.
  - Höchstens 1 Meldung pro Gruppe.
  - Anzahl je Abo (Free 3, sonst 5).
- **Haiku** (`light`, Effort `low`, ein Aufruf für alle Meldungen) schreibt je Meldung **einen neutralen Satz in der Sprache der Nutzerin**, der das Thema beschreibt, nicht den Artikel nacherzählt.
  - Bei Unglücken, Krieg und Tod ist der Ton immer sachlich, auch bei „frech“ (Regel im Prompt).
- **Karte** `news` im Briefing (App und Telegram): Meldung = Satz + Quelle + Uhrzeit. Antippen öffnet den Artikel (iOS `SFSafariViewController`, Web neuer Tab).
- **Lieblingszeitung:** In den News-Einstellungen Name oder Webseite eintragen. Der Server sucht den Feed (`<link rel="alternate" type="application/rss+xml">` auf der Startseite) und zeigt ihn zur Bestätigung. Findet er keinen: „Für diese Seite finde ich leider keinen Feed.“

**Frage am ersten Tag:**
- Scheduler-Job für Nutzer, deren Konto jünger als 36 Stunden ist und bei denen `news.asked` nicht gesetzt ist.
- Am ersten Tag, frühestens 3 Stunden nach der Registrierung und nur zwischen 10 und 20 Uhr Ortszeit (sonst am nächsten Tag um 10 Uhr): Push bzw. Telegram **auch wenn die App gerade nicht offen ist**, plus Chat-Nachricht mit Karte: „Soll ich dir morgens kurz sagen, was in der Welt los ist?“
- Knöpfe:
  - **„Ja, gern“** öffnet das Auswahl-Sheet: Themen-Chips, Länder (vorgewählt das eigene Land + International), optional Lieblingsquelle.
  - **„Nein danke“**
- Später jederzeit unter Einstellungen → Briefing → News.

**Tests:**
- Feed-Parser (RSS und Atom) mit Beispieldateien.
- Gruppieren.
- Auswahl nach Vorlieben und Abo.
- Kurzfassung mit Mock (Sprache stimmt, ein Satz).
- Frage am ersten Tag kommt genau einmal und nicht nachts.
- Feed-Suche mit HTML-Beispiel.

---

## Paket 12 – Alltagsaufgaben: Restaurants, Reservieren, Verfügbarkeit

**Ziel:** Stella nimmt Alltagskram ab, so weit es ehrlich geht. Sie kann **nicht selbst buchen oder kaufen**. Sie findet, vergleicht und bereitet alles so vor, dass nur noch ein Tippen fehlt. Das sagt sie offen.

**Werkzeuge für den Agenten** (alle laufen als Profi-Aufgabe über Sonnet, `tier: 'heavy'`):
- `find_restaurants({ query, cuisine?, when?, people?, near? })`:
  - Über Overpass, `amenity=restaurant|cafe|bar` mit Küche, Öffnungszeiten, Website und Telefon.
  - Baut auf `places.ts` auf (gleicher Cache und dasselbe Rate-Limit).
  - Sortiert nach Entfernung, geöffnet zur gewünschten Zeit (`openNow()`).
- `booking_options({ placeId })`:
  - Lädt die Website des Lokals (mit `fetch`, bei Bedarf über `browser.ts`).
  - Sucht bekannte Buchungsdienste: TheFork, OpenTable, Quandoo, resmio, Bookatable, Tablein, Google „Reservieren“.
  - Liefert den direkten Link, sonst `tel:`.
- **Websuche:** das Server-Werkzeug von Claude `web_search_20260209` (mit `max_uses` 3), dazu `web_fetch_20260209`. Für Fragen wie „Hat MediaMarkt in der Nähe die Switch 2 lagernd?“ oder „Wo bekomme ich heute noch ein Ladekabel für …?“. Kosten etwa 1 Cent pro Suche plus Tokens, eingerechnet in die Profi-Aufgabe.
- **Händler-Adapter nur bei Bedarf:** Reicht `web_fetch` für eine große Kette nicht (z. B. Bestand je Filiale), kommt ein Adapter in `server/src/stores/` dazu, mit Tests auf gespeicherten HTML-Beispielen. Mit höchstens 3 Ketten anfangen und nur, wenn die Websuche dort versagt.

**Karten im Chat** (Web, iOS, Telegram):
- `restaurants`: 3 Vorschläge mit Küche, Entfernung, „heute bis 23 Uhr offen“ und den Knöpfen „Reservieren“ (Link bzw. Anruf), „Route“, „In den Planer“. Letzteres legt einen Termin an, über die Rechte-Stufen mit Rückgängig.
- `availability`: Händler, Filiale, Status (lagernd / bestellbar / unklar) mit Quelle, Link und Uhrzeit der Prüfung. Bei „unklar“ sagt Stella das ehrlich und bietet an, die Telefonnummer zu zeigen.

**Standort:**
- Genauer Standort nur in dem Moment, wie bei den Läden.
- Ohne Freigabe: gerundeter Ort aus Paket 7, und Stella fragt einmal nach (Karte aus Paket 6).

**Ehrlichkeit im Prompt:**
- „Du kannst nicht buchen, kaufen oder bezahlen. Sag das offen, bereite alles vor und gib den nächsten Schritt.“
- Keine erfundenen Öffnungszeiten oder Bestände. Wenn eine Quelle fehlt, „unklar“ sagen.

**Tests:**
- Overpass-Mock für Restaurants.
- Buchungs-Erkennung mit HTML-Beispielen (TheFork-Widget, OpenTable-Link, keiner).
- Werkzeuge nur mit Kontingent bzw. dem richtigen Abo.
- Die Karte „In den Planer“ legt einen Termin mit Rückgängig an.

---

## Paket 13 – Bildschirmzeit-Ziele (iOS)

**Ziel:**
- Man setzt sich Ziele und Limits fürs Handy („TikTok höchstens 1 Stunde am Tag“, „insgesamt unter 4 Stunden“).
- Stella meldet sich rechtzeitig: „Mittags schon 50 % deines TikTok-Limits“, „3 Stunden TikTok heute? Leg's weg.“ (im Ton der Nutzerin).
- In der App sieht man die Bildschirmzeit.

**Was Apple erlaubt (wichtig, nicht anders versprechen):**
- Eine App darf die Bildschirmzeit-Daten **nicht auslesen** und nicht an einen Server schicken.
- Möglich ist:
  1. **Schwellen vorab festlegen** (`DeviceActivity`). iOS weckt eine Erweiterung, sobald eine App oder Kategorie heute X Minuten erreicht hat.
  2. **Anzeigen** in der App über eine Report-Erweiterung (`DeviceActivityReport`). Die Daten bleiben dabei in der Erweiterung.
  3. **Sperren** (`ManagedSettings` Shield), wenn das Limit erreicht ist, nur auf Wunsch.
- Die App erfährt **nicht automatisch**, welche App das ist. Die Nutzerin wählt sie im System-Auswahlfenster (`FamilyActivityPicker`) und gibt dem Ziel einen Namen („TikTok“).
- Nötig: ein **bezahltes Apple-Developer-Konto** und die Freigabe **Family Controls (Distribution)**, die bei Apple beantragt werden muss und ein paar Wochen dauert. Zum Entwickeln reicht die Development-Variante.

**Technik:**
- App-Erweiterungen gehen **nicht** in Swift Playgrounds bzw. `.swiftpm`. Deshalb gibt es ein **zusätzliches Xcode-Projekt** per **XcodeGen**: `ios/project.yml` → `Stella.xcodeproj`, erzeugt in der CI.
  - Es nutzt **dieselben Quelldateien** wie `Stella.swiftpm`, über Ordner-Referenzen auf `Stella.swiftpm/App`, `Core`, `Design`, `Views`.
  - Dazu kommen:
    - `StellaActivityMonitor` (DeviceActivityMonitor-Erweiterung)
    - `StellaActivityReport` (DeviceActivityReport-Erweiterung)
    - App Group `group.app.stella.ios`
    - Entitlements `com.apple.developer.family-controls`, Associated Domains (Paket 5a)
  - Die Bildschirmzeit-Ansichten im Hauptcode stehen hinter `#if canImport(FamilyControls) && STELLA_SCREENTIME`, damit `Stella.swiftpm` in Swift Playgrounds weiter baut, ohne Bildschirmzeit.
  - CI: `ios.yml` baut beide Varianten (`swiftpm` wie bisher für Appetize, Xcode-Projekt ohne Signatur als Kontrolle).
- **Ablauf:**
  1. Ziel anlegen (neuer Bereich in „Ziele“, Art `screen_time`): App(s) bzw. Kategorie wählen, Name, Tageslimit, optional „Ab Limit sperren“.
     - Die Auswahl (`FamilyActivitySelection`) liegt verschlüsselt in der App Group. Zum Server gehen nur Name, Limit und Ziel-ID, **keine** App-Daten.
  2. Die App startet `DeviceActivityCenter.startMonitoring` mit einem Tagesplan und Ereignissen bei **50 %, 80 %, 100 %** und danach jede volle Stunde darüber (z. B. 2 h, 3 h).
     - Mittags-Regel: Ist die 50-%-Schwelle vor 13 Uhr erreicht, kommt eine eigene „Auf Kurs?“-Nachricht.
  3. Die **Monitor-Erweiterung** bekommt `eventDidReachThreshold`:
     - Schickt sofort eine **lokale Mitteilung** mit einem Text aus dem Sprachkatalog im Ton der Nutzerin. Die Texte legt die App vorab in der App Group ab, je Ziel und Schwelle mehrere Varianten, damit es nicht langweilig wird.
     - Schreibt das Ereignis (Ziel-ID, Schwelle, Zeit) in die App Group.
     - Bei 100 % und „sperren“ setzt sie das Shield.
  4. Die App schickt die gesammelten Ereignisse beim nächsten Start bzw. Hintergrund-Refresh an `POST /api/screentime/events`. Dort stehen nur Ziel-ID, Schwelle und Datum.
  5. Der Server nutzt die Ereignisse für:
     - den Wochenrückblick im Sonntags-Briefing („3 von 7 Tagen im Limit“)
     - Hinweise (`hints.ts`)
     - Telegram-Nachrichten, wenn verbunden („TikTok-Limit erreicht.“)
     - Dabei gilt: keine Punkte, Serien oder Abzeichen.
  6. **Ansicht in der App:** Unter Ziele → Bildschirmzeit die Report-Erweiterung (heute, Woche, Top-Apps als Balken, im Stella-Stil).
- **Hinweise sinngemäß** (je Ton, in allen Sprachen):
  - nett: „Du bist schon bei 80 % deiner TikTok-Zeit. Vielleicht eine kurze Pause?“
  - frech: „Drei Stunden TikTok heute? Das Handy braucht auch mal Ruhe. Du auch.“
  - cool: „TikTok-Limit erreicht. Morgen ist ein neuer Tag.“
- Web und PC: Der Bereich zeigt „Nur auf dem iPhone verfügbar“ und die Ziele samt Verlauf aus den Ereignissen.
- Nur ab Plus (`hasFeature`).

**Zu den Begründungstexten:** Nebenbei `Package.swift`/`Info.plist`-Texte (Kamera, Mikrofon, Standort) für alle acht Sprachen über `InfoPlist.strings` im Xcode-Projekt anlegen. Im `.swiftpm` bleiben sie englisch.

**Tests:**
- Server: Ereignis-Route, Wochenrückblick, Hinweis.
- iOS: Unit-Tests für die Schwellen-Berechnung und die Textauswahl. Die Erweiterungen lassen sich im Simulator nur begrenzt testen, deshalb im Bericht eine Checkliste für den Test auf einem echten iPhone.

**Nutzer-Aufgaben:**
- Apple-Developer-Konto (99 $/Jahr) mit Team-ID.
- Family Controls (Distribution) beantragen: https://developer.apple.com/contact/request/family-controls-distribution
- Ohne Freigabe bleibt der Bereich in TestFlight bzw. App Store aus, im eigenen Development-Build an.

---

## Später (bewusst nicht in dieser Runde)

- **WhatsApp** über die Kanal-Schnittstelle, sobald Metas Regeln für KI-Anbieter in der EU klar sind. Kosten pro Nachricht ins Pro- und Max-Abo einrechnen.
- **KI-Telefonanruf für Reservierungen** (Stella ruft im Restaurant an, etwa 10 Cent pro Minute, muss sich als KI vorstellen), nur im Max-Abo.
- **In-App-Kauf (StoreKit 2)** vor dem Start im App Store. Apple verlangt ihn für digitale Abos in der App.
- **Mehr Sonnet** in den Abos, sobald Umsatz da ist. Dafür nur die Zahlen in `plans.ts` bzw. im Dashboard ändern.
- **Finanzen** neu denken: Belege aus Mails, Schnelleingabe, Foto vom Kassenbon, später Bankanbindung über einen lizenzierten Anbieter (nur lesend).
- **FreeNotes im App Store**, dann `config.freenotesUrl` setzen und die Vorgemerkten benachrichtigen.
- **News vorlesen** (Audio-Briefing).
- **Android** (dort ginge Bildschirmzeit über `UsageStatsManager`).
- **DSGVO vor dem öffentlichen Start:** Datenschutzerklärung und AGB in allen Sprachen, Datenexport. Einwilligung der Eltern unter 14 (AT) bzw. 16 (DE), weil viele Schüler:innen jünger sind. Auftragsverarbeitung mit Anthropic, Groq, Stripe und Telegram dokumentieren.

---

## Verifikation (pro Paket und am Ende)

**Pro Paket:**
- Typecheck und Tests grün (Befehle oben).
- Lokal mit `server/scripts/demo-seed.ts` (für neue Bereiche erweitern: Abo, News, Telegram-Verknüpfung, Bildschirmzeit-Ereignisse) und Playwright-Screenshots in 430 px Breite.
- Deploy mit `scripts/deploy-vps.sh`, danach `journalctl -u stella` ohne Fehler.
- iOS-CI grün (beide Varianten ab Paket 13), dann in Appetize mit `test` / `1` durchklicken.

**Ende zu Ende am Schluss:**
1. Frische Registrierung auf Englisch:
   - Mail kommt als HTML (hell und dunkel ansehen, Gmail und Outlook Web).
   - Link auf demselben Gerät → direkt angemeldet.
   - Link am PC geöffnet → Code wird gezeigt → Code am Handy eingeben → angemeldet.
2. Einführung auf Türkisch: Sprache, Land, Schule, FreeNotes-Folie mit „Benachrichtige mich“, Standort-Folie, alles bis zum Ende in natürlich klingendem Türkisch.
3. Free-Abo: nach 15 KI-Nachrichten freundlicher Hinweis, Kurznotizen gehen weiter. Upgrade auf Plus über Stripe-Testmodus → Limits sofort höher, Abo-Mail kommt.
4. Ladebildschirm mit gespeichertem Wetter. „Wetter erzwingen“ zeigt alle Szenen flüssig, auch bei Nacht den Sternenhimmel mit Sternschnuppe. „Bewegung reduzieren“ macht alles still.
5. Sprachnachricht „ähm also schreib bitte Milch und äh Eier auf die Einkaufsliste“ → Blase zeigt „Schreib bitte Milch und Eier auf die Einkaufsliste.“ mit „Per Sprachnachricht“.
6. Telegram verbinden, dort eine Sprachnachricht und ein HÜ-Foto schicken. Die Antworten kommen, „Rückgängig“ funktioniert, das Briefing kommt am nächsten Morgen auch in Telegram.
7. Frage nach den News am ersten Tag kommt per Push, Themen wählen, am nächsten Morgen 3–5 Meldungen mit funktionierenden Links.
8. „Such mir für Samstag 19 Uhr einen Italiener für 4 Personen in der Nähe“ → Karte mit Buchungslink bzw. Anruf → „In den Planer“ mit Rückgängig.
9. Bildschirmzeit (Development-Build auf dem echten iPhone): Ziel „TikTok 30 min“ → Mitteilung bei 50 %, 80 % und 100 % im gewählten Ton, Ansicht in der App.
10. Firmen-Dashboard zeigt Nutzer pro Abo, Kosten pro Nutzer und Marge plausibel.
11. Finanzen tauchen nirgends auf.
