// Prüfliste für Muttersprachler:innen: die wichtigsten Texte je Sprache nebeneinander (Englisch als Bezug).
//   npx tsx scripts/i18n-review.ts   →   docs/i18n/pruefliste.md

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOGS, LOCALES, LOCALE_NAMES, t, voice, type Locale } from '../shared/src/index.ts';

const root = path.resolve(import.meta.dirname, '..');

/** Einführung, Slogan, Bezahlschranke (ab Paket 5), Briefing-Gruß, Fehlertexte */
const KEYS = [
  'auth.tagline', 'onboarding.welcome.title', 'onboarding.welcome.text', 'onboarding.name.title', 'onboarding.situation.title',
  'onboarding.situation.school.sub', 'onboarding.features.title', 'onboarding.mail.text', 'onboarding.tone.title', 'onboarding.briefing.title',
  'onboarding.done.title', 'onboarding.done.start', 'tone.nett.example', 'tone.frech.example', 'tone.cool.example', 'briefing.nothing',
  'briefing.allCancelled', 'error.generic', 'error.network', 'auth.notConfirmed', 'chat.empty', 'chat.offlineSaved', 'srv.undo.nothing',
  'today.allClear', 'settings.weekPlanSub', 'settings.planSub', 'settings.permsSub', 'quick.forgot.text', 'srv.noDate.nextDay', 'email.code.body',
  // ab Paket 4–13 kommen weitere Schlüssel dazu (Paywall, Mails, Standort, News …): hier einfach ergänzen
  ...Object.keys(CATALOGS.en).filter((k) => /^(paywall|email\.(verify|welcome|login|reply|unknown|subscription)|location|news|screentime)\./.test(k) && /\.(title|text|body|cta|headline)$/.test(k)).slice(0, 12),
];

const cell = (s: string) => s.replace(/\n/g, ' ⏎ ').replace(/\|/g, '\\|');
let md = `# Prüfliste für Muttersprachler:innen\n\n> Automatisch erzeugt von \`scripts/i18n-review.ts\`. Bitte gegenlesen: klingt es natürlich, passt der Ton, stimmen die Schulbegriffe? Rückmeldungen als Änderung in \`shared/src/i18n/catalog/<sprache>.json\` (und \`voice.more.ts\`).\n\n`;
for (const locale of LOCALES.filter((l) => l !== 'en')) {
  md += `## ${LOCALE_NAMES[locale]} (\`${locale}\`)\n\n| Schlüssel | English | ${LOCALE_NAMES[locale]} |\n|---|---|---|\n`;
  for (const k of KEYS) md += `| \`${k}\` | ${cell(t('en', k, { name: 'Mia', homework: 'homework' }))} | ${cell(t(locale, k, { name: 'Mia', homework: 'homework' }))} |\n`;
  const v = (l: Locale, tone: 'nett' | 'frech' | 'cool') => voice(tone, l);
  md += `\n**Briefing-Gruß und Erinnerung in den drei Tönen**\n\n| Ton | English | ${LOCALE_NAMES[locale]} |\n|---|---|---|\n`;
  for (const tone of ['nett', 'frech', 'cool'] as const) {
    md += `| ${tone} · Gruß | ${cell(v('en', tone).briefingGreeting('Mia', 'Friday'))} | ${cell(v(locale, tone).briefingGreeting('Mia', t(locale, 'date.tomorrow')))} |\n`;
    md += `| ${tone} · Erinnerung | ${cell(v('en', tone).remindSet('tomorrow', 'dentist'))} | ${cell(v(locale, tone).remindSet(t(locale, 'date.tomorrow'), '…'))} |\n`;
    md += `| ${tone} · Eintrag | ${cell(v('en', tone).noted('Math test'))} | ${cell(v(locale, tone).noted('…'))} |\n`;
  }
  md += '\n';
}
writeFileSync(path.join(root, 'docs/i18n/pruefliste.md'), md);
console.log(`docs/i18n/pruefliste.md (${KEYS.length} Texte × ${LOCALES.length - 1} Sprachen)`);
