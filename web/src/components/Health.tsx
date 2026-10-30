import { useEffect, useState } from 'react';
import { addDays, todayIn, type HealthDay } from '@stella/shared';
import { api, useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { Ring, Sky, showToast } from '../ui/Decor.tsx';

export function Health({ back }: { back: () => void }) {
  const me = useStore((s) => s.me);
  const [days, setDays] = useState<HealthDay[] | null>(null);
  const goal = me?.settings.stepGoal || 8000;
  const tz = me?.timeZone ?? 'Europe/Vienna';

  useEffect(() => {
    api<HealthDay[]>('/api/health?days=14').then(setDays).catch((err: Error) => showToast(err.message, true));
  }, []);

  const today = todayIn(tz);
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const range = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const max = Math.max(goal * 1.15, ...(days ?? []).map((d) => d.steps ?? 0));
  const todaySteps = byDate.get(today)?.steps ?? 0;
  const week = range.slice(-7).map((d) => byDate.get(d)?.steps ?? 0);
  const avg = Math.round(week.reduce((a, b) => a + b, 0) / 7);
  const reached = week.filter((s) => s >= goal).length;

  return (
    <div className="page">
      <Sky />
      <div className="page-inner stagger">
        <header className="page-head">
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Zurück" onClick={back}><Icon name="back" size={18} /></button>
            <h1 className="display">Gesundheit</h1>
          </div>
        </header>

        <section className="card row" style={{ gap: 18 }}>
          <Ring size={96} value={todaySteps / goal} color="#34C77B" label={<span style={{ fontSize: 20 }}>{Math.round((todaySteps / goal) * 100)}%</span>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="display" style={{ fontSize: 28 }}>{todaySteps.toLocaleString('de-AT')}</span>
            <span className="muted">Schritte heute · Ziel {goal.toLocaleString('de-AT')}</span>
            <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>
              {todaySteps >= goal ? 'Ziel geschafft – stark!' : `Noch ${(goal - todaySteps).toLocaleString('de-AT')} bis zum Ziel`}
            </span>
          </div>
        </section>

        <div className="grid-2">
          <div className="card"><span className="eyebrow">Ø 7 Tage</span><p className="display" style={{ fontSize: 24, margin: '6px 0 0' }}>{avg.toLocaleString('de-AT')}</p></div>
          <div className="card"><span className="eyebrow">Ziel erreicht</span><p className="display" style={{ fontSize: 24, margin: '6px 0 0' }}>{reached} / 7 Tage</p></div>
        </div>

        <section className="card">
          <h2>Schritte – 14 Tage</h2>
          <div className="bars" role="img" aria-label="Schritte der letzten 14 Tage">
            <div className="bar-area">
              {range.map((d, i) => {
                const steps = byDate.get(d)?.steps ?? 0;
                return (
                  <div key={d} className="bar-col" title={`${d}: ${steps.toLocaleString('de-AT')} Schritte`}>
                    <div className={`bar${steps >= goal ? ' reached' : ''}`} style={{ height: `${(steps / max) * 100}%`, animationDelay: `${i * 0.03}s` }} />
                  </div>
                );
              })}
              <div className="goal-line" style={{ bottom: `${(goal / max) * 100}%` }} />
            </div>
            <div className="bar-labels">{range.map((d) => <span key={d}>{Number(d.slice(8))}</span>)}</div>
          </div>
        </section>

        {days && days.length === 0 && (
          <section className="card">
            <h2>Noch keine Daten</h2>
            <p className="muted">Damit Stella deine Schritte kennt, schickt ein Apple-Kurzbefehl sie jeden Abend. Die Anleitung steht unter Einstellungen → Health &amp; SMS.</p>
          </section>
        )}
      </div>
    </div>
  );
}
