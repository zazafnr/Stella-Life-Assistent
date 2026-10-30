import { useEffect, useState, type ReactNode } from 'react';
import { fetchFileUrl, getState } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';

/** Minimaler Formatierer für **fett**, _kursiv_ und Zeilenumbrüche – ohne HTML-Einschleusung. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={key++}>{m[1]}</strong> : <em key={key++}>{m[2]}</em>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <span className="rich">{out}</span>;
}

/** Lädt Bilder mit Login-Token (Bilder sind privat). */
export function AuthImage({ id, alt, onOpen }: { id: string; alt?: string; onOpen?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    fetch(`/api/files/${id}`, { headers: { Authorization: `Bearer ${getState().token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  if (failed) return <div className="img-placeholder">Bild offline nicht verfügbar</div>;
  if (!url) return <div className="img-placeholder">Lädt…</div>;
  return (
    <button className="img-button" onClick={() => onOpen?.(url)} type="button">
      <img src={url} alt={alt ?? ''} />
    </button>
  );
}

export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="lightbox" onClick={onClose} role="dialog">
      <img src={url} alt="" />
      <a className="lightbox-save btn" href={url} download="stella-aufgabe.png" onClick={(e) => e.stopPropagation()}>Sichern</a>
    </div>
  );
}

/** Sprachnachricht abspielen: lädt die Aufnahme erst beim ersten Antippen (sie braucht den Login). */
export function AudioPlayer({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'failed'>('idle');
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio?.pause(); if (audio) URL.revokeObjectURL(audio.src); }, [audio]);

  async function toggle() {
    if (audio) {
      if (audio.paused) { void audio.play(); setState('playing'); } else { audio.pause(); setState('idle'); }
      return;
    }
    setState('loading');
    try {
      const a = new Audio(await fetchFileUrl(id));
      a.onended = () => setState('idle');
      setAudio(a);
      await a.play();
      setState('playing');
    } catch {
      setState('failed');
    }
  }

  return (
    <button type="button" className="audio-play" onClick={() => void toggle()} aria-label={state === 'playing' ? 'Pausieren' : 'Sprachnachricht abspielen'}>
      <span className="audio-play-btn"><Icon name={state === 'playing' ? 'pause' : 'play'} size={16} filled={state !== 'playing'} /></span>
      <span className="audio-wave" aria-hidden="true">{[5, 9, 14, 8, 16, 11, 6, 13, 9, 5].map((h, i) => <i key={i} style={{ height: h }} />)}</span>
      <span className="small">{state === 'loading' ? 'lädt …' : state === 'failed' ? 'nicht verfügbar' : 'Sprachnachricht'}</span>
    </button>
  );
}
