import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, authenticate, meHas, meIsSchool, refreshMe, resendCode, startBackgroundSync, useStore, verifyEmail } from './store.ts';
import { Today } from './components/Today.tsx';
import { Chat } from './components/Chat.tsx';
import { Planner } from './components/Planner.tsx';
import { Inbox } from './components/Inbox.tsx';
import { Goals } from './components/Goals.tsx';
import { Health } from './components/Health.tsx';
import { Settings } from './components/Settings.tsx';
import { Intro, dismissBoot, introShown } from './components/Intro.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { Sky, StarMark, showToast } from './ui/Decor.tsx';

export type Tab = 'today' | 'chat' | 'planner' | 'goals' | 'inbox' | 'health' | 'settings';

const TABS: [Tab, IconName, string][] = [
  ['today', 'sparkle', 'Heute'],
  ['chat', 'chat', 'Chat'],
  ['planner', 'calendar', 'Planer'],
  ['goals', 'target', 'Ziele'],
  ['inbox', 'inbox', 'Inbox'],
];
const ALL: Tab[] = ['today', 'chat', 'planner', 'goals', 'inbox', 'health', 'settings'];

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
  const me = useStore((s) => s.me);
  /** Einführung: beim ersten Mal von selbst (onboarding = pending), später aus den Einstellungen */
  const [onboarding, setOnboarding] = useState<{ startAt: 'welcome' | 'situation' } | null>(null);
  const showOnboarding = onboarding ?? (me?.settings.onboarding === 'pending' ? { startAt: 'welcome' as const } : null);

  const hasMe = useStore((s) => !!s.me);
  const lastSync = useStore((s) => s.lastSync);
  const [intro, setIntro] = useState(() => !introShown());
  const [ready, setReady] = useState(false);
  // Ladebildschirm (steht in index.html) geht weg, sobald Anmeldestatus und Daten da sind – spätestens nach 4 s
  useEffect(() => { if (!token || hasMe || lastSync) setReady(true); }, [token, hasMe, lastSync]);
  useEffect(() => { const t = setTimeout(() => setReady(true), 4000); return () => clearTimeout(t); }, []);
  useEffect(() => { if (ready) dismissBoot(); }, [ready]);
  useEffect(() => { if (token) startBackgroundSync(); }, [token]);
  useEffect(() => { if (token && !hasMe) void refreshMe().catch(() => {}); }, [token, hasMe]);
  useEffect(() => { history.replaceState(null, '', tab === 'today' ? location.pathname : `#${tab}`); }, [tab]);
  useEffect(() => { document.documentElement.classList.toggle('is-desktop', isDesktopApp); }, []);
  // zurück von "Mit Google anmelden": ?provider=gmail&ok=1&message=…#settings
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('provider')) return;
    showToast(q.get('message') || (q.get('ok') === '1' ? 'Verbunden!' : 'Hat nicht geklappt'), q.get('ok') !== '1');
    history.replaceState(null, '', location.pathname + location.hash);
    if (token) void refreshMe().catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!isDesktopApp) return;
    // Fensterknöpfe oben rechts sitzen auf dem Himmel – nur im Chat mit Seitenspalte auf Weiß
    const paint = () => window.stellaDesktop?.setTitleBarColor?.(tab === 'chat' && innerWidth >= 1240 ? '#FAFCFF' : '#D2E7FE');
    paint();
    addEventListener('resize', paint);
    return () => removeEventListener('resize', paint);
  }, [tab]);

  const school = meIsSchool(me);
  const openHomework = useMemo(() => (school ? Object.values(items).filter((i) => i.kind === 'homework' && i.status === 'open' && !i.deleted).length : 0), [items, school]);

  const introLayer = intro ? <Intro onDone={() => setIntro(false)} /> : null;

  if (!token) return <>{introLayer}<Login /></>;

  return (
    <>
    {introLayer}
    {showOnboarding && <Onboarding startAt={showOnboarding.startAt} onDone={(after) => { setOnboarding(null); if (after === 'settings') setTab('settings'); }} />}
    <div className="app">
      <div className="desktop-drag" aria-hidden="true" />
      <nav className="sidebar" aria-label="Navigation">
        <div className="brand"><span style={{ color: 'var(--pink)' }}><StarMark size={18} /></span>Stella</div>
        {TABS.filter(([t]) => t !== 'inbox' || meHas(me, 'mails')).map(([t, icon, label]) => (
          <button key={t} type="button" className={tab === t ? 'side-link active' : 'side-link'} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
            <Icon name={icon} size={19} />{label}
            {t === 'planner' && openHomework > 0 && <span className="side-badge">{openHomework}</span>}
          </button>
        ))}
        {meHas(me, 'health') && <button type="button" className={tab === 'health' ? 'side-link active' : 'side-link'} onClick={() => setTab('health')}><Icon name="heart" size={19} />Gesundheit</button>}
        <div className="side-spacer" />
        <button type="button" className={tab === 'settings' ? 'side-link active' : 'side-link'} onClick={() => setTab('settings')}><Icon name="gear" size={19} />Einstellungen</button>
      </nav>

      <main className="content">
        {!online && <div className="offline-bar">Offline – Stella merkt sich alles und gleicht ab, sobald du wieder Netz hast.</div>}
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'chat' && <Chat />}
        {tab === 'planner' && <Planner />}
        {tab === 'goals' && <Goals />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'health' && <Health back={() => setTab('today')} />}
        {tab === 'settings' && <Settings back={() => setTab('today')} openOnboarding={(startAt) => setOnboarding({ startAt })} />}
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {TABS.filter(([t]) => t !== 'inbox' || meHas(me, 'mails')).map(([t, icon, label]) => (
          <button key={t} type="button" className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
            <Icon name={icon} size={22} />{label}
          </button>
        ))}
      </nav>
    </div>
    </>
  );
}

function Login() {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', invite: '', code: '' });
  const [registration, setRegistration] = useState<'closed' | 'invite' | 'open'>('invite');
  const [hasUsers, setHasUsers] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    api<{ hasUsers: boolean; registration?: 'closed' | 'invite' | 'open' }>('/api/status')
      .then((s) => { setHasUsers(s.hasUsers); setRegistration(s.registration ?? 'invite'); if (!s.hasUsers) setMode('register'); })
      .catch(() => setError('Server nicht erreichbar.'));
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const toVerify = (email: string, note: string) => { setForm((f) => ({ ...f, email, code: '' })); setMode('verify'); setInfo(note); setWait(60); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'verify') {
        await verifyEmail(form.email, form.code);
      } else {
        const res = await authenticate(mode, form);
        if (res?.needsVerification) toVerify(res.email, `Ich habe dir einen 6-stelligen Code an ${res.email} geschickt. Er gilt 15 Minuten.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.data.needsVerification) toVerify(String(err.data.email ?? form.email), 'Dein Konto ist noch nicht bestätigt. Gib den Code aus der Mail ein – oder fordere einen neuen an.');
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    setError('');
    try { await resendCode(form.email); setInfo('Neuer Code ist unterwegs.'); setWait(60); } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && typeof err.data.retryIn === 'number') setWait(err.data.retryIn);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const canRegister = !hasUsers || registration !== 'closed';

  return (
    <div className="login">
      <Sky />
      <form className="login-card rise" onSubmit={submit}>
        <div className="login-star"><StarMark size={34} /></div>
        <h1 className="display">Stella</h1>
        <p className="tagline">Let Stella handle your life.</p>
        {mode === 'verify' ? (
          <>
            {info && <p className="muted small" style={{ margin: 0 }}>{info}</p>}
            <label className="field" style={{ textAlign: 'left' }}>Code aus der Mail
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus placeholder="123456" {...field('code')} style={{ letterSpacing: '.3em', fontSize: 22, textAlign: 'center' }} />
            </label>
          </>
        ) : (
          <>
            {mode === 'register' && <label className="field" style={{ textAlign: 'left' }}>Dein Name<input autoComplete="given-name" required {...field('name')} /></label>}
            <label className="field" style={{ textAlign: 'left' }}>E-Mail<input type={mode === 'login' ? 'text' : 'email'} inputMode="email" autoCapitalize="none" autoComplete="email" required {...field('email')} /></label>
            <label className="field" style={{ textAlign: 'left' }}>Passwort<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} required {...field('password')} /></label>
            {mode === 'register' && hasUsers && registration === 'invite' && (
              <label className="field" style={{ textAlign: 'left' }}>Einladungscode<input autoCapitalize="characters" autoComplete="off" required placeholder="ABCD-EFGH" {...field('invite')} /></label>
            )}
          </>
        )}
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {mode !== 'verify' && info && <p className="muted small" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn block" disabled={busy}>{mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Bestätigen'}</button>
        {mode === 'verify' ? (
          <>
            <button type="button" className="link" disabled={wait > 0} onClick={() => void again()}>{wait > 0 ? `Neuen Code senden (${wait} s)` : 'Neuen Code senden'}</button>
            <button type="button" className="link" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>Zurück zur Anmeldung</button>
          </>
        ) : canRegister ? (
          <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo(''); }}>
            {mode === 'login' ? 'Noch kein Konto?' : 'Schon ein Konto? Anmelden'}
          </button>
        ) : <p className="muted small" style={{ margin: 0 }}>Neue Konten sind gerade nicht möglich.</p>}
        <p className="by-evolsior">by EVOLSIOR</p>
      </form>
    </div>
  );
}
