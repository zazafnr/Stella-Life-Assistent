import type { Item } from '@stella/shared';
import { useT } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';
import { Confetti } from '../ui/Decor.tsx';

export function solvedInNotebook(i: Item) {
  return i.attachments.some((a) => a.caption?.startsWith('Lösung'));
}

export function ItemStatus({ item, busy }: { item: Item; busy: boolean }) {
  const t = useT();
  if (item.status === 'done' && solvedInNotebook(item)) {
    return (
      <span className="pill green" style={{ position: 'relative' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        {t('today.status.inNotebook')}<Confetti delay={0.7} />
      </span>
    );
  }
  if (item.status === 'done') return <span className="pill green"><Icon name="check" size={14} stroke={3} />{t('today.status.done')}</span>;
  if (busy) return <span className="pill blue">{t('today.status.solving')}</span>;
  return <span className="pill gray">{t('today.status.open')}</span>;
}
