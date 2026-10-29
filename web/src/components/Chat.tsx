import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sendMessage, useStore } from '../store.ts';
import { AuthImage, Lightbox, Rich } from './Rich.tsx';

const SUGGESTIONS = ['Latein HÜ S. 45 Nr. 3 Freitag', 'Mathe SA 12.11.', 'was steht an?', 'Latein HÜ erledigt'];

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
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, thinking]);
  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus(); }, []);

  async function submit(value = text) {
    const t = value.trim();
    if (!t) return;
    setText('');
    setError('');
    try {
      await sendMessage(t);
    } catch (err) {
      setError((err as Error).message);
      setText(t);
    }
  }

  let lastDay = '';
  return (
    <div className="chat">
      <div className="chat-scroll">
        {messages.length === 0 && (
          <div className="empty">
            <div className="empty-star">✦</div>
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
                  <Rich text={m.text} />
                  {m.attachments.map((a) => <AuthImage key={a.id} id={a.id} alt={a.caption} onOpen={setLightbox} />)}
                  <span className="meta">{m.pending ? '⏳' : timeLabel(m.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {thinking && (
          <div className="bubble-row assistant">
            <div className="bubble assistant typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {messages.length < 4 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => setText(s)}>{s}</button>)}
        </div>
      )}
      {error && <div className="error-bar">{error}</div>}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder="Nachricht an Stella…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
          }}
        />
        <button type="submit" disabled={!text.trim()} aria-label="Senden">↑</button>
      </form>
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
