import { useEffect, useState } from 'react';
import { addDays, todayIn, type HealthDay } from '@stella/shared';
import { api, useStore } from '../store.ts';

export function Health() {
  const me = useStore((s) => s.me);
  const [days, setDays] = useState<HealthDay[] | null>(null);
  const [error, setError] = useState('');
  const goal = me?.settings.stepGoal || 8000;
  const tz = me?.timeZone ?? 'Europe/Vienna';

  useEffect(() => {
    api<HealthDay[]>('/api/health?days=14').then(setDays).catch((err: Error) => setError(err.message));
  }, []);

  const today = todayIn(tz);
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const range = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const max = Math.max(goal, ...(days ?? []).map((d) => d.steps ?? 0));
  const todaySteps = byDate.get(today)?.steps ?? null;
  const week = range.slice(-7).map((d) => byDate.get(d)?.steps ?? 0);
  const avg = Math.round(week.reduce((a, b) => a + b, 0) / 7);

  return (
    <div className="page">
      <header className="page-head"><h1>Gesundheit</h1></header>
      {error && <div className="error-bar">{error}</div>}

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{todaySteps?.toLocaleString('de-AT') ?? '–'}</span>
          <span className="stat-label">Schritte heute</span>
        </div>
        <div className="stat">
          <span className="stat-value">{avg ? avg.toLocaleString('de-AT') : '–'}</span>
          <span className="stat-label">Ø letzte 7 Tage</span>
        </div>
        <div className="stat">
          <span className="stat-value">{goal.toLocaleString('de-AT')}</span>
          <span className="stat-label">Tagesziel</span>
        </div>
      </div>

      <section className="card">
        <h2>Schritte – 14 Tage</h2>
        <div className="bars" role="img" aria-label="Schritte der letzten 14 Tage">
          <div className="bar-area">
            {range.map((d) => {
              const steps = byDate.get(d)?.steps ?? 0;
              return (
                <div key={d} className="bar-col" title={`${d}: ${steps.toLocaleString('de-AT')} Schritte`}>
                  <div className={`bar${steps >= goal ? ' reached' : ''}`} style={{ height: `${(steps / max) * 100}%` }} />
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
          <p>
            Damit Stella deine Schritte kennt, brauchst du einen Apple-Kurzbefehl, der jeden Abend deine Health-Daten schickt.
            Die Anleitung findest du unter <strong>Einstellungen → Apple Health & SMS</strong>.
          </p>
        </section>
      )}
    </div>
  );
}
