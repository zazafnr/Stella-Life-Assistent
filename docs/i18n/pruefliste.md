# Prüfliste für Muttersprachler:innen

> Automatisch erzeugt von `scripts/i18n-review.ts`. Bitte gegenlesen: klingt es natürlich, passt der Ton, stimmen die Schulbegriffe? Rückmeldungen als Änderung in `shared/src/i18n/catalog/<sprache>.json` (und `voice.more.ts`).

## Deutsch (`de`)

| Schlüssel | English | Deutsch |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Stella kümmert sich um den Rest. |
| `onboarding.welcome.title` | Great to have you here! | Schön, dass du da bist! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Ich bin Stella und helfe dir im Alltag. Mit ein paar Klicks stelle ich mich auf dein Leben ein – das dauert eine Minute. |
| `onboarding.name.title` | What should I call you? | Wie soll ich dich nennen? |
| `onboarding.situation.title` | What describes you best? | Was trifft auf dich zu? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, Tests, Stundenplan |
| `onboarding.features.title` | What should Stella help with? | Wobei soll Stella helfen? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Wenn du magst, sortiert Stella deine Mails in Wichtig, Neutral, Unwichtig und Werbung. Das geht mit Gmail (per „Mit Google anmelden“) oder iCloud. |
| `onboarding.tone.title` | How should I sound? | Wie soll ich klingen? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Wann soll ich dir das Morgen-Briefing schicken? |
| `onboarding.done.title` | All set, Mia! | Alles bereit, Mia! |
| `onboarding.done.start` | Let's go | Los geht's |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | Notiert! Ich erinnere dich morgen um 19:00. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Schon wieder Latein? Na gut, notiert – ich nerv dich morgen um 19:00. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Läuft. Steht drin, Reminder morgen 19:00. |
| `briefing.nothing` | Nothing special today. | Heute steht nichts Besonderes an. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Alle Stunden entfallen 🎉 |
| `error.generic` | Something went wrong. Please try again. | Da ist etwas schiefgelaufen. Bitte versuch es nochmal. |
| `error.network` | No connection to the server. | Keine Verbindung zum Server. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Dein Konto ist noch nicht bestätigt. Gib den Code aus der Mail ein – oder fordere einen neuen an. |
| `chat.empty` | How can I help? Type something – or just start talking. | Wobei kann ich dir helfen? Tipp etwas an – oder sprich einfach los. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Du bist offline – ich hab die Nachricht gespeichert und schicke sie, sobald du wieder Netz hast. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Ich finde gerade nichts, was ich rückgängig machen könnte. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Nichts offen – genieß den Tag! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | Sonntagabend schlägt Stella einen Plan für die neue Woche vor |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Erinnerungen, Daueraufträge, Automatiken – ändern oder abstellen |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | HÜs lösen, Planer ändern, Werbung löschen … |
| `quick.forgot.text` | Did I forget anything? | Hab ich was vergessen? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Kein Datum erkannt – ich hab den nächsten Schultag genommen. Schreib z. B. „{subject} HÜ bis Freitag“, wenn's anders ist.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Bestätige deine E-Mail-Adresse, dann kann es mit Stella losgehen. Öffne den Link am besten auf dem Gerät, auf dem du dich anmeldest. |
| `email.verifySignup.button` | Confirm sign-up | Anmeldung bestätigen |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Dein Konto ist bestätigt. So holst du in den ersten Minuten das Meiste aus Stella heraus. |
| `email.welcome.title` | Welcome, Mia | Willkommen, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Dein Konto ist bestätigt. So holst du in den ersten Minuten das Meiste aus Stella heraus. |
| `email.reply.title` | Stella's reply | Stellas Antwort |
| `email.unknown.title` | Nice to meet you | Schön, dass du schreibst |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Ich bin Stella, eine persönliche Assistentin für Schule, Job und Alltag. Diese Adresse kenne ich noch nicht und kann deshalb nicht antworten. |
| `email.subscription.started.title` | Welcome to {plan} | Willkommen bei {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Danke dir. Deine Limits sind sofort höher. Die Rechnung schickt Stripe separat. |
| `email.subscription.changed.title` | You are on {plan} now | Du bist jetzt bei {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Dein Abo wurde geändert. Die neuen Limits gelten ab sofort. |
| `email.subscription.cancelled.title` | Subscription cancelled | Abo gekündigt |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | Du behältst {plan} bis {until}. Danach läuft Stella mit dem kostenlosen Abo weiter. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Dafür bräuchte ich deinen Standort. Nur während du Stella benutzt, und er wird nicht gespeichert. Freigeben? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Deutsch |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Guten Morgen, Mia! Dein morgen: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ Mach ich! Ich erinnere dich morgen an „…“. |
| nett · Eintrag | ✅ Noted: Math test | ✅ Notiert: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Aufstehen, Mia! 😏 Dein morgen: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ morgen nerv ich dich wegen „…“. Versprochen. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Schon wieder was? Na gut, notiert: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Morgen, Mia. Dein morgen: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ morgen: „…“. Steht. |
| cool · Eintrag | ✅ Added: Math test | ✅ Steht drin: … |

## Español (`es`)

| Schlüssel | English | Español |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Deja que Stella se encargue. |
| `onboarding.welcome.title` | Great to have you here! | ¡Qué bien tenerte aquí! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Soy Stella y te ayudo en el día a día. Con unos toques me adapto a tu vida; solo tardas un minuto. |
| `onboarding.name.title` | What should I call you? | ¿Cómo quieres que te llame? |
| `onboarding.situation.title` | What describes you best? | ¿Qué te describe mejor? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, exámenes, horario |
| `onboarding.features.title` | What should Stella help with? | ¿En qué quieres que te ayude Stella? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Si quieres, Stella ordena tus correos en importantes, neutros, sin importancia y publicidad. Funciona con Gmail (con «Iniciar sesión con Google») o iCloud. |
| `onboarding.tone.title` | How should I sound? | ¿Cómo quieres que suene? |
| `onboarding.briefing.title` | When should I send your morning briefing? | ¿Cuándo te mando el resumen de la mañana? |
| `onboarding.done.title` | All set, Mia! | ¡Todo listo, Mia! |
| `onboarding.done.start` | Let's go | ¡Vamos! |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | ¡Apuntado! Mañana a las 19:00 te lo recuerdo. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | ¿Latín otra vez? Vale, apuntado. Mañana a las 19:00 te doy la lata. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Hecho. Está dentro, aviso mañana a las 19:00. |
| `briefing.nothing` | Nothing special today. | Hoy no hay nada especial. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Hoy no hay ninguna clase 🎉 |
| `error.generic` | Something went wrong. Please try again. | Algo ha salido mal. Inténtalo de nuevo. |
| `error.network` | No connection to the server. | No hay conexión con el servidor. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Tu cuenta aún no está confirmada. Escribe el código del correo o pide uno nuevo. |
| `chat.empty` | How can I help? Type something – or just start talking. | ¿En qué te ayudo? Escribe algo o simplemente habla. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Estás sin conexión: he guardado el mensaje y lo envío en cuanto vuelvas a tener red. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Ahora mismo no encuentro nada que pueda deshacer. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Nada pendiente: ¡disfruta del día! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | El domingo por la noche Stella te propone un plan para la semana |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Recordatorios, tareas periódicas, automatizaciones: cámbialos o páralos |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Resolver deberes, cambiar la agenda, borrar publicidad… |
| `quick.forgot.text` | Did I forget anything? | ¿Me estoy olvidando de algo? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(No he encontrado fecha: he cogido el próximo día de clase. Escribe, por ejemplo, «{subject} deberes hasta el viernes» si es otro.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Confirma tu correo para empezar con Stella. Abre el enlace en el dispositivo en el que te estás registrando. |
| `email.verifySignup.button` | Confirm sign-up | Confirmar registro |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Tu cuenta está confirmada. Así sacas el máximo de Stella en los primeros minutos. |
| `email.welcome.title` | Welcome, Mia | Te damos la bienvenida, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Tu cuenta está confirmada. Así sacas el máximo de Stella en los primeros minutos. |
| `email.reply.title` | Stella's reply | La respuesta de Stella |
| `email.unknown.title` | Nice to meet you | Encantada de conocerte |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Soy Stella, una asistente personal para el colegio, el trabajo y el día a día. Todavía no conozco esta dirección, así que no puedo responderte. |
| `email.subscription.started.title` | Welcome to {plan} | Te damos la bienvenida a {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Gracias. Tus límites suben de inmediato. Stripe envía la factura por separado. |
| `email.subscription.changed.title` | You are on {plan} now | Ahora estás en {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Tu plan se ha cambiado. Los nuevos límites valen desde ahora. |
| `email.subscription.cancelled.title` | Subscription cancelled | Suscripción cancelada |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | Conservas {plan} hasta el {until}. Después, Stella sigue con el plan gratuito. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Para esto necesitaría tu ubicación. Solo mientras usas Stella, y no se guarda. ¿Permitirla? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Español |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ ¡Buenos días, Mia! Tu mañana: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ ¡Hecho! mañana te recuerdo «…». |
| nett · Eintrag | ✅ Noted: Math test | ✅ Apuntado: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ ¡Arriba, Mia! 😏 Tu mañana: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ mañana te doy la lata con «…». Prometido. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ ¿Otra cosa más? Vale, apuntado: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Buenas, Mia. Tu mañana: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ mañana: «…». Listo. |
| cool · Eintrag | ✅ Added: Math test | ✅ Anotado: … |

## Français (`fr`)

| Schlüssel | English | Français |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Laisse Stella s'en occuper. |
| `onboarding.welcome.title` | Great to have you here! | Contente de te voir ! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Je suis Stella et je t'aide au quotidien. En quelques touches, je m'adapte à ta vie – ça prend une minute. |
| `onboarding.name.title` | What should I call you? | Comment dois-je t'appeler ? |
| `onboarding.situation.title` | What describes you best? | Qu'est-ce qui te correspond le mieux ? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, contrôles, emploi du temps |
| `onboarding.features.title` | What should Stella help with? | Pour quoi Stella doit-elle t'aider ? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Si tu veux, Stella trie tes e-mails en importants, neutres, sans importance et pubs. Ça marche avec Gmail (via « Se connecter avec Google ») ou iCloud. |
| `onboarding.tone.title` | How should I sound? | Sur quel ton dois-je te parler ? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Quand dois-je t'envoyer ton point du matin ? |
| `onboarding.done.title` | All set, Mia! | Tout est prêt, Mia ! |
| `onboarding.done.start` | Let's go | C'est parti |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | C'est noté ! Je te rappelle demain à 19 h. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Encore du latin ? Bon, c'est noté. Demain à 19 h, je te harcèle. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Ça marche. C'est dedans, rappel demain 19 h. |
| `briefing.nothing` | Nothing special today. | Rien de spécial aujourd'hui. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Tous les cours sont annulés 🎉 |
| `error.generic` | Something went wrong. Please try again. | Quelque chose s'est mal passé. Réessaie. |
| `error.network` | No connection to the server. | Pas de connexion au serveur. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Ton compte n'est pas encore confirmé. Saisis le code reçu par e-mail – ou demandes-en un nouveau. |
| `chat.empty` | How can I help? Type something – or just start talking. | Comment puis-je t'aider ? Écris quelque chose – ou parle, tout simplement. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Tu es hors ligne – j'ai gardé le message et je l'envoie dès que tu as du réseau. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Je ne vois rien que je puisse annuler pour l'instant. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Rien à faire – profite de ta journée ! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | Le dimanche soir, Stella te propose un plan pour la nouvelle semaine |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Rappels, tâches récurrentes, automatismes – modifie-les ou arrête-les |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Résoudre les devoirs, modifier l'agenda, supprimer les pubs… |
| `quick.forgot.text` | Did I forget anything? | Est-ce que j'ai oublié quelque chose ? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Pas de date trouvée – j'ai pris le prochain jour de classe. Écris par ex. « {subject} devoirs pour vendredi » si c'est différent.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Confirme ton adresse e-mail pour démarrer avec Stella. Ouvre le lien sur l'appareil où tu t'inscris. |
| `email.verifySignup.button` | Confirm sign-up | Confirmer l'inscription |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Ton compte est confirmé. Voici comment tirer le meilleur de Stella dès les premières minutes. |
| `email.welcome.title` | Welcome, Mia | Bienvenue, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Ton compte est confirmé. Voici comment tirer le meilleur de Stella dès les premières minutes. |
| `email.reply.title` | Stella's reply | La réponse de Stella |
| `email.unknown.title` | Nice to meet you | Ravie de te rencontrer |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Je suis Stella, une assistante personnelle pour l'école, le travail et le quotidien. Je ne connais pas encore cette adresse, je ne peux donc pas te répondre. |
| `email.subscription.started.title` | Welcome to {plan} | Bienvenue dans {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Merci. Tes limites augmentent tout de suite. Stripe envoie la facture séparément. |
| `email.subscription.changed.title` | You are on {plan} now | Tu es maintenant sur {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Ton abonnement a été modifié. Les nouvelles limites s'appliquent dès maintenant. |
| `email.subscription.cancelled.title` | Subscription cancelled | Abonnement résilié |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | Tu gardes {plan} jusqu'au {until}. Ensuite, Stella continue avec l'offre gratuite. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Pour cela, j’aurais besoin de ta position. Seulement pendant que tu utilises Stella, et elle n’est pas enregistrée. L’autoriser ? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Français |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Bonjour Mia ! Ton demain : |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ C'est noté ! demain, je te rappelle « … ». |
| nett · Eintrag | ✅ Noted: Math test | ✅ Noté : … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Debout, Mia ! 😏 Ton demain : |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ demain, je te harcèle avec « … ». Promis. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Encore quelque chose ? Bon, noté : … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Salut Mia. Ton demain : |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ demain : « … ». Fait. |
| cool · Eintrag | ✅ Added: Math test | ✅ Ajouté : … |

## Italiano (`it`)

| Schlüssel | English | Italiano |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Lascia fare a Stella. |
| `onboarding.welcome.title` | Great to have you here! | Che bello averti qui! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Sono Stella e ti do una mano ogni giorno. Con qualche tocco mi adatto alla tua vita: ci vuole un minuto. |
| `onboarding.name.title` | What should I call you? | Come ti devo chiamare? |
| `onboarding.situation.title` | What describes you best? | Cosa ti descrive meglio? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, verifiche, orario |
| `onboarding.features.title` | What should Stella help with? | In cosa deve aiutarti Stella? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Se vuoi, Stella ordina le tue e-mail in importanti, neutre, poco importanti e pubblicità. Funziona con Gmail (con «Accedi con Google») o iCloud. |
| `onboarding.tone.title` | How should I sound? | Come devo parlarti? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Quando ti mando il riepilogo del mattino? |
| `onboarding.done.title` | All set, Mia! | Tutto pronto, Mia! |
| `onboarding.done.start` | Let's go | Si parte |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | Segnato! Domani alle 19 ti ricordo tutto. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Di nuovo latino? Va bene, segnato. Domani alle 19 ti stresso io. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Fatto. È dentro, promemoria domani alle 19. |
| `briefing.nothing` | Nothing special today. | Oggi niente di particolare. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Tutte le lezioni sono annullate 🎉 |
| `error.generic` | Something went wrong. Please try again. | Qualcosa è andato storto. Riprova. |
| `error.network` | No connection to the server. | Nessuna connessione al server. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Il tuo account non è ancora confermato. Inserisci il codice dell'e-mail o chiedine uno nuovo. |
| `chat.empty` | How can I help? Type something – or just start talking. | Come posso aiutarti? Scrivi qualcosa o parla pure. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Sei offline: ho salvato il messaggio e lo invio appena torna la connessione. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Al momento non trovo niente da annullare. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Niente in sospeso: goditi la giornata! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | La domenica sera Stella ti propone un piano per la nuova settimana |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Promemoria, attività ricorrenti, automazioni: modificali o fermali |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Risolvere i compiti, modificare l'agenda, eliminare la pubblicità… |
| `quick.forgot.text` | Did I forget anything? | Ho dimenticato qualcosa? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Nessuna data trovata: ho preso il prossimo giorno di scuola. Scrivi ad es. «{subject} compiti per venerdì» se è un altro giorno.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Conferma il tuo indirizzo e-mail per iniziare con Stella. Apri il link sul dispositivo con cui ti stai registrando. |
| `email.verifySignup.button` | Confirm sign-up | Conferma registrazione |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Il tuo account è confermato. Ecco come sfruttare al meglio Stella fin dai primi minuti. |
| `email.welcome.title` | Welcome, Mia | Benvenuto, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Il tuo account è confermato. Ecco come sfruttare al meglio Stella fin dai primi minuti. |
| `email.reply.title` | Stella's reply | La risposta di Stella |
| `email.unknown.title` | Nice to meet you | Piacere di conoscerti |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Sono Stella, un'assistente personale per scuola, lavoro e vita di tutti i giorni. Non conosco ancora questo indirizzo, quindi non posso risponderti. |
| `email.subscription.started.title` | Welcome to {plan} | Benvenuto in {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Grazie. I tuoi limiti salgono subito. La fattura la invia Stripe a parte. |
| `email.subscription.changed.title` | You are on {plan} now | Ora sei su {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Il tuo abbonamento è stato modificato. I nuovi limiti valgono da subito. |
| `email.subscription.cancelled.title` | Subscription cancelled | Abbonamento annullato |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | Mantieni {plan} fino al {until}. Poi Stella continua con il piano gratuito. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Per questo mi servirebbe la tua posizione. Solo mentre usi Stella, e non viene salvata. La consenti? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Italiano |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Buongiorno, Mia! Il tuo domani: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ Fatto! domani ti ricordo «…». |
| nett · Eintrag | ✅ Noted: Math test | ✅ Segnato: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Sveglia, Mia! 😏 Il tuo domani: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ domani ti stresso con «…». Promesso. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Ancora qualcosa? Va bene, segnato: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Ehi Mia. Il tuo domani: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ domani: «…». Ok. |
| cool · Eintrag | ✅ Added: Math test | ✅ Aggiunto: … |

## Português (Brasil) (`pt-BR`)

| Schlüssel | English | Português (Brasil) |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Deixa com a Stella. |
| `onboarding.welcome.title` | Great to have you here! | Que bom ter você aqui! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Eu sou a Stella e te ajudo no dia a dia. Com alguns toques eu me ajusto à sua vida, leva só um minuto. |
| `onboarding.name.title` | What should I call you? | Como devo te chamar? |
| `onboarding.situation.title` | What describes you best? | O que combina mais com você? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, provas, horário de aulas |
| `onboarding.features.title` | What should Stella help with? | Com o que a Stella deve te ajudar? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Se quiser, a Stella organiza seus e-mails em importantes, neutros, sem importância e propaganda. Funciona com Gmail (com «Entrar com o Google») ou iCloud. |
| `onboarding.tone.title` | How should I sound? | Como devo falar com você? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Quando devo mandar seu resumo da manhã? |
| `onboarding.done.title` | All set, Mia! | Tudo pronto, Mia! |
| `onboarding.done.start` | Let's go | Bora |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | Anotado! Amanhã às 19h eu te lembro. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Latim de novo? Tá, anotado. Amanhã às 19h eu te cobro. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Fechou. Tá aí, lembrete amanhã às 19h. |
| `briefing.nothing` | Nothing special today. | Hoje não tem nada de especial. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Todas as aulas foram canceladas 🎉 |
| `error.generic` | Something went wrong. Please try again. | Algo deu errado. Tente de novo. |
| `error.network` | No connection to the server. | Sem conexão com o servidor. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Sua conta ainda não foi confirmada. Digite o código do e-mail ou peça um novo. |
| `chat.empty` | How can I help? Type something – or just start talking. | Como posso ajudar? Escreva algo ou simplesmente fale. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Você está offline: guardei a mensagem e envio assim que voltar a ter conexão. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | No momento não encontro nada que eu possa desfazer. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Nada pendente: aproveite o dia! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | No domingo à noite a Stella sugere um plano para a nova semana |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Lembretes, tarefas recorrentes, automações: mude ou pare |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Resolver lição, mexer na agenda, apagar propaganda… |
| `quick.forgot.text` | Did I forget anything? | Será que esqueci alguma coisa? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Não achei data: peguei o próximo dia de aula. Escreva, por exemplo, «{subject} lição até sexta» se for outro dia.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Confirme seu e-mail para começar com a Stella. Abra o link no aparelho em que você está se cadastrando. |
| `email.verifySignup.button` | Confirm sign-up | Confirmar cadastro |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Sua conta está confirmada. Veja como aproveitar a Stella desde os primeiros minutos. |
| `email.welcome.title` | Welcome, Mia | Boas-vindas, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Sua conta está confirmada. Veja como aproveitar a Stella desde os primeiros minutos. |
| `email.reply.title` | Stella's reply | A resposta da Stella |
| `email.unknown.title` | Nice to meet you | Prazer em conhecer você |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Eu sou a Stella, uma assistente pessoal para escola, trabalho e o dia a dia. Ainda não conheço este endereço, então não posso responder. |
| `email.subscription.started.title` | Welcome to {plan} | Boas-vindas ao {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Obrigada. Seus limites aumentam na hora. A fatura é enviada separadamente pelo Stripe. |
| `email.subscription.changed.title` | You are on {plan} now | Agora você está no {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Seu plano foi alterado. Os novos limites valem a partir de agora. |
| `email.subscription.cancelled.title` | Subscription cancelled | Assinatura cancelada |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | Você mantém o {plan} até {until}. Depois, a Stella continua no plano gratuito. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Para isso eu precisaria da sua localização. Só enquanto você usa a Stella, e ela não é guardada. Permitir? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Português (Brasil) |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Bom dia, Mia! Sua amanhã: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ Combinado! amanhã eu te lembro de «…». |
| nett · Eintrag | ✅ Noted: Math test | ✅ Anotado: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Acorda, Mia! 😏 Sua amanhã: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ amanhã eu te cobro «…». Prometo. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Mais uma? Tá, anotado: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ E aí, Mia. Sua amanhã: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ amanhã: «…». Fechou. |
| cool · Eintrag | ✅ Added: Math test | ✅ Tá aí: … |

## Türkçe (`tr`)

| Schlüssel | English | Türkçe |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Gerisini Stella halleder. |
| `onboarding.welcome.title` | Great to have you here! | İyi ki geldin! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Ben Stella, günlük hayatta sana yardım ederim. Birkaç dokunuşla kendimi hayatına göre ayarlarım, bir dakika sürer. |
| `onboarding.name.title` | What should I call you? | Sana ne diyeyim? |
| `onboarding.situation.title` | What describes you best? | Seni en iyi ne anlatıyor? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, sınavlar, ders programı |
| `onboarding.features.title` | What should Stella help with? | Stella sana hangi konularda yardım etsin? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | İstersen Stella e-postalarını önemli, nötr, önemsiz ve reklam diye ayırır. Gmail ("Google ile giriş yap" üzerinden) veya iCloud ile çalışır. |
| `onboarding.tone.title` | How should I sound? | Nasıl konuşayım? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Sabah özetini ne zaman göndereyim? |
| `onboarding.done.title` | All set, Mia! | Hazırız, Mia! |
| `onboarding.done.start` | Let's go | Başlayalım |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | Tamam, not aldım! Yarın saat 19.00'da hatırlatırım. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Yine Latince mi? Peki, yazdım. Yarın 19.00'da başının etini yerim. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Tamamdır. Eklendi, yarın 19.00'da hatırlatma var. |
| `briefing.nothing` | Nothing special today. | Bugün özel bir şey yok. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Bütün dersler iptal 🎉 |
| `error.generic` | Something went wrong. Please try again. | Bir şeyler ters gitti. Lütfen tekrar dene. |
| `error.network` | No connection to the server. | Sunucuyla bağlantı yok. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Hesabın henüz onaylanmadı. E-postadaki kodu gir veya yenisini iste. |
| `chat.empty` | How can I help? Type something – or just start talking. | Nasıl yardımcı olabilirim? Bir şey yaz ya da doğrudan konuş. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Çevrimdışısın; mesajı sakladım, bağlantın gelir gelmez göndereceğim. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Şu an geri alabileceğim bir şey göremiyorum. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Açık iş yok: günün tadını çıkar! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | Pazar akşamı Stella yeni hafta için bir plan önerir |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Hatırlatmalar, tekrarlayan işler, otomasyonlar: değiştir ya da durdur |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Ödev çöz, planı değiştir, reklamları sil… |
| `quick.forgot.text` | Did I forget anything? | Bir şey unuttum mu? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Tarih bulamadım; bir sonraki okul gününü aldım. Farklıysa örneğin "{subject} ödevi cumaya kadar" yaz.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Stella'yı kullanmaya başlamak için e-posta adresini onayla. Bağlantıyı kayıt olduğun cihazda aç. |
| `email.verifySignup.button` | Confirm sign-up | Kaydı onayla |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Hesabın onaylandı. İlk dakikalarda Stella'dan en iyi şekilde yararlanmanın yolu: |
| `email.welcome.title` | Welcome, Mia | Hoş geldin, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Hesabın onaylandı. İlk dakikalarda Stella'dan en iyi şekilde yararlanmanın yolu: |
| `email.reply.title` | Stella's reply | Stella'nın yanıtı |
| `email.unknown.title` | Nice to meet you | Tanıştığımıza memnun oldum |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Ben Stella; okul, iş ve günlük hayat için kişisel bir asistanım. Bu adresi henüz tanımıyorum, bu yüzden yanıt veremiyorum. |
| `email.subscription.started.title` | Welcome to {plan} | {plan}'a hoş geldin |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Teşekkürler. Limitlerin hemen artar. Faturayı Stripe ayrıca gönderir. |
| `email.subscription.changed.title` | You are on {plan} now | Artık {plan} planındasın |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Aboneliğin değiştirildi. Yeni limitler hemen geçerli. |
| `email.subscription.cancelled.title` | Subscription cancelled | Abonelik iptal edildi |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | {plan} planın {until} tarihine kadar sürer. Sonrasında Stella ücretsiz planla devam eder. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Bunun için konumuna ihtiyacım var. Yalnızca Stella’yı kullanırken ve saklanmaz. İzin verir misin? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Türkçe |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Günaydın Mia! yarın günün: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ Tamamdır! yarın sana "…" için hatırlatırım. |
| nett · Eintrag | ✅ Noted: Math test | ✅ Not aldım: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Kalk bakalım Mia! 😏 yarın günün: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ yarın "…" diye başının etini yiyeceğim. Söz. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Yine mi bir şey? Peki, yazdım: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Selam Mia. yarın günün: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ yarın: "…". Tamamdır. |
| cool · Eintrag | ✅ Added: Math test | ✅ Eklendi: … |

## Polski (`pl`)

| Schlüssel | English | Polski |
|---|---|---|
| `auth.tagline` | Let Stella handle your life. | Zostaw to Stelli. |
| `onboarding.welcome.title` | Great to have you here! | Miło Cię widzieć! |
| `onboarding.welcome.text` | I'm Stella and I help with everyday life. A few taps and I'll tune myself to your life – it takes a minute. | Jestem Stella i pomagam w codziennych sprawach. Kilka kliknięć i dopasuję się do Twojego życia – zajmie to minutę. |
| `onboarding.name.title` | What should I call you? | Jak mam się do Ciebie zwracać? |
| `onboarding.situation.title` | What describes you best? | Co najlepiej do Ciebie pasuje? |
| `onboarding.situation.school.sub` | homework, tests, timetable | homework, sprawdziany, plan lekcji |
| `onboarding.features.title` | What should Stella help with? | W czym ma Ci pomagać Stella? |
| `onboarding.mail.text` | If you like, Stella sorts your emails into important, neutral, unimportant and ads. Works with Gmail (via “Sign in with Google”) or iCloud. | Jeśli chcesz, Stella posortuje Twoje e-maile na ważne, neutralne, nieważne i reklamy. Działa z Gmailem (przez „Zaloguj się przez Google”) i iCloud. |
| `onboarding.tone.title` | How should I sound? | Jak mam brzmieć? |
| `onboarding.briefing.title` | When should I send your morning briefing? | Kiedy wysłać Ci poranne podsumowanie? |
| `onboarding.done.title` | All set, Mia! | Wszystko gotowe, Mia! |
| `onboarding.done.start` | Let's go | Zaczynamy |
| `tone.nett.example` | Got it! I'll remind you tomorrow at 7 pm. 💫 | Zapisane! Jutro o 19:00 Ci przypomnę. 💫 |
| `tone.frech.example` | Latin again? Fine, noted. I'll nag you tomorrow at 7 pm. | Znowu łacina? No dobra, zapisane. Jutro o 19:00 będę Cię męczyć. |
| `tone.cool.example` | Done. It's in, reminder tomorrow 7 pm. | Spoko. Wpisane, przypomnienie jutro o 19:00. |
| `briefing.nothing` | Nothing special today. | Dziś nic szczególnego. |
| `briefing.allCancelled` | All lessons cancelled 🎉 | Wszystkie lekcje odwołane 🎉 |
| `error.generic` | Something went wrong. Please try again. | Coś poszło nie tak. Spróbuj jeszcze raz. |
| `error.network` | No connection to the server. | Brak połączenia z serwerem. |
| `auth.notConfirmed` | Your account isn't confirmed yet. Enter the code from the email – or request a new one. | Twoje konto nie zostało jeszcze potwierdzone. Wpisz kod z e-maila albo poproś o nowy. |
| `chat.empty` | How can I help? Type something – or just start talking. | W czym mogę pomóc? Napisz coś albo po prostu zacznij mówić. |
| `chat.offlineSaved` | 📴 You're offline – I saved the message and will send it as soon as you have a connection again. | 📴 Jesteś offline – zapisałam wiadomość i wyślę ją, gdy tylko wróci połączenie. |
| `srv.undo.nothing` | I can't find anything I could undo right now. 🤔 | Teraz nie widzę niczego, co mogłabym cofnąć. 🤔 |
| `today.allClear` | Nothing open – enjoy the day! | Nic na głowie – ciesz się dniem! |
| `settings.weekPlanSub` | On Sunday evening Stella suggests a plan for the new week | W niedzielę wieczorem Stella proponuje plan na nowy tydzień |
| `settings.planSub` | Reminders, recurring tasks, automations – change or stop them | Przypomnienia, zadania cykliczne, automatyzacje – zmień je lub wyłącz |
| `settings.permsSub` | Solve homework, change the planner, delete ads … | Rozwiązywać zadania, zmieniać plan, usuwać reklamy… |
| `quick.forgot.text` | Did I forget anything? | Czy coś mi umknęło? |
| `srv.noDate.nextDay` | _(No date found – I took the next school day. Write e.g. "{subject} homework until Friday" if it's different.)_ | _(Nie znalazłam daty – wzięłam następny dzień szkolny. Jeśli ma być inaczej, napisz np. „{subject} zadanie na piątek”.)_ |
| `email.verifySignup.body` | Confirm your email address to start with Stella. Open the link on the device where you are signing up. | Potwierdź adres e-mail, a Stella zacznie działać. Otwórz link na urządzeniu, na którym się rejestrujesz. |
| `email.verifySignup.button` | Confirm sign-up | Potwierdź rejestrację |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Twoje konto jest potwierdzone. Oto jak wycisnąć z Stelli najwięcej od pierwszych minut. |
| `email.welcome.title` | Welcome, Mia | Witaj, Mia |
| `email.welcome.body` | Your account is confirmed. Here is how to get the most out of Stella in the first minutes. | Twoje konto jest potwierdzone. Oto jak wycisnąć z Stelli najwięcej od pierwszych minut. |
| `email.reply.title` | Stella's reply | Odpowiedź Stelli |
| `email.unknown.title` | Nice to meet you | Miło Cię poznać |
| `email.unknown.body` | I am Stella, a personal assistant for school, work and everyday life. I do not know this address yet, so I cannot answer your email. | Jestem Stella, osobistą asystentką do szkoły, pracy i codzienności. Nie znam jeszcze tego adresu, więc nie mogę odpowiedzieć. |
| `email.subscription.started.title` | Welcome to {plan} | Witaj w planie {plan} |
| `email.subscription.started.body` | Thank you. Your limits are higher right away. Stripe sends the invoice separately. | Dziękuję. Twoje limity rosną od razu. Fakturę wysyła osobno Stripe. |
| `email.subscription.changed.title` | You are on {plan} now | Jesteś teraz w planie {plan} |
| `email.subscription.changed.body` | Your plan was changed. The new limits apply from now on. | Twój plan został zmieniony. Nowe limity obowiązują od teraz. |
| `email.subscription.cancelled.title` | Subscription cancelled | Subskrypcja anulowana |
| `email.subscription.cancelled.body` | You keep {plan} until {until}. After that, Stella continues with the free plan. | {plan} masz do {until}. Potem Stella działa dalej w planie darmowym. |
| `location.ask.text` | For this I would need your location. Only while you use Stella, and it is not stored. Allow it? | Do tego potrzebowałabym twojej lokalizacji. Tylko gdy korzystasz ze Stelli, i nie jest zapisywana. Udostępnić? |

**Briefing-Gruß und Erinnerung in den drei Tönen**

| Ton | English | Polski |
|---|---|---|
| nett · Gruß | ☀️ Good morning, Mia! Your Friday: | ☀️ Dzień dobry, Mia! Twój jutro: |
| nett · Erinnerung | ⏰ On it! I'll remind you tomorrow about "dentist". | ⏰ Załatwione! jutro przypomnę Ci o „…”. |
| nett · Eintrag | ✅ Noted: Math test | ✅ Zapisane: … |
| frech · Gruß | ☀️ Wake up, Mia! 😏 Your Friday: | ☀️ Pobudka, Mia! 😏 Twój jutro: |
| frech · Erinnerung | ⏰ tomorrow I'll nag you about "dentist". Promise. 😏 | ⏰ jutro będę Cię męczyć „…”. Obiecuję. 😏 |
| frech · Eintrag | ✅ Something again? Fine, noted: Math test | ✅ Znowu coś? No dobra, zapisane: … |
| cool · Gruß | ☀️ Morning, Mia. Your Friday: | ☀️ Hej Mia. Twój jutro: |
| cool · Erinnerung | ⏰ tomorrow: "dentist". Set. | ⏰ jutro: „…”. Jest. |
| cool · Eintrag | ✅ Added: Math test | ✅ Dodane: … |

