// Für Tests: das Edition-Plugin laden (nach dem Setzen von STELLA_DATA_DIR). Ohne STELLA_EDITION_STUDENTS und ohne Klon in
// editions/students läuft der Kern ohne Plugin; die Schul-Tests liegen im Students-Repo.
export async function loadPluginForTests() {
  const { loadEditions } = await import('../editions/load.ts');
  return loadEditions(undefined);
}
