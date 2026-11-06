import { type CSSProperties } from 'react';
import type { CalendarBlock, CalendarDay } from '@stella/shared';
import { useLocale, useT } from '../i18n.ts';
import { Timeline } from './Timeline.tsx';
import type { SheetDraft } from './EventSheet.tsx';

/** Sieben Spalten mit gemeinsamer Zeitachse; am Kopf der Tag mit seiner Auslastung. */
export function Week({ days, today, nowMin, onPickDay, onOpen, onCreate, onChanged }: {
  days: CalendarDay[]; today: string; nowMin: number; onPickDay: (date: string) => void;
  onOpen: (b: CalendarBlock) => void; onCreate: (d: SheetDraft) => void; onChanged: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="cal-week">
      <div className="cal-week-head">
        <span className="cal-gutter" />
        <div className="cal-week-days">
          {days.map((d) => {
            const date = new Date(`${d.date}T12:00:00Z`);
            return (
              <button key={d.date} type="button" className={d.date === today ? 'cal-wd today' : 'cal-wd'} onClick={() => onPickDay(d.date)}
                aria-label={new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date)}>
                <span className="wd">{new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date)}</span>
                <span className="n">{Number(d.date.slice(8))}</span>
                <span className="cal-loadbar" title={t('calendar.booked', { percent: Math.round(d.load * 100) })}><i style={{ width: `${Math.round(d.load * 100)}%` } as CSSProperties} /></span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="cal-scroll">
        <Timeline days={days} today={today} nowMin={nowMin} onOpen={onOpen} onCreate={onCreate} onChanged={onChanged} />
      </div>
    </div>
  );
}
