// Stellas "Gehirn": erst schnelle Regeln (offline-fähig, kostenlos), dann die KI mit Werkzeugen.

import {
  addDays, formatDateDe, interpret, placeKind, nextSchoolDay, parseEntry, splitTopics, STYLE_RULES, timeIn, todayIn, toneInstruction, languageRule, LANGUAGE_NAMES_EN, voice, WEEKDAYS_DE, WEEKDAYS_EN, weekdayOf,
  type Attachment, type ChatMessage, type ChatResponse, type Intent, type Item, type ItemKind, type ItemQuery, type MemoryCategory, type ParsedEntry,
} from '@stella/shared';
import {
  addAttachment, addMessage, chatContext, clearPending, conversationMessages, db, enqueueJob, findMessageByClientId, getConversation,
  getItem, getPending, listItems, notifyOnce, setPending, todayConversation, type User,
} from './db.ts';
import { PROVIDERS } from './books.ts';
import { lessonsFor } from './untis.ts';
import { getAction, lastChatItemId, lastUndoable, levelFor, perform, record, undo, type ActionParams, type ActionType, type Performed } from './actions.ts';
import { buildLagebild, isoWeekday, lagebildPrompt } from './context.ts';
import { offerWeekPlan, planWeek } from './weekplan.ts';
import { briefingText } from './briefing.ts';
import { findHints, markDelivered as markHintDelivered } from './hints.ts';
import { cleanSchedule, findMemory, isCategory, listMemories } from './memory.ts';
import { draftReply } from './mail.ts';
import { maybeTitle } from './conversations.ts';
import { afterWorkTime, describeUser, hasFeature, isSchool } from './profile.ts';
import { matchOpenItems, openItems } from './lists.ts';
import { activeGoals, amountText, describeCadence, extractGoal, extractLog, GOAL_RE, looksLikeGoal, matchGoal, parseLogQuick, progress, weekTarget, type NewGoal } from './goals.ts';
import { resolvePlace } from './places.ts';
import { describeRecurrence, describeRecurrenceEn, nextOccurrence } from '@stella/shared';
import { euro, spendingCard, spendingFacts, spendingPeriod, SPEND_RE } from './finance.ts';
import { complete, LlmUnavailable, llmAvailable, type LlmMessage, type Tier, type ToolDef } from './llm.ts';
import { ERRAND_RE, pickTier, resolveTier } from './router.ts';
import { consumeQuota, nextPlan, paywallHintDue, planAllows, planFor, quotaFor } from './billing.ts';
import { findRestaurants } from './errands/restaurants.ts';
import { bookingOptions } from './errands/booking.ts';
import { errandPlace } from './errands/place.ts';
import { shouldAskLocation } from './location.ts';
import type { PlanId } from '@stella/shared';
import { dayFor, tr, userLocale, userTerms } from './locale.ts';
import { addItem, addParsedEntry, bookFor, changeItem, createStudyPlan } from './planner.ts';
import { voiceOf } from './locale.ts';

interface Turn {
  user: User;
  /** der Chat, in dem diese Unterhaltung stattfindet – nur dessen Verlauf sieht die KI */
  conversationId: string;
  today: string;
  replies: ChatMessage[];
  changed: Map<string, Item>;
  /** Fotos, die mit der Nachricht kamen (z. B. Arbeitsblatt) */
  images: Attachment[];
  /** Karte, die ein Werkzeug vorbereitet hat (Restaurants, Verfügbarkeit); hängt an der nächsten Antwort */
  card?: ChatMessage['card'];
}

const say = (t: Turn, text: string, attachments: ChatMessage['attachments'] = []) => {
  const card = t.card;
  t.card = undefined;
  t.replies.push(addMessage(t.user.id, 'assistant', text, { attachments, ...(card ? { card } : {}) }));
};
/** Antwort mit Aktions-Karte („Rückgängig“) */
const sayA = (t: Turn, text: string, actionId?: string) => t.replies.push(addMessage(t.user.id, 'assistant', text, { actionId }));
/** Nachrichten aus Aktionen (Rückfragen, „✓ erledigt“) direkt in die Chat-Antwort */
const sayAction = (t: Turn) => (text: string, actionId: string) => { t.replies.push(addMessage(t.user.id, 'assistant', text, { actionId })); };
/** Satzende ohne doppelten Punkt nach "Freitag, 30.10." */
const dot = (s: string) => (s.endsWith('.') ? s : `${s}.`);
const touched = (t: Turn, ...items: (Item | null)[]) => items.forEach((i) => i && t.changed.set(i.id, i));
const v = (t: Turn) => voiceOf(t.user);
/** Text aus dem Sprachkatalog in der Sprache der Nutzerin; `day` formatiert ein Datum */
const T = (t: Turn, key: string, vars?: Record<string, string | number>) => tr(t.user, key, { homework: userTerms(t.user).homework, ...vars });
const day = (t: Turn, ymd: string, rel = true) => dayFor(t.user, ymd, rel ? t.today : undefined);

/** `conversationId`: in welchem Chat geschrieben wird (alter Chat fortsetzen); ohne Angabe der neueste von heute. */
export async function handleChat(user: User, text: string, clientId: string | null, imageIds: string[] = [], conversationId: string | null = null,
  extra: { attachments?: Attachment[]; detailed?: boolean; via?: 'telegram' } = {}): Promise<ChatResponse> {
  if (clientId && findMessageByClientId(user.id, clientId)) return { messages: [], items: [] }; // schon verarbeitet
  const convId = (conversationId && getConversation(user.id, conversationId)?.id) || todayConversation(user.id)!;
  // alles, was während dieser Anfrage geschrieben wird (auch in Hilfsfunktionen), landet in diesem Chat
  const res = await chatContext.run({ userId: user.id, conversationId: convId, detailed: extra.detailed, via: extra.via }, () => handleChatIn(user, text, clientId, imageIds, convId, extra.attachments ?? []));
  void maybeTitle(user.id, convId).catch(() => {});
  return { ...res, conversationId: convId };
}

async function handleChatIn(user: User, text: string, clientId: string | null, imageIds: string[], convId: string, extra: Attachment[]): Promise<ChatResponse> {
  const images: Attachment[] = imageIds.map((id) => ({ id, kind: 'image', caption: 'Foto' }));
  // `images` sind Fotos zum Lösen; `extra` (z. B. die Sprachnachricht) hängt nur an der Nachricht
  const userMessage = addMessage(user.id, 'user', text, { clientId, attachments: [...images, ...extra] });

  const t: Turn = { user, conversationId: convId, today: todayIn(user.timeZone), replies: [], changed: new Map(), images };
  const intent = interpret(text, t.today, timeIn(user.timeZone), { locale: userLocale(user) });
  const pending = getPending(user.id);

  let handled = false;
  if (/^\s*(bitte\s+)?(mach\s+(das|es)\s+)?r(ü|ue)ckg(ä|ae)ngig\b|^\s*(please\s+)?undo(\s+(that|it))?\b/iu.test(text)) handled = undoLast(t);
  if (!handled && BRIEFING_RE.test(text)) { say(t, briefingText(t.user)); handled = true; }
  if (!handled && FORGOT_RE.test(text)) handled = await answerForgot(t);
  if (!handled && INBOX_RE.test(text)) handled = answerInbox(t);
  if (!handled && WEEK_RE.test(text)) handled = await answerWeek(t, text);
  if (!handled && hasFeature(user, 'goals') && GOAL_START_RE.test(text) && (looksLikeGoal(text) || GOAL_EXPLICIT_RE.test(text))) handled = await onGoalCreate(t, text);
  if (!handled && !images.length && hasFeature(user, 'goals')) handled = await onGoalLog(t, text);
  if (!handled && hasFeature(user, 'finance') && SPEND_RE.test(text)) handled = onSpending(t, text);
  if (handled && pending) clearPending(user.id);
  if (!handled && pending && intent?.type !== 'create') handled = await answerPending(t, pending, text);
  if (pending && !handled) clearPending(user.id);

  if (!handled && images.length && intent?.type !== 'create') handled = attachPhotoToRecentHomework(t);

  if (!handled) {
    switch (intent?.type) {
      case 'create': await onCreate(t, intent.entry); break;
      case 'move': await onMove(t, intent, text); break;
      case 'delete': onDelete(t, intent.query); break;
      case 'remind': onRemind(t, intent); break;
      case 'recurring': onRecurring(t, intent); break;
      case 'list_add': onListAdd(t, intent); break;
      case 'list_show': onListShow(t); break;
      case 'list_done': if (!onListDone(t, intent)) await runAgent(t); break;
      case 'errand': await onErrand(t, intent); break;
      case 'remember': onRemember(t, intent.text); break;
      case 'forget': onForget(t, intent.text); break;
      case 'correct': if (!onCorrect(t, intent)) await runAgent(t); break;
      case 'done': onDone(t, intent.subject, intent.kind); break;
      case 'agenda': say(t, agendaText(user, t.today, intent.days)); break;
      default: await runAgent(t);
    }
  }
  return { messages: t.replies, items: [...t.changed.values()], userMessage };
}

const BRIEFING_RE = /^\s*(\W*)(morning[- ]?)?briefing\b|^\s*(tages)?(überblick|ueberblick)\b|^\s*was (steht|ist) heute (an|los)\b|^\s*what'?s (up|on) today\b/iu;
const INBOX_RE = /^\s*(\W*)(was (ist|gibt'?s) neu(es)? (in|bei) (der |meiner |meinen |deiner )?(mail|mails|post|inbox)|(gibt'?s |hab ich )?neue (mail|mails|post)|mail-?übersicht|hab ich post|what'?s new in (my )?(e-?mail|mail|inbox)|(do i have |any )new (e-?mails?|mail)s?)\b/iu;
const GOAL_START_RE = GOAL_RE;
const GOAL_EXPLICIT_RE = /^\s*(mein\s+ziel|ziel\s*[:,])/iu;
const FORGOT_RE = /hab(e)? ich (was|etwas|irgendwas) vergessen|was (hab|habe) ich vergessen|did i forget (anything|something)|what did i forget/iu;

const WEEK_RE = /\bplan(e|st)?\s+(mir\s+)?(meine|die|diese|nächste|naechste)\s+(\w+\s+)?woche\b|\bwochenplan|\bwoche\s+(planen|durchplanen)|\bplan my week\b/iu;

/** „Plan meine Woche“ – Vorschlag als Karte, Übernehmen mit Ja */
async function answerWeek(t: Turn, text: string): Promise<boolean> {
  const next = /nächste|naechste/iu.test(text);
  const plan = await planWeek(t.user, next ? { from: addDays(t.today, 8 - isoWeekday(t.today)) } : {});
  const v = voiceOf(t.user);
  if (!plan.blocks.length) {
    say(t, plan.notes.length ? `${v.weekPlanEmpty()}\n\n${plan.notes.map((n) => `⚠️ ${n}`).join('\n')}` : v.weekPlanEmpty());
    return true;
  }
  const { result } = offerWeekPlan(t.user, plan, { intro: v.weekPlanIntro(plan.blocks.length), source: 'chat', say: sayAction(t) });
  if (result.status === 'refused') say(t, result.reason);
  return true;
}

/** „Was ist neu in der Mail?“ – die wichtigen Mails der letzten Tage in wenigen Zeilen */
function answerInbox(t: Turn): boolean {
  const v = voiceOf(t.user);
  const mails = buildLagebild(t.user, 3).importantInbox;
  if (!mails.length) { say(t, v.inboxNone()); return true; }
  const lines = mails.slice(0, 4).map((m) => `- **${m.sender ?? 'Jemand'}**: ${m.summary || '(ohne Text)'}${m.needsReply ? ' _(Antwort nötig)_' : ''}`).join('\n');
  say(t, v.inboxSome(mails.length, lines) + (mails.length > 4 ? `\n… und ${mails.length - 4} weitere in der Inbox.` : ''));
  return true;
}

/** „Was hab ich vergessen?“ – alle aktuellen Hinweise, mit Vorschlägen als Karten */
async function answerForgot(t: Turn): Promise<boolean> {
  const hints = findHints(t.user);
  if (!hints.length) { say(t, voiceOf(t.user).nothingForgotten()); return true; }
  say(t, hints.length === 1 ? 'Eine Sache ist mir aufgefallen:' : `${hints.length} Sachen sind mir aufgefallen:`);
  for (const h of hints) {
    if (h.action && !h.actionId) {
      const r = perform(t.user, h.action.type, h.action.params as never, { source: 'auto', question: h.text, quiet: true, say: sayAction(t) });
      if (r.status === 'done') {
        t.replies.push(addMessage(t.user.id, 'assistant', voiceOf(t.user).hintDone(getAction(t.user.id, r.actionId)?.summary ?? h.action.label), { actionId: r.actionId }));
      }
      else if (r.status === 'refused') say(t, h.text);
      markHintDelivered(t.user.id, h.key, r.status === 'refused' ? undefined : r.actionId);
      touched(t, ...r.changed);
    } else {
      say(t, h.text);
      markHintDelivered(t.user.id, h.key);
    }
  }
  return true;
}

/** HÜ-Autopilot: löst Stella von selbst (auto/melden)? */
const autopilot = (u: User) => ['auto', 'notify'].includes(levelFor(u, 'homework'));

function undoLast(t: Turn): boolean {
  const last = lastUndoable(t.user.id);
  if (!last) { say(t, T(t, 'srv.undo.nothing')); return true; }
  const { changed } = undo(t.user.id, last.id);
  touched(t, ...changed);
  say(t, T(t, 'srv.undo.done', { summary: last.summary }));
  return true;
}

/** Foto der Aufgabe an eine HÜ hängen. */
function attachPhotos(t: Turn, item: Item) {
  for (const img of t.images) addAttachment(t.user.id, item.id, { ...img, caption: `${item.subject ?? ''} Aufgabe`.trim() });
  touched(t, getItem(t.user.id, item.id));
}

/** HÜ lösen lassen – je nach Recht sofort oder mit Rückfrage. Nach der eigenen Antwort aufrufen. */
function requestSolve(t: Turn, item: Item) {
  if (levelFor(t.user, 'homework') === 'never') return;
  const r = perform(t.user, 'homework.solve', { itemId: item.id }, { source: 'auto', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
}

/** Foto ohne Text: gehört wohl zur gerade eingetragenen HÜ. */
function attachPhotoToRecentHomework(t: Turn): boolean {
  const recent = db.prepare(`SELECT id FROM items WHERE user_id = ? AND kind = 'homework' AND status = 'open' AND deleted = 0
    AND created_at > ? ORDER BY created_at DESC LIMIT 1`).get(t.user.id, new Date(Date.now() - 30 * 60_000).toISOString()) as { id: string } | undefined;
  const item = recent && getItem(t.user.id, recent.id);
  if (!item) {
    say(t, T(t, 'srv.photo.which'));
    return true;
  }
  attachPhotos(t, item);
  say(t, autopilot(t.user)
    ? T(t, 'srv.photo.attachedSolve', { title: item.title })
    : T(t, 'srv.photo.attached', { title: item.title }));
  requestSolve(t, item);
  return true;
}

// ---------- Schnelle Wege ----------

async function onCreate(t: Turn, e: ParsedEntry) {
  if (e.kind === 'exam' && !e.due) {
    const item = addParsedEntry(t.user, e);
    touched(t, item);
    setPending(t.user.id, 'due_date', item.id);
    say(t, v(t).askDate(item.title));
    return;
  }
  const item = addParsedEntry(t.user, e);
  touched(t, item);
  // ins Protokoll, damit „Rückgängig“ und „nein, Donnerstag“ funktionieren
  const actionId = record(t.user, 'item.create', { kind: item.kind, title: item.title, due: item.due, time: item.time }, { id: item.id }, { id: item.id });
  const when = `${day(t, item.due!)}${item.time ? ` ${T(t, 'srv.atTime', { time: item.time })}` : ''}`;
  const evening = t.user.settings.eveningTime ?? '19:00';

  if (item.kind === 'homework') {
    const remindDay = addDays(item.due!, -1);
    const parts = [dot(v(t).noted(`**${item.title}**${item.detail ? ` – ${item.detail}` : ''}, ${T(t, 'srv.dueWhen', { when })}`))];
    if (remindDay >= t.today) parts.push(v(t).remindAt(day(t, remindDay), evening));
    const book = bookFor(t.user, item.subject);
    if (t.images.length) {
      attachPhotos(t, item);
      if (autopilot(t.user)) parts.push(v(t).solveFromPhoto());
    } else if (book && item.page) {
      parts.push(autopilot(t.user) ? v(t).fetchAndSolve(PROVIDERS[book.provider].name) : v(t).fetchOnly(PROVIDERS[book.provider].name));
    }
    if (e.dueAssumed) {
      const fromTimetable = item.due !== nextSchoolDay(t.today);
      parts.push(fromTimetable
        ? T(t, 'srv.noDate.timetable', { subject: item.subject ?? '' })
        : T(t, 'srv.noDate.nextDay', { subject: item.subject ?? '' }));
    }
    sayA(t, parts.join(' '), actionId);
    if (t.images.length) requestSolve(t, item);
    return;
  }

  if (item.kind === 'exam') {
    sayA(t, v(t).examNoted(item.title, dot(day(t, item.due!, false))), actionId);
    if (item.material) {
      await makePlan(t, item.id, item.material);
    } else {
      setPending(t.user.id, 'exam_material', item.id);
      say(t, v(t).askMaterial());
    }
    return;
  }

  sayA(t, dot(v(t).noted(`**${item.title}**${item.detail ? ` – ${item.detail}` : ''}, ${when}`)), actionId);
}

// ---------- Verschieben, löschen, erinnern, merken, korrigieren ----------

/** Welcher offene Eintrag ist gemeint? Fach/Art/Wörter, bei Gleichstand der nächste fällige */
function findItem(t: Turn, q: ItemQuery): Item | null {
  const candidates = listItems(t.user.id, { from: addDays(t.today, -14) }).filter((i) => i.kind !== 'study' || q.words.length);
  let best: { item: Item; score: number } | null = null;
  for (const i of candidates) {
    const hay = `${i.title} ${i.detail ?? ''} ${i.subject ?? ''}`.toLowerCase();
    if (q.subject && i.subject !== q.subject) continue;
    if (q.kind && i.kind !== q.kind) continue;
    const hits = q.words.filter((w) => hay.includes(w)).length;
    if (q.words.length && !hits) continue;
    const score = (q.subject ? 3 : 0) + (q.kind ? 2 : 0) + hits * 2 - (i.due && i.due < t.today ? 1 : 0);
    if (!best || score > best.score || (score === best.score && (i.due ?? '9') < (best.item.due ?? '9'))) best = { item: i, score };
  }
  return best?.item ?? null;
}

const queryLabel = (t: Turn, q: ItemQuery) => [q.subject, q.kind && T(t, `kind.${q.kind}`), ...q.words].filter(Boolean).join(' ');
const whenLabel = (t: Turn, due: string | null, time: string | null) => [due ? day(t, due) : null, time ? T(t, 'srv.atTime', { time }) : null].filter(Boolean).join(' ');

function changeTo(t: Turn, item: Item, due: string | null, time: string | null) {
  const r = perform(t.user, 'item.update', { id: item.id, patch: { ...(due ? { due } : {}), ...(time ? { time } : {}) } }, { source: 'chat', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
  if (r.status === 'refused') { say(t, `🙅 ${r.reason}`); return; }
  if (r.status === 'done') sayA(t, v(t).moved(item.title, whenLabel(t, due ?? item.due, time ?? item.time)), r.actionId);
}

async function onMove(t: Turn, intent: Extract<Intent, { type: 'move' }>, text: string) {
  const item = findItem(t, intent.query);
  if (item) { changeTo(t, item, intent.due, intent.time); return; }
  // "Latein HÜ auf Freitag" ohne vorhandene HÜ ist eher eine neue HÜ
  const entry = parseEntry(text.replace(/\bauf\b/iu, 'bis'), t.today);
  if (entry) { await onCreate(t, entry); return; }
  say(t, v(t).notFound(queryLabel(t, intent.query)));
}

function onDelete(t: Turn, q: ItemQuery) {
  const item = findItem(t, q);
  if (!item) { say(t, v(t).notFound(queryLabel(t, q))); return; }
  const r = perform(t.user, 'item.delete', { id: item.id }, { source: 'chat', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).deleted(item.title), r.actionId);
}

function onRemind(t: Turn, intent: Extract<Intent, { type: 'remind' }>) {
  const r = perform(t.user, 'item.create', { kind: 'reminder', title: intent.text, due: intent.due, time: intent.time, source: 'chat' },
    { source: 'chat', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).remindSet(whenLabel(t, intent.due, intent.time), intent.text), r.actionId);
}

/** „erinnere mich jeden Montag an den Müll“ → Dauerauftrag: nach jedem Erinnern rückt er zum nächsten Termin vor */
function onRecurring(t: Turn, intent: Extract<Intent, { type: 'recurring' }>) {
  const time = intent.time ?? '08:00';
  let due = nextOccurrence(intent.recurrence, t.today);
  if (due === t.today && time <= timeIn(t.user.timeZone)) due = nextOccurrence(intent.recurrence, addDays(t.today, 1));
  const r = perform(t.user, 'item.create', { kind: 'reminder', title: intent.text, due, time, recurrence: intent.recurrence, source: 'chat' },
    { source: 'chat', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).recurringSet(`${userLocale(t.user) === 'de' ? describeRecurrence(intent.recurrence) : describeRecurrenceEn(intent.recurrence)} ${T(t, 'srv.atTime', { time })}`, intent.text), r.actionId);
}

// ---------- Einkaufsliste und Erledigungen ----------

function onListAdd(t: Turn, intent: Extract<Intent, { type: 'list_add' }>) {
  const r = perform(t.user, 'list.add', { items: intent.items }, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'refused') { say(t, `🙅 ${r.reason}`); return; }
  if (r.status !== 'done') return;
  const res = r.result as { added: string[]; skipped: string[] };
  if (!res.added.length) say(t, v(t).listAlready(res.skipped.join(', ')));
  else sayA(t, v(t).listAdded(res.added.join(', '), res.added.length), r.actionId);
}

/** „Wie viel hab ich diese Woche ausgegeben?“ → Summe als Karte mit den Kategorien */
function onSpending(t: Turn, text: string): boolean {
  const range = spendingPeriod(text, t.today);
  const card = spendingCard(t.user, range, range.label);
  const words = card.count ? v(t).spendingSome(card.label, euro(card.totalCents, card.currency), card.count) : v(t).spendingNone(card.label);
  t.replies.push(addMessage(t.user.id, 'assistant', words, { card }));
  return true;
}

/** „ich will 3x pro Woche laufen gehen“ → Ziel anlegen (Karte mit Rückgängig) */
async function onGoalCreate(t: Turn, text: string): Promise<boolean> {
  const g = await extractGoal(t.user, text);
  if (!g) return false;
  if (activeGoals(t.user.id).some((x) => x.title.toLowerCase() === g.title.toLowerCase())) { say(t, v(t).goalExists(g.title)); return true; }
  const r = perform(t.user, 'goal.create', g as NewGoal, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'refused') { say(t, `🙅 ${r.reason}`); return true; }
  if (r.status !== 'done') return true;
  sayA(t, v(t).goalSet(g.title, describeCadence(g)), r.actionId);
  return true;
}

/** „war heute 5 km laufen“ → dem passenden Ziel zuordnen; false, wenn das gar nicht nach Fortschritt klingt */
async function onGoalLog(t: Turn, text: string): Promise<boolean> {
  const goals = activeGoals(t.user.id);
  if (!goals.length) return false;
  const quick = parseLogQuick(text, t.today);
  if (!quick) return false;
  let hit: { goal: (typeof goals)[number]; value: number; date: string; note: string | null } | null = null;
  const named = matchGoal(goals, text);
  if (named) {
    const unit = named.unit.toLowerCase();
    if (unit === 'x') hit = { goal: named, value: 1, date: quick.date, note: quick.unit && quick.unit !== 'x' ? text.trim().slice(0, 200) : null };
    else if (quick.unit === unit) hit = { goal: named, value: quick.value, date: quick.date, note: null };
  } else if (quick.unit && quick.unit !== 'x') {
    const byUnit = goals.filter((g) => g.unit.toLowerCase() === quick.unit);
    if (byUnit.length === 1) hit = { goal: byUnit[0]!, value: quick.value, date: quick.date, note: null };
    else if (byUnit.length > 1) { say(t, v(t).goalUnclear()); return true; }
  }
  hit ??= await extractLog(t.user, text, goals, t.today);
  if (!hit) return false;
  const r = perform(t.user, 'goal.log', { goalId: hit.goal.id, value: hit.value, date: hit.date, note: hit.note }, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'refused') { say(t, `🙅 ${r.reason}`); return true; }
  if (r.status !== 'done') return true;
  const p = progress(t.user, hit.goal, t.today);
  sayA(t, v(t).goalLogged(hit.goal.title, amountText(hit.goal, hit.value), `${amountText(hit.goal, p.weekValue)} von ${amountText(hit.goal, weekTarget(hit.goal))}`), r.actionId);
  return true;
}

function onListShow(t: Turn) {
  const open = openItems(t.user.id);
  if (!open.length) { say(t, v(t).listEmpty()); return; }
  const lines = open.slice(0, 8).map((i) => `- ${i.text}${i.qty ? ` (${i.qty})` : ''}`).join('\n');
  say(t, v(t).listShow(open.length, lines) + (open.length > 8 ? `\n… und ${open.length - 8} weitere in der Liste.` : ''));
}

/** „Milch hab ich“ / „hab eingekauft“ – false, wenn nichts auf der Liste dazu passt (dann antwortet die KI) */
function onListDone(t: Turn, intent: Extract<Intent, { type: 'list_done' }>): boolean {
  const open = openItems(t.user.id);
  if (intent.items === 'all') {
    if (!open.length) return false;
    const r = perform(t.user, 'list.check', { ids: open.map((i) => i.id), names: [`${open.length} Einträge`], done: true }, { source: 'chat', quiet: true, say: sayAction(t) });
    if (r.status === 'done') sayA(t, v(t).listAllChecked(open.length), r.actionId);
    return true;
  }
  const { matched, missing } = matchOpenItems(t.user.id, intent.items);
  if (!matched.length) return false;
  const r = perform(t.user, 'list.check', { ids: matched.map((i) => i.id), names: matched.map((i) => i.text), done: true }, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'done') sayA(t, v(t).listChecked(matched.map((i) => i.text).join(', ')) + (missing.length ? `\n${v(t).listNoMatch(missing.join(', '))}` : ''), r.actionId);
  return true;
}

/** „nach der Arbeit Blumen kaufen“: Erinnerung zur passenden Zeit, mit dem passenden Laden */
async function onErrand(t: Turn, intent: Extract<Intent, { type: 'errand' }>) {
  const place = intent.place ?? await resolvePlace(t.user.id, intent.text);
  const time = intent.when === 'after_work' ? afterWorkTime(t.user) : intent.when === 'after_school' ? '15:00' : '19:00';
  const due = time > timeIn(t.user.timeZone) ? t.today : addDays(t.today, 1);
  const r = perform(t.user, 'item.create', { kind: 'reminder', title: intent.text, due, time, source: 'chat', place }, { source: 'chat', quiet: true, say: sayAction(t) });
  touched(t, ...r.changed);
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).errandSet(whenLabel(t, due, time), intent.text, place ? placeKind(place.category)?.plural ?? null : null), r.actionId);
}

/** grobe Einordnung für „merk dir …“ – die KI sortiert in der Nacht nicht um, der Nutzer kann ändern */
function guessCategory(text: string): MemoryCategory {
  const s = text.toLowerCase();
  if (/allergi|krank|asthma|brille|medikament|vegetar|vegan|unverträg/u.test(s)) return 'health';
  if (/(jeden|immer|jede woche|montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags).*\d|training|probe\b/u.test(s)) return 'routine';
  if (/geburtstag|freund|freundin|mama|papa|mutter|vater|bruder|schwester|oma|opa|lehrer|lehrerin|frau |herr |klassenvorst/u.test(s)) return 'person';
  if (/\b(mag|liebe|lieber|hasse|am liebsten|lieblings)/u.test(s)) return 'preference';
  if (/\b(will|möchte|ziel|schaffen)\b/u.test(s)) return 'goal';
  if (/schule|fach|note|klasse|schularbeit|hü\b/u.test(s)) return 'school';
  return 'other';
}

function onRemember(t: Turn, text: string) {
  const r = perform(t.user, 'memory.add', { category: guessCategory(text), text, source: 'user' }, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).remembered(text), r.actionId);
}

function onForget(t: Turn, text: string) {
  const words = text.toLowerCase().split(/[\s,.!?]+/u).filter((w) => w.length > 2 && !['dem', 'den', 'die', 'das', 'mit', 'ich', 'mein', 'meine'].includes(w));
  const m = listMemories(t.user.id)
    .map((x) => ({ x, hits: words.filter((w) => x.text.toLowerCase().includes(w)).length }))
    .filter((r) => r.hits > 0).sort((a, b) => b.hits - a.hits)[0]?.x;
  if (!m) { say(t, v(t).notFound(text)); return; }
  const r = perform(t.user, 'memory.delete', { id: m.id }, { source: 'chat', quiet: true, say: sayAction(t) });
  if (r.status === 'refused') say(t, `🙅 ${r.reason}`);
  else if (r.status === 'done') sayA(t, v(t).forgotten(m.text), r.actionId);
}

/** „nein, Donnerstag“ → der zuletzt angelegte/geänderte Eintrag. false = nichts Passendes, KI fragen */
function onCorrect(t: Turn, intent: Extract<Intent, { type: 'correct' }>): boolean {
  const id = lastChatItemId(t.user.id);
  const item = id ? getItem(t.user.id, id) : null;
  if (!item || item.deleted) return false;
  changeTo(t, item, intent.due, intent.time);
  return true;
}

function onDone(t: Turn, subject: string | null, kind: ItemKind | null) {
  const candidates = listItems(t.user.id, { from: addDays(t.today, -14) })
    .filter((i) => i.kind !== 'study' && (!subject || i.subject === subject) && (!kind || i.kind === kind));
  const item = candidates[0];
  if (!item) { say(t, v(t).nothingFound()); return; }
  touched(t, changeItem(t.user, item.id, { status: 'done' }));
  const left = listItems(t.user.id, { from: t.today, to: addDays(t.today, 1) }).filter((i) => i.kind === 'homework').length;
  say(t, v(t).done(item.title, left));
}

export function agendaText(user: User, today: string, days: number): string {
  const items = listItems(user.id, { from: today, to: addDays(today, days) });
  if (!items.length) return voiceOf(user).nothingAhead(days);
  const NODATE = 'no-date';
  const byDay = new Map<string, Item[]>();
  for (const i of items) byDay.set(i.due ?? NODATE, [...(byDay.get(i.due ?? NODATE) ?? []), i]);
  const icon: Record<string, string> = { homework: '📚', exam: '📝', assignment: '📌', event: '📅', todo: '☑️', study: '🧠' };
  return [...byDay].map(([d, list]) =>
    `**${d === NODATE ? tr(user, 'srv.noDate.label') : dayFor(user, d, today)}**\n` +
    list.map((i) => `${icon[i.kind] ?? '•'} ${i.title}${i.detail ? ` – ${i.detail}` : ''}${i.time ? ` (${i.time})` : ''}`).join('\n'),
  ).join('\n\n');
}

// ---------- Rückfragen ----------

async function answerPending(t: Turn, pending: { type: string; itemId: string; createdAt: string }, text: string): Promise<boolean> {
  // Rückfragen verfallen nach 3 Tagen
  if (Date.now() - Date.parse(pending.createdAt) > 3 * 86_400_000) return false;
  const item = getItem(t.user.id, pending.itemId);
  if (!item || item.deleted) return false;

  if (pending.type === 'due_date') {
    const due = parseEntry(`test ${text}`, t.today)?.due;
    if (!due) return false;
    clearPending(t.user.id);
    const updated = changeItem(t.user, item.id, { due });
    touched(t, updated);
    say(t, T(t, 'srv.pending.dateSet', { title: item.title, when: day(t, due, false) }));
    if (item.kind === 'exam' && !item.material) {
      setPending(t.user.id, 'exam_material', item.id);
      say(t, v(t).askMaterial());
    }
    return true;
  }

  if (pending.type === 'exam_material') {
    clearPending(t.user.id);
    if (/^(weiß|weiss|keine ahnung|später|spaeter|nein|noch nicht|egal)/iu.test(text.trim())) {
      say(t, 'Alles klar – schreib mir den Stoff einfach, sobald du ihn weißt („Stoff Mathe SA: …“).');
      return true;
    }
    touched(t, changeItem(t.user, item.id, { material: text.trim() }));
    await makePlan(t, item.id, text.trim());
    return true;
  }
  return false;
}

async function makePlan(t: Turn, examId: string, material: string) {
  const exam = getItem(t.user.id, examId)!;
  let sessions = createStudyPlan(t.user, examId);
  if (!sessions.length) { say(t, 'Für einen Lernplan ist es schon zu knapp – heute Abend alles einmal durchgehen! 💪'); return; }

  // KI darf die Themen pro Einheit sinnvoller verteilen – wenn sie nicht erreichbar ist, bleibt der Regel-Plan.
  const focuses = await refineFocuses(exam, material, sessions.map((s) => s.due!));
  if (focuses) sessions = sessions.map((s, i) => changeItem(t.user, s.id, { detail: focuses[i] }) ?? s);
  touched(t, ...sessions);
  say(t, `🧠 Dein Lernplan für **${exam.title}** (${sessions.length} Einheiten, je ca. 45 min, steht im Planer):\n` +
    sessions.map((s) => `• ${formatDateDe(s.due!, t.today)}: ${s.detail}`).join('\n'));
}

async function refineFocuses(exam: Item, material: string, dates: string[]): Promise<string[] | null> {
  if (!llmAvailable() || splitTopics(material).length < 2) return null;
  try {
    const { message } = await complete([
      { role: 'system', content: 'Du bist ein Lerncoach für Schüler:innen in Österreich. Antworte nur mit JSON.' },
      {
        role: 'user',
        content: `Prüfung: ${exam.title} am ${exam.due}. Stoff: ${material}\n` +
          `Verteile den Stoff sinnvoll auf genau ${dates.length} Lerneinheiten (Termine: ${dates.join(', ')}). ` +
          `Die letzte Einheit ist Wiederholung + Probe-Test. Pro Einheit ein kurzer, konkreter Fokus (max. 12 Wörter). ` +
          `Format: {"sessions": ["…", "…"]}`,
      },
    ], undefined, { json: true, background: true, tier: 'heavy' });
    const parsed = JSON.parse((message.content ?? '').replace(/^```(json)?|```$/g, '')) as { sessions?: unknown };
    const list = Array.isArray(parsed.sessions) ? parsed.sessions.map(String) : [];
    return list.length === dates.length ? list : null;
  } catch {
    return null;
  }
}

// ---------- KI-Agent ----------

const KINDS = ['homework', 'exam', 'assignment', 'event', 'todo', 'study', 'reminder'];

/** Alltagsaufgaben: nur als Profi-Aufgabe (Sonnet) und nur mit dem passenden Abo */
const ERRAND_TOOLS = new Set(['find_restaurants', 'booking_options', 'report_availability']);

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'find_restaurants',
      description: 'Findet Restaurants, Cafés und Bars in der Nähe (OpenStreetMap), sortiert nach Entfernung und geöffnet zur gewünschten Zeit, inkl. Buchungslink bzw. Telefon. Zeigt automatisch eine Karte. Du kannst NICHT selbst reservieren.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name oder Stichwort, optional' },
          cuisine: { type: 'string', description: 'Küche, z. B. italienisch, Sushi, vegan' },
          when: { type: 'string', description: 'Wunschzeitpunkt YYYY-MM-DDTHH:MM (Ortszeit), leer = jetzt' },
          people: { type: 'number', description: 'Personenzahl, falls genannt' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'booking_options',
      description: 'Sucht auf der Webseite eines Lokals nach einem Buchungsdienst (TheFork, OpenTable, Quandoo, resmio, Bookatable, Tablein, Google). Liefert den direkten Link, sonst die Telefonnummer.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, website: { type: 'string' }, phone: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_availability',
      description: 'Zeigt dem Nutzer die Karte „Verfügbarkeit“, NACHDEM du mit der Websuche geprüft hast, wo ein Produkt zu haben ist. Status nur „in_stock“ oder „orderable“, wenn eine Quelle es belegt – sonst „unclear“. Keine erfundenen Bestände.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string' },
          results: {
            type: 'array', maxItems: 5,
            items: {
              type: 'object',
              properties: {
                retailer: { type: 'string' }, store: { type: 'string', description: 'Filiale, falls bekannt' },
                status: { type: 'string', enum: ['in_stock', 'orderable', 'unclear'] },
                source: { type: 'string', description: 'woher die Angabe stammt, z. B. Webseite des Händlers' },
                url: { type: 'string' }, phone: { type: 'string' }, note: { type: 'string' },
              },
              required: ['retailer', 'status', 'source'],
            },
          },
        },
        required: ['product', 'results'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_entry',
      description: 'Legt einen Eintrag im Planer an (HÜ, Test/Schularbeit, Abgabe, Termin, To-do). Erinnerungen werden automatisch geplant.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS, description: 'homework=Hausübung, exam=Test/Schularbeit/Prüfung, assignment=Referat/Abgabe, event=Termin, todo=Aufgabe, reminder=Erinnerung genau zur Uhrzeit (time nötig)' },
          title: { type: 'string', description: 'kurz, z. B. "Mathe Schularbeit" oder "Zahnarzt"' },
          subject: { type: 'string', description: 'Schulfach, falls zutreffend' },
          detail: { type: 'string' },
          due: { type: 'string', description: 'Datum YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM, optional' },
          material: { type: 'string', description: 'bei Tests: der Stoff' },
        },
        required: ['kind', 'title', 'due'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_entries',
      description: 'Listet Einträge im Planer.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          kind: { type: 'string', enum: KINDS },
          include_done: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_entry',
      description: 'Ändert einen Eintrag (z. B. als erledigt markieren, verschieben, löschen).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['open', 'done', 'cancelled'] },
          due: { type: 'string' }, time: { type: 'string' }, title: { type: 'string' },
          detail: { type: 'string' }, notes: { type: 'string' }, material: { type: 'string' },
          deleted: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_study_plan',
      description: 'Erstellt Lerneinheiten bis zu einem Test. Vorher den Stoff kennen!',
      parameters: {
        type: 'object',
        properties: { exam_id: { type: 'string' }, material: { type: 'string' } },
        required: ['exam_id', 'material'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'solve_homework',
      description: 'HÜ automatisch lösen und in Handschrift ins Heft schreiben (braucht Buchseite oder Foto der Aufgabe). again=true löst eine schon gelöste HÜ neu (z. B. "nochmal lösen", "Lösung ist falsch").',
      parameters: { type: 'object', properties: { entry_id: { type: 'string' }, again: { type: 'boolean' } }, required: ['entry_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'timetable',
      description: 'Stundenplan aus WebUntis (inkl. Entfall).',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spending_summary',
      description: 'Ausgaben (Kartenzahlungen aus Apple Pay) in einem Zeitraum: Summe, Kategorien, häufigste Händler. Optional nur eine Kategorie.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD, Standard: Monatsanfang' },
          to: { type: 'string', description: 'YYYY-MM-DD, Standard: heute' },
          category: { type: 'string', description: 'Lebensmittel, Essen & Trinken, Transport, Shopping, Freizeit, Abos, Gesundheit oder Sonstiges' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'health_summary',
      description: 'Schritte/Schlaf/Aktivität der letzten Tage (aus Apple Health über Kurzbefehle).',
      parameters: { type: 'object', properties: { days: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recent_inbox',
      description: 'Letzte E-Mails, Social-Media-Benachrichtigungen (Instagram, TikTok …) und SMS.',
      parameters: { type: 'object', properties: { source: { type: 'string', enum: ['email', 'social', 'sms'] }, limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_mail',
      description: 'Auf eine E-Mail antworten (id aus recent_inbox oder dem Lagebild). Stella schreibt den Text, der Nutzer bekommt ihn zum Bestätigen – gesendet wird erst nach seinem Ja.',
      parameters: {
        type: 'object',
        properties: { inbox_id: { type: 'string' }, instruction: { type: 'string', description: 'was inhaltlich drinstehen soll, z. B. "ich bin morgen krank"' } },
        required: ['inbox_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Etwas Dauerhaftes über den Nutzer merken (Person, Routine, Vorliebe, Schule, Ziel, Gesundheit). Routinen mit schedule, damit Stella sie beim Planen freihält.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'kurzer Satz, z. B. "Fußballtraining" oder "Frau Huber ist Klassenvorstand" oder "Französisch fällt schwer"' },
          category: { type: 'string', enum: ['person', 'routine', 'preference', 'school', 'goal', 'health', 'other'] },
          schedule: {
            type: 'object', description: 'nur bei Routinen mit fester Zeit',
            properties: { days: { type: 'array', items: { type: 'number' }, description: '1=Mo … 7=So' }, start: { type: 'string', description: 'HH:MM' }, end: { type: 'string', description: 'HH:MM' } },
          },
          explicit: { type: 'boolean', description: 'true, wenn der Nutzer ausdrücklich "merk dir …" gesagt hat' },
        },
        required: ['text', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Einen gemerkten Eintrag korrigieren (id wie m:abcd1234 aus dem Lagebild).',
      parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, category: { type: 'string' }, schedule: { type: 'object' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate',
      description: 'Nur wenn die Aufgabe wirklich zu schwer für dich ist (lange mehrstufige Planung, komplexes Rechnen, viele Quellen abwägen): gib sie an ein stärkeres Modell ab. Kostet ein begrenztes Kontingent – nicht für Alltägliches.',
      parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Ein Satz: warum es zu schwer ist' } }, required: ['reason'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Einen gemerkten Eintrag löschen (z. B. "vergiss das", oder wenn er nicht mehr stimmt).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
];

/** Werkzeuge für diese Nutzerin: ausgeblendete Funktionen (z. B. Finanzen) bekommt die KI gar nicht erst zu sehen. */
const toolsFor = (user: User, tier: Tier = 'light', errand = false): ToolDef[] => TOOLS
  .filter((x) => x.function.name !== 'spending_summary' || hasFeature(user, 'finance'))
  .filter((x) => !ERRAND_TOOLS.has(x.function.name) || (errand && tier === 'heavy' && planAllows(user, 'webTasks')));

/** Websuche und Seitenabruf von Claude (Server-Werkzeuge) – nur für Alltagsaufgaben in der Profi-Stufe */
const SERVER_TOOLS = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }];

/** Antworten per E-Mail: einfache Aufträge kurz bestätigen, Fragen ausführlich beantworten */
const STYLE_DETAILED = 'Style: the answer goes out by email. Confirm simple tasks briefly in one or two sentences. Answer questions in detail and well structured (short paragraphs or bullet lists with "- "), no filler phrases.';

/**
 * System-Prompt in zwei Teilen: `fixed` bleibt zwischen Anfragen gleich (Prompt-Caching), `dynamic` enthält alles
 * Veränderliche (Datum, Uhrzeit, Lagebild, Gedächtnis). Keine Zeitstempel im festen Teil!
 */
export function systemPrompt(user: User, today: string): { fixed: string; dynamic: string } {
  const lb = buildLagebild(user, 8);
  const locale = userLocale(user);
  const terms = userTerms(user);
  return {
    dynamic: `Now: ${WEEKDAYS_EN[weekdayOf(today)]}, ${today}, ${timeIn(user.timeZone)} (${user.timeZone}).

SITUATION (Lagebild)
${lagebildPrompt(lb)}`,
    fixed: `You are Stella, the personal assistant of ${user.name}. Motto: "Let Stella handle your life."
${describeUser(user)} You take work off ${user.name}'s plate: appointments, planning, messages, everyday life${isSchool(user) ? ', school and learning' : ''}.

Rules:
- ${languageRule(LANGUAGE_NAMES_EN[locale])}
${isSchool(user) ? `- School words in ${user.name}'s country: homework = "${terms.homework}", big written exam = "${terms.exam}", short test = "${terms.quiz}". Use these words.\n` : ''}- ${chatContext.getStore()?.detailed ? STYLE_DETAILED : STYLE_RULES}
- ${toneInstruction(user.settings.tone, locale)}
- ACT instead of explaining: when ${user.name} wants something organised, planned, moved, cancelled or prepared, do it with the tools (several steps are fine). Work out dates yourself (YYYY-MM-DD).
- Some actions need ${user.name}'s approval: then ${user.name} gets a card with Yes/No – just say briefly that you asked.
- Use the situation report (second system block: free time, tests, learning progress) and the current time for suggestions. Never plan into busy times.
- Never invent appointments or facts. Ask if something important is missing.
- For tests/exams: ask for the material, then call create_study_plan.
${isSchool(user) ? `- You do the homework (solve_homework): Stella solves it and writes it into the notebook in handwriting.\n` : ''}- You cannot book, buy or pay for anything. Say so openly, prepare everything and give the next step. Never invent opening hours or stock: if a source is missing, say it is unclear.
- MEMORY: when you learn something lasting and useful about ${user.name} (people and their role, fixed appointments/routines with weekday and time, preferences, what is hard/easy, goals), save it right away with remember – without asking and without announcing it. Do not save: one-off things (that is a planner entry), trivia, passwords, things already in the situation report. If something is outdated, change or delete the old entry (update_memory/forget). Use what you know without mentioning it every time.
- If a task is too hard for you (long multi-step planning, multi-step maths, weighing many sources), call escalate; a stronger model then takes over. Not for everyday things.`,
  };
}

/** Ergebnis einer Aktion so formulieren, dass das Modell weiß, was passiert ist */
function actionResult(t: Turn, r: Performed) {
  touched(t, ...r.changed);
  if (r.status === 'refused') return { error: r.reason };
  if (r.status === 'proposed') return { proposed: true, info: 'Der Nutzer bekommt eine Rückfrage-Karte mit Ja/Nein und entscheidet selbst.' };
  return { ok: true, ...(typeof r.result === 'object' && r.result ? r.result : {}) };
}

function act<T extends ActionType>(t: Turn, type: T, params: ActionParams[T], source: 'chat' | 'auto' = 'chat') {
  return actionResult(t, perform(t.user, type, params, { source, quiet: source === 'chat', say: sayAction(t) }));
}

async function runTool(t: Turn, name: string, args: Record<string, any>): Promise<unknown> {
  const u = t.user;
  switch (name) {
    case 'create_entry': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.due ?? ''))) return { error: 'due muss YYYY-MM-DD sein' };
      return act(t, 'item.create', {
        kind: KINDS.includes(args.kind) ? args.kind : 'todo', title: String(args.title), subject: args.subject ?? null,
        detail: args.detail ?? null, due: args.due, time: args.time ?? null, material: args.material ?? null, source: 'ai',
      });
    }
    case 'find_restaurants': {
      const place = errandPlace(u);
      if (!place) {
        // ohne Ort: einmal mit derselben Erklärung nachfragen (Karte „Standort“), sonst nur der Hinweis an das Modell
        if (shouldAskLocation(u) && notifyOnce(u.id, 'location-ask-restaurant')) t.card = { type: 'location_ask' };
        return { error: 'Ich kenne deinen Ort nicht. Sag dem Nutzer in einem Satz, dass du dafür seinen Standort brauchst (die Karte dazu kommt gleich) oder dass er eine Stadt nennen soll.' };
      }
      const people = Number.isFinite(Number(args.people)) ? Math.max(1, Math.min(30, Number(args.people))) : null;
      const { items, when } = await findRestaurants(u.id, u.timeZone, place.lat, place.lon, { query: args.query, cuisine: args.cuisine, when: args.when });
      if (!items.length) return { results: [], info: 'Nichts Passendes gefunden. Sag das ehrlich und schlag vor, die Küche oder die Uhrzeit zu ändern.' };
      // Buchungsmöglichkeit je Lokal (Webseite des Lokals, mit Schutz vor internen Adressen)
      await Promise.all(items.map(async (it) => {
        const b = await bookingOptions(it).catch(() => null);
        if (b?.kind === 'link') { it.bookingUrl = b.url; it.bookingService = b.service; }
      }));
      t.card = { type: 'restaurants', when, people, items };
      return {
        approximateLocation: place.approximate,
        note: 'Die Karte mit „Reservieren“ (Link oder Anruf), „Route“ und „In den Planer“ wird automatisch gezeigt. Du kannst nicht selbst reservieren. Öffnungszeiten nur nennen, wenn openNow true/false ist; null heißt unbekannt.',
        results: items.map((i) => ({ name: i.name, kind: i.kind, cuisine: i.cuisine, distanceM: i.distanceM, openNow: i.openNow, openingHours: i.openingHours, bookingService: i.bookingService ?? null, hasBookingLink: !!i.bookingUrl, phone: i.phone })),
      };
    }
    case 'booking_options':
      return bookingOptions({ name: String(args.name ?? ''), website: args.website ? String(args.website) : null, phone: args.phone ? String(args.phone) : null });
    case 'report_availability': {
      const STATUS = ['in_stock', 'orderable', 'unclear'];
      const results = (Array.isArray(args.results) ? args.results : []).slice(0, 5).map((r: Record<string, unknown>) => ({
        retailer: String(r.retailer ?? '').slice(0, 80), ...(r.store ? { store: String(r.store).slice(0, 80) } : {}),
        // ohne Quelle kein „lagernd“: lieber ehrlich „unklar“
        status: STATUS.includes(String(r.status)) && String(r.source ?? '').trim() ? (r.status as 'in_stock' | 'orderable' | 'unclear') : ('unclear' as const),
        source: String(r.source ?? '').slice(0, 120) || '–',
        ...(typeof r.url === 'string' && /^https?:\/\//i.test(r.url) ? { url: r.url.slice(0, 500) } : {}),
        ...(typeof r.phone === 'string' ? { phone: r.phone.slice(0, 40) } : {}),
        ...(r.note ? { note: String(r.note).slice(0, 160) } : {}),
      })).filter((r: { retailer: string }) => r.retailer);
      if (!results.length) return { error: 'results fehlt' };
      t.card = { type: 'availability', product: String(args.product ?? '').slice(0, 120), checkedAt: new Date().toISOString(), items: results };
      return { ok: true, note: 'Die Karte wird gezeigt. Bei „unclear“ sag ehrlich, dass du es nicht weißt, und biete die Telefonnummer an.' };
    }
    case 'list_entries':
      return listItems(u.id, { from: args.from ?? t.today, to: args.to, kind: args.kind, includeDone: args.include_done })
        .slice(0, 40).map(({ id, kind, title, detail, due, time, status, material }) => ({ id, kind, title, detail, due, time, status, material }));
    case 'update_entry': {
      const { id, ...rest } = args;
      const allowed = ['status', 'due', 'time', 'title', 'detail', 'notes', 'material', 'deleted'];
      const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)));
      if (!getItem(u.id, String(id))) return { error: 'nicht gefunden' };
      return act(t, 'item.update', { id: String(id), patch });
    }
    case 'create_study_plan':
      if (!getItem(u.id, String(args.exam_id))) return { error: 'Test nicht gefunden' };
      return act(t, 'study_plan.create', { examId: String(args.exam_id), material: String(args.material) });
    case 'solve_homework':
      if (!getItem(u.id, String(args.entry_id))) return { error: 'nicht gefunden' };
      return act(t, 'homework.solve', { itemId: String(args.entry_id), again: !!args.again });
    case 'remember': {
      const text = String(args.text ?? '').trim();
      if (!text) return { error: 'text fehlt' };
      const explicit = args.explicit === true;
      return actionResult(t, perform(u, 'memory.add', {
        category: isCategory(args.category) ? args.category : 'other', text,
        source: explicit ? 'user' : 'learned', schedule: cleanSchedule(args.schedule),
      }, { source: explicit ? 'chat' : 'auto', quiet: explicit, say: sayAction(t) }));
    }
    case 'update_memory': {
      const m = findMemory(u.id, String(args.id ?? ''));
      if (!m) return { error: 'Eintrag nicht gefunden' };
      return act(t, 'memory.update', {
        id: m.id,
        patch: {
          ...(args.text ? { text: String(args.text) } : {}),
          ...(isCategory(args.category) ? { category: args.category } : {}),
          ...(args.schedule !== undefined ? { schedule: cleanSchedule(args.schedule) } : {}),
        },
      });
    }
    case 'forget': {
      const m = findMemory(u.id, String(args.id ?? ''));
      if (!m) return { error: 'Eintrag nicht gefunden' };
      return act(t, 'memory.delete', { id: m.id });
    }
    case 'timetable':
      return lessonsFor(u.id, args.from ?? t.today, args.to ?? addDays(t.today, 1));
    case 'spending_summary': {
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      const to = ymd.test(String(args.to ?? '')) ? String(args.to) : t.today;
      const from = ymd.test(String(args.from ?? '')) ? String(args.from) : `${t.today.slice(0, 7)}-01`;
      return spendingFacts(u, from, to, args.category);
    }
    case 'health_summary': {
      const days = Math.min(Number(args.days ?? 7), 60);
      return db.prepare('SELECT date, steps, sleep_hours, active_minutes FROM health_days WHERE user_id = ? AND date >= ? ORDER BY date')
        .all(u.id, addDays(t.today, -days));
    }
    case 'recent_inbox':
      return db.prepare(`SELECT id, source, sender, text, json_extract(payload, '$.summary') AS summary, json_extract(payload, '$.needsReply') AS needs_reply,
        json_extract(payload, '$.deadline') AS deadline, created_at FROM inbox_events WHERE user_id = ? ${args.source ? 'AND source = ?' : ''}
        ORDER BY created_at DESC LIMIT ?`).all(...[u.id, ...(args.source ? [args.source] : []), Math.min(Number(args.limit ?? 10), 50)]);
    case 'reply_mail': {
      const memories = listMemories(u.id).filter((m) => m.category === 'person').map((m) => `- ${m.text}`).join('\n');
      const draft = await draftReply(u, String(args.inbox_id ?? ''), String(args.instruction ?? ''), memories);
      // Senden ist heikel: immer als Karte mit dem vollen Text
      return actionResult(t, perform(u, 'mail.send', draft, {
        source: 'chat', quiet: true, say: sayAction(t),
        question: `✉️ Antwort an ${draft.to} – „${draft.subject}“:\n\n${draft.body.split('\n').map((l) => `> ${l}`).join('\n')}\n\nSoll ich das so senden?`,
      }));
    }
    default:
      return { error: `Unbekanntes Werkzeug ${name}` };
  }
}

/** Tageslimit erreicht: freundlich im Ton der Nutzerin; Kurznotizen gehen weiter, der Upgrade-Hinweis höchstens einmal am Tag */
function limitReachedText(t: Turn, limit: number, planId: PlanId): string {
  const tone = t.user.settings.tone ?? 'nett';
  let text = tr(t.user, `paywall.limit.${tone}`, { limit });
  const next = nextPlan(planId);
  if (next && paywallHintDue(t.user)) {
    const p = planFor(next);
    text += `\n\n${tr(t.user, 'paywall.hint', { plan: next.charAt(0).toUpperCase() + next.slice(1), limit: p.limits.aiMessagesPerDay })}`;
  }
  return text;
}

async function runAgent(t: Turn, wanted?: Tier, escalated = false) {
  // Alltagsaufgaben (Restaurants, Reservieren, Verfügbarkeit): nur ab Plus – vorher prüfen, damit es kein Kontingent kostet
  const recentUser = conversationMessages(t.user.id, t.conversationId, 8).filter((m) => m.role === 'user').slice(-3).map((m) => m.text);
  const errand = recentUser.some((x) => ERRAND_RE.test(x));
  if (errand && !escalated && !planAllows(t.user, 'webTasks') && ERRAND_RE.test(recentUser.at(-1) ?? '')) { say(t, tr(t.user, 'paywall.errands')); return; }
  // Eine KI-Nachricht zählt einmal pro Nutzernachricht (die Wiederholung mit Sonnet zählt nicht extra)
  if (!escalated) {
    const q = quotaFor(t.user, 'ai_message');
    if (!q.ok) { say(t, limitReachedText(t, q.limit, q.plan)); return; }
    consumeQuota(t.user, 'ai_message');
  }
  const history = conversationMessages(t.user.id, t.conversationId, 16);
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.text;
  // Der Chat-Agent startet als Haiku; Sonnet nur auf ausdrücklichen Wunsch ("gründlich") oder wenn Haiku `escalate` ruft
  const asked = wanted ?? (errand ? 'heavy' : pickTier(t.user, { text: lastUser, kind: 'chat' }));
  const { tier, downgraded, reason } = resolveTier(t.user, asked);
  // Profi-Aufgabe verbraucht (einmal je Zug). Ist sie leer, macht Haiku weiter – und Stella sagt das in einem Satz.
  if (tier === 'heavy') consumeQuota(t.user, 'pro_task');
  const downgradeNote = downgraded && asked === 'heavy' ? tr(t.user, reason === 'homework_only' ? 'paywall.proFree' : `paywall.pro.${t.user.settings.tone ?? 'nett'}`) : '';
  const sys = systemPrompt(t.user, t.today);
  const messages: LlmMessage[] = [
    { role: 'system', content: sys.fixed, dynamic: sys.dynamic },
    ...history.map((m) => ({ role: m.role, content: m.text }) as LlmMessage),
  ];
  const tools = toolsFor(t.user, tier, errand).filter((x) => x.function.name !== 'escalate' || (tier === 'light' && !escalated));
  let escalateNote = '';
  try {
    for (let step = 0; step < 6; step++) {
      const { message } = await complete(messages, tools, { tier, effort: 'medium', userId: t.user.id, heavy: tier === 'heavy', ...(errand && tier === 'heavy' && planAllows(t.user, 'webTasks') ? { serverTools: SERVER_TOOLS } : {}) });
      messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls, raw: message.raw });
      if (!message.tool_calls?.length) {
        say(t, `${message.content?.trim() || '🤔'}${downgradeNote || escalateNote ? `\n\n_${downgradeNote || escalateNote}_` : ''}`);
        return;
      }
      const wantsMore = message.tool_calls.find((c) => c.function.name === 'escalate');
      if (wantsMore) {
        // Haiku sagt: zu schwer. Der Zug wird einmal mit Sonnet wiederholt – wenn Kontingent da ist.
        if (resolveTier(t.user, 'heavy').tier === 'heavy') return runAgent(t, 'heavy', true);
        // keine Profi-Aufgabe mehr: Haiku macht weiter und sagt es am Ende in einem Satz
        const e = resolveTier(t.user, 'heavy');
        if (!escalateNote) escalateNote = tr(t.user, e.reason === 'homework_only' ? 'paywall.proFree' : `paywall.pro.${t.user.settings.tone ?? 'nett'}`);
        messages.push(...message.tool_calls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id,
          content: JSON.stringify(c === wantsMore ? { ok: false, info: 'Kein Profi-Kontingent mehr. Mach es so gut du kannst und sag das in einem Satz.' } : { error: 'übersprungen' }) })));
        continue;
      }
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leer lassen */ }
        const result = await runTool(t, call.function.name, args).catch((err: Error) => ({ error: err.message }));
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    void downgraded;
    say(t, 'Das war mir gerade zu kompliziert – versuch es bitte nochmal etwas anders. 🙈');
  } catch (err) {
    if (!(err instanceof LlmUnavailable)) throw err;
    console.warn(err.message);
    say(t, '📴 Ich erreiche gerade kein KI-Modell. Kurznotizen wie „Latein HÜ S. 45 Nr. 3 Freitag“, ' +
      '„Mathe SA 12.11.“, „was steht an?“ oder „Latein HÜ erledigt“ verstehe ich trotzdem.');
  }
}
