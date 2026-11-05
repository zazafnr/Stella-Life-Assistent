# Stella für iPhone und iPad

Native SwiftUI-App im hellen Stella-Design für Alltag und Beruf (Bundle `app.stella.ios`). Sie ist ein Betrachter: gerechnet wird
auf dem Server, die App zeigt an, plant Erinnerungen ein und schickt Nachrichten.

> **Zwei Apps:** Die Studenten-App „Stella for Students“ (`app.stella.students.ios`) liegt im Repo
> [`Stella-for-Students`](https://github.com/zazafnr/Stella-for-Students) unter `ios/StellaStudents.swiftpm`. Ihr `Core/` und `Design/` sind eine Kopie von hier;
> die App erkennt ihre Edition an der Bundle-ID (`API.edition`) und meldet sich mit dem Header `x-stella-edition` an.
> Änderungen an `Core/` und `Design/` passieren nur hier; danach im Students-Repo `npm run sync:core && scripts/sync-ios.sh`.

## Auf das iPad (Swift Playgrounds)

1. Auf dem iPad **Swift Playgrounds** aus dem App Store laden (kostenlos).
2. In Safari das Repo öffnen, Branch `claude/determined-brown-7l04hi` wählen →
   grüner Button **Code** → **Download ZIP**.
3. In der **Dateien**-App die ZIP antippen (wird entpackt), dann `ios` →
   **`Stella.swiftpm`** antippen. Der Ordner öffnet sich in Swift Playgrounds.
4. Oben auf **▶︎ Ausführen** tippen und mit deinem Stella-Konto anmelden.

## Auf das iPhone

Swift Playgrounds gibt es nicht für das iPhone. Zwei Wege:

* **Mac mit Xcode:** `Stella.swiftpm` in Xcode öffnen, iPhone per Kabel anschließen,
  unter *Signing & Capabilities* deine Apple-ID als Team wählen, ▶︎. Mit einer
  kostenlosen Apple-ID läuft die App 7 Tage, danach einfach erneut ▶︎.
* **TestFlight:** Mit einem Apple-Entwicklerkonto (99 €/Jahr) kann Swift Playgrounds
  die App vom iPad aus direkt zu App Store Connect hochladen; das iPhone installiert
  sie dann über TestFlight und aktualisiert sie selbst.

## Was die App kann

| Bereich | |
|---|---|
| Heute | Fälliges für morgen, nächster Test als Countdown-Ring, Schritte, Kalender, Inbox-Zusammenfassung |
| Chat | Kurzschrift wie „Zahnarzt Freitag 15 Uhr“, Fotos und Kamera, Sprachnachrichten, Ohne-Netz-Postausgang |
| Planer | Wochenleiste, Einträge, Abhaken mit Konfetti, Überfälliges; Knopf „Kalender“ öffnet Monat → Tag (`CalendarView`) mit neuem Termin |
| Inbox | Wichtig / Social / SMS / Gelöscht, gelöschte Werbung zurückholen |
| Einstellungen | Werbung löschen, Zeiten, Schritte-Ziel, Verbindungen (E-Mail), KI-Verbrauch |

* **Erinnerungen** kommen als lokale Mitteilungen: Die App holt `/api/reminders/upcoming`
  und plant sie auf dem Gerät ein. Sie kommen also auch ohne Netz pünktlich.
* **Schritte** liest das iPhone direkt aus dem Bewegungssensor und meldet sie an Stella.
  Der Apple-Kurzbefehl dafür ist nicht mehr nötig.
* Zugangsdaten (E-Mail) richtest du einmal auf der Website ein.
  Die App zeigt, was verbunden ist, und öffnet die Seite mit einem Tipp.

## Aufbau

```
Stella.swiftpm/
  App/      Einstieg, Tabs
  Core/     Modelle, API (Token im Schlüsselbund), Store mit Zwischenspeicher,
            Mitteilungen, Schritte
  Design/   Farben, Karten, Himmel mit Wolken und Sternschnuppe, Konfetti, Bilder
  Views/    Heute, Chat, Planer, Detail, Inbox, Einstellungen, Schritte-Diagramm
```

Bei jedem Push baut GitHub Actions die App mit Xcode 26 für den Simulator
(`.github/workflows/ios.yml`).
