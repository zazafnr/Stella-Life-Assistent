// WhatsApp: nur vorbereitet, noch nicht gebaut. Siehe docs/plan/stella-v3.md (Paket 10) und den Abschnitt „WhatsApp“ in docs/ARCHITEKTUR.md.
//
// TODO (wenn es kommt, dann nur ab Pro):
//  - Meta-Unternehmensverifizierung und eine eigene Nummer, Anmeldung bei der WhatsApp Business Platform (Cloud API)
//  - Webhook wie bei Telegram (Signatur `X-Hub-Signature-256` prüfen), Verknüpfung über denselben Einmal-Token (channel_links, channel = 'whatsapp')
//  - proaktive Nachrichten nur mit von Meta freigegebenen Vorlagen (etwa 2–5 Cent pro Stück), Antworten im 24-Stunden-Fenster
//  - Meta erlaubt allgemeine KI-Assistenten in der EU nur vorläufig (seit 2026, 12 Monate) und gegen eine Gebühr pro Nachricht

import type { Channel } from './channel.ts';

export const whatsappChannel: Channel = {
  id: 'whatsapp',
  configured: () => false,
  async send() { return false; },
};
