import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../store.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sky, showToast } from '../ui/Decor.tsx';

interface InboxEntry {
  id: string;
  source: 'email' | 'social' | 'sms' | string;
  sender: string | null;
  text: string | null;
  summary: string | null;
  category: string | null;
  action: 'trash' | 'notify' | 'keep' | 'restored' | null;
  account: string | null;
  platform: string | null;
  createdAt: string;
}

type Filter = 'important' | 'social' | 'sms' | 'trash' | 'all';

const PLATFORM: Record<string, [IconName, string, string]> = {
  Instagram: ['insta', '#FDE6EF', '#C0306E'], TikTok: ['music', '#DDF6F5', '#0E8F8A'], Snapchat: ['message', '#FFF6CC', '#7A5B00'],
  YouTube: ['sparkle', '#FFE4E4', '#B42318'], Discord: ['chat', '#E6E9FF', '#3A46C9'],
};
const AVATAR_COLORS: [string, string][] = [['#E6F0FF', '#1F6FEB'], ['#FFE8F1', '#C0306E'], ['#E3F7EA', '#138A4B'], ['#DDF6F5', '#0E8F8A']];

function initials(name: string) {
  return name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}
function colorFor(name: string) {
  return AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;
}
function when(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-AT', { day: 'numeric', month: 'numeric' });
}

export function Inbox() {
  const [filter, setFilter] = useState<Filter>('important');
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);

  const load = useCallback(() => {
    api<InboxEntry[]>('/api/inbox?limit=300').then(setEntries).catch((err: Error) => showToast(err.message, true));
  }, []);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const e = entries ?? [];
    return {
      important: e.filter((x) => x.category === 'important' || x.source === 'sms').length,
      social: e.filter((x) => x.source === 'social').length,
      sms: e.filter((x) => x.source === 'sms').length,
      trash: e.filter((x) => x.action === 'trash').length,
    };
  }, [entries]);

  const shown = (entries ?? []).filter((e) =>
    filter === 'important' ? e.category === 'important' || e.source === 'sms'
      : filter === 'social' ? e.source === 'social'
        : filter === 'sms' ? e.source === 'sms'
          : filter === 'trash' ? e.action === 'trash' : true);

  async function restore(id: string) {
    try {
      await api(`/api/inbox/${id}/restore`, { method: 'POST' });
      showToast('Zurück im Posteingang');
      load();
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  const counters: [Filter, number, string][] = [['important', counts.important, 'Wichtig'], ['social', counts.social, 'Social'], ['sms', counts.sms, 'SMS'], ['trash', counts.trash, 'Gelöscht']];

  return (
    <div className="page">
      <Sky clouds={false} />
      <div className="page-inner">
        <header className="page-head rise">
          <h1 className="display">Inbox</h1>
          <button type="button" className={filter === 'all' ? 'btn' : 'btn secondary'} style={{ minHeight: 38 }} onClick={() => setFilter('all')}>Alles</button>
        </header>

        <div className="counters rise">
          {counters.map(([f, n, label]) => (
            <button key={f} type="button" className={filter === f ? 'counter active' : 'counter'} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              <span className="v">{n}</span><span className="l">{label}</span>
            </button>
          ))}
        </div>

        {entries && shown.length === 0 && (
          <div className="empty">
            <span className="icon-tile blue"><Icon name="inbox" size={26} /></span>
            <p>{filter === 'trash' ? 'Stella hat noch nichts gelöscht.' : filter === 'social'
              ? 'Noch keine Social-Benachrichtigungen. Sie kommen über die E-Mails von Instagram, TikTok & Co.'
              : 'Alles ruhig. Verbinde deine Postfächer unter Einstellungen → E-Mail.'}</p>
          </div>
        )}

        <div className="stagger" key={filter} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((e) => {
            const platform = e.platform ? PLATFORM[e.platform] : undefined;
            const [bg, fg] = colorFor(e.sender ?? '?');
            return (
              <div key={e.id} className="inbox-row">
                {e.source === 'social'
                  ? <span className="avatar" style={{ borderRadius: 13, background: platform?.[1] ?? '#EAF2FF', color: platform?.[2] ?? '#1F6FEB' }}><Icon name={platform?.[0] ?? 'sparkle'} size={20} /></span>
                  : <span className="avatar" style={{ background: bg, color: fg }}>{initials(e.sender ?? '?')}</span>}
                <div className="inbox-main">
                  <div className="inbox-top">
                    <span className="inbox-sender">{e.source === 'social' ? e.platform ?? 'Social' : e.sender ?? 'Unbekannt'}</span>
                    <span className="inbox-time">{when(e.createdAt)}</span>
                  </div>
                  <span style={{ fontSize: 14 }}>{e.text}</span>
                  {e.summary && e.summary !== e.text && <span className="inbox-text">{e.summary}</span>}
                  <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {e.account && <span className="pill gray">{e.account}</span>}
                    {e.source === 'sms' && <span className="pill gray">SMS</span>}
                    {e.category === 'important' && <span className="pill blue">wichtig</span>}
                    {e.action === 'trash' && (
                      <>
                        <span className="pill pink">im Papierkorb</span>
                        <button type="button" className="link small" onClick={() => void restore(e.id)}>Wiederherstellen</button>
                      </>
                    )}
                    {e.action === 'restored' && <span className="pill green">wiederhergestellt</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
