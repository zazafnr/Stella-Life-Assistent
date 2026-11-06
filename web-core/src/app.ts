// Welche App ist das? Jede App (Stella, Stella for Students) ruft `configureApp` als Allererstes auf
// (eigene Datei `app-config.ts`, die in main.tsx vor allem anderen importiert wird), damit Speicher-Schlüssel,
// Edition und Name getrennt sind. Standard: das normale Stella.

export interface AppConfig {
  edition: 'life' | 'students';
  /** Vorsilbe aller Schlüssel im lokalen Speicher („stella“ → stella.locale, stella-state-v1 …) */
  storagePrefix: string;
  /** Anzeigename (Titel, Hinweise) */
  name: string;
}

let current: AppConfig = { edition: 'life', storagePrefix: 'stella', name: 'Stella' };

export function configureApp(c: Partial<AppConfig>): void { current = { ...current, ...c }; }
export const appConfig = (): AppConfig => current;
