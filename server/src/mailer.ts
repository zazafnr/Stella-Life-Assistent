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

export async function sendSystemMail(to: string, subject: string, text: string): Promise<void> {
  const smtp = smtpKey();
  if (!smtp) throw new Error('Kein Mail-Absender eingerichtet');
  await factory(smtp).sendMail({ from: smtp.from || `Stella <${smtp.user}>`, to, subject, text });
}
