import { useEffect, useRef, useState } from 'react';
import { api, refreshMe } from '../../store.ts';
import { useT } from '../../i18n.ts';
import { Section, useAction } from './ui.tsx';

interface Status { configured: boolean; bot: string | null; linked: boolean; notifyVia: ('push' | 'telegram')[] }
interface Link { token: string; url: string | null; expiresAt: string }

/** Einstellungen → Telegram: verbinden (Einmal-Link), wählen, wohin Stella von sich aus schreibt, trennen */
export function TelegramSheet() {
  const t = useT();
  const [s, setS] = useState<Status | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [run, view, busy] = useAction();
  const timer = useRef<number | null>(null);

  const load = () => api<Status>('/api/channels/telegram').then(setS).catch(() => {});
  useEffect(() => { void load(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  // Nach „Verbinden“ alle paar Sekunden nachsehen, ob der Chat verknüpft wurde (der Link gilt 10 Minuten)
  useEffect(() => {
    if (!link) return;
    const until = Date.parse(link.expiresAt);
    timer.current = window.setInterval(async () => {
      const next = await api<Status>('/api/channels/telegram').catch(() => null);
      if (next?.linked) { setS(next); setLink(null); void refreshMe(); }
      else if (Date.now() > until) setLink(null);
    }, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [link]);

  if (!s) return <p className="muted">{t('common.later')}…</p>;
  if (!s.configured) return <p className="muted">{t('settings.telegram.notConfigured')}</p>;

  const toggle = (ch: 'push' | 'telegram') => {
    const has = s.notifyVia.includes(ch);
    const next = has ? s.notifyVia.filter((x) => x !== ch) : [...s.notifyVia, ch];
    if (!next.length) return; // mindestens ein Kanal
    void run(async () => { await api('/api/settings', { method: 'PATCH', json: { notifyVia: next } }); setS({ ...s, notifyVia: next }); await refreshMe(); }, '');
  };

  return (
    <>
      <Section title={t('settings.telegram.title')}>
        <p className="muted small">{t('settings.telegram.sub')}</p>
        {s.linked ? (
          <>
            <p className="ok-text">{t('settings.telegram.connected')}{s.bot ? ` · @${s.bot}` : ''}</p>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void run(async () => { setS(await api<Status>('/api/channels/telegram', { method: 'DELETE' })); await refreshMe(); }, '')}>{t('settings.telegram.disconnect')}</button>
          </>
        ) : link?.url ? (
          <>
            <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer">{t('settings.telegram.open')}</a>
            <p className="muted small">{t('settings.telegram.linkHint')}</p>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setLink(await api<Link>('/api/channels/telegram/link', { method: 'POST' })), '')}>{t('settings.telegram.connect')}</button>
        )}
        {view}
      </Section>
      {s.linked && (
        <Section title={t('settings.telegram.notifyVia')}>
          <div className="chips" role="group" aria-label={t('settings.telegram.notifyVia')}>
            {(['push', 'telegram'] as const).map((ch) => (
              <button key={ch} type="button" className={s.notifyVia.includes(ch) ? 'chip active' : 'chip'} aria-pressed={s.notifyVia.includes(ch)} onClick={() => toggle(ch)}>
                {ch === 'push' ? t('settings.telegram.push') : 'Telegram'}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
