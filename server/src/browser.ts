// Gemeinsamer unsichtbarer Browser (Playwright) für Schulbücher und Handschrift-Bilder.

type Browser = import('playwright').Browser;

let browser: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  browser ??= (async () => {
    let pw: typeof import('playwright');
    try {
      pw = await import('playwright');
    } catch {
      throw new Error('Playwright ist nicht installiert (npm i playwright && npx playwright install chromium).');
    }
    // STELLA_CHROMIUM_PATH: vorhandenes Chromium nutzen statt des von Playwright geladenen
    const b = await pw.chromium.launch({ headless: true, executablePath: process.env.STELLA_CHROMIUM_PATH || undefined });
    b.on('disconnected', () => { browser = null; });
    return b;
  })().catch((err) => { browser = null; throw err; });
  return browser;
}
