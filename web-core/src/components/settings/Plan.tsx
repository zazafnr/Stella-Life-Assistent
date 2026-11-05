import { useEffect, useState } from 'react';
import { PLAN_IDS, formatMoney, yearlyPriceCents, UNLIMITED, type Plan, type PlanId } from '@stella/shared';
import { api } from '../../store.ts';
import { useLocale, useT } from '../../i18n.ts';
import { Section, useAction } from './ui.tsx';

interface Status {
  plan: PlanId;
  subscription: { status: string; provider: 'stripe' | 'gift'; currentPeriodEnd: string | null; cancelAt: string | null } | null;
  usage: { aiToday: number; aiLimit: number; proMonth: number; proLimit: number; proHomeworkOnly: boolean };
  plans: Plan[];
  canCheckout: boolean;
  canManage: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Einstellungen → Abo: aktuelles Abo, Verbrauch, Vergleich und Upgrade (Stripe Checkout) bzw. Kundenportal */
export function PlanSheet() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<Status | null>(null);
  const [yearly, setYearly] = useState(false);
  const [run, view, busy] = useAction();
  useEffect(() => { api<Status>('/api/billing/status').then(setData).catch(() => {}); }, []);
  if (!data) return <p className="muted">{t('common.later')}…</p>;

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const money = (cents: number) => formatMoney(locale, cents / 100);
  const bar = (used: number, limit: number) => <div className="progress"><div style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} /></div>;
  const sub = data.subscription;
  const checkout = (plan: PlanId) => run(async () => {
    const r = await api<{ url: string }>('/api/billing/checkout', { method: 'POST', json: { plan, interval: yearly ? 'year' : 'month' } });
    window.location.href = r.url;
  }, '');
  const portal = () => run(async () => { const r = await api<{ url: string }>('/api/billing/portal', { method: 'POST' }); window.location.href = r.url; }, '');
  const feature = (p: Plan) => {
    const l = p.limits;
    return [
      `${t('plan.f.ai')}: ${l.aiMessagesPerDay}`,
      `${t('plan.f.pro')}: ${l.proTasksHomeworkOnly ? t('plan.f.proHomework', { count: l.proTasksPerMonth }) : l.proTasksPerMonth}`,
      `${t('plan.f.mailboxes')}: ${l.mailboxes >= UNLIMITED ? t('plan.f.unlimited') : l.mailboxes}`,
      `${t('plan.f.news')}: ${l.newsFavorites ? t('plan.f.newsFavorites', { count: l.newsCount }) : l.newsCount}`,
      `${t('plan.f.screenTime')}: ${l.screenTime ? '✓' : '–'}`,
      `${t('plan.f.webTasks')}: ${l.webTasks ? '✓' : '–'}`,
      ...(l.priority ? [t('plan.f.priority')] : []),
    ];
  };

  return (
    <>
      <Section title={t('plan.current')}>
        <p><strong>{data.plan === 'free' ? t('plan.free') : cap(data.plan)}</strong>
          {sub?.cancelAt && <span className="muted small"> · {t('plan.endsOn', { date: date(sub.cancelAt) })}</span>}</p>
        {sub?.provider === 'gift' && <p className="small muted">{sub.currentPeriodEnd ? t('plan.giftUntil', { date: date(sub.currentPeriodEnd) }) : t('plan.gift')}</p>}
        <p className="small">{t('plan.usageAi', { used: data.usage.aiToday, limit: data.usage.aiLimit })}</p>
        {bar(data.usage.aiToday, data.usage.aiLimit)}
        <p className="small">{t('plan.usagePro', { used: data.usage.proMonth, limit: data.usage.proLimit })}</p>
        {bar(data.usage.proMonth, data.usage.proLimit)}
        <p className="muted small">{t('plan.usageNote')}</p>
        {data.canManage && <button type="button" className="btn secondary" disabled={busy} onClick={() => void portal()}>{t('plan.manage')}</button>}
      </Section>

      <Section title={t('plan.title')}>
        {data.canCheckout && (
          <div className="segmented small" role="radiogroup" aria-label={t('plan.title')} style={{ marginBottom: 10 }}>
            <button type="button" role="radio" aria-checked={!yearly} className={!yearly ? 'active' : ''} onClick={() => setYearly(false)}>{t('plan.monthly')}</button>
            <button type="button" role="radio" aria-checked={yearly} className={yearly ? 'active' : ''} onClick={() => setYearly(true)}>{t('plan.yearly')}</button>
          </div>
        )}
        {!data.canCheckout && sub?.provider !== 'gift' && <p className="muted small">{t('plan.notConfigured')}</p>}
        <div className="plan-grid" style={{ display: 'grid', gap: 12 }}>
          {PLAN_IDS.map((id) => {
            const p = data.plans.find((x) => x.id === id)!;
            const price = p.priceCents === 0 ? t('plan.free') : t('plan.perMonth', { price: money(yearly ? yearlyPriceCents(p) / 12 : p.priceCents) });
            const higher = PLAN_IDS.indexOf(id) > PLAN_IDS.indexOf(data.plan);
            return (
              <div key={id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, outline: id === data.plan ? '2px solid var(--blue)' : 'none' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{id === 'free' ? t('plan.free') : cap(id)}</strong>
                  {id === data.plan ? <span className="status ok">{t('plan.currentBadge')}</span> : <span className="small muted">{price}</span>}
                </div>
                {id === data.plan && <span className="small muted">{price}</span>}
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{feature(p).map((f) => <li key={f}>{f}</li>)}</ul>
                {higher && data.canCheckout && <button type="button" className="btn" disabled={busy} onClick={() => void checkout(id)}>{t('plan.upgrade')} · {cap(id)}</button>}
              </div>
            );
          })}
        </div>
        {view}
      </Section>
    </>
  );
}
