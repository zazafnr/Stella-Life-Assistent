# Web- und PC-Oberfläche

Die Web-App (`web/`) und die PC-App (`desktop/`, lädt dieselbe Oberfläche) haben ein eigenes Desktop-Layout:

- **Gerüst** (`web/src/App.tsx`, `web-core/src/ui/Shell.tsx`): einklappbare Seitenleiste, oberes Band mit Seitentitel, Suche (Strg/Cmd + K) und Status, Befehlspalette. Unter 760 px bleibt die untere Leiste als Notlösung.
- **Stylesheet** (`web-core/src/desk.css`) liegt über `core.css`: Marke (Farben, Schrift, Stern) bleibt, Maße und Layout sind für Maus und große Bildschirme gebaut.
- **Seiten**: Heute als Dreispalten-Übersicht, Planer mit Wochentafel (und Tagesansicht), Ziele als Kartenraster, Einstellungen in zwei Spalten, Detailfenster als Seitenfenster rechts.
- **Wetter gibt es nur in der PC-App** (`window.stellaDesktop`, siehe `web-core/src/platform.ts`). Im Browser läuft weder der Abruf noch die Leinwand, der Chip und die Einstellung fehlen, der Ladebildschirm zeigt keinen Wetterhimmel.

## Prüfen

Demo-Server starten (`server/scripts/demo-seed.ts` legt das Konto an und schreibt das Token nach `$STELLA_DEMO_DIR/token.txt`), dann:

```bash
CHROME_PATH=/pfad/zu/chrome node scripts/ui-check/weather-gate.cjs
xvfb-run -a ELECTRON_PATH=/pfad/zu/electron node scripts/ui-check/electron.cjs
```

`weather-gate` prüft Browser (kein Wetter) gegen PC-App (Wetter gemalt, Chip, Einstellung); `electron` prüft dasselbe in einer echten Electron-Laufzeit.

## Aufteilung seit Paket 4: `web-core` und die Apps

- **`web-core/`** (Workspace `@stella/web-core`) enthält die Bausteine, die Stella und Stella for Students teilen: Speicher (`store.ts`), Sprache (`i18n.ts`), Push, Audio,
  Plattform, Wetter, `ui/` (Icon, Decor, Shell), die Komponenten (Chat, Rich, ActionCard, BriefingCard, Inbox, Ziele, Listen, Gesundheit, Bildschirmzeit, Was Stella vorhat,
  News, Orte, Alltagskarten, Anmeldung, Wochenplan, Finanzen-Karte, Einführung) und `settings/*` ohne die schulischen. Dazu `core.css` (Komponenten-Stile) und `desk.css`.
- **Jede App** (`web/`, später die Students-App) besitzt `App.tsx` (Gerüst, Tabs, Navigation), `main.tsx`, **`theme.css`** (die Farbvariablen in `:root`), `Today`, `Planner`/Kalender,
  `Intro`, Manifest, Service Worker und Icons.
- **Import:** `@stella/web-core/<pfad>` (Alias in `web/tsconfig.json` und `vite.config.ts`; es gibt keinen eigenen Build-Schritt für web-core).
- **Theme nur über Variablen:** gemeinsame Komponenten lesen die Farben aus `:root` (`--blue`, `--pink`, `--bg`, `--radius` …). Stand: `core.css` benutzt Variablen für die Marke;
  einzelne feste Werte (Schatten, Verläufe) sind noch offen – wer eine App umfärbt, ändert `theme.css`.
