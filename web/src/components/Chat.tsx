import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, todayIn } from '@stella/shared';
import { compressImage, sendMessage, useStore } from '../store.ts';
import { AuthImage, Lightbox, Rich } from './Rich.tsx';
import { ItemStatus } from './Today.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Sky, StarMark } from '../ui/Decor.tsx';

const SUGGESTIONS = ['Französisch HÜ S. 45 Nr. 16 Freitag', 'Mathe SA 12.11.', 'was steht an?', 'Latein HÜ erledigt'];

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

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      const added = await Promise.all([...files].slice(0, 4).map((f) => compressImage(f)));
      setPhotos((p) => [...p, ...added].slice(0, 4));
    } catch {
      setError('Foto konnte nicht gelesen werden.');
    }
  }

  let lastDay = '';
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="chat">
        <Sky />
        <header className="chat-head">
          <span className="avatar-star"><StarMark size={19} /></span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="display" style={{ fontSize: 18, fontWeight: 700 }}>Stella</span>
            <span className="small" style={{ color: working ? 'var(--blue)' : 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="pulse" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              {working ? `löst gerade ${working.title}` : 'für dich da'}
            </span>
          </div>
        </header>

        <div className="chat-scroll">
          <div className="chat-inner">
            {messages.length === 0 && (
              <div className="empty">
                <span className="icon-tile pink"><StarMark size={26} /></span>
                <p>Schreib Stella in Stichworten, was ansteht.</p>
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
                      {m.text && <Rich text={m.text} />}
                      {m.attachments.map((a) => <AuthImage key={a.id} id={a.id} alt={a.caption} onOpen={setLightbox} />)}
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

        {messages.length < 5 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => setText(s)}>{s}</button>)}
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
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
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
            <button type="submit" className="send" disabled={!text.trim() && !photos.length} aria-label="Senden"><Icon name="send" size={20} stroke={2.4} /></button>
          </form>
        </div>
        {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
      </div>
      <AsideToday />
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
