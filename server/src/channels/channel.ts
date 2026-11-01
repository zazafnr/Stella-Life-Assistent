// Kanäle, über die Stella schreibt und Nachrichten bekommt (Telegram heute, WhatsApp später, E-Mail bleibt in inbound.ts).

export type ChannelId = 'telegram' | 'whatsapp' | 'email';

/** Knopf unter einer Nachricht. `action`: a = Vorschlag annehmen, r = ablehnen, u = rückgängig, gefolgt von der Aktions-Id. */
export interface OutboundButton { label: string; action: string }

export interface OutboundMessage {
  /** Text mit einfachem Markdown (**fett**, [Text](https://…), `Code`, Aufzählungen) – jeder Kanal setzt ihn für sich um */
  text: string;
  buttons?: OutboundButton[];
}

export interface Channel {
  id: ChannelId;
  /** true, wenn der Kanal eingerichtet ist (Schlüssel gesetzt) */
  configured(): boolean;
  /** schickt an die verknüpfte Person; false, wenn sie diesen Kanal nicht verknüpft hat */
  send(userId: string, message: OutboundMessage): Promise<boolean>;
}
