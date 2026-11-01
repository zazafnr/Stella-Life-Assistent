# Wetter-Animationen: Abnahme (Paket 8)

Stand: Web fertig und mit Playwright geprüft. Die iOS-Fassung (`ios/Stella.swiftpm/Design/Weather/`) ist geschrieben, aber in dieser Umgebung **weder kompiliert noch im Simulator gesehen** (es gibt hier kein Swift). Der Xcode-Build in GitHub Actions zeigt, ob sie baut; Farben und Zahlen kommen aus `WeatherPalette.swift` (erzeugt, im CI geprüft).

## Bilder

- `szenen-1.jpg`: klar, teils bewölkt, bewölkt, Nebel, Niesel – oben Tag, unten Nacht
- `szenen-2.jpg`: Regen, Starkregen, Gewitter (mit Blitz), Schnee, Schneeregen – oben Tag, unten Nacht
- `ladebildschirm.jpg`: der abgespeckte Ladebildschirm (CSS + Inline-Skript) mit gespeichertem Wetter

Erzeugt mit der echten Engine (`web/src/weather/engine.ts`, fester Startwert, 10 s vorgespult, Gewitter mit ausgelöstem Blitz).
Alle 20 Szenen (10 Typen × Tag/Nacht) sind angesehen worden. Beim Prüfen gefundene Fehler wurden behoben:
abgeschnittene Wolkenränder (horizontale Kanten), lange Diagonale durch Tropfen-Spuren beim Neustart eines Glas-Tropfens,
Blitz direkt beim Erzeugen der Szene, schwer sichtbare Flocken auf hellem Himmel.

## Lesbarkeit (automatisch getestet, `shared/src/weather.scene.test.ts`)

- Kontrast ≥ 4,5:1 für Kopfzeile, Antwort- und eigene Blase in jeder Szene, auch mit dem stärksten Blitz-Aufhellen.
- Dunkel (helle Schrift, dunkle Blasen): Nacht, Gewitter, Starkregen. Die Farben stehen in `READABLE` und in `styles.css`; ein Test vergleicht beides.
- Blitze: höchstens einer in 5 s (Test über eine Stunde), Aufhellen gedeckelt auf 20 %, höchstens 3 Lichtwechsel pro Sekunde (Hüllkurve gemessen).

## Leistung

Gemessen wurde der CPU-Anteil pro Bild (Zeichenbefehle, 90 Bilder je Szene) in Headless-Chromium ohne GPU:

| Gerät | Durchschnitt | Schlechteste Szene |
|---|---|---|
| Handy 390×844 @2x | 0,21 ms | Schnee (Nacht) 0,63 ms |
| Desktop 1440×900 @1x | 0,70 ms | Schnee (Nacht) 8,55 ms |

Das Rastern auf der GPU ist darin nicht enthalten. Die echte Bildrate auf einem iPhone 12 bzw. einem Laptop ist **noch nicht gemessen** und gehört in die Abnahme am Gerät. Die Engine senkt die Teilchenzahl selbst, wenn die Bildrate unter 40 fällt.

## Offen für dich (am Gerät)

- iOS-Fassung im Simulator bzw. mit `ios-preview` ansehen (alle Szenen über Einstellungen → Server → „Wetter erzwingen“).
- Bildrate auf dem iPhone prüfen.
- Optional: Haptik beim Blitz ist als Schalter angelegt, standardmäßig aus.
