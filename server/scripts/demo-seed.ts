// Beispieldaten für die iOS-Klick-Vorschau (CI): ein Schüler mit Stundenplan, Tests, HÜs,
// Mails, Gedächtnis und Chat – alles über Stellas echte Logik angelegt, damit die Screens so
// aussehen wie im Alltag. Gibt am Ende nur den Login-Token aus.
//
//   STELLA_DATA_DIR=/tmp/demo STELLA_SECRET=… npx tsx server/scripts/demo-seed.ts > token.txt
//
// Mit DEMO_EMAIL / DEMO_PASSWORD / DEMO_NAME auch als Testkonto auf einem echten Server
// (das Passwort darf dann kürzer sein als bei der normalen Registrierung).

process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
const EMAIL = process.env.DEMO_EMAIL || 'demo@stella.local';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo-passwort-123';
const NAME = process.env.DEMO_NAME || 'Lukas';

const { hashPassword, register } = await import('../src/auth.ts');
const { addMessage, createConversation, db, getUser, newId, updateUserSettings } = await import('../src/db.ts');
const { addItem } = await import('../src/planner.ts');
const { addMemory } = await import('../src/memory.ts');
const { handleChat } = await import('../src/assistant.ts');
const { perform } = await import('../src/actions.ts');
const { buildWeekPlan } = await import('../src/weekplan.ts');
const { isoWeekday } = await import('../src/context.ts');
const { addDays, todayIn } = await import('@stella/shared');

const TZ = 'Europe/Vienna';
const { user: created, token } = register(NAME, EMAIL, PASSWORD.length >= 8 ? PASSWORD : 'vorlaeufig-12345678', TZ, 'iPhone');
const uid = created.id;
if (PASSWORD.length < 8) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(PASSWORD), uid);
const user = () => getUser(uid)!;
const today = todayIn(TZ);
updateUserSettings(uid, { tone: 'nett', studyTime: '16:30', eveningTime: '19:00', stepGoal: 8000 });

// Stundenplan: diese und nächste Woche, morgen fällt Physik aus
const PLAN: [string, string, string][][] = [
  [['07:55', '08:45', 'Mathe'], ['08:50', '09:40', 'Deutsch'], ['09:55', '10:45', 'Englisch'], ['10:50', '11:40', 'Biologie'], ['11:45', '12:35', 'Geschichte']],
  [['07:55', '08:45', 'Englisch'], ['08:50', '09:40', 'Physik'], ['09:55', '10:45', 'Mathe'], ['10:50', '11:40', 'Latein'], ['11:45', '12:35', 'Sport'], ['12:40', '13:30', 'Sport']],
  [['07:55', '08:45', 'Deutsch'], ['08:50', '09:40', 'Mathe'], ['09:55', '10:45', 'Chemie'], ['10:50', '11:40', 'Englisch']],
  [['07:55', '08:45', 'Latein'], ['08:50', '09:40', 'Biologie'], ['09:55', '10:45', 'Physik'], ['10:50', '11:40', 'Deutsch'], ['11:45', '12:35', 'Mathe']],
  [['07:55', '08:45', 'Geschichte'], ['08:50', '09:40', 'Englisch'], ['09:55', '10:45', 'Mathe'], ['10:50', '11:40', 'Musik']],
];
const lesson = db.prepare('INSERT INTO lessons (user_id, date, start, end, subject, subject_code, status, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
for (let d = -1; d < 14; d++) {
  const date = addDays(today, d);
  const day = PLAN[isoWeekday(date) - 1];
  if (!day) continue;
  for (const [start, end, subject] of day) {
    const off = d === 1 && subject === 'Physik';
    lesson.run(uid, date, start, end, subject, subject.slice(0, 2).toUpperCase(), off ? 'cancelled' : 'normal', off ? 'Lehrer krank' : null);
  }
}

// Gedächtnis
const mem = (category: 'person' | 'routine' | 'preference' | 'school' | 'goal', text: string, schedule?: { days: number[]; start: string; end: string }) =>
  addMemory(uid, { category, text, source: 'learned', schedule });
mem('routine', 'Fußballtraining', { days: [2, 4], start: '17:30', end: '19:00' });
mem('person', 'Frau Huber ist die Klassenvorständin');
mem('person', 'Mama heißt Sabine');
mem('preference', 'lernt am liebsten am Nachmittag, nicht nach dem Training');
mem('school', 'geht in die 6B am BG Klosterneuburg');
mem('goal', 'will in Mathe auf einen Zweier kommen');

// Einträge
const mathe = addItem(user(), { kind: 'exam', title: 'Mathe Schularbeit', subject: 'Mathe', due: addDays(today, 5), material: 'Ableitungen, Kurvendiskussion, Extremwertaufgaben' });
addItem(user(), { kind: 'exam', title: 'Bio Test', subject: 'Biologie', due: addDays(today, 9), material: 'Zellteilung, Mitose, Meiose' });
addItem(user(), { kind: 'homework', title: 'Englisch HÜ', subject: 'Englisch', due: addDays(today, 2), detail: 'Workbook S. 34, Nr. 2–5' });
addItem(user(), { kind: 'homework', title: 'Physik HÜ', subject: 'Physik', due: addDays(today, 1), detail: 'Arbeitsblatt Kräfte' });
addItem(user(), { kind: 'assignment', title: 'Geschichte Referat', subject: 'Geschichte', due: addDays(today, 6), detail: 'Industrielle Revolution, 10 min' });
const done = addItem(user(), { kind: 'homework', title: 'Latein HÜ', subject: 'Latein', due: today, detail: 'Lektion 12 übersetzen' });
db.prepare(`UPDATE items SET status = 'done' WHERE id = ?`).run(done.id);
addItem(user(), { kind: 'event', title: 'Zahnarzt', due: addDays(today, 3), time: '15:00' });

// Lernplan für Mathe schon übernommen – der Rest bleibt für „Woche planen“
const plan = buildWeekPlan(user(), { from: today });
const matheBlocks = plan.blocks.filter((b) => b.parentId === mathe.id);
if (matheBlocks.length) perform(user(), 'week_plan.apply', { blocks: matheBlocks }, { source: 'chat', quiet: true });

// Chat über die echten Wege (ohne KI)
addMessage(uid, 'assistant', `☀️ Guten Morgen, ${NAME}! Heute hast du bis 12:35 Schule, um 16:30 lernst du Mathe (Ableitungen). Morgen fällt Physik aus. 💫`);
await handleChat(user(), 'Deutsch HÜ bis morgen Erörterung S. 45', null);
await handleChat(user(), 'erinnere mich in 2 Stunden an Mama anrufen', null);
await handleChat(user(), 'merk dir, dass ich am Freitag nach der Schule zu Oma fahre', null);
await handleChat(user(), 'plan meine Woche', null);
// über den Vormittag verteilen, Reihenfolge bleibt (das Briefing zuerst)
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const rows = db.prepare('SELECT id FROM messages WHERE user_id = ? ORDER BY created_at, rowid').all(uid) as { id: string }[];
rows.forEach((r, i) => db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(ago(i === 0 ? 240 : (rows.length - i) * 3), r.id));

// ein älterer Chat mit Titel (Verlauf: „Chats“)
const twoDaysAgo = (min: number) => new Date(Date.now() - 2 * 86_400_000 + min * 60_000).toISOString();
const oldChat = createConversation(uid, addDays(today, -2), twoDaysAgo(0));
addMessage(uid, 'user', 'Wie lerne ich am besten Vokabeln?', { conversationId: oldChat, createdAt: twoDaysAgo(0) });
addMessage(uid, 'assistant', 'Kurze Einheiten, dafür oft:\n- **10 Minuten** am Tag\n- laut sprechen\n- am Abend **einmal wiederholen**', { conversationId: oldChat, createdAt: twoDaysAgo(1) });
addMessage(uid, 'user', 'Und wie merke ich mir die Artikel?', { conversationId: oldChat, createdAt: twoDaysAgo(3) });
addMessage(uid, 'assistant', 'Immer **mit Artikel** lernen: „das Haus“ statt nur „Haus“.', { conversationId: oldChat, createdAt: twoDaysAgo(4) });
db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run('Vokabeln lernen', oldChat);

// Inbox
const inbox = (source: string, sender: string, text: string, payload: Record<string, unknown>, hoursAgo: number) =>
  db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), uid, source, sender, text, JSON.stringify(payload), new Date(Date.now() - hoursAgo * 3600_000).toISOString());
const mail = { accountId: 'demo', account: 'Schule', fromAddress: 'post@schule.at', snippet: 'Liebe Eltern, liebe Schülerinnen und Schüler,\n\nbitte denkt daran, die Einverständniserklärung bis Freitag abzugeben.\n\nLiebe Grüße\nFrau Huber' };
inbox('email', 'Frau Huber', 'Wandertag Freitag', { ...mail, category: 'important', summary: 'Wandertag: Einverständniserklärung bis Freitag abgeben', reason: 'Klassenvorstand', deadline: { date: addDays(today, 4), time: null, what: 'Einverständnis abgeben' }, needsReply: false }, 3);
inbox('email', 'Herr Gruber', 'Referat Termin', { ...mail, category: 'important', summary: 'Fragt, ob du dein Referat schon am Montag halten kannst', reason: 'Lehrer fragt dich direkt', needsReply: true }, 20);
inbox('social', 'Instagram', 'lena.mayer hat deinen Beitrag kommentiert', { platform: 'Instagram', summary: 'lena.mayer: „Bin dabei!! 🔥“' }, 1);
inbox('sms', 'Mama', 'Holst du Milch auf dem Heimweg?', { summary: 'Holst du Milch auf dem Heimweg?' }, 2);
inbox('email', 'Zalando', 'Nur heute: −30 % auf alles', { ...mail, account: 'Privat', category: 'spam', action: 'trash', summary: 'Werbung' }, 5);
inbox('email', 'Elternverein', 'Herbstfest', { ...mail, category: 'normal', summary: 'Einladung zum Herbstfest am Samstag' }, 30);
inbox('email', 'Lernhilfe Newsletter', 'Neue Übungen für November', { ...mail, account: 'Privat', category: 'newsletter', summary: 'Neue Übungsblätter für Mathe und Englisch' }, 26);
inbox('email', 'Bestellung #4411', 'Dein Paket ist unterwegs', { ...mail, account: 'Privat', category: 'normal', summary: 'Versandbestätigung: Ankunft Donnerstag' }, 40);

// Schritte der letzten Woche
const steps = [6400, 9100, 7300, 11200, 5200, 8800, 4300];
for (let d = 0; d < 7; d++) {
  db.prepare('INSERT INTO health_days (user_id, date, steps, sleep_hours, active_minutes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, addDays(today, -6 + d), steps[d], 7.5, 40, new Date().toISOString());
}

process.stdout.write(token);
