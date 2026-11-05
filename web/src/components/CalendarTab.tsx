import { useState } from 'react';
import { todayIn } from '@stella/shared';
import { CalendarView } from '@stella/web-core/calendar/CalendarView.tsx';
import { BriefingCard } from '@stella/web-core/components/BriefingCard.tsx';
import { useStore } from '@stella/web-core/store.ts';
import { useT } from '@stella/web-core/i18n.ts';
import { useWeather } from '@stella/web-core/weather.ts';
import type { Tab } from '@stella/web-core/nav.ts';
import { Planner } from './Planner.tsx';

const MODE_KEY = 'stella.calendarMode';
const readMode = (): 'calendar' | 'list' => { try { return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'calendar'; } catch { return 'calendar'; } };

/** Der Tab „Kalender“: Monat, Woche, Tag – und der Planer als Listenansicht über den Umschalter „Liste / Kalender“. */
export function CalendarTab({ go }: { go: (t: Tab) => void }) {
  const t = useT();
  const [mode, setModeState] = useState(readMode);
  const setMode = (m: 'calendar' | 'list') => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ohne Speicher geht es auch */ } };
  const tz = useStore((s) => s.me?.timeZone) ?? 'Europe/Vienna';
  const weather = useWeather();
  const today = todayIn(tz);

  const switcher = (
    <div className="segmented" role="tablist" aria-label={t('nav.calendar')}>
      <button type="button" role="tab" aria-selected={mode === 'calendar'} className={mode === 'calendar' ? 'active' : ''} onClick={() => setMode('calendar')}>{t('calendar.calendarView')}</button>
      <button type="button" role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>{t('calendar.listView')}</button>
    </div>
  );

  if (mode === 'list') {
    return (
      <>
        <div className="cal-modebar">{switcher}</div>
        <Planner />
      </>
    );
  }
  return (
    <CalendarView
      storagePrefix="stella" trailing={switcher}
      dayHeader={(date) => (date === today ? (
        <>
          {weather && <p className="cal-weather small muted">{Math.round(weather.temp)}° · {t(`weather.type.${weather.type}`)}</p>}
          <BriefingCard onOpen={go} />
        </>
      ) : null)}
    />
  );
}
