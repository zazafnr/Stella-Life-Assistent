import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, formatDateDe, todayIn, weekdayOf, type Item } from '@stella/shared';
import { api, deleteItem, patchItem, useStore } from '../store.ts';
import { AuthImage, Lightbox } from './Rich.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Confetti, Sky, showToast } from '../ui/Decor.tsx';
import { WeekPlanSheet } from './WeekPlanSheet.tsx';

interface Lesson { date: string; start: string; end: string; subject: string | null; code: string | null; status: string; info: string | null }

type Filter = 'all' | 'school' | 'exams' | 'study';
const FILTERS: [Filter, string][] = [['all', 'Alles'], ['school', 'HÜs'], ['exams', 'Tests'], ['study', 'Lernplan']];
const matches = (f: Filter, i: Item) =>
  f === 'all' || (f === 'school' && (i.kind === 'homework' || i.kind === 'assignment'))
  || (f === 'exams' && i.kind === 'exam') || (f === 'study' && i.kind === 'study');

function isoWeek(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const KIND_LABEL: Record<string, string> = {
  homework: 'Hausübung', exam: 'Test / Schularbeit', assignment: 'Abgabe', event: 'Termin', todo: 'To-do', study: 'Lerneinheit',
};

export function Planner() {
  const itemsById = useStore((s) => s.items);
  const busy = useStore((s) => s.busyItems);
  const tz = useStore((s) => s.me?.timeZone ?? 'Europe/Vienna');
  const today = todayIn(tz);
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [planning, setPlanning] = useState(false);

  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  useEffect(() => {
    api<Lesson[]>(`/api/timetable?from=${monday}&to=${addDays(monday, 6)}`).then(setLessons).catch(() => setLessons([]));
  }, [monday]);

  const all = useMemo(() => Object.values(itemsById).filter((i) => !i.deleted), [itemsById]);
  const daysWithItems = useMemo(() => new Set(all.filter((i) => i.status === 'open').map((i) => i.due)), [all]);
  const overdue = day === today ? all.filter((i) => i.status === 'open' && i.due && i.due < today && i.kind !== 'study' && matches(filter, i)) : [];
  const dayItems = all.filter((i) => i.due === day && matches(filter, i))
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  const dayLessons = filter === 'all' ? lessons.filter((l) => l.date === day) : [];

  // Unterricht und Einträge auf einer Zeitleiste; Einträge ohne Uhrzeit hängen an der Stunde ihres Fachs
  type Row = { kind: 'lesson'; lesson: Lesson; attached: Item[] } | { kind: 'item'; item: Item };
  const rows: Row[] = [];
  const used = new Set<string>();
  for (const l of dayLessons) {
    const attached = dayItems.filter((i) => !i.time && i.subject && i.subject === l.subject && !used.has(i.id));
    attached.forEach((i) => used.add(i.id));
    rows.push({ kind: 'lesson', lesson: l, attached });
  }
  for (const i of dayItems) if (!used.has(i.id)) rows.push({ kind: 'item', item: i });
  const timeOf = (r: Row) => (r.kind === 'lesson' ? r.lesson.start : r.item.time ?? (r.item.kind === 'study' ? '16:00' : '00:00'));
  rows.sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

  async function toggle(i: Item) {
    const done = i.status !== 'done';
    try {
      await patchItem(i.id, { status: done ? 'done' : 'open' });
      if (done) { setJustDone(i.id); setTimeout(() => setJustDone(null), 1400); }
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  const itemCard = (i: Item) => {
    const done = i.status === 'done';
    const isOpen = open === i.id;
    return (
      <div key={i.id} className={`t-card ${i.kind}${done ? ' done' : ''}`}>
        <div className="t-head">
          <button type="button" className={done ? 'check on' : 'check'} aria-label={done ? 'Als offen markieren' : 'Erledigt'} onClick={() => void toggle(i)} disabled={i.id.startsWith('local-')}>
            {done && <Icon name="check" size={15} stroke={3.2} />}
            {justDone === i.id && <Confetti />}
          </button>
          <button type="button" className="t-title" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : i.id)}>
            {i.title}
          </button>
          {busy.includes(i.id) && i.status === 'open' && <span className="pill blue">löst …</span>}
          {i.attachments.some((a) => a.caption?.startsWith('Lösung')) && <span className="pill green">im Heft</span>}
          {i.time && <span className="small muted">{i.time}</span>}
        </div>
        {i.detail && <span className="t-detail">{i.detail}</span>}
        {isOpen && (
          <div className="t-extra">
            <span className="small muted">{KIND_LABEL[i.kind]}{i.due ? ` · ${formatDateDe(i.due)}` : ''}</span>
            {i.material && <span className="small"><strong>Stoff:</strong> {i.material}</span>}
            {i.notes && !i.notes.startsWith('__') && <span className="small">{i.notes}</span>}
            {i.attachments.map((a) => <AuthImage key={a.id} id={a.id} alt={a.caption} onOpen={setLightbox} />)}
            <button type="button" className="link danger small" style={{ alignSelf: 'flex-start' }}
              onClick={() => deleteItem(i.id).catch((err: Error) => showToast(err.message, true))}>Löschen</button>
          </div>
        )}
      </div>
    );
  };

  const kw = isoWeek(monday);
  const closePlanning = useCallback(() => setPlanning(false), []);

  return (
    <div className="page">
      <Sky clouds={false} />
      <div className="page-inner">
        <header className="page-head rise">
          <h1 className="display">Planer</h1>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Vorige Woche" onClick={() => setDay(addDays(day, -7))}><Icon name="back" size={18} /></button>
            <button type="button" className="btn secondary" style={{ minHeight: 40 }} onClick={() => setDay(today)}>KW {kw}</button>
            <button type="button" className="icon-btn" aria-label="Nächste Woche" onClick={() => setDay(addDays(day, 7))}><Icon name="chevron" size={18} /></button>
          </div>
        </header>

        <div className="week rise" role="tablist" aria-label="Woche">
          {week.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={d === day} className={`${d === day ? 'active' : ''}${d === today ? ' today' : ''}`} onClick={() => setDay(d)}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{WD[weekdayOf(d)]}</span>
              <span className="n">{Number(d.slice(8))}</span>
              <span className={daysWithItems.has(d) ? 'd on' : 'd'} />
            </button>
          ))}
        </div>

        <button type="button" className="plan-cta rise" onClick={() => setPlanning(true)}>
          <span className="icon-tile pink"><Icon name="sparkle" size={20} /></span>
          <span className="plan-text">
            <strong>Woche planen</strong>
            <span className="small muted">Stella verteilt Lernen und HÜs auf deine freien Zeiten</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>

        <div className="segmented rise" role="tablist" aria-label="Filter">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>

        {overdue.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="eyebrow" style={{ color: 'var(--pink-text)' }}>Überfällig</span>
            <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{overdue.map(itemCard)}</div>
          </section>
        )}

        <span className="eyebrow">{formatDateDe(day, today)}{formatDateDe(day, today) !== formatDateDe(day) ? ` · ${formatDateDe(day)}` : ''}</span>

        {rows.length === 0 ? (
          <div className="empty">
            <span className="icon-tile blue"><Icon name="cloud" size={26} /></span>
            <p>Nichts geplant. Sag Stella im Chat, was ansteht.</p>
          </div>
        ) : (
          <div className="timeline stagger" key={day + filter}>
            {rows.map((r, idx) => {
              if (r.kind === 'lesson') {
                const off = r.lesson.status === 'cancelled';
                return (
                  <div key={`l${idx}`} className="t-row">
                    <span className="t-time">{r.lesson.start}</span>
                    <span className={`t-dot${r.attached.length ? ' pink' : ''}`} />
                    <div className={`t-card lesson${off ? ' off' : ''}`}>
                      <div className="t-head">
                        <span className="t-title" style={off ? { color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>{r.lesson.subject ?? r.lesson.code}</span>
                        {off ? <span className="pill pink">entfällt</span> : r.lesson.info && <span className="small muted">{r.lesson.info}</span>}
                      </div>
                      {r.attached.map(itemCard)}
                    </div>
                  </div>
                );
              }
              const i = r.item;
              return (
                <div key={i.id} className="t-row">
                  <span className="t-time">{i.time ?? ''}</span>
                  <span className={`t-dot ${i.status === 'done' ? 'green' : i.kind === 'exam' || i.kind === 'homework' ? 'pink' : 'blue'}`} />
                  {itemCard(i)}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
      {planning && <WeekPlanSheet today={today} onClose={closePlanning} />}
    </div>
  );
}
