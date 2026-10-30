// E-Book-Seiten holen (digi4school, scook): Stella meldet sich mit deinen Zugangsdaten an,
// öffnet das Buch zum Fach, springt zur Seite der HÜ und speichert die Buchseite als Bild.
//
// Keiner der Anbieter hat eine offizielle Schnittstelle – Stella steuert einen unsichtbaren
// Browser. Seitensprung klappt über das Seitenfeld im Viewer ("45 / 236"), das beide haben.
// Falls ein Login über Umwege (Microsoft-/Schul-SSO) nicht automatisch geht, kann man in den
// Einstellungen die Cookies aus dem eigenen Browser einfügen.

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { getSecret, setSecret } from './auth.ts';
import { getBrowser } from './browser.ts';
import { addAttachment, addMessage, enqueueJob, getUser, type BookProvider } from './db.ts';
import { saveFile } from './files.ts';
import { bookForItem } from './planner.ts';
import { levelFor, perform } from './actions.ts';

type Page = import('playwright').Page;
type Frame = import('playwright').Frame;
type Cookie = Parameters<import('playwright').BrowserContext['addCookies']>[0][number];

export interface BookCredentials { email?: string; password?: string; cookies?: unknown[] }

export const PROVIDERS: Record<BookProvider, { name: string; shelf: string; bookLink: string }> = {
  digi4school: { name: 'digi4school', shelf: 'https://digi4school.at/ebooks', bookLink: 'a[href*="/ebook/"]' },
  scook: { name: 'scook', shelf: 'https://www.scook.at/', bookLink: 'a[href*="/produkt/"]' },
};

export const secretName = (provider: BookProvider) => `book:${provider}`;

export function getBookCredentials(userId: string, provider: BookProvider): BookCredentials | null {
  // ältere Installationen speicherten digi4school unter "digi4school"
  return getSecret<BookCredentials>(userId, secretName(provider))
    ?? (provider === 'digi4school' ? getSecret<BookCredentials>(userId, 'digi4school') : null);
}

const statePath = (userId: string, provider: BookProvider) => path.join(config.dataDir, `book-${provider}-${userId}.json`);

/** Cookies aus Browser-Erweiterungen ("Cookie-Editor", "EditThisCookie") in Playwright-Form bringen. */
export function normalizeCookies(raw: unknown[]): Cookie[] {
  const sameSite = (v: unknown): Cookie['sameSite'] => {
    const s = String(v ?? '').toLowerCase();
    return s === 'strict' ? 'Strict' : s === 'none' || s === 'no_restriction' ? 'None' : 'Lax';
  };
  return raw.flatMap((c) => {
    const o = c as Record<string, unknown>;
    if (typeof o?.name !== 'string' || typeof o.value !== 'string' || typeof o.domain !== 'string') return [];
    const expires = Number(o.expirationDate ?? o.expires ?? -1);
    return [{
      name: o.name, value: o.value, domain: o.domain, path: typeof o.path === 'string' ? o.path : '/',
      expires: Number.isFinite(expires) && expires > 0 ? Math.floor(expires) : -1,
      httpOnly: !!o.httpOnly, secure: o.secure !== false, sameSite: sameSite(o.sameSite),
    }];
  });
}

const LOGIN_URL_RE = /login|anmeld|signin|sign-in|auth|\/id\.|account/i;

async function visible(page: Page, selector: string) {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function needsLogin(page: Page) {
  return (await visible(page, 'input[type="password"]')) || LOGIN_URL_RE.test(new URL(page.url()).hostname + new URL(page.url()).pathname);
}

async function login(page: Page, creds: BookCredentials, provider: BookProvider) {
  if (!creds.email || !creds.password) {
    throw new Error(`Login bei ${PROVIDERS[provider].name} nötig, aber keine E-Mail/Passwort hinterlegt (oder die Cookies sind abgelaufen).`);
  }
  if (!(await visible(page, 'input[type="password"], input[type="email"]'))) {
    const button = page.getByRole('link', { name: /anmelden|einloggen|login|log in|sign in/i })
      .or(page.getByRole('button', { name: /anmelden|einloggen|login|log in|sign in/i })).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  }
  const userField = page.locator([
    'input[type="email"]', 'input[autocomplete="username"]', 'input[name*="mail" i]', 'input[name*="user" i]',
    'input[id*="mail" i]', 'input[id*="user" i]', 'input[name="login"]',
  ].join(', ')).first();
  await userField.fill(creds.email, { timeout: 15_000 });

  const submit = page.locator('button[type="submit"], input[type="submit"]')
    .or(page.getByRole('button', { name: /anmelden|einloggen|login|weiter|next|continue/i })).first();
  // Zweistufige Logins: erst E-Mail → "Weiter" → dann Passwort
  if (!(await visible(page, 'input[type="password"]'))) {
    await submit.click();
    await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.locator('input[type="password"]').first().fill(creds.password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    submit.click(),
  ]);
  await page.waitForTimeout(2000);
  if (await visible(page, 'input[type="password"]')) {
    throw new Error(`Login bei ${PROVIDERS[provider].name} fehlgeschlagen – stimmen E-Mail und Passwort? ` +
      'Bei Schul-/Microsoft-Login: in den Einstellungen Cookies einfügen.');
  }
}

async function withBook<T>(userId: string, provider: BookProvider, fn: (page: Page, open: (url: string) => Promise<void>) => Promise<T>): Promise<T> {
  const creds = getBookCredentials(userId, provider);
  if (!creds) throw new Error(`Keine ${PROVIDERS[provider].name}-Zugangsdaten hinterlegt (Einstellungen → Schulbücher).`);
  const browser = await getBrowser();
  const file = statePath(userId, provider);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1700 },
    deviceScaleFactor: 2,
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    storageState: existsSync(file) ? file : undefined,
  });
  try {
    if (creds.cookies?.length) await context.addCookies(normalizeCookies(creds.cookies));
    const page = await context.newPage();
    const open = async (url: string) => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
      if (await needsLogin(page)) {
        await login(page, creds, provider);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
      }
    };
    const result = await fn(page, open);
    await context.storageState({ path: file });
    return result;
  } finally {
    await context.close();
  }
}

/** Sucht im Viewer das Seitenfeld ("45" neben "/ 236") und springt zur Zielseite. */
async function jumpViaPageInput(page: Page, target: number): Promise<boolean> {
  for (const frame of page.frames()) {
    const index = await frame.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')] as HTMLInputElement[];
      return inputs.findIndex((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || !/^\s*\d{1,4}\s*$/.test(el.value)) return false;
        const hint = `${el.getAttribute('aria-label') ?? ''} ${el.title} ${el.placeholder} ${el.name} ${el.id}`;
        const around = el.parentElement?.parentElement?.textContent ?? '';
        return /seite|page/i.test(hint) || /\/\s*\d+/.test(around);
      });
    }).catch(() => -1);
    if (index < 0) continue;
    const input = frame.locator('input').nth(index);
    await input.click({ clickCount: 3 });
    await input.fill(String(target));
    await input.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}

/** Das größte sichtbare Bild-/Canvas-/SVG-Element im Viewer = die Buchseite. */
async function screenshotBookPage(page: Page): Promise<Buffer> {
  let best: { frame: Frame; index: number; area: number } | null = null;
  const selector = 'img, canvas, svg, object, embed, [class*="page" i] > img';
  for (const frame of page.frames()) {
    const found = await frame.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)];
      let index = -1;
      let area = 0;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const visibleW = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
        const visibleH = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
        const a = Math.max(0, visibleW) * Math.max(0, visibleH);
        if (a > area) { area = a; index = i; }
      });
      return { index, area };
    }, selector).catch(() => ({ index: -1, area: 0 }));
    if (found.index >= 0 && (!best || found.area > best.area)) best = { frame, index: found.index, area: found.area };
  }
  const viewport = page.viewportSize()!;
  if (best && best.area > viewport.width * viewport.height * 0.15) {
    return best.frame.locator(selector).nth(best.index).screenshot({ type: 'png' });
  }
  return page.screenshot({ type: 'png' });
}

export async function listShelf(userId: string, provider: BookProvider): Promise<{ title: string; url: string }[]> {
  return withBook(userId, provider, async (page, open) => {
    await open(PROVIDERS[provider].shelf);
    const links = await page.locator(PROVIDERS[provider].bookLink).evaluateAll((as) =>
      as.map((a) => ({
        title: ((a.getAttribute('title') || a.textContent) ?? '').replace(/\s+/g, ' ').trim(),
        url: (a as HTMLAnchorElement).href,
      })));
    const seen = new Set<string>();
    return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
  });
}

export async function screenshotPage(userId: string, provider: BookProvider, url: string, target: number, template?: string) {
  return withBook(userId, provider, async (page, open) => {
    if (template) {
      await open(template.replace('{page}', String(target)));
    } else {
      await open(url);
      await page.waitForTimeout(2000);
      if (!(await jumpViaPageInput(page, target))) {
        // Fallback: Seite als URL-Parameter (funktioniert bei vielen digi4school-Büchern)
        const u = new URL(page.url());
        u.searchParams.set('page', String(target));
        await page.goto(u.toString(), { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(2500);
      }
    }
    return screenshotBookPage(page);
  });
}

/** Job: Buchseite zur HÜ holen (und danach ggf. lösen lassen). */
export async function fetchBookPage(userId: string, itemId: string, pageDelta = 0, solveAttempt = 0) {
  const user = getUser(userId);
  const found = user && bookForItem(user, itemId);
  if (!user || !found?.book || !found.item.page) return;
  const { item, book } = found;
  const printed = Number.parseInt(item.page!, 10) + pageDelta;
  const png = await screenshotPage(userId, book.provider, book.url, printed + (book.pageOffset ?? 0), book.pageUrlTemplate);

  const fileId = saveFile(png, 'png');
  const attachment = { id: fileId, kind: 'image' as const, caption: `${item.subject ?? ''} S. ${printed}`.trim() };
  addAttachment(userId, itemId, attachment);

  const level = levelFor(user, 'homework');
  if (level === 'auto' || level === 'notify') {
    enqueueJob(userId, 'solve_homework', { itemId, attempt: solveAttempt });
  } else {
    addMessage(userId, 'assistant', `📸 Hab dir Seite ${printed} für **${item.title}** geholt` +
      `${item.exercises ? ` (Nr. ${item.exercises})` : ''}.`, { attachments: [attachment] });
    // „fragt vorher“: Karte „Darf ich … lösen?“ – nach Ja wird mit dem Foto gelöst
    if (level === 'ask') perform(user, 'homework.solve', { itemId }, { source: 'auto' });
  }
}

export function saveBookCredentials(userId: string, provider: BookProvider, creds: BookCredentials) {
  const existing = getBookCredentials(userId, provider) ?? {};
  setSecret(userId, secretName(provider), { ...existing, ...creds });
  // neue Anmeldung → alte Browser-Sitzung verwerfen, sonst gewinnen abgelaufene Cookies
  if (creds.cookies) rmSync(statePath(userId, provider), { force: true });
}

/** Login-Domains der Anbieter – nur deren Cookies werden aus einem Login-Fenster übernommen */
export const LOGIN_PAGES: Record<BookProvider, { url: string; domains: RegExp }> = {
  digi4school: { url: 'https://digi4school.at/ebooks', domains: /(^|\.)digi4school\.at$/i },
  scook: { url: 'https://www.scook.at/', domains: /(^|\.)(scook\.at|cornelsen\.de|veritas\.at)$/i },
};
