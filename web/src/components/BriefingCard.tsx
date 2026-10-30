import { useEffect, useState } from 'react';
import type { Briefing, Hint } from '@stella/shared';
import { api, sync, useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { showToast } from '../ui/Decor.tsx';
import { ActionCard } from './ActionCard.tsx';
import { Rich } from './Rich.tsx';

const ICON: Record<string, string> = { school: '🏫', due: '📌', plan: '🗓️', tomorrow: '🌙', done: '✅', inbox: '✉️', goals: '🎯' };

/** Oben auf „Heute“: morgens der Überblick, den ganzen Tag „Mir ist aufgefallen“ */
export function BriefingCard({ onOpen }: { onOpen: (tab: 'chat' | 'inbox' | 'goals') => void }) {
  const lastSync = useStore((s) => s.lastSync);
  const [b, setB] = useState<Briefing | null>(null);
  const [gone, setGone] = useState<string[]>([]);

  useEffect(() => { api<Briefing>('/api/briefing').then(setB).catch(() => {}); }, [lastSync]);
  if (!b) return null;

  const morning = new Date().getHours() < 12;
  const sections = morning ? b.sections : [];
  const hints = b.hints.filter((h) => !gone.includes(h.key));
  if (!sections.length && !hints.length) return null;

  return (
    <section className="card briefing" aria-label="Dein Überblick">
      {sections.length > 0 && (
        <>
          <span className="eyebrow">Dein Überblick</span>
          <div className="briefing-sections">
            {sections.map((s) => (
              <div key={s.id} className="briefing-section">
                <span className="briefing-icon" aria-hidden="true">{ICON[s.id] ?? '•'}</span>
                <div>
                  <span className="briefing-title">{s.title}</span>
                  {s.lines.map((l, i) => <span key={i} className="briefing-line">{l}</span>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {hints.length > 0 && (
        <>
          <span className="eyebrow" style={{ color: 'var(--pink-text)', marginTop: sections.length ? 6 : 0 }}>Mir ist aufgefallen</span>
          {hints.map((h) => <HintRow key={h.key} hint={h} onOpen={onOpen} onGone={() => setGone((g) => [...g, h.key])} />)}
        </>
      )}
    </section>
  );
}

function HintRow({ hint, onGone, onOpen }: { hint: Hint; onGone: () => void; onOpen: (tab: 'chat' | 'inbox' | 'goals') => void }) {
  const action = useStore((s) => (hint.actionId ? s.actions[hint.actionId] : undefined));
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const r = await api<{ status: string }>(`/api/hints/${encodeURIComponent(hint.key)}/accept`, { method: 'POST' });
      showToast(r.status === 'proposed' ? 'Gemerkt' : 'Erledigt');
      onGone();
      void sync();
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    onGone();
    await api(`/api/hints/${encodeURIComponent(hint.key)}/dismiss`, { method: 'POST' }).catch(() => {});
  }

  return (
    <div className={`hint-row ${hint.priority}`}>
      <div className="hint-text"><Rich text={hint.text} /></div>
      <div className="hint-actions">
        {hint.actionId && action?.status === 'proposed' ? <ActionCard id={hint.actionId} />
          : hint.actionLabel ? <button type="button" className="btn small" disabled={busy} onClick={() => void accept()}>{hint.actionLabel}</button>
            : hint.open
              ? <button type="button" className="btn small" onClick={() => { void api(`/api/hints/${encodeURIComponent(hint.key)}/accept`, { method: 'POST' }).catch(() => {}); onOpen(hint.open!.tab); }}>{hint.open.label}</button> : null}
        <button type="button" className="link small muted" onClick={() => void dismiss()} aria-label="Hinweis ausblenden"><Icon name="close" size={14} /> Passt schon</button>
      </div>
    </div>
  );
}
