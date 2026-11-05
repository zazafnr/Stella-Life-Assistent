import { useEffect, useRef, useState } from 'react';
import { api, refreshMe, type Me } from '../../store.ts';
import { Section, Toggle, useAction } from './ui.tsx';

interface Account { id: string; label: string; provider: string; user: string; auth?: 'google' | 'password'; lastError: string | null; checkedAt: string | null }

const isDesktop = 'stellaDesktop' in window;

/** Google-Logo in den Originalfarben – Googles Vorgabe für Anmelde-Knöpfe */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Mail({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [manual, setManual] = useState<'icloud' | 'gmail' | 'other' | null>(null);
  const [form, setForm] = useState({ label: '', user: '', pass: '', host: '' });
  const [waiting, setWaiting] = useState(false);
  const poll = useRef<number | null>(null);
  const autoTrash = me.settings.mailAutoTrash !== false;
  const google = me.integrations.googleSignIn === true;

  const load = () => api<Account[]>('/api/mail/accounts').then((a) => { setAccounts(a); return a; });
  useEffect(() => { void load().catch(() => {}); return () => { if (poll.current) clearInterval(poll.current); }; }, []);

  /** Google-Anmeldung starten. PC-App: im normalen Browser (Google erlaubt keine eingebetteten Fenster), dann hier warten. */
  async function signInWithGoogle(email?: string) {
    const { url } = await api<{ url: string }>('/api/oauth/google/start', { method: 'POST', json: { client: isDesktop ? 'desktop' : 'web', email } });
    if (!isDesktop) { location.href = url; return; }
    window.open(url, '_blank');
    setWaiting(true);
    const before = new Map(accounts.map((a) => [a.id, a.auth]));
    const started = Date.now();
    if (poll.current) clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      const now = await load().catch(() => null);
      const fresh = now?.find((a) => a.auth === 'google' && before.get(a.id) !== 'google');
      if (fresh || Date.now() - started > 5 * 60_000) {
        clearInterval(poll.current!);
        poll.current = null;
        setWaiting(false);
        if (fresh) await refreshMe();
      }
    }, 3000);
  }

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
                <span className="pill gray" style={{ marginLeft: 6 }}>{a.auth === 'google' ? 'Google-Anmeldung' : 'App-Passwort'}</span>
                {a.lastError ? <span className="error-text"> · {a.lastError}</span> : a.checkedAt ? <span className="muted"> · ✓</span> : null}
              </span>
              <span className="row" style={{ gap: 6 }}>
                {google && a.provider === 'gmail' && (a.auth !== 'google' || a.lastError) && (
                  <button type="button" className="link" onClick={() => run(() => signInWithGoogle(a.user), isDesktop ? 'Im Browser weiter …' : 'Weiter zu Google …')}>
                    {a.auth === 'google' ? 'Neu verbinden' : 'Auf Google umstellen'}
                  </button>
                )}
                <button type="button" className="link danger" aria-label={`${a.label} entfernen`} onClick={() => run(async () => setAccounts(await api(`/api/mail/accounts/${a.id}`, { method: 'DELETE' })), 'Entfernt.')}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <h3>Postfach hinzufügen</h3>
      <div className="connect-grid">
        {google ? (
          <button type="button" className="btn-google" disabled={waiting} onClick={() => run(() => signInWithGoogle(), isDesktop ? 'Melde dich im Browser bei Google an – Stella wartet hier.' : 'Weiter zu Google …')}>
            <GoogleG />{waiting ? 'Warte auf Google …' : 'Mit Google anmelden'}
          </button>
        ) : (
          <button type="button" className={manual === 'gmail' ? 'btn' : 'btn secondary'} onClick={() => setManual('gmail')}>📮 Gmail</button>
        )}
        <button type="button" className={manual === 'icloud' ? 'btn' : 'btn secondary'} onClick={() => setManual('icloud')}>☁️ iCloud</button>
        <button type="button" className={manual === 'other' ? 'btn' : 'btn secondary'} onClick={() => setManual('other')}>✉️ Andere</button>
      </div>
      {waiting && <p className="hint">Sobald du bei Google auf „Zulassen“ getippt hast, taucht das Postfach hier auf. Zeigt Google „App nicht überprüft“: auf „Erweitert“ → „Weiter zu Stella“ – das ist deine eigene Stella.</p>}
      {google && !manual && <p className="muted small">Gmail ohne App-Passwort: einfach anmelden und zulassen. <button type="button" className="link small" onClick={() => setManual('gmail')}>Lieber mit App-Passwort</button></p>}

      {manual && (
        <form className="form-grid two rise" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setAccounts(await api('/api/mail/accounts', { method: 'POST', json: { ...form, provider: manual } }));
            setForm({ label: '', user: '', pass: '', host: '' });
            setManual(null);
            await refreshMe();
          }, 'Verbunden! Ab jetzt sortiert Stella neue Mails.');
        }}>
          {manual !== 'other' && (
            <ol className="steps" style={{ gridColumn: '1 / -1' }}>
              {manual === 'icloud' ? (
                <>
                  <li>iCloud kennt keine Anmeldung für fremde Apps – dafür gibt es ein <strong>App-Passwort</strong> (dein Apple-Passwort bleibt geheim).</li>
                  <li><a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">account.apple.com</a> → <strong>Anmeldung und Sicherheit</strong> → <strong>App-spezifische Passwörter</strong> → „+“ → Name „Stella“.</li>
                  <li>Das Passwort (xxxx-xxxx-xxxx-xxxx) hier einfügen, dazu deine iCloud-Adresse.</li>
                </>
              ) : (
                <>
                  <li><a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> öffnen (braucht Bestätigung in zwei Schritten).</li>
                  <li>Name „Stella“ → <strong>Erstellen</strong> → die 16 Zeichen hier einfügen.</li>
                </>
              )}
            </ol>
          )}
          <label>E-Mail-Adresse<input type="email" required value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></label>
          <label>App-Passwort<input type="password" required autoComplete="off" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} /></label>
          <label>Name<input placeholder="z. B. Privat, Schule" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          {manual === 'other' && <label>IMAP-Server<input placeholder="imap.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></label>}
          <button type="submit" className="btn">Verbinden</button>
        </form>
      )}
      {view}
    </Section>
  );
}
