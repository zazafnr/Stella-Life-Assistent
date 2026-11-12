# Stella am PC

Die **echte** iOS-App (`ios/Stella.swiftpm`, ebenso `StellaStudents.swiftpm` aus dem Students-Repo)
läuft hier unverändert auf Windows und Linux. Zum schnellen Testen am PC, ohne Mac, ohne Simulator
und ohne Appetize-Minuten.

```
ios/PC/
  Sources/SwiftUI/      Ersatz für SwiftUI (View-Auswertung, State, Environment, Navigation, Listen …)
                        und für die iPhone-Frameworks (UIKit, Charts, PhotosUI, Security, …)
  Sources/SwiftUI/Web/  das Fenster: zeichnet den View-Baum als iPhone-Bildschirm
  Sources/<Framework>/  leere Module, damit `import UIKit` usw. in der App funktioniert
  scripts/              stella-pc.ps1 (Windows), stella-pc.sh (Linux/macOS)
```

## So funktioniert es

1. Das Skript kopiert `App/`, `Core/`, `Design/` und `Views/` der App nach `ios/PC/.work/<App>/`.
   Dabei ändert es genau zwei Dinge: die Bundle-ID (daran erkennt die App, ob sie Stella oder
   Stella for Students ist) und `waitsForConnectivity`, das es außerhalb von Apple nicht gibt.
2. Swift baut die App gegen die Ersatzschicht in `Sources/`: dieselben Typen und Modifier wie
   SwiftUI, aber ohne Apple-Bibliotheken.
3. Die App wertet ihre Views wie auf dem iPhone aus (State, `@Observable`, Environment, Tasks)
   und schickt nach jeder Änderung den View-Baum an ein Fenster auf `127.0.0.1`. Das Fenster
   öffnet sich in Edge oder Chrome im App-Modus, in Handygröße. Klicks und Eingaben gehen zurück
   an die App.

Der Server nimmt nur Verbindungen von diesem Rechner an, und nur mit dem zufälligen Schlüssel aus
der Adresse.

## Einrichten unter Windows (einmalig)

Swift für Windows nach der offiziellen Anleitung installieren: <https://www.swift.org/install/windows/>.
Sie installiert zuerst Visual Studio (Build Tools mit C++ und Windows SDK) und dann die Swift-Toolchain:

```powershell
winget install --id Swift.Toolchain
```

Nur für den Offline-Modus (`-Demo`):

```powershell
winget install --id OpenJS.NodeJS.LTS
```

Danach ein **neues** Terminal öffnen, damit `swift` gefunden wird.

## Starten

Im Ordner `Stella-Life-Assistent`:

```powershell
.\ios\PC\scripts\stella-pc.ps1 -Demo
```

| Befehl | was passiert |
|---|---|
| `stella-pc.ps1` | Stella gegen den echten Server, Anmeldung wie am iPhone |
| `stella-pc.ps1 -Demo` | **offline**: startet den Stella-Server dieses Repos lokal, mit denselben Beispieldaten wie die iOS-Vorschau, und meldet die App dort an |
| `stella-pc.ps1 students -Demo` | Stella for Students, offline. Erwartet das Repo daneben (`..\Stella-for-Students`), sonst `-Repo C:\Pfad` |
| `stella-pc.ps1 -BuildOnly` | nur bauen (der erste Build dauert ein paar Minuten, danach Sekunden) |
| `stella-pc.ps1 -AppArgs '-tab','chat'` | Startargumente wie in der CI: `-tab`, `-open`, `-server` … |

Unter Linux und macOS gilt dasselbe mit `ios/PC/scripts/stella-pc.sh` und `--demo`, `--build-only`,
`--repo`, `-- -tab chat`.

Bei `-Demo` installiert das Skript beim ersten Mal die Server-Pakete (`npm ci`) und legt die
Beispieldaten in `ios/PC/.work/demo-<App>/` an. Danach braucht es kein Internet mehr. Neue
Beispieldaten: diesen Ordner löschen.

Im Fenster: **F5** löst „Ziehen zum Aktualisieren“ aus, **Esc** schließt Sheets und Menüs oder geht
eine Seite zurück, ein Rechtsklick auf eine Listenzeile zeigt die Wisch-Aktionen.

## Was am PC anders ist

| | am PC |
|---|---|
| Layout, Farben, Navigation, Listen, Sheets, Animationen | wie in SwiftUI nachgebaut, nicht pixelgenau. Schrift: Inter und Nunito statt SF Pro |
| Symbole | SF Symbols gibt es nur auf Apple-Geräten. Hier stehen Icons aus [Lucide](https://lucide.dev) (ISC-Lizenz) |
| Fotos wählen | Dateidialog des PCs |
| Erinnerungen | als PC-Mitteilung, solange das Fenster offen ist |
| Links, Safari, Google-Anmeldung | öffnen im Browser; die Rückkehr in die App per `stella-auth://` gibt es nicht |
| Kamera, QR-Scanner, Mikrofon, Schritte, Standort, Bildschirmzeit, Haptik | nicht vorhanden; die App zeigt das wie auf einem Gerät ohne diese Funktion |
| Anmeldung | Token liegt in `%APPDATA%\StellaPC\<App>\schluesselbund.json` statt im Schlüsselbund |

Fürs Aussehen auf dem echten iPhone bleibt der Appetize-Simulator bzw. die Klick-Vorschau
(`.claude/skills/ios-preview`) maßgeblich. Die PC-Version ist zum schnellen Durchklicken
und Testen von Abläufen gedacht.

## Wenn eine App-Änderung am PC nicht baut

Die CI `Stella am PC (Swift)` (`.github/workflows/pc-swift.yml`) baut die App bei jeder Änderung
unter `ios/` unter Windows und Linux. Schlägt sie fehl, nutzt die App ein SwiftUI-Teil, das die
Ersatzschicht noch nicht kennt. Dann gehört es in `Sources/SwiftUI/`, nicht in die App.
