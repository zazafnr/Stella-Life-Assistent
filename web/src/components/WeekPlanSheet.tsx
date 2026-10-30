import { useEffect, useMemo, useState } from 'react';
import { formatDateDe, type PlanBlock, type WeekPlan } from '@stella/shared';
import { api, sync } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { Sheet, showToast } from '../ui/Decor.tsx';

const WHY: Record<PlanBlock['why'], string> = { exam: 'pink', homework: 'blue', assignment: 'green' };

/** „Woche planen“: Stellas Vorschlag ansehen, einzelne Blöcke abwählen, übernehmen */
export function WeekPlanSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<WeekPlan>('/api/weekplan').then(setPlan).catch((err: Error) => { showToast(err.message, true); onClose(); });
  }, [onClose]);

  const days = useMemo(() => {
    const m = new Map<string, PlanBlock[]>();
    for (const b of plan?.blocks ?? []) m.set(b.date, [...(m.get(b.date) ?? []), b]);
    return [...m];
  }, [plan]);
  const chosen = (plan?.blocks ?? []).filter((b) => !off.has(b.key));

  function flip(key: string) {
    setOff((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  async function apply() {
    setBusy(true);
    try {
      await api('/api/weekplan/apply', { method: 'POST', json: { blocks: chosen } });
      showToast(`${chosen.length} ${chosen.length === 1 ? 'Block' : 'Blöcke'} eingetragen ✨`);
      await sync();
      onClose();
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Woche planen" onClose={onClose}>
      {!plan ? (
        <p className="muted">Stella schaut sich deine Woche an …</p>
      ) : plan.blocks.length === 0 ? (
        <div className="empty">
          <span className="icon-tile blue"><Icon name="sun" size={26} /></span>
          <p>Diese Woche gibt es nichts zu planen – keine Tests, keine offenen HÜs.</p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Lernen für Tests, HÜs und Abgaben – verteilt auf deine freien Zeiten, mit Pausen und nie mehr als zwei Stunden an einem Schultag.
            Tipp auf einen Block, um ihn wegzulassen.
          </p>
          {days.map(([date, blocks]) => (
            <section key={date} className="plan-day">
              <span className="eyebrow">{formatDateDe(date, today)}</span>
              {blocks.map((b) => {
                const on = !off.has(b.key);
                return (
                  <button key={b.key} type="button" className={`plan-block ${WHY[b.why]}${on ? '' : ' off'}`} aria-pressed={on} onClick={() => flip(b.key)}>
                    <span className="plan-time">{b.start}<span className="small muted">{b.end}</span></span>
                    <span className="plan-text">
                      <strong>{b.title}</strong>
                      {b.focus && <span className="small muted">{b.focus}</span>}
                    </span>
                    <span className={`plan-check${on ? ' on' : ''}`} aria-hidden="true">{on && <Icon name="check" size={14} stroke={3} />}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {plan.notes.length > 0 && (
            <div className="plan-notes">
              {plan.notes.map((n) => <span key={n}>⚠️ {n}</span>)}
            </div>
          )}
          <button type="button" className="btn" disabled={busy || !chosen.length} onClick={() => void apply()}>
            <Icon name="calendar" size={18} />
            {busy ? 'Trägt ein …' : `${chosen.length} ${chosen.length === 1 ? 'Block' : 'Blöcke'} eintragen`}
          </button>
          <span className="small muted" style={{ textAlign: 'center' }}>Lässt sich unter „Was Stella getan hat“ rückgängig machen.</span>
        </>
      )}
    </Sheet>
  );
}
