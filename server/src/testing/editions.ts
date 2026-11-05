// Für Tests: das eingebaute Schul-Plugin laden (nach dem Setzen von STELLA_DATA_DIR). Bis zum Umzug in Paket 3 braucht
// jeder Test, der Schul-Verhalten prüft, diese eine Zeile.
export async function loadSchoolForTests() {
  const { loadEditions } = await import('../editions/load.ts');
  return loadEditions(undefined);
}
