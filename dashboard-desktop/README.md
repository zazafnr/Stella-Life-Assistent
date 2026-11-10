# EVOLSIOR Dashboard für den PC

Eigenes Fenster mit dashboard.evolsior.com – ohne Browser, mit Symbol auf dem Desktop und im Startmenü.

* **Download:** GitHub → Releases → „EVOLSIOR Dashboard für Windows“ (Tag `dashboard-app`).
  Die `.exe` herunterladen und doppelklicken. Windows fragt beim ersten Start einmal nach
  („Weitere Informationen“ → „Trotzdem ausführen“), weil die App nicht signiert ist.
* **Anmeldung** wie im Browser mit dem Owner-Konto von Stella. Die App merkt sich die Anmeldung bis „Sign out“.
* **F5** oder **Strg+R** lädt die Zahlen neu. Nach 15 Minuten Pause lädt die App beim Zurückkommen von selbst neu.
* Links zur Website öffnen sich im normalen Browser.

```bash
npm install
npm start          # gegen dashboard.evolsior.com (anderes Ziel: EVOLSIOR_DASHBOARD_URL=…)
npm run smoke      # Rauchtest wie in CI
npm run dist:win   # Installer (am besten auf Windows bzw. in CI)
```

Die App ist nur ein Fenster um die Seite: Neue Funktionen im Dashboard sind sofort da, ohne neue Version.
