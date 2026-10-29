import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, authenticate, refreshMe, startBackgroundSync, useStore } from './store.ts';
import { Today } from './components/Today.tsx';
import { Chat } from './components/Chat.tsx';
import { Planner } from './components/Planner.tsx';
import { Inbox } from './components/Inbox.tsx';
import { Health } from './components/Health.tsx';
import { Settings } from './components/Settings.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { Sky, StarMark } from './ui/Decor.tsx';

export type Tab = 'today' | 'chat' | 'planner' | 'inbox' | 'health' | 'settings';

const TABS: [Tab, IconName, string][] = [
  ['today', 'sparkle', 'Heute'],
  ['chat', 'chat', 'Chat'],
  ['planner', 'calendar', 'Planer'],
  ['inbox', 'inbox', 'Inbox'],
];
const ALL: Tab[] = ['today', 'chat', 'planner', 'inbox', 'health', 'settings'];

function initialTab(): Tab {
  const hash = location.hash.slice(1) as Tab;
  return ALL.includes(hash) ? hash : 'today';
}

const isDesktopApp = typeof window !== 'undefined' && 'stellaDesktop' in window;

export function App() {
  const token = useStore((s) => s.token);
  const online = useStore((s) => s.online);
  const items = useStore((s) => s.items);
  const [tab, setTab] = useState<Tab>(initialTab);

  const hasMe = useStore((s) => !!s.me);
  useEffect(() => { if (token) startBackgroundSync(); }, [token]);
  useEffect(() => { if (token && !hasMe) void refreshMe().catch(() => {}); }, [token, hasMe]);
  useEffect(() => { history.replaceState(null, '', tab === 'today' ? location.pathname : `#${tab}`); }, [tab]);
  useEffect(() => { document.documentElement.classList.toggle('is-desktop', isDesktopApp); }, []);
  useEffect(() => {
    if (!isDesktopApp) return;
    // Fensterknöpfe oben rechts sitzen auf dem Himmel – nur im Chat mit Seitenspalte auf Weiß
    const paint = () => window.stellaDesktop?.setTitleBarColor?.(tab === 'chat' && innerWidth >= 1240 ? '#FAFCFF' : '#D2E7FE');
    paint();
    addEventListener('resize', paint);
    return () => removeEventListener('resize', paint);
  }, [tab]);

  const openHomework = useMemo(() => Object.values(items).filter((i) => i.kind === 'homework' && i.status === 'open' && !i.deleted).length, [items]);

  if (!token) return <Login />;

  return (
    <div className="app">
      <div className="desktop-drag" aria-hidden="true" />
      <nav className="sidebar" aria-label="Navigation">
        <div className="brand"><span style={{ color: 'var(--pink)' }}><StarMark size={18} /></span>Stella</div>
        {TABS.map(([t, icon, label]) => (
          <button key={t} type="button" className={tab === t ? 'side-link active' : 'side-link'} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
            <Icon name={icon} size={19} />{label}
            {t === 'planner' && openHomework > 0 && <span className="side-badge">{openHomework}</span>}
          </button>
        ))}
        <button type="button" className={tab === 'health' ? 'side-link active' : 'side-link'} onClick={() => setTab('health')}><Icon name="heart" size={19} />Gesundheit</button>
        <div className="side-spacer" />
        <button type="button" className={tab === 'settings' ? 'side-link active' : 'side-link'} onClick={() => setTab('settings')}><Icon name="gear" size={19} />Einstellungen</button>
      </nav>

      <main className="content">
        {!online && <div className="offline-bar">Offline – Stella merkt sich alles und gleicht ab, sobald du wieder Netz hast.</div>}
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'chat' && <Chat />}
        {tab === 'planner' && <Planner />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'health' && <Health back={() => setTab('today')} />}
        {tab === 'settings' && <Settings back={() => setTab('today')} />}
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {TABS.map(([t, icon, label]) => (
          <button key={t} type="button" className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
            <Icon name={icon} size={22} />{label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ hasUsers: boolean }>('/api/status')
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
      <Sky />
      <form className="login-card rise" onSubmit={submit}>
        <div className="login-star"><StarMark size={34} /></div>
        <h1 className="display">Stella</h1>
        <p className="tagline">Let Stella handle your life.</p>
        {mode === 'register' && <label className="field" style={{ textAlign: 'left' }}>Dein Name<input autoComplete="given-name" required {...field('name')} /></label>}
        <label className="field" style={{ textAlign: 'left' }}>E-Mail<input type="email" autoComplete="email" required {...field('email')} /></label>
        <label className="field" style={{ textAlign: 'left' }}>Passwort<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required {...field('password')} /></label>
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        <button type="submit" className="btn block" disabled={busy}>{mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Noch kein Konto?' : 'Schon ein Konto? Anmelden'}
        </button>
      </form>
    </div>
  );
}
