// Stellas "Gehirn": erst schnelle Regeln (offline-fähig, kostenlos), dann die KI mit Werkzeugen.

import {
  addDays, formatDateDe, interpret, nextSchoolDay, parseEntry, splitTopics, timeIn, todayIn, WEEKDAYS_DE, weekdayOf,
  type Attachment, type ChatMessage, type ChatResponse, type Item, type ItemKind, type ParsedEntry,
} from '@stella/shared';
import {
  addAttachment, addMessage, clearPending, db, enqueueJob, findMessageByClientId, getItem, getPending, listItems,
  recentMessages, setPending, type User,
} from './db.ts';
import { PROVIDERS } from './books.ts';
import { SOLUTION_CAPTION } from './homework.ts';
import { lessonsFor } from './untis.ts';
import { complete, LlmUnavailable, llmAvailable, type LlmMessage, type ToolDef } from './llm.ts';
import { addItem, addParsedEntry, bookFor, changeItem, createStudyPlan } from './planner.ts';

interface Turn {
  user: User;
  today: string;
  replies: ChatMessage[];
  changed: Map<string, Item>;
  /** Fotos, die mit der Nachricht kamen (z. B. Arbeitsblatt) */
  images: Attachment[];
}

const say = (t: Turn, text: string, attachments: ChatMessage['attachments'] = []) =>
  t.replies.push(addMessage(t.user.id, 'assistant', text, { attachments }));
/** Satzende ohne doppelten Punkt nach "Freitag, 30.10." */
const dot = (s: string) => (s.endsWith('.') ? s : `${s}.`);
const touched = (t: Turn, ...items: (Item | null)[]) => items.forEach((i) => i && t.changed.set(i.id, i));

export async function handleChat(user: User, text: string, clientId: string | null, imageIds: string[] = []): Promise<ChatResponse> {
  if (clientId && findMessageByClientId(user.id, clientId)) return { messages: [], items: [] }; // schon verarbeitet
  const images: Attachment[] = imageIds.map((id) => ({ id, kind: 'image', caption: 'Foto' }));
  const userMessage = addMessage(user.id, 'user', text, { clientId, attachments: images });

  const t: Turn = { user, today: todayIn(user.timeZone), replies: [], changed: new Map(), images };
  const intent = interpret(text, t.today);
  const pending = getPending(user.id);

  let handled = false;
  if (pending && intent?.type !== 'create') handled = await answerPending(t, pending, text);
  if (pending && !handled) clearPending(user.id);

  if (!handled && images.length && intent?.type !== 'create') handled = attachPhotoToRecentHomework(t);

  if (!handled) {
    switch (intent?.type) {
      case 'create': await onCreate(t, intent.entry); break;
      case 'done': onDone(t, intent.subject, intent.kind); break;
      case 'agenda': say(t, agendaText(user, t.today, intent.days)); break;
      default: await runAgent(t);
    }
  }
  return { messages: t.replies, items: [...t.changed.values()], userMessage };
}

const autopilot = (u: User) => u.settings.homeworkAutopilot !== false;

/** Foto der Aufgabe an eine HÜ hängen und (Autopilot) lösen lassen. */
function attachPhotos(t: Turn, item: Item) {
  for (const img of t.images) addAttachment(t.user.id, item.id, { ...img, caption: `${item.subject ?? ''} Aufgabe`.trim() });
  touched(t, getItem(t.user.id, item.id));
  if (autopilot(t.user)) enqueueJob(t.user.id, 'solve_homework', { itemId: item.id });
}

/** Foto ohne Text: gehört wohl zur gerade eingetragenen HÜ. */
function attachPhotoToRecentHomework(t: Turn): boolean {
  const recent = db.prepare(`SELECT id FROM items WHERE user_id = ? AND kind = 'homework' AND status = 'open' AND deleted = 0
    AND created_at > ? ORDER BY created_at DESC LIMIT 1`).get(t.user.id, new Date(Date.now() - 30 * 60_000).toISOString()) as { id: string } | undefined;
  const item = recent && getItem(t.user.id, recent.id);
  if (!item) {
    say(t, '📸 Zu welcher HÜ gehört das Foto? Schick es nochmal mit z. B. „Mathe HÜ AB Nr. 3 Freitag“.');
    return true;
  }
  attachPhotos(t, item);
  say(t, autopilot(t.user)
    ? `📸 Hab das Foto zu **${item.title}** gelegt – ich lös das und schreib's dir ins Heft. ✍️`
    : `📸 Hab das Foto zu **${item.title}** gelegt.`);
  return true;
}

// ---------- Schnelle Wege ----------

async function onCreate(t: Turn, e: ParsedEntry) {
  if (e.kind === 'exam' && !e.due) {
    const item = addParsedEntry(t.user, e);
    touched(t, item);
    setPending(t.user.id, 'due_date', item.id);
    say(t, `📅 ${item.title} notiert – wann ist der Termin?`);
    return;
  }
  const item = addParsedEntry(t.user, e);
  touched(t, item);
  const when = formatDateDe(item.due!, t.today);
  const evening = t.user.settings.eveningTime ?? '19:00';

  if (item.kind === 'homework') {
    const remindDay = addDays(item.due!, -1);
    const parts = [dot(`✅ Notiert: **${item.title}**${item.detail ? ` – ${item.detail}` : ''}, fällig ${when}`)];
    if (remindDay >= t.today) parts.push(`Ich erinnere dich ${formatDateDe(remindDay, t.today)} um ${evening}.`);
    const book = bookFor(t.user, item.subject);
    if (t.images.length) {
      attachPhotos(t, item);
      if (autopilot(t.user)) parts.push('Ich lös die Aufgabe vom Foto und schreib sie dir ins Heft. ✍️');
    } else if (book && item.page) {
      parts.push(autopilot(t.user)
        ? `Ich hol mir die Seite aus ${PROVIDERS[book.provider].name}, lös die Aufgabe und schreib sie dir ins Heft. ✍️`
        : `Ich hol mir die Seite aus ${PROVIDERS[book.provider].name} und schick dir das Bild mit. 📸`);
    }
    if (e.dueAssumed) {
      const fromTimetable = item.due !== nextSchoolDay(t.today);
      parts.push(fromTimetable
        ? `_(Kein Datum dabei – ich hab die nächste ${item.subject}-Stunde laut WebUntis genommen.)_`
        : `_(Kein Datum erkannt – ich hab den nächsten Schultag genommen. Schreib z. B. „${item.subject ?? ''} HÜ bis Freitag“, wenn's anders ist.)_`);
    }
    say(t, parts.join(' '));
    return;
  }

  if (item.kind === 'exam') {
    say(t, `📅 Eingetragen: **${item.title}** am ${dot(formatDateDe(item.due!))} Ich erinnere dich eine Woche und einen Tag vorher.`);
    if (item.material) {
      await makePlan(t, item.id, item.material);
    } else {
      setPending(t.user.id, 'exam_material', item.id);
      say(t, `Welcher Stoff kommt dran? Dann bau ich dir einen Lernplan. (Oder schreib „weiß noch nicht“.)`);
    }
    return;
  }

  say(t, dot(`✅ Notiert: **${item.title}**${item.detail ? ` – ${item.detail}` : ''}, ${when}`));
}

function onDone(t: Turn, subject: string | null, kind: ItemKind | null) {
  const candidates = listItems(t.user.id, { from: addDays(t.today, -14) })
    .filter((i) => i.kind !== 'study' && (!subject || i.subject === subject) && (!kind || i.kind === kind));
  const item = candidates[0];
  if (!item) { say(t, 'Hmm, dazu finde ich nichts Offenes. 🤔'); return; }
  touched(t, changeItem(t.user, item.id, { status: 'done' }));
  const left = listItems(t.user.id, { from: t.today, to: addDays(t.today, 1) }).filter((i) => i.kind === 'homework').length;
  say(t, `Stark! **${item.title}** ist abgehakt ✅${left ? ` Für morgen ist noch ${left} HÜ offen.` : ''}`);
}

export function agendaText(user: User, today: string, days: number): string {
  const items = listItems(user.id, { from: today, to: addDays(today, days) });
  if (!items.length) return `Nichts offen in den nächsten ${days} Tagen. 🎉`;
  const byDay = new Map<string, Item[]>();
  for (const i of items) byDay.set(i.due ?? 'ohne Datum', [...(byDay.get(i.due ?? 'ohne Datum') ?? []), i]);
  const icon: Record<string, string> = { homework: '📚', exam: '📝', assignment: '📌', event: '📅', todo: '☑️', study: '🧠' };
  return [...byDay].map(([day, list]) =>
    `**${day === 'ohne Datum' ? day : formatDateDe(day, today)}**\n` +
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
    say(t, `👍 ${item.title} am ${formatDateDe(due)} – eingetragen!`);
    if (item.kind === 'exam' && !item.material) {
      setPending(t.user.id, 'exam_material', item.id);
      say(t, 'Welcher Stoff kommt dran? Dann bau ich dir einen Lernplan.');
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
    ], undefined, { json: true });
    const parsed = JSON.parse((message.content ?? '').replace(/^```(json)?|```$/g, '')) as { sessions?: unknown };
    const list = Array.isArray(parsed.sessions) ? parsed.sessions.map(String) : [];
    return list.length === dates.length ? list : null;
  } catch {
    return null;
  }
}

// ---------- KI-Agent ----------

const KINDS = ['homework', 'exam', 'assignment', 'event', 'todo', 'study'];

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_entry',
      description: 'Legt einen Eintrag im Planer an (HÜ, Test/Schularbeit, Abgabe, Termin, To-do). Erinnerungen werden automatisch geplant.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS, description: 'homework=Hausübung, exam=Test/Schularbeit/Prüfung, assignment=Referat/Abgabe, event=Termin, todo=Aufgabe' },
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
];

function systemPrompt(user: User, today: string): string {
  const upcoming = listItems(user.id, { from: today, to: addDays(today, 21) })
    .filter((i) => i.kind !== 'study')
    .map((i) => `- [${i.id}] ${i.due} ${i.title}${i.detail ? ` (${i.detail})` : ''}`).join('\n') || '(nichts)';
  return `Du bist Stella, der persönliche Assistent von ${user.name}. Motto: "Let Stella handle your life."
${user.name} geht in Österreich zur Schule. Du hilfst vor allem bei Organisation: HÜs, Tests, Schularbeiten, Termine, Lernen, Gesundheit.

Heute ist ${WEEKDAYS_DE[weekdayOf(today)]}, ${today}, ${timeIn(user.timeZone)} Uhr (${user.timeZone}).

Regeln:
- Antworte auf Deutsch, locker, kurz (wie eine Chat-Nachricht), gern mit passenden Emojis.
- Nutze die Werkzeuge, um Einträge anzulegen/zu ändern, statt nur darüber zu reden. Rechne Daten selbst aus (YYYY-MM-DD).
- Erfinde keine Termine oder Fakten über ${user.name}. Frag nach, wenn etwas Wichtiges fehlt.
- Bei Tests/Schularbeiten: nach dem Stoff fragen und dann create_study_plan nutzen.
- Hausübungen erledigst du für ${user.name} (solve_homework): Stella löst sie und schreibt sie in Handschrift ins Heft.
- Du kennst Stundenplan (timetable), E-Mails & Social-Media-Benachrichtigungen (recent_inbox) und Gesundheitsdaten.

Anstehende Einträge (nächste 3 Wochen):
${upcoming}`;
}

async function runTool(t: Turn, name: string, args: Record<string, any>): Promise<unknown> {
  const u = t.user;
  switch (name) {
    case 'create_entry': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.due ?? '')) return { error: 'due muss YYYY-MM-DD sein' };
      const item = addItem(u, {
        kind: KINDS.includes(args.kind) ? args.kind : 'todo', title: String(args.title), subject: args.subject ?? null,
        detail: args.detail ?? null, due: args.due, time: args.time ?? null, material: args.material ?? null, source: 'ai',
      });
      touched(t, item);
      return { ok: true, id: item.id };
    }
    case 'list_entries':
      return listItems(u.id, { from: args.from ?? t.today, to: args.to, kind: args.kind, includeDone: args.include_done })
        .slice(0, 40).map(({ id, kind, title, detail, due, time, status, material }) => ({ id, kind, title, detail, due, time, status, material }));
    case 'update_entry': {
      const { id, ...patch } = args;
      const item = changeItem(u, String(id), patch);
      touched(t, item);
      return item ? { ok: true } : { error: 'nicht gefunden' };
    }
    case 'create_study_plan': {
      const exam = changeItem(u, String(args.exam_id), { material: String(args.material) });
      if (!exam) return { error: 'Test nicht gefunden' };
      const sessions = createStudyPlan(u, exam.id);
      touched(t, exam, ...sessions);
      return { sessions: sessions.map((s) => ({ date: s.due, focus: s.detail })) };
    }
    case 'solve_homework': {
      let item = getItem(u.id, String(args.entry_id));
      if (!item) return { error: 'nicht gefunden' };
      if (args.again) {
        // alte Lösung entfernen, damit neu gelöst (und erneut ins Heft geschrieben) wird
        db.prepare('DELETE FROM notes_deliveries WHERE user_id = ? AND item_id = ?').run(u.id, item.id);
        item = changeItem(u, item.id, {
          status: 'open', notes: null, attachments: item.attachments.filter((a) => !a.caption?.startsWith(SOLUTION_CAPTION)),
        })!;
        touched(t, item);
      }
      if (!item.attachments.length && !(item.page && bookFor(u, item.subject))) return { error: 'Kein Foto und kein Buch hinterlegt – Nutzer soll ein Foto schicken.' };
      enqueueJob(u.id, item.attachments.length ? 'solve_homework' : 'book_page', { itemId: item.id });
      return { ok: true, info: 'Wird im Hintergrund gelöst, Nutzer bekommt eine Nachricht.' };
    }
    case 'timetable':
      return lessonsFor(u.id, args.from ?? t.today, args.to ?? addDays(t.today, 1));
    case 'health_summary': {
      const days = Math.min(Number(args.days ?? 7), 60);
      return db.prepare('SELECT date, steps, sleep_hours, active_minutes FROM health_days WHERE user_id = ? AND date >= ? ORDER BY date')
        .all(u.id, addDays(t.today, -days));
    }
    case 'recent_inbox':
      return db.prepare(`SELECT source, sender, text, json_extract(payload, '$.summary') AS summary, created_at FROM inbox_events WHERE user_id = ? ${args.source ? 'AND source = ?' : ''}
        ORDER BY created_at DESC LIMIT ?`).all(...[u.id, ...(args.source ? [args.source] : []), Math.min(Number(args.limit ?? 10), 50)]);
    default:
      return { error: `Unbekanntes Werkzeug ${name}` };
  }
}

async function runAgent(t: Turn) {
  const history = recentMessages(t.user.id, 16);
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(t.user, t.today) },
    ...history.map((m) => ({ role: m.role, content: m.text }) as LlmMessage),
  ];
  try {
    for (let step = 0; step < 6; step++) {
      const { message } = await complete(messages, TOOLS);
      messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });
      if (!message.tool_calls?.length) {
        say(t, message.content?.trim() || '🤔');
        return;
      }
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leer lassen */ }
        const result = await runTool(t, call.function.name, args).catch((err: Error) => ({ error: err.message }));
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    say(t, 'Das war mir gerade zu kompliziert – versuch es bitte nochmal etwas anders. 🙈');
  } catch (err) {
    if (!(err instanceof LlmUnavailable)) throw err;
    console.warn(err.message);
    say(t, '📴 Ich erreiche gerade kein KI-Modell. Kurznotizen wie „Latein HÜ S. 45 Nr. 3 Freitag“, ' +
      '„Mathe SA 12.11.“, „was steht an?“ oder „Latein HÜ erledigt“ verstehe ich trotzdem.');
  }
}
