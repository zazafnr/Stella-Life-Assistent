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
// DEMO_LANG=en: Beispieldaten auf Englisch (für die englische Website); Standard ist Deutsch
const EN = process.env.DEMO_LANG === 'en';
const t = (de: string, en: string) => (EN ? en : de);
const SUBJECT: Record<string, string> = { Mathe: 'Maths', Deutsch: 'English', Englisch: 'Spanish', Biologie: 'Biology', Geschichte: 'History', Physik: 'Physics', Latein: 'Latin', Sport: 'PE', Chemie: 'Chemistry', Musik: 'Music' };
const sub = (s: string) => (EN ? SUBJECT[s] ?? s : s);
const NAME = process.env.DEMO_NAME || (EN ? 'Alex' : 'Lukas');

const { hashPassword, register } = await import('../src/auth.ts');
const { addMessage, createConversation, db, getUser, newId, updateUserSettings } = await import('../src/db.ts');
const { addItem } = await import('../src/planner.ts');
const { addMemory } = await import('../src/memory.ts');
const { addListItems, shoppingListId } = await import('../src/lists.ts');
const goalsMod = await import('../src/goals.ts');
const finMod = await import('../src/finance.ts');
const { nextOccurrence } = await import('@stella/shared');
const { applyProfile } = await import('../src/profile.ts');
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
updateUserSettings(uid, { tone: 'nett', studyTime: '16:30', eveningTime: '19:00', stepGoal: 8000, ...(EN ? { locale: 'en', country: 'GB' } : {}) });

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
    lesson.run(uid, date, start, end, sub(subject), sub(subject).slice(0, 2).toUpperCase(), off ? 'cancelled' : 'normal', off ? t('Lehrer krank', 'Teacher sick') : null);
  }
}

// Gedächtnis
const mem = (category: 'person' | 'routine' | 'preference' | 'school' | 'goal', text: string, schedule?: { days: number[]; start: string; end: string }) =>
  addMemory(uid, { category, text, source: 'learned', schedule });
mem('routine', t('Fußballtraining', 'Football training'), { days: [2, 4], start: '17:30', end: '19:00' });
mem('person', t('Frau Huber ist die Klassenvorständin', 'Ms Huber is the form tutor'));
mem('person', t('Mama heißt Sabine', 'Mum is called Sabine'));
mem('preference', t('lernt am liebsten am Nachmittag, nicht nach dem Training', 'prefers studying in the afternoon, not after training'));
mem('school', t('geht in die 6B am BG Klosterneuburg', 'is in year 10B at Parkside School'));
mem('goal', t('will in Mathe auf einen Zweier kommen', 'wants to get a B in maths'));

// Einträge
const mathe = addItem(user(), { kind: 'exam', title: t('Mathe Schularbeit', 'Maths exam'), subject: sub('Mathe'), due: addDays(today, 5), material: t('Ableitungen, Kurvendiskussion, Extremwertaufgaben', 'Derivatives, curve sketching, optimisation problems') });
addItem(user(), { kind: 'exam', title: t('Bio Test', 'Biology test'), subject: sub('Biologie'), due: addDays(today, 9), material: t('Zellteilung, Mitose, Meiose', 'Cell division, mitosis, meiosis') });
addItem(user(), { kind: 'homework', title: t('Englisch HÜ', 'Spanish homework'), subject: sub('Englisch'), due: addDays(today, 2), detail: t('Workbook S. 34, Nr. 2–5', 'Workbook p. 34, ex. 2–5') });
addItem(user(), { kind: 'homework', title: t('Physik HÜ', 'Physics homework'), subject: sub('Physik'), due: addDays(today, 1), detail: t('Arbeitsblatt Kräfte', 'Forces worksheet') });
addItem(user(), { kind: 'assignment', title: t('Geschichte Referat', 'History presentation'), subject: sub('Geschichte'), due: addDays(today, 6), detail: t('Industrielle Revolution, 10 min', 'Industrial Revolution, 10 min') });
const done = addItem(user(), { kind: 'homework', title: t('Latein HÜ', 'Latin homework'), subject: sub('Latein'), due: today, detail: t('Lektion 12 übersetzen', 'Translate lesson 12') });
db.prepare(`UPDATE items SET status = 'done' WHERE id = ?`).run(done.id);
addItem(user(), { kind: 'event', title: t('Zahnarzt', 'Dentist'), due: addDays(today, 3), time: '15:00' });

// Lernplan für Mathe schon übernommen – der Rest bleibt für „Woche planen“
const plan = buildWeekPlan(user(), { from: today });
const matheBlocks = plan.blocks.filter((b) => b.parentId === mathe.id);
if (matheBlocks.length) perform(user(), 'week_plan.apply', { blocks: matheBlocks }, { source: 'chat', quiet: true });

// Chat über die echten Wege (ohne KI)
addMessage(uid, 'assistant', t(`☀️ Guten Morgen, ${NAME}! Heute hast du bis 12:35 Schule, um 16:30 lernst du Mathe (Ableitungen). Morgen fällt Physik aus. 💫`, `☀️ Good morning, ${NAME}! School until 12:35 today, and at 16:30 you study maths (derivatives). Physics is cancelled tomorrow. 💫`));
await handleChat(user(), t('Deutsch HÜ bis morgen Erörterung S. 45', 'English homework due tomorrow essay p. 45'), null);
await handleChat(user(), t('erinnere mich in 2 Stunden an Mama anrufen', 'remind me in 2 hours to call Mum'), null);
await handleChat(user(), t('merk dir, dass ich am Freitag nach der Schule zu Oma fahre', 'remember that I visit Grandma after school on Friday'), null);
await handleChat(user(), t('plan meine Woche', 'plan my week'), null);
// über den Vormittag verteilen, Reihenfolge bleibt (das Briefing zuerst)
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const rows = db.prepare('SELECT id FROM messages WHERE user_id = ? ORDER BY created_at, rowid').all(uid) as { id: string }[];
rows.forEach((r, i) => db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(ago(i === 0 ? 240 : (rows.length - i) * 3), r.id));

// Alle Funktionen an, damit Ziele und Ausgaben in der Vorschau zu sehen sind
applyProfile(user(), { situation: 'school', features: ['mails', 'planner', 'homework', 'shopping', 'goals', 'finance', 'health'] });

// Daueraufträge und eine einmalige Erinnerung („Was Stella vorhat“)
addItem(user(), { kind: 'reminder', title: t('Müll rausbringen', 'Take out the bins'), due: nextOccurrence('weekly:1', addDays(today, 1)), time: '07:45', recurrence: 'weekly:1', source: 'chat' });
addItem(user(), { kind: 'reminder', title: t('Vitamine nehmen', 'Take vitamins'), due: addDays(today, 1), time: '08:00', recurrence: 'daily', source: 'chat' });
addItem(user(), { kind: 'reminder', title: t('Zahnarzt anrufen', 'Call the dentist'), due: addDays(today, 2), time: '15:30', source: 'chat' });

// Ausgaben (Apple Pay) mit Abo und Budget
{
  const at = (daysAgo: number, hour = 12) => new Date(Date.now() - daysAgo * 86_400_000 - (12 - hour) * 3600_000).toISOString();
  const pay = (amount: string, merchant: string, daysAgo: number, card = 'Visa') => finMod.recordPayment(user(), { amount, merchant, card, date: at(daysAgo) });
  await pay('4,80', 'Café Central', 0);
  await pay('23,40', 'BILLA 1234 WIEN', 1);
  await pay('12,99', 'Netflix', 1);
  await pay('2,40', 'Wiener Linien', 2);
  await pay('36,90', 'H&M', 3);
  await pay('7,50', 'Kino Village', 4);
  await pay('18,20', 'Lieferando', 5);
  await pay('41,10', 'Hofer', 6);
  await pay('12,99', 'Netflix', 32);
  await pay('12,99', 'Netflix', 63);
  await pay('29,90', 'Zalando', 12);
  await pay('9,60', 'dm drogerie markt', 9);
  finMod.setBudget(uid, 'Essen & Trinken', 3000);
  finMod.setBudget(uid, 'Lebensmittel', 12000);
}

// Ziele mit Verlauf (Karte auf „Heute“ und Ziele-Ansicht)
{
  const run = goalsMod.createGoal(uid, goalsMod.cleanGoal({ title: t('Laufen gehen', 'Go running'), why: t('fitter werden', 'get fitter'), cadence: 'weekly:3', target: 3, minutes: 45, checkIn: 'So 18:00' }));
  [[-1, 1], [-2, 1], [-3, 1], [-8, 1], [-9, 1], [-15, 1], [-16, 1], [-17, 1], [-22, 1], [-30, 1], [-31, 1], [-38, 1], [-45, 1], [-46, 1]]
    .forEach(([off, v]) => { if (addDays(today, off!) < today) goalsMod.logGoal(uid, run.id, v!, addDays(today, off!)); });
  goalsMod.logGoal(uid, run.id, 1, today, t('Runde um den See', 'Lap around the lake'));
  const read = goalsMod.createGoal(uid, goalsMod.cleanGoal({ title: t('Lesen', 'Reading'), cadence: 'custom', target: 100, unit: t('Seiten', 'pages'), metric: t('Seiten', 'pages'), why: t('abschalten vor dem Schlafen', 'wind down before bed') }));
  [[0, 24], [-1, 30], [-3, 18], [-8, 40], [-10, 55], [-16, 70], [-24, 90], [-31, 35]].forEach(([off, v]) => goalsMod.logGoal(uid, read.id, v!, addDays(today, off!)));
}

// Einkaufsliste (Karte auf „Heute“ und Listen-Ansicht)
addListItems(uid, shoppingListId(uid), [{ text: t('Milch', 'Milk'), qty: t('2 Liter', '2 litres') }, { text: t('Eier', 'Eggs') }, { text: t('Butter', 'Butter') }, { text: t('Äpfel', 'Apples'), qty: '1 kg' }], 'chat');

// ein älterer Chat mit Titel (Verlauf: „Chats“)
const twoDaysAgo = (min: number) => new Date(Date.now() - 2 * 86_400_000 + min * 60_000).toISOString();
const oldChat = createConversation(uid, addDays(today, -2), twoDaysAgo(0));
addMessage(uid, 'user', t('Wie lerne ich am besten Vokabeln?', 'What is the best way to learn vocabulary?'), { conversationId: oldChat, createdAt: twoDaysAgo(0) });
addMessage(uid, 'assistant', t('Kurze Einheiten, dafür oft:\n- **10 Minuten** am Tag\n- laut sprechen\n- am Abend **einmal wiederholen**', 'Short sessions, but often:\n- **10 minutes** a day\n- say the words out loud\n- **review once** in the evening'), { conversationId: oldChat, createdAt: twoDaysAgo(1) });
addMessage(uid, 'user', t('Und wie merke ich mir die Artikel?', 'And how do I remember the genders?'), { conversationId: oldChat, createdAt: twoDaysAgo(3) });
addMessage(uid, 'assistant', t('Immer **mit Artikel** lernen: „das Haus“ statt nur „Haus“.', 'Always learn them **with the article**: “la casa”, not just “casa”.'), { conversationId: oldChat, createdAt: twoDaysAgo(4) });
db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(t('Vokabeln lernen', 'Learning vocabulary'), oldChat);

// Inbox
const inbox = (source: string, sender: string, text: string, payload: Record<string, unknown>, hoursAgo: number) =>
  db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), uid, source, sender, text, JSON.stringify(payload), new Date(Date.now() - hoursAgo * 3600_000).toISOString());
const mail = { accountId: 'demo', account: t('Schule', 'School'), fromAddress: 'post@schule.at', snippet: t('Liebe Eltern, liebe Schülerinnen und Schüler,\n\nbitte denkt daran, die Einverständniserklärung bis Freitag abzugeben.\n\nLiebe Grüße\nFrau Huber', 'Dear parents and students,\n\nplease remember to hand in the consent form by Friday.\n\nKind regards\nMs Huber') };
const who = (de: string, en: string) => t(de, en);
inbox('email', who('Frau Huber', 'Ms Huber'), t('Wandertag Freitag', 'Class hike on Friday'), { ...mail, category: 'important', summary: t('Wandertag: Einverständniserklärung bis Freitag abgeben', 'Class hike: hand in the consent form by Friday'), reason: t('Klassenvorstand', 'Form tutor'), deadline: { date: addDays(today, 4), time: null, what: t('Einverständnis abgeben', 'Hand in consent form') }, needsReply: false }, 3);
inbox('email', who('Herr Gruber', 'Mr Gruber'), t('Referat Termin', 'Presentation date'), { ...mail, category: 'important', summary: t('Fragt, ob du dein Referat schon am Montag halten kannst', 'Asks whether you can give your presentation on Monday'), reason: t('Lehrer fragt dich direkt', 'Teacher asks you directly'), needsReply: true }, 20);
inbox('social', 'Instagram', t('lena.mayer hat deinen Beitrag kommentiert', 'lena.mayer commented on your post'), { platform: 'Instagram', summary: 'lena.mayer: “Count me in!! 🔥”' }, 1);
inbox('sms', t('Mama', 'Mum'), t('Holst du Milch auf dem Heimweg?', 'Can you pick up milk on the way home?'), { summary: t('Holst du Milch auf dem Heimweg?', 'Can you pick up milk on the way home?') }, 2);
inbox('email', 'Zalando', t('Nur heute: −30 % auf alles', 'Today only: 30% off everything'), { ...mail, account: t('Privat', 'Personal'), category: 'spam', action: 'trash', summary: t('Werbung', 'Promotion') }, 5);
inbox('email', t('Elternverein', 'Parents association'), t('Herbstfest', 'Autumn fair'), { ...mail, category: 'normal', summary: t('Einladung zum Herbstfest am Samstag', 'Invitation to the autumn fair on Saturday') }, 30);
inbox('email', t('Lernhilfe Newsletter', 'Study Help newsletter'), t('Neue Übungen für November', 'New exercises for November'), { ...mail, account: t('Privat', 'Personal'), category: 'newsletter', summary: t('Neue Übungsblätter für Mathe und Englisch', 'New practice sheets for maths and Spanish') }, 26);
inbox('email', t('Bestellung #4411', 'Order #4411'), t('Dein Paket ist unterwegs', 'Your parcel is on its way'), { ...mail, account: t('Privat', 'Personal'), category: 'normal', summary: t('Versandbestätigung: Ankunft Donnerstag', 'Shipping confirmation: arrives Thursday') }, 40);

// Schritte der letzten Woche
const steps = [6400, 9100, 7300, 11200, 5200, 8800, 4300];
for (let d = 0; d < 7; d++) {
  db.prepare('INSERT INTO health_days (user_id, date, steps, sleep_hours, active_minutes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, addDays(today, -6 + d), steps[d], 7.5, 40, new Date().toISOString());
}

process.stdout.write(token);
