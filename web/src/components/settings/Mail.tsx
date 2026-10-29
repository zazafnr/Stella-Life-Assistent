import { useEffect, useState } from 'react';
import { api, refreshMe, type Me } from '../../store.ts';
import { Section, Toggle, useAction } from './ui.tsx';

interface Account { id: string; label: string; provider: string; user: string; lastError: string | null; checkedAt: string | null }

const HELP: Record<string, string> = {
  gmail: 'Gmail: myaccount.google.com → Sicherheit → Bestätigung in zwei Schritten einschalten → „App-Passwörter“ → neues Passwort für „Stella“.',
  icloud: 'iCloud: account.apple.com → Anmeldung und Sicherheit → „App-spezifische Passwörter“ → neues Passwort für „Stella“.',
  other: 'Bei anderen Anbietern: IMAP-Server und Passwort (oft auch ein App-Passwort).',
};

export function Mail({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ provider: 'gmail', label: '', user: '', pass: '', host: '' });
  const autoTrash = me.settings.mailAutoTrash !== false;

  useEffect(() => { api<Account[]>('/api/mail/accounts').then(setAccounts).catch(() => {}); }, []);

  return (
    <Section title="E-Mail">
      <p className="muted">Stella schaut alle 5 Minuten in deine Postfächer: Wichtiges bekommst du als Nachricht, Werbung und Spam wandern in den Papierkorb (in der Inbox wiederherstellbar). Instagram-/TikTok-Benachrichtigungen landen unter Inbox → Social.</p>
      <Toggle label="Werbung & Spam automatisch in den Papierkorb" checked={autoTrash}
        onChange={(v) => run(async () => { await api('/api/settings', { method: 'PATCH', json: { mailAutoTrash: v } }); await refreshMe(); }, 'Gespeichert.')} />

      {accounts.length > 0 && (
        <div className="shelf">
          {accounts.map((a) => (
            <div key={a.id} className="shelf-row">
              <span>
                {a.provider === 'gmail' ? '📮' : a.provider === 'icloud' ? '☁️' : '✉️'} <strong>{a.label}</strong> <span className="muted">{a.user}</span>
                {a.lastError ? <span className="error-text"> · {a.lastError}</span> : a.checkedAt ? <span className="muted"> · ✓</span> : null}
              </span>
              <button type="button" className="link danger" onClick={() => run(async () => setAccounts(await api(`/api/mail/accounts/${a.id}`, { method: 'DELETE' })), 'Entfernt.')}>✕</button>
            </div>
          ))}
        </div>
      )}

      <h3>Postfach hinzufügen</h3>
      <form className="form-grid two" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          setAccounts(await api('/api/mail/accounts', { method: 'POST', json: form }));
          setForm({ ...form, label: '', user: '', pass: '' });
          await refreshMe();
        }, 'Verbunden! Ab jetzt sortiert Stella neue Mails.');
      }}>
        <label>Anbieter
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="gmail">Gmail</option><option value="icloud">iCloud</option><option value="other">Anderer (IMAP)</option>
          </select>
        </label>
        <label>Name<input placeholder="z. B. Privat, Schule" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
        <label>E-Mail-Adresse<input type="email" required value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></label>
        <label>App-Passwort<input type="password" required autoComplete="off" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} /></label>
        {form.provider === 'other' && <label>IMAP-Server<input placeholder="imap.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></label>}
        <button type="submit" className="btn">Verbinden</button>
      </form>
      <p className="muted small">{HELP[form.provider]}</p>
      {view}
    </Section>
  );
}
