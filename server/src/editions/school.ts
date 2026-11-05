// Eingebautes Schul-Plugin (Edition `students`): WebUntis, Schulbücher, HÜ-Autopilot, Handschrift und FreeNotes.
// Die Module liegen vorerst noch in diesem Repo; mit Paket 3 ziehen sie samt diesem Plugin nach Stella-for-Students
// (server-plugin/) um. Der Kern kennt sie nur noch über die Registry (registry.ts).
//
// Wird nicht geladen, wenn STELLA_EDITION_STUDENTS=off gesetzt ist – dann läuft das normale Stella ohne Schulfunktionen.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addDays, todayIn } from '@stella/shared';
import { deleteSecret, hasSecret, HttpError, requireOwner, setSecret } from '../auth.ts';
import { announceFreenotes, ackNotesEntry, notesInbox, usesFreeNotes } from '../notes.ts';
import { addMessage, db, enqueueJob, getItem, getUser, notifyOnce, now, type BookProvider } from '../db.ts';
import { fetchBookPage, getBookCredentials, listShelf, LOGIN_PAGES, normalizeCookies, PROVIDERS, saveBookCredentials, screenshotPage, secretName } from '../books.ts';
import { deleteUserFont, renderHandwriting, saveUserFont, userFontPath } from '../handwriting.ts';
import { lessonsFor, nextLessonDate, syncUntis, testUntis, type UntisCredentials } from '../untis.ts';
import { solveHomework } from '../homework.ts';
import { saveFile } from '../files.ts';
import { levelFor } from '../actions.ts';
import { bookFor } from '../planner.ts';
import { hasFeature, isSchool } from '../profile.ts';
import { formatDateDe } from '@stella/shared';
import { toMin, type Busy } from '../context.ts';
import { tr, userTerms, voiceOf } from '../locale.ts';
import type { Item } from '@stella/shared';
import type { FoundHintLike, EditionPlugin, Lesson } from './registry.ts';

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

function registerSchoolRoutes(api: FastifyInstance) {
  // ----- Schulbücher (digi4school, scook) -----
  const provider = (p: string): BookProvider => {
    if (!(p in PROVIDERS)) throw new HttpError(404, 'Unbekannter Anbieter');
    return p as BookProvider;
  };
  api.put('/api/integrations/books/:provider', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    const b = req.body as Record<string, unknown>;
    const p = provider(req.params.provider);
    let cookies: unknown[] | undefined;
    if (b.cookies) {
      try { cookies = typeof b.cookies === 'string' ? JSON.parse(b.cookies) : b.cookies as unknown[]; } catch { throw new HttpError(400, 'Cookies sind kein gültiges JSON'); }
      if (!Array.isArray(cookies) || !normalizeCookies(cookies).length) throw new HttpError(400, 'Keine gültigen Cookies gefunden');
    }
    if (!cookies && (!str(b.email) || !str(b.password))) throw new HttpError(400, 'E-Mail und Passwort (oder Cookies) nötig');
    saveBookCredentials(req.user.id, p, {
      ...(str(b.email) ? { email: str(b.email, 200), password: str(b.password, 200) } : {}),
      ...(cookies ? { cookies } : {}),
    });
    // aus dem Login-Fenster der Apps: gleich prüfen, ob die Anmeldung trägt, und das Regal mitschicken
    if (b.verify === true) {
      try {
        return { ok: true, shelf: await listShelf(req.user.id, p) };
      } catch (err) {
        throw new HttpError(400, `Anmeldung nicht erkannt – bitte im Fenster fertig einloggen und dann erst schließen. (${(err as Error).message})`);
      }
    }
    return { ok: true };
  });
  api.delete('/api/integrations/books/:provider', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    const p = provider(req.params.provider);
    deleteSecret(req.user.id, secretName(p));
    if (p === 'digi4school') deleteSecret(req.user.id, 'digi4school');
    return { ok: true };
  });
  // Wo die Apps das Login-Fenster öffnen und welche Cookies sie übernehmen
  api.get('/api/integrations/books/login-pages', async () =>
    Object.fromEntries(Object.entries(LOGIN_PAGES).map(([p, v]) => [p, { url: v.url, domains: v.domains.source }])));
  api.get('/api/integrations/books/:provider/shelf', async (req: FastifyRequest<{ Params: { provider: string } }>) => {
    try { return await listShelf(req.user.id, provider(req.params.provider)); } catch (err) { throw new HttpError(502, (err as Error).message); }
  });
  // Probe-Screenshot zum Kalibrieren (Seitenversatz)
  api.post('/api/integrations/books/preview', async (req) => {
    const b = req.body as Record<string, unknown>;
    const book = req.user.settings.books?.find((x) => x.subject === str(b.subject));
    if (!book) throw new HttpError(404, 'Kein Buch für dieses Fach');
    const printed = Number(b.page) || 1;
    try {
      const png = await screenshotPage(req.user.id, book.provider, book.url, printed + (book.pageOffset ?? 0), book.pageUrlTemplate);
      const id = saveFile(png, 'png');
      db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)').run(req.user.id, `file:${id}`, now());
      return { fileId: id };
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  });

  // ----- WebUntis -----
  api.put('/api/integrations/webuntis', async (req) => {
    const b = req.body as Record<string, unknown>;
    const creds: UntisCredentials = str(b.qr)
      ? { qr: str(b.qr, 1000) }
      : { server: str(b.server, 200), school: str(b.school, 200), username: str(b.username, 200), password: str(b.password, 200) };
    try { await testUntis(creds); } catch (err) { throw new HttpError(400, `WebUntis-Login fehlgeschlagen: ${(err as Error).message}`); }
    setSecret(req.user.id, 'webuntis', creds);
    void syncUntis(req.user.id).catch((err) => api.log.warn(err));
    return { ok: true };
  });
  api.delete('/api/integrations/webuntis', async (req) => {
    deleteSecret(req.user.id, 'webuntis');
    db.prepare('DELETE FROM lessons WHERE user_id = ?').run(req.user.id);
    return { ok: true };
  });
  api.post('/api/integrations/webuntis/sync', async (req) => {
    try { await syncUntis(req.user.id); } catch (err) { throw new HttpError(502, (err as Error).message); }
    return { ok: true };
  });
  api.get('/api/timetable', async (req) => {
    const q = req.query as Record<string, string>;
    const today = todayIn(req.user.timeZone);
    return lessonsFor(req.user.id, q.from || today, q.to || addDays(today, 6));
  });

  // ----- FreeNotes (iPad-Heft): gelöste HÜs abholen -----
  api.get('/api/notes/inbox', async (req) => notesInbox(req.user.id));
  api.post('/api/notes/inbox/:id/ack', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!ackNotesEntry(req.user.id, req.params.id, str(b.notebook, 200) || null, Number.isFinite(Number(b.page)) ? Number(b.page) : null)) {
      throw new HttpError(404, 'Nicht gefunden');
    }
    return { ok: true };
  });

  // ----- Handschrift -----
  api.put('/api/handwriting/font', async (req) => {
    const ext = str(req.headers['x-filename']).split('.').pop()?.toLowerCase() ?? '';
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Keine Datei');
    try { saveUserFont(req.user.id, req.body, ext); } catch (err) { throw new HttpError(400, (err as Error).message); }
    return { ok: true };
  });
  api.delete('/api/handwriting/font', async (req) => {
    deleteUserFont(req.user.id);
    return { ok: true };
  });
  api.post('/api/handwriting/preview', async (req) => {
    const png = await renderHandwriting(req.user.id, {
      date: 'Fr, 30.10.',
      text: '__S. 45 Nr. 16__\n\n1) Oui, elle y va en avion.\n2) Non, je ne m\'y intéresse pas.\n3) 3 · 4 + 2 = ==14==\nÄpfel, Übung, Größe',
    });
    const id = saveFile(png, 'png');
    db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)').run(req.user.id, `file:${id}`, now());
    return { fileId: id };
  });

  // FreeNotes ist da: alle auf der Warteliste benachrichtigen
  api.post('/api/admin/freenotes/announce', { preHandler: requireOwner }, async () => {
    try { return { ok: true, ...(await announceFreenotes()) }; } catch (err) { throw new HttpError(400, (err as Error).message); }
  });
}

// ---------- Hinweise (Entfall mit offener HÜ, HÜ ohne Quelle) ----------

function schoolHints(user: import('../db.ts').User, lb: import('../context.ts').Lagebild): FoundHintLike[] {
  const out: FoundHintLike[] = [];
  const v = voiceOf(user);
  const tomorrow = addDays(lb.today, 1);
  const tomorrowDay = lb.days.find((d) => d.date === tomorrow);
  if (!tomorrowDay) return out;
  const dueTomorrow = tomorrowDay.items.filter((i) => i.status === 'open');

  // Stunde entfällt, die HÜ dafür ist aber noch für morgen eingetragen
  const cancelled = !isSchool(user) ? [] : tomorrowDay.lessons.filter((l) => l.status === 'cancelled' && l.subject);
  for (const l of cancelled) {
    const stillThere = tomorrowDay.lessons.some((x) => x.subject === l.subject && x.status !== 'cancelled');
    if (stillThere) continue;
    for (const hw of dueTomorrow.filter((i) => i.kind === 'homework' && i.subject === l.subject)) {
      const next = nextLessonDate(user.id, l.subject!, tomorrow);
      if (!next) continue;
      out.push({
        key: `cancelled:${hw.id}:${tomorrow}`, priority: 'high', itemId: hw.id,
        text: v.hintCancelled(l.subject!, hw.title, formatDateDe(next, lb.today)),
        action: { type: 'item.update', params: { id: hw.id, patch: { due: next } }, label: `Auf ${formatDateDe(next, lb.today)}` },
      });
    }
  }

  // HÜ für morgen, aber weder Foto noch Buchseite – Autopilot kann nichts tun
  const afternoon = toMin(lb.now) >= toMin('14:00');
  if (afternoon && isSchool(user) && levelFor(user, 'homework') !== 'never') {
    for (const hw of dueTomorrow.filter((i) => i.kind === 'homework')) {
      if (hw.attachments.length || (hw.page && bookFor(user, hw.subject))) continue;
      out.push({ key: `no_source:${hw.id}`, priority: 'high', itemId: hw.id, text: v.hintNoSource(hw.title), open: { tab: 'chat', label: 'Foto schicken' } });
    }
  }
  return out;
}

// ---------- Werkzeuge für den Chat-Agenten ----------

const TOOLS: NonNullable<EditionPlugin['tools']> = [
  {
    def: {
      type: 'function',
      function: {
        name: 'solve_homework',
        description: 'HÜ automatisch lösen und in Handschrift ins Heft schreiben (braucht Buchseite oder Foto der Aufgabe). again=true löst eine schon gelöste HÜ neu (z. B. "nochmal lösen", "Lösung ist falsch").',
        parameters: { type: 'object', properties: { entry_id: { type: 'string' }, again: { type: 'boolean' } }, required: ['entry_id'] },
      },
    },
    run: (ctx, args) => {
      if (!getItem(ctx.user.id, String(args.entry_id))) return { error: 'nicht gefunden' };
      return ctx.act('homework.solve', { itemId: String(args.entry_id), again: !!args.again });
    },
  },
  {
    def: {
      type: 'function',
      function: { name: 'timetable', description: 'Stundenplan aus WebUntis (inkl. Entfall).', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    },
    run: (ctx, args) => lessonsFor(ctx.user.id, args.from ?? ctx.today, args.to ?? addDays(ctx.today, 1)),
  },
];

const hasNoTimetable = (userId: string) => !(db.prepare('SELECT 1 FROM lessons WHERE user_id = ? LIMIT 1').get(userId));

// ---------- Das Plugin ----------

export const schoolPlugin: EditionPlugin = {
  id: 'students',
  edition: 'students',
  routes: registerSchoolRoutes,
  tools: TOOLS,

  prompt: (user) => {
    if (!isSchool(user)) return {};
    const terms = userTerms(user);
    return {
      rules: [`School words in ${user.name}'s country: homework = "${terms.homework}", big written exam = "${terms.exam}", short test = "${terms.quiz}". Use these words.`],
      capabilities: ['You do the homework (solve_homework): Stella solves it and writes it into the notebook in handwriting.'],
    };
  },

  context: {
    lessons: (userId, from, to) => lessonsFor(userId, from, to),
    // Schule ohne WebUntis: Vormittag an Schultagen als belegt annehmen
    estimatedBusy: (user, _date, weekend, lessons): Busy | null =>
      !weekend && !lessons.length && isSchool(user) && hasNoTimetable(user.id) ? { start: '07:30', end: '13:30', label: 'Schule (geschätzt)' } : null,
    daySummary: (lessons: Lesson[]) => lessons.length
      ? `Schule ${lessons[0]!.start}–${lessons.at(-1)!.end}${lessons.some((l) => l.status === 'cancelled') ? `, entfällt: ${lessons.filter((l) => l.status === 'cancelled').map((l) => `${l.subject ?? l.code} ${l.start}`).join(', ')}` : ''}`
      : 'keine Stunden bekannt',
    nextLessonDate,
    bookProviderName: (provider) => PROVIDERS[provider as BookProvider]?.name ?? null,
  },

  hints: schoolHints,

  briefing: {
    sections: (user, lb) => {
      const lessons = lb.days[0]!.lessons;
      if (!lessons.length) return [];
      const held = lessons.filter((l) => l.status !== 'cancelled');
      const lines = held.length ? [`${held[0]!.start}–${held.at(-1)!.end} · ${tr(user, 'briefing.lessons', { count: held.length })}`] : [tr(user, 'briefing.allCancelled')];
      for (const l of lessons.filter((x) => x.status === 'cancelled')) lines.push(tr(user, 'briefing.cancelled', { subject: String(l.subject ?? l.code), start: l.start }));
      for (const l of lessons.filter((x) => x.status === 'irregular' && x.info)) lines.push(`${l.subject ?? l.code}: ${l.info}`);
      return [{ id: 'school', title: tr(user, 'briefing.section.school'), lines }];
    },
    done: (user, since) => {
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND kind = 'homework' AND status = 'done'
        AND updated_at > ? AND attachments LIKE '%Lösung%'`).get(user.id, since) as { n: number }).n;
      return n ? [tr(user, 'briefing.solved', { count: n })] : [];
    },
  },

  stellaPlan: (user) => (isSchool(user) && hasFeature(user, 'homework') ? [{ key: 'perm:homework', title: 'HÜ-Autopilot', when: 'sobald ein Foto oder Buch da ist' }] : []),

  quickActions: () => [
    { id: 'photo', icon: 'camera', symbol: 'camera.fill', kind: 'camera', needs: 'homework', after: 'briefing' },
    { id: 'homework', icon: 'book', symbol: 'book.fill', kind: 'text', hasText: true, needs: 'homework', after: 'photo' },
  ],

  scheduler: {
    jobs: {
      book_page: (userId, p) => fetchBookPage(userId, p.itemId, p.pageDelta ?? 0, p.thenSolveAttempt ?? 0),
      digi4school_page: (userId, p) => fetchBookPage(userId, p.itemId),
      solve_homework: (userId, p) => solveHomework(userId, p.itemId, p.attempt ?? 0),
    },
    periodic: async (userId, every) => {
      if (!hasSecret(userId, 'webuntis')) return;
      await every(`untis:${userId}`, 2 * 3600_000, () => syncUntis(userId)).catch((err) => {
        console.warn('WebUntis:', err.message);
        const user = getUser(userId);
        if (user && notifyOnce(userId, `untis-error-${todayIn(user.timeZone)}`)) {
          addMessage(userId, 'assistant', `⚠️ WebUntis-Abgleich klappt gerade nicht: ${err.message}`);
        }
      });
    },
  },

  settings: (user) => [
    { id: 'books', titleKey: 'settings.books', connected: Object.keys(PROVIDERS).some((p) => !!getBookCredentials(user.id, p as BookProvider)), actions: [{ id: 'save', labelKey: 'settings.books', method: 'PUT', path: '/api/integrations/books/:provider' }] },
    { id: 'webuntis', titleKey: 'settings.untisSub', connected: hasSecret(user.id, 'webuntis'), actions: [{ id: 'save', labelKey: 'settings.untisSub', method: 'PUT', path: '/api/integrations/webuntis' }, { id: 'sync', labelKey: 'settings.untisSub', method: 'POST', path: '/api/integrations/webuntis/sync' }] },
    { id: 'freenotes', titleKey: 'settings.notesTitle', connected: usesFreeNotes(user.id), actions: [{ id: 'inbox', labelKey: 'settings.notesSub', method: 'GET', path: '/api/notes/inbox' }] },
  ],

  onboarding: [{ id: 'freenotes', after: 'situation', titleKey: 'onboarding.freenotes.title' }],

  integrations: (user) => ({
    books: Object.fromEntries((Object.keys(PROVIDERS) as BookProvider[]).map((p) => {
      const c = getBookCredentials(user.id, p);
      return [p, { connected: !!c, cookies: !!c?.cookies?.length, email: c?.email ?? null }];
    })),
    webuntis: hasSecret(user.id, 'webuntis'),
    handwritingFont: !!userFontPath(user.id),
    freeNotes: usesFreeNotes(user.id),
  }),

  onItemCreated: (user, item: Item) => {
    // HÜ mit Seitenzahl und hinterlegtem Buch → Seite aus dem E-Book holen (danach ggf. lösen)
    if (item.kind === 'homework' && item.page && bookFor(user, item.subject)) enqueueJob(user.id, 'book_page', { itemId: item.id });
  },
};
