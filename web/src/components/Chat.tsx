import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, dayLabel as chatDayLabel, todayIn, type Conversation } from '@stella/shared';
import { api, compressImage, newConversation, openConversation, retryAudio, sendAudio, sendMessage, useStore } from '../store.ts';
import { MAX_SECONDS, recordingSupported, startRecording, type Recording } from '../audio.ts';
import { AudioPlayer, AuthImage, Lightbox, Rich } from './Rich.tsx';
import { ItemStatus } from './Today.tsx';
import { ActionCard } from './ActionCard.tsx';
import { Icon } from '../ui/Icon.tsx';
import { CloudSky, Sheet, StarMark, showToast } from '../ui/Decor.tsx';

interface QuickAction { id: string; icon: string; label: string; kind: 'text' | 'send' | 'camera' | 'mic'; text?: string }

/** Falls Stella gerade nicht erreichbar ist: ein paar Chips, die immer gehen */
const FALLBACK_ACTIONS: QuickAction[] = [
  { id: 'voice', icon: 'mic', label: 'Sprachnachricht', kind: 'mic' },
  { id: 'week', icon: 'calendar', label: 'Woche planen', kind: 'send', text: 'Plan meine Woche' },
  { id: 'forgot', icon: 'sparkle', label: 'Hab ich was vergessen?', kind: 'send', text: 'Hab ich was vergessen?' },
  { id: 'briefing', icon: 'sun', label: 'Briefing', kind: 'send', text: 'Briefing' },
];

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function Chat() {
  const messages = useStore((s) => s.messages);
  const thinking = useStore((s) => s.thinking);
  const busy = useStore((s) => s.busyItems);
  const items = useStore((s) => s.items);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [history, setHistory] = useState(false);
  const me = useStore((s) => s.me);
  const [quick, setQuick] = useState<{ actions: QuickAction[]; cards: QuickAction[] }>({ actions: FALLBACK_ACTIONS, cards: FALLBACK_ACTIONS });
  const cameraRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState<{ rec: Recording; startedAt: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const recordingRef = useRef<typeof recording>(null);
  recordingRef.current = recording;
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, thinking]);
  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus(); }, []);

  const working = busy.map((id) => items[id]).find(Boolean);

  async function submit(value = text) {
    const t = value.trim();
    if (!t && !photos.length) return;
    const imgs = photos;
    setText('');
    setPhotos([]);
    setError('');
    try {
      await sendMessage(t, imgs);
    } catch (err) {
      setError((err as Error).message);
      setText(t);
      setPhotos(imgs);
    }
  }

  // Schnellaktionen nach Profil und Tageszeit (alle 30 Minuten neu, weil sich die Reihenfolge mit der Uhrzeit ändert)
  useEffect(() => {
    const load = () => api<{ actions: QuickAction[]; cards: QuickAction[] }>('/api/quick-actions').then(setQuick).catch(() => {});
    load();
    const t = setInterval(load, 30 * 60_000);
    return () => clearInterval(t);
  }, [me?.settings.profile]);

  function runQuick(a: QuickAction) {
    if (a.kind === 'mic') void record();
    else if (a.kind === 'camera') cameraRef.current?.click();
    else if (a.kind === 'send') void submit(a.text ?? a.label);
    else { setText(a.text ?? ''); inputRef.current?.focus(); }
  }

  // Zeit und Pegel der laufenden Aufnahme
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => { setSeconds(Math.round((Date.now() - recording.startedAt) / 1000)); setLevel(recording.rec.level()); }, 100);
    return () => clearInterval(t);
  }, [recording]);
  // nur beim Verlassen des Chats eine laufende Aufnahme verwerfen
  useEffect(() => () => recordingRef.current?.rec.cancel(), []);

  async function record() {
    setError('');
    try {
      const rec = await startRecording(() => void stopAndSend());
      setSeconds(0);
      setRecording({ rec, startedAt: Date.now() });
    } catch (err) { setError((err as Error).message); }
  }
  async function stopAndSend() {
    const r = recordingRef.current;
    if (!r) return;
    setRecording(null);
    try {
      const { blob, seconds: secs } = await r.rec.finish();
      await sendAudio(blob, secs);
    } catch (err) { setError((err as Error).message); }
  }
  function cancelRecording() { recording?.rec.cancel(); setRecording(null); }
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      const added = await Promise.all([...files].slice(0, 4).map((f) => compressImage(f)));
      setPhotos((p) => [...p, ...added].slice(0, 4));
    } catch {
      setError('Foto konnte nicht gelesen werden.');
    }
  }

  async function startNew() {
    try { await newConversation(); setHistory(false); inputRef.current?.focus(); } catch (err) { showToast((err as Error).message, true); }
  }

  let lastDay = '';
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      <aside className="chat-history" aria-label="Chats"><ChatHistory onNew={() => void startNew()} /></aside>
      <div className="chat">
        <CloudSky />
        <header className="chat-head">
          <span className="avatar-star"><StarMark size={19} /></span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="display" style={{ fontSize: 18, fontWeight: 700 }}>Stella</span>
            <span className="small" style={{ color: working ? 'var(--blue)' : 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="pulse" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              {working ? `löst gerade ${working.title}` : 'für dich da'}
            </span>
          </div>
          <div className="chat-head-actions">
            <button type="button" className="icon-btn history-btn" aria-label="Alle Chats" onClick={() => setHistory(true)}><Icon name="history" size={19} /></button>
            <button type="button" className="btn small secondary" onClick={() => void startNew()}><Icon name="plus" size={16} />Neuer Chat</button>
          </div>
        </header>

        <div className="chat-scroll">
          <div className="chat-inner">
            {messages.length === 0 && (
              <div className="chat-empty">
                <span className="icon-tile pink"><StarMark size={26} /></span>
                <h2 className="display" style={{ fontSize: 24 }}>Hi{me?.name ? `, ${me.name.split(' ')[0]}` : ''}!</h2>
                <p className="muted" style={{ margin: 0 }}>Wobei kann ich dir helfen? Tipp etwas an – oder sprich einfach los.</p>
                <div className="quick-cards">
                  {quick.cards.map((a) => (
                    <button key={a.id} type="button" className="quick-card" onClick={() => runQuick(a)}>
                      <span className="icon-tile blue"><Icon name={a.icon as never} size={22} /></span>
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              const day = dayLabel(m.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              return (
                <div key={m.id}>
                  {showDay && <div className="day-sep">{day}</div>}
                  <div className={`bubble-row ${m.role}`}>
                    <div className={`bubble ${m.role}${m.pending ? ' pending' : ''}`}>
                      {m.attachments.filter((a) => a.kind === 'audio').map((a) => <AudioPlayer key={a.id} id={a.id} />)}
                      {m.text && <Rich text={m.text} />}
                      {m.failedAudioId && (
                        <button type="button" className="btn small secondary" disabled={thinking}
                          onClick={() => void retryAudio(m.id).catch((err: Error) => setError(err.message))}>Nochmal versuchen</button>
                      )}
                      {m.attachments.filter((a) => a.kind !== 'audio').map((a) => <AuthImage key={a.id} id={a.id} alt={a.caption} onOpen={setLightbox} />)}
                      {m.actionId && <ActionCard id={m.actionId} />}
                      <span className="meta">{m.pending ? 'wird gesendet' : timeLabel(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {thinking && (
              <div className="bubble-row assistant">
                <div className="bubble assistant typing" aria-label="Stella schreibt"><span /><span /><span /></div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {messages.length > 0 && !text.trim() && photos.length === 0 && !recording && (
          <div className="suggestions" aria-label="Schnellaktionen">
            {quick.actions.map((a) => (
              <button key={a.id} type="button" className="chip" onClick={() => runQuick(a)}><Icon name={a.icon as never} size={14} /> {a.label}</button>
            ))}
          </div>
        )}
        {error && <p className="error-text" style={{ textAlign: 'center', margin: '4px 16px' }}>{error}</p>}
        {photos.length > 0 && (
          <div className="photo-strip">
            {photos.map((p, i) => (
              <button key={i} type="button" className="photo-thumb pop" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label="Foto entfernen">
                <img src={p} alt="" /><span>✕</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-wrap">
          {recording ? (
            <div className="composer recording" role="status" aria-label="Aufnahme läuft">
              <button type="button" className="attach" aria-label="Aufnahme verwerfen" onClick={cancelRecording}><Icon name="close" size={20} /></button>
              <span className="rec-dot" aria-hidden="true" />
              <span className="rec-time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
              <span className="rec-level" aria-hidden="true">{[0.2, 0.5, 0.8, 1, 0.8, 0.5, 0.2].map((w, i) => <i key={i} style={{ height: 4 + Math.round(level * w * 22) }} />)}</span>
              <span className="small muted grow">{seconds >= MAX_SECONDS - 10 ? 'gleich Schluss …' : 'Sprich einfach los'}</span>
              <button type="button" className="send" aria-label="Aufnahme senden" onClick={() => void stopAndSend()}><Icon name="send" size={20} stroke={2.4} /></button>
            </div>
          ) : (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
            <button type="button" className="attach" aria-label="Foto der Aufgabe" onClick={() => fileRef.current?.click()}><Icon name="camera" size={20} /></button>
            <label className="sr-only" htmlFor="stella-input">Nachricht an Stella</label>
            <textarea
              id="stella-input"
              ref={inputRef}
              rows={1}
              value={text}
              placeholder="Schreib Stella …"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
              }}
            />
            {!text.trim() && !photos.length && recordingSupported()
              ? <button type="button" className="send mic" aria-label="Sprachnachricht aufnehmen" onClick={() => void record()}><Icon name="mic" size={20} stroke={2.2} /></button>
              : <button type="submit" className="send" disabled={!text.trim() && !photos.length} aria-label="Senden"><Icon name="send" size={20} stroke={2.4} /></button>}
          </form>
          )}
        </div>
        {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
        {history && <Sheet title="Chats" onClose={() => setHistory(false)}><ChatHistory inSheet onNew={() => void startNew()} onPick={() => setHistory(false)} /></Sheet>}
      </div>
      <AsideToday />
    </div>
  );
}

/** Alle Chats, nach Tag gruppiert, mit Titel. Ein alter Chat ist lesbar und kann fortgesetzt werden. */
function ChatHistory({ onNew, onPick, inSheet = false }: { onNew: () => void; onPick?: () => void; inSheet?: boolean }) {
  const conversations = useStore((s) => s.conversations);
  const active = useStore((s) => s.conversationId);
  const tz = useStore((s) => s.me?.timeZone ?? 'Europe/Vienna');
  const today = todayIn(tz);
  const groups = useMemo(() => {
    const out: { day: string; items: Conversation[] }[] = [];
    for (const c of conversations) {
      const g = out.find((x) => x.day === c.day);
      if (g) g.items.push(c); else out.push({ day: c.day, items: [c] });
    }
    return out;
  }, [conversations]);

  async function pick(id: string) {
    try { await openConversation(id); onPick?.(); } catch (err) { showToast((err as Error).message, true); }
  }

  return (
    <div className="history-list">
      <div className="row" style={{ justifyContent: inSheet ? 'flex-start' : 'space-between' }}>
        {!inSheet && <h2 className="display" style={{ fontSize: 20 }}>Chats</h2>}
        <button type="button" className="btn small" onClick={onNew}><Icon name="plus" size={16} />Neuer Chat</button>
      </div>
      {groups.length === 0 && <p className="muted small">Noch keine Chats – schreib Stella, dann taucht der erste hier auf.</p>}
      {groups.map((g) => (
        <section key={g.day} className="history-group">
          <span className="eyebrow">{chatDayLabel(g.day, today)}</span>
          {g.items.map((c) => (
            <button key={c.id} type="button" className={c.id === active ? 'history-item active' : 'history-item'} onClick={() => void pick(c.id)} aria-current={c.id === active ? 'true' : undefined}>
              <span className="history-title">{c.title || c.lastMessage || 'Chat'}</span>
              {c.title && c.lastMessage && <span className="history-sub">{c.lastMessage}</span>}
              <span className="history-meta">{new Date(c.updatedAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · {c.count} Nachrichten</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Rechte Spalte auf großen Bildschirmen (PC-App): was morgen ansteht. */
function AsideToday() {
  const itemsById = useStore((s) => s.items);
  const busy = useStore((s) => s.busyItems);
  const tz = useStore((s) => s.me?.timeZone ?? 'Europe/Vienna');
  const today = todayIn(tz);
  const items = useMemo(() => Object.values(itemsById)
    .filter((i) => !i.deleted && i.due && i.due >= today && i.due <= addDays(today, 3) && i.kind !== 'study')
    .sort((a, b) => a.due!.localeCompare(b.due!)).slice(0, 6), [itemsById, today]);
  return (
    <aside className="aside-today" aria-label="Bald fällig">
      <h2 className="display" style={{ fontSize: 20 }}>Bald fällig</h2>
      {items.length === 0 && <p className="muted small">Nichts in den nächsten Tagen.</p>}
      <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((i) => (
          <div key={i.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{i.title}</span>
              <ItemStatus item={i} busy={busy.includes(i.id)} />
            </div>
            <span className="small muted">{i.detail ?? ''}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
