import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, logout, refreshMe, useStore, type Me } from '../store.ts';
import { enablePush, isIos, isStandalone, pushPermission } from '../push.ts';

type Book = NonNullable<Me['settings']['digi4schoolBooks']>[number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2>{children}</section>;
}

function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  const view = msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>;
  return [run, view] as const;
}

function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <code>{value}</code>
      <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
        {copied ? '✓' : 'Kopieren'}
      </button>
    </div>
  );
}

export function Settings() {
  const me = useStore((s) => s.me)!;
  const online = useStore((s) => s.online);
  const outbox = useStore((s) => s.outbox.length);

  useEffect(() => { void refreshMe().catch(() => {}); }, []);

  return (
    <div className="page">
      <header className="page-head"><h1>Einstellungen</h1></header>
      <Account me={me} online={online} outbox={outbox} />
      <Notifications />
      <Times me={me} />
      <Digi4School me={me} />
      <Shortcuts me={me} />
      <AiStatus />
    </div>
  );
}

function Account({ me, online, outbox }: { me: Me; online: boolean; outbox: number }) {
  return (
    <Section title="Konto">
      <p><strong>{me.name}</strong> · {me.email}</p>
      <p className="muted">
        {online ? '🟢 Mit deinem Stella-Server verbunden' : '🔴 Offline'}
        {outbox > 0 && ` · ${outbox} Nachricht(en) warten auf Versand`}
      </p>
      <p className="muted">Auf jedem Gerät mit demselben Konto anmelden – alles wird automatisch synchronisiert.</p>
      <button type="button" className="secondary" onClick={() => void logout()}>Abmelden</button>
    </Section>
  );
}

function Notifications() {
  const [run, view] = useAction();
  const [perm, setPerm] = useState(pushPermission());
  return (
    <Section title="Mitteilungen">
      {isIos() && !isStandalone() && (
        <p className="hint">📱 Auf iPhone/iPad gehen Mitteilungen nur, wenn Stella am Home-Bildschirm ist:
          in Safari <strong>Teilen → „Zum Home-Bildschirm“</strong>, dann Stella von dort öffnen.</p>
      )}
      <p className="muted">Status: {perm === 'granted' ? 'erlaubt ✅' : perm === 'denied' ? 'blockiert (in den Systemeinstellungen ändern)' : perm === 'unsupported' ? 'nicht verfügbar' : 'noch nicht aktiviert'}</p>
      <div className="button-row">
        <button type="button" onClick={() => run(async () => { await enablePush(); setPerm(pushPermission()); }, 'Mitteilungen sind aktiv auf diesem Gerät.')}>
          Mitteilungen aktivieren
        </button>
        {perm === 'granted' && (
          <button type="button" className="secondary" onClick={() => run(() => api('/api/push/test', { method: 'POST' }), 'Test gesendet.')}>Test senden</button>
        )}
      </div>
      {view}
    </Section>
  );
}

function Times({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [evening, setEvening] = useState(me.settings.eveningTime ?? '19:00');
  const [study, setStudy] = useState(me.settings.studyTime ?? '16:30');
  const [goal, setGoal] = useState(String(me.settings.stepGoal ?? 8000));
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/api/settings', { method: 'PATCH', json: { eveningTime: evening, studyTime: study, stepGoal: Number(goal) } });
      await refreshMe();
    }, 'Gespeichert. Gilt für neue Einträge.');
  };
  return (
    <Section title="Erinnerungen">
      <form onSubmit={save} className="form-grid">
        <label>Vorabend-Erinnerung (HÜs)<input type="time" value={evening} onChange={(e) => setEvening(e.target.value)} /></label>
        <label>Lernzeit<input type="time" value={study} onChange={(e) => setStudy(e.target.value)} /></label>
        <label>Schritte-Ziel<input type="number" min={0} step={500} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <button type="submit">Speichern</button>
      </form>
      {view}
    </Section>
  );
}

function Digi4School({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [books, setBooks] = useState<Book[]>(me.settings.digi4schoolBooks ?? []);
  const [shelf, setShelf] = useState<{ title: string; url: string }[] | null>(null);
  const connected = me.integrations.digi4school;

  const saveBooks = (next: Book[]) => run(async () => {
    await api('/api/settings', { method: 'PATCH', json: { digi4schoolBooks: next } });
    await refreshMe();
  }, 'Bücher gespeichert.');
  const update = (i: number, patch: Partial<Book>) => setBooks(books.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <Section title="digi4school">
      <p className="muted">Stella holt bei HÜs mit Seitenzahl automatisch die Buchseite als Bild. Dein Passwort wird verschlüsselt auf deinem Server gespeichert.</p>
      {connected ? (
        <div className="button-row">
          <span className="ok-text">✅ Verbunden</span>
          <button type="button" className="secondary" onClick={() => run(async () => { await api('/api/integrations/digi4school/books').then((b) => setShelf(b as never)); }, 'Bücherregal geladen.')}>Bücherregal laden</button>
          <button type="button" className="link danger" onClick={() => run(async () => { await api('/api/integrations/digi4school', { method: 'DELETE' }); await refreshMe(); }, 'Verbindung entfernt.')}>Trennen</button>
        </div>
      ) : (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/integrations/digi4school', { method: 'PUT', json: { email, password } }); setPassword(''); await refreshMe(); }, 'Gespeichert.'); }}>
          <label>E-Mail<input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Passwort<input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button type="submit">Verbinden</button>
        </form>
      )}

      {shelf && (
        <div className="shelf">
          {shelf.length === 0 && <p className="muted">Keine Bücher gefunden.</p>}
          {shelf.map((b) => (
            <div key={b.url} className="shelf-row">
              <span>{b.title || b.url}</span>
              <button type="button" className="link" onClick={() => setBooks([...books, { subject: '', url: b.url, pageOffset: 0 }])}>+ zuordnen</button>
            </div>
          ))}
        </div>
      )}

      <h3>Fach → Buch</h3>
      {books.map((b, i) => (
        <div key={i} className="book-row">
          <input placeholder="Fach (z. B. Latein)" value={b.subject} onChange={(e) => update(i, { subject: e.target.value })} />
          <input placeholder="https://digi4school.at/ebook/…" value={b.url} onChange={(e) => update(i, { url: e.target.value })} />
          <input type="number" title="Seitenversatz: PDF-Seite minus gedruckte Seitenzahl" value={b.pageOffset ?? 0} onChange={(e) => update(i, { pageOffset: Number(e.target.value) })} />
          <button type="button" className="link danger" onClick={() => setBooks(books.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => setBooks([...books, { subject: '', url: '', pageOffset: 0 }])}>+ Buch</button>
        <button type="button" onClick={() => void saveBooks(books)}>Speichern</button>
      </div>
      <p className="muted small">Seitenversatz: Wenn Stella Seite 45 will, aber Seite 43 aufmacht, trag 2 ein.</p>
      {view}
    </Section>
  );
}

function Shortcuts({ me }: { me: Me }) {
  return (
    <>
    <Section title="Kalender-Abo">
      <p className="muted">Alle HÜs, Tests und Lerneinheiten im iPhone-Kalender: Einstellungen → Kalender → Accounts →
        Account hinzufügen → Andere → <strong>Kalenderabo hinzufügen</strong> → diese URL einfügen. Geht auch mit Google/Outlook.</p>
      <Copy value={`${me.ingestUrl}/calendar.ics`} />
    </Section>
    <Section title="Apple Health & SMS (Kurzbefehle)">
      <p className="muted">iOS lässt Apps nicht direkt an Health-Daten oder SMS. Mit der Kurzbefehle-App klappt's trotzdem – einmal einrichten, läuft dann automatisch.</p>
      <h3>Schritte & Schlaf (täglich)</h3>
      <ol className="steps">
        <li>Kurzbefehle → <strong>Automation</strong> → „Tageszeit“ 21:00, täglich, „Sofort ausführen“.</li>
        <li>Aktion <strong>Health-Samples suchen</strong>: Schritte, Startdatum ist heute → <strong>Statistik berechnen</strong>: Summe.</li>
        <li>Aktion <strong>Inhalte von URL abrufen</strong>: Methode POST, Anfragetext JSON, Feld <code>steps</code> = Summe.</li>
        <li>URL:</li>
      </ol>
      <Copy value={`${me.ingestUrl}/health`} />
      <h3>SMS/iMessage weiterleiten (optional)</h3>
      <ol className="steps">
        <li>Automation → <strong>Nachricht</strong> → „Absender: beliebig“ → „Sofort ausführen“.</li>
        <li><strong>Inhalte von URL abrufen</strong>, POST, JSON: <code>sender</code> = Absender, <code>text</code> = Nachricht.</li>
        <li>URL:</li>
      </ol>
      <Copy value={`${me.ingestUrl}/sms`} />
      <p className="muted small">Schreibt dir jemand 3× in 30 Minuten, meldet sich Stella. Die URLs sind geheim wie ein Passwort.</p>
    </Section>
    </>
  );
}

function AiStatus() {
  const [status, setStatus] = useState<{ configured: boolean; chain: string[]; coolingDown: string[] } | null>(null);
  useEffect(() => { api<typeof status>('/api/ai/status').then(setStatus).catch(() => {}); }, []);
  if (!status) return null;
  return (
    <Section title="KI">
      {status.configured ? (
        <>
          <p className="muted">Stella probiert diese Modelle der Reihe nach (OpenRouter):</p>
          <ol className="models">
            {status.chain.map((m) => <li key={m}><code>{m}</code>{status.coolingDown.includes(m) && ' (Pause – Limit)'}</li>)}
          </ol>
        </>
      ) : (
        <p className="hint">Kein OpenRouter-Schlüssel auf dem Server. Kurznotizen funktionieren trotzdem, freie Fragen nicht.</p>
      )}
    </Section>
  );
}
