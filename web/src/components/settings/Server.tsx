import { useEffect, useState } from 'react';
import { api } from '../../store.ts';
import { Section, useAction } from './ui.tsx';

type Name = 'groq' | 'openrouter' | 'smtp';
interface KeyStatus { set: boolean; source: 'env' | 'app' | null; lastOk: string | null; lastError: string | null }
type Keys = Record<Name, KeyStatus>;

const TITLES: Record<Name, { title: string; hint: string; field: string }> = {
  groq: { title: 'Groq-API-Key', hint: 'Mails einordnen, Chat-Titel und Sprachnachrichten. Kostenlos erhältlich auf console.groq.com.', field: 'gsk_…' },
  openrouter: { title: 'OpenRouter-API-Key', hint: 'Für Chat und Planer. Ohne Eintrag hier gilt der Schlüssel aus der Server-Umgebung.', field: 'sk-or-…' },
  smtp: { title: 'E-Mail-Absender (SMTP)', hint: 'Von hier gehen die Bestätigungs-Codes bei der Registrierung raus. Der Absender (z. B. Stella <noreply@evolsior.com>) bestimmt die Domain: Antworten gehen an support@ dieser Domain, Mails, die Stella dir schreibt, kommen von stella@.', field: '' },
};

const ago = (iso: string) => new Date(iso).toLocaleString('de-AT', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Server-Schlüssel – nur für den Owner. Ein eingetragener Schlüssel wird nie wieder angezeigt. */
export function Server() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ keys: Keys }>('/api/admin/keys').then((r) => setKeys(r.keys)).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!keys) return <p className="muted">⏳ Einen Moment…</p>;
  return (
    <>
      {(['groq', 'openrouter'] as const).map((n) => <KeyCard key={n} name={n} status={keys[n]} onChange={setKeys} />)}
      <SmtpCard status={keys.smtp} onChange={setKeys} />
      <InboundCard />
      <Invites />
    </>
  );
}

function StatusLine({ s }: { s: KeyStatus }) {
  if (!s.set) return <p className="small"><strong style={{ color: 'var(--pink-text)' }}>Fehlt</strong></p>;
  return (
    <p className="small">
      <strong style={{ color: 'var(--green)' }}>Gesetzt</strong>{s.source === 'env' ? ' (aus der Server-Umgebung)' : ''}
      {s.lastOk && <span className="muted"> · zuletzt OK {ago(s.lastOk)}</span>}
      {s.lastError && <span className="error-text"> · {s.lastError}</span>}
    </p>
  );
}

function KeyCard({ name, status, onChange }: { name: 'groq' | 'openrouter'; status: KeyStatus; onChange: (k: Keys) => void }) {
  const [run, view] = useAction();
  const [value, setValue] = useState('');
  const t = TITLES[name];
  const save = (v: string | null) => run(async () => {
    const r = await api<{ keys: Keys }>('/api/admin/keys', { method: 'PUT', json: { name, value: v } });
    onChange(r.keys);
    setValue('');
  }, v ? 'Gespeichert.' : 'Gelöscht.');
  const test = () => run(async () => {
    const r = await api<{ ok: boolean; message: string; keys: Keys }>(`/api/admin/keys/${name}/test`, { method: 'POST' });
    onChange(r.keys);
    if (!r.ok) throw new Error(r.message);
  }, 'Der Schlüssel funktioniert.');
  return (
    <Section title={t.title}>
      <p className="muted small">{t.hint}</p>
      <StatusLine s={status} />
      <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void save(value); }}>
        <label style={{ gridColumn: '1 / -1' }}>{status.set ? 'Neuen Schlüssel eintragen' : 'Schlüssel'}
          <input type="password" autoComplete="off" placeholder={t.field} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="button-row" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="btn" disabled={value.trim().length < 8}>Speichern</button>
          <button type="button" className="btn secondary" disabled={!status.set} onClick={() => void test()}>Testen</button>
          {status.source === 'app' && <button type="button" className="link danger" onClick={() => void save(null)}>Entfernen</button>}
        </div>
      </form>
      {view}
    </Section>
  );
}

function SmtpCard({ status, onChange }: { status: KeyStatus; onChange: (k: Keys) => void }) {
  const [run, view] = useAction();
  const [f, setF] = useState({ host: 'smtp.gmail.com', port: '465', user: '', pass: '', from: '' });
  const set = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const t = TITLES.smtp;
  const put = (value: unknown, ok: string) => run(async () => {
    const r = await api<{ keys: Keys }>('/api/admin/keys', { method: 'PUT', json: { name: 'smtp', value } });
    onChange(r.keys);
    setF({ ...f, pass: '' });
  }, ok);
  const test = () => run(async () => {
    const r = await api<{ ok: boolean; message: string; keys: Keys }>('/api/admin/keys/smtp/test', { method: 'POST' });
    onChange(r.keys);
    if (!r.ok) throw new Error(r.message);
  }, 'Anmeldung beim Mail-Server hat geklappt.');
  return (
    <Section title={t.title}>
      <p className="muted small">{t.hint}</p>
      <StatusLine s={status} />
      <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void put({ ...f, port: Number(f.port) }, 'Gespeichert.'); }}>
        <label>Server<input {...set('host')} required /></label>
        <label>Port<input inputMode="numeric" {...set('port')} required /></label>
        <label>Benutzer<input autoComplete="off" placeholder="stella@gmail.com" {...set('user')} required /></label>
        <label>Passwort (App-Passwort)<input type="password" autoComplete="off" {...set('pass')} required /></label>
        <label style={{ gridColumn: '1 / -1' }}>Absender (optional)<input placeholder="Stella <stella@gmail.com>" {...set('from')} /></label>
        <div className="button-row" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="btn">Speichern</button>
          <button type="button" className="btn secondary" disabled={!status.set} onClick={() => void test()}>Testen</button>
          {status.set && <button type="button" className="link danger" onClick={() => void put(null, 'Gelöscht.')}>Entfernen</button>}
        </div>
      </form>
      {view}
    </Section>
  );
}

/** Schlüssel zwischen dem Cloudflare-Worker für stella@ und diesem Server */
function InboundCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [secret, setSecret] = useState('');
  const [run, view, busy] = useAction();
  useEffect(() => { api<{ configured: boolean }>('/api/admin/inbound').then((r) => setConfigured(r.configured)).catch(() => {}); }, []);
  return (
    <Section title="Mail an Stella (stella@)">
      <p className="muted small">Cloudflare reicht Mails an stella@ über einen Worker an diesen Server weiter. Beide teilen einen geheimen Schlüssel. Er wird nur einmal angezeigt – kopiere ihn in Cloudflare (Worker „stella-mail“ → Variables and Secrets → INBOUND_SECRET).</p>
      <p className="small">{configured ? <strong style={{ color: 'var(--green)' }}>Schlüssel gesetzt</strong> : <strong style={{ color: 'var(--pink-text)' }}>Fehlt</strong>}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { const r = await api<{ secret: string }>('/api/admin/inbound-secret', { method: 'POST' }); setSecret(r.secret); setConfigured(true); }, configured ? 'Neuer Schlüssel erzeugt – der alte ist ungültig.' : 'Schlüssel erzeugt.')}>{configured ? 'Neuen Schlüssel erzeugen' : 'Schlüssel erzeugen'}</button>
      {secret && <><p className="small">Jetzt kopieren, danach ist er nicht mehr sichtbar:</p><div className="copy-row"><code style={{ wordBreak: 'break-all' }}>{secret}</code><button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(secret)}>Kopieren</button></div></>}
      {view}
    </Section>
  );
}

interface Invite { code: string; createdAt: string; expiresAt: string | null; usedBy: string | null }

/** Einladungscodes für neue Konten (Registrierung bleibt sonst zu). */
function Invites() {
  const [data, setData] = useState<{ mode: string; invites: Invite[] } | null>(null);
  const [run, view] = useAction();
  useEffect(() => { api<{ mode: string; invites: Invite[] }>('/api/admin/invites').then(setData).catch(() => {}); }, []);
  const modeText = data?.mode === 'open' ? 'Die Registrierung ist offen – jede:r kann sich anmelden.' : data?.mode === 'closed'
    ? 'Die Registrierung ist geschlossen – Einladungen gelten nicht.' : 'Neue Konten brauchen einen Einladungscode und bestätigen ihre E-Mail.';
  return (
    <Section title="Einladungen">
      <p className="muted small">{modeText}</p>
      <button type="button" className="btn" onClick={() => void run(async () => { const r = await api<{ invites: Invite[] }>('/api/admin/invites', { method: 'POST', json: { days: 14 } }); setData((d) => ({ mode: d?.mode ?? 'invite', invites: r.invites })); }, 'Neue Einladung erstellt (14 Tage gültig).')}>Neue Einladung</button>
      {data?.invites.map((i) => (
        <div key={i.code} className="copy-row" style={{ opacity: i.usedBy ? 0.6 : 1 }}>
          <code>{i.code}</code>
          <span className="small muted">{i.usedBy ? `benutzt von ${i.usedBy}` : i.expiresAt ? `gültig bis ${new Date(i.expiresAt).toLocaleDateString('de-AT')}` : ''}</span>
          {!i.usedBy && <button type="button" className="btn secondary small" onClick={() => void navigator.clipboard.writeText(i.code)}>Kopieren</button>}
          <button type="button" className="link danger small" onClick={() => void run(async () => { const r = await api<{ invites: Invite[] }>(`/api/admin/invites/${i.code}`, { method: 'DELETE' }); setData((d) => ({ mode: d?.mode ?? 'invite', invites: r.invites })); }, 'Gelöscht.')}>Löschen</button>
        </div>
      ))}
      {view}
    </Section>
  );
}
