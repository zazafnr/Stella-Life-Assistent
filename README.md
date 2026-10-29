# ✦ Stella Life Assistant

**Let Stella handle your life.**

Stella ist dein eigener KI-Assistent für Schule und Alltag. Du schreibst in Stichworten, Stella erledigt den Rest:

| Du schreibst | Stella macht |
|---|---|
| `Latein Hü Seite 45 nr 3 Freitag` | trägt die HÜ für Freitag ein, holt Seite 45 aus digi4school als Bild und erinnert dich Donnerstag um 19:00 (mit Bild) |
| `Mathe SA 12.11.` | trägt die Schularbeit ein, fragt nach dem Stoff, baut einen Lernplan und erinnert eine Woche und einen Tag vorher |
| `was steht an?` | Übersicht der nächsten zwei Wochen |
| `Latein HÜ erledigt` | hakt die HÜ ab |
| alles andere | die KI antwortet und kann Einträge selbst anlegen, ändern und Lernpläne bauen |

Läuft als **Web-App, iPhone-/iPad-App (PWA) und PC-App** mit einem Konto, alles synchronisiert. Der Server läuft auf deinem VPS.

## Was schon geht

- 💬 Chat mit Kurznotiz-Erkennung, die **ohne KI und offline** funktioniert (HÜ, SA, Test, Referat …, Datum wie „Freitag“, „12.11.“, „in 2 Wochen“)
- 🗓️ Planer: HÜs, Tests, Abgaben, Termine, Lerneinheiten
- ⏰ Erinnerungen per Push-Mitteilung (iPhone, iPad, PC)
- 🧠 Lernpläne für Tests (mehr Einheiten kurz vor dem Test, zum Schluss Wiederholung und Probe-Test)
- 📸 digi4school: Buchseite der HÜ automatisch als Bild (⚠️ muss mit deinem Konto kalibriert werden, siehe unten)
- 📅 Kalender-Abo: alle Einträge im normalen iPhone-, Google- oder Outlook-Kalender
- ❤️ Gesundheit: Schritte aus Apple Health über einen Kurzbefehl, mit 14-Tage-Diagramm
- 🔔 SMS-Weiterleitung über einen Kurzbefehl. Schreibt dir jemand 3× in 30 Minuten, meldet sich Stella
- 📴 Offline: Die App startet ohne Netz, Kurznotizen werden sofort verstanden und später synchronisiert. Erinnerungen verschickt der VPS auch dann, wenn dein Handy aus ist.
- 🤖 KI über OpenRouter: wählt automatisch die besten **kostenlosen** Modelle und weicht bei Limits auf andere aus

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
server/   Fastify + SQLite: API, KI-Agent, Erinnerungen, Jobs, digi4school, Push, Kalender-Abo
web/      React-PWA: Chat, Planer, Gesundheit, Einstellungen, Offline-Speicher
deploy/   Docker Compose + Caddy (HTTPS) + Backup-Skript
```
