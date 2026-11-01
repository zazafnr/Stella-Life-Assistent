import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, authenticate, meHas, meIsSchool, refreshMe, resendCode, startBackgroundSync, useStore, verifyEmail } from './store.ts';
import { Today } from './components/Today.tsx';
import { Chat } from './components/Chat.tsx';
import { Planner } from './components/Planner.tsx';
import { Inbox } from './components/Inbox.tsx';
import { Goals } from './components/Goals.tsx';
import { Finance } from './components/Finance.tsx';
import { StellaPlan } from './components/StellaPlan.tsx';
import { Health } from './components/Health.tsx';
import { Settings } from './components/Settings.tsx';
import { Intro, dismissBoot, introShown } from './components/Intro.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { Sky, StarMark, showToast } from './ui/Decor.tsx';
import { rememberLocale, useHtmlLang, useLocale, useT } from './i18n.ts';
import { LOCALES, LOCALE_NAMES, isLocale } from '@stella/shared';

export type Tab = 'today' | 'chat' | 'planner' | 'goals' | 'inbox' | 'health' | 'finance' | 'plan' | 'settings';

const TABS: [Tab, IconName, string][] = [
  ['today', 'sparkle', 'nav.today'],
  ['chat', 'chat', 'nav.chat'],
  ['planner', 'calendar', 'nav.planner'],
  ['goals', 'target', 'nav.goals'],
  ['inbox', 'inbox', 'nav.inbox'],
];
const ALL: Tab[] = ['today', 'chat', 'planner', 'goals', 'inbox', 'health', 'finance', 'plan', 'settings'];

function initialTab(): Tab {
  const hash = location.hash.slice(1) as Tab;
  return ALL.includes(hash) ? hash : 'today';
}

const isDesktopApp = typeof window !== 'undefined' && 'stellaDesktop' in window;

export function App() {
  const t = useT();
  useHtmlLang();
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
    showToast(q.get('message') || (q.get('ok') === '1' ? t('app.connected') : t('app.failed')), q.get('ok') !== '1');
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
      <nav className="sidebar" aria-label={t('nav.navigation')}>
        <div className="brand"><span style={{ color: 'var(--pink)' }}><StarMark size={18} /></span>Stella</div>
        {TABS.filter(([id]) => (id !== 'inbox' || meHas(me, 'mails')) && (id !== 'goals' || meHas(me, 'goals'))).map(([id, icon, label]) => (
          <button key={id} type="button" className={tab === id ? 'side-link active' : 'side-link'} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon name={icon} size={19} />{t(label)}
            {id === 'planner' && openHomework > 0 && <span className="side-badge">{openHomework}</span>}
          </button>
        ))}
        {meHas(me, 'health') && <button type="button" className={tab === 'health' ? 'side-link active' : 'side-link'} onClick={() => setTab('health')}><Icon name="heart" size={19} />{t('nav.health')}</button>}
        {meHas(me, 'finance') && <button type="button" className={tab === 'finance' ? 'side-link active' : 'side-link'} onClick={() => setTab('finance')}><Icon name="wallet" size={19} />{t('nav.finance')}</button>}
        <div className="side-spacer" />
        <button type="button" className={tab === 'settings' ? 'side-link active' : 'side-link'} onClick={() => setTab('settings')}><Icon name="gear" size={19} />{t('nav.settings')}</button>
      </nav>

      <main className="content">
        {!online && <div className="offline-bar">{t('app.offlineBar')}</div>}
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'chat' && <Chat />}
        {tab === 'planner' && <Planner />}
        {tab === 'goals' && <Goals />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'health' && <Health back={() => setTab('today')} />}
        {tab === 'finance' && <Finance back={() => setTab('today')} go={setTab} />}
        {tab === 'plan' && <StellaPlan back={() => setTab('today')} go={setTab} />}
        {tab === 'settings' && <Settings back={() => setTab('today')} openOnboarding={(startAt) => setOnboarding({ startAt })} openPlan={() => setTab('plan')} />}
      </main>

      <nav className="tabbar" aria-label={t('nav.navigation')}>
        {TABS.filter(([id]) => (id !== 'inbox' || meHas(me, 'mails')) && (id !== 'goals' || meHas(me, 'goals'))).map(([id, icon, label]) => (
          <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon name={icon} size={22} />{t(label)}
          </button>
        ))}
      </nav>
    </div>
    </>
  );
}

function Login() {
  const t = useT();
  const locale = useLocale();
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
      .catch(() => setError(t('auth.serverDown')));
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
        const res = await authenticate(mode, { ...form, locale });
        if (res?.needsVerification) toVerify(res.email, t('auth.codeSent', { email: res.email }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.data.needsVerification) toVerify(String(err.data.email ?? form.email), t('auth.notConfirmed'));
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    setError('');
    try { await resendCode(form.email); setInfo(t('auth.newCodeSent')); setWait(60); } catch (err) {
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
        <p className="tagline">{t('auth.tagline')}</p>
        {mode === 'verify' ? (
          <>
            {info && <p className="muted small" style={{ margin: 0 }}>{info}</p>}
            <label className="field" style={{ textAlign: 'left' }}>{t('auth.codeFromMail')}
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus placeholder="123456" {...field('code')} style={{ letterSpacing: '.3em', fontSize: 22, textAlign: 'center' }} />
            </label>
          </>
        ) : (
          <>
            {mode === 'register' && <label className="field" style={{ textAlign: 'left' }}>{t('auth.name')}<input autoComplete="given-name" required {...field('name')} /></label>}
            <label className="field" style={{ textAlign: 'left' }}>{t('auth.email')}<input type={mode === 'login' ? 'text' : 'email'} inputMode="email" autoCapitalize="none" autoComplete="email" required {...field('email')} /></label>
            <label className="field" style={{ textAlign: 'left' }}>{t('auth.password')}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} required {...field('password')} /></label>
            {mode === 'register' && hasUsers && registration === 'invite' && (
              <label className="field" style={{ textAlign: 'left' }}>{t('auth.inviteCode')}<input autoCapitalize="characters" autoComplete="off" required placeholder="ABCD-EFGH" {...field('invite')} /></label>
            )}
          </>
        )}
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {mode !== 'verify' && info && <p className="muted small" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn block" disabled={busy}>{mode === 'login' ? t('auth.login') : mode === 'register' ? t('auth.createAccount') : t('auth.confirm')}</button>
        {mode === 'verify' ? (
          <>
            <button type="button" className="link" disabled={wait > 0} onClick={() => void again()}>{wait > 0 ? t('auth.newCodeIn', { seconds: wait }) : t('auth.newCode')}</button>
            <button type="button" className="link" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>{t('auth.backToLogin')}</button>
          </>
        ) : canRegister ? (
          <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo(''); }}>
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccountLogin')}
          </button>
        ) : <p className="muted small" style={{ margin: 0 }}>{t('auth.registrationClosed')}</p>}
        <label className="field small" style={{ textAlign: 'center' }}><span className="sr-only">{t('auth.language')}</span>
          <select value={locale} aria-label={t('auth.language')} onChange={(e) => { if (isLocale(e.target.value)) rememberLocale(e.target.value); }}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
          </select></label>
        <p className="by-evolsior">by EVOLSIOR</p>
      </form>
    </div>
  );
}
