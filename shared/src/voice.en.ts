// Stella's fixed texts in English, in three tones (kind, cheeky, cool). Same shape as voice.de.ts – the compiler checks it.
// Not translated word by word: the cheeky tone teases, never mean; the cool tone is short.

import { pick, type Tone } from './voice.core.ts';
import type { Voice } from './voice.de.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function voiceEn(tone: Tone | undefined): Voice {
  const t = tone ?? 'nett';
  const by = <T>(v: Record<Tone, T>): T => v[t];

  return {
    tone: t,

    // ----- Reminders -----
    homeworkTomorrow: (label: string) => by({
      nett: `📚 Due tomorrow: ${label}`,
      frech: pick([`📚 Due tomorrow: ${label}. And no, "I forgot" doesn't count. 😏`, `📚 ${label} – due tomorrow. Guess who remembered? Me. 🙄`], label),
      cool: `📚 Tomorrow: ${label}. Knock it out, then chill.`,
    }),
    examInAWeek: (title: string) => by({
      nett: `📅 In one week: ${title}. Time to start studying!`,
      frech: `📅 ${title} in a week. Start now or panic next week – your call. 😏`,
      cool: `📅 ${title} in 7 days. Ease into it, no stress.`,
    }),
    examTomorrow: (title: string) => by({
      nett: `🍀 ${title} is tomorrow. One last review – and an early night!`,
      frech: `🍀 ${title} tomorrow. Phone away, one more run-through, then bed – yes, really. 😏`,
      cool: `🍀 ${title} tomorrow. Quick look over, sleep early. You've got this. ✌️`,
    }),
    dueInThreeDays: (label: string) => by({
      nett: `⏳ In 3 days: ${label}`,
      frech: `⏳ ${label} in 3 days. Just a friendly nudge. 👉`,
      cool: `⏳ ${label} in 3 days.`,
    }),
    dueTomorrow: (label: string) => by({
      nett: `📌 Due tomorrow: ${label}`,
      frech: `📌 Due tomorrow: ${label}. Tick tock. ⏰`,
      cool: `📌 Tomorrow: ${label}.`,
    }),
    tomorrow: (label: string) => by({
      nett: `📌 Tomorrow: ${label}`,
      frech: `📌 Tomorrow: ${label}. Don't oversleep! 😏`,
      cool: `📌 Tomorrow: ${label}.`,
    }),
    inAnHour: (label: string) => by({
      nett: `⏰ In an hour: ${label}`,
      frech: `⏰ In an hour: ${label}. Shoes on! 👟`,
      cool: `⏰ In 1 h: ${label}.`,
    }),
    studyTime: (label: string) => by({
      nett: `🧠 Study time: ${label}`,
      frech: `🧠 Study time: ${label}. Netflix can wait. 😏`,
      cool: `🧠 Study: ${label}. 45 min, then a break.`,
    }),

    reminderNow: (label: string) => by({
      nett: `⏰ Reminder: ${label}`,
      frech: `⏰ Hey! ${label}. Now, not later. 😏`,
      cool: `⏰ ${label}.`,
    }),

    // ----- Confirmations in chat -----
    remindSet: (when: string, what: string) => by({
      nett: `⏰ On it! I'll remind you ${when} about "${what}".`,
      frech: `⏰ ${when} I'll nag you about "${what}". Promise. 😏`,
      cool: `⏰ ${when}: "${what}". Set.`,
    }),
    recurringSet: (when: string, what: string) => by({
      nett: `🔁 On it! ${when} I'll remind you about "${what}". You can change or stop it any time under "What Stella is up to".`,
      frech: `🔁 ${when} I'll nag you about "${what}" – from now on, forever. 😏 (Stop it under "What Stella is up to".)`,
      cool: `🔁 ${when}: "${what}". Set. Change it under "What Stella is up to".`,
    }),
    moved: (title: string, when: string) => by({
      nett: `📅 **${title}** is now ${when}.`,
      frech: `📅 **${title}** pushed to ${when}. You're good at postponing. 😏`,
      cool: `📅 **${title}** → ${when}.`,
    }),
    deleted: (title: string) => by({
      nett: `🗑️ **${title}** is deleted.`,
      frech: `🗑️ **${title}** is gone. As if it never happened. 💅`,
      cool: `🗑️ **${title}** deleted.`,
    }),
    listAdded: (items: string, _count: number) => by({
      nett: `🛒 Added to the shopping list: ${items}.`,
      frech: `🛒 ${items} – it's on there. Just don't forget it again. 😏`,
      cool: `🛒 Added: ${items}.`,
    }),
    listAlready: (items: string) => by({
      nett: `🛒 ${items} is already on the list.`,
      frech: `🛒 ${items} is already on there – even I'm not that forgetful. 😏`,
      cool: `🛒 ${items} is already on.`,
    }),
    listShow: (count: number, lines: string) => by({
      nett: `🛒 **Shopping list** (${count}):\n${lines}`,
      frech: `🛒 **Shopping list** (${count}) – have fun shopping:\n${lines}`,
      cool: `🛒 Shopping list (${count}):\n${lines}`,
    }),
    listEmpty: () => by({
      nett: '🛒 The shopping list is empty – nothing to get. ✨',
      frech: '🛒 Empty. For once you have everything. 😏',
      cool: '🛒 List empty. All good.',
    }),
    listChecked: (items: string) => by({
      nett: `✅ Checked off: ${items}`,
      frech: `✅ ${items} – done. See, that works. 😏`,
      cool: `✅ ${items} ✔`,
    }),
    listAllChecked: (count: number) => by({
      nett: `✅ Everything checked off (${count}). Well done! 💫`,
      frech: `✅ Everything checked off (${count}). Who would've thought. 😏`,
      cool: `✅ All done (${count}).`,
    }),
    listNoMatch: (items: string) => by({
      nett: `🤔 I can't find "${items}" on the shopping list.`,
      frech: `🤔 "${items}"? It's not on there. 🙄`,
      cool: `🤔 "${items}" isn't on the list.`,
    }),
    errandSet: (when: string, what: string, place: string | null) => by({
      nett: `⏰ On it! ${when} I'll remind you about "${what}"${place ? ` and show you ${place} nearby` : ''}.`,
      frech: `⏰ ${when} I'll nag you about "${what}"${place ? ` – including ${place} nearby` : ''}. 😏`,
      cool: `⏰ ${when}: "${what}"${place ? ` + ${place} nearby` : ''}. Set.`,
    }),
    inboxNone: () => by({
      nett: '📭 Nothing important in your inbox – all quiet. 💫',
      frech: '📭 Nothing important in the inbox. You may relax for once. 😏',
      cool: '📭 Nothing important. All good.',
    }),
    inboxSome: (count: number, lines: string) => by({
      nett: `📬 **${count} important ${plural(count, 'email', 'emails')}**:\n${lines}`,
      frech: `📬 **${count} important ${plural(count, 'email', 'emails')}** – they won't read themselves:\n${lines}`,
      cool: `📬 ${count} important ${plural(count, 'email', 'emails')}:\n${lines}`,
    }),
    goalSet: (title: string, rhythm: string) => by({
      nett: `🎯 New goal: **${title}** – ${rhythm}. I'll help you stick with it. 💫`,
      frech: `🎯 **${title}**, ${rhythm}. Let's see how long the enthusiasm lasts. 😏`,
      cool: `🎯 Goal set: **${title}**, ${rhythm}.`,
    }),
    spendingSome: (label: string, total: string, count: number) => by({
      nett: `💶 **${label}** you spent ${total} (${count} ${plural(count, 'payment', 'payments')}).`,
      frech: `💶 **${label}**: ${total} gone, ${count} ${plural(count, 'payment', 'payments')}. Your wallet says hi. 😏`,
      cool: `💶 ${label}: ${total} (${count}×).`,
    }),
    spendingNone: (label: string) => by({
      nett: `💶 I haven't seen any spending **${label}**. Is the Apple Pay shortcut set up? The guide is in Settings under "Spending".`,
      frech: `💶 Nothing spent **${label}**? Or the shortcut is missing – the guide is in Settings under "Spending". 😏`,
      cool: `💶 ${label}: nothing seen. Shortcut set up? Settings → Spending.`,
    }),
    hintBudget: (category: string, percent: number, spent: string, limit: string) => by({
      nett: percent >= 100
        ? `💶 Your budget for **${category}** is used up: ${spent} of ${limit}.`
        : `💶 You've already used ${percent}% of your **${category}** budget (${spent} of ${limit}).`,
      frech: percent >= 100
        ? `💶 **${category}**: ${spent} of ${limit} – budget blown. Respect. 😏`
        : `💶 **${category}**: ${percent}% gone already (${spent} of ${limit}). Easy, easy. 😏`,
      cool: percent >= 100 ? `💶 ${category}: budget empty (${spent}/${limit}).` : `💶 ${category}: ${percent}% of budget (${spent}/${limit}).`,
    }),
    goalExists: (title: string) => by({
      nett: `🎯 **${title}** already exists – just tell me when you've done something and I'll log it.`,
      frech: `🎯 **${title}** already exists. Twice won't make you fitter. 😏`,
      cool: `🎯 **${title}** already exists.`,
    }),
    goalLogged: (title: string, amount: string, stand: string) => by({
      nett: `✅ **${title}**: logged ${amount}. This week: ${stand}. 💫`,
      frech: `✅ **${title}**: ${amount} – ${stand} this week. See, that works. 😏`,
      cool: `✅ **${title}** +${amount}. Week: ${stand}.`,
    }),
    goalUnclear: () => by({
      nett: '🤔 Which goal is that for? Tell me the name and I\'ll log it.',
      frech: '🤔 And which goal is that supposed to be? I\'m not a mind reader. 😏',
      cool: '🤔 Which goal?',
    }),
    goalStale: (title: string, weeks: number) => by({
      nett: `🎯 You haven't logged anything for **${title}** in ${weeks} ${plural(weeks, 'week', 'weeks')}. Shall I pause or adjust it?`,
      frech: `🎯 **${title}** has been lying idle for ${weeks} ${plural(weeks, 'week', 'weeks')}. Giving up is fine – just tell me. 😏`,
      cool: `🎯 **${title}**: nothing for ${weeks} ${plural(weeks, 'week', 'weeks')}. Pause or adjust?`,
    }),
    goalFromMemory: (title: string) => by({
      nett: `🎯 You once told me: "${title}". Shall I turn it into a real goal I can support you with?`,
      frech: `🎯 "${title}" – you wanted that once. Make it a goal, or was it just talk? 😏`,
      cool: `🎯 "${title}" – set it as a goal?`,
    }),
    remembered: (fact: string) => by({
      nett: `💭 Remembered: ${fact}`,
      frech: `💭 Filed in my elephant memory: ${fact} 🐘`,
      cool: `💭 Remembered: ${fact}`,
    }),
    forgotten: (fact: string) => by({
      nett: `🫧 Forgotten: ${fact}`,
      frech: `🫧 ${fact}? Never heard of it. 😇`,
      cool: `🫧 Gone: ${fact}`,
    }),
    mailDeadlineAsk: (from: string, what: string, when: string) => by({
      nett: `📬 The email from ${from} says: "${what}" by ${when}. Shall I add it?`,
      frech: `📬 ${from} wants something from you: "${what}" by ${when}. Add it before you forget? 😏`,
      cool: `📬 ${from}: "${what}" by ${when}. Add it?`,
    }),
    mailDeadlineDone: (from: string, what: string, when: string) => by({
      nett: `📬 Added from the email by ${from}: **${what}**, ${when}.`,
      frech: `📬 I read the email from ${from} for you and added it: **${what}**, ${when}. You're welcome. 💅`,
      cool: `📬 From ${from}'s email: **${what}**, ${when}. Added.`,
    }),
    notFound: (what: string) => by({
      nett: `🤔 I can't find anything for "${what}" – do you mean something else?`,
      frech: `🤔 "${what}"? Not in my books. Sure you added it? 👀`,
      cool: `🤔 Nothing found for "${what}".`,
    }),
    noted: (what: string) => by({
      nett: `✅ Noted: ${what}`,
      frech: pick([`✅ Something again? Fine, noted: ${what}`, `✅ Noted: ${what}. I do this, you do the rest. 😏`], what),
      cool: `✅ Added: ${what}`,
    }),
    remindAt: (day: string, time: string) => by({
      nett: `I'll remind you ${day} at ${time}.`,
      frech: `I'll nag you ${day} at ${time}.`,
      cool: `Reminder ${day}, ${time}.`,
    }),
    solveFromPhoto: () => by({
      nett: 'I\'ll solve the task from the photo and write it into your notebook. ✍️',
      frech: 'I\'ll solve this from the photo and write it in your notebook – don\'t tell anyone it was me. 🤫',
      cool: 'Solving it from the photo and writing it in the notebook. ✍️',
    }),
    fetchAndSolve: (book: string) => by({
      nett: `I'll get the page from ${book}, solve the task and write it into your notebook. ✍️`,
      frech: `I'll fetch the page from ${book} and do your homework. You're welcome. 💅`,
      cool: `Getting the page from ${book}, solving it, writing it in the notebook. ✍️`,
    }),
    fetchOnly: (book: string) => by({
      nett: `I'll get the page from ${book} and send you the picture. 📸`,
      frech: `I'll get the page from ${book} – opening a book is so exhausting. 📸`,
      cool: `Getting you the page from ${book}. 📸`,
    }),
    examNoted: (title: string, date: string) => by({
      nett: `📅 Added: **${title}** on ${date}. I'll remind you a week and a day before.`,
      frech: `📅 **${title}** on ${date}. I'll remind you a week and a day before – no excuses then. 😏`,
      cool: `📅 **${title}** on ${date}. Reminders a week and a day before.`,
    }),
    askMaterial: () => by({
      nett: 'What\'s the material? Then I\'ll build you a study plan. (Or write "don\'t know yet".)',
      frech: 'And what\'s on it? Tell me and I\'ll build a study plan. ("Don\'t know yet" works too – I\'ll ask again later. 😏)',
      cool: 'What material? Then you get a study plan. (Or "don\'t know yet".)',
    }),
    askDate: (title: string) => by({
      nett: `📅 ${title} noted – when is it?`,
      frech: `📅 ${title} noted. And when? I can do a lot, but I'm no fortune teller. 🔮`,
      cool: `📅 ${title} – when?`,
    }),
    done: (title: string, left: number) => by({
      nett: `Nice! **${title}** is checked off ✅${left ? ` ${left} homework ${plural(left, 'task is', 'tasks are')} still open for tomorrow.` : ''}`,
      frech: `Look at that, **${title}** done ✅ Who would've thought. 😏${left ? ` ${left} more for tomorrow.` : ''}`,
      cool: `✅ **${title}** done. Nice.${left ? ` ${left} more for tomorrow.` : ''}`,
    }),
    nothingFound: () => by({
      nett: 'Hmm, I can\'t find anything open for that. 🤔',
      frech: 'Nothing open there. Did you make that up? 🤔',
      cool: 'Nothing open for that.',
    }),
    nothingAhead: (days: number) => by({
      nett: `Nothing open in the next ${days} days. 🎉`,
      frech: `Nothing open in the next ${days} days. Suspiciously quiet… 👀`,
      cool: `Nothing going on the next ${days} days. 😎`,
    }),
    solved: (title: string, freeNotes: boolean) => by({
      nett: `✅ **${title}** done – ${freeNotes ? 'it\'ll be in your notebook the next time you open FreeNotes.' : 'it\'s in your notebook.'}`,
      frech: `✅ **${title}** – done. By me. Obviously. 💅 ${freeNotes ? 'It\'ll be in your notebook the next time you open FreeNotes.' : 'It\'s in your notebook.'}`,
      cool: `✅ **${title}** finished – ${freeNotes ? 'will be in FreeNotes when you open it.' : 'it\'s in the notebook.'} ✌️`,
    }),
    solvedReminder: (title: string, date: string) => by({
      nett: `✅ ${title} for ${date} is done – it's in your notebook.`,
      frech: `✅ ${title} for ${date}? Done ages ago. It's in the notebook. You're welcome. 😏`,
      cool: `✅ ${title} for ${date}: done, in the notebook.`,
    }),
    untisHomework: (title: string, detail: string, due: string) => by({
      nett: `📚 New homework from WebUntis: **${title}** – ${detail} (due ${due}.)`,
      frech: `📚 Fresh from WebUntis: **${title}** – ${detail} (due ${due}.) Your teachers never sleep. 🙄`,
      cool: `📚 WebUntis: **${title}** – ${detail} (due ${due}.)`,
    }),
    untisCancelled: (subject: string, start: string) => by({
      nett: `🎉 **${subject}** (${start}) is cancelled tomorrow.`,
      frech: `🎉 **${subject}** (${start}) is cancelled tomorrow. Sleep in? I won't tell. 🤫`,
      cool: `🎉 No **${subject}** (${start}) tomorrow. Enjoy.`,
    }),
    welcome: (name: string) => by({
      nett: `Hi ${name}! 👋 I'm Stella. Just write me what's coming up – for example:\n` +
        '• "Dentist Friday 3 pm"\n• "Report due 12 Nov"\n• "what\'s up?"\n' +
        'I\'ll add it, remind you in time and make study plans. 💫',
      frech: `Well, ${name}? 😏 I'm Stella and from now on I remember everything you forget. Just write:\n` +
        '• "Dentist Friday 3 pm"\n• "Report due 12 Nov"\n• "what\'s up?"\n' +
        'I\'ll do the rest. As always. 💅',
      cool: `Hey ${name} ✌️ Stella here. Just write what's coming up:\n` +
        '• "Dentist Friday 3 pm"\n• "Report due 12 Nov"\n• "what\'s up?"\n' +
        'I\'ll add it and remind you. Easy.',
    }),
    // ----- Hints: "what did you forget?" -----
    hintNoMaterial: (title: string, days: number) => by({
      nett: `📝 ${title} is in ${days} days – what's the material? Then I'll build you a study plan.`,
      frech: `📝 ${title} in ${days} days and I don't even know the material. Will you tell me? 👀`,
      cool: `📝 ${title} in ${days} days. What material? Then you get a plan.`,
    }),
    hintNoPlan: (title: string, days: number) => by({
      nett: `🧠 There's no study plan yet for ${title} (in ${days} days) – shall I make one?`,
      frech: `🧠 ${title} in ${days} days and zero study plan. Want me to take over? 😏`,
      cool: `🧠 ${title} in ${days} days, no study plan yet. Build one?`,
    }),
    hintMissedStudy: (title: string, slot: string) => by({
      nett: `⏰ "${title}" fell through – shall I move the session to ${slot}?`,
      frech: `⏰ You skipped "${title}". 🙄 Move it to ${slot}?`,
      cool: `⏰ "${title}" didn't happen. Move to ${slot}?`,
    }),
    hintOverdue: (title: string, when: string) => by({
      nett: `📌 ${title} was due ${when} – already done? Then I'll check it off.`,
      frech: `📌 ${title} was due ${when}. Done or denied? 👀`,
      cool: `📌 ${title} was due ${when}. Check it off?`,
    }),
    hintCancelled: (subject: string, title: string, newDate: string) => by({
      nett: `🎉 ${subject} is cancelled tomorrow – shall I move ${title} to ${newDate}?`,
      frech: `🎉 ${subject} is cancelled tomorrow! Move ${title} to ${newDate}? More time for doing nothing. 😏`,
      cool: `🎉 No ${subject} tomorrow. Move ${title} to ${newDate}?`,
    }),
    hintOverloaded: (count: number, freeMinutes: number) => by({
      nett: `😮‍💨 Tomorrow ${count} ${plural(count, 'thing is', 'things are')} due, and you only have ${freeMinutes} minutes free today. Better start soon – or tell me what to move.`,
      frech: `😮‍💨 Tomorrow ${count} ${plural(count, 'thing', 'things')} due, ${freeMinutes} minutes left today. Math genius, do the maths. 😏 Tell me what to move.`,
      cool: `😮‍💨 ${count} due tomorrow, only ${freeMinutes} min free today. Move something?`,
    }),
    hintNoSource: (title: string) => by({
      nett: `📸 For ${title} (tomorrow) I have neither a photo nor a book page – send me a photo of the task and I'll solve it.`,
      frech: `📸 ${title} is due tomorrow and I have nothing. Photo? I can do a lot, but I'm no fortune teller. 🔮`,
      cool: `📸 For ${title} (tomorrow) I'm missing the task. Send a photo and I'll do it.`,
    }),
    nothingForgotten: () => by({
      nett: 'Nothing – you\'re completely up to date. ✨',
      frech: 'Nothing. I\'m honestly impressed. 😏',
      cool: 'Nothing. All under control. 😎',
    }),
    hintReply: (from: string, about: string) => by({
      nett: `✉️ ${from} is still waiting for your reply (${about}). Shall I write a draft?`,
      frech: `✉️ ${from} is still waiting for you (${about}). Ghosting isn't a solution. 😏 Draft?`,
      cool: `✉️ ${from} awaits a reply (${about}). Draft?`,
    }),
    hintDone: (summary: string) => by({
      nett: `✓ Done: ${summary}.`,
      frech: `✓ Done before you noticed: ${summary}. 💅`,
      cool: `✓ Done: ${summary}.`,
    }),

    // ----- Morning briefing -----
    briefingGreeting: (name: string, weekday: string) => by({
      nett: `☀️ Good morning, ${name}! Your ${weekday}:`,
      frech: `☀️ Wake up, ${name}! 😏 Your ${weekday}:`,
      cool: `☀️ Morning, ${name}. Your ${weekday}:`,
    }),
    briefingQuiet: () => by({
      nett: 'Nothing special today – enjoy the day! 🌸',
      frech: 'Nothing going on today. Suspicious. 👀',
      cool: 'Easy day today. 😎',
    }),
    briefingClosing: (busy: boolean) => by({
      nett: busy ? 'You\'ve got this! 💫' : 'Have a lovely day! 🌸',
      frech: busy ? 'Now: phone away, off into the day. 😏' : 'Enjoy doing nothing. 😏',
      cool: busy ? 'You got this. ✌️' : 'Chill. ✌️',
    }),

    // ----- Plan my week -----
    weekPlanIntro: (n: number) => by({
      nett: `🗓️ Here's my suggestion for your week – ${n} ${plural(n, 'block', 'blocks')} in your free time:`,
      frech: `🗓️ I sorted your week before it gets embarrassing: ${n} ${plural(n, 'block', 'blocks')}. 😏`,
      cool: `🗓️ Your week, planned: ${n} ${plural(n, 'block', 'blocks')}.`,
    }),
    weekPlanEmpty: () => by({
      nett: 'Nothing to plan for the next 7 days – no tests, no open homework. Enjoy! 🌸',
      frech: 'Nothing to plan. No tests, no homework. Who are you and what did you do with yourself? 😏',
      cool: 'Nothing to plan this week. 😎',
    }),
    weekPlanQuestion: () => by({
      nett: 'Shall I add this? You can untick single blocks in the planner under "Plan my week". 💫',
      frech: 'Add it? If something doesn\'t suit you: Planner → "Plan my week", untick it. 😏',
      cool: 'Add it? Adjust under "Plan my week" in the planner.',
    }),
    weekPlanOffer: () => by({
      nett: '🌙 A new week is coming up – I\'ve already made you a plan:',
      frech: '🌙 Sunday-evening panic? Not with me. Here\'s your plan:',
      cool: '🌙 New week. Plan\'s ready:',
    }),
    weekPlanDone: (n: number) => by({
      nett: `✓ ${n} ${plural(n, 'block is', 'blocks are')} added. You've got this! 💫`,
      frech: `✓ ${n} ${plural(n, 'block', 'blocks')} in. Now you just have to actually do it. 😏`,
      cool: `✓ ${n} ${plural(n, 'block', 'blocks')} added.`,
    }),
    replanned: (title: string, when: string) => by({
      nett: `🔁 "${title}" didn't work out – no problem, I moved it to ${when}.`,
      frech: `🔁 Skipped "${title}"? 😏 Moved it to ${when}.`,
      cool: `🔁 "${title}" moved to ${when}.`,
    }),

    toneChanged: () => by({
      nett: 'Okay! From now on I\'ll be really sweet to you again. 🌸',
      frech: 'Oh, I\'m allowed to be cheeky? This will be fun. 😏',
      cool: 'Got it. Chill mode from now on. 😎',
    }),
  };
}
