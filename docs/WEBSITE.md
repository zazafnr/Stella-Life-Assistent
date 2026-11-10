# Website evolsior.com

Statische Seite (kein Framework). Quellen in `site-src/`, gebaut nach `site/public/` (liegt im Repo), Cloudflare-Konfiguration in `site/wrangler.jsonc`. Ein kleiner Worker (`site/worker.js`) läuft nur für die Videos (siehe „Film“).

| Adresse | Inhalt |
|---|---|
| `evolsior.com` | Firmenseite (EVOLSIOR, „Built to become“, Apps) |
| `evolsior.com/stella` | Vorstellung von Stella (Alltag und Beruf, Pläne der Edition `life`) |
| `evolsior.com/stella-students` | Vorstellung von Stella for Students (Quellen `students.body.html`, `students.css`; Pläne der Edition `students`); `/students` leitet dorthin um |
| `evolsior.com/imprint`, `/privacy` | Impressum und Datenschutz (englisch; `/impressum` und `/datenschutz` leiten um) |
| `stella.evolsior.com` | die Stella-Web-App (VPS), `evolsior.com/stella/app` leitet dorthin |
| `students.stella.evolsior.com` | die Studenten-Web-App „Stella for Students“ (gleicher Server, andere Oberfläche; DNS: A-Record auf die VPS-IP, HTTPS holt Caddy), `evolsior.com/stella-students` stellt sie vor |

## Ändern

1. Texte und Aussehen in `site-src/` ändern (`*.body.html`, `*.css`, `*.js`).
2. `python3 scripts/build-site.py` – baut `site/public/`.
3. `site/` committen und nach `main` pushen. Cloudflare veröffentlicht automatisch.

Die Seite von Stella for Students hat noch keine iPhone-Bilder (sie kommen mit der iOS-App); bis dahin zeigt sie Chips statt Telefon. Die Preise dort stehen in `shared/src/plans.ts` (`PLANS_BY_EDITION.students`) und müssen mit der Seite übereinstimmen.

Die iPhone-Bilder (`site/public/assets/stella/*.jpg`, 1179×2556, mit Statusleiste) entstehen aus der Web-App mit Demo-Daten
(`server/scripts/demo-seed.ts`). Die App spricht Deutsch, die Bilder sind für die englische Seite übersetzt.

## Film

Die Stella-Seite zeigt direkt nach dem Hero die Sektion „Film“ (`#film`; Quellen `stella.body.html`, `stella.css`, `stella.js`).

- **Dateien:** `site/public/assets/video/stella-film-2.mp4` (1920×1080, H.264 + AAC, faststart, nur Soundeffekte) und `stella-film-2.jpg` (Vorschaubild).
  Version 2 = gleiches Bild wie Version 1, Ton um 6 dB leiser (nur die Tonspur neu kodiert: `ffmpeg -c:v copy -af volume=0.5 -c:a aac -b:a 112k -movflags +faststart`).
  Liegen direkt in `site/public/` (nicht in `site-src/`), der Build lässt sie unberührt.
- **Versionierung:** `/assets/*` wird ein Jahr gecacht (`_headers`, `immutable`). Ein neuer Schnitt bekommt deshalb einen neuen Namen
  (nächster: `stella-film-3.mp4` / `.jpg`), dann die beiden Pfade in `stella.body.html` (`poster` und `<source>`) anpassen. Alte Datei danach löschen.
- **Verhalten:** stumme Vorschau in Schleife, solange der Rahmen zu ≥ 50 % sichtbar ist; „Watch with sound“ startet mit Ton von vorn.
  Bei `prefers-reduced-motion` oder Datensparmodus kein Autoplay, nur Vorschaubild mit Play-Knopf. `preload="none"`: Das Video lädt erst beim Abspielen.
  Ohne JS bleibt der normale Browser-Player.
- **Worker für Byte-Ranges:** Workers Static Assets beantworten Range-Anfragen mit 200 und der ganzen Datei, Safari spielt so kein Video ab.
  Darum läuft `site/worker.js` vor den statischen Dateien, aber nur für `/assets/video/*` (`assets.run_worker_first` in `site/wrangler.jsonc`):
  Er holt die Datei über das Binding `ASSETS` und liefert genau einen Bereich als `206` mit `Content-Range` und `Accept-Ranges: bytes`
  (ungültige Range: `416`, HEAD geht). Alle anderen Adressen kommen weiter direkt als statische Datei, ohne den Worker.
- **Limit:** Im Free-Plan zählt jede Video-Anfrage (auch jede einzelne Range-Anfrage beim Spulen) zum Worker-Limit von 100 000 Anfragen pro Tag.
  Statische Dateien zählen nicht dazu.
- **Lokal prüfen:** in `site/` `npx wrangler dev`, dann
  `curl -sI -H "Range: bytes=0-1" http://localhost:8787/assets/video/stella-film-2.mp4` → `206`, `Content-Range: bytes 0-1/…`.

## Besucherzahlen (Website)

Gezählt wird nur mit **Cloudflare Web Analytics**: ohne Cookies, nichts auf dem Gerät, daher kein Cookie-Hinweis nötig. Eingeschaltet in Cloudflare →
Web Analytics → `evolsior.com` („Automatic setup“, Cloudflare fügt das Skript selbst ein). Alternativ `CF_BEACON_TOKEN` in `scripts/build-site.py`.
Google Analytics und der Cookie-Hinweis wurden wieder entfernt (verunsicherte nur). Datenschutzerklärung: `/privacy#web-analytics`.

**Zahlen im Dashboard** (Bereich **Website**) holt der Stella-Server (`server/src/webanalytics.ts`, `GET /api/admin/web-analytics`, nur Owner,
10 Minuten zwischengespeichert) über die GraphQL Analytics API. Zugangsdaten trägt der Owner im Dashboard unter **Connect Cloudflare** ein
(verschlüsselt im Server gespeichert, nie zurückgegeben), oder in `/etc/stella/stella.env`: `STELLA_CF_API_TOKEN`, `STELLA_CF_SITE_TAG`, `STELLA_CF_ACCOUNT_ID`.

- **API-Token:** My Profile → API Tokens → Create token → Custom: *Account → Account Analytics → Read*.
- **Site tag:** steht in der Adresse der Seite unter Web Analytics (32 Zeichen). Die Account-ID ist vorausgefüllt.

## Server selbst ausliefern (automatisch)

Der VPS prüft alle 5 Minuten `main` (`stella-autodeploy.timer`, Skript `deploy/autodeploy.sh`, eingerichtet von `deploy/install-vps.sh`).
Hat sich etwas für den Server geändert (`server/`, `shared/`, `web/`, `web-core/`, `deploy/`, `scripts/`, `package*.json`) **und ist die CI für genau
diesen Commit grün**, liefert er sich selbst aus. Rote CI → wird nicht ausgeliefert. Kein Schlüssel nötig: beide Repos sind öffentlich.

- Protokoll: `journalctl -u stella-autodeploy` · laufender Stand: `/var/lib/stella-autodeploy/deployed`
- Abschalten: `STELLA_AUTODEPLOY=off` in `/etc/stella/autodeploy.env` (bleibt bei Updates erhalten) oder `systemctl disable --now stella-autodeploy.timer`
- Von Hand (z. B. einen Branch): weiter `scripts/deploy-vps.sh`

Der Cloudflare-Token für das Dashboard ist auf die IPv4-Adresse des Servers beschränkt; der Server fragt Cloudflare deshalb immer über IPv4.

## Dashboard als PC-App

`dashboard-desktop/` ist ein Electron-Fenster um `dashboard.evolsior.com` (wie `desktop/` für Stella). GitHub Actions (*Dashboard-App*) baut bei Änderungen
den Windows-Installer; von `main` aus landet er unter Releases → „EVOLSIOR Dashboard für Windows“ (Tag `dashboard-app`). In der App bleibt die Anmeldung
bis „Sign out“ erhalten (im Browser nur bis der Tab zugeht). Neue Funktionen im Dashboard brauchen keine neue App-Version.

## Cloudflare (einmalig)

Workers & Pages → Create → Import a repository → `Stella-Life-Assistent`, Production branch `main`.
Project name `evolsior` (muss zu `name` in `site/wrangler.jsonc` passen). Unter Advanced: **Root directory** `site`.
Build command leer, Deploy command `npx wrangler deploy`. Danach im Projekt unter Settings → Domains & Routes:
`evolsior.com` und `www.evolsior.com` als Custom domain hinzufügen.

## E-Mail-Adressen (evolsior.com)

| Adresse | Wofür | Wie |
|---|---|---|
| `noreply@` | automatische Mails, z. B. Bestätigungs-Codes | nur senden (Resend), Antworten gehen an `support@` (Reply-To) |
| `stella@` | Mails, die Stella dir schreibt | senden über Resend, Antworten kommen hier an |
| `team@` | Kontakt zur Firma, Presse, Impressum und Datenschutz | Cloudflare Email Routing → eigenes Postfach |
| `support@` | Hilfe zu Stella, Einladungen | Cloudflare Email Routing → eigenes Postfach |

Senden: Resend (Domain `evolsior.com`, Region EU, DNS-Einträge über Cloudflare). SMTP-Zugangsdaten und Absender
`Stella <noreply@evolsior.com>` trägt der Owner in Stella unter Einstellungen → Server → E-Mail-Absender ein.
Die Adressen `stella@` und `support@` leitet der Server aus der Domain des Absenders ab (`server/src/mailer.ts`).
Empfangen: Cloudflare → Domain → Email → Email Routing, je Adresse eine Regel, alles an das eigene Postfach.
Einmalig DMARC als TXT `_dmarc`: `v=DMARC1; p=none; rua=mailto:team@evolsior.com`.

## Dashboard (dashboard.evolsior.com)

Zahlen pro App für die Firma, nur für den Owner-Account von Stella. Eigene statische Seite in `dashboard/public/`, eigenes
Cloudflare-Projekt. Von der Website aus gibt es keinen Link dorthin; die Seite ist `noindex` (robots.txt, `X-Robots-Tag`, Meta) und sieht
bewusst wie eine normale Kunden-Anmeldung aus. Mit „← evolsior.com“ kommt man zurück zur Website.

- **Zugang:** Anmeldung mit dem Stella-Konto (`POST /api/auth/login`). Ist das Konto nicht der Owner, meldet die Seite sofort ab und zeigt dieselbe
  Meldung wie bei falschem Passwort. Die Zahlen liefert `GET /api/admin/overview`, das der Server ohnehin nur dem Owner gibt (403 sonst).
- **Sitzung:** Das Token liegt in `sessionStorage` und verfällt mit dem Tab.
- **Server:** erlaubt Zugriffe von `https://dashboard.evolsior.com` (nur Admin- und Login-Routen). Andere Adressen über `STELLA_DASHBOARD_ORIGINS` (kommagetrennt).
- **Daten:** nur Zahlen. `mail_log` kennt Art, Zeit, Ergebnis und Domain des Empfängers, nie Inhalte oder volle Adressen.
- **Weitere Apps:** pro App eine Ansicht und ein `/api/admin/overview`-Gegenstück; der Reiter „Next app“ in `dashboard/public/index.html` ist der Platz dafür.

### Cloudflare (einmalig)

Workers & Pages → Create → Import a repository → `Stella-Life-Assistent`, Project name `evolsior-dashboard`, **Root directory** `dashboard`,
Deploy command `npx wrangler deploy`. Danach unter Settings → Domains & Routes die Custom domain `dashboard.evolsior.com` hinzufügen.
Optional zusätzlich Cloudflare Zero Trust → Access vor die Adresse legen (Einmalcode per E-Mail an dich).

## Zwei Adressen, ein Server (Paket 6)

- Beide Adressen zeigen auf **denselben** Dienst (`stella:8787`). Der Server liefert je Host die passende Web-App aus (`server/src/webapps.ts`):
  Host `students.*` → `editions/students/web/dist` (oder `STELLA_STUDENTS_WEB_DIR`), alles andere → `web/dist`.
  Fehlt die Studenten-App, antwortet der students-Host mit 503 (er zeigt nie die falsche App).
- **Bauen:** `npm run build` baut beide (`npm run build:students` nur die Studenten-App; sie nutzt die Abhängigkeiten dieses Repos und den Kern-Spiegel im Students-Repo).
  Das Plugin kommt mit `scripts/fetch-edition.sh` nach `editions/students` (siehe `docs/ARCHITEKTUR.md`).
- **Caddy:** `deploy/Caddyfile` hat den Block `students.{$STELLA_DOMAIN}`; `deploy/install-vps.sh` trägt `students.<domain>` ein (abschaltbar mit `STELLA_STUDENTS_HOST=off`)
  und setzt `STELLA_STUDENTS_URL`.
- **Vercel** (falls genutzt): zweites Projekt mit `vercel.students.json` (`installCommand` holt das Plugin, `outputDirectory` `editions/students/web/dist`, gleiche `/api`-Umschreibung;
  die App schickt den Header `X-Stella-Edition`, daher ist auch hinter einem anderen Host klar, zu welcher App ein Konto gehört).
- **Anmeldung:** Konten gehören zu genau einer Edition. Wer sich auf der falschen Adresse anmeldet, bekommt `409` mit Link zur richtigen App; Anmelde-Links
  (`login.<domain>`) führen nach dem Bestätigen auf die Adresse der Edition des Kontos.
