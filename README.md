# ✦ Stella Life Assistant

**Let Stella handle your life.**

Stella ist dein eigener KI-Assistent für Schule und Alltag. Du schreibst in Stichworten, Stella erledigt den Rest:

| Du schreibst | Stella macht |
|---|---|
| `Französisch HÜ S. 45 Nr. 16 Freitag` | trägt die HÜ ein, holt Seite 45 aus scook/digi4school, **löst die Aufgabe** und schreibt sie in deiner Handschrift in dein FreeNotes-Heft. Am Vorabend kommt nur noch: „✅ Französisch HÜ erledigt“ |
| 📷 Foto vom Arbeitsblatt + `Mathe HÜ AB Nr 3 morgen` | genauso, nur vom Foto |
| `Mathe SA 12.11.` | trägt die Schularbeit ein, fragt nach dem Stoff, baut einen Lernplan und erinnert eine Woche und einen Tag vorher |
| `Latein HÜ S. 20 Nr. 1` (ohne Datum) | nimmt die nächste Lateinstunde laut WebUntis |
| `was steht an?` | Übersicht der nächsten zwei Wochen |
| alles andere | die KI antwortet und kann Einträge selbst anlegen, ändern und Lernpläne bauen |

Dazu im Hintergrund:
- 📧 **2× Gmail + iCloud**: Wichtige Mails kommen als Nachricht, Werbung und Spam wandern in den Papierkorb (in der App wiederherstellbar)
- 📸 **Social**: Benachrichtigungen von Instagram, TikTok usw. landen gesammelt im Inbox-Tab
- 🏫 **WebUntis**: Stundenplan, Entfall („🎉 Morgen entfällt Mathe“), Hausübungen und Tests, die Lehrer:innen eintragen

Läuft als **Web-App, iPhone-/iPad-App (PWA) und PC-App** mit einem Konto, alles synchronisiert. Der Server läuft auf deinem VPS.

## Was schon geht

- 💬 Chat mit Kurznotiz-Erkennung, die **ohne KI und offline** funktioniert, plus Fotos (Arbeitsblätter)
- ✍️ **HÜ-Autopilot**: Buchseite (scook, digi4school) oder Foto → Bild-Modell löst die Aufgabe → Heft-Text → **FreeNotes** schreibt sie Strich für Strich in deiner Handschrift ins Fach-Heft (im Chat gibt es eine Vorschau als Heftseite)
- 🗓️ Planer mit Stundenplan, Erinnerungen per Push (iPhone, iPad, PC), Lernpläne für Tests
- 📥 Inbox: E-Mails (Gmail, iCloud, IMAP), Social-Media-Benachrichtigungen, SMS
- 🏫 WebUntis (Passwort oder QR-Code bei Microsoft-Login)
- 📅 Kalender-Abo für den iPhone-, Google- oder Outlook-Kalender
- ❤️ Schritte aus Apple Health und SMS-Weiterleitung über Kurzbefehle
- 📴 Offline-fähig, der VPS arbeitet weiter, auch wenn dein Handy aus ist
- 🤖 KI über OpenRouter: wählt automatisch die besten **kostenlosen** Modelle (auch Bildmodelle) und weicht bei Limits auf andere aus

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

### Aufs iPhone/iPad
Safari öffnen → Teilen → **„Zum Home-Bildschirm“** → Stella von dort öffnen → Einstellungen → **Mitteilungen aktivieren**.

### Auf den PC
In Chrome oder Edge öffnen → in der Adressleiste auf **„App installieren“** klicken.

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
shared/   Parser für Kurznotizen, Datumslogik, Erinnerungs- und Lernplan-Regeln (Server + App)
server/   Fastify + SQLite: API, KI-Agent, Erinnerungen, Jobs, Schulbücher (scook, digi4school),
          HÜ-Löser, Handschrift-Vorschau, E-Mail (IMAP), WebUntis, Push, Kalender-Abo, FreeNotes-Schnittstelle
web/      React-PWA: Chat, Planer, Gesundheit, Einstellungen, Offline-Speicher
deploy/   Docker Compose + Caddy (HTTPS) + Backup-Skript
```
