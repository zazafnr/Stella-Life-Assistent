# Stella: Entscheidungen, Grenzen, Fahrplan

## 1. KI-Modell: OpenRouter, automatisch das beste kostenlose

**Stimmt das mit den 10 $?** Ja. Laut den offiziellen [OpenRouter-Limits](https://openrouter.ai/docs/api-reference/limits) gilt:
- Mit weniger als 10 $ jemals gekauften Credits: **50 Anfragen pro Tag** an `:free`-Modelle.
- Ab **10 $ einmalig gekauft: 1000 Anfragen pro Tag**. Gezählt werden die *jemals gekauften* Credits, das gilt also dauerhaft, auch wenn das Guthaben später aufgebraucht ist.
- Zusätzlich gilt: höchstens 20 Anfragen pro Minute. Das Limit zählt fürs ganze Konto, nicht pro Modell.
- Kein Minus-Guthaben haben, sonst kommen auch bei Gratis-Modellen Fehler (402).

**Reicht das?** Locker. Kurznotizen („Latein HÜ …“, „was steht an?“, „erledigt“) erledigt Stella *ohne* KI, sie kosten also keine einzige Anfrage. Eine freie Frage braucht 1–3 Anfragen (wegen der Werkzeug-Aufrufe). Selbst mit späterer E-Mail-Sortierung bleibst du weit unter 1000 pro Tag.

**Welches Modell?** Gratis-Modelle kommen und gehen bei OpenRouter fast wöchentlich. Ein fest eingetragenes Modell wäre in ein paar Wochen weg. Deshalb macht Stella es so (`server/src/llm.ts`):
1. Alle 6 Stunden die aktuelle Modell-Liste holen.
2. Nur `:free`-Modelle mit **Tool-Unterstützung** nehmen. Ohne Tools kann die KI keine Einträge anlegen.
3. Nach einer Vorliebe-Liste sortieren (Stand Ende Oktober 2026 gelten laut aktuellen Vergleichen u. a. *Thinking Machines Inkling*, *NVIDIA Nemotron 3 Super* und *Google Gemma 4* als die stärksten freien Modelle), danach nach Kontextlänge.
4. Bei Überlastung (429) oder einem entfernten Modell (404) automatisch das nächste probieren. Als letzte Rettung kommt `openrouter/free`, OpenRouters eigener Router für Gratis-Modelle.

Welche Modelle gerade aktiv sind, siehst du in der App unter **Einstellungen → KI**. Mit `STELLA_MODELS=modell-a,modell-b` in der `.env` legst du die Reihenfolge selbst fest.

**⚠️ Datenschutz:** Manche Gratis-Anbieter speichern Eingaben oder trainieren damit. Für Planer-Einträge ist das egal. Bevor Stella aber **E-Mails** liest, solltest du in den [OpenRouter-Einstellungen](https://openrouter.ai/settings/privacy) Anbieter ausschließen, die mit deinen Daten trainieren. Oder du nimmst für E-Mails ein sehr günstiges bezahltes Modell (Cent-Beträge im Monat).

## 2. „Läuft auch ohne Internet“

Wichtig zu verstehen: Hat dein **Handy** kein Netz, kann es auch deinen VPS nicht erreichen. Dafür gibt es zwei Ebenen:

| Situation | Was passiert |
|---|---|
| Handy offline | Die App startet trotzdem (Service Worker). Planer und Chat-Verlauf liegen im Gerät. Kurznotizen versteht die App sofort selbst, gleicher Parser wie am Server. Nachrichten landen im Postausgang und werden gesendet, sobald wieder Netz da ist. Doppelte Einträge gibt es dabei nicht (`clientId`). |
| Handy aus oder in der Schule im Flugmodus | Der **VPS** arbeitet weiter: Erinnerungen werden pünktlich verschickt, digi4school-Seiten geholt. Die Push-Mitteilung kommt an, sobald das Handy wieder online ist. |
| KI (OpenRouter) nicht erreichbar | Kurznotizen, Erinnerungen und Lernpläne funktionieren weiter, weil sie regelbasiert sind. Nur freie Fragen gehen dann nicht. |

Ein komplett lokales KI-Modell auf dem Handy wäre möglich (z. B. ein kleines Modell über die native App), ist aber langsam und deutlich schwächer. Das lohnt sich erst später.

## 3. Plattformen: eine Codebasis für alles

Gewählt: **PWA (Progressive Web App)** + Server auf dem VPS.
- **Kostenlos.** Eine native iOS-App bräuchte ein Apple-Entwicklerkonto (99 $/Jahr). Ohne Konto laufen selbst installierte Apps nur 7 Tage.
- iPhone, iPad, Mac, Windows und Web aus **einem** Code. Push-Mitteilungen funktionieren auf iOS ab 16.4, wenn die App am Home-Bildschirm liegt.
- Updates sofort, ohne App Store.

Später, wenn nötig: eine **native iOS-App mit Expo (React Native)**. Die Logik in `shared/` lässt sich direkt wiederverwenden. Vorteile: HealthKit direkt, Widgets, Siri, Share-Sheet („Foto der Tafel an Stella“).

## 4. Was iOS und die Social-Media-Apps erlauben (ehrlich)

| Wunsch | Machbar? | Weg |
|---|---|---|
| Kalender | ✅ | Kalender-Abo (eingebaut). Später auch zweiseitig über CalDAV/Google Calendar API |
| Notizen | ✅ | eigene Notes-App über deren API (siehe Fahrplan). Apple Notizen hat keine Schnittstelle |
| E-Mails (2 Konten) | ✅ | IMAP (Gmail, Outlook, GMX …) mit App-Passwort. Stella verschiebt Unwichtiges in den **Papierkorb** statt endgültig zu löschen, damit nichts unwiederbringlich weg ist |
| SMS/iMessage | 🟡 | nur über die Kurzbefehle-Automation „Nachricht empfangen“ (eingebaut). Keine App darf SMS direkt lesen |
| Anrufliste | ❌ auf iOS | Apple erlaubt keiner App Zugriff, und es gibt auch keinen Kurzbefehl-Auslöser für Anrufe. Auf Android ginge es |
| Schritte, Schlaf | ✅ | Kurzbefehl schickt die Health-Daten täglich (eingebaut). Mit nativer App direkt über HealthKit |
| Instagram | 🟡 | keine Schnittstelle für private Konten. Möglich: **Benachrichtigungs-E-Mails** von Instagram auswerten (wer hat geliked, kommentiert, geschrieben). Das klappt, sobald die E-Mail-Anbindung steht. Mit Creator-/Business-Konto gibt es außerdem die offizielle Graph API für Kommentare und Erwähnungen |
| TikTok | 🟡 | wie Instagram über Benachrichtigungs-E-Mails. Eine offizielle API für DMs oder Likes gibt es nicht |
| Snapchat | ❌ | keine Schnittstelle, keine E-Mails. Login-Automatisierung würde Snapchat sofort sperren |

Von Bots, die sich mit deinem Passwort in Instagram, TikTok oder Snapchat einloggen, rate ich klar ab: Das verstößt gegen deren Regeln, und dein Konto wird sehr wahrscheinlich gesperrt.

## 5. Schulbücher (scook, digi4school) einrichten

Keiner der Anbieter hat eine offizielle Schnittstelle. Stella steuert deshalb einen unsichtbaren Browser: Sie öffnet das Buch, tippt die Seitenzahl ins Seitenfeld („45 / 236“) und schneidet nur die Buchseite aus.
1. Einstellungen → Schulbücher → bei **scook** bzw. **digi4school** einloggen. Klappt der Login nicht (z. B. Microsoft-/Schul-Login): am PC einloggen, mit der Chrome-Erweiterung „Cookie-Editor“ die Cookies als JSON exportieren und bei Stella einfügen.
2. Unter **Fach → Buch** den Link des Buchs eintragen, z. B. `https://scook.at/produkt/d85c6530-…` für *Nouvelles Perspectives A2+* → Fach „Französisch“, Anbieter „scook“.
3. **Testen**: Fach wählen, Seite 45 → „Seite holen“. Zeigt das Bild eine andere Seite, den Seitenversatz anpassen. In deinem scook-Buch stimmt die Viewer-Seite mit der gedruckten überein (45 = „quarante-cinq“), Versatz also 0.

## 6. HÜ-Autopilot & FreeNotes

Ablauf: Kurznotiz oder Foto → Stella holt die Buchseite → ein **Bildmodell** (automatisch das beste kostenlose bei OpenRouter) löst die Aufgabe → Ergebnis im **Heft-Format von FreeNotes** (`__S. 45 Nr. 16__`, Ergebnisse `==x = 4==`, kurze Zeilen) → **FreeNotes** holt es ab und schreibt es mit deiner Handschrift-Engine als echte, radierbare Pencil-Striche ins Fach-Heft. Danach ist die HÜ erledigt, und am Vorabend schreibt Stella nur noch „✅ Französisch HÜ erledigt“.

Gut zu wissen:
- **Wann es im Heft steht:** FreeNotes kann auf dem iPad nicht im Hintergrund laufen. Es schreibt beim nächsten Öffnen der App, solange gerade kein Heft offen ist, und danach alle 5 Minuten.
- **Qualität:** Gratis-Bildmodelle lesen Buchseiten gut, sind aber nicht fehlerfrei. Wenn eine Lösung nicht passt, im Chat „Französisch HÜ nochmal lösen“ schreiben oder mit `STELLA_VISION_MODELS` ein stärkeres Modell festlegen.
- Ausschalten: Einstellungen → Schulbücher → HÜ-Autopilot.

## 7. Stella als Assistentin: Lagebild, Aktionen, Gedächtnis

Stella soll sich nicht wie ein Chatbot anfühlen, sondern Zusammenhänge sehen und Arbeit abnehmen.
Drei Bausteine tragen das – alles Weitere (Briefing, Hinweise, Wochenplan) baut darauf auf.

**Lagebild** (`server/src/context.ts`) – eine Sicht auf die nächsten Tage: Stunden mit Entfall,
Einträge, Tests mit Lernstand, überfällige Dinge, wichtige Nachrichten, Gedächtnis und die **freien
Zeitfenster** (Schule, Routinen und Termine sind belegt). Kommt ohne KI aus. Der Chat-Agent bekommt es
komplett in den Prompt; Briefing, Hinweise und Wochenplanung lesen dieselbe Quelle.

**Aktionen mit Rechte-Stufen** (`server/src/actions.ts`) – alles, was Stella *tut*, ist eine benannte
Aktion (Eintrag anlegen/verschieben/löschen, Lernplan, HÜ lösen, sich etwas merken) mit Protokoll und
7 Tage „Rückgängig“. Je Bereich gilt eine Stufe: *selbst · melden · fragen · nie*.
- Was der Nutzer im Chat verlangt, ist Zustimmung → wird ausgeführt (außer „nie“).
- Was Stella von sich aus tut (Autopilot, Gelerntes, später Hinweise), folgt der Stufe; „fragen“
  erzeugt eine Karte mit Ja/Nein im Chat. „mach das rückgängig“ nimmt die letzte Aktion zurück.

**Gedächtnis** (`server/src/memory.ts`, `learning.ts`) – Fakten pro Nutzer (Personen, Routinen mit
Wochentag und Uhrzeit, Vorlieben, Schule, Ziele). Stella lernt selbst: im Chat über das Werkzeug
`remember`, und einmal pro Nacht (2–5 Uhr) aus allen Nachrichten des Tages – auch denen, die ohne KI
verarbeitet wurden. Routinen mit Zeiten gelten im Lagebild als belegt. Der Nutzer sieht und ändert
alles unter „Was Stella über dich weiß“.

**Modelle pro Aufgabe** – Gratis-Modelle für die Masse; mit `STELLA_HEAVY_MODELS` /
`STELLA_HEAVY_VISION_MODELS` bekommen schwere Aufgaben (HÜ lösen, mehrstufige Ketten) zuerst ein
stärkeres Modell. Bezahlmodelle zählen nicht zum Gratis-Tageslimit.

**Hinweise – „Was hast du vergessen?“** (`server/src/hints.ts`) – Regeln über das Lagebild, ohne KI:
Test ohne Stoff, Test ohne Lernplan, verpasste Lerneinheit (mit freiem Ersatztermin), überfällige
HÜ, Stunde entfällt aber die HÜ dafür steht noch drin, HÜ ohne Foto/Buch, zu viel auf einmal.
Jeder Hinweis hat einen stabilen Schlüssel (kommt nie doppelt) und meist einen fertigen
Vorschlag, der über die Rechte-Stufen läuft. Wichtige kommen sofort (nicht nachts, max. 3 Pushes
am Tag), der Rest im Briefing. „Passt schon“ blendet einen Hinweis dauerhaft aus.

**Morning Briefing** (`server/src/briefing.ts`) – Schule mit Entfall, heute fällig, Eingeplantes
und Routinen, morgen fällig (mit Stand), was Stella über Nacht erledigt hat, wichtige Nachrichten,
dann die Hinweise als eigene Karten. Zeit: automatisch 45 min vor der ersten Stunde, fest oder aus.
Im Chat jederzeit mit „Briefing“, die Hinweise allein mit „Hab ich was vergessen?“.

## 8. Fahrplan

**Phase 1: dieser Stand** ✅
Chat, Kurznotizen (auch offline), Planer, Erinnerungen, Lernpläne, Push, Kalender-Abo, Gesundheit und SMS über Kurzbefehle, digi4school (Kalibrierung offen), automatische KI-Modellwahl.

**Phase 2: Postfach, Schule+** ✅
E-Mail (Gmail, iCloud), Inbox mit Social-Media-Benachrichtigungen, scook, HÜ-Autopilot mit FreeNotes, Fotos im Chat, WebUntis.

**Phase 3: als Nächstes**
- Morgen-Briefing um 6:45: Was heute ansteht, welche HÜ fällig ist, wichtige Mails, Entfall.
- Arbeitsblätter direkt ausfüllen: Foto → FreeNotes legt den Scan als Seite an und schreibt die Antworten in die Lücken (FreeNotes kann das schon lokal).
- Lernplan-Abfrage: Stella fragt dich in der Lernzeit kurz Vokabeln oder Fragen zum Stoff ab.
- Chat-Befehl „nochmal lösen“ / „Lösung zeigen“.

**Phase 4: Leben**
- Gesundheit: Wasser, Schlaf, Bildschirmzeit. Sanfter Schubs bei zu wenig Bewegung.
- Geburtstage, Abos und Fristen, Einkaufsliste.
- Native iOS-App (Expo) mit Widgets, Siri, HealthKit, Share-Sheet.
