import { useState } from 'react';
import { decideAction, useStore } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';
import { showToast } from '../ui/Decor.tsx';

/** Unter einer Stella-Nachricht: Vorschlag mit Ja/Nein oder erledigte Aktion mit „Rückgängig“ */
export function ActionCard({ id }: { id: string }) {
  const action = useStore((s) => s.actions[id]);
  const [busy, setBusy] = useState(false);
  if (!action) return null;

  const run = async (decision: 'approve' | 'reject' | 'undo') => {
    setBusy(true);
    try {
      await decideAction(id, decision);
      if (decision === 'undo') showToast('Rückgängig gemacht');
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (action.status === 'proposed') {
    return (
      <div className="action-card ask" role="group" aria-label="Vorschlag von Stella">
        <button type="button" className="btn small" disabled={busy} onClick={() => run('approve')}><Icon name="check" size={16} stroke={2.6} />Ja, mach das</button>
        <button type="button" className="btn small secondary" disabled={busy} onClick={() => run('reject')}>Nein</button>
      </div>
    );
  }
  const label = {
    done: 'Erledigt', rejected: 'Abgelehnt', undone: 'Rückgängig gemacht', failed: 'Hat nicht geklappt', proposed: '',
  }[action.status];
  return (
    <div className={`action-card ${action.status}`}>
      <span className="action-state">{action.status === 'done' && <Icon name="check" size={14} stroke={3} />}{label}</span>
      {action.canUndo && <button type="button" className="link small" disabled={busy} onClick={() => run('undo')}>Rückgängig</button>}
    </div>
  );
}
