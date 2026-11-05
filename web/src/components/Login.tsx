import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LOCALES, LOCALE_NAMES, isLocale } from '@stella/shared';
import {
  api, ApiError, authenticate, claimLogin, pendingLogin, requestLoginLink, resendCode, setNewPassword, submitLoginCode, type PendingLogin,
} from '../store.ts';
import { rememberLocale, useLocale, useT } from '../i18n.ts';
import { Sky, StarMark } from '../ui/Decor.tsx';
import { Icon } from '../ui/Icon.tsx';

type Mode = 'login' | 'register' | 'wait' | 'link' | 'reset' | 'newpass';

/** Anmelden, Registrieren, auf den Link in der Mail warten (mit Code-Eingabe für „anderes Gerät“), Passwort vergessen. */
export function Login() {
  const t = useT();
  const locale = useLocale();
  const [pending, setPending] = useState<PendingLogin | null>(() => pendingLogin.get());
  const [mode, setMode] = useState<Mode>(() => (pendingLogin.get() ? 'wait' : 'login'));
  const [form, setForm] = useState({ name: '', email: pendingLogin.get()?.email ?? '', password: '', invite: '', code: '' });
  const [registration, setRegistration] = useState<'closed' | 'invite' | 'open'>('invite');
  const [hasUsers, setHasUsers] = useState(true);
  const [error, setError] = useState('');
  /** Konto gehört zur anderen App (409): Link dorthin */
  const [otherApp, setOtherApp] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const polling = useRef(false);

  useEffect(() => {
    api<{ hasUsers: boolean; registration?: 'closed' | 'invite' | 'open' }>('/api/status')
      .then((s) => { setHasUsers(s.hasUsers); setRegistration(s.registration ?? 'invite'); if (!s.hasUsers && !pendingLogin.get()) setMode('register'); })
      .catch(() => setError(t('auth.serverDown')));
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // Wartendes Gerät: alle 2 Sekunden nachfragen, ob der Link bestätigt wurde
  useEffect(() => {
    if (mode !== 'wait' || !pending) return;
    const tick = async () => {
      if (polling.current || document.hidden) return;
      polling.current = true;
      try {
        const done = await claimLogin(pending);
        if (done?.purpose === 'reset') setMode('newpass');
      } catch (err) {
        if (err instanceof ApiError && (err.status === 410 || err.status === 403 || err.status === 409)) { pendingLogin.clear(); setPending(null); setMode('login'); setError(err.message); }
      } finally { polling.current = false; }
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    return () => clearInterval(timer);
  }, [mode, pending]);

  const field = (key: keyof typeof form) => ({
    value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const canRegister = !hasUsers || registration !== 'closed';
  const go = (m: Mode) => { setMode(m); setError(''); setInfo(''); };
  const toWait = (p: PendingLogin, note: string) => { setPending(p); setForm((f) => ({ ...f, email: p.email, code: '' })); setMode('wait'); setInfo(note); setWait(60); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setInfo(''); setOtherApp('');
    try {
      if (mode === 'wait') {
        const done = await submitLoginCode(pending, form.email, form.code);
        if (done.purpose === 'reset') setMode('newpass');
      } else if (mode === 'link' || mode === 'reset') {
        toWait(await requestLoginLink(form.email, mode === 'reset' ? 'reset' : 'login', locale), t('auth.linkSentGeneric'));
      } else if (mode === 'newpass') {
        await setNewPassword(form.password);
        window.location.reload();
      } else {
        const res = await authenticate(mode, { ...form, locale });
        if (res?.needsVerification) toWait(pendingLogin.get() ?? { requestId: '', deviceSecret: '', email: res.email, purpose: 'signup' }, t('auth.codeSent', { email: res.email }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.data.needsVerification) {
        const email = String(err.data.email ?? form.email);
        try { toWait(pendingLogin.get() ?? { requestId: '', deviceSecret: '', email, purpose: 'signup' }, t('auth.notConfirmed')); } catch { /* egal */ }
      } else {
        setError((err as Error).message);
        if (err instanceof ApiError && err.data.code === 'wrong_edition' && typeof err.data.url === 'string') setOtherApp(err.data.url);
      }
    } finally { setBusy(false); }
  }

  async function again() {
    setError('');
    try {
      const p = pending;
      if (p?.purpose === 'signup' || !p) { await resendCode(form.email); setPending(pendingLogin.get()); }
      else setPending(await requestLoginLink(p.email, p.purpose === 'reset' ? 'reset' : 'login', locale));
      setInfo(t('auth.newCodeSent')); setWait(60);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && typeof err.data.retryIn === 'number') setWait(err.data.retryIn);
    }
  }

  const title = mode === 'wait' ? t('auth.checkMail') : mode === 'reset' ? t('auth.resetTitle') : mode === 'newpass' ? t('auth.newPasswordTitle') : null;

  return (
    <div className="login">
      <aside className="login-art" aria-hidden="false">
        <Sky />
        <span className="login-star"><StarMark size={34} /></span>
        <h1 className="display">{t('auth.tagline')}</h1>
        <ul>
          {(['login.art.1', 'login.art.2', 'login.art.3'] as const).map((k) => <li key={k}><Icon name="check" size={18} stroke={2.6} />{t(k)}</li>)}
        </ul>
        <p className="by-evolsior" style={{ marginTop: 24 }}>by EVOLSIOR</p>
      </aside>
      <div className="login-form-side">
      <form className="login-card" onSubmit={submit}>
        <h2 className="display login-brand">Stella</h2>
        {title && <h2 style={{ margin: '4px 0 0', fontSize: 20 }}>{title}</h2>}

        {mode === 'wait' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>{t('auth.waitingText', { email: form.email })}</p>
            <label className="field" style={{ textAlign: 'left' }}>{t('auth.orCode')}
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123456" {...field('code')} style={{ letterSpacing: '.3em', fontSize: 22, textAlign: 'center' }} />
            </label>
          </>
        )}
        {(mode === 'link' || mode === 'reset') && (
          <>
            {mode === 'reset' && <p className="muted small" style={{ margin: 0 }}>{t('auth.resetText')}</p>}
            <label className="field" style={{ textAlign: 'left' }}>{t('auth.email')}<input type="email" inputMode="email" autoCapitalize="none" autoComplete="email" required autoFocus {...field('email')} /></label>
          </>
        )}
        {mode === 'newpass' && (
          <label className="field" style={{ textAlign: 'left' }}>{t('auth.newPassword')}<input type="password" autoComplete="new-password" minLength={8} required autoFocus {...field('password')} /></label>
        )}
        {(mode === 'login' || mode === 'register') && (
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
        {otherApp && <a className="btn ghost block" href={otherApp}>{new URL(otherApp).host}</a>}
        {info && <p className="muted small" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn block" disabled={busy || (mode === 'wait' && form.code.replace(/\D/g, '').length < 6)}>
          {mode === 'login' ? t('auth.login') : mode === 'register' ? t('auth.createAccount') : mode === 'wait' ? t('auth.confirm')
            : mode === 'newpass' ? t('auth.savePassword') : t('auth.sendLink')}
        </button>

        {mode === 'wait' && (
          <>
            <button type="button" className="link" disabled={wait > 0} onClick={() => void again()}>{wait > 0 ? t('auth.resendMailIn', { seconds: wait }) : t('auth.resendMail')}</button>
            <button type="button" className="link" onClick={() => { pendingLogin.clear(); setPending(null); go('login'); }}>{t('auth.backToLogin')}</button>
          </>
        )}
        {(mode === 'link' || mode === 'reset') && <button type="button" className="link" onClick={() => go('login')}>{t('auth.backToLogin')}</button>}
        {mode === 'login' && (
          <>
            <button type="button" className="link" onClick={() => go('reset')}>{t('auth.forgotPassword')}</button>
            <button type="button" className="link" onClick={() => go('link')}>{t('auth.emailLink')}</button>
          </>
        )}
        {(mode === 'login' || mode === 'register') && (canRegister
          ? <button type="button" className="link" onClick={() => go(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('auth.noAccount') : t('auth.haveAccountLogin')}</button>
          : <p className="muted small" style={{ margin: 0 }}>{t('auth.registrationClosed')}</p>)}

        <label className="field small" style={{ textAlign: 'center' }}><span className="sr-only">{t('auth.language')}</span>
          <select value={locale} aria-label={t('auth.language')} onChange={(e) => { if (isLocale(e.target.value)) rememberLocale(e.target.value); }}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
          </select></label>
      </form>
      </div>
    </div>
  );
}
