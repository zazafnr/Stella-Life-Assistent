import { useState, type ReactNode } from 'react';
import { decideAction, useStore } from '../store.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { showToast } from '../ui/Decor.tsx';
import { useT } from '../i18n.ts';

/** Symbol und Farbe je Art der Aktion (wie ActionCardView.look in der iOS-App) */
function look(type: string): { icon: IconName; tone: 'green' | 'blue' | 'pink' | 'violet' } {
  if (type.startsWith('goal.')) return { icon: 'target', tone: 'green' };
  if (type === 'mail.send') return { icon: 'mail', tone: 'blue' };
  if (type.startsWith('list.')) return { icon: 'list', tone: 'pink' };
  if (type === 'item.delete') return { icon: 'trash', tone: 'pink' };
  if (type.startsWith('memory.')) return { icon: 'memory', tone: 'violet' };
  if (type === 'study_plan.create' || type === 'week_plan.apply') return { icon: 'sparkle', tone: 'pink' };
  if (type === 'homework.solve') return { icon: 'pen', tone: 'blue' };
  return { icon: 'calendar', tone: 'blue' };
}

function Box({ type, summary, children }: { type: string; summary: string; children: ReactNode }) {
  const l = look(type);
  return (
    <div className="action-box">
      <span className={`action-ic ${l.tone}`}><Icon name={l.icon} size={17} /></span>
      <div className="action-body">
        <span className="action-title">{summary.charAt(0).toUpperCase() + summary.slice(1)}</span>
        {children}
      </div>
    </div>
  );
}

/** Unter einer Stella-Nachricht: Vorschlag mit Ja/Nein oder erledigte Aktion mit „Rückgängig“ – als kleine Karte mit Symbol */
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
      <Box type={action.type} summary={action.summary}>
        <div className="action-card ask" role="group" aria-label={t('ui.suggestion.from.stella')}>
          <button type="button" className="btn small" disabled={busy} onClick={() => run('approve')}><Icon name="check" size={16} stroke={2.6} />{t('ui.yes.do.it')}</button>
          <button type="button" className="btn small secondary" disabled={busy} onClick={() => run('reject')}>{t('common.no')}</button>
        </div>
      </Box>
    );
  }
  const label = {
    done: t('today.status.done'), rejected: t('ui.declined'), undone: t('email.undo.doneTitle'), failed: t('app.failed'), proposed: '',
  }[action.status];
  return (
    <Box type={action.type} summary={action.summary}>
      <div className={`action-card ${action.status}`}>
        <span className="action-state">{action.status === 'done' && <Icon name="check" size={14} stroke={3} />}{label}</span>
        {action.canUndo && <button type="button" className="link small" disabled={busy} onClick={() => run('undo')}>{t('telegram.undo')}</button>}
      </div>
    </Box>
  );
}
