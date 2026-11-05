import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rangeFor, stepAnchor, timeIn, todayIn, toMin, weekStart, type CalendarBlock, type CalendarView as View, type Ymd } from '@stella/shared';
import { useLocale, useT } from '../i18n.ts';
import { useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { Day } from './Day.tsx';
import { EventSheet, type SheetDraft } from './EventSheet.tsx';
import { Month } from './Month.tsx';
import { Week } from './Week.tsx';
import { useCalendar } from './useCalendar.ts';
import './calendar.css';

const VIEW_KEY = 'calendarView';
const readView = (prefix: string): View => { try { const v = localStorage.getItem(`${prefix}.${VIEW_KEY}`); return v === 'week' || v === 'day' ? v : 'month'; } catch { return 'month'; } };

/**
 * Der Kalender: Monat (Standard), Woche, Tag. Wischen oder die Pfeile blättern, „Heute“ springt zurück, Tippen auf einen Tag öffnet die
 * Tagesansicht. `header` (z. B. Wetter und Briefing-Hinweis) erscheint über der Tagesansicht, `trailing` neben den Knöpfen oben.
 */
export function CalendarView({ storagePrefix = 'stella', initialDay, dayHeader, trailing }: { storagePrefix?: string; initialDay?: Ymd; dayHeader?: (date: Ymd) => ReactNode; trailing?: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const tz = useStore((s) => s.me?.timeZone) ?? 'Europe/Vienna';
  const [view, setViewState] = useState<View>(() => readView(storagePrefix));
  const today = todayIn(tz);
  const [anchor, setAnchor] = useState<Ymd>(initialDay ?? today);
  const cal = useCalendar(view, anchor);
  const [sheet, setSheet] = useState<SheetDraft | null>(null);
  const [nowMin, setNowMin] = useState(() => toMin(timeIn(tz)));
  const rootRef = useRef<HTMLDivElement>(null);

  // Sprunglink: #calendar/JJJJ-MM-TT öffnet diesen Tag (aus Briefing, Chat-Karten, Erinnerungen)
  useEffect(() => {
    const jump = () => { const m = /^#calendar\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash); if (m) { setAnchor(m[1]!); setViewState('day'); } };
    jump();
    window.addEventListener('hashchange', jump);
    return () => window.removeEventListener('hashchange', jump);
  }, []);
  useEffect(() => { const id = setInterval(() => setNowMin(toMin(timeIn(tz))), 60_000); return () => clearInterval(id); }, [tz]);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(`${storagePrefix}.${VIEW_KEY}`, v); } catch { /* ohne Speicher geht es auch */ } };
  const go = (dir: 1 | -1) => setAnchor((a) => stepAnchor(view, a, dir));
  const pickDay = (date: Ymd) => { setAnchor(date); setView('day'); };

  // Tastatur: Alt+Pfeile blättern, T = heute, 1/2/3 = Monat/Woche/Tag (nicht in Eingabefeldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (!e.altKey && (e.key === 't' || e.key === 'T')) setAnchor(today);
      else if (!e.altKey && e.key === '1') setView('month');
      else if (!e.altKey && e.key === '2') setView('week');
      else if (!e.altKey && e.key === '3') setView('day');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Wischen (Finger): nach links = weiter, nach rechts = zurück
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const p = e.touches[0]!; touch.current = { x: p.clientX, y: p.clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const p = e.changedTouches[0]!;
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && !(e.target as HTMLElement).closest('.cal-block, .cal-resize')) go(dx < 0 ? 1 : -1);
  };

  const date = (d: Ymd, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const title = useMemo(() => {
    if (view === 'month') return date(anchor, { month: 'long', year: 'numeric' });
    if (view === 'week') { const r = rangeFor('week', anchor); return `${date(r.from, { day: 'numeric', month: 'short' })} – ${date(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
    return date(anchor, { weekday: 'long', day: 'numeric', month: 'long' });
  }, [view, anchor, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekNo = (() => { const d = new Date(`${weekStart(anchor)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3); const ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d.getTime() - ft.getTime()) / 86_400_000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7); })();

  const open = (b: CalendarBlock) => {
    if (b.itemId) setSheet({ block: b, date: b.date, start: b.start ?? '09:00', duration: b.start && b.end ? toMin(b.end) - toMin(b.start) : 60 });
  };
  const create = (d: SheetDraft) => setSheet(d);
  const now = () => { const m = Math.ceil(nowMin / 15) * 15; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  const dayData = cal.days.find((d) => d.date === anchor) ?? cal.days[0]!;

  return (
    <div className="cal" ref={rootRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="cal-head">
        <div className="cal-title">
          <h1 className="display" aria-live="polite">{title}</h1>
          {view !== 'month' && <p className="page-sub">{t('calendar.week.number', { n: weekNo })}</p>}
        </div>
        <div className="cal-controls">
          <div className="segmented" role="tablist" aria-label={t('nav.calendar')}>
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{t(`calendar.${v}`)}</button>
            ))}
          </div>
          <div className="cal-nav">
            <button type="button" className="icon-btn" aria-label={t('calendar.previous')} onClick={() => go(-1)}><Icon name="back" size={18} /></button>
            <button type="button" className="btn secondary small" onClick={() => setAnchor(today)}>{t('nav.today')}</button>
            <button type="button" className="icon-btn" aria-label={t('calendar.next')} onClick={() => go(1)}><Icon name="chevron" size={18} /></button>
          </div>
          <button type="button" className="btn" onClick={() => create({ date: view === 'day' ? anchor : today, start: now(), duration: 60 })}><Icon name="plus" size={15} /> {t('calendar.new')}</button>
          {trailing}
        </div>
      </header>

      {cal.offline && <p className="cal-offline small" role="status">{t('calendar.offline')}</p>}

      <div className={`cal-stage view-${view}`}>
        {view === 'month' && <Month anchor={anchor} days={cal.days} today={today} onPickDay={pickDay} />}
        {view === 'week' && <Week days={cal.days} today={today} nowMin={nowMin} onPickDay={pickDay} onOpen={open} onCreate={create} onChanged={cal.reload} />}
        {view === 'day' && <Day day={dayData} today={today} nowMin={nowMin} extra={dayHeader?.(anchor)} onOpen={open} onCreate={create} onChanged={cal.reload} />}
      </div>

      {sheet && <EventSheet draft={sheet} onClose={() => setSheet(null)} onSaved={cal.reload} />}
    </div>
  );
}

