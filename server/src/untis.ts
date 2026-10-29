// WebUntis: Stundenplan, Entfall, Hausübungen und Tests/Schularbeiten automatisch übernehmen.
//
// Zwei Login-Wege:
//  • Benutzername + Passwort (wenn du dich bei WebUntis direkt anmeldest)
//  • "Geheimer Schlüssel" – für Schulen mit Microsoft-/Office-Login: in WebUntis unter
//    Profil → Freigaben → "Zugriff über Untis Mobile" → QR-Code. Dessen Inhalt
//    (untis://setschool?...) in Stella einfügen.

import { addDays, normalizeSubject, todayIn, type Ymd } from '@stella/shared';
import { getSecret } from './auth.ts';
import {
  addMessage, db, getItemByExternalId, getUser, notifyOnce, type User,
} from './db.ts';
import { addItem, changeItem } from './planner.ts';
import { pushToUser } from './push.ts';

export interface UntisCredentials {
  server?: string;
  school?: string;
  username?: string;
  password?: string;
  /** Inhalt des QR-Codes aus WebUntis (untis://setschool?url=…&school=…&user=…&key=…) */
  qr?: string;
}

const untisDate = (n: number): Ymd => {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};
const untisTime = (n: number) => `${String(Math.floor(n / 100)).padStart(2, '0')}:${String(n % 100).padStart(2, '0')}`;
const toDate = (ymd: Ymd) => new Date(`${ymd}T12:00:00Z`);

export function parseQr(qr: string): Required<Pick<UntisCredentials, 'server' | 'school' | 'username'>> & { key: string } {
  const u = new URL(qr.trim().replace(/^untis:\/\//, 'https://untis/'));
  const get = (k: string) => u.searchParams.get(k) ?? '';
  const result = { server: get('url'), school: get('school'), username: get('user'), key: get('key') };
  if (!result.server || !result.school || !result.username || !result.key) throw new Error('QR-Code-Inhalt unvollständig.');
  return result;
}

async function connect(creds: UntisCredentials) {
  const lib = await import('webuntis');
  if (creds.qr) {
    const { authenticator } = await import('otplib');
    const q = parseQr(creds.qr);
    const client = new lib.WebUntisSecretAuth(q.school, q.username, q.key, q.server.replace(/^https?:\/\//, ''), 'Stella', authenticator);
    await client.login();
    return client;
  }
  if (!creds.server || !creds.school || !creds.username || !creds.password) throw new Error('WebUntis-Zugangsdaten unvollständig.');
  const client = new lib.WebUntis(creds.school, creds.username, creds.password, creds.server.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), 'Stella');
  await client.login();
  return client;
}

type Client = Awaited<ReturnType<typeof connect>>;

export async function testUntis(creds: UntisCredentials) {
  const client = await connect(creds);
  await client.logout().catch(() => {});
}

function storeLessons(userId: string, from: Ymd, to: Ymd, lessons: Awaited<ReturnType<Client['getOwnTimetableForRange']>>) {
  db.transaction(() => {
    db.prepare('DELETE FROM lessons WHERE user_id = ? AND date BETWEEN ? AND ?').run(userId, from, to);
    const insert = db.prepare('INSERT INTO lessons (user_id, date, start, end, subject, subject_code, status, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const l of lessons) {
      const su = l.su?.[0];
      insert.run(userId, untisDate(l.date), untisTime(l.startTime), untisTime(l.endTime),
        normalizeSubject(su?.longname || su?.name), su?.name ?? null,
        l.code === 'cancelled' ? 'cancelled' : l.code === 'irregular' ? 'irregular' : 'normal',
        [l.substText, l.info, l.lstext].filter(Boolean).join(' · ') || null);
    }
  })();
}

/** Nächste Stunde in diesem Fach nach `after` (für "Latein HÜ" ohne Datum). */
export function nextLessonDate(userId: string, subject: string, after: Ymd): Ymd | null {
  const row = db.prepare(`SELECT date FROM lessons WHERE user_id = ? AND subject = ? AND date > ? AND status != 'cancelled'
    ORDER BY date, start LIMIT 1`).get(userId, subject, after) as { date: string } | undefined;
  return row?.date ?? null;
}

export function lessonsFor(userId: string, from: Ymd, to: Ymd) {
  return db.prepare('SELECT date, start, end, subject, subject_code AS code, status, info FROM lessons WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start')
    .all(userId, from, to) as { date: string; start: string; end: string; subject: string | null; code: string | null; status: string; info: string | null }[];
}

async function say(user: User, text: string, key: string) {
  if (!notifyOnce(user.id, key)) return;
  addMessage(user.id, 'assistant', text);
  await pushToUser(user.id, { title: 'Stella', body: text.replace(/\*\*/g, ''), tag: key });
}

export async function syncUntis(userId: string) {
  const user = getUser(userId);
  const creds = getSecret<UntisCredentials>(userId, 'webuntis');
  if (!user || !creds) return;
  const today = todayIn(user.timeZone);
  const from = addDays(today, -7);
  const to = addDays(today, 21);
  const client = await connect(creds);
  try {
    storeLessons(userId, today, to, await client.getOwnTimetableForRange(toDate(today), toDate(to)));

    // Hausübungen, die Lehrer:innen in WebUntis eintragen
    const hw = await client.getHomeWorksFor(toDate(from), toDate(to)) as unknown as {
      homeworks: { id: number; lessonId: number; dueDate: number; text: string; completed: boolean }[];
      lessons: { id: number; subject: string }[];
    };
    for (const h of hw.homeworks ?? []) {
      const subject = normalizeSubject(hw.lessons?.find((l) => l.id === h.lessonId)?.subject);
      const externalId = `untis-hw-${h.id}`;
      const due = untisDate(h.dueDate);
      const existing = getItemByExternalId(userId, externalId);
      if (existing) continue;
      if (due < today) continue;
      const item = addItem(user, {
        kind: 'homework', subject, title: `${subject ?? ''} HÜ`.trim(), detail: h.text?.trim() || null,
        due, source: 'webuntis', externalId,
      });
      await say(user, `📚 Neue HÜ aus WebUntis: **${item.title}** – ${item.detail ?? ''} (bis ${due.slice(8)}.${due.slice(5, 7)}.)`, externalId);
    }

    // Tests & Schularbeiten
    const exams = await client.getExamsForRange(toDate(today), toDate(addDays(today, 60))).catch(() => []);
    for (const e of exams) {
      const externalId = `untis-exam-${e.id}`;
      const due = untisDate(e.examDate);
      const subject = normalizeSubject(e.subject);
      const existing = getItemByExternalId(userId, externalId);
      if (existing) {
        if (existing.due !== due) changeItem(user, existing.id, { due });
        continue;
      }
      const label = /schul|sa\b/i.test(e.examType ?? '') ? 'Schularbeit' : e.examType || e.name || 'Test';
      const item = addItem(user, {
        kind: 'exam', subject, title: `${subject ?? ''} ${label}`.trim(), due, time: untisTime(e.startTime),
        material: e.text?.trim() || null, source: 'webuntis', externalId,
      });
      await say(user, `📝 In WebUntis steht: **${item.title}** am ${due.slice(8)}.${due.slice(5, 7)}.` +
        (item.material ? ` Stoff: ${item.material}. Schreib „Lernplan ${subject ?? ''}“, dann plane ich dir das Lernen.` : ' Schreib mir den Stoff, dann mach ich einen Lernplan.'), externalId);
    }

    // Entfall morgen
    const tomorrow = addDays(today, 1);
    for (const l of lessonsFor(userId, tomorrow, tomorrow).filter((l) => l.status === 'cancelled')) {
      await say(user, `🎉 Morgen entfällt **${l.subject ?? l.code}** (${l.start}).`, `untis-cancel-${tomorrow}-${l.start}-${l.code}`);
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
