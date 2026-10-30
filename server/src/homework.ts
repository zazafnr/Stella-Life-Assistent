// HÜ-Autopilot: Aufgabe vom Buchseiten-Foto lesen, lösen und "per Hand" ins Heft schreiben.
// Danach ist die HÜ erledigt – am Vorabend kommt nur noch: "✅ Latein HÜ erledigt".

import { readFileSync } from 'node:fs';
import { addDays, DEFAULT_PREFS, formatDateDe, WEEKDAYS_DE, weekdayOf, zonedToUtc, voice, type Attachment, type Item } from '@stella/shared';
import { addAttachment, addMessage, addReminder, enqueueJob, getItem, getUser, type User } from './db.ts';
import { renderHandwriting } from './handwriting.ts';
import { complete, type ContentPart } from './llm.ts';
import { changeItem } from './planner.ts';
import { pushToUser } from './push.ts';
import { filePath, saveFile } from './files.ts';
import { usesFreeNotes } from './notes.ts';

export const SOLUTION_CAPTION = 'Lösung';

interface Solution {
  found: boolean;
  needsNextPage?: boolean;
  /** Heft-Text im FreeNotes-Format: __unterstrichen__, ==doppelt unterstrichen== */
  heftText: string;
}

function parseJson(text: string): Solution | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Solution>;
    const heftText = cleanHeftText(String(raw.heftText ?? ''));
    return { found: !!raw.found && heftText.length > 0, needsNextPage: !!raw.needsNextPage, heftText };
  } catch {
    return null;
  }
}

/** Markdown-Reste entfernen, Leerzeilen zusammenfassen (wie FreeNotes' cleanNotebookText). */
export function cleanHeftText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/```\w*/g, '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[*•]\s+/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pageImages(item: Item): Attachment[] {
  return item.attachments.filter((a) => a.kind === 'image' && !a.caption?.startsWith(SOLUTION_CAPTION));
}

function header(item: Item): string {
  const parts = [item.page && `S. ${item.page}`, item.exercises && `Nr. ${item.exercises}`].filter(Boolean);
  return parts.length ? `__${parts.join(' ')}__` : `__${item.title}__`;
}

async function askModel(item: Item, images: Attachment[]): Promise<Solution | null> {
  const parts: ContentPart[] = [{
    type: 'text',
    text: `Fach: ${item.subject ?? 'unbekannt'}
${item.page ? `Buchseite: ${item.page}\n` : ''}Zu lösen: ${item.exercises ? `Aufgabe(n) Nr. ${item.exercises}` : item.detail ?? 'alle Aufgaben auf dem Bild'}

Löse die genannte(n) Aufgabe(n) vom Bild vollständig und richtig und schreib die Lösung so, wie ein sehr guter Schüler sie ordentlich ins Schulheft schreibt. Der Text wird danach Buchstabe für Buchstabe in seiner Handschrift ins Heft geschrieben.

Regeln für "heftText":
- Erste Zeile genau: ${header(item)} – danach eine Leerzeile.
- Nur reiner Text: kein Markdown (keine **, #, * oder •), kein LaTeX, keine Emojis, keine Erklärungen an den Schüler.
- Sprache wie in der Aufgabe (Französisch-Übung → Französisch, Latein-Übersetzung → Deutsch).
- Teilaufgaben untereinander mit "1)", "2)" bzw. "a)", "b)" am Zeilenanfang. Beispiel "0" ist schon vorgegeben → weglassen.
- Lücken/Satzbildung: den ganzen Satz schreiben. Zuordnungen: "1 – C".
- Mathe: pro Zeile ein Rechenschritt, Leerzeichen um = + − · :, Brüche 3/4, Potenzen x², Wurzel √(…). Endergebnis zwischen == und ==, z. B. ==x = 7==. Bei Textaufgaben zusätzlich "A: …".
- Jede Zeile höchstens etwa 45 Zeichen (lange Sätze umbrechen).

Antworte NUR mit JSON: {"found": true, "needsNextPage": false, "heftText": "…"}
Ist die Aufgabe nicht auf dem Bild: "found": false. Geht sie sichtbar auf der nächsten Seite weiter: "needsNextPage": true.`,
  }];
  for (const img of images) {
    const file = filePath(img.id);
    if (!file) continue;
    const mime = file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${readFileSync(file).toString('base64')}` } });
  }
  const { message } = await complete([
    { role: 'system', content: 'Du bist ein ausgezeichneter Schüler an einer österreichischen Schule. Du löst Hausübungen fehlerfrei.' },
    { role: 'user', content: parts },
  ], undefined, { vision: true, json: true, timeoutMs: 120_000, heavy: true });
  return parseJson(message.content ?? '');
}

function shortDate(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${WEEKDAYS_DE[weekdayOf(ymd)].slice(0, 2)}, ${d}.${m}.`;
}

export async function solveHomework(userId: string, itemId: string, attempt = 0) {
  const user = getUser(userId);
  const item = user && getItem(userId, itemId);
  if (!user || !item || item.deleted) return;
  if (item.attachments.some((a) => a.caption?.startsWith(SOLUTION_CAPTION))) return; // schon gelöst

  const images = pageImages(item);
  if (!images.length) throw new Error('Kein Bild der Aufgabe vorhanden.');

  const solution = await askModel(item, images);
  if (!solution?.found) {
    if (solution?.needsNextPage && item.page && attempt === 0 && images.length < 2) {
      enqueueJob(userId, 'book_page', { itemId, pageDelta: 1, thenSolveAttempt: 1 });
      return;
    }
    addMessage(userId, 'assistant', `🤔 Ich konnte **${item.title}**${item.exercises ? ` Nr. ${item.exercises}` : ''} auf der Seite nicht finden. ` +
      'Die HÜ bleibt offen – ich erinnere dich wie gewohnt. Schick mir sonst ein Foto der Aufgabe.');
    return;
  }

  const png = await renderHandwriting(userId, { date: item.due ? shortDate(item.due) : '', text: solution.heftText });
  const fileId = saveFile(png, 'png');
  const attachment: Attachment = { id: fileId, kind: 'image', caption: `${SOLUTION_CAPTION} ${item.title}` };
  addAttachment(userId, itemId, attachment);

  changeItem(user, itemId, { status: 'done', notes: solution.heftText });
  scheduleDoneNotice(user, item);

  const msg = voice(getUser(userId)?.settings.tone).solved(`${item.title}${item.detail ? ` (${item.detail})` : ''}`, usesFreeNotes(userId));
  addMessage(userId, 'assistant', msg, { attachments: [attachment] });
  await pushToUser(userId, { title: 'Stella', body: msg.replace(/\*\*/g, ''), tag: itemId });
}

/** Statt "Morgen fällig" am Vorabend nur kurz: erledigt. */
function scheduleDoneNotice(user: User, item: Item) {
  if (!item.due) return;
  const day = addDays(item.due, -1);
  const at = zonedToUtc(day, user.settings.eveningTime ?? DEFAULT_PREFS.eveningTime, user.timeZone);
  if (at.getTime() <= Date.now()) return;
  addReminder(user.id, item.id, at, voice(user.settings.tone).solvedReminder(item.title, formatDateDe(item.due)), false, true);
}
