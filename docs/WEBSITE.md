# Website evolsior.com

Statische Seite (kein Framework). Quellen in `site-src/`, gebaut nach `site/public/` (liegt im Repo), Cloudflare-Konfiguration in `site/wrangler.jsonc`.

| Adresse | Inhalt |
|---|---|
| `evolsior.com` | Firmenseite (EVOLSIOR, „Built to become“, Apps) |
| `evolsior.com/stella` | Vorstellung von Stella |
| `evolsior.com/imprint`, `/privacy` | Impressum und Datenschutz (englisch; `/impressum` und `/datenschutz` leiten um) |
| `stella.evolsior.com` | die Stella-Web-App (VPS), `evolsior.com/stella/app` leitet dorthin |

## Ändern

1. Texte und Aussehen in `site-src/` ändern (`*.body.html`, `*.css`, `*.js`).
2. `python3 scripts/build-site.py` – baut `site/public/`.
3. `site/` committen und nach `main` pushen. Cloudflare veröffentlicht automatisch.

Die iPhone-Bilder (`site/public/assets/stella/*.jpg`, 1179×2556, mit Statusleiste) entstehen aus der Web-App mit Demo-Daten
(`server/scripts/demo-seed.ts`). Die App spricht Deutsch, die Bilder sind für die englische Seite übersetzt.

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
