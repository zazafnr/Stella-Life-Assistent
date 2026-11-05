import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, blocksForItems, dayLoad, rangeFor, todayIn, type CalendarDay, type CalendarView, type Ymd } from '@stella/shared';
import { api, useStore } from '../store.ts';

export interface CalendarData { today: Ymd; from: Ymd; to: Ymd; days: CalendarDay[]; offline: boolean; loading: boolean; reload: () => void }

/**
 * Tage und Blöcke für den sichtbaren Zeitraum. Online kommt alles vom Server (`GET /api/calendar`, mit freien Zeitfenstern aus dem
 * Lagebild, Routinen, Unterricht und Ziel-Check-ins); offline – oder wenn der Abruf scheitert – rechnet die App aus den lokal
 * gespeicherten Einträgen weiter (ohne freie Fenster).
 */
export function useCalendar(view: CalendarView, anchor: Ymd): CalendarData {
  const items = useStore((s) => s.items);
  const tz = useStore((s) => s.me?.timeZone) ?? 'Europe/Vienna';
  const online = useStore((s) => s.online);
  const today = todayIn(tz);
  const { from, to } = rangeFor(view, anchor);
  const [remote, setRemote] = useState<{ from: Ymd; to: Ymd; days: CalendarDay[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // ändert sich ein Eintrag (auch durch den Abgleich), holen wir die Tage neu
  const rev = useMemo(() => Object.values(items).reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), '') + Object.keys(items).length, [items]);

  const load = useCallback(() => {
    if (!online) { setFailed(true); return; }
    setLoading(true);
    api<{ days: CalendarDay[] }>(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => { setRemote({ from, to, days: r.days }); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [from, to, online]);
  useEffect(load, [load, rev]);

  const local = useMemo(() => {
    const all = Object.values(items);
    const out: CalendarDay[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const blocks = blocksForItems(all.filter((i) => i.due === d)).sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'));
      out.push({ date: d, blocks, free: [], freeMinutes: 0, load: dayLoad(blocks) });
    }
    return out;
  }, [items, from, to]);

  const usable = remote && remote.from === from && remote.to === to && !failed;
  return { today, from, to, days: usable ? remote.days : local, offline: failed, loading, reload: load };
}
