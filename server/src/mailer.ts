// Mails, die Stella selbst verschickt (Bestätigungs-Code bei der Registrierung). Der Absender kommt aus den
// Server-Schlüsseln (Einstellungen → Server → SMTP) – nicht aus dem Postfach eines Nutzers.

import nodemailer, { type Transporter } from 'nodemailer';
import { smtpKey, type SmtpKey } from './keys.ts';

let factory: (smtp: SmtpKey) => Pick<Transporter, 'sendMail'> = (smtp) => nodemailer.createTransport({
  host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass },
  connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
});

/** Für Tests austauschbar */
export function setMailTransportFactory(f?: typeof factory) {
  factory = f ?? ((smtp) => nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } }));
}

export const mailerConfigured = () => !!smtpKey();

/** Domain aus „Stella <noreply@evolsior.com>“ oder „noreply@evolsior.com“ */
export function senderDomain(from: string | undefined): string | null {
  return /@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i.exec(from ?? '')?.[1]?.toLowerCase() ?? null;
}

/**
 * Wer schreibt:
 *   noreply  automatische Mails (Bestätigungs-Codes). Antworten gehen an support@ der gleichen Domain.
 *   stella   Mails, die Stella dir schreibt. Absender stella@ der gleichen Domain, Antworten kommen dort an.
 * Beides sind nur Absenderadressen auf der verifizierten Domain, im Versanddienst ist dafür nichts extra einzurichten.
 */
export type MailKind = 'noreply' | 'stella';

export function systemSender(from: string | undefined, kind: MailKind): { from?: string; replyTo?: string } {
  const domain = senderDomain(from);
  if (!domain) return from ? { from } : {};
  if (kind === 'stella') return { from: `Stella <stella@${domain}>`, replyTo: `stella@${domain}` };
  return { from: from!, replyTo: `support@${domain}` };
}

export async function sendSystemMail(to: string, subject: string, text: string, kind: MailKind = 'noreply'): Promise<void> {
  const smtp = smtpKey();
  if (!smtp) throw new Error('Kein Mail-Absender eingerichtet');
  const who = systemSender(smtp.from, kind);
  await factory(smtp).sendMail({ from: who.from ?? `Stella <${smtp.user}>`, ...(who.replyTo ? { replyTo: who.replyTo } : {}), to, subject, text });
}
