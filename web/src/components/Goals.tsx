import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDateDe, todayIn, type GoalProgress } from '@stella/shared';
import { api, useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { Sheet, Sky, showToast } from '../ui/Decor.tsx';

const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
/** „3×“ bei Einheiten, sonst „12 km“ */
export const amount = (g: Pick<GoalProgress, 'unit'>, v: number) => (g.unit === 'x' ? `${num(v)}×` : `${num(v)} ${g.unit}`);
export function rhythm(g: Pick<GoalProgress, 'cadence' | 'target' | 'unit'>): string {
  if (g.cadence === 'daily') return 'täglich';
  const n = /^weekly:(\d+)$/.exec(g.cadence)?.[1];
  return n ? `${n}× pro Woche` : `${num(g.target)} ${g.unit} pro Woche`;
}

/** Fortschritt dieser Woche: ein schlichter Balken, keine Punkte, keine Serien */
export function WeekBar({ goal }: { goal: GoalProgress }) {
  const share = goal.weekTarget > 0 ? Math.min(1, goal.weekValue / goal.weekTarget) : 0;
  return (
    <div>
      <div className="progress goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal.weekTarget} aria-valuenow={Math.min(goal.weekValue, goal.weekTarget)}
        aria-label={`${goal.title}: ${amount(goal, goal.weekValue)} von ${amount(goal, goal.weekTarget)} diese Woche`}>
        <div style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/** Verlauf der letzten 8 Wochen als kleine Linie mit gestrichelter Ziellinie */
function Trend({ goal }: { goal: GoalProgress }) {
  const w = 160, h = 34, pad = 4;
  const max = Math.max(goal.weekTarget, ...goal.history, 1);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (goal.history.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const line = goal.history.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="goal-trend" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
      aria-label={`Verlauf der letzten 8 Wochen: ${goal.history.map((v) => amount(goal, v)).join(', ')}`}>
      <line x1={pad} x2={w - pad} y1={y(goal.weekTarget)} y2={y(goal.weekTarget)} stroke="currentColor" strokeOpacity=".28" strokeDasharray="3 3" />
      <path d={line} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(goal.history.length - 1)} cy={y(goal.history.at(-1) ?? 0)} r="3" fill="var(--blue)" />
    </svg>
  );
}

type Draft = { title: string; why: string; kind: 'weekly' | 'daily' | 'amount'; count: string; unit: string; minutes: string; day: string; time: string };
const EMPTY: Draft = { title: '', why: '', kind: 'weekly', count: '3', unit: 'km', minutes: '', day: '', time: '' };
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function toDraft(g: GoalProgress): Draft {
  const weekly = /^weekly:(\d+)$/.exec(g.cadence)?.[1];
  const [day, time] = g.checkIn ? (/^[A-Z][a-z] /.test(g.checkIn) ? [g.checkIn.slice(0, 2), g.checkIn.slice(3)] : ['', g.checkIn]) : ['', ''];
  return {
    title: g.title, why: g.why ?? '', kind: g.cadence === 'daily' ? 'daily' : weekly ? 'weekly' : 'amount',
    count: String(weekly ?? g.target), unit: g.unit === 'x' ? 'km' : g.unit, minutes: g.minutes ? String(g.minutes) : '', day: day!, time: time!,
  };
}

function payload(d: Draft) {
  const n = Math.max(1, Number(d.count.replace(',', '.')) || 1);
  const base = { title: d.title, why: d.why || null, minutes: d.minutes ? Number(d.minutes) : null, checkIn: d.time ? `${d.day ? `${d.day} ` : ''}${d.time}` : null };
  if (d.kind === 'daily') return { ...base, cadence: 'daily', target: 1, unit: 'x', metric: 'Einheiten' };
  if (d.kind === 'weekly') return { ...base, cadence: `weekly:${Math.round(n)}`, target: Math.round(n), unit: 'x', metric: 'Einheiten' };
  return { ...base, cadence: 'custom', target: n, unit: d.unit.trim() || 'x', metric: d.unit.trim() || 'Einheiten' };
}

function GoalForm({ goal, onSaved, onClose }: { goal?: GoalProgress; onSaved: (g: GoalProgress) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(goal ? toDraft(goal) : EMPTY);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = goal
        ? await api<{ goal: GoalProgress }>(`/api/goals/${goal.id}`, { method: 'PATCH', json: payload(d) })
        : await api<{ goal: GoalProgress }>('/api/goals', { method: 'POST', json: payload(d) });
      onSaved(res.goal);
      onClose();
    } catch (err) { showToast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Sheet title={goal ? 'Ziel bearbeiten' : 'Neues Ziel'} onClose={onClose}>
      <form className="goal-form" onSubmit={(e) => void save(e)}>
        <label className="field">Was möchtest du erreichen?
          <input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Laufen gehen" required autoFocus maxLength={80} />
        </label>
        <div className="field">Wie oft?
          <div className="segmented" role="group" aria-label="Rhythmus">
            {([['weekly', 'Mal pro Woche'], ['daily', 'Täglich'], ['amount', 'Menge pro Woche']] as const).map(([k, label]) => (
              <button key={k} type="button" className={d.kind === k ? 'active' : ''} aria-pressed={d.kind === k} onClick={() => set('kind', k)}>{label}</button>
            ))}
          </div>
        </div>
        {d.kind !== 'daily' && (
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow">{d.kind === 'weekly' ? 'Wie viele Einheiten?' : 'Wie viel pro Woche?'}
              <input inputMode="decimal" value={d.count} onChange={(e) => set('count', e.target.value)} required />
            </label>
            {d.kind === 'amount' && (
              <label className="field grow">Einheit
                <input value={d.unit} onChange={(e) => set('unit', e.target.value)} placeholder="km, Seiten, Minuten …" maxLength={12} />
              </label>
            )}
          </div>
        )}
        <label className="field">Wie lange dauert eine Einheit? <span className="muted small">(optional – dann plant Stella Zeit dafür ein)</span>
          <input inputMode="numeric" value={d.minutes} onChange={(e) => set('minutes', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Minuten, z. B. 45" />
        </label>
        <div className="field">Stella erinnert mich <span className="muted small">(optional)</span>
          <div className="row" style={{ gap: 10 }}>
            <select value={d.day} onChange={(e) => set('day', e.target.value)} aria-label="Wochentag">
              <option value="">Jeden Tag</option>
              {DAYS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input type="time" value={d.time} onChange={(e) => set('time', e.target.value)} aria-label="Uhrzeit" />
          </div>
        </div>
        <label className="field">Warum ist dir das wichtig? <span className="muted small">(optional)</span>
          <input value={d.why} onChange={(e) => set('why', e.target.value)} placeholder="z. B. fitter werden" maxLength={200} />
        </label>
        <button type="submit" className="btn block" disabled={busy || !d.title.trim()}>{goal ? 'Speichern' : 'Ziel anlegen'}</button>
      </form>
    </Sheet>
  );
}

function LogSheet({ goal, onSaved, onClose }: { goal: GoalProgress; onSaved: (g: GoalProgress) => void; onClose: () => void }) {
  const [value, setValue] = useState(goal.unit === 'x' ? '1' : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved((await api<{ goal: GoalProgress }>(`/api/goals/${goal.id}/log`, { method: 'POST', json: { value, note: note || null } })).goal);
      onClose();
    } catch (err) { showToast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Sheet title={goal.title} onClose={onClose}>
      <form className="goal-form" onSubmit={(e) => void save(e)}>
        <label className="field">{goal.unit === 'x' ? 'Wie viele Einheiten?' : `Wie viel (${goal.unit})?`}
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
        </label>
        <label className="field">Notiz <span className="muted small">(optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Runde um den See" maxLength={300} />
        </label>
        <button type="submit" className="btn block" disabled={busy || !value.trim()}>Eintragen</button>
      </form>
    </Sheet>
  );
}

function GoalCard({ goal, tz, onChange, onRemoved }: { goal: GoalProgress; tz: string; onChange: (g: GoalProgress) => void; onRemoved: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const today = todayIn(tz);
  const paused = goal.status !== 'active';

  async function patch(json: Record<string, unknown>) {
    try { onChange((await api<{ goal: GoalProgress }>(`/api/goals/${goal.id}`, { method: 'PATCH', json })).goal); } catch (err) { showToast((err as Error).message, true); }
  }
  async function quick() {
    try { onChange((await api<{ goal: GoalProgress }>(`/api/goals/${goal.id}/log`, { method: 'POST', json: { value: 1 } })).goal); } catch (err) { showToast((err as Error).message, true); }
  }
  async function dropLog(id: string) {
    try {
      await api(`/api/goal-logs/${id}`, { method: 'DELETE' });
      onChange((await api<{ goals: GoalProgress[] }>('/api/goals')).goals.find((g) => g.id === goal.id) ?? goal);
    } catch (err) { showToast((err as Error).message, true); }
  }
  async function remove() {
    if (!window.confirm(`„${goal.title}“ mit allen Einträgen löschen?`)) return;
    try { await api(`/api/goals/${goal.id}`, { method: 'DELETE' }); onRemoved(goal.id); } catch (err) { showToast((err as Error).message, true); }
  }

  return (
    <article className={`card goal${paused ? ' paused' : ''}`}>
      <button type="button" className="goal-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="grow">
          <span className="goal-title">{goal.title}</span>
          <span className="muted small">{rhythm(goal)}{goal.minutes ? ` · ${goal.minutes} Min.` : ''}{goal.checkIn ? ` · Erinnerung ${goal.checkIn}` : ''}{paused ? ` · ${goal.status === 'done' ? 'erledigt' : 'pausiert'}` : ''}</span>
        </span>
        <Icon name="chevron" size={18} className={open ? 'chev open' : 'chev'} />
      </button>
      <div className="goal-stand">
        <span className="display goal-num">{amount(goal, goal.weekValue)}</span>
        <span className="muted"> von {amount(goal, goal.weekTarget)} diese Woche</span>
      </div>
      <WeekBar goal={goal} />
      {!paused && (
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          {goal.unit === 'x' && <button type="button" className="btn" onClick={() => void quick()}><Icon name="plus" size={16} />Einmal gemacht</button>}
          <button type="button" className={goal.unit === 'x' ? 'btn secondary' : 'btn'} onClick={() => setLogging(true)}>{goal.unit === 'x' ? 'Mehr eintragen' : <><Icon name="plus" size={16} />Eintragen</>}</button>
        </div>
      )}
      {open && (
        <div className="goal-more">
          {goal.why && <p className="muted small" style={{ margin: 0 }}>Warum: {goal.why}</p>}
          <div>
            <span className="eyebrow">Letzte 8 Wochen</span>
            <Trend goal={goal} />
          </div>
          {goal.recent.length > 0 && (
            <div>
              <span className="eyebrow">Zuletzt</span>
              <ul className="goal-log">
                {goal.recent.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <span className="grow"><strong>{amount(goal, r.value)}</strong> <span className="muted small">· {formatDateDe(r.date, today)}{r.note ? ` · ${r.note}` : ''}</span></span>
                    <button type="button" className="icon-btn danger" aria-label="Eintrag löschen" onClick={() => void dropLog(r.id)}><Icon name="close" size={14} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary" onClick={() => setEditing(true)}><Icon name="pen" size={15} />Bearbeiten</button>
            {goal.status === 'active'
              ? <button type="button" className="btn secondary" onClick={() => void patch({ status: 'paused' })}>Pausieren</button>
              : <button type="button" className="btn secondary" onClick={() => void patch({ status: 'active' })}>Fortsetzen</button>}
            {goal.status !== 'done' && <button type="button" className="btn secondary" onClick={() => void patch({ status: 'done' })}>Erreicht</button>}
            <button type="button" className="btn ghost danger" onClick={() => void remove()}><Icon name="trash" size={15} />Löschen</button>
          </div>
        </div>
      )}
      {editing && <GoalForm goal={goal} onSaved={onChange} onClose={() => setEditing(false)} />}
      {logging && <LogSheet goal={goal} onSaved={onChange} onClose={() => setLogging(false)} />}
    </article>
  );
}

/** Ziele: Fortschritt dieser Woche, Verlauf, Notizen. Stella legt Ziele auch im Chat an („ich will 3x pro Woche laufen gehen“). */
export function Goals() {
  const tz = useStore((s) => s.me?.timeZone) ?? 'Europe/Vienna';
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<{ goals: GoalProgress[] }>('/api/goals').then((r) => setGoals(r.goals)).catch((err: Error) => showToast(err.message, true));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const upsert = (g: GoalProgress) => setGoals((gs) => ((gs ?? []).some((x) => x.id === g.id) ? (gs ?? []).map((x) => (x.id === g.id ? g : x)) : [...(gs ?? []), g]));
  const active = goals?.filter((g) => g.status === 'active') ?? [];
  const rest = goals?.filter((g) => g.status !== 'active') ?? [];

  return (
    <div className="page">
      <Sky />
      <div className="page-inner stagger">
        <header className="page-head">
          <div>
            <h1 className="display">Ziele</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Kleine Schritte, die zählen. Ohne Druck.</p>
          </div>
          <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Neues Ziel</button>
        </header>

        {!goals && <p className="muted">⏳ Einen Moment …</p>}
        {goals && goals.length === 0 && (
          <section className="card empty">
            <span className="icon-tile blue"><Icon name="sparkle" size={26} /></span>
            <p>Noch keine Ziele. Sag Stella einfach im Chat: <em>„Ich will 3x pro Woche laufen gehen“</em> – oder leg hier eins an.</p>
            <button type="button" className="btn" onClick={() => setAdding(true)}>Erstes Ziel anlegen</button>
          </section>
        )}
        {active.map((g) => <GoalCard key={g.id} goal={g} tz={tz} onChange={upsert} onRemoved={(id) => setGoals((gs) => (gs ?? []).filter((x) => x.id !== id))} />)}
        {rest.length > 0 && <span className="eyebrow">Pausiert und erreicht</span>}
        {rest.map((g) => <GoalCard key={g.id} goal={g} tz={tz} onChange={upsert} onRemoved={(id) => setGoals((gs) => (gs ?? []).filter((x) => x.id !== id))} />)}
      </div>
      {adding && <GoalForm onSaved={upsert} onClose={() => setAdding(false)} />}
    </div>
  );
}
