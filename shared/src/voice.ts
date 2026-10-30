// Wie Stella klingt: nett, frech oder cool. Gilt für alle festen Texte (Bestätigungen,
// Erinnerungen, Meldungen) und wird der KI als Stil vorgegeben. Inhalte bleiben gleich –
// nur der Ton ändert sich. Frech heißt neckisch, nie gemein.

export type Tone = 'nett' | 'frech' | 'cool';
export const TONES: Tone[] = ['nett', 'frech', 'cool'];

export const TONE_INFO: Record<Tone, { label: string; emoji: string; example: string }> = {
  nett: { label: 'Nett', emoji: '🌸', example: 'Notiert! Ich erinnere dich morgen um 19:00. 💫' },
  frech: { label: 'Frech', emoji: '😏', example: 'Schon wieder Latein? Na gut, notiert – ich nerv dich morgen um 19:00.' },
  cool: { label: 'Cool', emoji: '😎', example: 'Läuft. Steht drin, Reminder morgen 19:00.' },
};

export function isTone(v: unknown): v is Tone {
  return typeof v === 'string' && (TONES as string[]).includes(v);
}

/** Antwortstil in jedem Ton: kurz, wie ein hilfsbereiter Kumpel */
export const STYLE_RULES = 'Stil: Antworte wie ein hilfsbereiter Kumpel – kurz, höchstens etwa 6 Zeilen. Lieber Aufzählungen (mit „- “) als Absätze. ' +
  'Wichtiges **fett**. Keine Überschriften, keine Floskeln („Gerne!“, „Natürlich!“, „Ich hoffe, das hilft“). Auch im Ton „nett“: herzlich, aber knapp. ' +
  'Lange Ergebnisse (Wochenplan, Listen) erscheinen als Karte – schreib dann nur einen Satz dazu.';

/** Stilvorgabe für die KI */
export function toneInstruction(tone: Tone | undefined): string {
  return `${toneText(tone)} Immer kurz: etwa 6 Zeilen, Aufzählungen statt Absätze, Wichtiges **fett**, keine Überschriften und keine Floskeln.`;
}

function toneText(tone: Tone | undefined): string {
  switch (tone ?? 'nett') {
    case 'frech':
      return 'Ton: frech und schlagfertig – neckisch, ironisch, kleine Sprüche und Augenzwinkern (😏🙄😂), wie eine beste Freundin, die einen aufzieht. ' +
        'Nie gemein, nie beleidigend, nie bei ernsten Themen (Gesundheit, Streit, Sorgen) – da wirst du ehrlich und lieb.';
    case 'cool':
      return 'Ton: cool und lässig – sehr kurz, entspannt, leichte Jugendsprache ("läuft", "easy", "safe", "kein Stress"), sparsam mit Emojis (😎✌️). ' +
        'Keine Floskeln, kein Ausrufezeichen-Feuerwerk.';
    default:
      return 'Ton: nett und herzlich – warm, ermutigend, freundlich, gern mit passenden Emojis (💫🌸✨).';
  }
}

/** ein Satz aus mehreren Varianten – stabil für denselben Text, damit Tests nicht flackern */
function pick(options: string[], seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length]!;
}

export function voice(tone: Tone | undefined) {
  const t = tone ?? 'nett';
  const by = <T>(v: Record<Tone, T>): T => v[t];

  return {
    tone: t,

    // ----- Erinnerungen -----
    homeworkTomorrow: (label: string) => by({
      nett: `📚 Morgen fällig: ${label}`,
      frech: pick([`📚 Morgen fällig: ${label}. Und nein, „hab ich vergessen“ zählt nicht. 😏`, `📚 ${label} – morgen fällig. Rate mal, wer dran denkt? Genau, ich. 🙄`], label),
      cool: `📚 Morgen: ${label}. Kurz machen, dann chillen.`,
    }),
    examInAWeek: (title: string) => by({
      nett: `📅 In einer Woche: ${title}. Zeit, mit dem Lernen zu starten!`,
      frech: `📅 ${title} in einer Woche. Jetzt anfangen oder nächste Woche panisch werden – deine Wahl. 😏`,
      cool: `📅 ${title} in 7 Tagen. Langsam reinstarten, kein Stress.`,
    }),
    examTomorrow: (title: string) => by({
      nett: `🍀 Morgen ist ${title}. Letzte Wiederholung – und früh schlafen!`,
      frech: `🍀 Morgen ${title}. Handy weg, noch einmal drüber, und dann ab ins Bett – ja, wirklich. 😏`,
      cool: `🍀 Morgen ${title}. Einmal drüberschauen, früh pennen. Du packst das. ✌️`,
    }),
    dueInThreeDays: (label: string) => by({
      nett: `⏳ In 3 Tagen: ${label}`,
      frech: `⏳ ${label} in 3 Tagen. Nur so als freundlicher Schubs. 👉`,
      cool: `⏳ ${label} in 3 Tagen.`,
    }),
    dueTomorrow: (label: string) => by({
      nett: `📌 Morgen fällig: ${label}`,
      frech: `📌 Morgen fällig: ${label}. Tick tack. ⏰`,
      cool: `📌 Morgen: ${label}.`,
    }),
    tomorrow: (label: string) => by({
      nett: `📌 Morgen: ${label}`,
      frech: `📌 Morgen: ${label}. Nicht verpennen! 😏`,
      cool: `📌 Morgen: ${label}.`,
    }),
    inAnHour: (label: string) => by({
      nett: `⏰ In einer Stunde: ${label}`,
      frech: `⏰ In einer Stunde: ${label}. Schuhe an! 👟`,
      cool: `⏰ In 1 h: ${label}.`,
    }),
    studyTime: (label: string) => by({
      nett: `🧠 Lernzeit: ${label}`,
      frech: `🧠 Lernzeit: ${label}. Netflix kann warten. 😏`,
      cool: `🧠 Lernen: ${label}. 45 min, dann Pause.`,
    }),

    reminderNow: (label: string) => by({
      nett: `⏰ Erinnerung: ${label}`,
      frech: `⏰ Hey! ${label}. Jetzt, nicht gleich. 😏`,
      cool: `⏰ ${label}.`,
    }),

    // ----- Bestätigungen im Chat -----
    remindSet: (when: string, what: string) => by({
      nett: `⏰ Mach ich! Ich erinnere dich ${when} an „${what}“.`,
      frech: `⏰ ${when} nerv ich dich wegen „${what}“. Versprochen. 😏`,
      cool: `⏰ ${when}: „${what}“. Steht.`,
    }),
    moved: (title: string, when: string) => by({
      nett: `📅 **${title}** ist jetzt ${when}.`,
      frech: `📅 **${title}** auf ${when} geschoben. Aufschieben kannst du gut. 😏`,
      cool: `📅 **${title}** → ${when}.`,
    }),
    deleted: (title: string) => by({
      nett: `🗑️ **${title}** ist gelöscht.`,
      frech: `🗑️ **${title}** ist weg. Als wär's nie passiert. 💅`,
      cool: `🗑️ **${title}** gelöscht.`,
    }),
    inboxNone: () => by({
      nett: '📭 In deiner Inbox ist nichts Wichtiges – alles ruhig. 💫',
      frech: '📭 Nichts Wichtiges in der Inbox. Ausnahmsweise darfst du entspannen. 😏',
      cool: '📭 Nix Wichtiges. Läuft.',
    }),
    inboxSome: (count: number, lines: string) => by({
      nett: `📬 ${count === 1 ? '**1 wichtige Mail**' : `**${count} wichtige Mails**`}:\n${lines}`,
      frech: `📬 ${count === 1 ? '**1 wichtige Mail**' : `**${count} wichtige Mails**`} – die lesen sich nicht von selbst:\n${lines}`,
      cool: `📬 ${count === 1 ? '1 wichtige Mail' : `${count} wichtige Mails`}:\n${lines}`,
    }),
    remembered: (fact: string) => by({
      nett: `💭 Gemerkt: ${fact}`,
      frech: `💭 Notiert in meinem Elefantengedächtnis: ${fact} 🐘`,
      cool: `💭 Gemerkt: ${fact}`,
    }),
    forgotten: (fact: string) => by({
      nett: `🫧 Vergessen: ${fact}`,
      frech: `🫧 ${fact}? Nie gehört. 😇`,
      cool: `🫧 Weg: ${fact}`,
    }),
    mailDeadlineAsk: (from: string, what: string, when: string) => by({
      nett: `📬 In der Mail von ${from} steht: „${what}“ bis ${when}. Soll ich das eintragen?`,
      frech: `📬 ${from} will was von dir: „${what}“ bis ${when}. Eintragen, bevor du's vergisst? 😏`,
      cool: `📬 ${from}: „${what}“ bis ${when}. Eintragen?`,
    }),
    mailDeadlineDone: (from: string, what: string, when: string) => by({
      nett: `📬 Aus der Mail von ${from} eingetragen: **${what}**, ${when}.`,
      frech: `📬 Hab für dich die Mail von ${from} gelesen und eingetragen: **${what}**, ${when}. Gern geschehen. 💅`,
      cool: `📬 Aus der Mail von ${from}: **${what}**, ${when}. Steht drin.`,
    }),
    notFound: (what: string) => by({
      nett: `🤔 Ich finde nichts zu „${what}“ – meinst du was anderes?`,
      frech: `🤔 „${what}“? Gibt's bei mir nicht. Sicher, dass du das eingetragen hast? 👀`,
      cool: `🤔 Nix gefunden zu „${what}“.`,
    }),
    noted: (what: string) => by({
      nett: `✅ Notiert: ${what}`,
      frech: pick([`✅ Schon wieder was? Na gut, notiert: ${what}`, `✅ Notiert: ${what}. Ich mach das, du machst den Rest. 😏`], what),
      cool: `✅ Steht drin: ${what}`,
    }),
    remindAt: (day: string, time: string) => by({
      nett: `Ich erinnere dich ${day} um ${time}.`,
      frech: `Ich nerv dich ${day} um ${time}.`,
      cool: `Reminder ${day}, ${time}.`,
    }),
    solveFromPhoto: () => by({
      nett: 'Ich lös die Aufgabe vom Foto und schreib sie dir ins Heft. ✍️',
      frech: 'Ich lös das vom Foto und schreib\'s dir ins Heft – sag aber keinem, dass ich das war. 🤫',
      cool: 'Ich lös das vom Foto und schreib\'s ins Heft. ✍️',
    }),
    fetchAndSolve: (book: string) => by({
      nett: `Ich hol mir die Seite aus ${book}, lös die Aufgabe und schreib sie dir ins Heft. ✍️`,
      frech: `Ich hol mir die Seite aus ${book} und mach deine HÜ. Bitte, gern geschehen. 💅`,
      cool: `Hol mir die Seite aus ${book}, lös das, schreib's ins Heft. ✍️`,
    }),
    fetchOnly: (book: string) => by({
      nett: `Ich hol mir die Seite aus ${book} und schick dir das Bild mit. 📸`,
      frech: `Ich hol dir die Seite aus ${book} – das Buch aufschlagen ist ja auch so anstrengend. 📸`,
      cool: `Hol dir die Seite aus ${book}. 📸`,
    }),
    examNoted: (title: string, date: string) => by({
      nett: `📅 Eingetragen: **${title}** am ${date} Ich erinnere dich eine Woche und einen Tag vorher.`,
      frech: `📅 **${title}** am ${date} Ich erinnere dich eine Woche und einen Tag vorher – ausreden gibt's dann keine. 😏`,
      cool: `📅 **${title}** am ${date} Reminder eine Woche und einen Tag vorher.`,
    }),
    askMaterial: () => by({
      nett: 'Welcher Stoff kommt dran? Dann bau ich dir einen Lernplan. (Oder schreib „weiß noch nicht“.)',
      frech: 'Und was kommt dran? Sag\'s mir, dann bau ich dir einen Lernplan. („Weiß noch nicht“ geht auch – ich frag dann später nochmal. 😏)',
      cool: 'Welcher Stoff? Dann gibt\'s einen Lernplan. (Oder „weiß noch nicht“.)',
    }),
    askDate: (title: string) => by({
      nett: `📅 ${title} notiert – wann ist der Termin?`,
      frech: `📅 ${title} notiert. Und wann? Ich kann viel, aber nicht hellsehen. 🔮`,
      cool: `📅 ${title} – wann?`,
    }),
    done: (title: string, left: number) => by({
      nett: `Stark! **${title}** ist abgehakt ✅${left ? ` Für morgen ist noch ${left} HÜ offen.` : ''}`,
      frech: `Schau an, **${title}** erledigt ✅ Wer hätte das gedacht. 😏${left ? ` Noch ${left} HÜ für morgen übrig.` : ''}`,
      cool: `✅ **${title}** erledigt. Nice.${left ? ` Noch ${left} HÜ für morgen.` : ''}`,
    }),
    nothingFound: () => by({
      nett: 'Hmm, dazu finde ich nichts Offenes. 🤔',
      frech: 'Da ist nix offen. Hast du dir das ausgedacht? 🤔',
      cool: 'Nix Offenes dazu gefunden.',
    }),
    nothingAhead: (days: number) => by({
      nett: `Nichts offen in den nächsten ${days} Tagen. 🎉`,
      frech: `Nichts offen in den nächsten ${days} Tagen. Verdächtig ruhig… 👀`,
      cool: `Nix los die nächsten ${days} Tage. 😎`,
    }),
    solved: (title: string, freeNotes: boolean) => by({
      nett: `✅ **${title}** erledigt – ${freeNotes ? 'beim nächsten Öffnen von FreeNotes steht sie in deinem Heft.' : 'steht in deinem Heft.'}`,
      frech: `✅ **${title}** – erledigt. Von mir. Natürlich. 💅 ${freeNotes ? 'Steht beim nächsten Öffnen von FreeNotes in deinem Heft.' : 'Steht in deinem Heft.'}`,
      cool: `✅ **${title}** fertig – ${freeNotes ? 'ist beim nächsten Öffnen in FreeNotes.' : 'steht im Heft.'} ✌️`,
    }),
    solvedReminder: (title: string, date: string) => by({
      nett: `✅ ${title} für ${date} ist erledigt – liegt in deinem Heft.`,
      frech: `✅ ${title} für ${date}? Längst erledigt. Liegt im Heft. Bitte, gern. 😏`,
      cool: `✅ ${title} für ${date}: erledigt, liegt im Heft.`,
    }),
    untisHomework: (title: string, detail: string, due: string) => by({
      nett: `📚 Neue HÜ aus WebUntis: **${title}** – ${detail} (bis ${due}.)`,
      frech: `📚 Frisch aus WebUntis: **${title}** – ${detail} (bis ${due}.) Deine Lehrer:innen schlafen nie. 🙄`,
      cool: `📚 WebUntis: **${title}** – ${detail} (bis ${due}.)`,
    }),
    untisCancelled: (subject: string, start: string) => by({
      nett: `🎉 Morgen entfällt **${subject}** (${start}).`,
      frech: `🎉 Morgen fällt **${subject}** (${start}) aus. Ausschlafen? Ich sag nix. 🤫`,
      cool: `🎉 Morgen kein **${subject}** (${start}). Gönn dir.`,
    }),
    welcome: (name: string) => by({
      nett: `Hi ${name}! 👋 Ich bin Stella. Schreib mir einfach kurz, was ansteht – zum Beispiel:\n` +
        '• „Latein HÜ S. 45 Nr. 3 Freitag“\n• „Mathe SA 12.11.“\n• „was steht an?“\n' +
        'Ich trag\'s ein, erinnere dich rechtzeitig und mach dir Lernpläne. 💫',
      frech: `Na ${name}? 😏 Ich bin Stella und ab jetzt merk ich mir alles, was du vergisst. Schreib einfach:\n` +
        '• „Latein HÜ S. 45 Nr. 3 Freitag“\n• „Mathe SA 12.11.“\n• „was steht an?“\n' +
        'Den Rest mach ich. Wie immer. 💅',
      cool: `Hey ${name} ✌️ Stella hier. Schreib einfach, was ansteht:\n` +
        '• „Latein HÜ S. 45 Nr. 3 Freitag“\n• „Mathe SA 12.11.“\n• „was steht an?“\n' +
        'Ich trag\'s ein und erinner dich. Easy.',
    }),
    // ----- Hinweise: „Was hast du vergessen?“ -----
    hintNoMaterial: (title: string, days: number) => by({
      nett: `📝 ${title} ist in ${days} Tagen – welcher Stoff kommt dran? Dann bau ich dir einen Lernplan.`,
      frech: `📝 ${title} in ${days} Tagen, und ich kenn noch nicht mal den Stoff. Verrätst du's mir? 👀`,
      cool: `📝 ${title} in ${days} Tagen. Welcher Stoff? Dann gibt's einen Plan.`,
    }),
    hintNoPlan: (title: string, days: number) => by({
      nett: `🧠 Für ${title} (in ${days} Tagen) gibt's noch keinen Lernplan – soll ich einen machen?`,
      frech: `🧠 ${title} in ${days} Tagen und null Lernplan. Soll ich das mal übernehmen? 😏`,
      cool: `🧠 ${title} in ${days} Tagen, noch kein Lernplan. Soll ich einen bauen?`,
    }),
    hintMissedStudy: (title: string, slot: string) => by({
      nett: `⏰ „${title}“ ist liegen geblieben – soll ich die Einheit auf ${slot} verschieben?`,
      frech: `⏰ „${title}“ hast du geschwänzt. 🙄 Auf ${slot} verschieben?`,
      cool: `⏰ „${title}“ ist ausgefallen. Auf ${slot} schieben?`,
    }),
    hintOverdue: (title: string, when: string) => by({
      nett: `📌 ${title} war ${when} fällig – schon erledigt? Dann hak ich's ab.`,
      frech: `📌 ${title} war ${when} fällig. Erledigt oder verdrängt? 👀`,
      cool: `📌 ${title} war ${when} fällig. Abhaken?`,
    }),
    hintCancelled: (subject: string, title: string, newDate: string) => by({
      nett: `🎉 ${subject} entfällt morgen – soll ich ${title} auf ${newDate} verschieben?`,
      frech: `🎉 ${subject} fällt morgen aus! ${title} auf ${newDate} schieben? Mehr Zeit zum Nichtstun. 😏`,
      cool: `🎉 Morgen kein ${subject}. ${title} auf ${newDate} schieben?`,
    }),
    hintOverloaded: (count: number, freeMinutes: number) => by({
      nett: `😮‍💨 Morgen sind ${count} Sachen fällig, und heute bleiben dir nur noch ${freeMinutes} Minuten frei. Fang lieber bald an – oder sag mir, was ich verschieben soll.`,
      frech: `😮‍💨 Morgen ${count} Sachen fällig, heute noch ${freeMinutes} Minuten Zeit. Mathe-Genie, rechne mal. 😏 Sag mir, was ich verschieben soll.`,
      cool: `😮‍💨 Morgen ${count} Sachen fällig, heute nur noch ${freeMinutes} min frei. Soll ich was verschieben?`,
    }),
    hintNoSource: (title: string) => by({
      nett: `📸 Für ${title} (morgen) hab ich weder Foto noch Buchseite – schick mir ein Foto der Aufgabe, dann lös ich sie.`,
      frech: `📸 ${title} ist morgen fällig und ich hab nix davon. Foto? Ich kann viel, aber nicht hellsehen. 🔮`,
      cool: `📸 Für ${title} (morgen) fehlt mir die Aufgabe. Schick ein Foto, dann mach ich's.`,
    }),
    nothingForgotten: () => by({
      nett: 'Nichts – du bist komplett auf dem Laufenden. ✨',
      frech: 'Nichts. Ich bin ehrlich beeindruckt. 😏',
      cool: 'Nix. Alles im Griff. 😎',
    }),
    hintReply: (from: string, about: string) => by({
      nett: `✉️ ${from} wartet noch auf deine Antwort (${about}). Soll ich dir einen Entwurf schreiben?`,
      frech: `✉️ ${from} wartet immer noch auf dich (${about}). Ghosting ist keine Lösung. 😏 Entwurf?`,
      cool: `✉️ ${from} wartet auf Antwort (${about}). Entwurf?`,
    }),
    hintDone: (summary: string) => by({
      nett: `✓ Hab ich gemacht: ${summary}.`,
      frech: `✓ Erledigt, bevor du's gemerkt hast: ${summary}. 💅`,
      cool: `✓ Gemacht: ${summary}.`,
    }),

    // ----- Morning Briefing -----
    briefingGreeting: (name: string, weekday: string) => by({
      nett: `☀️ Guten Morgen, ${name}! Dein ${weekday}:`,
      frech: `☀️ Aufstehen, ${name}! 😏 Dein ${weekday}:`,
      cool: `☀️ Morgen, ${name}. Dein ${weekday}:`,
    }),
    briefingQuiet: () => by({
      nett: 'Heute steht nichts Besonderes an – genieß den Tag! 🌸',
      frech: 'Heute nix los. Verdächtig. 👀',
      cool: 'Heute entspannt. 😎',
    }),
    briefingClosing: (busy: boolean) => by({
      nett: busy ? 'Du schaffst das! 💫' : 'Hab einen schönen Tag! 🌸',
      frech: busy ? 'Und jetzt: Handy weg, ab in den Tag. 😏' : 'Viel Spaß beim Nichtstun. 😏',
      cool: busy ? 'Packst du. ✌️' : 'Chill. ✌️',
    }),

    // ----- Plan my week -----
    weekPlanIntro: (n: number) => by({
      nett: `🗓️ Hier ist mein Vorschlag für deine Woche – ${n} ${n === 1 ? 'Block' : 'Blöcke'} in deinen freien Zeiten:`,
      frech: `🗓️ Ich hab deine Woche mal sortiert, bevor's peinlich wird: ${n} ${n === 1 ? 'Block' : 'Blöcke'}. 😏`,
      cool: `🗓️ Deine Woche, geplant: ${n} ${n === 1 ? 'Block' : 'Blöcke'}.`,
    }),
    weekPlanEmpty: () => by({
      nett: 'Für die nächsten 7 Tage gibt es nichts zu planen – keine Tests, keine offenen HÜs. Genieß es! 🌸',
      frech: 'Nichts zu planen. Keine Tests, keine HÜs. Wer bist du und was hast du mit dir gemacht? 😏',
      cool: 'Nix zu planen diese Woche. 😎',
    }),
    weekPlanQuestion: () => by({
      nett: 'Soll ich das so eintragen? Einzelne Blöcke kannst du im Planer unter „Woche planen“ abwählen. 💫',
      frech: 'Eintragen? Wenn dir was nicht passt: Planer → „Woche planen“, abwählen. 😏',
      cool: 'Eintragen? Anpassen geht im Planer unter „Woche planen“.',
    }),
    weekPlanOffer: () => by({
      nett: '🌙 Neue Woche steht vor der Tür – ich hab dir schon mal einen Plan gemacht:',
      frech: '🌙 Sonntagabend-Panik? Nicht mit mir. Hier ist dein Plan:',
      cool: '🌙 Neue Woche. Plan steht:',
    }),
    weekPlanDone: (n: number) => by({
      nett: `✓ ${n} ${n === 1 ? 'Block ist' : 'Blöcke sind'} eingetragen. Du schaffst das! 💫`,
      frech: `✓ ${n} ${n === 1 ? 'Block' : 'Blöcke'} drin. Jetzt nur noch auch machen. 😏`,
      cool: `✓ ${n} ${n === 1 ? 'Block' : 'Blöcke'} eingetragen.`,
    }),
    replanned: (title: string, when: string) => by({
      nett: `🔁 „${title}“ hat nicht geklappt – kein Problem, ich hab's auf ${when} verschoben.`,
      frech: `🔁 „${title}“ geschwänzt? 😏 Hab's auf ${when} geschoben.`,
      cool: `🔁 „${title}“ verschoben auf ${when}.`,
    }),

    toneChanged: () => by({
      nett: 'Okay! Ab jetzt bin ich wieder ganz lieb zu dir. 🌸',
      frech: 'Oh, frech darf ich sein? Das wird lustig. 😏',
      cool: 'Alles klar. Ab jetzt chillig. 😎',
    }),
  };
}

export type Voice = ReturnType<typeof voice>;
