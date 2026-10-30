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
      <div className="intro-inner" aria-hidden="true">
        <div className="intro-name">EVOLSIOR</div>
        <div className="intro-tag">
          {[...TAGLINE].map((ch, i) => (
            <span key={i} className="intro-ch" style={{ animationDelay: `${0.8 + i * 0.08}s` }}>{ch === ' ' ? ' ' : ch}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
