# „Mit Google anmelden“ für Gmail einrichten

Damit Gmail ohne App-Passwort geht, braucht dein Stella-Server einmalig einen eigenen
OAuth-Zugang bei Google. Kostet nichts und dauert etwa 5 Minuten. Danach tippst du in
Stella nur noch auf **„Mit Google anmelden“**.

## 1. Projekt anlegen

1. [console.cloud.google.com](https://console.cloud.google.com/) öffnen und mit deinem Google-Konto anmelden.
2. Oben auf die Projektauswahl → **Neues Projekt** → Name `Stella` → **Erstellen**.

## 2. Gmail-API einschalten

[Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) → **Aktivieren**.
(Stella liest per IMAP, Google verlangt die Freischaltung trotzdem.)

## 3. Zustimmungsbildschirm

**APIs & Dienste → OAuth-Zustimmungsbildschirm** (heißt manchmal „Google Auth Platform“):

* App-Name `Stella`, deine E-Mail als Support- und Kontaktadresse.
* Zielgruppe: **Extern**.
* **Datenzugriff → Bereiche hinzufügen:** `https://mail.google.com/` (manuell einfügen), dazu `openid` und `email`.
* **Zielgruppe → App veröffentlichen** („In Produktion“).

> Wichtig: Bleibt die App im Status „Testen“, verfallen Googles Freigaben nach 7 Tagen und
> Stella verliert den Zugang zu deinem Postfach. Veröffentlichen heißt nicht, dass jemand
> sie findet – nur du kennst die Adresse. Google zeigt beim Anmelden „Diese App wurde nicht
> überprüft“: **Erweitert → Weiter zu Stella**. Das ist deine eigene App.

## 4. OAuth-Client erstellen

**APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:

* Anwendungstyp: **Webanwendung**, Name `Stella-Server`.
* **Autorisierte Weiterleitungs-URIs:**
  `https://stella.5-189-157-214.sslip.io/api/oauth/google/callback`
  (bei eigener Domain entsprechend `https://<deine-domain>/api/oauth/google/callback`)
* **Erstellen** → Client-ID und Clientschlüssel kopieren.

## 5. In Stella eintragen

Auf dem VPS in `/etc/stella/stella.env`:

```
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
```

Dann `systemctl restart stella`. In den Einstellungen → E-Mail erscheint jetzt
**„Mit Google anmelden“**. Ein schon verbundenes Gmail-Postfach mit App-Passwort lässt
sich dort mit **„Auf Google umstellen“** übernehmen.

## Was Stella damit darf

Der Bereich `https://mail.google.com/` ist voller IMAP-Zugriff – genau das, was ein
App-Passwort auch erlaubt (lesen, in den Papierkorb verschieben, wiederherstellen). Stella
speichert nur das Refresh-Token, verschlüsselt mit `STELLA_SECRET`. Entziehen kannst du den
Zugriff jederzeit unter [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Warum nicht auch iCloud, digi4school, scook?

* **iCloud** bietet fremden Apps keine Anmeldung für Mail an – dort bleibt es beim
  App-spezifischen Passwort. Stella führt Schritt für Schritt hin.
* **digi4school und scook** haben keine offizielle Schnittstelle. In der PC-App und der
  iOS-App meldest du dich deshalb auf der **echten Anbieter-Seite** an (auch mit Schul- oder
  Microsoft-Login); Stella übernimmt nur die Sitzung, dein Passwort sieht sie nie.
* **WebUntis**: QR-Code aus der Untis-App scannen (iOS-App) – kein Passwort nötig.
