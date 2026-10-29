import { useEffect, useState, type FormEvent } from 'react';
import { api, logout, refreshMe, useStore, type Me } from '../store.ts';
import { enablePush, isIos, isStandalone, pushPermission } from '../push.ts';
import { Copy, Section, useAction } from './settings/ui.tsx';
import { Books } from './settings/Books.tsx';
import { Mail } from './settings/Mail.tsx';
import { Untis } from './settings/Untis.tsx';
import { Handwriting } from './settings/Handwriting.tsx';

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
      <Books me={me} />
      <Handwriting me={me} />
      <Untis me={me} />
      <Mail me={me} />
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
  const [status, setStatus] = useState<{ configured: boolean; chain: string[]; visionChain: string[]; coolingDown: string[] } | null>(null);
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
          <p className="muted">Zum Lesen von Buchseiten und Fotos (HÜ-Autopilot):</p>
          <ol className="models">
            {status.visionChain.map((m) => <li key={m}><code>{m}</code>{status.coolingDown.includes(m) && ' (Pause – Limit)'}</li>)}
          </ol>
        </>
      ) : (
        <p className="hint">Kein OpenRouter-Schlüssel auf dem Server. Kurznotizen funktionieren trotzdem, freie Fragen nicht.</p>
      )}
    </Section>
  );
}
