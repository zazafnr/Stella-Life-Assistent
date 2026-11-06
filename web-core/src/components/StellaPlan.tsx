import { useCallback, useEffect, useState } from 'react';
import type { StellaPlanControl, StellaPlanEntry } from '@stella/shared';
import { api, decideAction, sync } from '../store.ts';
import type { Tab } from '../nav.ts';
import { Icon } from '../ui/Icon.tsx';
import { Switch, showToast } from '../ui/Decor.tsx';
import { useT } from '../i18n.ts';

interface PlanResponse { entries: StellaPlanEntry[]; soon: StellaPlanEntry[] }

const GROUPS: { id: StellaPlanEntry['group']; title: string; hint: string }[] = [
  { id: 'week', title: 'plan.group.week', hint: 'plan.group.week.hint' },
  { id: 'regular', title: 'plan.group.regular', hint: 'plan.group.regular.hint' },
  { id: 'longterm', title: 'plan.group.longterm', hint: 'plan.group.longterm.hint' },
];

/** Karte auf „Heute“: die nächsten drei Dinge, die Stella vorhat */
export function StellaPlanCard({ go }: { go: (tab: Tab) => void }) {
  const t = useT();
  const [soon, setSoon] = useState<StellaPlanEntry[] | null>(null);
  useEffect(() => {
    api<PlanResponse>('/api/stella/plan').then((r) => setSoon(r.soon)).catch(() => setSoon([]));
  }, []);
  return (
    <section className="card plan-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('ui.stella.this.week')}</h2>
        <button type="button" className="link small" onClick={() => go('plan')}>{t('ui.view.all')}</button>
      </div>
      {soon && soon.length === 0 && <p className="muted small" style={{ margin: '8px 0 0' }}>{t('ui.nothing.is.planned.right')}</p>}
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
  const t = useT();
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
            <span className="small muted">{c.on ? c.label : t('settings.weatherAnim.off')}</span>
            <Switch label={`${entry.title}: ${c.label}`} checked={c.on} onChange={(on) => void change(entry, { on }, t(on ? 'plan.on' : 'plan.off', { title: entry.title }))} />
          </label>
        );
      case 'time':
        return (
          <label key={i} className="plan-time">
            <span className="small muted">{c.label}</span>
            <input type="time" value={c.value} aria-label={`${entry.title}: ${c.label}`}
              onChange={(e) => { if (e.target.value) void change(entry, { time: e.target.value }, t('ui.text', { title: entry.title, time: e.target.value })); }} />
          </label>
        );
      case 'remove':
        return (
          <button key={i} type="button" className="icon-btn danger" aria-label={`${entry.title}: ${c.label}`}
            onClick={() => { if (window.confirm(t('plan.confirmRemove', { title: entry.title }))) void change(entry, { remove: true }, t('ui.removed', { title: entry.title })); }}>
            <Icon name="trash" size={16} />
          </button>
        );
      case 'decision':
        return (
          <span key={i} className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void decide(entry, 'approve')}>{t('common.yes')}</button>
            <button type="button" className="btn secondary" onClick={() => void decide(entry, 'reject')}>{t('common.no')}</button>
          </span>
        );
      case 'link':
        return <button key={i} type="button" className="link small" onClick={() => go(c.target === 'permissions' ? 'settings' : c.target)}>{c.label}</button>;
    }
  }

  return (
    <div className="page">
      <div className="page-inner narrow">
        <p className="muted" style={{ margin: 0 }}>{t('ui.everything.stella.does.on')}</p>

        {!data && <p className="muted">{t('ui.one.moment')}</p>}
        {data && GROUPS.map((g) => {
          const entries = data.entries.filter((e) => e.group === g.id);
          if (g.id !== 'regular' && !entries.length) {
            return g.id === 'week' ? (
              <section key={g.id} className="card"><h2>{t(g.title)}</h2><p className="muted small" style={{ margin: 0 }}>{t('ui.stella.has.nothing.specific')}</p></section>
            ) : null;
          }
          return (
            <section key={g.id} className="card">
              <h2>{t(g.title)}</h2>
              <p className="muted small" style={{ margin: '0 0 8px' }}>{t(g.hint)}</p>
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
          <button type="button" className="btn ghost" onClick={() => void undoLast()}><Icon name="undo" size={15} />{t('telegram.undo')}</button>
        </div>
      )}
    </div>
  );
}
