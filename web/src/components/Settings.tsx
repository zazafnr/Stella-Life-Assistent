import { useEffect, useState, type ReactNode } from 'react';
import { TONE_INFO, TONES, type Tone } from '@stella/shared';
import { api, logout, refreshMe, useStore, type Me } from '../store.ts';
import { enablePush, isIos, isStandalone, pushPermission } from '../push.ts';
import { Copy, Section, useAction } from './settings/ui.tsx';
import { Books } from './settings/Books.tsx';
import { Mail } from './settings/Mail.tsx';
import { Untis } from './settings/Untis.tsx';
import { Handwriting } from './settings/Handwriting.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sheet, Sky, StarMark, Switch, showToast } from '../ui/Decor.tsx';

type SheetId = 'books' | 'untis' | 'mail' | 'notes' | 'health' | 'notify' | 'ai';

interface AiStatusData { configured: boolean; chain: string[]; visionChain: string[]; coolingDown: string[]; usedToday: number; dailyLimit: number }

export function Settings({ back }: { back: () => void }) {
  const me = useStore((s) => s.me);
  const online = useStore((s) => s.online);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [ai, setAi] = useState<AiStatusData | null>(null);
  const [perm, setPerm] = useState(pushPermission());

  useEffect(() => {
    void refreshMe().catch(() => {});
    api<AiStatusData>('/api/ai/status').then(setAi).catch(() => {});
  }, []);

  if (!me) return <div className="page"><Sky clouds={false} /></div>;
  const i = me.integrations;
  const booksConnected = Object.values(i.books ?? {}).some((b) => b.connected);
  const bookCount = me.settings.books?.length ?? 0;

  const rows: { id: SheetId; icon: IconName; tile: string; title: string; sub: string; status: [string, 'ok' | 'todo' | 'warn'] }[] = [
    {
      id: 'books', icon: 'book', tile: 'pink', title: 'Schulbücher',
      sub: bookCount ? me.settings.books!.map((b) => b.subject).join(', ') : 'scook, digi4school',
      status: booksConnected && bookCount ? ['Verbunden', 'ok'] : booksConnected ? ['Fach fehlt', 'warn'] : ['Einrichten', 'todo'],
    },
    { id: 'untis', icon: 'school', tile: 'blue', title: 'WebUntis', sub: 'Stundenplan, Entfall, Tests', status: i.webuntis ? ['Verbunden', 'ok'] : ['Einrichten', 'todo'] },
    {
      id: 'mail', icon: 'mail', tile: 'teal', title: 'E-Mail', sub: i.mailAccounts ? `${i.mailAccounts} ${i.mailAccounts === 1 ? 'Postfach' : 'Postfächer'}` : 'Gmail, iCloud',
      status: i.mailAccounts ? ['Verbunden', 'ok'] : ['Einrichten', 'todo'],
    },
    { id: 'notes', icon: 'pen', tile: 'blue', title: 'FreeNotes & Handschrift', sub: 'HÜs in deine Hefte schreiben', status: i.freeNotes ? ['Verbunden', 'ok'] : ['Einrichten', 'todo'] },
    { id: 'health', icon: 'heart', tile: 'pink', title: 'Health, SMS & Kalender', sub: 'Kurzbefehle und Kalender-Abo', status: ['Anleitung', 'todo'] },
    {
      id: 'notify', icon: 'bell', tile: 'green', title: 'Mitteilungen', sub: 'Erinnerungen auf diesem Gerät',
      status: perm === 'granted' ? ['An', 'ok'] : perm === 'denied' ? ['Blockiert', 'warn'] : ['Einschalten', 'todo'],
    },
  ];

  async function patch(json: Record<string, unknown>, ok = 'Gespeichert') {
    try {
      await api('/api/settings', { method: 'PATCH', json });
      await refreshMe();
      showToast(ok);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  return (
    <div className="page">
      <Sky clouds={false} />
      <div className="page-inner stagger">
        <header className="page-head">
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Zurück" onClick={back}><Icon name="back" size={18} /></button>
            <h1 className="display" style={{ fontSize: 28 }}>Einstellungen</h1>
          </div>
        </header>

        <section className="card row">
          <span className="avatar-star" style={{ width: 52, height: 52 }}><StarMark size={24} /></span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600 }}>{me.name}</span>
            <span className="small" style={{ color: online ? 'var(--green)' : 'var(--pink-text)' }}>{online ? 'Mit deinem Stella-Server verbunden' : 'Gerade offline'}</span>
          </div>
        </section>

        <TonePicker value={me.settings.tone ?? 'nett'} onChange={(tone) => void patch({ tone }, `${TONE_INFO[tone].emoji} Stella ist jetzt ${TONE_INFO[tone].label.toLowerCase()}`)} />

        <Group title="Verbindungen">
          {rows.map((r) => (
            <button key={r.id} type="button" className="list-row" onClick={() => setSheet(r.id)}>
              <span className={`icon-tile ${r.tile}`} style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name={r.icon} size={18} /></span>
              <span className="grow"><span className="list-title">{r.title}</span><span className="list-sub">{r.sub}</span></span>
              <span className={`status ${r.status[1]}`}>{r.status[0]}</span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </Group>

        <Group title="Stella für dich">
          <label className="list-row">
            <span className="grow"><span className="list-title">HÜ-Autopilot</span><span className="list-sub">Aufgaben lösen und ins Heft schreiben</span></span>
            <Switch label="HÜ-Autopilot" checked={me.settings.homeworkAutopilot !== false} onChange={(v) => void patch({ homeworkAutopilot: v }, v ? 'Autopilot an' : 'Autopilot aus')} />
          </label>
          <label className="list-row">
            <span className="grow"><span className="list-title">Werbung automatisch löschen</span><span className="list-sub">landet im Papierkorb, nicht weg</span></span>
            <Switch label="Werbung automatisch löschen" checked={me.settings.mailAutoTrash !== false} onChange={(v) => void patch({ mailAutoTrash: v })} />
          </label>
          <TimeRow label="Erinnerung am Vorabend" value={me.settings.eveningTime ?? '19:00'} onSave={(v) => void patch({ eveningTime: v })} />
          <TimeRow label="Lernzeit" value={me.settings.studyTime ?? '16:30'} onSave={(v) => void patch({ studyTime: v })} />
          <label className="list-row">
            <span className="grow"><span className="list-title">Schritte-Ziel</span></span>
            <input type="number" min={1000} step={500} defaultValue={me.settings.stepGoal ?? 8000} style={{ width: 110, textAlign: 'right' }}
              onBlur={(e) => { const n = Number(e.target.value); if (n && n !== me.settings.stepGoal) void patch({ stepGoal: n }); }} />
          </label>
        </Group>

        {ai?.configured && (
          <button type="button" className="card interactive" onClick={() => setSheet('ai')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>KI heute</span>
              <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}><strong style={{ color: 'var(--text)' }}>{ai.usedToday}</strong> / {ai.dailyLimit} Anfragen</span>
            </div>
            <div className="progress"><div style={{ width: `${Math.min(100, (ai.usedToday / ai.dailyLimit) * 100)}%` }} /></div>
            {ai.dailyLimit <= 50 && <span className="small muted">Einmal 10 $ bei OpenRouter aufladen → 1.000 pro Tag</span>}
          </button>
        )}

        <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => void logout()}><Icon name="logout" size={18} />Abmelden</button>
      </div>

      {sheet === 'books' && <Sheet title="Schulbücher" onClose={() => setSheet(null)}><Books me={me} /></Sheet>}
      {sheet === 'untis' && <Sheet title="WebUntis" onClose={() => setSheet(null)}><Untis me={me} /></Sheet>}
      {sheet === 'mail' && <Sheet title="E-Mail" onClose={() => setSheet(null)}><Mail me={me} /></Sheet>}
      {sheet === 'notes' && <Sheet title="FreeNotes & Handschrift" onClose={() => setSheet(null)}><Handwriting me={me} /></Sheet>}
      {sheet === 'health' && <Sheet title="Health, SMS & Kalender" onClose={() => setSheet(null)}><Shortcuts me={me} /></Sheet>}
      {sheet === 'notify' && <Sheet title="Mitteilungen" onClose={() => setSheet(null)}><Notifications onChange={() => setPerm(pushPermission())} /></Sheet>}
      {sheet === 'ai' && ai && <Sheet title="KI" onClose={() => setSheet(null)}><AiDetails ai={ai} /></Sheet>}
    </div>
  );
}

function TonePicker({ value, onChange }: { value: Tone; onChange: (t: Tone) => void }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="eyebrow" style={{ margin: '4px 4px 0' }}>Wie Stella schreibt</h2>
      <div className="tone-grid" role="radiogroup" aria-label="Wie Stella schreibt">
        {TONES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={value === t} className={value === t ? 'tone active' : 'tone'}
            onClick={() => value !== t && onChange(t)}>
            <span className="tone-emoji" aria-hidden="true">{TONE_INFO[t].emoji}</span>
            <span className="tone-label">{TONE_INFO[t].label}</span>
          </button>
        ))}
      </div>
      <p className="tone-example" key={value}>„{TONE_INFO[value].example}“</p>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="eyebrow" style={{ margin: '4px 4px 0' }}>{title}</h2>
      <div className="list">{children}</div>
    </section>
  );
}

function TimeRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <label className="list-row">
      <span className="grow"><span className="list-title">{label}</span></span>
      <input type="time" defaultValue={value} style={{ width: 120 }} onBlur={(e) => { if (e.target.value && e.target.value !== value) onSave(e.target.value); }} />
    </label>
  );
}

function Notifications({ onChange }: { onChange: () => void }) {
  const [run, view] = useAction();
  const [perm, setPerm] = useState(pushPermission());
  const desktop = 'stellaDesktop' in window;
  return (
    <Section title="Auf diesem Gerät">
      {desktop ? (
        <p className="muted">In der PC-App kommen Mitteilungen automatisch, solange Stella läuft (auch im Hintergrund in der Taskleiste).</p>
      ) : (
        <>
          {isIos() && !isStandalone() && (
            <p className="hint">Auf iPhone/iPad gehen Web-Mitteilungen nur am Home-Bildschirm. Mit der Stella-App für iOS brauchst du das nicht.</p>
          )}
          <p className="muted">Status: {perm === 'granted' ? 'erlaubt' : perm === 'denied' ? 'blockiert – in den Systemeinstellungen ändern' : perm === 'unsupported' ? 'nicht verfügbar' : 'noch nicht aktiviert'}</p>
          <div className="button-row">
            <button type="button" className="btn" onClick={() => run(async () => { await enablePush(); setPerm(pushPermission()); onChange(); }, 'Mitteilungen sind aktiv.')}>Mitteilungen aktivieren</button>
            {perm === 'granted' && <button type="button" className="btn secondary" onClick={() => run(() => api('/api/push/test', { method: 'POST' }), 'Test gesendet.')}>Test senden</button>}
          </div>
        </>
      )}
      {view}
    </Section>
  );
}

function Shortcuts({ me }: { me: Me }) {
  return (
    <>
      <Section title="Kalender-Abo">
        <p className="muted">Alle HÜs, Tests und Lerneinheiten in deinem iPhone-Kalender: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → <strong>Kalenderabo hinzufügen</strong> → diese Adresse einfügen. Geht auch mit Google und Outlook.</p>
        <Copy value={`${me.ingestUrl}/calendar.ics`} />
      </Section>
      <Section title="Schritte & Schlaf (Apple Health)">
        <ol className="steps">
          <li>Kurzbefehle → <strong>Automation</strong> → „Tageszeit“ 21:00, täglich, „Sofort ausführen“.</li>
          <li><strong>Health-Samples suchen</strong>: Schritte, Startdatum heute → <strong>Statistik berechnen</strong>: Summe.</li>
          <li><strong>Inhalte von URL abrufen</strong>: POST, JSON, Feld <code>steps</code> = Summe, an diese Adresse:</li>
        </ol>
        <Copy value={`${me.ingestUrl}/health`} />
      </Section>
      <Section title="SMS weiterleiten">
        <ol className="steps">
          <li>Automation → <strong>Nachricht</strong> → „Absender: beliebig“ → „Sofort ausführen“.</li>
          <li><strong>Inhalte von URL abrufen</strong>, POST, JSON: <code>sender</code> = Absender, <code>text</code> = Nachricht:</li>
        </ol>
        <Copy value={`${me.ingestUrl}/sms`} />
        <p className="muted small">Schreibt dir jemand 3× in 30 Minuten, meldet sich Stella. Die Adressen sind geheim wie ein Passwort.</p>
      </Section>
    </>
  );
}

function AiDetails({ ai }: { ai: AiStatusData }) {
  return (
    <>
      <Section title="Verbrauch heute">
        <p><strong>{ai.usedToday}</strong> von {ai.dailyLimit} Anfragen. Mails sortieren nutzt höchstens die Hälfte, damit für dich immer etwas übrig bleibt.</p>
      </Section>
      <Section title="Modelle (automatisch gewählt)">
        <p className="muted small">Für Chat und Planer:</p>
        <ol className="models">{ai.chain.map((m) => <li key={m}><code>{m}</code>{ai.coolingDown.includes(m) && ' · Pause'}</li>)}</ol>
        <p className="muted small">Für Buchseiten und Fotos:</p>
        <ol className="models">{ai.visionChain.map((m) => <li key={m}><code>{m}</code>{ai.coolingDown.includes(m) && ' · Pause'}</li>)}</ol>
      </Section>
    </>
  );
}
