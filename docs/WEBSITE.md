# Website evolsior.com

Statische Seite (kein Framework). Quellen in `site-src/`, gebaut nach `site/` (liegt im Repo).

| Adresse | Inhalt |
|---|---|
| `evolsior.com` | Firmenseite (EVOLSIOR, „Built to become“, Apps) |
| `evolsior.com/stella` | Vorstellung von Stella |
| `evolsior.com/imprint`, `/privacy` | Impressum und Datenschutz (englisch; `/impressum` und `/datenschutz` leiten um) |
| `stella.evolsior.com` | die Stella-Web-App (VPS), `evolsior.com/stella/app` leitet dorthin |

## Ändern

1. Texte und Aussehen in `site-src/` ändern (`*.body.html`, `*.css`, `*.js`).
2. `python3 scripts/build-site.py` – baut `site/`.
3. `site/` committen und nach `main` pushen. Cloudflare Pages veröffentlicht automatisch.

Die iPhone-Bilder (`site/assets/stella/*.jpg`, 1179×2556, mit Statusleiste) entstehen aus der Web-App mit Demo-Daten
(`server/scripts/demo-seed.ts`). Die App spricht Deutsch, die Bilder sind für die englische Seite übersetzt.

## Cloudflare Pages (einmalig)

Workers & Pages → Create → Pages → Connect to Git → Repo `Stella-Life-Assistent`, Branch `main`.
Build command: leer. Build output directory: `site`. Danach im Projekt „Custom domains“: `evolsior.com` und `www.evolsior.com`.

## E-Mail

Absender `noreply@evolsior.com` über SMTP (Einstellungen → Server → E-Mail-Absender in Stella). Der Versanddienst verlangt
SPF-, DKIM- und DMARC-Einträge in Cloudflare DNS. `hello@evolsior.com` leitet Cloudflare Email Routing an das eigene Postfach.
