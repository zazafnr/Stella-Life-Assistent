// digi4school: Stella meldet sich mit deinen Zugangsdaten an, öffnet das Buch zum Fach
// und macht einen Screenshot der Seite aus der HÜ.
//
// ⚠️ Noch nicht mit einem echten Konto getestet. digi4school hat keine offizielle API – Stella
// steuert einen unsichtbaren Browser (Playwright). Selektoren/Seiten-URLs musst du evtl. einmal
// kalibrieren (Einstellungen → digi4school → "pageOffset" bzw. "pageUrlTemplate").

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { getSecret } from './auth.ts';
import { addAttachment, addMessage, getUser, newId } from './db.ts';
import { bookForItem } from './planner.ts';

const HOME = 'https://digi4school.at/';
const SHELF = 'https://digi4school.at/ebooks';

type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

async function launch(): Promise<Browser> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('Playwright ist nicht installiert (npm i playwright && npx playwright install chromium).');
  }
  return pw.chromium.launch({ headless: true });
}

const statePath = (userId: string) => path.join(config.dataDir, `digi4school-${userId}.json`);

async function withSession<T>(userId: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const creds = getSecret<{ email: string; password: string }>(userId, 'digi4school');
  if (!creds) throw new Error('Keine digi4school-Zugangsdaten hinterlegt (Einstellungen → digi4school).');
  const browser = await launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1600 },
      deviceScaleFactor: 2,
      locale: 'de-AT',
      storageState: existsSync(statePath(userId)) ? statePath(userId) : undefined,
    });
    const page = await context.newPage();
    await ensureLoggedIn(page, creds);
    const result = await fn(page);
    await context.storageState({ path: statePath(userId) });
    return result;
  } finally {
    await browser.close();
  }
}

async function ensureLoggedIn(page: Page, creds: { email: string; password: string }) {
  await page.goto(SHELF, { waitUntil: 'domcontentloaded' });
  const passwordField = page.locator('input[type="password"]').first();
  if (!(await passwordField.isVisible().catch(() => false))) {
    // evtl. liegt das Formular nur auf der Startseite
    if (page.url().includes('/ebooks')) return;
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  }
  await page.locator('input[type="email"], input[name="email"], input[name="username"]').first().fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.locator('button[type="submit"], input[type="submit"]').first().click(),
  ]);
  await page.goto(SHELF, { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new Error('Login bei digi4school fehlgeschlagen – stimmen E-Mail und Passwort?');
  }
}

/** Liefert alle Bücher im Bücherregal – zum Zuordnen Fach → Buch in den Einstellungen. */
export async function listDigi4SchoolBooks(userId: string): Promise<{ title: string; url: string }[]> {
  return withSession(userId, async (page) => {
    const links = await page.locator('a[href*="/ebook/"]').evaluateAll((as) =>
      as.map((a) => ({ title: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), url: (a as HTMLAnchorElement).href })));
    const seen = new Set<string>();
    return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
  });
}

export async function fetchDigi4SchoolPage(userId: string, itemId: string) {
  const user = getUser(userId);
  const found = user && bookForItem(user, itemId);
  if (!found?.book || !found.item.page) return;
  const { item, book } = found;
  const firstPage = Number.parseInt(item.page!, 10);
  const target = firstPage + (book.pageOffset ?? 0);

  const png = await withSession(userId, async (page) => {
    await page.goto(book.url, { waitUntil: 'networkidle' });
    // Die Buch-URL leitet oft über ein Formular auf den eigentlichen Viewer weiter
    await page.waitForTimeout(1500);
    const url = book.pageUrlTemplate
      ? book.pageUrlTemplate.replace('{page}', String(target))
      : (() => { const u = new URL(page.url()); u.searchParams.set('page', String(target)); return u.toString(); })();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    return page.screenshot({ type: 'png' });
  });

  const fileId = newId();
  writeFileSync(path.join(config.dataDir, 'files', `${fileId}.png`), png);
  const attachment = { id: fileId, kind: 'image' as const, caption: `${item.subject ?? ''} S. ${item.page}`.trim() };
  addAttachment(userId, itemId, attachment);
  addMessage(userId, 'assistant', `📸 Hab dir Seite ${item.page} für **${item.title}** aus digi4school geholt` +
    `${item.exercises ? ` (Nr. ${item.exercises})` : ''}.`, { attachments: [attachment] });
}
