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

## 5. digi4school kalibrieren

digi4school hat keine offizielle Schnittstelle. Stella steuert deshalb einen unsichtbaren Browser (Playwright). Ohne echtes Konto konnte ich das nicht testen. So richtest du es ein:
1. Einstellungen → digi4school → Zugangsdaten eintragen → **Bücherregal laden**.
2. Jedem Buch ein Fach zuordnen (genau so geschrieben, wie Stella das Fach nennt: „Latein“, „Mathe“, „Englisch“ …).
3. `Latein HÜ S. 45 Nr. 1 morgen` schreiben und das Bild prüfen. Ist es die falsche Seite, den **Seitenversatz** anpassen. Funktioniert das Blättern gar nicht, schick mir die URL, die im Browser bei geöffneter Seite 45 steht. Dann trage ich eine passende `pageUrlTemplate` ein.

## 6. HÜ-Hilfe und die Notes-App

Geplant ist die Verbindung zu deiner Notes-App (`zazafnr/notes`): Stella legt dort zur HÜ eine Seite mit der Aufgabe an. Dafür brauche ich Zugriff auf das Repo. Füge es dieser Session hinzu oder sag mir, wie die Notes-App Daten speichert.

Bei „KI füllt die HÜ in meiner Handschrift aus“ bin ich ehrlich: Das kann ich bauen, aber es schadet dir selbst. Spätestens bei der Schularbeit fehlt dir dann genau das Üben, das die HÜ eigentlich ist. Mein Vorschlag ist ein **Tutor-Modus** in der Notes-App: Stella zeigt die Aufgabe, gibt Schritt-für-Schritt-Hinweise, prüft deine Lösung und erklärt Fehler. Das geht oft genauso schnell, und du lernst dabei für den Test.

## 7. Fahrplan

**Phase 1: dieser Stand** ✅
Chat, Kurznotizen (auch offline), Planer, Erinnerungen, Lernpläne, Push, Kalender-Abo, Gesundheit und SMS über Kurzbefehle, digi4school (Kalibrierung offen), automatische KI-Modellwahl.

**Phase 2: Postfach**
- 2 E-Mail-Konten über IMAP. Die KI teilt ein in *wichtig* (→ Nachricht an dich), *normal* und *Werbung/Spam* (→ Papierkorb).
- Neuer Bereich **„Inbox“** in der App: E-Mails, SMS und Social-Media-Benachrichtigungen (aus den E-Mails von Instagram/TikTok) gesammelt, nach Personen gruppiert, zum Antippen.
- Morgen-Briefing um 6:45: Was heute ansteht, welche HÜ fällig ist, wichtige Mails.

**Phase 3: Schule+**
- Verbindung zur Notes-App (Tutor-Modus, HÜ-Seiten).
- Foto der Tafel oder des Hefts an Stella schicken → Bildmodell liest die HÜ heraus.
- Stundenplan hinterlegen → „Latein HÜ“ ohne Datum bedeutet automatisch die nächste Lateinstunde statt den nächsten Schultag.
- WebUntis-Anbindung, falls deine Schule es nutzt (Stundenplan, Entfall, Hausübungen).
- Lernplan-Abfrage: Stella fragt dich in der Lernzeit kurz Vokabeln oder Fragen zum Stoff ab.

**Phase 4: Leben**
- Gesundheit: Wasser, Schlaf, Bildschirmzeit. Sanfter Schubs bei zu wenig Bewegung.
- Geburtstage, Abos und Fristen, Einkaufsliste.
- Native iOS-App (Expo) mit Widgets, Siri, HealthKit, Share-Sheet.
