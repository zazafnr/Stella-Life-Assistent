# ✦ Stella Life Assistant

> **Zwei Apps, ein Server.** Dieses Repo ist der **Kern** und das normale **Stella** (Alltag, Beruf, Haushalt) unter `stella.evolsior.com`.
> **Stella for Students** (Schule, Lehre, Studium) liegt in [`zazafnr/Stella-for-Students`](https://github.com/zazafnr/Stella-for-Students) und läuft als Edition-Plugin im selben Server
> unter `students.stella.evolsior.com`. Plan und Stand: [`docs/plan/stella-students.md`](docs/plan/stella-students.md), Aufbau: [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md).

**Let Stella handle your life.**

*Stella by **EVOLSIOR** – Built to become.*

Stella ist dein eigener KI-Assistent für Alltag und Beruf. Du schreibst in Stichworten, Stella erledigt den Rest:

| Du schreibst | Stella macht |
|---|---|
| `Zahnarzt Freitag 15 Uhr` | trägt den Termin in den Kalender ein und erinnert dich |
| `jeden Montag Mülltonne raus` | legt eine Routine an, die von selbst weiterläuft |
| `ich will dreimal pro Woche laufen` | legt ein Ziel an, zählt mit und fragt zur gewählten Zeit nach |
| `Milch und Eier auf die Einkaufsliste` | ergänzt die Liste |
| `was steht an?` | Übersicht der nächsten zwei Wochen |
| alles andere | die KI antwortet und kann Einträge selbst anlegen, ändern und planen |

Dazu im Hintergrund:
- 📧 **Gmail, iCloud, IMAP**: Wichtige Mails kommen als Nachricht, Werbung und Spam wandern in den Papierkorb (in der App wiederherstellbar)
- 🗓️ **Kalender** (Monat, Woche, Tag): alles auf einer Fläche, per Ziehen verschieben, mit Rückgängig
- 📰 **News** im Morgenbriefing, Wetter, Alltagsaufgaben, Telegram

> **Du gehst zur Schule, machst eine Lehre oder studierst?** Dann ist **Stella for Students** die richtige App:
> Stundenplan mit Entfall, Hausübungen mit Autopilot, Prüfungen, Lernkarten, Mitschriften aus Fotos, Semester und Noten.
> Sie liegt in [`zazafnr/Stella-for-Students`](https://github.com/zazafnr/Stella-for-Students) und läuft auf demselben Server.

Läuft als **Web-App, native iPhone-/iPad-App (SwiftUI) und PC-App (Electron)** mit einem Konto, alles synchronisiert. Der Server läuft auf deinem VPS.

## Was schon geht

- 💬 Chat mit Kurznotiz-Erkennung, die **ohne KI und offline** funktioniert, plus Sprachnachrichten und Fotos
- 🗓️ Kalender, Planer, Routinen und Erinnerungen per Push (iPhone, iPad, PC, Telegram)
- 🎯 Ziele ohne Druck: keine Serien, keine Abzeichen
- 📥 Inbox: E-Mails (Gmail, iCloud, IMAP) mit Antwortentwürfen, Social-Media-Benachrichtigungen, SMS
- 📰 News, 🌦️ Wetter, 🍝 Restaurants und Besorgungen, ⏱️ Bildschirmzeit-Ziele
- 📅 Kalender-Abo für den iPhone-, Google- oder Outlook-Kalender, ICS-Import
- ❤️ Schritte aus Apple Health und SMS-Weiterleitung über Kurzbefehle
- 🔐 Rechte je Bereich (fragen, Bescheid sagen oder einfach tun) und **Rückgängig** für jede Aktion
- 📴 Offline-fähig, der VPS arbeitet weiter, auch wenn dein Handy aus ist
- 🌍 Acht Sprachen
- 🤖 KI über Anthropic bzw. OpenRouter, je Aufgabe das passende Modell

Was als Nächstes kommt und was technisch (noch) nicht geht, steht in **[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)**.

## Auf dem VPS starten

Voraussetzungen: ein VPS mit Docker und eine (Sub-)Domain, die auf den VPS zeigt, z. B. `stella.deinedomain.at`. HTTPS ist Pflicht, sonst gibt es keine Push-Mitteilungen auf dem iPhone. Das Zertifikat holt Caddy automatisch.

```bash
git clone https://github.com/zazafnr/Stella-Life-Assistent.git && cd Stella-Life-Assistent
```

```bash
cp .env.example .env && nano .env
```

`.env` ausfüllen: `STELLA_PUBLIC_URL`, `STELLA_SECRET` (mit `openssl rand -base64 32` erzeugen) und `OPENROUTER_API_KEY`.

```bash
echo "STELLA_DOMAIN=stella.deinedomain.at" > deploy/.env
```

```bash
cd deploy && docker compose up -d --build
```

Danach `https://stella.deinedomain.at` öffnen. Das **erste** Konto, das du anlegst, ist deins, danach ist die Registrierung zu.

### Neben anderen Diensten (ohne Docker)
Läuft auf dem VPS schon Caddy (z. B. für RugScan), nimm statt Docker das Installationsskript. Es legt einen eigenen Dienst `stella` an (Port 8795), hängt nur einen eigenen Block an die Caddyfile und lässt den Rest unangetastet:

```bash
sudo STELLA_DOMAIN=stella.deinedomain.at ./deploy/install-vps.sh
```

Konfiguration danach in `/etc/stella/stella.env`, Logs mit `journalctl -u stella -f`.

### Aufs iPhone/iPad
Native App in [`ios/Stella.swiftpm`](ios/README.md): auf dem iPad in **Swift Playgrounds** öffnen und ▶︎ antippen, aufs iPhone über Xcode oder TestFlight. Erinnerungen plant die App als lokale Mitteilungen ein, Schritte liest sie direkt vom iPhone.

Ohne App geht es auch über Safari → Teilen → **„Zum Home-Bildschirm“**.

### Auf den PC
**Windows:** Unter Releases → [„Stella für Windows“](../../releases/tag/pc-app) die `.exe` laden und doppelklicken (Details in [`desktop/`](desktop/README.md)). Stella sitzt dann in der Taskleiste und meldet sich mit echten Windows-Mitteilungen.

### Stella for Students dazunehmen
Der Server lädt das Plugin aus `editions/students` (`scripts/fetch-edition.sh`, `STELLA_STUDENTS_REF` wählt Branch oder Tag; `STELLA_EDITION_STUDENTS=off` schaltet es ab). Die Oberfläche läuft unter `students.<deine Domain>` (`npm run build:students`), siehe [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md).

### FreeNotes (iPad) verbinden
In FreeNotes → Einstellungen → **Stella** → Server-Adresse, E-Mail und Passwort eingeben. FreeNotes holt gelöste HÜs beim Öffnen und alle 5 Minuten ab und schreibt sie ins Heft des passenden Fachs (gibt es keins, legt es eins an). Die Anbindung liegt im FreeNotes-Repo auf dem Branch `claude/stella-anbindung`.

## Lokal entwickeln

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Die App läuft dann auf http://localhost:5173. Tests mit `npm test`, Typprüfung mit `npm run typecheck`.

## Aufbau

```
shared/     Parser für Kurznotizen, Datumslogik, Kalender-Logik, Pläne, Texte (Server + Apps)
server/     Fastify + SQLite: API, KI-Agent, Erinnerungen, Jobs, E-Mail, Push, Kalender, Edition-Plugins
web-core/   gemeinsame Bausteine der Web-Oberflächen (Store, Texte, Kalender, Komponenten)
web/        React-PWA des normalen Stella: Chat, Planer, Kalender, Inbox, Einstellungen, Offline-Speicher
editions/   hier landet beim Bauen das Plugin von Stella for Students (scripts/fetch-edition.sh)
site-src/   Quellen der Website evolsior.com (gebaut nach site/public/)
deploy/     Docker Compose + Caddy (HTTPS, beide Adressen) + Backup-Skript
```

## Rechte

© 2026 zaza.dev – **Alle Rechte vorbehalten.** Der Code ist zum Anschauen öffentlich, aber nicht frei lizenziert: Kopieren, Weitergeben oder Verwenden in eigenen Projekten ist ohne schriftliche Erlaubnis nicht gestattet. Details in [`LICENSE`](LICENSE).
