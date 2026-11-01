// Alle Mail-Vorlagen. Texte kommen aus dem Sprachkatalog (Bereich email.*), nie fest im Code.

import { t, type Locale } from '@stella/shared';
import { config } from '../config.ts';
import { renderEmail, type EmailCard, type EmailParts } from './layout.ts';
import { markdownToEmail } from './markdown.ts';

export type TemplateName = 'verify-signup' | 'verify-address' | 'login-link' | 'welcome' | 'stella-reply' | 'unknown-sender' | 'subscription' | 'freenotes-launch';
export const TEMPLATE_NAMES: TemplateName[] = ['verify-signup', 'verify-address', 'login-link', 'welcome', 'stella-reply', 'unknown-sender', 'subscription', 'freenotes-launch'];

export interface TemplateData {
  name?: string;
  /** Bestätigungs-Link bzw. Anmelde-Link */
  url?: string;
  /** 6-stelliger Code (Rückfall, wenn kein Link da ist) */
  code?: string;
  minutes?: number;
  email?: string;
  /** login-link: 'login' | 'reset' */
  purpose?: 'login' | 'reset';
  /** stella-reply: Antworttext (Markdown), Karten „Das habe ich getan“, Rückgängig-Link */
  replyText?: string;
  actions?: string[];
  undoUrl?: string;
  /** subscription */
  event?: 'started' | 'changed' | 'cancelled';
  plan?: string;
  until?: string;
  /** welcome / unknown-sender: Knopf */
  appUrl?: string;
}

export interface RenderedMail { subject: string; html: string; text: string }

const hello = (l: Locale, name?: string) => (name ? t(l, 'email.hello', { name }) : '');

function build(name: TemplateName, locale: Locale, d: TemplateData): { subject: string; parts: EmailParts } {
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale, `email.${key}`, vars);
  const alt = tt('heroAlt');
  const minutes = d.minutes ?? 15;
  const base = { locale, hero: { image: name, alt } };

  switch (name) {
    case 'verify-signup':
      return { subject: tt('verifySignup.subject'), parts: { ...base, preheader: tt('verifySignup.preheader'), title: tt('verifySignup.title'),
        body: [hello(locale, d.name), tt('verifySignup.body')].filter(Boolean),
        ...(d.url ? { button: { label: tt('verifySignup.button'), url: d.url } } : {}),
        ...(d.code ? { code: { label: tt('codeLabel'), value: d.code } } : {}),
        note: tt('verifySignup.note', { minutes }), reason: tt('footer.reasonSignup') } };
    case 'verify-address':
      return { subject: tt('verifyAddress.subject'), parts: { ...base, preheader: tt('verifyAddress.preheader'), title: tt('verifyAddress.title'),
        body: [hello(locale, d.name), tt('verifyAddress.body', { email: d.email ?? '' })].filter(Boolean),
        ...(d.url ? { button: { label: tt('verifyAddress.button'), url: d.url } } : {}),
        ...(d.code ? { code: { label: tt('codeLabel'), value: d.code } } : {}),
        note: tt('verifyAddress.note', { minutes }), reason: tt('footer.reasonAddress') } };
    case 'login-link': {
      const reset = d.purpose === 'reset';
      return { subject: tt(reset ? 'resetPassword.subject' : 'loginLink.subject'), parts: { ...base, preheader: tt('loginLink.preheader'),
        title: tt(reset ? 'resetPassword.title' : 'loginLink.title'), body: [hello(locale, d.name), tt(reset ? 'resetPassword.body' : 'loginLink.body')].filter(Boolean),
        ...(d.url ? { button: { label: tt(reset ? 'resetPassword.button' : 'loginLink.button'), url: d.url } } : {}),
        note: tt('loginLink.note', { minutes }), reason: tt('footer.reasonAccount') } };
    }
    case 'welcome': {
      const cards: EmailCard[] = [
        { title: tt('welcome.telegramTitle'), text: tt('welcome.telegramText'), icon: 'icon-telegram' },
        { title: tt('welcome.phoneTitle'), text: tt('welcome.phoneText'), icon: 'icon-phone' },
        { title: tt('welcome.briefingTitle'), text: tt('welcome.briefingText'), icon: 'icon-briefing' },
      ];
      return { subject: tt('welcome.subject'), parts: { ...base, preheader: tt('welcome.preheader'), title: tt('welcome.title', { name: d.name ?? '' }),
        body: [tt('welcome.body')], cards, button: { label: tt('welcome.button'), url: d.appUrl ?? config.publicUrl }, reason: tt('footer.reasonAccount') } };
    }
    case 'stella-reply': {
      const md = markdownToEmail(d.replyText ?? '');
      const cards: EmailCard[] = (d.actions ?? []).slice(0, 8).map((a) => ({ title: tt('reply.did'), text: a, icon: 'icon-check' }));
      return { subject: '', parts: { ...base, preheader: md.text.replace(/\s+/g, ' ').slice(0, 110), title: tt('reply.title'), body: [], richHtml: md.html, richText: md.text,
        cards, ...(d.undoUrl ? { secondary: { label: tt('reply.undoButton'), url: d.undoUrl, note: tt('reply.undoNote') } } : {}), reason: tt('footer.reasonSender') } };
    }
    case 'unknown-sender':
      return { subject: tt('unknown.subject'), parts: { ...base, preheader: tt('unknown.preheader'), title: tt('unknown.title'),
        body: [tt('unknown.body'), tt('unknown.body2')], button: { label: tt('unknown.button'), url: d.appUrl ?? config.publicUrl }, reason: tt('footer.reasonSender') } };
    case 'freenotes-launch':
      return { subject: tt('freenotes.subject'), parts: { ...base, preheader: tt('freenotes.preheader'), title: tt('freenotes.title'),
        body: [hello(locale, d.name), tt('freenotes.body')].filter(Boolean), button: { label: tt('freenotes.button'), url: d.appUrl ?? config.freenotesUrl },
        reason: tt('footer.reasonAccount') } };
    case 'subscription': {
      const ev = d.event ?? 'started';
      return { subject: tt(`subscription.${ev}.subject`, { plan: d.plan ?? '' }), parts: { ...base, preheader: tt('subscription.preheader', { plan: d.plan ?? '' }),
        title: tt(`subscription.${ev}.title`, { plan: d.plan ?? '' }), body: [hello(locale, d.name), tt(`subscription.${ev}.body`, { plan: d.plan ?? '', until: d.until ?? '' })].filter(Boolean),
        button: { label: tt('subscription.button'), url: d.appUrl ?? config.publicUrl }, reason: tt('footer.reasonAccount') } };
    }
  }
}

export function renderTemplate(name: TemplateName, locale: Locale, data: TemplateData = {}): RenderedMail {
  const { subject, parts } = build(name, locale, data);
  const { html, text } = renderEmail(parts);
  return { subject, html, text };
}

/** Beispieldaten für die Vorschau (Owner-Route und Dashboard) */
export const SAMPLE: TemplateData = {
  name: 'Mia', url: 'https://login.stella.evolsior.com/v/EXAMPLE-TOKEN', code: '482913', minutes: 15, email: 'mia@example.com',
  replyText: 'Done. I added **Math test** on Thursday, 12 Nov and will remind you a week and a day before.\n\n- Study plan: 3 sessions\n- First session: Monday 16:30',
  actions: ['Math test · Thu, 12 Nov', 'Study plan: 3 sessions'], undoUrl: 'https://stella.evolsior.com/api/mail/undo/EXAMPLE', plan: 'Plus', until: '1 December 2026', event: 'started',
};
