# Stella v3: Bericht zum Bau

Stand: alle 14 Pakete (0–13) sind gebaut und auf dem Branch `claude/eager-brahmagupta-1tuwbf` gepusht, je Paket ein Commit.
**Nicht** gemacht (bewusst): Pull Request, Merge, Deploy. Nichts davon läuft schon auf dem Server.

Geprüft in der Bau-Umgebung: Typecheck (Web, Server, Shared) grün, **Tests grün (Shared 81, Server 261)**, Web-Build grün, alle erzeugten Dateien
(`gen-i18n`, `gen-weather-swift`, `gen-boot-weather`, `gen-infoplist`) aktuell.

## Was nicht geprüft werden konnte (ehrlich)

| Was | Warum | Was du tun kannst |
|---|---|---|
| **Alle Swift-Teile** (iOS) | In der Bau-Umgebung gibt es kein Swift. Die Teile sind sorgfältig geschrieben, aber **nie kompiliert**. | Push auf den Branch löst `ios.yml` aus: dort zeigt sich, ob es baut (beide Varianten: swiftpm und Xcode-Projekt). Fehler bitte melden, ich behebe sie. |
| **Externe Dienste** (Open-Meteo, DB-IP, Stripe, Telegram, Anthropic, Overpass, News-Feeds) | Kein Internetzugang. Alles ist gegen Mock-Server getestet, nicht gegen die echten Dienste. | Siehe Aufgaben unten; beim ersten Start die Server-Logs ansehen (`journalctl -u stella`). |
| **News-Feed-Adressen** | Nicht abgerufen. Sie stehen aus dem Gedächtnis im Katalog. | `npx tsx scripts/check-news-feeds.ts` ausführen, nicht erreichbare Quellen streichen (`docs/news/quellen.md`). |
| **Mail-Darstellung** (Gmail, Outlook Web, Apple Mail, hell/dunkel) | Nur im Dashboard-Vorschau-Rahmen und per Test, nicht in echten Mail-Programmen. | Test-Mail an dich selbst schicken (Dashboard → Emails zeigt alle Vorlagen). |
| **Bildrate der Wetter-Szenen** | Gemessen nur der CPU-Anteil im Headless-Browser ohne GPU (0,2–0,7 ms pro Bild). Echte FPS auf iPhone 12 und Laptop fehlen. | Am Gerät ansehen (`docs/weather/abnahme.md`). Bei Bildverlust senkt die Engine die Teilchenzahl selbst. |
| **Übersetzungen** in sechs neuen Sprachen | Sorgfältig und mit Gegenlesen auf natürlichen Klang gemacht, aber nicht von Muttersprachler:innen geprüft. | `docs/i18n/pruefliste.md` an Leute geben, die die Sprache sprechen (besonders Türkisch und Polnisch). |
| **Ende-zu-Ende-Liste** aus dem Plan (Registrierung auf Englisch, Einführung auf Türkisch, Stripe-Testkauf, Telegram, Bildschirmzeit auf dem iPhone) | Brauchen deine Konten, Geräte und Schlüssel. | Nach dem Eintragen der Schlüssel durchklicken. |

## Noch offen (nicht gebaut)

- **Website-Sprachumschaltung** (evolsior.com bleibt Englisch).
- **Abo-Anzeige in der iOS-App** (Abo wechseln geht heute im Web unter Einstellungen → Abo; iOS zeigt sie noch nicht).
- **Restliche Web- und iOS-Texte** sind noch nicht überall über Kataloge: in Web steht noch deutscher Text in den Dateien der `OPEN`-Liste in
  `shared/src/i18n/jsx.test.ts` (Planer, Inbox, Ziele, Finanzen, Teile der Einstellungen); iOS ist in vielen Ansichten noch deutsch. Die neuen Bereiche aus v3 sind vollständig übersetzt.
- `server/scripts/demo-seed.ts` ist nicht um Abo, News, Telegram und Bildschirmzeit erweitert; Playwright-Screenshots der ganzen App in 430 px fehlen (nur die Wetter-Szenen und der Ladebildschirm sind fotografiert, siehe `docs/weather/`).
- **Händler-Adapter** für Verfügbarkeit (`server/src/stores/`): bewusst nicht gebaut, erst wenn die Websuche bei einer großen Kette versagt.
- **WhatsApp**: nur Gerüst und Dokumentation (so geplant).

## Deine Aufgaben, nach Paketen

1. **Claude (Paket 1):** Konto bei console.anthropic.com, 20–50 $ Guthaben, Key unter Einstellungen → Server → Anthropic eintragen, in der Console ein Ausgabenlimit setzen.
2. **Sprachen (Paket 3):** `docs/i18n/pruefliste.md` von Muttersprachler:innen gegenlesen lassen.
3. **Mails (Paket 4):** Firmenadresse für den Mail-Fuß angeben (`STELLA_COMPANY_ADDRESS` in der Server-Umgebung, siehe `server/src/config.ts`), Antwortadresse `team@evolsior.com`; die Vorlagen im Dashboard ansehen.
4. **Anmelde-Link (Paket 5a):** In Cloudflare-DNS `login.stella` als A-Record auf die VPS-IP; `scripts/deploy-vps.sh` einspielen (Caddy kennt den Host). Für Universal Links: Apple-Developer-Konto und Team-ID (`STELLA_APPLE_TEAM_ID`).
5. **Bezahlen (Paket 5b):** Stripe-Konto mit Firmendaten und Bank, **Stripe Tax** aktivieren, Schlüssel (`sk_…`, `whsec_…`) unter Einstellungen → Server → Stripe eintragen, Webhook `https://stella.evolsior.com/api/billing/webhook` in Stripe anlegen (Ereignisse stehen im Hinweistext). Preise werden direkt beim Bezahlen übergeben, es müssen keine Produkte angelegt werden.
6. **FreeNotes (Paket 6):** Sobald es die App gibt: `STELLA_FREENOTES_URL` setzen und im Dashboard-API-Aufruf `POST /api/admin/freenotes/announce` die Warteliste benachrichtigen.
7. **Wetter (Paket 7):** Nach dem Deploy läuft `stella-geoip.service` einmal und dann monatlich (DB-IP Lite, Quellenangabe steht in den Datenschutzinfos). Datenschutzseite neu veröffentlichen (`scripts/build-site.py` ist gelaufen, `site/public/privacy` ist aktuell).
8. **Telegram (Paket 10):** Bei @BotFather einen Bot anlegen (z. B. „Stella by EVOLSIOR“), Profilbild, Beschreibung, Befehle `/start`, `/briefing`, `/stop`. Token unter Einstellungen → Server → Telegram eintragen (der Webhook wird automatisch gesetzt).
9. **News (Paket 11):** `scripts/check-news-feeds.ts` ausführen und tote Quellen streichen; die Nutzungsbedingungen der Feeds je Quelle ansehen (besonders wegen des bezahlten Produkts), siehe `docs/news/quellen.md`.
10. **Bildschirmzeit (Paket 13):** Apple-Developer-Konto (99 $/Jahr) mit Team-ID; **Family Controls (Distribution)** bei Apple beantragen (https://developer.apple.com/contact/request/family-controls-distribution, dauert ein paar Wochen). Ohne Freigabe bleibt der Bereich in TestFlight und App Store aus, im eigenen Development-Build an. In Xcode für alle drei Ziele das Team wählen.

## Checkliste: Bildschirmzeit auf einem echten iPhone (Development-Build)

Die Erweiterungen lassen sich im Simulator nur begrenzt testen.

1. `xcodegen generate --spec ios/project.yml --project ios`, Team wählen, auf das iPhone installieren.
2. Ziele → Bildschirmzeit → „Zugriff erlauben“ (Systemabfrage), dann „Neues Ziel“: Name „TikTok“, Limit 30 Minuten, Apps im Systemfenster wählen.
3. TikTok benutzen: bei 15 min (50 %, vor 13 Uhr als „Auf Kurs?“), 24 min (80 %) und 30 min (100 %) kommt eine lokale Mitteilung im gewählten Ton (Einstellungen → Ton ändern und wiederholen).
4. Mit „Ab Limit sperren“: bei 100 % ist die App gesperrt, am nächsten Tag wieder frei.
5. App öffnen: Die Ereignisse gehen zum Server (Web → Ziele → Bildschirmzeit zeigt den Verlauf). Am Sonntag steht „x von 7 Tagen im Limit“ im Briefing.
6. Ziele → Bildschirmzeit zeigt die Woche (Report-Erweiterung); die App sieht diese Daten nie.

## Entscheidungen und Abweichungen vom Plan

- **Kein Pull Request, kein Merge, kein Deploy:** Die Vorgabe der Umgebung verbietet PRs ohne ausdrückliche Bitte. Auf Wunsch eröffne ich einen PR.
- **Bildschirmzeit-Texte:** drei Töne mit je 1–2 Varianten je Art (50 % vormittags „Auf Kurs?“, 50 %, 80 %, 100 %, jede volle Stunde darüber), in allen acht Sprachen.
- **News-Themen:** Zuordnung über Feed-Kategorien und Stichwörter in acht Sprachen statt eines KI-Aufrufs je Meldung (spart Kosten); Haiku schreibt nur die Sätze.
- **Standort für Restaurants:** Stella nutzt den zuletzt bekannten gerundeten Ort (Paket 7) und fragt sonst einmal mit der Standort-Karte nach; der genaue Standort wird nie gespeichert.
- **Websuche:** nur Server-Werkzeuge von Claude (`web_search`, `web_fetch`), nur für Alltagsaufgaben, nur ab Plus, nur in der Profi-Stufe.
- **Reuters und AP** nicht im Quellenkatalog (keine verlässlichen öffentlichen Feeds), stattdessen DW, Euronews, BBC.
