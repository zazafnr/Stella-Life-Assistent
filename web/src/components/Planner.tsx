import { useEffect, useMemo, useState } from 'react';
import { addDays, formatDateDe, todayIn, type Item } from '@stella/shared';
import { api, deleteItem, patchItem, useStore } from '../store.ts';
import { AuthImage, Lightbox } from './Rich.tsx';

const ICON: Record<string, string> = { homework: '📚', exam: '📝', assignment: '📌', event: '📅', todo: '☑️', study: '🧠' };
const KIND_LABEL: Record<string, string> = {
  homework: 'Hausübung', exam: 'Test / Schularbeit', assignment: 'Abgabe', event: 'Termin', todo: 'To-do', study: 'Lerneinheit',
};

type Filter = 'all' | 'school' | 'exams' | 'study' | 'timetable';
const FILTERS: [Filter, string][] = [['all', 'Alles'], ['school', 'HÜs & Abgaben'], ['exams', 'Tests'], ['study', 'Lernplan'], ['timetable', 'Stundenplan']];

interface Lesson { date: string; start: string; end: string; subject: string | null; code: string | null; status: string; info: string | null }

function Timetable({ today }: { today: string }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Lesson[]>(`/api/timetable?from=${today}&to=${addDays(today, 6)}`).then(setLessons).catch((err: Error) => setError(err.message));
  }, [today]);
  if (error) return <div className="error-bar">{error}</div>;
  if (!lessons) return null;
  if (!lessons.length) return <div className="empty"><div className="empty-star">✦</div><p>Kein Stundenplan. Verbinde WebUntis unter Einstellungen.</p></div>;
  const days = [...new Set(lessons.map((l) => l.date))];
  return (
    <>
      {days.map((d) => (
        <section key={d}>
          <h2>{formatDateDe(d, today)}</h2>
          <div className="card lessons">
            {lessons.filter((l) => l.date === d).map((l, i) => (
              <div key={i} className={`lesson ${l.status}`}>
                <span className="lesson-time">{l.start}</span>
                <span>{l.subject ?? l.code}{l.status === 'cancelled' ? ' – entfällt' : ''}{l.info ? <span className="muted"> · {l.info}</span> : null}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
const matches = (f: Filter, i: Item) =>
  f === 'all' || (f === 'school' && (i.kind === 'homework' || i.kind === 'assignment'))
  || (f === 'exams' && i.kind === 'exam') || (f === 'study' && i.kind === 'study');

export function Planner() {
  const itemsById = useStore((s) => s.items);
  const tz = useStore((s) => s.me?.timeZone ?? 'Europe/Vienna');
  const [filter, setFilter] = useState<Filter>('all');
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState('');
  const today = todayIn(tz);

  const { overdue, groups, done } = useMemo(() => {
    const all = Object.values(itemsById).filter((i) => !i.deleted && matches(filter, i))
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '').localeCompare(b.time ?? ''));
    const openItems = all.filter((i) => i.status === 'open');
    const groups = new Map<string, Item[]>();
    for (const i of openItems.filter((i) => !i.due || i.due >= today)) {
      const key = i.due ?? '';
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    return {
      overdue: openItems.filter((i) => i.due && i.due < today && i.kind !== 'study'),
      groups: [...groups],
      done: all.filter((i) => i.status === 'done').reverse().slice(0, 30),
    };
  }, [itemsById, filter, today]);

  const act = (p: Promise<unknown>) => p.catch((err: Error) => setError(err.message));

  const row = (i: Item) => {
    const local = i.id.startsWith('local-');
    return (
      <li key={i.id} className={`item ${i.status} kind-${i.kind}`}>
        <div className="item-main">
          <button
            type="button" className="check" disabled={local} aria-label="Erledigt"
            onClick={() => act(patchItem(i.id, { status: i.status === 'done' ? 'open' : 'done' }))}
          >{i.status === 'done' ? '✓' : ''}</button>
          <button type="button" className="item-text" onClick={() => setOpen(open === i.id ? null : i.id)}>
            <span className="item-title">{ICON[i.kind]} {i.title}{local && ' ⏳'}</span>
            {i.detail && <span className="item-detail">{i.detail}</span>}
          </button>
          {i.time && <span className="item-time">{i.time}</span>}
          {i.attachments.length > 0 && <span className="item-badge">📸</span>}
        </div>
        {open === i.id && (
          <div className="item-extra">
            <div className="muted">{KIND_LABEL[i.kind]}{i.due ? ` · ${formatDateDe(i.due)}` : ''}</div>
            {i.material && <p><strong>Stoff:</strong> {i.material}</p>}
            {i.notes && <p>{i.notes}</p>}
            {i.attachments.map((a) => <AuthImage key={a.id} id={a.id} alt={a.caption} onOpen={setLightbox} />)}
            {!local && (
              <button type="button" className="link danger" onClick={() => act(deleteItem(i.id))}>Löschen</button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Planer</h1>
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
      </header>
      {error && <div className="error-bar" onClick={() => setError('')}>{error}</div>}
      {filter === 'timetable' && <Timetable today={today} />}
      {filter !== 'timetable' && <>

      {overdue.length > 0 && (
        <section>
          <h2 className="overdue-title">Überfällig</h2>
          <ul className="items">{overdue.map(row)}</ul>
        </section>
      )}

      {groups.length === 0 && overdue.length === 0 && (
        <div className="empty"><div className="empty-star">✦</div><p>Nichts geplant. Schreib Stella im Chat, was ansteht.</p></div>
      )}

      {groups.map(([day, list]) => (
        <section key={day}>
          <h2>{day ? formatDateDe(day, today) : 'Ohne Datum'}{day && formatDateDe(day, today) !== formatDateDe(day) && (
            <span className="muted"> · {formatDateDe(day)}</span>)}</h2>
          <ul className="items">{list.map(row)}</ul>
        </section>
      ))}

      {done.length > 0 && (
        <section>
          <button type="button" className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Erledigte ausblenden' : `Erledigte anzeigen (${done.length})`}
          </button>
          {showDone && <ul className="items">{done.map(row)}</ul>}
        </section>
      )}
      </>}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
