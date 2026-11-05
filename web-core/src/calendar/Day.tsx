import { type CSSProperties } from 'react';
import type { CalendarBlock, CalendarDay } from '@stella/shared';
import { patchItem } from '../store.ts';
import { useT } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';
import { showToast } from '../ui/Decor.tsx';
import { Timeline } from './Timeline.tsx';
import { KIND_COLOR } from './kinds.ts';
import type { SheetDraft } from './EventSheet.tsx';

/** Ein Tag: Zeitachse mit genauen Uhrzeiten, Routinen und Unterricht als Streifen, freie Fenster („hier einplanen“), darunter alles ohne Uhrzeit. */
export function Day({ day, today, nowMin, extra, onOpen, onCreate, onChanged }: {
  day: CalendarDay; today: string; nowMin: number; extra?: React.ReactNode;
  onOpen: (b: CalendarBlock) => void; onCreate: (d: SheetDraft) => void; onChanged: () => void;
}) {
  const t = useT();
  const untimed = day.blocks.filter((b) => b.start === null && !b.soft);
  const timed = day.blocks.filter((b) => b.start !== null);
  const toggle = async (b: CalendarBlock) => {
    if (!b.itemId) return;
    try { await patchItem(b.itemId, { status: b.status === 'done' ? 'open' : 'done' }); onChanged(); } catch (err) { showToast((err as Error).message, true); }
  };
  return (
    <div className="cal-day">
      {extra}
      {day.freeMinutes > 0 && day.date >= today && <p className="cal-day-meta small muted">{t('calendar.free.minutes', { minutes: `${Math.floor(day.freeMinutes / 60)}:${String(day.freeMinutes % 60).padStart(2, '0')} h` })} · {t('calendar.booked', { percent: Math.round(day.load * 100) })}</p>}
      <Timeline days={[day]} today={today} nowMin={nowMin} onOpen={onOpen} onCreate={onCreate} onChanged={onChanged} />
      <section className="cal-untimed" aria-label={t('calendar.untimed')}>
        <h2 className="eyebrow">{t('calendar.untimed')}</h2>
        {untimed.length === 0 && timed.length === 0 && <p className="muted">{t('calendar.nothing')}</p>}
        {untimed.map((b) => (
          <div key={b.id} className={`cal-todo${b.status === 'done' ? ' done' : ''}`} style={{ '--kind': KIND_COLOR[b.kind] } as CSSProperties}>
            <button type="button" className={b.status === 'done' ? 'check on' : 'check'} aria-label={b.title} aria-pressed={b.status === 'done'} onClick={() => void toggle(b)}>
              {b.status === 'done' && <Icon name="check" size={14} stroke={3.2} />}
            </button>
            <button type="button" className="cal-todo-title" onClick={() => onOpen(b)}>{b.title}</button>
            <span className="cal-todo-kind small muted">{t(`calendar.kind.${b.kind}`)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
