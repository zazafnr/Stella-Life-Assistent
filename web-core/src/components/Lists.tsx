import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { StellaList } from '@stella/shared';
import { api } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { Sheet, showToast } from '../ui/Decor.tsx';
import { useT } from '../i18n.ts';

/** Die Einkaufsliste (und weitere Listen) zum Abhaken. Änderungen sind sofort da, Stella ergänzt im Chat („schreib Milch auf die Einkaufsliste“). */
export function ListsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [lists, setLists] = useState<StellaList[] | null>(null);
  const [text, setText] = useState('');

  const load = useCallback(() => {
    api<{ lists: StellaList[] }>('/api/lists').then((r) => setLists(r.lists)).catch((err: Error) => showToast(err.message, true));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const replace = (list: StellaList) => setLists((ls) => (ls ?? []).map((l) => (l.id === list.id ? list : l)));
  const shopping = lists?.[0];

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!shopping || !text.trim()) return;
    const value = text;
    setText('');
    try {
      replace((await api<{ list: StellaList }>(`/api/lists/${shopping.id}/items`, { method: 'POST', json: { text: value } })).list);
    } catch (err) { showToast((err as Error).message, true); setText(value); }
  }

  async function toggle(id: string, done: boolean) {
    // sofort abhaken, der Server bestätigt gleich danach
    setLists((ls) => (ls ?? []).map((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, done } : i)) })));
    try { replace((await api<{ list: StellaList }>(`/api/list-items/${id}`, { method: 'PATCH', json: { done } })).list); } catch (err) { showToast((err as Error).message, true); load(); }
  }

  async function remove(id: string) {
    try { replace((await api<{ list: StellaList }>(`/api/list-items/${id}`, { method: 'DELETE' })).list); } catch (err) { showToast((err as Error).message, true); }
  }

  async function tidy() {
    if (!shopping) return;
    try { replace((await api<{ list: StellaList }>(`/api/lists/${shopping.id}/clear-done`, { method: 'POST' })).list); } catch (err) { showToast((err as Error).message, true); }
  }

  const open = shopping?.items.filter((i) => !i.done) ?? [];
  const done = shopping?.items.filter((i) => i.done) ?? [];

  return (
    <Sheet title={t('today.shopping')} onClose={onClose}>
      <form className="row" style={{ gap: 8, marginBottom: 12 }} onSubmit={(e) => void add(e)}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('ui.what.do.you.need')} aria-label={t('ui.new.item')} />
        <button type="submit" className="btn" disabled={!text.trim()}><Icon name="plus" size={16} />{t('ui.add')}</button>
      </form>
      {!lists && <p className="muted">{t('ui.one.moment')}</p>}
      {shopping && open.length === 0 && done.length === 0 && (
        <div className="empty"><span className="icon-tile blue"><Icon name="plus" size={26} /></span><p>{t('ui.nothing.on.the.list')}</p></div>
      )}
      <ul className="shop-list">
        {open.map((i) => (
          <li key={i.id} className="shop-row">
            <button type="button" className="shop-check" aria-label={t('ui.check.off', { text: i.text })} onClick={() => void toggle(i.id, true)} />
            <span className="grow">{i.text}{i.qty && <span className="muted small"> · {i.qty}</span>}</span>
            <button type="button" className="icon-btn danger" aria-label={t('ui.delete', { text: i.text })} onClick={() => void remove(i.id)}><Icon name="close" size={16} /></button>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', margin: '14px 0 6px' }}>
            <span className="eyebrow">Erledigt ({done.length})</span>
            <button type="button" className="link small" onClick={() => void tidy()}>{t('ui.tidy.up')}</button>
          </div>
          <ul className="shop-list">
            {done.map((i) => (
              <li key={i.id} className="shop-row done">
                <button type="button" className="shop-check on" aria-label={t('ui.reopen', { text: i.text })} onClick={() => void toggle(i.id, false)}><Icon name="check" size={14} stroke={3} /></button>
                <span className="grow">{i.text}{i.qty && <span className="muted small"> · {i.qty}</span>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
