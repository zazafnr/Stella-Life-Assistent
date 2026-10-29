import { useCallback, useEffect, useState } from 'react';
import { api } from '../store.ts';

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

type Filter = 'all' | 'important' | 'social' | 'sms' | 'trash';
const FILTERS: [Filter, string][] = [['all', 'Alles'], ['important', 'Wichtig'], ['social', 'Social'], ['sms', 'SMS'], ['trash', 'Von Stella gelöscht']];

const PLATFORM_ICON: Record<string, string> = {
  Instagram: '📸', TikTok: '🎵', Snapchat: '👻', YouTube: '▶️', Discord: '🎮', Facebook: '👥', X: '✖️', Pinterest: '📌', Twitch: '🟣', BeReal: '📷',
};

function icon(e: InboxEntry) {
  if (e.source === 'social') return PLATFORM_ICON[e.platform ?? ''] ?? '💬';
  if (e.source === 'sms') return '💬';
  if (e.source === 'call') return '📞';
  return e.category === 'important' ? '⭐️' : '✉️';
}

function when(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-AT', { day: 'numeric', month: 'numeric' });
}

export function Inbox() {
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const q = filter === 'social' || filter === 'sms' ? `?source=${filter}` : filter === 'all' ? '' : '?source=email&limit=300';
    api<InboxEntry[]>(`/api/inbox${q}`).then(setEntries).catch((err: Error) => setError(err.message));
  }, [filter]);
  useEffect(load, [load]);

  const shown = (entries ?? []).filter((e) =>
    filter === 'important' ? e.category === 'important' : filter === 'trash' ? e.action === 'trash' : true);

  async function restore(id: string) {
    try {
      await api(`/api/inbox/${id}/restore`, { method: 'POST' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Social: wer hat wie oft geschrieben/geliked
  const top = filter === 'social' ? Object.entries(shown.reduce<Record<string, number>>((acc, e) => {
    const k = `${e.platform ?? ''}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="page">
      <header className="page-head">
        <h1>Inbox</h1>
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
      </header>
      {error && <div className="error-bar" onClick={() => setError('')}>{error}</div>}

      {top.length > 0 && (
        <div className="stats" style={{ gridTemplateColumns: `repeat(${Math.min(top.length, 3)}, 1fr)` }}>
          {top.slice(0, 3).map(([platform, n]) => (
            <div key={platform} className="stat"><span className="stat-value">{PLATFORM_ICON[platform] ?? '💬'} {n}</span><span className="stat-label">{platform || 'Social'}</span></div>
          ))}
        </div>
      )}

      {entries && shown.length === 0 && (
        <div className="empty">
          <div className="empty-star">✦</div>
          <p>{filter === 'trash' ? 'Stella hat noch nichts gelöscht.' : 'Noch nichts da. Verbinde E-Mail-Postfächer unter Einstellungen – Social-Media-Benachrichtigungen kommen über deren E-Mails.'}</p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="list-card">
          {shown.map((e) => (
            <div key={e.id} className="inbox-row">
              <span className="inbox-icon">{icon(e)}</span>
              <div className="inbox-main">
                <div className="inbox-top">
                  <span className="inbox-sender">{e.sender ?? 'Unbekannt'}</span>
                  <span className="inbox-time">{when(e.createdAt)}</span>
                </div>
                <span>{e.text}</span>
                {e.summary && e.summary !== e.text && <span className="inbox-text">{e.summary}</span>}
                <div className="button-row" style={{ marginTop: 4 }}>
                  {e.account && <span className="badge">{e.account}</span>}
                  {e.category === 'important' && <span className="badge important">wichtig</span>}
                  {e.action === 'trash' && (
                    <>
                      <span className="badge trash">im Papierkorb</span>
                      <button type="button" className="link" onClick={() => void restore(e.id)}>Wiederherstellen</button>
                    </>
                  )}
                  {e.action === 'restored' && <span className="badge">wiederhergestellt</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
