import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Himmel mit Wolken und Sternschnuppe – liegt oben hinter dem Inhalt. */
export function Sky({ clouds = true }: { clouds?: boolean }) {
  return (
    <div className="sky" aria-hidden="true">
      <div className="sky-gradient" />
      {clouds && (
        <>
          <div className="cloud a" style={{ top: 30, left: '38%', width: 96, height: 28, opacity: 0.95 }} />
          <div className="cloud b" style={{ top: 46, right: -18, width: 124, height: 34, opacity: 0.85 }} />
          <div className="cloud a" style={{ top: 126, right: '22%', width: 70, height: 20, opacity: 0.6 }} />
        </>
      )}
      <div className="shooting-star" style={{ top: 24, left: 24 }} />
    </div>
  );
}

/** Der Stella-Stern, hüpft leicht. */
export function StarMark({ size = 20 }: { size?: number }) {
  return <Icon name="star" filled size={size} className="hop" />;
}

const CONFETTI = [
  { dx: '-26px', dy: '-22px', c: '#FF7EB3' }, { dx: '24px', dy: '-24px', c: '#4DA3FF' },
  { dx: '34px', dy: '6px', c: '#FFB3CF', r: true }, { dx: '-32px', dy: '10px', c: '#9CCBFF', r: true },
  { dx: '4px', dy: '-30px', c: '#1F6FEB' }, { dx: '-10px', dy: '26px', c: '#FF7EB3', r: true },
];

/** Kleines Konfetti, z. B. wenn etwas erledigt ist. */
export function Confetti({ delay = 0 }: { delay?: number }) {
  return (
    <span className="confetti" aria-hidden="true">
      {CONFETTI.map((p, i) => (
        <i key={i} style={{
          background: p.c, borderRadius: p.r ? '50%' : 2, animationDelay: `${delay + i * 0.03}s`,
          ['--dx' as string]: p.dx, ['--dy' as string]: p.dy,
        }} />
      ))}
    </span>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2 className="display" style={{ fontSize: 24 }}>{title}</h2>
          <button type="button" className="btn ghost" onClick={onClose}>Fertig</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" /><span className="knob" />
    </span>
  );
}

export function Ring({ value, color, label, size = 64 }: { value: number; color: string; label: React.ReactNode; size?: number }) {
  const r = 28;
  const len = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#E3ECF8" strokeWidth="6" />
        <circle className="val" cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - v)} transform="rotate(-90 32 32)"
          style={{ ['--ring-len' as string]: len }} />
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Kurze Meldung oben (ohne Abhängigkeiten). */
export function showToast(text: string, error = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = error ? 'toast error' : 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
