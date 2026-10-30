// Einträge anlegen/ändern inkl. Erinnerungen und Hintergrund-Jobs.

import {
  addDays, buildStudyPlan, DEFAULT_PREFS, nextOccurrence, planReminders, zonedToUtc, todayIn, type Item, type ParsedEntry,
} from '@stella/shared';
import { nextLessonDate } from './untis.ts';
import {
  addReminder, clearOpenReminders, createItem, enqueueJob, getItem, getItemRaw, listItems, type NewItem, updateItem, type User,
} from './db.ts';

const prefsOf = (user: User) => ({
  eveningTime: user.settings.eveningTime ?? DEFAULT_PREFS.eveningTime,
  studyTime: user.settings.studyTime ?? DEFAULT_PREFS.studyTime,
  tone: user.settings.tone,
});

export function scheduleReminders(user: User, item: Item) {
  clearOpenReminders(user.id, item.id);
  if (item.status !== 'open' || item.deleted || item.recurrencePaused) return;
  const today = todayIn(user.timeZone);
  for (const r of planReminders(item, today, prefsOf(user))) {
    const at = zonedToUtc(r.date, r.time, user.timeZone);
    if (at.getTime() > Date.now()) addReminder(user.id, item.id, at, r.message, r.withAttachments);
  }
}

/** alle offenen Erinnerungen neu erzeugen, z. B. nach neuer Abendzeit oder neuem Ton */
export function rescheduleAll(user: User) {
  for (const item of listItems(user.id, { from: todayIn(user.timeZone) })) scheduleReminders(user, item);
}

function findBook(user: User, subject: string | null) {
  if (!subject) return null;
  return user.settings.books?.find((b) => b.subject.toLowerCase() === subject.toLowerCase()) ?? null;
}

export function addItem(user: User, data: NewItem): Item {
  const item = createItem(user.id, data);
  scheduleReminders(user, item);
  // HÜ mit Seitenzahl und hinterlegtem Buch → Seite aus dem E-Book holen (danach ggf. lösen)
  if (item.kind === 'homework' && item.page && findBook(user, item.subject)) {
    enqueueJob(user.id, 'book_page', { itemId: item.id });
  }
  return item;
}

export function addParsedEntry(user: User, e: ParsedEntry): Item {
  // "Latein HÜ" ohne Datum → nächste Lateinstunde laut WebUntis (statt nächster Schultag)
  if (e.dueAssumed && e.subject) {
    const next = nextLessonDate(user.id, e.subject, todayIn(user.timeZone));
    if (next) e = { ...e, due: next };
  }
  return addItem(user, {
    kind: e.kind, subject: e.subject, title: e.title, detail: e.detail || null,
    page: e.page, exercises: e.exercises, book: e.book, due: e.due, time: e.time,
    material: e.kind === 'exam' && e.rest ? e.rest : null,
  });
}

export function changeItem(user: User, id: string, patch: Partial<Item>): Item | null {
  // Dauerauftrag „erledigt“ heißt: dieses Mal erledigt – er rückt zum nächsten Termin vor
  if (patch.status === 'done') {
    const cur = getItem(user.id, id);
    if (cur?.recurrence && !cur.recurrencePaused && !cur.deleted) return advanceRecurring(user, cur);
  }
  const item = updateItem(user.id, id, patch);
  if (item && ('due' in patch || 'time' in patch || 'status' in patch || 'deleted' in patch || 'recurrencePaused' in patch)) scheduleReminders(user, item);
  return item;
}

/** Nach dem Erinnern (oder Abhaken) zum nächsten Termin des Rhythmus weiterrücken – frühestens ab morgen */
export function advanceRecurring(user: User, item: Item): Item | null {
  if (!item.recurrence || item.recurrencePaused || item.deleted) return null;
  const tomorrow = addDays(todayIn(user.timeZone), 1);
  const from = item.due && item.due >= tomorrow ? addDays(item.due, 1) : tomorrow;
  return changeItem(user, item.id, { due: nextOccurrence(item.recurrence, from), status: 'open' });
}

/** Legt Lerneinheiten für einen Test an. `focuses` kann von der KI verfeinert sein. */
export function createStudyPlan(user: User, examId: string, focuses?: string[]): Item[] {
  const exam = getItem(user.id, examId);
  if (!exam?.due) return [];
  const today = todayIn(user.timeZone);
  const plan = buildStudyPlan(exam.due, today, exam.material ?? '');
  return plan.map((s, i) => addItem(user, {
    kind: 'study',
    subject: exam.subject,
    title: `Lernen: ${exam.title}`,
    detail: focuses?.[i] ?? s.focus,
    due: s.date,
    time: prefsOf(user).studyTime,
    parentId: exam.id,
    source: 'plan',
  }));
}

export function bookFor(user: User, subject: string | null) {
  return findBook(user, subject);
}

export function bookForItem(user: User, itemId: string) {
  const raw = getItemRaw(user.id, itemId);
  return raw ? { item: raw, book: findBook(user, raw.subject) } : null;
}
