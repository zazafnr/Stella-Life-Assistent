import { useEffect, useState, type FormEvent } from 'react';
import { api, authenticate, startBackgroundSync, useStore } from './store.ts';
import { Chat } from './components/Chat.tsx';
import { Planner } from './components/Planner.tsx';
import { Health } from './components/Health.tsx';
import { Settings } from './components/Settings.tsx';

type Tab = 'chat' | 'planner' | 'health' | 'settings';
const TABS: [Tab, string, string][] = [
  ['chat', '💬', 'Chat'],
  ['planner', '🗓️', 'Planer'],
  ['health', '❤️', 'Gesundheit'],
  ['settings', '⚙️', 'Einstellungen'],
];

function initialTab(): Tab {
  const hash = location.hash.slice(1) as Tab;
  return TABS.some(([t]) => t === hash) ? hash : 'chat';
}

export function App() {
  const token = useStore((s) => s.token);
  const online = useStore((s) => s.online);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => { if (token) startBackgroundSync(); }, [token]);
  useEffect(() => { history.replaceState(null, '', tab === 'chat' ? location.pathname : `#${tab}`); }, [tab]);

  if (!token) return <Login />;

  return (
    <div className="app">
      <nav className="tabs">
        <div className="brand"><span className="star">✦</span> Stella</div>
        {TABS.map(([t, icon, label]) => (
          <button key={t} type="button" className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            <span className="tab-icon">{icon}</span><span className="tab-label">{label}</span>
          </button>
        ))}
      </nav>
      <main className="content">
        {!online && <div className="offline-bar">📴 Offline – Stella merkt sich alles und gleicht ab, sobald du wieder Netz hast.</div>}
        {tab === 'chat' && <Chat />}
        {tab === 'planner' && <Planner />}
        {tab === 'health' && <Health />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ hasUsers: boolean; registrationOpen: boolean }>('/api/status')
      .then((s) => { if (!s.hasUsers) setMode('register'); })
      .catch(() => setError('Server nicht erreichbar.'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authenticate(mode, form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-star">✦</div>
        <h1>Stella</h1>
        <p className="tagline">Let Stella handle your life.</p>
        {mode === 'register' && <input placeholder="Dein Name" autoComplete="given-name" required {...field('name')} />}
        <input type="email" placeholder="E-Mail" autoComplete="email" required {...field('email')} />
        <input type="password" placeholder="Passwort" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required {...field('password')} />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={busy}>{mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Noch kein Konto?' : 'Schon ein Konto? Anmelden'}
        </button>
      </form>
    </div>
  );
}
