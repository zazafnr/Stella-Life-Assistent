import { useEffect, useMemo, useState } from 'react';
import { addDays, diffDays, formatDay, todayIn, type FinanceMonth, type GoalProgress, type Item } from '@stella/shared';
import { api, meHas, useStore } from '@stella/web-core/store.ts';
import { useLocale, useT } from '@stella/web-core/i18n.ts';
import type { Tab } from '@stella/web-core/nav.ts';
import { Icon, type IconName } from '@stella/web-core/ui/Icon.tsx';
import { Ring } from '@stella/web-core/ui/Decor.tsx';
import { ItemStatus } from '@stella/web-core/components/ItemStatus.tsx';
import { BriefingCard } from '@stella/web-core/components/BriefingCard.tsx';
import { ListsSheet } from '@stella/web-core/components/Lists.tsx';
import { WeekBar, amount } from '@stella/web-core/components/Goals.tsx';
import { euro } from '@stella/web-core/components/Finance.tsx';
import { StellaPlanCard } from '@stella/web-core/components/StellaPlan.tsx';

interface Lesson { date: string; start: string; subject: string | null; code: string | null; status: string }
interface InboxEntry { source: string; category: string | null; action: string | null; createdAt: string }

const KIND_ICON: Record<string, [IconName, string]> = {
  homework: ['book', 'pink'], exam: ['exam', 'pink'], assignment: ['sheet', 'blue'], event: ['calendar', 'blue'],
  todo: ['check', 'blue'], study: ['sparkle', 'blue'], reminder: ['bell', 'pink'],
};

function greetingKey() {
  const h = new Date().getHours();
  return h < 11 ? 'today.greeting.morning' : h < 18 ? 'today.greeting.afternoon' : 'today.greeting.evening';
}

export function Today({ go }: { go: (t: Tab) => void }) {
  const t = useT();
  const locale = useLocale();
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

  const [spent, setSpent] = useState<{ cents: number; currency: string; count: number } | null>(null);
  useEffect(() => {
    if (!meHas(me, 'finance')) { setSpent(null); return; }
    api<FinanceMonth>('/api/finance').then((r) => setSpent({ cents: r.totalCents, currency: r.currency, count: r.count })).catch(() => {});
  }, [me?.settings.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const [goalList, setGoalList] = useState<GoalProgress[]>([]);
  useEffect(() => {
    if (!meHas(me, 'goals')) { setGoalList([]); return; }
    api<{ goals: GoalProgress[] }>('/api/goals').then((r) => setGoalList(r.goals.filter((g) => g.status === 'active'))).catch(() => {});
  }, [me?.settings.profile]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const dueLabel = due.length && due.every((i) => i.due === tomorrow) ? t('today.dueTomorrow') : t('today.upNext');

  const since = Date.now() - 86_400_000;
  const recent = inbox.filter((e) => Date.parse(e.createdAt) > since);
  const important = recent.filter((e) => e.category === 'important').length;
  const social = recent.filter((e) => e.source === 'social').length;
  const trashed = recent.filter((e) => e.action === 'trash').length;

  const goal = me?.settings.stepGoal || 8000;
  const homeworkSubjects = new Set(due.filter((i) => i.due === tomorrow).map((i) => i.subject));
  const firstName = (me?.name ?? '').split(' ')[0];
  const dateLabel = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const heroTitle = firstName ? t('today.greeting.named', { greeting: t(greetingKey()), name: firstName }) : t('today.greeting.plain', { greeting: t(greetingKey()) });
  return (
    <div className="page">
      <div className="page-inner">
        <header className="hero">
          <div>
            <div className="when">{dateLabel}</div>
            <h1 className="display">{heroTitle}</h1>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => go('chat')}><Icon name="chat" size={16} />{t('today.tellStella')}</button>
          </div>
        </header>

        <div className="dash">
          <section aria-label={dueLabel}>
            <BriefingCard onOpen={go} />

            <div className="card">
              <div className="panel-head">
                <h2 className="eyebrow">{dueLabel}</h2>
                <button type="button" className="link small" onClick={() => go('planner')}>{t('today.planner')}</button>
              </div>
              {due.length === 0 && (
                <div className="row">
                  <span className="icon-tile green"><Icon name="check" size={20} stroke={2.6} /></span>
                  <span>{t('today.allClear')}</span>
                </div>
              )}
              {due.map((i) => {
                const [icon, color] = KIND_ICON[i.kind] ?? ['sparkle', 'blue'];
                const isBusy = busy.includes(i.id);
                return (
                  <div key={i.id} className="today-item">
                    <span className={`icon-tile ${color}`}><Icon name={icon} size={18} /></span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>{i.title}</span>
                      {isBusy && i.status === 'open'
                        ? <div className="progress"><div className="shimmer" style={{ width: '64%' }} /></div>
                        : <span className="small muted">{[i.detail, i.due !== tomorrow && i.due ? formatDay(locale, i.due, today) : null].filter(Boolean).join(' · ')}</span>}
                    </div>
                    <ItemStatus item={i} busy={isBusy} />
                  </div>
                );
              })}
            </div>
          </section>

          <div>
            <div className="stat-row">
              <button type="button" className="card interactive stat" onClick={() => go('planner')}>
                {exam ? (
                  <>
                    <Ring value={1 - Math.min(diffDays(today, exam.due!), 21) / 21} color="#FF7EB3" label={diffDays(today, exam.due!)} />
                    <span style={{ fontWeight: 600 }}>{exam.title}</span>
                    <span className="small muted">{study ? t('today.studyToday', { what: study.detail ?? t('today.studyDefault') }) : t('today.inDays', { count: diffDays(today, exam.due!) })}</span>
                  </>
                ) : (
                  <>
                    <span className="icon-tile pink" style={{ width: 56, height: 56, borderRadius: 16 }}><Icon name="exam" size={24} /></span>
                    <span style={{ fontWeight: 600 }}>{t('today.noTests')}</span>
                    <span className="small muted">{t('today.noTestsHint')}</span>
                  </>
                )}
              </button>
              <button type="button" className="card interactive stat" onClick={() => go('health')}>
                <Ring value={(steps ?? 0) / goal} color="#34C77B" label={<span style={{ fontSize: 12, color: 'var(--green)' }}>{steps === null ? '–' : `${Math.round(((steps ?? 0) / goal) * 100)} %`}</span>} />
                <span style={{ fontWeight: 600 }}>{steps === null ? t('today.steps') : t('today.stepsCount', { count: steps.toLocaleString(locale) })}</span>
                <span className="small muted">Ziel {goal.toLocaleString('de-AT')}</span>
              </button>
            </div>

            {lessons && lessons.length > 0 && (
              <section className="card" aria-label={t('today.tomorrowAtSchool')}>
                <div className="panel-head">
                  <h2 className="eyebrow">{t('today.tomorrowAtSchool')}</h2>
                  <span className="small muted">{formatDay(locale, tomorrow)}</span>
                </div>
                <div className="lesson-strip">
                  {lessons.map((l, idx) => {
                    const off = l.status === 'cancelled';
                    const hw = !off && homeworkSubjects.has(l.subject);
                    return (
                      <div key={idx} className={`lesson-chip${off ? ' off' : hw ? ' hw' : ''}`}>
                        <span className="t">{l.start}{off ? t('today.lessonCancelled') : hw ? t('today.lessonHomework') : ''}</span>
                        <span className="s">{l.subject ?? l.code}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {goalList.length > 0 && (
              <button type="button" className="card interactive" onClick={() => go('goals')} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
                <span className="panel-head" style={{ margin: 0 }}><h2 className="eyebrow">{t('today.yourGoals')}</h2><Icon name="chevron" size={16} /></span>
                {goalList.slice(0, 4).map((g) => (
                  <span key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
                      <span style={{ fontWeight: 600 }}>{g.title}</span>
                      <span className="muted small">{amount(g, g.weekValue)} von {amount(g, g.weekTarget)}</span>
                    </span>
                    <WeekBar goal={g} />
                  </span>
                ))}
              </button>
            )}
          </div>

          <div>
            {meHas(me, 'shopping') && (
              <button type="button" className="card interactive row" style={{ justifyContent: 'space-between', gap: 12 }} onClick={() => setListOpen(true)}>
                <span className="row" style={{ gap: 12 }}>
                  <span className="icon-tile blue"><Icon name="plus" size={18} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600 }}>{t('today.shopping')}</span>
                    <span className="small muted">{shopCount === null ? t('today.shopping.tap') : shopCount === 0 ? t('today.shopping.none') : t('today.shopping.open', { count: shopCount })}</span>
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            )}
            {listOpen && <ListsSheet onClose={() => { setListOpen(false); loadShopCount(); }} />}

            <StellaPlanCard go={go} />

            {spent && (
              <button type="button" className="card interactive row" onClick={() => go('finance')}>
                <span className="icon-tile green"><Icon name="wallet" size={18} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <strong style={{ fontWeight: 600, display: 'block' }}>{t('today.spendingMonth')}</strong>
                  <span className="small muted">{spent.count ? t('today.spendingCount', { amount: euro(spent.cents, spent.currency), count: spent.count }) : t('today.spendingNone')}</span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            )}

            <button type="button" className="card interactive row" onClick={() => go('inbox')}>
              <span className={important ? 'pulse' : ''} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: important ? 'var(--pink)' : 'var(--blue-light)' }} />
              <span style={{ flex: 1, fontSize: 13.5, textAlign: 'left' }}>
                <strong style={{ fontWeight: 600, display: 'block' }}>{t('today.importantMessages', { count: important })}</strong>
                <span className="muted">{t('today.inboxMeta', { social, trashed })}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>

            <button type="button" className="card interactive row" onClick={() => go('chat')}>
              <span className="icon-tile pink"><Icon name="chat" size={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <strong style={{ fontWeight: 600, display: 'block' }}>{t('today.tellStella')}</strong>
                <span className="small muted">{t('today.tellStellaHint')}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
