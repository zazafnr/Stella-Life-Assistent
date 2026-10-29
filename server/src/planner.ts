// Einträge anlegen/ändern inkl. Erinnerungen und Hintergrund-Jobs.

import {
  buildStudyPlan, DEFAULT_PREFS, planReminders, zonedToUtc, todayIn, type Item, type ParsedEntry,
} from '@stella/shared';
import {
  addReminder, clearOpenReminders, createItem, enqueueJob, getItem, getItemRaw, type NewItem, updateItem, type User,
} from './db.ts';

const prefsOf = (user: User) => ({
  eveningTime: user.settings.eveningTime ?? DEFAULT_PREFS.eveningTime,
  studyTime: user.settings.studyTime ?? DEFAULT_PREFS.studyTime,
});

export function scheduleReminders(user: User, item: Item) {
  clearOpenReminders(user.id, item.id);
  if (item.status !== 'open' || item.deleted) return;
  const today = todayIn(user.timeZone);
  for (const r of planReminders(item, today, prefsOf(user))) {
    const at = zonedToUtc(r.date, r.time, user.timeZone);
    if (at.getTime() > Date.now()) addReminder(user.id, item.id, at, r.message, r.withAttachments);
  }
}

function findBook(user: User, subject: string | null) {
  if (!subject) return null;
  return user.settings.digi4schoolBooks?.find((b) => b.subject.toLowerCase() === subject.toLowerCase()) ?? null;
}

export function addItem(user: User, data: NewItem): Item {
  const item = createItem(user.id, data);
  scheduleReminders(user, item);
  // HÜ mit Seitenzahl und hinterlegtem Buch → Seite von digi4school holen
  if (item.kind === 'homework' && item.page && findBook(user, item.subject)) {
    enqueueJob(user.id, 'digi4school_page', { itemId: item.id });
  }
  return item;
}

export function addParsedEntry(user: User, e: ParsedEntry): Item {
  return addItem(user, {
    kind: e.kind, subject: e.subject, title: e.title, detail: e.detail || null,
    page: e.page, exercises: e.exercises, book: e.book, due: e.due, time: e.time,
    material: e.kind === 'exam' && e.rest ? e.rest : null,
  });
}

export function changeItem(user: User, id: string, patch: Partial<Item>): Item | null {
  const item = updateItem(user.id, id, patch);
  if (item && ('due' in patch || 'time' in patch || 'status' in patch || 'deleted' in patch)) scheduleReminders(user, item);
  return item;
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

export function bookForItem(user: User, itemId: string) {
  const raw = getItemRaw(user.id, itemId);
  return raw ? { item: raw, book: findBook(user, raw.subject) } : null;
}
