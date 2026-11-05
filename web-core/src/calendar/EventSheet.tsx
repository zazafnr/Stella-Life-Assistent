import { useState, type FormEvent } from 'react';
import type { CalendarBlock } from '@stella/shared';
import { api, deleteItem, sync } from '../store.ts';
import { useT } from '../i18n.ts';
import { Sheet, showToast } from '../ui/Decor.tsx';
import { Icon } from '../ui/Icon.tsx';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export interface SheetDraft {
  /** bestehender Eintrag (Bearbeiten) oder leer (Neu) */
  block?: CalendarBlock;
  date: string;
  start: string;
  duration: number;
}

/** Termin anlegen oder ändern. Beides läuft über Aktionen mit Rückgängig (der Server protokolliert sie). */
export function EventSheet({ draft, onClose, onSaved }: { draft: SheetDraft; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const editing = !!draft.block?.itemId;
  const [title, setTitle] = useState(draft.block?.title ?? '');
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState(draft.start);
  const [duration, setDuration] = useState(draft.duration);
  const [location, setLocation] = useState(draft.block?.location ?? '');
  const [busy, setBusy] = useState(false);

  const undoable = (actionId: string | null, message: string) => {
    showToast(message, false, actionId ? {
      label: t('calendar.undo'),
      run: () => void api(`/api/actions/${actionId}/undo`, { method: 'POST' }).then(() => sync()).then(() => { showToast(t('calendar.undone')); onSaved(); }).catch((e: Error) => showToast(e.message, true)),
    } : undefined);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        const r = await api<{ actionId: string | null }>(`/api/calendar/items/${draft.block!.itemId}`, { method: 'PATCH', json: { title: title.trim(), due: date, time: start, duration, location } });
        undoable(r.actionId, t('calendar.updated'));
      } else {
        const r = await api<{ actionId: string | null }>('/api/calendar/items', { method: 'POST', json: { title: title.trim(), due: date, time: start, duration, location } });
        undoable(r.actionId, t('calendar.created'));
      }
      await sync();
      onSaved();
      onClose();
    } catch (err) {
      showToast((err as Error).message, true);
    } finally { setBusy(false); }
  }

  return (
    <Sheet title={editing ? t('calendar.sheet.edit') : t('calendar.sheet.new')} onClose={onClose}>
      <form onSubmit={submit} className="cal-form">
        <label className="field">{t('calendar.field.title')}<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={200} /></label>
        <div className="cal-form-row">
          <label className="field">{t('calendar.field.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="field">{t('calendar.field.start')}<input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className="field">{t('calendar.field.duration')}
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{t('calendar.duration', { count: d })}</option>)}
            </select>
          </label>
        </div>
        <label className="field">{t('calendar.field.location')}<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></label>
        <div className="cal-form-actions">
          {editing && (
            <button type="button" className="btn secondary danger" onClick={() => void deleteItem(draft.block!.itemId!).then(() => { onSaved(); onClose(); }).catch((e: Error) => showToast(e.message, true))}>
              <Icon name="trash" size={15} /> {t('calendar.delete')}
            </button>
          )}
          <button type="submit" className="btn" disabled={busy || !title.trim()}>{t('calendar.save')}</button>
        </div>
      </form>
    </Sheet>
  );
}
