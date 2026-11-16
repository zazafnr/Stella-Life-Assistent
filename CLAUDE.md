# Stella – Hinweise für Claude

## Projektgedächtnis zuerst (Tokens sparen)

Zu Stella gibt es einen Obsidian-Vault **Stella-Brain** (Repo `zazafnr/Stella-Brain`, lokal `Documents/Stella/Stella-Brain`,
in der Cloud neben diesem Repo unter `../Stella-Brain`). Der SessionStart-Hook (`scripts/brain-hook.mjs`) holt ihn und zeigt den Einstieg.

1. **Erst im Vault nachsehen**: `00 Start.md` (Karte), Fach-Notizen, `Code-Karte/<Repo>/…` (jede Datei mit Zweck und Symbolen,
   API-Routen, DB-Tabellen, Env-Variablen), `Quellen/` (Kopien der Repo-Doku). Mit Grep im Vault suchen statt das Repo zu durchforsten.
2. Code erst öffnen, wenn du ihn ändern oder ein Detail prüfen musst. Widerspricht eine Notiz dem Code, gilt der Code – Notiz korrigieren.
3. **Am Ende jeder Änderung** den Vault pflegen, wie in `Stella-Brain/CLAUDE.md` beschrieben (Änderungslog + betroffene Notizen, committen, pushen).
   Geht der Push nicht (Cloud): Notiz als `.brain-inbox/YYYY-MM-DD-thema.md` in diesem Repo mitcommitten.

## Kurzregeln des Projekts

- Kern-Änderungen nur in `Stella-Life-Assistent`; Students spiegelt mit `npm run sync:core` (nie in `core/` arbeiten).
- DB-Migrationen nur anhängen. Aktionen über `perform()`/`record()` (Rückgängig). Private Inhalte `private: true`.
- Neue Texte in allen 8 Sprachen über die Kataloge. Keine Gamification. Doku und Commits auf Deutsch.
- Prüfen: Kern `npm run typecheck && npm test`; Students `npm run sync:core -- --check && npx tsc -p server-plugin --noEmit && npx tsc -p web --noEmit && npm test`.
