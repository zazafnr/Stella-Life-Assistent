// Drei Bereiche, die Stella zum Assistenten machen – und dich die Kontrolle behalten lassen:
// was sie selbst darf, was sie über dich weiß und was sie getan hat.

import { useEffect, useState } from 'react';
import type { ActionEntry, Memory, MemoryCategory, PermissionLevel } from '@stella/shared';
import { api, decideAction, refreshMe } from '../../store.ts';
import { Icon } from '../../ui/Icon.tsx';
import { showToast } from '../../ui/Decor.tsx';

const LEVEL_LABEL: Record<PermissionLevel, string> = { auto: 'Einfach machen', notify: 'Machen & Bescheid sagen', ask: 'Vorher fragen', never: 'Nie' };
const LEVEL_SHORT: Record<PermissionLevel, string> = { auto: 'Selbst', notify: 'Melden', ask: 'Fragen', never: 'Nie' };

interface PermissionRow { group: string; label: string; help: string; levels: PermissionLevel[]; level: PermissionLevel }

export function Permissions() {
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  useEffect(() => { api<PermissionRow[]>('/api/permissions').then(setRows).catch(() => setRows([])); }, []);

  async function set(group: string, level: PermissionLevel) {
    setRows((r) => r?.map((x) => (x.group === group ? { ...x, level } : x)) ?? null);
    try {
      await api('/api/settings', { method: 'PATCH', json: { permissions: { [group]: level } } });
      await refreshMe();
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  if (!rows) return <p className="muted">Lädt …</p>;
  return (
    <div className="perm-list">
      <p className="muted">Gilt für alles, was Stella <strong>von sich aus</strong> tut. Worum du sie im Chat bittest, macht sie – außer der Bereich steht auf „Nie“. Alles Erledigte kannst du 7 Tage lang rückgängig machen.</p>
      {rows.map((r) => (
        <div key={r.group} className="perm-row">
          <div className="perm-text"><span className="list-title">{r.label}</span><span className="list-sub">{r.help}</span></div>
          <div className="segmented small" role="radiogroup" aria-label={r.label}>
            {r.levels.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={r.level === l} title={LEVEL_LABEL[l]}
                className={r.level === l ? 'active' : ''} onClick={() => r.level !== l && void set(r.group, l)}>{LEVEL_SHORT[l]}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_ORDER: MemoryCategory[] = ['person', 'routine', 'school', 'preference', 'goal', 'health', 'other'];
const WD = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function MemoryView() {
  const [data, setData] = useState<{ categories: Record<MemoryCategory, string>; memories: Memory[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState<{ category: MemoryCategory; text: string }>({ category: 'other', text: '' });

  const load = () => api<{ categories: Record<MemoryCategory, string>; memories: Memory[] }>('/api/memories').then(setData).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function save(id: string) {
    try {
      await api(`/api/memories/${id}`, { method: 'PATCH', json: { text: draft } });
      setEditing(null);
      await load();
    } catch (err) { showToast((err as Error).message, true); }
  }
  async function remove(m: Memory) {
    try {
      await api(`/api/memories/${m.id}`, { method: 'DELETE' });
      setData((d) => d && { ...d, memories: d.memories.filter((x) => x.id !== m.id) });
      showToast('Vergessen');
    } catch (err) { showToast((err as Error).message, true); }
  }
  async function add() {
    if (!adding.text.trim()) return;
    try {
      await api('/api/memories', { method: 'POST', json: adding });
      setAdding({ ...adding, text: '' });
      await load();
    } catch (err) { showToast((err as Error).message, true); }
  }

  if (!data) return <p className="muted">Lädt …</p>;
  return (
    <div className="memory-view">
      <p className="muted">Stella lernt aus euren Gesprächen selbst dazu und nutzt das, um besser zu planen und mitzudenken. Hier siehst du alles – ändern oder löschen geht jederzeit, auch im Chat mit „vergiss …“.</p>
      {data.memories.length === 0 && <p className="hint">Noch nichts gemerkt. Erzähl Stella einfach von dir – z. B. wann du Training hast oder welches Fach dir schwerfällt.</p>}
      {CATEGORY_ORDER.filter((c) => data.memories.some((m) => m.category === c)).map((c) => (
        <section key={c} className="memory-group">
          <h3 className="eyebrow">{data.categories[c]}</h3>
          <div className="list">
            {data.memories.filter((m) => m.category === c).map((m) => (
              <div key={m.id} className="list-row memory-row">
                {editing === m.id ? (
                  <form className="grow row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void save(m.id); }}>
                    <input autoFocus className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button type="submit" className="btn small">Speichern</button>
                  </form>
                ) : (
                  <>
                    <span className="grow">
                      <span className="list-title">{m.text}</span>
                      <span className="list-sub">
                        {m.schedule && `${m.schedule.days.map((d) => WD[d]).join('/')} ${m.schedule.start}–${m.schedule.end} · `}
                        {m.source === 'user' ? 'von dir' : 'selbst gelernt'}
                      </span>
                    </span>
                    <button type="button" className="icon-btn small" aria-label="Ändern" onClick={() => { setEditing(m.id); setDraft(m.text); }}><Icon name="pen" size={16} /></button>
                    <button type="button" className="icon-btn small danger" aria-label="Vergessen" onClick={() => void remove(m)}><Icon name="trash" size={16} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <form className="row memory-add" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <select value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value as MemoryCategory })} aria-label="Bereich">
          {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{data.categories[c]}</option>)}
        </select>
        <input className="grow" placeholder="Stella soll sich merken …" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} />
        <button type="submit" className="btn small" disabled={!adding.text.trim()}>Merken</button>
      </form>
    </div>
  );
}

const STATUS_LABEL: Record<ActionEntry['status'], string> = {
  done: 'erledigt', proposed: 'wartet auf dich', rejected: 'abgelehnt', undone: 'rückgängig', failed: 'fehlgeschlagen',
};

export function ActionLog() {
  const [list, setList] = useState<ActionEntry[] | null>(null);
  const load = () => api<ActionEntry[]>('/api/actions?limit=150').then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, []);

  async function run(id: string, d: 'approve' | 'reject' | 'undo') {
    try {
      await decideAction(id, d);
      await load();
    } catch (err) { showToast((err as Error).message, true); }
  }

  if (!list) return <p className="muted">Lädt …</p>;
  if (!list.length) return <p className="muted">Stella hat noch nichts für dich erledigt.</p>;
  let lastDay = '';
  return (
    <div className="action-log">
      {list.map((a) => {
        const day = new Date(a.createdAt).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
        const head = day !== lastDay;
        lastDay = day;
        return (
          <div key={a.id}>
            {head && <h3 className="eyebrow" style={{ margin: '14px 4px 6px' }}>{day}</h3>}
            <div className={`log-row ${a.status}`}>
              <span className="log-time">{new Date(a.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="grow">
                <span className="list-title">{a.summary.charAt(0).toUpperCase() + a.summary.slice(1)}</span>
                <span className="list-sub">{STATUS_LABEL[a.status]}{a.source === 'auto' ? ' · von selbst' : ''}</span>
              </span>
              {a.status === 'proposed' && (
                <span className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn small" onClick={() => void run(a.id, 'approve')}>Ja</button>
                  <button type="button" className="btn small secondary" onClick={() => void run(a.id, 'reject')}>Nein</button>
                </span>
              )}
              {a.canUndo && <button type="button" className="link small" onClick={() => void run(a.id, 'undo')}><Icon name="undo" size={14} /> Rückgängig</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
