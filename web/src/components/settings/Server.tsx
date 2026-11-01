import { useEffect, useState } from 'react';
import { api } from '../../store.ts';
import { Section, useAction } from './ui.tsx';

type Name = 'anthropic' | 'groq' | 'openrouter' | 'smtp' | 'stripe';
interface KeyStatus { set: boolean; source: 'env' | 'app' | null; lastOk: string | null; lastError: string | null }
type Keys = Record<Name, KeyStatus>;

const TITLES: Record<Name, { title: string; hint: string; field: string }> = {
  anthropic: { title: 'Anthropic-API-Key (Claude)', hint: 'Claude Haiku erledigt fast alles, Claude Sonnet nur schwere Aufgaben. Key aus console.anthropic.com; dort bitte ein Ausgabenlimit setzen.', field: 'sk-ant-…' },
  groq: { title: 'Groq-API-Key', hint: 'Mails einordnen, Chat-Titel und Sprachnachrichten. Kostenlos erhältlich auf console.groq.com.', field: 'gsk_…' },
  openrouter: { title: 'OpenRouter-API-Key', hint: 'Für Chat und Planer. Ohne Eintrag hier gilt der Schlüssel aus der Server-Umgebung.', field: 'sk-or-…' },
  stripe: { title: 'Stripe (Bezahlung der Abos)', hint: 'Geheimer Schlüssel (sk_…) und Webhook-Geheimnis (whsec_…). Webhook-URL in Stripe: https://stella.evolsior.com/api/billing/webhook – Ereignisse: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.', field: '' },
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
      {(['anthropic', 'groq', 'openrouter'] as const).map((n) => <KeyCard key={n} name={n} status={keys[n]} onChange={setKeys} />)}
      <FallbackCard />
      <SmtpCard status={keys.smtp} onChange={setKeys} />
      <StripeCard status={keys.stripe} onChange={setKeys} />
      <PlansAdmin />
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

function KeyCard({ name, status, onChange }: { name: 'anthropic' | 'groq' | 'openrouter'; status: KeyStatus; onChange: (k: Keys) => void }) {
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

/** Notfall: bei Ausfall von Claude auf die Gratis-Modelle von OpenRouter ausweichen (Mails gehen nie dorthin) */
function FallbackCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [run, view] = useAction();
  useEffect(() => { api<{ allowFreeFallback: boolean }>('/api/admin/ai').then((r) => setOn(r.allowFreeFallback)).catch(() => {}); }, []);
  if (on === null) return null;
  return (
    <Section title="Notfall-Modelle">
      <p className="muted small">Wenn Claude nicht erreichbar ist, darf Stella auf die Gratis-Modelle von OpenRouter ausweichen. Inhalte aus Mails gehen nie an Gratis-Anbieter, egal wie dieser Schalter steht.</p>
      <label className="check-row"><input type="checkbox" checked={on} onChange={(e) => void run(async () => {
        const r = await api<{ allowFreeFallback: boolean }>('/api/admin/ai', { method: 'PUT', json: { allowFreeFallback: e.target.checked } });
        setOn(r.allowFreeFallback);
      }, 'Gespeichert.')} /> Bei Claude-Ausfall auf Gratis-Modelle ausweichen</label>
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

function StripeCard({ status, onChange }: { status: KeyStatus; onChange: (k: Keys) => void }) {
  const [run, view] = useAction();
  const [f, setF] = useState({ secretKey: '', webhookSecret: '' });
  const t = TITLES.stripe;
  const put = (value: unknown, ok: string) => run(async () => {
    const r = await api<{ keys: Keys }>('/api/admin/keys', { method: 'PUT', json: { name: 'stripe', value } });
    onChange(r.keys);
    setF({ secretKey: '', webhookSecret: '' });
  }, ok);
  const test = () => run(async () => {
    const r = await api<{ ok: boolean; message: string; keys: Keys }>('/api/admin/keys/stripe/test', { method: 'POST' });
    onChange(r.keys);
    if (!r.ok) throw new Error(r.message);
  }, 'Der Schlüssel funktioniert.');
  return (
    <Section title={t.title}>
      <p className="muted small">{t.hint}</p>
      <StatusLine s={status} />
      <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void put(f, 'Gespeichert.'); }}>
        <label style={{ gridColumn: '1 / -1' }}>Geheimer Schlüssel<input type="password" autoComplete="off" placeholder="sk_live_…" value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value })} required /></label>
        <label style={{ gridColumn: '1 / -1' }}>Webhook-Geheimnis<input type="password" autoComplete="off" placeholder="whsec_…" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} /></label>
        <div className="button-row" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="btn">Speichern</button>
          <button type="button" className="btn secondary" disabled={!status.set} onClick={() => void test()}>Testen</button>
          {status.source === 'app' && <button type="button" className="link danger" onClick={() => void put(null, 'Gelöscht.')}>Entfernen</button>}
        </div>
      </form>
      {view}
    </Section>
  );
}

interface PlanRow { id: string; priceCents: number; limits: { aiMessagesPerDay: number; proTasksPerMonth: number; mailboxes: number } }

/** Limits der Abos ändern (ohne Deploy) und Abos schenken */
function PlansAdmin() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [run, view] = useAction();
  const [gift, setGift] = useState({ email: '', plan: 'plus', days: '30' });
  useEffect(() => { api<{ effective: PlanRow[] }>('/api/admin/plans').then((r) => setPlans(r.effective)).catch(() => {}); }, []);
  if (!plans) return null;
  const set = (id: string, key: 'aiMessagesPerDay' | 'proTasksPerMonth' | 'mailboxes', v: string) =>
    setPlans(plans.map((p) => (p.id === id ? { ...p, limits: { ...p.limits, [key]: Number(v) || 0 } } : p)));
  return (
    <>
      <Section title="Abos und Limits">
        <p className="muted small">Gilt sofort, ohne Neustart. Startwerte stehen in shared/src/plans.ts; hier eingetragene Zahlen überschreiben sie.</p>
        {plans.map((p) => (
          <div key={p.id} className="form-grid two">
            <strong style={{ gridColumn: '1 / -1' }}>{p.id}</strong>
            <label>KI-Nachrichten/Tag<input inputMode="numeric" value={p.limits.aiMessagesPerDay} onChange={(e) => set(p.id, 'aiMessagesPerDay', e.target.value)} /></label>
            <label>Profi-Aufgaben/Monat<input inputMode="numeric" value={p.limits.proTasksPerMonth} onChange={(e) => set(p.id, 'proTasksPerMonth', e.target.value)} /></label>
            <label>Postfächer (999 = unbegrenzt)<input inputMode="numeric" value={p.limits.mailboxes} onChange={(e) => set(p.id, 'mailboxes', e.target.value)} /></label>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => void run(async () => {
          const body = Object.fromEntries(plans.map((p) => [p.id, p.limits]));
          await api('/api/admin/plans', { method: 'PUT', json: body });
        }, 'Gespeichert.')}>Limits speichern</button>
      </Section>
      <Section title="Abo schenken">
        <p className="muted small">Für Tester und Freunde: ohne Bezahlung, mit Ablaufdatum (leer = unbegrenzt).</p>
        <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/admin/billing/gift', { method: 'POST', json: { email: gift.email, plan: gift.plan, days: gift.days || null } }); }, 'Abo geschenkt.'); }}>
          <label style={{ gridColumn: '1 / -1' }}>E-Mail des Kontos<input type="email" value={gift.email} onChange={(e) => setGift({ ...gift, email: e.target.value })} required /></label>
          <label>Abo<select value={gift.plan} onChange={(e) => setGift({ ...gift, plan: e.target.value })}>{['free', 'plus', 'pro', 'max'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Tage<input inputMode="numeric" value={gift.days} onChange={(e) => setGift({ ...gift, days: e.target.value })} /></label>
          <button type="submit" className="btn" style={{ gridColumn: '1 / -1' }}>Schenken</button>
        </form>
        {view}
      </Section>
    </>
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
