# Stella für den PC

Electron-Fenster um die Stella-Weboberfläche – mit Symbol in der Taskleiste,
echten Windows-/macOS-Mitteilungen und Start mit dem Computer.

* **Download:** GitHub → Releases → „Stella für Windows“ (`pc-app`), oder der
  Artefakt `Stella-Windows` des letzten Laufs von *PC-App* unter Actions.
* **Server:** Standard ist `https://stella.5-189-157-214.sslip.io`. Ändern über
  das Taskleisten-Symbol → „Server ändern …“ oder mit `STELLA_SERVER=…`.
* Fenster schließen = weiter in der Taskleiste, damit Erinnerungen ankommen.
  Wirklich beenden über das Taskleisten-Symbol.

```bash
npm install
npm start            # gegen den Standard-Server
npm run smoke        # Rauchtest wie in CI
npm run dist:win     # Installer (am besten auf Windows bzw. in CI)
```

Die App rechnet nichts selbst – alles kommt vom Server. Der Renderer läuft mit
`contextIsolation` + `sandbox`; die Web-App sieht nur `window.stellaDesktop`
(`notify`, `setBadge`, `setTitleBarColor`).
