import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { addDays, dayDots, monthGrid, type CalendarDay } from '@stella/shared';
import { useLocale, useT } from '../i18n.ts';
import { KIND_COLOR } from './kinds.ts';

/** Monatsraster: je Tag bis zu drei farbige Punkte (breit: kleine Balken mit Titel). Tippen öffnet die Tagesansicht. */
export function Month({ anchor, days, today, onPickDay }: { anchor: string; days: CalendarDay[]; today: string; onPickDay: (date: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const rows = monthGrid(anchor);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const gridRef = useRef<HTMLDivElement>(null);
  const weekdays = rows[0]!.map((c) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${c.date}T12:00:00Z`)));

  const focusDate = (date: string) => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
  const onKey = (e: KeyboardEvent, date: string) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    focusDate(addDays(date, step));
  };

  return (
    <div className="cal-month" role="grid" aria-label={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor}T12:00:00Z`))} ref={gridRef}>
      <div className="cal-month-head" role="row">
        {weekdays.map((w, i) => <span key={i} role="columnheader" className={i >= 5 ? 'weekend' : ''}>{w}</span>)}
      </div>
      {rows.map((row, ri) => (
        <div className="cal-month-row" role="row" key={ri}>
          {row.map((cell) => {
            const day = byDate.get(cell.date);
            const dots = day ? dayDots(day.blocks) : [];
            const shown = day ? day.blocks.filter((b) => !b.soft && b.status !== 'cancelled') : [];
            const isToday = cell.date === today;
            const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${cell.date}T12:00:00Z`));
            return (
              <button
                key={cell.date} type="button" role="gridcell" data-date={cell.date}
                className={`cal-cell${cell.inMonth ? '' : ' out'}${cell.weekend ? ' weekend' : ''}${isToday ? ' today' : ''}`}
                aria-current={isToday ? 'date' : undefined}
                aria-label={t('calendar.day.entries', { date: dateLabel, count: shown.length })}
                tabIndex={cell.date === anchor ? 0 : -1}
                onClick={() => onPickDay(cell.date)}
                onKeyDown={(e) => onKey(e, cell.date)}
              >
                <span className="cal-num">{Number(cell.date.slice(8))}</span>
                <span className="cal-dots" aria-hidden="true">
                  {dots.map((d) => <i key={d.kind} style={{ '--kind': KIND_COLOR[d.kind] } as CSSProperties} />)}
                  {shown.length > 3 && <em>+{shown.length - 3}</em>}
                </span>
                <span className="cal-bars" aria-hidden="true">
                  {shown.slice(0, 2).map((b) => <span key={b.id} className="cal-bar" style={{ '--kind': KIND_COLOR[b.kind] } as CSSProperties}>{b.start ? `${b.start} ` : ''}{b.title}</span>)}
                  {shown.length > 2 && <span className="cal-more">{t('calendar.more', { count: shown.length - 2 })}</span>}
                </span>
                {day && day.load > 0 && <span className="cal-load" aria-hidden="true" style={{ '--load': `${Math.round(day.load * 100)}%` } as CSSProperties} title={t('calendar.booked', { percent: Math.round(day.load * 100) })} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
