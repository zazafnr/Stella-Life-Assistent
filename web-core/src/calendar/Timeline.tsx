import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { axisRange, layoutDay, snap, toHhmm, toMin, type CalendarBlock, type CalendarDay } from '@stella/shared';
import { api, sync } from '../store.ts';
import { useT } from '../i18n.ts';
import { showToast } from '../ui/Decor.tsx';
import { KIND_COLOR } from './kinds.ts';
import type { SheetDraft } from './EventSheet.tsx';

const PX_PER_MIN = 1.1;
const MIN_DURATION = 15;

interface Drag {
  mode: 'move' | 'resize' | 'create';
  block?: CalendarBlock;
  colIndex: number;
  startMin: number;
  endMin: number;
  /** Abstand des Griffpunkts zum Blockanfang (Minuten) */
  grab: number;
  moved: boolean;
}

/** Zeitachse für einen Tag (Tagesansicht) oder sieben Tage (Wochenansicht): Blöcke, Hintergrundstreifen, freie Fenster, Jetzt-Linie, Ziehen und Dehnen. */
export function Timeline({ days, today, nowMin, onOpen, onCreate, onChanged }: {
  days: CalendarDay[];
  today: string;
  nowMin: number;
  onOpen: (block: CalendarBlock) => void;
  onCreate: (draft: SheetDraft) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const all = useMemo(() => days.flatMap((d) => d.blocks), [days]);
  const { startMin, endMin } = useMemo(() => axisRange(all), [all]);
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours = useMemo(() => Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin / 60 + i), [startMin, endMin]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  const place = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  /** Zeigerposition → Spalte und Minute (auf 15 Minuten gerundet) */
  const locate = (e: { clientX: number; clientY: number }) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const col = Math.min(days.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * days.length)));
    const min = snap(startMin + (e.clientY - rect.top) / PX_PER_MIN);
    return { col, min: Math.max(startMin, Math.min(endMin, min)) };
  };

  const begin = (e: RPointerEvent, mode: Drag['mode'], block?: CalendarBlock, colIndex = 0) => {
    if (e.button !== 0) return;
    const at = locate(e);
    const s = block ? toMin(block.start!) : at.min;
    const eMin = block ? toMin(block.end!) : at.min + 60;
    const start = () => {
      suppressClick.current = false;
      place({ mode, block, colIndex: block ? colIndex : at.col, startMin: s, endMin: Math.max(eMin, s + MIN_DURATION), grab: block ? at.min - s : 0, moved: false });
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // Maus und Stift ziehen sofort, Finger nach langem Drücken (sonst würde das Scrollen blockiert)
    if (e.pointerType === 'touch') { holdRef.current = setTimeout(start, 380); } else start();
  };

  const onMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) { if (holdRef.current && e.pointerType === 'touch') { clearTimeout(holdRef.current); holdRef.current = null; } return; }
    const at = locate(e);
    if (d.mode === 'move' || d.mode === 'create') {
      const len = d.mode === 'move' ? d.endMin - d.startMin : 0;
      if (d.mode === 'move') {
        const s = Math.max(startMin, Math.min(endMin - len, snap(at.min - d.grab)));
        place({ ...d, colIndex: at.col, startMin: s, endMin: s + len, moved: d.moved || s !== d.startMin || at.col !== d.colIndex });
      } else {
        place({ ...d, endMin: Math.max(at.min, d.startMin + MIN_DURATION), moved: true });
      }
    } else {
      place({ ...d, endMin: Math.max(d.startMin + MIN_DURATION, at.min), moved: true });
    }
  };

  const finish = async () => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
    const d = dragRef.current;
    place(null);
    if (!d) return;
    suppressClick.current = d.moved;
    const date = days[d.colIndex]!.date;
    if (d.mode === 'create') {
      if (d.moved) onCreate({ date, start: toHhmm(d.startMin), duration: d.endMin - d.startMin });
      return;
    }
    if (!d.moved || !d.block?.itemId) return;
    try {
      const r = await api<{ actionId: string | null }>(`/api/calendar/items/${d.block.itemId}`, { method: 'PATCH', json: { due: date, time: toHhmm(d.startMin), duration: d.endMin - d.startMin } });
      showToast(t('calendar.moved'), false, r.actionId ? {
        label: t('calendar.undo'),
        run: () => void api(`/api/actions/${r.actionId}/undo`, { method: 'POST' }).then(() => sync()).then(() => { showToast(t('calendar.undone')); onChanged(); }).catch((err: Error) => showToast(err.message, true)),
      } : undefined);
      await sync();
      onChanged();
    } catch (err) { showToast((err as Error).message, true); }
  };

  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current); }, []);

  const top = (m: number) => (m - startMin) * PX_PER_MIN;
  const isNowVisible = days.some((d) => d.date === today) && nowMin >= startMin && nowMin <= endMin;
  const nowCol = days.findIndex((d) => d.date === today);

  return (
    <div className="cal-timeline" style={{ '--cols': days.length, '--axis-h': `${height}px` } as CSSProperties}>
      <div className="cal-hours" aria-hidden="true" style={{ height }}>
        {hours.map((h) => <span key={h} style={{ top: top(h * 60) }}>{String(h % 24).padStart(2, '0')}:00</span>)}
      </div>
      <div
        className="cal-body" ref={bodyRef} style={{ height }}
        onPointerMove={onMove} onPointerUp={() => void finish()} onPointerCancel={() => { place(null); if (holdRef.current) clearTimeout(holdRef.current); }}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('cal-col') || (e.target as HTMLElement).classList.contains('cal-line')) begin(e, 'create'); }}
      >
        {hours.map((h) => <div key={h} className="cal-line" style={{ top: top(h * 60) }} />)}
        {days.map((day, ci) => {
          const placed = layoutDay(day.blocks.filter((b) => !b.soft));
          const soft = day.blocks.filter((b) => b.soft && b.start && b.end);
          return (
            <div key={day.date} className={day.date === today ? 'cal-col today' : 'cal-col'} style={{ left: `${(ci / days.length) * 100}%`, width: `${100 / days.length}%` }}>
              {soft.map((b) => {
                const s = Math.max(startMin, toMin(b.start!));
                const e = Math.min(endMin, toMin(b.end!));
                if (e <= s) return null;
                return (
                  <div key={b.id} className={`cal-soft ${b.kind}${b.status === 'cancelled' ? ' off' : ''}`} style={{ top: top(s), height: (e - s) * PX_PER_MIN, '--kind': KIND_COLOR[b.kind] } as CSSProperties} title={b.title}>
                    <span>{b.title}{b.status === 'cancelled' ? ` · ${t('calendar.cancelled')}` : ''}</span>
                  </div>
                );
              })}
              {day.free.filter((f) => toMin(f.end) - toMin(f.start) >= 30).map((f) => (
                <button
                  key={`${f.start}-${f.end}`} type="button" className="cal-free" style={{ top: top(Math.max(startMin, toMin(f.start))), height: (Math.min(endMin, toMin(f.end)) - Math.max(startMin, toMin(f.start))) * PX_PER_MIN }}
                  aria-label={`${t('calendar.freeHere')} (${t('calendar.freeWindow', { from: f.start, to: f.end })})`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onCreate({ date: day.date, start: f.start, duration: Math.min(60, toMin(f.end) - toMin(f.start)) })}
                >
                  <span>{t('calendar.freeHere')}</span>
                </button>
              ))}
              {placed.map((p) => {
                const b = p.block;
                const dragging = drag?.block?.id === b.id;
                const s = p.startMin;
                const e = p.endMin;
                const editable = !!b.itemId;
                return (
                  <div
                    key={b.id}
                    className={`cal-block ${b.kind}${b.status === 'done' ? ' done' : ''}${dragging ? ' dragging' : ''}${editable ? ' editable' : ''}${(e - s) < 50 ? ' short' : ''}`}
                    style={{ top: top(s), height: Math.max(18, (e - s) * PX_PER_MIN - 2), left: `${(p.column / p.columns) * 100}%`, width: `calc(${100 / p.columns}% - 3px)`, '--kind': KIND_COLOR[b.kind] } as CSSProperties}
                  >
                    <button
                      type="button" className="cal-block-main"
                      aria-label={`${b.title}, ${b.start}–${b.end}${b.location ? `, ${b.location}` : ''}`}
                      onPointerDown={(e) => { if (editable) begin(e, 'move', b, ci); }}
                      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(b); }}
                    >
                      <span className="cal-block-time">{b.start}–{b.end}</span>
                      <strong>{b.title}</strong>
                      {b.location && (e - s) >= 45 && <span className="cal-block-place">{b.location}</span>}
                    </button>
                    {editable && <span className="cal-resize" role="presentation" onPointerDown={(e) => { e.stopPropagation(); begin(e, 'resize', b, ci); }} />}
                  </div>
                );
              })}
              {drag && drag.colIndex === ci && (drag.mode === 'create' || drag.moved) && (
                <div className="cal-ghost" style={{ top: top(drag.startMin), height: (drag.endMin - drag.startMin) * PX_PER_MIN }}>
                  <span>{toHhmm(drag.startMin)}–{toHhmm(drag.endMin)}</span>
                </div>
              )}
            </div>
          );
        })}
        {isNowVisible && nowCol >= 0 && (
          <div className="cal-now" style={{ top: top(nowMin), left: `${(nowCol / days.length) * 100}%`, width: `${100 / days.length}%` }} aria-hidden="true"><i /></div>
        )}
      </div>
    </div>
  );
}
