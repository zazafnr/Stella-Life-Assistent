// Cloudflare Email Worker für stella@evolsior.com
//
// Cloudflare Email Routing übergibt jede Mail an stella@ an diesen Worker. Er liest den Text und
// reicht ihn an den Stella-Server weiter. Antworten schickt Stella selbst über ihren Mail-Versand,
// der Worker wartet nicht auf die Antwort.

import PostalMime from 'postal-mime';

const MAX_RAW = 5 * 1024 * 1024; // größere Mails (Anhänge) werden nicht gelesen

/** "spf=pass …; dkim=pass …; dmarc=pass" aus Authentication-Results */
function readAuth(headers) {
  const raw = headers.get('authentication-results');
  if (!raw) return null;
  const pick = (name) => new RegExp(`\\b${name}=([a-z]+)`, 'i').exec(raw)?.[1]?.toLowerCase();
  const auth = { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
  return auth.spf || auth.dkim || auth.dmarc ? auth : null;
}

export default {
  async email(message, env) {
    if (!env.INBOUND_SECRET) {
      message.setReject('Stella ist noch nicht eingerichtet.');
      return;
    }
    if (message.rawSize > MAX_RAW) {
      message.setReject('Die Mail ist zu groß. Bitte schreib Stella nur Text.');
      return;
    }

    const raw = await new Response(message.raw).arrayBuffer();
    const mail = await PostalMime.parse(raw);
    const h = message.headers;

    const payload = {
      from: message.from,
      to: message.to,
      subject: mail.subject ?? '',
      // nur Text: HTML wird bewusst nicht gelesen
      text: mail.text ?? '',
      messageId: mail.messageId ?? h.get('message-id') ?? '',
      inReplyTo: mail.inReplyTo ?? '',
      references: mail.references ?? '',
      auth: readAuth(h),
      autoSubmitted: h.get('auto-submitted') ?? '',
      precedence: h.get('precedence') ?? '',
      listId: h.get('list-id') ?? '',
      size: message.rawSize,
    };

    let res;
    try {
      res = await fetch(`${env.STELLA_URL}/api/inbound/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-inbound-secret': env.INBOUND_SECRET },
        body: JSON.stringify(payload),
      });
    } catch {
      message.setReject('Stella ist gerade nicht erreichbar. Bitte versuch es später nochmal.');
      return;
    }
    if (res.status === 401) console.error('Stella lehnt den Schlüssel ab: INBOUND_SECRET stimmt nicht mehr.');
    if (!res.ok) message.setReject('Stella konnte die Mail gerade nicht annehmen. Bitte versuch es später nochmal.');
  },
};
