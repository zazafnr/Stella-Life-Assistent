import { useEffect, useState } from 'react';

const KEY = 'evolsiorIntroShown';
const TAGLINE = 'Built to become';

export function introShown(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return true; }
}

function markShown() {
  try { localStorage.setItem(KEY, '1'); } catch { /* privater Modus – dann eben nochmal */ }
}

/** Blendet den Ladebildschirm aus index.html aus (200 ms) und entfernt ihn. */
export function dismissBoot() {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('done')) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 260);
}

/** Danach zeigt der Ladebildschirm wieder sein helles Stella-Gesicht (nur relevant, wenn die App länger lädt als das Intro). */
function endFirstStart() {
  document.documentElement.removeAttribute('data-first');
}

const CLOUDS = [
  { top: '9%', left: '-6%', right: undefined, w: 150, o: 0.95, d: 0.1 },
  { top: '17%', left: undefined, right: '-8%', w: 190, o: 0.9, d: 0.3 },
  { top: '66%', left: '4%', right: undefined, w: 120, o: 0.75, d: 0.5 },
  { top: '78%', left: undefined, right: '2%', w: 150, o: 0.85, d: 0.2 },
];

const SPARKS = [
  { x: '24%', y: '31%', s: 22, d: 0.9, c: '#FF7EB3' }, { x: '73%', y: '36%', s: 16, d: 1.3, c: '#4DA3FF' },
  { x: '31%', y: '62%', s: 15, d: 1.7, c: '#4DA3FF' }, { x: '68%', y: '60%', s: 20, d: 1.1, c: '#FF7EB3' },
  { x: '50%', y: '24%', s: 14, d: 1.5, c: '#fff' }, { x: '84%', y: '52%', s: 13, d: 2.0, c: '#fff' },
];

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * EVOLSIOR-Intro beim allerersten Start, etwa 3 Sekunden:
 * 0,0–0,8 s Name blendet ein, 0,8–2,2 s „Built to become“ Buchstabe für Buchstabe,
 * 0,7 s Stille, 0,4 s Ausblenden. Mit „Bewegung reduzieren“ nur Einblenden, 1,5 s stehen, ausblenden.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);
  const reduced = reducedMotion();

  useEffect(() => {
    const hold = reduced ? 1500 + 600 : 2900;
    const t1 = setTimeout(() => { setOut(true); endFirstStart(); }, hold);
    const t2 = setTimeout(() => { markShown(); onDone(); }, hold + 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone, reduced]);

  return (
    <div className={`intro${out ? ' out' : ''}${reduced ? ' reduced' : ''}`} role="img" aria-label="EVOLSIOR – Built to become">
      <div className="intro-glow g1" aria-hidden="true" />
      <div className="intro-glow g2" aria-hidden="true" />
      {CLOUDS.map((c, i) => (
        <div key={i} className="intro-cloud" aria-hidden="true" style={{ top: c.top, left: c.left, right: c.right, width: c.w, height: c.w * 0.3, opacity: c.o, animationDelay: `${c.d}s` }}>
          <div className={`cloud ${i % 2 ? 'b' : 'a'}`} style={{ inset: 0 }} />
        </div>
      ))}
      {SPARKS.map((p, i) => (
        <svg key={i} className="intro-spark" aria-hidden="true" viewBox="0 0 24 24" width={p.s} height={p.s}
          style={{ left: p.x, top: p.y, animationDelay: `${p.d}s`, color: p.c }}><path fill="currentColor" d="M12 2c.6 4.8 3.2 7.4 8 8-4.8.6-7.4 3.2-8 8-.6-4.8-3.2-7.4-8-8 4.8-.6 7.4-3.2 8-8z" /></svg>
      ))}
      <div className="intro-inner" aria-hidden="true">
        <svg className="intro-star" viewBox="0 0 24 24" width="46" height="46"><path fill="currentColor" d="M12 2c.6 4.8 3.2 7.4 8 8-4.8.6-7.4 3.2-8 8-.6-4.8-3.2-7.4-8-8 4.8-.6 7.4-3.2 8-8z" /></svg>
        <div className="intro-name">EVOLSIOR</div>
        <div className="intro-tag">
          {[...TAGLINE].map((ch, i) => (
            <span key={i} className="intro-ch" style={{ animationDelay: `${0.8 + i * 0.08}s` }}>{ch === ' ' ? '\u00a0' : ch}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
