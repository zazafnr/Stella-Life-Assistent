import { useCallback, useEffect, useState } from 'react';
import type { StellaPlanControl, StellaPlanEntry } from '@stella/shared';
import { api, decideAction, sync } from '../store.ts';
import type { Tab } from '../App.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Sky, Switch, showToast } from '../ui/Decor.tsx';

interface PlanResponse { entries: StellaPlanEntry[]; soon: StellaPlanEntry[] }

const GROUPS: { id: StellaPlanEntry['group']; title: string; hint: string }[] = [
  { id: 'week', title: 'Diese Woche', hint: 'Erinnerungen, Lerneinheiten und Vorschläge in den nächsten 7 Tagen' },
  { id: 'regular', title: 'Regelmäßig', hint: 'Was Stella immer wieder von selbst macht' },
  { id: 'longterm', title: 'Langfristig (Ziele)', hint: 'Deine Ziele und wann Stella nachfragt' },
];

/** Karte auf „Heute“: die nächsten drei Dinge, die Stella vorhat */
export function StellaPlanCard({ go }: { go: (tab: Tab) => void }) {
  const [soon, setSoon] = useState<StellaPlanEntry[] | null>(null);
  useEffect(() => {
    api<PlanResponse>('/api/stella/plan').then((r) => setSoon(r.soon)).catch(() => setSoon([]));
  }, []);
  return (
    <section className="card plan-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Stella diese Woche</h2>
        <button type="button" className="link small" onClick={() => go('plan')}>Alle ansehen</button>
      </div>
      {soon && soon.length === 0 && <p className="muted small" style={{ margin: '8px 0 0' }}>Gerade ist nichts geplant. Sag Stella z. B. „erinnere mich jeden Montag an den Müll“.</p>}
      <ul className="plan-soon">
        {(soon ?? []).map((e) => (
          <li key={e.id}><strong>{e.title}</strong><span className="muted small">{e.when}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** „Was Stella vorhat“: alles an einem Ort – jeder Punkt lässt sich ändern oder abstellen, Rückgängig inklusive */
export function StellaPlan({ back, go }: { back: () => void; go: (tab: Tab) => void }) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [undoable, setUndoable] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(() => {
    api<PlanResponse>('/api/stella/plan').then(setData).catch((err: Error) => showToast(err.message, true));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function change(entry: StellaPlanEntry, body: { on?: boolean; time?: string; remove?: boolean }, text: string) {
    try {
      const res = await api<PlanResponse & { actionId: string }>(`/api/stella/plan/${encodeURIComponent(entry.id)}`, { method: 'POST', json: body });
      setData({ entries: res.entries, soon: res.soon });
      setUndoable({ id: res.actionId, text });
      void sync();
    } catch (err) { showToast((err as Error).message, true); load(); }
  }

  async function undoLast() {
    if (!undoable) return;
    try { await decideAction(undoable.id, 'undo'); setUndoable(null); load(); } catch (err) { showToast((err as Error).message, true); }
  }

  async function decide(entry: StellaPlanEntry, decision: 'approve' | 'reject') {
    try { await decideAction(entry.id.slice('proposal:'.length), decision); load(); } catch (err) { showToast((err as Error).message, true); }
  }

  function control(entry: StellaPlanEntry, c: StellaPlanControl, i: number) {
    switch (c.type) {
      case 'toggle':
        return (
          <label key={i} className="plan-toggle">
            <span className="small muted">{c.on ? c.label : 'Aus'}</span>
            <Switch label={`${entry.title}: ${c.label}`} checked={c.on} onChange={(on) => void change(entry, { on }, `${entry.title}: ${on ? 'eingeschaltet' : 'ausgeschaltet'}`)} />
          </label>
        );
      case 'time':
        return (
          <label key={i} className="plan-time">
            <span className="small muted">{c.label}</span>
            <input type="time" value={c.value} aria-label={`${entry.title}: ${c.label}`}
              onChange={(e) => { if (e.target.value) void change(entry, { time: e.target.value }, `${entry.title}: ${e.target.value} Uhr`); }} />
          </label>
        );
      case 'remove':
        return (
          <button key={i} type="button" className="icon-btn danger" aria-label={`${entry.title}: ${c.label}`}
            onClick={() => { if (window.confirm(`„${entry.title}“ ${c.label.toLowerCase()}?`)) void change(entry, { remove: true }, `„${entry.title}“ entfernt`); }}>
            <Icon name="trash" size={16} />
          </button>
        );
      case 'decision':
        return (
          <span key={i} className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void decide(entry, 'approve')}>Ja</button>
            <button type="button" className="btn secondary" onClick={() => void decide(entry, 'reject')}>Nein</button>
          </span>
        );
      case 'link':
        return <button key={i} type="button" className="link small" onClick={() => go(c.target === 'permissions' ? 'settings' : c.target)}>{c.label}</button>;
    }
  }

  return (
    <div className="page">
      <Sky />
      <div className="page-inner stagger">
        <header className="page-head">
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Zurück" onClick={back}><Icon name="back" size={18} /></button>
            <h1 className="display">Was Stella vorhat</h1>
          </div>
        </header>
        <p className="muted" style={{ margin: 0 }}>Alles, was Stella von selbst tut. Jeder Punkt lässt sich ändern oder abstellen – und mit „Rückgängig“ wieder zurückholen.</p>

        {!data && <p className="muted">⏳ Einen Moment …</p>}
        {data && GROUPS.map((g) => {
          const entries = data.entries.filter((e) => e.group === g.id);
          if (g.id !== 'regular' && !entries.length) {
            return g.id === 'week' ? (
              <section key={g.id} className="card"><h2>{g.title}</h2><p className="muted small" style={{ margin: 0 }}>In den nächsten 7 Tagen hat Stella nichts Einzelnes vor.</p></section>
            ) : null;
          }
          return (
            <section key={g.id} className="card">
              <h2>{g.title}</h2>
              <p className="muted small" style={{ margin: '0 0 8px' }}>{g.hint}</p>
              <ul className="plan-list">
                {entries.map((e) => (
                  <li key={e.id} className={e.enabled ? 'plan-row' : 'plan-row off'}>
                    <div className="plan-main">
                      <strong>{e.title}</strong>
                      <span className="muted small">{e.when}</span>
                    </div>
                    <div className="plan-controls">{e.controls.map((c, i) => control(e, c, i))}</div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {undoable && (
        <div className="undo-bar" role="status">
          <span>{undoable.text}</span>
          <button type="button" className="btn ghost" onClick={() => void undoLast()}><Icon name="undo" size={15} />Rückgängig</button>
        </div>
      )}
    </div>
  );
}
