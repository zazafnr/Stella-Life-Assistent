# Web- und PC-Oberfläche

Die Web-App (`web/`) und die PC-App (`desktop/`, lädt dieselbe Oberfläche) haben ein eigenes Desktop-Layout:

- **Gerüst** (`web/src/App.tsx`, `web/src/ui/Shell.tsx`): einklappbare Seitenleiste, oberes Band mit Seitentitel, Suche (Strg/Cmd + K) und Status, Befehlspalette. Unter 760 px bleibt die untere Leiste als Notlösung.
- **Stylesheet** (`web/src/desk.css`) liegt über `styles.css`: Marke (Farben, Schrift, Stern) bleibt, Maße und Layout sind für Maus und große Bildschirme gebaut.
- **Seiten**: Heute als Dreispalten-Übersicht, Planer mit Wochentafel (und Tagesansicht), Ziele als Kartenraster, Einstellungen in zwei Spalten, Detailfenster als Seitenfenster rechts.
- **Wetter gibt es nur in der PC-App** (`window.stellaDesktop`, siehe `web/src/platform.ts`). Im Browser läuft weder der Abruf noch die Leinwand, der Chip und die Einstellung fehlen, der Ladebildschirm zeigt keinen Wetterhimmel.

## Prüfen

Demo-Server starten (`server/scripts/demo-seed.ts` legt das Konto an und schreibt das Token nach `$STELLA_DEMO_DIR/token.txt`), dann:

```bash
CHROME_PATH=/pfad/zu/chrome node scripts/ui-check/weather-gate.cjs
xvfb-run -a ELECTRON_PATH=/pfad/zu/electron node scripts/ui-check/electron.cjs
```

`weather-gate` prüft Browser (kein Wetter) gegen PC-App (Wetter gemalt, Chip, Einstellung); `electron` prüft dasselbe in einer echten Electron-Laufzeit.
