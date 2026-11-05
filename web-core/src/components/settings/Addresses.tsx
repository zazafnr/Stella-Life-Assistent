import { useEffect, useState } from 'react';
import { api, type Me } from '../../store.ts';
import { Section, useAction } from './ui.tsx';

interface Address { id: string; email: string; verified: boolean; primary: boolean }

/** Von welchen Adressen Stella E-Mails annimmt (stella@evolsior.com) */
const isDesktop = 'stellaDesktop' in window;

export function Addresses({ me }: { me: Me }) {
  const [list, setList] = useState<Address[] | null>(null);
  const [email, setEmail] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [run, view, busy] = useAction();
  useEffect(() => { api<{ emails: Address[] }>('/api/me/emails').then((r) => setList(r.emails)).catch(() => setList([])); }, []);
  const google = me.integrations.googleSignIn === true;
  /** Google bestätigt die Adresse. PC-App: im Browser öffnen und hier auf das Ergebnis warten. */
  const withGoogle = () => run(async () => {
    const { url } = await api<{ url: string }>('/api/me/emails/google', { method: 'POST', json: { client: isDesktop ? 'desktop' : 'web' } });
    if (!isDesktop) { location.href = url; return; }
    window.open(url, '_blank');
    const known = list?.length ?? 0;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const now = (await api<{ emails: Address[] }>('/api/me/emails')).emails;
      if (now.length > known) { setList(now); return; }
    }
    throw new Error('Keine Antwort von Google bekommen. Versuch es nochmal.');
  }, isDesktop ? 'Adresse ist verknüpft.' : 'Weiter zu Google …');
  const pending = list?.find((a) => !a.verified && !a.primary);
  return (
    <>
      <Section title="Schreib Stella eine Mail">
        <p>Schick eine Nachricht an <strong>stella@evolsior.com</strong> – zum Beispiel vom Arbeitscomputer aus. Stella erledigt es und antwortet dir kurz. Bei Fragen antwortet sie ausführlich.</p>
        <p className="muted small">Antworten bekommst du nur von Adressen, die zu deinem Konto gehören. Schreibt jemand Fremdes, bekommt er höchstens einen Hinweis, dass er ein Konto braucht. Stella liest nur den Text, keine Anhänge.</p>
      </Section>
      <Section title="Meine E-Mail-Adressen">
        {list?.map((a) => (
          <div key={a.id} className="copy-row">
            <code>{a.email}</code>
            <span className="small muted">{a.primary ? 'Konto' : a.verified ? 'bestätigt' : 'wartet auf Code'}</span>
            {!a.primary && <button type="button" className="link danger small" disabled={busy} onClick={() => void run(async () => setList((await api<{ emails: Address[] }>(`/api/me/emails/${a.id}`, { method: 'DELETE' })).emails), 'Entfernt.')}>Entfernen</button>}
          </div>
        ))}
        {pending && (
          <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void run(async () => { setList((await api<{ emails: Address[] }>(`/api/me/emails/${pending.id}/verify`, { method: 'POST', json: { code: codes[pending.id] ?? '' } })).emails); }, 'Verknüpft. Du kannst Stella jetzt von dieser Adresse schreiben.'); }}>
            <label style={{ gridColumn: '1 / -1' }}>Code aus der Mail an {pending.email}
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={codes[pending.id] ?? ''} onChange={(e) => setCodes({ ...codes, [pending.id]: e.target.value })} />
            </label>
            <div className="button-row" style={{ gridColumn: '1 / -1' }}><button type="submit" className="btn" disabled={busy || (codes[pending.id] ?? '').length < 6}>Bestätigen</button></div>
          </form>
        )}
        <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void run(async () => { setList((await api<{ emails: Address[] }>('/api/me/emails', { method: 'POST', json: { email } })).emails); setEmail(''); }, 'Code verschickt. Gib ihn oben ein.'); }}>
          <label style={{ gridColumn: '1 / -1' }}>{google ? 'Andere Adresse, per Code bestätigen' : 'Adresse hinzufügen'}
            <input type="email" autoComplete="off" placeholder="du@firma.at" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <div className="button-row" style={{ gridColumn: '1 / -1' }}><button type="submit" className="btn" disabled={busy || !email.includes('@')}>Code schicken</button></div>
        </form>
        {google && (
          <div className="button-row">
            <button type="button" className="btn-google" disabled={busy} onClick={() => void withGoogle()}>Mit Google bestätigen</button>
          </div>
        )}
        {view}
      </Section>
    </>
  );
}
