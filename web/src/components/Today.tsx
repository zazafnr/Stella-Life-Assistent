import { useEffect, useMemo, useState } from 'react';
import { addDays, diffDays, formatDateDe, todayIn, type Item } from '@stella/shared';
import { api, meHas, useStore } from '../store.ts';
import type { Tab } from '../App.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Confetti, Ring, Sky, StarMark } from '../ui/Decor.tsx';
import { BriefingCard } from './BriefingCard.tsx';
import { ListsSheet } from './Lists.tsx';

interface Lesson { date: string; start: string; subject: string | null; code: string | null; status: string }
interface InboxEntry { source: string; category: string | null; action: string | null; createdAt: string }

const KIND_ICON: Record<string, [IconName, string]> = {
  homework: ['book', 'pink'], exam: ['exam', 'pink'], assignment: ['sheet', 'blue'], event: ['calendar', 'blue'],
  todo: ['check', 'blue'], study: ['sparkle', 'blue'], reminder: ['bell', 'pink'],
};

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
}

export function solvedInNotebook(i: Item) {
  return i.attachments.some((a) => a.caption?.startsWith('Lösung'));
}

export function ItemStatus({ item, busy }: { item: Item; busy: boolean }) {
  if (item.status === 'done' && solvedInNotebook(item)) {
    return (
      <span className="pill green" style={{ position: 'relative' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        Im Heft<Confetti delay={0.7} />
      </span>
    );
  }
  if (item.status === 'done') return <span className="pill green"><Icon name="check" size={14} stroke={3} />Erledigt</span>;
  if (busy) return <span className="pill blue">Stella löst …</span>;
  return <span className="pill gray">offen</span>;
}

export function Today({ go }: { go: (t: Tab) => void }) {
  const me = useStore((s) => s.me);
  const itemsById = useStore((s) => s.items);
  const busy = useStore((s) => s.busyItems);
  const tz = me?.timeZone ?? 'Europe/Vienna';
  const today = todayIn(tz);
  const tomorrow = addDays(today, 1);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [inbox, setInbox] = useState<InboxEntry[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [shopCount, setShopCount] = useState<number | null>(null);

  const loadShopCount = () => {
    if (!meHas(me, 'shopping')) return;
    api<{ lists: { kind: string; items: { done: boolean }[] }[] }>('/api/lists')
      .then((r) => setShopCount(r.lists.find((l) => l.kind === 'shopping')?.items.filter((i) => !i.done).length ?? 0)).catch(() => {});
  };
  useEffect(loadShopCount, [me?.settings.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<Lesson[]>(`/api/timetable?from=${tomorrow}&to=${tomorrow}`).then(setLessons).catch(() => setLessons([]));
    api<{ date: string; steps: number | null }[]>('/api/health?days=1').then((d) => setSteps(d.find((x) => x.date === today)?.steps ?? null)).catch(() => {});
    api<InboxEntry[]>('/api/inbox?limit=150').then(setInbox).catch(() => {});
  }, [today, tomorrow]);

  const { due, exam, study } = useMemo(() => {
    const all = Object.values(itemsById).filter((i) => !i.deleted);
    const dueTomorrow = all.filter((i) => i.due === tomorrow && i.kind !== 'study' && i.kind !== 'exam');
    const upcoming = all.filter((i) => i.status === 'open' && i.due && i.due >= today && i.kind !== 'study')
      .sort((a, b) => a.due!.localeCompare(b.due!));
    return {
      due: dueTomorrow.length ? dueTomorrow : upcoming.slice(0, 3),
      exam: all.filter((i) => i.kind === 'exam' && i.status === 'open' && i.due && i.due >= today).sort((a, b) => a.due!.localeCompare(b.due!))[0],
      study: all.filter((i) => i.kind === 'study' && i.status === 'open' && i.due === today)[0],
    };
  }, [itemsById, today, tomorrow]);
  const dueLabel = due.length && due.every((i) => i.due === tomorrow) ? 'Morgen fällig' : 'Als Nächstes';

  const since = Date.now() - 86_400_000;
  const recent = inbox.filter((e) => Date.parse(e.createdAt) > since);
  const important = recent.filter((e) => e.category === 'important').length;
  const social = recent.filter((e) => e.source === 'social').length;
  const trashed = recent.filter((e) => e.action === 'trash').length;

  const goal = me?.settings.stepGoal || 8000;
  const homeworkSubjects = new Set(due.filter((i) => i.due === tomorrow).map((i) => i.subject));
  const firstName = (me?.name ?? '').split(' ')[0];
  const dateLabel = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page">
      <Sky />
      <div className="glow" aria-hidden="true" style={{ width: 300, height: 300, right: -140, top: 120, background: '#FFC2DA', opacity: 0.35 }} />
      <div className="page-inner stagger">
        <header className="page-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted" style={{ fontWeight: 600 }}>{dateLabel}</span>
            <h1 className="display">{greeting()}{firstName ? `, ${firstName}` : ''}!</h1>
          </div>
          <button type="button" className="icon-btn" aria-label="Einstellungen" onClick={() => go('settings')} style={{ color: 'var(--pink)' }}>
            <StarMark size={20} />
          </button>
        </header>

        <BriefingCard onOpen={go} />

        {meHas(me, 'shopping') && (
          <button type="button" className="card interactive row" style={{ justifyContent: 'space-between', gap: 12 }} onClick={() => setListOpen(true)}>
            <span className="row" style={{ gap: 12 }}>
              <span className="icon-tile blue" style={{ width: 40, height: 40, borderRadius: 13 }}><Icon name="plus" size={20} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                <span style={{ fontWeight: 600 }}>Einkaufsliste</span>
                <span className="small muted">{shopCount === null ? 'antippen zum Öffnen' : shopCount === 0 ? 'nichts zu besorgen' : `${shopCount} ${shopCount === 1 ? 'Eintrag' : 'Einträge'} offen`}</span>
              </span>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        )}
        {listOpen && <ListsSheet onClose={() => { setListOpen(false); loadShopCount(); }} />}

        <section className="card" aria-label={dueLabel}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="eyebrow">{dueLabel}</span>
            <button type="button" className="link small" onClick={() => go('planner')}>Planer</button>
          </div>
          {due.length === 0 && (
            <div className="row">
              <span className="icon-tile green"><Icon name="check" size={20} stroke={2.6} /></span>
              <span>Nichts offen – genieß den Tag!</span>
            </div>
          )}
          {due.map((i) => {
            const [icon, color] = KIND_ICON[i.kind] ?? ['sparkle', 'blue'];
            const isBusy = busy.includes(i.id);
            return (
              <div key={i.id} className="today-item">
                <span className={`icon-tile ${color}`}><Icon name={icon} size={20} /></span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>{i.title}</span>
                  {isBusy && i.status === 'open'
                    ? <div className="progress"><div className="shimmer" style={{ width: '64%' }} /></div>
                    : <span className="small muted">{[i.detail, i.due !== tomorrow && i.due ? formatDateDe(i.due, today) : null].filter(Boolean).join(' · ')}</span>}
                </div>
                <ItemStatus item={i} busy={isBusy} />
              </div>
            );
          })}
        </section>

        <div className="grid-2">
          <button type="button" className="card interactive" onClick={() => go('planner')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {exam ? (
              <>
                <Ring value={1 - Math.min(diffDays(today, exam.due!), 21) / 21} color="#FF7EB3" label={diffDays(today, exam.due!)} />
                <span style={{ fontWeight: 600 }}>{exam.title}</span>
                <span className="small muted">{study ? `Heute: ${study.detail ?? 'Lernen'}` : `in ${diffDays(today, exam.due!)} Tagen`}</span>
              </>
            ) : (
              <>
                <span className="icon-tile pink" style={{ width: 64, height: 64, borderRadius: 20 }}><Icon name="exam" size={26} /></span>
                <span style={{ fontWeight: 600 }}>Keine Tests</span>
                <span className="small muted">Schreib z. B. „Mathe SA 12.11.“</span>
              </>
            )}
          </button>
          <button type="button" className="card interactive" onClick={() => go('health')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Ring value={(steps ?? 0) / goal} color="#34C77B" label={<span style={{ fontSize: 12, color: 'var(--green)' }}>{steps === null ? '–' : `${Math.round(((steps ?? 0) / goal) * 100)} %`}</span>} />
            <span style={{ fontWeight: 600 }}>{steps === null ? 'Schritte' : `${steps.toLocaleString('de-AT')} Schritte`}</span>
            <span className="small muted">Ziel {goal.toLocaleString('de-AT')}</span>
          </button>
        </div>

        {lessons && lessons.length > 0 && (
          <section aria-label="Morgen in der Schule" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Morgen in der Schule</h2>
              <span className="small muted">{formatDateDe(tomorrow)}</span>
            </div>
            <div className="lesson-strip">
              {lessons.map((l, idx) => {
                const off = l.status === 'cancelled';
                const hw = !off && homeworkSubjects.has(l.subject);
                return (
                  <div key={idx} className={`lesson-chip${off ? ' off' : hw ? ' hw' : ''}`}>
                    <span className="t">{l.start}{off ? ' · entfällt' : hw ? ' · HÜ' : ''}</span>
                    <span className="s">{l.subject ?? l.code}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <button type="button" className="card interactive row" onClick={() => go('inbox')}>
          <span className={important ? 'pulse' : ''} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: important ? 'var(--pink)' : 'var(--blue-light)' }} />
          <span style={{ flex: 1, fontSize: 14 }}>
            <strong style={{ fontWeight: 600 }}>{important} wichtige {important === 1 ? 'Nachricht' : 'Nachrichten'}</strong>
            <span className="muted"> · {social} Social · {trashed} Werbung gelöscht</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>

        <button type="button" className="card interactive row" onClick={() => go('chat')}>
          <span className="icon-tile blue"><Icon name="chat" size={20} /></span>
          <span style={{ flex: 1 }}>
            <strong style={{ fontWeight: 600, display: 'block' }}>Stella etwas sagen</strong>
            <span className="small muted">„Latein HÜ S. 20 Nr. 3 Freitag“ oder einfach fragen</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </div>
  );
}
