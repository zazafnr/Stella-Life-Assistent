import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, sync } from '../store.ts';
import { formatDateDe } from '@stella/shared';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sheet, Sky, showToast } from '../ui/Decor.tsx';

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
  reason?: string | null;
  deadline?: { date: string; time: string | null; what: string } | null;
  needsReply?: boolean;
  handled?: boolean;
  replied?: string | null;
  draft?: { subject: string; body: string } | null;
  deadlineActionId?: string | null;
}

/** Wichtiges der letzten 7 Tage, das noch nicht erledigt ist */
const isFocus = (e: InboxEntry) => e.source === 'email' && !e.handled && e.action !== 'trash'
  && (e.category === 'important' || e.needsReply || !!e.deadline) && Date.parse(e.createdAt) > Date.now() - 7 * 86_400_000;

/** Wichtig / Neutral / Unwichtig / Papierkorb – Social-Benachrichtigungen zählen zu „Unwichtig“, SMS zu „Wichtig“ */
type Tab = 'important' | 'normal' | 'newsletter' | 'trash';
type Filter = Tab | 'all';
export type MailCategory = 'important' | 'normal' | 'newsletter' | 'spam';

const TAB_LABEL: Record<Tab, string> = { important: 'Wichtig', normal: 'Neutral', newsletter: 'Unwichtig', trash: 'Papierkorb' };
const MOVE_TARGETS: [MailCategory, string][] = [['important', 'Wichtig'], ['normal', 'Neutral'], ['newsletter', 'Unwichtig'], ['spam', 'Papierkorb']];

function tabOf(e: InboxEntry): Tab {
  if (e.source === 'sms') return 'important';
  if (e.source === 'social') return 'newsletter';
  if (e.action === 'trash' || e.category === 'spam') return 'trash';
  if (e.category === 'important') return 'important';
  if (e.category === 'newsletter') return 'newsletter';
  return 'normal';
}

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
  const [reading, setReading] = useState<InboxEntry | null>(null);

  const load = useCallback(() => {
    api<InboxEntry[]>('/api/inbox?limit=300').then(setEntries).catch((err: Error) => showToast(err.message, true));
  }, []);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { important: 0, normal: 0, newsletter: 0, trash: 0 };
    for (const e of entries ?? []) c[tabOf(e)]++;
    return c;
  }, [entries]);

  const focus = (entries ?? []).filter(isFocus);
  const shown = (entries ?? []).filter((e) => !(filter === 'important' && isFocus(e))).filter((e) => filter === 'all' || tabOf(e) === filter);

  async function restore(id: string) {
    try {
      await api(`/api/inbox/${id}/restore`, { method: 'POST' });
      showToast('Zurück im Posteingang');
      load();
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  const counters = (Object.keys(TAB_LABEL) as Tab[]).map((t) => [t, counts[t], TAB_LABEL[t]] as const);

  return (
    <div className="page">
      <Sky clouds={false} />
      <div className="page-inner">
        <header className="page-head rise">
          <h1 className="display">Inbox</h1>
          <button type="button" className={filter === 'all' ? 'btn' : 'btn secondary'} style={{ minHeight: 38 }} onClick={() => setFilter('all')}>Alles</button>
        </header>

        {filter === 'important' && focus.length > 0 && (
          <section className="focus-list rise" aria-label="Wichtig für dich">
            <span className="eyebrow" style={{ color: 'var(--pink-text)' }}>Wichtig für dich</span>
            {focus.map((e) => <FocusCard key={e.id} entry={e} onChange={load} />)}
          </section>
        )}

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
            <p>{filter === 'trash' ? 'Der Papierkorb ist leer – Stella hat noch keine Werbung weggeräumt.' : filter === 'newsletter'
              ? 'Nichts Unwichtiges da. Newsletter und Social-Benachrichtigungen (Instagram, TikTok & Co.) landen hier.'
              : filter === 'normal' ? 'Nichts Neutrales da.'
                : 'Alles ruhig. Verbinde deine Postfächer unter Einstellungen → E-Mail.'}</p>
          </div>
        )}

        <div className="stagger" key={filter} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((e) => {
            const platform = e.platform ? PLATFORM[e.platform] : undefined;
            const [bg, fg] = colorFor(e.sender ?? '?');
            return (
              <div key={e.id} className={e.source === 'email' ? 'inbox-row clickable' : 'inbox-row'}
                {...(e.source === 'email' ? { role: 'button', tabIndex: 0, 'aria-label': `Mail von ${e.sender ?? 'Unbekannt'} öffnen`, onClick: () => setReading(e),
                  onKeyDown: (ev: { key: string }) => { if (ev.key === 'Enter' || ev.key === ' ') setReading(e); } } : {})}>
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
                        <button type="button" className="link small" onClick={(ev) => { ev.stopPropagation(); void restore(e.id); }}>Wiederherstellen</button>
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
      {reading && <MailReader entry={reading} onClose={() => setReading(null)} onChange={load} />}
    </div>
  );
}

/** Antwort-Editor: leer zum Selbstschreiben oder mit Entwurf von Stella. Gesendet wird nur nach einem Klick auf „Senden“. */
function ReplyEditor({ entry: e, writeFirst, onDone }: { entry: InboxEntry; writeFirst: boolean; onDone: (sent: boolean) => void }) {
  const [draft, setDraft] = useState(e.draft?.body ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'send'>('');

  const write = useCallback(async (withInstruction: boolean, text = '') => {
    setBusy('draft');
    try {
      const d = await api<{ body: string }>(`/api/inbox/${e.id}/draft`, { method: 'POST', json: { instruction: withInstruction ? text : '' } });
      setDraft(d.body);
    } catch (err) { showToast((err as Error).message, true); } finally { setBusy(''); }
  }, [e.id]);
  useEffect(() => { if (writeFirst && !e.draft?.body) void write(false); }, [writeFirst, e.draft?.body, write]);

  async function send() {
    setBusy('send');
    try {
      await api(`/api/inbox/${e.id}/send`, { method: 'POST', json: { body: draft } });
      showToast('Wird gesendet ✉️');
      onDone(true);
      void sync();
    } catch (err) { showToast((err as Error).message, true); setBusy(''); }
  }

  return (
    <div className="reply-editor">
      <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={7} placeholder={busy === 'draft' ? 'Stella schreibt …' : 'Deine Antwort'} disabled={busy === 'draft'} />
      <div className="row" style={{ gap: 8 }}>
        <input className="grow" value={instruction} onChange={(ev) => setInstruction(ev.target.value)} placeholder="Was soll drinstehen? z. B. „bin morgen krank“" />
        <button type="button" className="btn small secondary" disabled={!!busy} onClick={() => void write(true, instruction)}>{draft ? 'Neu schreiben' : 'Stella schreibt'}</button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={!draft.trim() || !!busy} onClick={() => void send()}>
          <Icon name="send" size={16} />{busy === 'send' ? 'Sendet …' : 'Senden'}
        </button>
        <button type="button" className="link small" onClick={() => onDone(false)}>Abbrechen</button>
      </div>
      <span className="small muted">Gesendet wird nur, wenn du auf „Senden“ tippst – an {e.sender}.</span>
    </div>
  );
}

/** Lesebildschirm: Volltext, Antworten (selbst oder von Stella), Verschieben, Erledigt */
function MailReader({ entry: e, onClose, onChange }: { entry: InboxEntry; onClose: () => void; onChange: () => void }) {
  const [text, setText] = useState<{ body: string; truncated: boolean; partial?: boolean } | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'read' | 'own' | 'stella' | 'move'>('read');

  useEffect(() => {
    api<{ body: string; truncated: boolean; partial?: boolean }>(`/api/inbox/${e.id}/body`).then(setText).catch((err: Error) => setError(err.message));
  }, [e.id]);

  async function moveTo(category: MailCategory) {
    try {
      const r = await api<{ note: string | null }>(`/api/inbox/${e.id}/category`, { method: 'POST', json: { category } });
      showToast(r.note ?? 'Verschoben – Stella merkt sich den Absender');
      onChange();
      onClose();
    } catch (err) { showToast((err as Error).message, true); }
  }
  async function done() {
    await api(`/api/inbox/${e.id}/handled`, { method: 'POST' }).catch(() => {});
    onChange();
    onClose();
  }

  return (
    <Sheet title={e.sender ?? 'Mail'} onClose={onClose}>
      <div className="mail-reader">
        <span className="mail-subject">{e.text}</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {e.account && <span className="pill gray">{e.account}</span>}
          <span className="pill gray">{when(e.createdAt)}</span>
          {e.reason && <span className="pill blue">{e.reason}</span>}
          {e.deadline && <span className="pill pink">Frist {formatDateDe(e.deadline.date)}{e.deadline.time ? ` ${e.deadline.time}` : ''}</span>}
          {e.replied && <span className="pill green">beantwortet</span>}
        </div>
        {e.summary && e.summary !== e.text && <p className="muted small" style={{ margin: 0 }}>Stella: {e.summary}</p>}
        <div className="mail-body" tabIndex={0}>
          {error ? <span className="error-text">{error}</span> : text ? text.body : <span className="muted">⏳ Stella holt die Mail …</span>}
          {text?.partial && <p className="muted small">Nur ein Auszug – das Postfach hat gerade nicht geantwortet.</p>}
          {text?.truncated && !text.partial && <p className="muted small">Gekürzt – der Rest steht im Original.</p>}
        </div>

        {mode === 'own' && <ReplyEditor entry={e} writeFirst={false} onDone={(sent) => { if (sent) { onChange(); onClose(); } else setMode('read'); }} />}
        {mode === 'stella' && <ReplyEditor entry={e} writeFirst onDone={(sent) => { if (sent) { onChange(); onClose(); } else setMode('read'); }} />}
        {mode === 'move' && (
          <div className="chips" role="group" aria-label="Verschieben nach" style={{ flexWrap: 'wrap' }}>
            {MOVE_TARGETS.map(([c, label]) => <button key={c} type="button" className="chip" onClick={() => void moveTo(c)}>{label}</button>)}
            <button type="button" className="link small" onClick={() => setMode('read')}>Abbrechen</button>
          </div>
        )}
        {(mode === 'read') && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => setMode('own')}><Icon name="send" size={16} />Antworten</button>
            <button type="button" className="btn small secondary" onClick={() => setMode('stella')}><Icon name="sparkle" size={16} />Stella antworten lassen</button>
            <button type="button" className="btn small secondary" onClick={() => setMode('move')}>Verschieben nach …</button>
            <button type="button" className="link small" onClick={() => void done()}><Icon name="check" size={14} /> Erledigt</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Eine wichtige Mail: warum, Frist, Antwort – mit Knöpfen zum Erledigen */
function FocusCard({ entry: e, onChange }: { entry: InboxEntry; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'' | 'deadline'>('');
  const [bg, fg] = colorFor(e.sender ?? '?');

  async function addDeadline() {
    setBusy('deadline');
    try {
      await api(`/api/inbox/${e.id}/deadline`, { method: 'POST' });
      showToast('Eingetragen');
      onChange();
      void sync();
    } catch (err) { showToast((err as Error).message, true); } finally { setBusy(''); }
  }
  async function done() {
    await api(`/api/inbox/${e.id}/handled`, { method: 'POST' }).catch(() => {});
    onChange();
  }

  return (
    <div className="focus-card">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="avatar" style={{ background: bg, color: fg }}>{initials(e.sender ?? '?')}</span>
        <div className="inbox-main">
          <div className="inbox-top">
            <span className="inbox-sender">{e.sender ?? 'Unbekannt'}</span>
            <span className="inbox-time">{when(e.createdAt)}</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{e.summary || e.text}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {e.reason && <span className="pill blue">{e.reason}</span>}
            {e.deadline && <span className="pill pink">Frist {formatDateDe(e.deadline.date)}{e.deadline.time ? ` ${e.deadline.time}` : ''}</span>}
            {e.needsReply && !e.replied && <span className="pill pink">Antwort nötig</span>}
            {e.replied && <span className="pill green">beantwortet</span>}
          </div>
        </div>
      </div>

      {open ? (
        <ReplyEditor entry={e} writeFirst onDone={(sent) => { setOpen(false); if (sent) onChange(); }} />
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {e.deadline && !e.deadlineActionId && <button type="button" className="btn small" disabled={!!busy} onClick={() => void addDeadline()}>Frist eintragen</button>}
          {!e.replied && <button type="button" className={e.needsReply ? 'btn small' : 'btn small secondary'} onClick={() => setOpen(true)}>Antwort schreiben</button>}
          <button type="button" className="link small" onClick={() => void done()}><Icon name="check" size={14} /> Erledigt</button>
        </div>
      )}
    </div>
  );
}
