# Mit Stella per E-Mail schreiben (stella@evolsior.com)

Kund:innen schreiben von einer verknüpften Adresse an `stella@evolsior.com`. Stella behandelt die Mail wie eine
Chat-Nachricht und antwortet im selben Verlauf: kurz, wenn etwas erledigt wurde, ausführlich bei Fragen.

```
Mail → Cloudflare Email Routing → Email Worker (workers/stella-mail)
     → POST https://stella.evolsior.com/api/inbound/email  (Header x-inbound-secret)
     → server/src/inbound.ts  → handleChat → Antwort über Resend von stella@
```

## Regeln

- Weitere Adressen verknüpft man mit einem Klick über **„Mit Google bestätigen“** (nur Bereiche `openid email`, kein Zugriff aufs Postfach, braucht keine Google-Prüfung) oder per Code. Wer ein Gmail-Postfach über „Mit Google anmelden“ verbindet, hat diese Adresse automatisch bestätigt. Der Google-Knopf erscheint erst, wenn der Server einen Google-OAuth-Zugang hat (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, siehe `docs/google-oauth.md`; für „nur Adresse“ reicht der Zustimmungsbildschirm mit `openid` und `email`).
- Antwort nur an **bestätigte Adressen** eines Kontos (Konto-Adresse oder unter Einstellungen → „Mail an Stella“ per Code bestätigt, höchstens 5 zusätzliche).
- Unbekannter Absender: ein kurzer zweisprachiger Hinweis („Konto anlegen und Adresse verknüpfen“), höchstens einmal pro Absender und Tag, insgesamt höchstens 200 am Tag.
- Keine Antwort auf automatische Mails (`Auto-Submitted`, `Precedence: bulk/list`, `List-Id`, noreply-/mailer-daemon-Absender) – keine Schleifen.
- Fehlgeschlagene Echtheitsprüfung (`Authentication-Results`: DMARC fail oder SPF und DKIM fail) wird abgelehnt. Fehlt die Angabe, gilt die Mail als „unbekannt“ und wird angenommen.
  **Bekannte Grenze:** Wer die Absenderadresse fälscht und deren Domain kein DMARC hat, kann Stella eine Aufgabe schicken. Die Antwort geht aber immer an die echte Adresse des Kontos, nicht an den Fälscher.
- Pro Absender höchstens 20 Mails pro Stunde, doppelte Mails (gleiche Message-ID) zählen einmal.
- Nur Text. HTML und Anhänge werden nicht gelesen, Zitate und Signaturen entfernt, höchstens 4000 Zeichen.
- Protokoll (`mail_log`, `inbound_mail`): nur Art, Zeit, Ergebnis und Domain, nie Inhalt oder volle Adresse. Das Firmen-Dashboard liest daraus.

## Einrichtung (einmalig)

1. **Server deployen** (Migration 15 läuft automatisch).
2. In Stella als Owner: Einstellungen → Server → **Mail an Stella → Schlüssel erzeugen**. Den angezeigten Schlüssel kopieren (er wird nur einmal gezeigt).
3. **Cloudflare → Workers & Pages → Create → Import a repository** → `Stella-Life-Assistent`, Project name `stella-mail`, **Root directory** `workers/stella-mail`, Deploy command `npx wrangler deploy`.
4. Worker `stella-mail` → Settings → **Variables and Secrets** → Secret `INBOUND_SECRET` = der Schlüssel aus Schritt 2 → Deploy.
5. **Cloudflare → evolsior.com → Email → Email Routing → Routing rules**: Custom address `stella` → Action **Send to a Worker** → `stella-mail`.
6. Resend (SMTP) muss in Stella eingetragen sein, sonst kann Stella nicht antworten.
7. Test: Adresse unter „Mail an Stella“ verknüpfen, dann von dort „Erinnere mich morgen um 9 an den Zahnarzt“ an stella@ schreiben.

Schlüssel erneuern: in Stella neuen erzeugen und im Worker ersetzen. Der alte gilt sofort nicht mehr.
