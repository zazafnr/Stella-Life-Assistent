// Stellas feste Texte in den übrigen Sprachen (Paket 3) – nicht Wort für Wort übersetzt, sondern so geschrieben,
// wie Stella in dieser Sprache erfunden worden wäre. Jede Sprache überschreibt die häufigsten Texte in allen drei Tönen
// (nett / frech / cool); alles andere kommt aus dem Englischen. Regeln: docs/i18n-stil.md, Entscheidungen: docs/i18n/<sprache>-notizen.md.
// „Frech“ ist neckisch, nie beleidigend.

import type { Locale } from './i18n/locales.ts';
import { pick, type Tone } from './voice.core.ts';
import type { Voice } from './voice.de.ts';

type Part = Partial<Voice>;
type Maker = (tone: Tone | undefined) => Part;

const make = (f: (by: <T>(v: Record<Tone, T>) => T) => Part): Maker => (tone) => {
  const t = tone ?? 'nett';
  return { tone: t, ...f(<T>(v: Record<Tone, T>) => v[t]) };
};

// ---------- Español (neutro, tú) ----------
const es = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Para mañana: ${label}`,
    frech: pick([`📚 Para mañana: ${label}. Y «se me olvidó» no vale. 😏`, `📚 ${label} para mañana. ¿Quién se ha acordado? Yo. 🙄`], label),
    cool: `📚 Mañana: ${label}. Despáchalo y a descansar.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Mañana: ${title}. Un último repaso… ¡y a dormir pronto!`,
    frech: `🍀 Mañana ${title}. Móvil fuera, un repaso más y a la cama. Sí, en serio. 😏`,
    cool: `🍀 Mañana ${title}. Un vistazo y a dormir. Tú puedes. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Para mañana: ${label}`,
    frech: `📌 Para mañana: ${label}. Tic, tac. ⏰`,
    cool: `📌 Mañana: ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Recordatorio: ${label}`,
    frech: `⏰ ¡Eh! ${label}. Ahora, no luego. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ ¡Hecho! ${when} te recuerdo «${what}».`,
    frech: `⏰ ${when} te doy la lata con «${what}». Prometido. 😏`,
    cool: `⏰ ${when}: «${what}». Listo.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Apuntado: ${what}`,
    frech: pick([`✅ ¿Otra cosa más? Vale, apuntado: ${what}`, `✅ Apuntado: ${what}. Yo apunto, tú haces el resto. 😏`], what),
    cool: `✅ Anotado: ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** ahora es ${when}.`,
    frech: `📅 **${title}** movido a ${when}. Dejarlo para luego se te da de lujo. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** borrado.`,
    frech: `🗑️ **${title}** ha desaparecido. Como si nunca hubiera existido. 💅`,
    cool: `🗑️ **${title}** borrado.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 A la lista de la compra: ${items}.`,
    frech: `🛒 ${items}: ya está apuntado. A ver si esta vez no se te olvida. 😏`,
    cool: `🛒 Añadido: ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 La lista de la compra está vacía: no hay nada que comprar. ✨',
    frech: '🛒 Vacía. Por una vez lo tienes todo. 😏',
    cool: '🛒 Lista vacía. Todo bien.',
  }),
  done: (title: string, left: number) => by({
    nett: `¡Genial! **${title}** hecho ✅${left ? ` Para mañana aún te quedan ${left}.` : ''}`,
    frech: `Mira por dónde, **${title}** hecho ✅ Quién lo iba a decir. 😏${left ? ` Quedan ${left} para mañana.` : ''}`,
    cool: `✅ **${title}** hecho. Bien.${left ? ` Quedan ${left} para mañana.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Nada: lo tienes todo al día. ✨',
    frech: 'Nada. Estoy impresionada, de verdad. 😏',
    cool: 'Nada. Todo controlado. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ ¡Buenos días, ${name}! Tu ${weekday}:`,
    frech: `☀️ ¡Arriba, ${name}! 😏 Tu ${weekday}:`,
    cool: `☀️ Buenas, ${name}. Tu ${weekday}:`,
  }),
  briefingQuiet: () => by({
    nett: 'Hoy no hay nada especial: ¡disfruta del día! 🌸',
    frech: 'Hoy no hay nada. Sospechoso. 👀',
    cool: 'Hoy, tranqui. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? '¡Tú puedes! 💫' : '¡Que tengas un día precioso! 🌸',
    frech: busy ? 'Y ahora: móvil fuera y a vivir el día. 😏' : 'Que disfrutes de no hacer nada. 😏',
    cool: busy ? 'Lo tienes. ✌️' : 'Relax. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `¡Hola, ${name}! 👋 Soy Stella. Cuéntame lo que tienes pendiente, por ejemplo:\n• «Deberes de latín pág. 45 n.º 3 viernes»\n• «Examen de mates 12/11»\n• «¿qué tengo pendiente?»\nLo apunto, te aviso a tiempo y te preparo planes de estudio. 💫`,
    frech: `¿Qué tal, ${name}? 😏 Soy Stella y desde hoy me acuerdo yo de lo que tú olvidas. Escribe, por ejemplo:\n• «Deberes de latín pág. 45 n.º 3 viernes»\n• «Examen de mates 12/11»\n• «¿qué tengo pendiente?»\nDel resto me encargo yo. Como siempre. 💅`,
    cool: `Ey ${name} ✌️ Stella por aquí. Escribe lo que tengas pendiente:\n• «Deberes de latín pág. 45 n.º 3 viernes»\n• «Examen de mates 12/11»\n• «¿qué tengo pendiente?»\nYo lo apunto y te aviso. Fácil.`,
  }),
  toneChanged: () => by({
    nett: 'Vale. A partir de ahora seré dulce contigo otra vez. 🌸',
    frech: '¿Puedo ser descarada? Esto va a ser divertido. 😏',
    cool: 'Entendido. A partir de ahora, modo tranqui. 😎',
  }),
}));

// ---------- Français (tutoiement) ----------
const fr = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Pour demain : ${label}`,
    frech: pick([`📚 Pour demain : ${label}. Et non, « j'ai oublié » ne compte pas. 😏`, `📚 ${label} pour demain. Devine qui y a pensé ? Moi. 🙄`], label),
    cool: `📚 Demain : ${label}. Vite fait, puis tranquille.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Demain : ${title}. Une dernière relecture – et au lit de bonne heure !`,
    frech: `🍀 ${title} demain. Téléphone posé, un dernier tour, et au lit. Oui, vraiment. 😏`,
    cool: `🍀 ${title} demain. Un coup d'œil, dodo tôt. Tu gères. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Pour demain : ${label}`,
    frech: `📌 Pour demain : ${label}. Tic-tac. ⏰`,
    cool: `📌 Demain : ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Rappel : ${label}`,
    frech: `⏰ Hé ! ${label}. Maintenant, pas tout à l'heure. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ C'est noté ! ${when}, je te rappelle « ${what} ».`,
    frech: `⏰ ${when}, je te harcèle avec « ${what} ». Promis. 😏`,
    cool: `⏰ ${when} : « ${what} ». Fait.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Noté : ${what}`,
    frech: pick([`✅ Encore quelque chose ? Bon, noté : ${what}`, `✅ Noté : ${what}. Moi j'écris, toi tu fais le reste. 😏`], what),
    cool: `✅ Ajouté : ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** est maintenant ${when}.`,
    frech: `📅 **${title}** repoussé à ${when}. Remettre à plus tard, tu sais faire. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** est supprimé.`,
    frech: `🗑️ **${title}** a disparu. Comme si de rien n'était. 💅`,
    cool: `🗑️ **${title}** supprimé.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 Sur la liste de courses : ${items}.`,
    frech: `🛒 ${items} – c'est dessus. Essaie de ne pas l'oublier cette fois. 😏`,
    cool: `🛒 Ajouté : ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 La liste de courses est vide – rien à acheter. ✨',
    frech: '🛒 Vide. Pour une fois, tu as tout. 😏',
    cool: '🛒 Liste vide. Nickel.',
  }),
  done: (title: string, left: number) => by({
    nett: `Bravo ! **${title}** est coché ✅${left ? ` Il reste ${left} pour demain.` : ''}`,
    frech: `Tiens donc, **${title}** fait ✅ Qui l'aurait cru. 😏${left ? ` Encore ${left} pour demain.` : ''}`,
    cool: `✅ **${title}** fait. Top.${left ? ` Encore ${left} pour demain.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Rien – tu es complètement à jour. ✨',
    frech: 'Rien. Je suis sincèrement impressionnée. 😏',
    cool: 'Rien. Tout est sous contrôle. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ Bonjour ${name} ! Ton ${weekday} :`,
    frech: `☀️ Debout, ${name} ! 😏 Ton ${weekday} :`,
    cool: `☀️ Salut ${name}. Ton ${weekday} :`,
  }),
  briefingQuiet: () => by({
    nett: 'Rien de spécial aujourd\'hui – profite de ta journée ! 🌸',
    frech: 'Rien au programme. Suspect. 👀',
    cool: 'Journée tranquille. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? 'Tu vas y arriver ! 💫' : 'Passe une belle journée ! 🌸',
    frech: busy ? 'Allez : téléphone posé, direction la journée. 😏' : 'Profite de ne rien faire. 😏',
    cool: busy ? 'Tu gères. ✌️' : 'Chill. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `Salut ${name} ! 👋 Moi, c'est Stella. Écris-moi simplement ce qui t'attend, par exemple :\n• « Devoirs de latin p. 45 n° 3 vendredi »\n• « Contrôle de maths 12/11 »\n• « qu'est-ce que j'ai à faire ? »\nJe note tout, je te préviens à temps et je te prépare des plans de révision. 💫`,
    frech: `Alors, ${name} ? 😏 Je suis Stella, et à partir de maintenant je retiens tout ce que tu oublies. Écris par exemple :\n• « Devoirs de latin p. 45 n° 3 vendredi »\n• « Contrôle de maths 12/11 »\n• « qu'est-ce que j'ai à faire ? »\nLe reste, c'est moi. Comme d'habitude. 💅`,
    cool: `Hey ${name} ✌️ Stella ici. Écris ce qui t'attend :\n• « Devoirs de latin p. 45 n° 3 vendredi »\n• « Contrôle de maths 12/11 »\n• « qu'est-ce que j'ai à faire ? »\nJe note et je te rappelle. Easy.`,
  }),
  toneChanged: () => by({
    nett: 'D\'accord ! À partir de maintenant, je suis de nouveau toute douce. 🌸',
    frech: 'Oh, j\'ai le droit d\'être taquine ? Ça va être drôle. 😏',
    cool: 'Compris. Mode cool à partir de maintenant. 😎',
  }),
}));

// ---------- Italiano (tu) ----------
const it = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Per domani: ${label}`,
    frech: pick([`📚 Per domani: ${label}. E no, «me ne sono dimenticato» non vale. 😏`, `📚 ${label} per domani. Indovina chi se n'è ricordata? Io. 🙄`], label),
    cool: `📚 Domani: ${label}. Sbrigala e poi relax.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Domani: ${title}. Un ultimo ripasso… e a letto presto!`,
    frech: `🍀 Domani ${title}. Telefono giù, un'ultima occhiata e a nanna. Sì, davvero. 😏`,
    cool: `🍀 Domani ${title}. Un'occhiata e a dormire presto. Ce la fai. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Per domani: ${label}`,
    frech: `📌 Per domani: ${label}. Tic tac. ⏰`,
    cool: `📌 Domani: ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Promemoria: ${label}`,
    frech: `⏰ Ehi! ${label}. Adesso, non dopo. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ Fatto! ${when} ti ricordo «${what}».`,
    frech: `⏰ ${when} ti stresso con «${what}». Promesso. 😏`,
    cool: `⏰ ${when}: «${what}». Ok.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Segnato: ${what}`,
    frech: pick([`✅ Ancora qualcosa? Va bene, segnato: ${what}`, `✅ Segnato: ${what}. Io scrivo, tu fai il resto. 😏`], what),
    cool: `✅ Aggiunto: ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** ora è ${when}.`,
    frech: `📅 **${title}** spostato a ${when}. Rimandare ti riesce benissimo. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** è stato eliminato.`,
    frech: `🗑️ **${title}** è sparito. Come se non fosse mai esistito. 💅`,
    cool: `🗑️ **${title}** eliminato.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 Sulla lista della spesa: ${items}.`,
    frech: `🛒 ${items}: è sulla lista. Cerca di non dimenticartene di nuovo. 😏`,
    cool: `🛒 Aggiunto: ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 La lista della spesa è vuota: niente da comprare. ✨',
    frech: '🛒 Vuota. Per una volta hai tutto. 😏',
    cool: '🛒 Lista vuota. Tutto ok.',
  }),
  done: (title: string, left: number) => by({
    nett: `Bravo! **${title}** spuntato ✅${left ? ` Per domani ne restano ${left}.` : ''}`,
    frech: `Guarda un po', **${title}** fatto ✅ Chi l'avrebbe detto. 😏${left ? ` Ne restano ${left} per domani.` : ''}`,
    cool: `✅ **${title}** fatto. Bene.${left ? ` Ne restano ${left} per domani.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Niente: sei perfettamente in pari. ✨',
    frech: 'Niente. Sono davvero colpita. 😏',
    cool: 'Niente. Tutto sotto controllo. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ Buongiorno, ${name}! Il tuo ${weekday}:`,
    frech: `☀️ Sveglia, ${name}! 😏 Il tuo ${weekday}:`,
    cool: `☀️ Ehi ${name}. Il tuo ${weekday}:`,
  }),
  briefingQuiet: () => by({
    nett: 'Oggi niente di particolare: goditi la giornata! 🌸',
    frech: 'Oggi non c\'è niente. Sospetto. 👀',
    cool: 'Oggi tutto tranquillo. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? 'Ce la farai! 💫' : 'Buona giornata! 🌸',
    frech: busy ? 'E adesso: telefono giù e vai a vivere la giornata. 😏' : 'Goditi il non fare niente. 😏',
    cool: busy ? 'Ce l\'hai. ✌️' : 'Relax. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `Ciao ${name}! 👋 Sono Stella. Scrivimi cosa hai in programma, per esempio:\n• «Compiti di latino p. 45 n. 3 venerdì»\n• «Verifica di matematica 12/11»\n• «cosa ho da fare?»\nLo segno, ti avviso in tempo e ti preparo i piani di studio. 💫`,
    frech: `Allora, ${name}? 😏 Sono Stella e da adesso mi ricordo io tutto quello che dimentichi tu. Scrivi per esempio:\n• «Compiti di latino p. 45 n. 3 venerdì»\n• «Verifica di matematica 12/11»\n• «cosa ho da fare?»\nAl resto penso io. Come sempre. 💅`,
    cool: `Ehi ${name} ✌️ Qui Stella. Scrivi cosa hai in programma:\n• «Compiti di latino p. 45 n. 3 venerdì»\n• «Verifica di matematica 12/11»\n• «cosa ho da fare?»\nLo segno e ti avviso. Facile.`,
  }),
  toneChanged: () => by({
    nett: 'Va bene! Da adesso sono di nuovo dolcissima con te. 🌸',
    frech: 'Posso essere sfacciata? Sarà divertente. 😏',
    cool: 'Ricevuto. Da adesso, modalità relax. 😎',
  }),
}));

// ---------- Português do Brasil (você) ----------
const ptBR = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Para amanhã: ${label}`,
    frech: pick([`📚 Para amanhã: ${label}. E «esqueci» não vale. 😏`, `📚 ${label} para amanhã. Adivinha quem lembrou? Eu. 🙄`], label),
    cool: `📚 Amanhã: ${label}. Resolve e já era.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Amanhã: ${title}. Uma última revisão… e dormir cedo!`,
    frech: `🍀 ${title} amanhã. Celular longe, uma última olhada e cama. Sim, é sério. 😏`,
    cool: `🍀 ${title} amanhã. Uma olhada e dorme cedo. Você tira de letra. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Para amanhã: ${label}`,
    frech: `📌 Para amanhã: ${label}. Tic-tac. ⏰`,
    cool: `📌 Amanhã: ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Lembrete: ${label}`,
    frech: `⏰ Ei! ${label}. Agora, não depois. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ Combinado! ${when} eu te lembro de «${what}».`,
    frech: `⏰ ${when} eu te cobro «${what}». Prometo. 😏`,
    cool: `⏰ ${when}: «${what}». Fechou.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Anotado: ${what}`,
    frech: pick([`✅ Mais uma? Tá, anotado: ${what}`, `✅ Anotado: ${what}. Eu anoto, você faz o resto. 😏`], what),
    cool: `✅ Tá aí: ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** agora é ${when}.`,
    frech: `📅 **${title}** empurrado para ${when}. Deixar para depois você faz bem. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** foi excluído.`,
    frech: `🗑️ **${title}** sumiu. Como se nunca tivesse existido. 💅`,
    cool: `🗑️ **${title}** excluído.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 Na lista de compras: ${items}.`,
    frech: `🛒 ${items}: tá na lista. Dessa vez tenta não esquecer. 😏`,
    cool: `🛒 Adicionado: ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 A lista de compras está vazia: nada para comprar. ✨',
    frech: '🛒 Vazia. Pela primeira vez você tem tudo. 😏',
    cool: '🛒 Lista vazia. De boa.',
  }),
  done: (title: string, left: number) => by({
    nett: `Boa! **${title}** marcado ✅${left ? ` Ainda faltam ${left} para amanhã.` : ''}`,
    frech: `Olha só, **${title}** feito ✅ Quem diria. 😏${left ? ` Faltam ${left} para amanhã.` : ''}`,
    cool: `✅ **${title}** feito. Show.${left ? ` Faltam ${left} para amanhã.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Nada: você está com tudo em dia. ✨',
    frech: 'Nada. Estou impressionada de verdade. 😏',
    cool: 'Nada. Tudo sob controle. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ Bom dia, ${name}! Sua ${weekday}:`,
    frech: `☀️ Acorda, ${name}! 😏 Sua ${weekday}:`,
    cool: `☀️ E aí, ${name}. Sua ${weekday}:`,
  }),
  briefingQuiet: () => by({
    nett: 'Hoje não tem nada de especial: aproveite o dia! 🌸',
    frech: 'Hoje não tem nada. Suspeito. 👀',
    cool: 'Hoje, de boa. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? 'Você consegue! 💫' : 'Tenha um ótimo dia! 🌸',
    frech: busy ? 'Agora: celular longe e bora viver o dia. 😏' : 'Aproveite para não fazer nada. 😏',
    cool: busy ? 'Tira de letra. ✌️' : 'Relax. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `Oi, ${name}! 👋 Eu sou a Stella. É só me contar o que vem por aí, por exemplo:\n• «Lição de latim p. 45 n.º 3 sexta»\n• «Prova de matemática 12/11»\n• «o que tenho para fazer?»\nEu anoto, te aviso a tempo e monto planos de estudo. 💫`,
    frech: `E aí, ${name}? 😏 Eu sou a Stella e, a partir de agora, lembro de tudo que você esquece. Escreve, por exemplo:\n• «Lição de latim p. 45 n.º 3 sexta»\n• «Prova de matemática 12/11»\n• «o que tenho para fazer?»\nO resto é comigo. Como sempre. 💅`,
    cool: `Fala, ${name} ✌️ Stella aqui. Escreve o que vem por aí:\n• «Lição de latim p. 45 n.º 3 sexta»\n• «Prova de matemática 12/11»\n• «o que tenho para fazer?»\nEu anoto e te lembro. Simples.`,
  }),
  toneChanged: () => by({
    nett: 'Certo! A partir de agora volto a ser toda fofa com você. 🌸',
    frech: 'Ah, posso ser atrevida? Vai ser divertido. 😏',
    cool: 'Beleza. A partir de agora, modo de boa. 😎',
  }),
}));

// ---------- Türkçe (sen) ----------
const tr = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Yarına: ${label}`,
    frech: pick([`📚 Yarına: ${label}. Ve "unuttum" sayılmaz. 😏`, `📚 ${label} yarına. Kim hatırladı, tahmin et? Ben. 🙄`], label),
    cool: `📚 Yarın: ${label}. Hallet, sonra rahat.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Yarın ${title} var. Son bir tekrar… ve erken yat!`,
    frech: `🍀 Yarın ${title}. Telefonu bırak, bir tekrar daha, sonra yatak. Evet, ciddiyim. 😏`,
    cool: `🍀 Yarın ${title}. Bir göz at, erken uyu. Hallederesin. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Yarına: ${label}`,
    frech: `📌 Yarına: ${label}. Tik tak. ⏰`,
    cool: `📌 Yarın: ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Hatırlatma: ${label}`,
    frech: `⏰ Hey! ${label}. Şimdi, birazdan değil. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ Tamamdır! ${when} sana "${what}" için hatırlatırım.`,
    frech: `⏰ ${when} "${what}" diye başının etini yiyeceğim. Söz. 😏`,
    cool: `⏰ ${when}: "${what}". Tamamdır.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Not aldım: ${what}`,
    frech: pick([`✅ Yine mi bir şey? Peki, yazdım: ${what}`, `✅ Yazdım: ${what}. Ben yazarım, gerisi senin. 😏`], what),
    cool: `✅ Eklendi: ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** artık ${when}.`,
    frech: `📅 **${title}** ${when} gününe ertelendi. Ertelemekte üstüne yok. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** silindi.`,
    frech: `🗑️ **${title}** uçtu gitti. Hiç olmamış gibi. 💅`,
    cool: `🗑️ **${title}** silindi.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 Alışveriş listesine eklendi: ${items}.`,
    frech: `🛒 ${items} listede. Bu sefer unutma da görelim. 😏`,
    cool: `🛒 Eklendi: ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 Alışveriş listesi boş: alınacak bir şey yok. ✨',
    frech: '🛒 Boş. Bir kereliğine her şeyin var. 😏',
    cool: '🛒 Liste boş. Sorun yok.',
  }),
  done: (title: string, left: number) => by({
    nett: `Harika! **${title}** tamamlandı ✅${left ? ` Yarın için ${left} tane daha var.` : ''}`,
    frech: `Bak sen, **${title}** bitti ✅ Kim derdi. 😏${left ? ` Yarın için ${left} tane kaldı.` : ''}`,
    cool: `✅ **${title}** bitti. Güzel.${left ? ` Yarın için ${left} tane kaldı.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Hiçbir şey: her şey yolunda. ✨',
    frech: 'Hiçbir şey. Gerçekten etkilendim. 😏',
    cool: 'Hiçbir şey. Her şey kontrol altında. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ Günaydın ${name}! ${weekday} günün:`,
    frech: `☀️ Kalk bakalım ${name}! 😏 ${weekday} günün:`,
    cool: `☀️ Selam ${name}. ${weekday} günün:`,
  }),
  briefingQuiet: () => by({
    nett: 'Bugün özel bir şey yok: günün tadını çıkar! 🌸',
    frech: 'Bugün hiçbir şey yok. Şüpheli. 👀',
    cool: 'Bugün rahat. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? 'Başaracaksın! 💫' : 'Güzel bir gün geçir! 🌸',
    frech: busy ? 'Şimdi telefonu bırak, güne karış. 😏' : 'Keyfini çıkar, hiçbir şey yapma. 😏',
    cool: busy ? 'Hallederesin. ✌️' : 'Rahat ol. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `Merhaba ${name}! 👋 Ben Stella. Önünde ne var, kısaca yaz; örneğin:\n• "Latince ödevi s. 45 no. 3 cuma"\n• "Matematik sınavı 12.11."\n• "neler var?"\nBen yazarım, zamanında hatırlatırım, çalışma planları çıkarırım. 💫`,
    frech: `Eee, ${name}? 😏 Ben Stella; bundan sonra senin unuttuğun her şeyi ben hatırlarım. Şöyle yaz:\n• "Latince ödevi s. 45 no. 3 cuma"\n• "Matematik sınavı 12.11."\n• "neler var?"\nGerisini ben hallederim. Her zamanki gibi. 💅`,
    cool: `Selam ${name} ✌️ Stella burada. Önünde ne varsa yaz:\n• "Latince ödevi s. 45 no. 3 cuma"\n• "Matematik sınavı 12.11."\n• "neler var?"\nBen eklerim, hatırlatırım. Kolay.`,
  }),
  toneChanged: () => by({
    nett: 'Tamam! Bundan sonra yine çok tatlı olacağım. 🌸',
    frech: 'Şakacı olabilir miyim? Eğlenceli olacak. 😏',
    cool: 'Anlaşıldı. Bundan sonra rahat mod. 😎',
  }),
}));

// ---------- Polski (ty) ----------
const pl = make((by) => ({
  homeworkTomorrow: (label: string) => by({
    nett: `📚 Na jutro: ${label}`,
    frech: pick([`📚 Na jutro: ${label}. I nie, „wyleciało mi z głowy” się nie liczy. 😏`, `📚 ${label} na jutro. Zgadnij, kto pamiętał? Ja. 🙄`], label),
    cool: `📚 Jutro: ${label}. Ogarnij i po sprawie.`,
  }),
  examTomorrow: (title: string) => by({
    nett: `🍀 Jutro: ${title}. Ostatnia powtórka… i wcześnie spać!`,
    frech: `🍀 Jutro ${title}. Telefon na bok, jeszcze raz przejrzeć i do łóżka. Tak, serio. 😏`,
    cool: `🍀 Jutro ${title}. Rzut oka i spać. Dasz radę. ✌️`,
  }),
  dueTomorrow: (label: string) => by({
    nett: `📌 Na jutro: ${label}`,
    frech: `📌 Na jutro: ${label}. Tik-tak. ⏰`,
    cool: `📌 Jutro: ${label}.`,
  }),
  reminderNow: (label: string) => by({
    nett: `⏰ Przypomnienie: ${label}`,
    frech: `⏰ Hej! ${label}. Teraz, nie za chwilę. 😏`,
    cool: `⏰ ${label}.`,
  }),
  remindSet: (when: string, what: string) => by({
    nett: `⏰ Załatwione! ${when} przypomnę Ci o „${what}”.`,
    frech: `⏰ ${when} będę Cię męczyć „${what}”. Obiecuję. 😏`,
    cool: `⏰ ${when}: „${what}”. Jest.`,
  }),
  noted: (what: string) => by({
    nett: `✅ Zapisane: ${what}`,
    frech: pick([`✅ Znowu coś? No dobra, zapisane: ${what}`, `✅ Zapisane: ${what}. Ja zapisuję, Ty robisz resztę. 😏`], what),
    cool: `✅ Dodane: ${what}`,
  }),
  moved: (title: string, when: string) => by({
    nett: `📅 **${title}** jest teraz ${when}.`,
    frech: `📅 **${title}** przesunięte na ${when}. Odkładanie idzie Ci świetnie. 😏`,
    cool: `📅 **${title}** → ${when}.`,
  }),
  deleted: (title: string) => by({
    nett: `🗑️ **${title}** usunięte.`,
    frech: `🗑️ **${title}** zniknęło. Jakby nigdy go nie było. 💅`,
    cool: `🗑️ **${title}** usunięte.`,
  }),
  listAdded: (items: string) => by({
    nett: `🛒 Na liście zakupów: ${items}.`,
    frech: `🛒 ${items} – jest na liście. Tym razem postaraj się nie zapomnieć. 😏`,
    cool: `🛒 Dodane: ${items}.`,
  }),
  listEmpty: () => by({
    nett: '🛒 Lista zakupów jest pusta – nic do kupienia. ✨',
    frech: '🛒 Pusto. Po raz pierwszy masz wszystko. 😏',
    cool: '🛒 Lista pusta. Spoko.',
  }),
  done: (title: string, left: number) => by({
    nett: `Super! **${title}** odhaczone ✅${left ? ` Na jutro zostało jeszcze ${left}.` : ''}`,
    frech: `No proszę, **${title}** zrobione ✅ Kto by pomyślał. 😏${left ? ` Zostało ${left} na jutro.` : ''}`,
    cool: `✅ **${title}** zrobione. Fajnie.${left ? ` Zostało ${left} na jutro.` : ''}`,
  }),
  nothingForgotten: () => by({
    nett: 'Nic – wszystko masz na bieżąco. ✨',
    frech: 'Nic. Jestem pod wrażeniem, serio. 😏',
    cool: 'Nic. Wszystko pod kontrolą. 😎',
  }),
  briefingGreeting: (name: string, weekday: string) => by({
    nett: `☀️ Dzień dobry, ${name}! Twój ${weekday}:`,
    frech: `☀️ Pobudka, ${name}! 😏 Twój ${weekday}:`,
    cool: `☀️ Hej ${name}. Twój ${weekday}:`,
  }),
  briefingQuiet: () => by({
    nett: 'Dziś nic szczególnego – ciesz się dniem! 🌸',
    frech: 'Dziś nic się nie dzieje. Podejrzane. 👀',
    cool: 'Dziś na luzie. 😎',
  }),
  briefingClosing: (busy: boolean) => by({
    nett: busy ? 'Dasz radę! 💫' : 'Miłego dnia! 🌸',
    frech: busy ? 'A teraz: telefon na bok i w świat. 😏' : 'Ciesz się nicnierobieniem. 😏',
    cool: busy ? 'Ogarniesz. ✌️' : 'Luz. ✌️',
  }),
  welcome: (name: string) => by({
    nett: `Cześć ${name}! 👋 Jestem Stella. Napisz mi po prostu, co masz do zrobienia, na przykład:\n• „Zadanie z łaciny s. 45 nr 3 piątek”\n• „Sprawdzian z matmy 12.11.”\n• „co mam do zrobienia?”\nZapiszę to, przypomnę w porę i ułożę plan nauki. 💫`,
    frech: `No i co, ${name}? 😏 Jestem Stella i od teraz pamiętam wszystko, o czym Ty zapominasz. Napisz na przykład:\n• „Zadanie z łaciny s. 45 nr 3 piątek”\n• „Sprawdzian z matmy 12.11.”\n• „co mam do zrobienia?”\nResztą zajmę się ja. Jak zawsze. 💅`,
    cool: `Hej ${name} ✌️ Tu Stella. Napisz, co masz na głowie:\n• „Zadanie z łaciny s. 45 nr 3 piątek”\n• „Sprawdzian z matmy 12.11.”\n• „co mam do zrobienia?”\nJa zapiszę i przypomnę. Proste.`,
  }),
  toneChanged: () => by({
    nett: 'Dobrze! Od teraz znowu jestem dla Ciebie bardzo miła. 🌸',
    frech: 'Mogę być zadziorna? Będzie zabawnie. 😏',
    cool: 'Jasne. Od teraz tryb na luzie. 😎',
  }),
}));

export const PARTIAL_VOICES: Partial<Record<Locale, Maker>> = { es, fr, it, 'pt-BR': ptBR, tr, pl };
