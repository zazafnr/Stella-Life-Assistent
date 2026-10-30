---
name: ios-preview
description: Zeigt die iOS-App von Stella als klickbare Vorschau in der Claude-App – echte Screenshots aus dem iPhone-Simulator mit Beispieldaten, immer unter demselben Link auf den neuesten Stand gebracht. Benutzen bei "zeig mir die iOS-App", "iOS-Vorschau", "wie sieht die App jetzt aus", "Vorschau aktualisieren", "neue Screenshots", oder nachdem etwas an ios/ geändert und gepusht wurde.
---

# iOS-Klick-Vorschau

Die echte SwiftUI-App kann nicht in der Claude-App laufen. Stattdessen macht die iOS-CI
(`.github/workflows/ios.yml`) bei jedem Push, der `ios/**` ändert, Folgendes:

1. Sie startet den echten Stella-Server mit Beispieldaten (`server/scripts/demo-seed.ts`).
2. Sie öffnet die App im iPhone-Simulator, mit den Startargumenten `-server`, `-demoToken`, `-tab` und `-open` (siehe `ios/Stella.swiftpm/Core/Demo.swift`).
3. Sie fotografiert sechs Screens: Heute, Chat, Planer, Inbox, Woche planen und Einstellungen.
4. Sie legt die Bilder mit `meta.json` (Commit, Zeit, Gerät, letzte Änderung) auf den Branch `ios-preview`.

Dieser Skill baut daraus eine Artifact-Seite und veröffentlicht sie immer unter **demselben
Link**. Wer die Seite offen hat, bekommt das Update automatisch.

## Ablauf

1. **Ist die Vorschau aktuell?** Vergleiche `git log -1 --format=%H -- ios server/scripts/demo-seed.ts`
   auf dem Arbeitsbranch mit `commit` aus `meta.json` (Schritt 2 gibt es aus).
   - Neuerer Commit und der iOS-Lauf ist noch nicht fertig (GitHub-MCP `actions_list`,
     Workflow `ios.yml`): Sag das und warte auf das Ende des Laufs. Pollen ist dafür in
     Ordnung, ein Lauf dauert etwa 5 Minuten.
   - Neuerer Commit, aber kein Lauf dazu: Starte ihn mit `actions_run_trigger`
     (`run_workflow`, `ios.yml`, Branch = Arbeitsbranch).
   - Ist der Lauf grün, aber `ios-preview` unverändert: Ein Vorschau-Schritt ist gescheitert
     (sie laufen mit `continue-on-error`). Lies die Logs mit `get_job_logs` und behebe den Fehler.

2. **Seite bauen** in den Scratchpad-Ordner:
   ```bash
   python3 .claude/skills/ios-preview/build.py <scratchpad>/ios-preview
   ```
   Das legt `index.html` und `screens/*.jpg` an und gibt `meta.json` aus.

3. **Veröffentlichen – immer dieselbe Seite:**
   - Suche mit `Artifact` (`action: "list"`) die Seite mit dem Titel **„Stella iOS-Vorschau“**.
   - **Gibt es sie:** Lies sie zuerst (`action: "read"`, ihre `url`). Danach veröffentlichst du mit dieser `url`,
     `file_path` = `<scratchpad>/ios-preview/index.html` und
     `files` = `{"screens/today.jpg": "<scratchpad>/ios-preview/screens/today.jpg", …}` für alle Bilder.
     Kein `icon` mitgeben.
   - **Gibt es sie nicht:** Veröffentliche neu, mit denselben Angaben, ohne `url`, mit `icon: "phone"` und
     der `description` „Klickbare Vorschau der Stella-iOS-App, immer auf dem neuesten Stand.“
   - Das Artifact-Design-Skill musst du dafür nicht laden. Die Seite ist fertig gestaltet und hält
     den Seitenvertrag ein: Titel, beide Themes, Seitenabstände.

4. **Antworten** auf Deutsch, kurz: Link, Stand (Zeit, Commit) und welche Änderung
   drin ist (`message` aus `meta.json`).

## Wenn etwas anders aussehen soll

- **Neuer Screen:** In `ios.yml` eine `shoot`-Zeile ergänzen und in `meta.json` `screens` erweitern.
  In `template.html` einen Eintrag in `SCREENS` ergänzen. Für Sheets in der App wie bei
  `Demo.opens("weekplan")` einen Startwert setzen.
- **Andere Beispieldaten:** Ändere `server/scripts/demo-seed.ts`. Lege alles über Stellas echte Funktionen
  an (addItem, handleChat, perform), damit die Screens zeigen, was die App wirklich anzeigt.
- **Grenzen:** Die Bilder sind echt, die Seite ist aber keine laufende App. Knöpfe wie „Senden“ tun dort nichts.
  Im Simulator fehlen Schrittzähler, Kamera und Push-Mitteilungen.
