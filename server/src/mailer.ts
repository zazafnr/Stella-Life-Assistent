// Mails, die Stella selbst verschickt (Bestätigungs-Code bei der Registrierung). Der Absender kommt aus den
// Server-Schlüsseln (Einstellungen → Server → SMTP) – nicht aus dem Postfach eines Nutzers.

import nodemailer, { type Transporter } from 'nodemailer';
import { smtpKey, type SmtpKey } from './keys.ts';
import { logMail } from './maillog.ts';

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

export interface MailExtra {
  /** wofür die Mail ist – erscheint gezählt im Firmen-Dashboard */
  purpose?: string;
  userId?: string | null;
  /** Antwort in einem Verlauf */
  inReplyTo?: string;
  references?: string[];
}

export async function sendSystemMail(to: string, subject: string, text: string, kind: MailKind = 'noreply', extra: MailExtra = {}): Promise<void> {
  const smtp = smtpKey();
  const purpose = extra.purpose ?? (kind === 'stella' ? 'stella_reply' : 'system');
  if (!smtp) { logMail('out', purpose, 'failed', { to, userId: extra.userId, detail: 'kein Absender eingerichtet' }); throw new Error('Kein Mail-Absender eingerichtet'); }
  const who = systemSender(smtp.from, kind);
  try {
    await factory(smtp).sendMail({
      from: who.from ?? `Stella <${smtp.user}>`, ...(who.replyTo ? { replyTo: who.replyTo } : {}), to, subject, text,
      ...(extra.inReplyTo ? { inReplyTo: extra.inReplyTo, references: extra.references?.length ? extra.references : [extra.inReplyTo] } : {}),
    });
    logMail('out', purpose, 'ok', { to, userId: extra.userId });
  } catch (err) {
    logMail('out', purpose, 'failed', { to, userId: extra.userId, detail: (err as Error).message });
    throw err;
  }
}
