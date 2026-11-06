import { useState } from 'react';
import { decideAction, useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { showToast } from '../ui/Decor.tsx';
import { useT } from '../i18n.ts';

/** Unter einer Stella-Nachricht: Vorschlag mit Ja/Nein oder erledigte Aktion mit „Rückgängig“ */
export function ActionCard({ id }: { id: string }) {
  const t = useT();
  const action = useStore((s) => s.actions[id]);
  const [busy, setBusy] = useState(false);
  if (!action) return null;

  const run = async (decision: 'approve' | 'reject' | 'undo') => {
    setBusy(true);
    try {
      await decideAction(id, decision);
      if (decision === 'undo') showToast(t('email.undo.doneTitle'));
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (action.status === 'proposed') {
    return (
      <div className="action-card ask" role="group" aria-label={t('ui.suggestion.from.stella')}>
        <button type="button" className="btn small" disabled={busy} onClick={() => run('approve')}><Icon name="check" size={16} stroke={2.6} />{t('ui.yes.do.it')}</button>
        <button type="button" className="btn small secondary" disabled={busy} onClick={() => run('reject')}>{t('common.no')}</button>
      </div>
    );
  }
  const label = {
    done: t('today.status.done'), rejected: t('ui.declined'), undone: t('email.undo.doneTitle'), failed: t('app.failed'), proposed: '',
  }[action.status];
  return (
    <div className={`action-card ${action.status}`}>
      <span className="action-state">{action.status === 'done' && <Icon name="check" size={14} stroke={3} />}{label}</span>
      {action.canUndo && <button type="button" className="link small" disabled={busy} onClick={() => run('undo')}>{t('telegram.undo')}</button>}
    </div>
  );
}
