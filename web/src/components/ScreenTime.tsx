import { useEffect, useState } from 'react';
import { api } from '../store.ts';
import { useLocale, useT } from '../i18n.ts';

interface DayStat { date: string; maxMinutes: number; percent: number; reachedLimit: boolean }
interface Overview { allowed: boolean; overview: { goal: { id: string; name: string; limitMinutes: number }; days: DayStat[] }[] }

/**
 * Ziele → Bildschirmzeit. Web und PC: nur „auf dem iPhone verfügbar“, dazu die Ziele samt Verlauf aus den Ereignissen.
 * Keine Punkte, Serien oder Abzeichen – nur: an welchen Tagen das Limit erreicht wurde.
 */
export function ScreenTimeCard() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { api<Overview>('/api/screentime/overview?days=14').then(setData).catch(() => {}); }, []);
  if (!data) return null;
  return (
    <section className="card" aria-label={t('screentime.title')}>
      <span className="eyebrow">{t('screentime.title')}</span>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>{t('screentime.iphoneOnly')}</p>
      {!data.allowed && <p className="small">{t('screentime.upgrade')}</p>}
      {data.allowed && data.overview.length === 0 && <p className="small muted">{t('screentime.noGoals')}</p>}
      {data.overview.map(({ goal, days }) => {
        const within = days.filter((d) => !d.reachedLimit).length;
        return (
          <div key={goal.id} style={{ marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{goal.name}</strong>
              <span className="small muted">{t('screentime.limitPerDay', { minutes: goal.limitMinutes })}</span>
            </div>
            <div className="st-bars" role="img" aria-label={t('screentime.week', { name: goal.name, n: within, total: days.length })}>
              {days.map((d) => (
                <span key={d.date} className={d.reachedLimit ? 'st-bar over' : 'st-bar'} style={{ height: `${Math.max(8, Math.min(100, d.percent))}%` }}
                  title={`${new Date(`${d.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'numeric' })}: ${d.maxMinutes} min`} />
              ))}
            </div>
            <p className="small muted" style={{ margin: '2px 0 0' }}>{t('screentime.week', { name: goal.name, n: within, total: days.length })}</p>
          </div>
        );
      })}
    </section>
  );
}
