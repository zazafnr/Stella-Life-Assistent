import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FINANCE_CATEGORIES, formatDateDe, todayIn, type FinanceCategory, type FinanceMonth, type MessageCard, type Transaction } from '@stella/shared';
import { api, useStore } from '../store.ts';
import type { Tab } from '../App.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Sheet, Sky, showToast } from '../ui/Decor.tsx';

export const CATEGORY_COLOR: Record<FinanceCategory, string> = {
  Lebensmittel: '#34C77B', 'Essen & Trinken': '#FF9F43', Transport: '#1F6FEB', Shopping: '#FF7EB3',
  Freizeit: '#8B6FE8', Abos: '#0E8F8A', Gesundheit: '#5BC0EB', Sonstiges: '#8DA0BA',
};

export const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('de-AT', { style: 'currency', currency }).format(cents / 100);

const monthLabel = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Sicht auf die Ausgaben: Summe, Kategorien mit Budget, Abos, Buchungen. Stella sammelt sie über den Apple-Pay-Kurzbefehl. */
export function Finance({ back, go }: { back: () => void; go: (tab: Tab) => void }) {
  const tz = useStore((s) => s.me?.timeZone) ?? 'Europe/Vienna';
  const today = todayIn(tz);
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [picking, setPicking] = useState<Transaction | null>(null);
  const [budgetFor, setBudgetFor] = useState<FinanceCategory | null>(null);

  const load = useCallback(() => {
    api<FinanceMonth>(`/api/finance?month=${month}`).then(setData).catch((err: Error) => showToast(err.message, true));
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const max = Math.max(1, ...(data?.categories ?? []).map((c) => c.cents));
  const budget = (c: FinanceCategory) => data?.budgets.find((b) => b.category === c);
  const diff = data ? data.totalCents - data.previousTotalCents : 0;

  return (
    <div className="page">
      <Sky />
      <div className="page-inner stagger">
        <header className="page-head">
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label="Zurück" onClick={back}><Icon name="back" size={18} /></button>
            <h1 className="display">Ausgaben</h1>
          </div>
        </header>

        <div className="fin-month">
          <button type="button" className="icon-btn" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" size={18} /></button>
          <strong>{monthLabel(month)}</strong>
          <button type="button" className="icon-btn" aria-label="Nächster Monat" disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron" size={18} /></button>
        </div>

        {!data && <p className="muted">⏳ Einen Moment …</p>}

        {data && data.count === 0 && (
          <section className="card empty">
            <span className="icon-tile blue"><Icon name="wallet" size={26} /></span>
            <p>{month === current ? 'Noch keine Zahlungen in diesem Monat.' : 'In diesem Monat gibt es keine Zahlungen.'} Mit einem Apple-Kurzbefehl meldet dein iPhone jede Kartenzahlung an Stella – nur Betrag, Händler und Kartenname.</p>
            <button type="button" className="btn" onClick={() => go('settings')}>Einrichten unter Einstellungen → Ausgaben</button>
          </section>
        )}

        {data && data.count > 0 && (
          <>
            <section className="card fin-total">
              <span className="muted small">Ausgegeben</span>
              <span className="display fin-sum">{euro(data.totalCents, data.currency)}</span>
              <span className="muted small">
                {data.count} {data.count === 1 ? 'Zahlung' : 'Zahlungen'}
                {data.previousTotalCents > 0 && ` · ${euro(Math.abs(diff), data.currency)} ${diff >= 0 ? 'mehr' : 'weniger'} als im Vormonat`}
              </span>
              {data.otherCurrency > 0 && <span className="muted small">{data.otherCurrency} Zahlung(en) in anderer Währung sind nicht eingerechnet.</span>}
            </section>

            <section className="card">
              <h2>Nach Kategorie</h2>
              <ul className="fin-cats">
                {data.categories.map((c) => {
                  const b = budget(c.category);
                  const over = b && c.cents >= b.limitCents;
                  return (
                    <li key={c.category}>
                      <button type="button" className="fin-cat" onClick={() => setBudgetFor(c.category)} aria-label={`${c.category}: ${euro(c.cents, data.currency)}${b ? ` von ${euro(b.limitCents, data.currency)} Budget` : ''}. Budget ändern`}>
                        <span className="row" style={{ justifyContent: 'space-between' }}>
                          <span><i className="fin-dot" style={{ background: CATEGORY_COLOR[c.category] }} />{c.category}</span>
                          <strong className={over ? 'danger' : ''}>{euro(c.cents, data.currency)}{b && <span className="muted small"> / {euro(b.limitCents, data.currency)}</span>}</strong>
                        </span>
                        <span className="progress"><span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${(c.cents / (b ? Math.max(b.limitCents, c.cents) : max)) * 100}%`, background: over ? 'var(--danger)' : CATEGORY_COLOR[c.category] }} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small" style={{ margin: '8px 0 0' }}>Tippe auf eine Kategorie, um ein Monatsbudget zu setzen. Stella meldet sich bei 80 %.</p>
            </section>
          </>
        )}

        {data && data.subscriptions.length > 0 && (
          <section className="card">
            <h2>Abos</h2>
            <ul className="fin-list">
              {data.subscriptions.map((s) => (
                <li key={`${s.merchant}${s.amountCents}`}>
                  <span className="grow"><strong>{s.merchant}</strong><span className="muted small"> · nächste Abbuchung um den {formatDateDe(s.nextDay, today)}</span></span>
                  <strong>{euro(s.amountCents, s.currency)}</strong>
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ margin: '8px 0 0' }}>Zusammen etwa {euro(data.subscriptions.reduce((a, s) => a + s.amountCents, 0), data.currency)} im Monat.</p>
          </section>
        )}

        {data && data.transactions.length > 0 && (
          <section className="card">
            <h2>Buchungen</h2>
            <ul className="fin-list">
              {data.transactions.map((t) => (
                <li key={t.id}>
                  <button type="button" className="fin-tx" onClick={() => setPicking(t)} aria-label={`${t.merchant}, ${euro(t.amountCents, t.currency)}, ${t.category}. Kategorie ändern`}>
                    <i className="fin-dot" style={{ background: CATEGORY_COLOR[t.category] }} />
                    <span className="grow">
                      <strong>{t.merchant}</strong>
                      <span className="muted small">{formatDateDe(t.day, today)} · {t.category}{t.cardLabel ? ` · ${t.cardLabel}` : ''}</span>
                    </span>
                    <strong>{euro(t.amountCents, t.currency)}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {picking && <CategorySheet tx={picking} onClose={() => setPicking(null)} onChanged={load} />}
      {budgetFor && data && <BudgetSheet category={budgetFor} current={budget(budgetFor)?.limitCents ?? 0} onClose={() => setBudgetFor(null)} onChanged={load} />}
    </div>
  );
}

function CategorySheet({ tx, onClose, onChanged }: { tx: Transaction; onClose: () => void; onChanged: () => void }) {
  async function choose(category: FinanceCategory) {
    try {
      await api(`/api/finance/transactions/${tx.id}`, { method: 'PATCH', json: { category } });
      showToast(`Ab jetzt zählt „${tx.merchant}“ zu ${category}.`);
      onChanged();
      onClose();
    } catch (err) { showToast((err as Error).message, true); }
  }
  async function remove() {
    try { await api(`/api/finance/transactions/${tx.id}`, { method: 'DELETE' }); onChanged(); onClose(); } catch (err) { showToast((err as Error).message, true); }
  }
  return (
    <Sheet title={tx.merchant} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{euro(tx.amountCents, tx.currency)} · Wohin gehört das? Stella merkt sich das für diesen Händler.</p>
      <div className="fin-choices">
        {FINANCE_CATEGORIES.map((c) => (
          <button key={c} type="button" className={c === tx.category ? 'chip active' : 'chip'} aria-pressed={c === tx.category} onClick={() => void choose(c)}>
            <i className="fin-dot" style={{ background: CATEGORY_COLOR[c] }} />{c}
          </button>
        ))}
      </div>
      <button type="button" className="btn ghost danger" style={{ marginTop: 16 }} onClick={() => void remove()}><Icon name="trash" size={15} />Buchung löschen</button>
    </Sheet>
  );
}

function BudgetSheet({ category, current, onClose, onChanged }: { category: FinanceCategory; current: number; onClose: () => void; onChanged: () => void }) {
  const [value, setValue] = useState(current ? String(current / 100).replace('.', ',') : '');
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/finance/budgets/${encodeURIComponent(category)}`, { method: 'PUT', json: { amount: value || null } });
      onChanged();
      onClose();
    } catch (err) { showToast((err as Error).message, true); }
  }
  return (
    <Sheet title={`Budget: ${category}`} onClose={onClose}>
      <form className="goal-form" onSubmit={(e) => void save(e)}>
        <label className="field">Monatsbudget in Euro <span className="muted small">(leer = kein Budget)</span>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="z. B. 200" autoFocus />
        </label>
        <button type="submit" className="btn block">Speichern</button>
      </form>
    </Sheet>
  );
}

/** Karte im Chat: „Wie viel hab ich diese Woche ausgegeben?“ */
export function SpendingCard({ card }: { card: Extract<MessageCard, { type: 'spending' }> }) {
  const max = Math.max(1, ...card.categories.map((c) => c.cents));
  if (!card.count) return null;
  return (
    <div className="fin-chat-card">
      <span className="eyebrow">{card.label}</span>
      <span className="display fin-sum">{euro(card.totalCents, card.currency)}</span>
      <ul className="fin-cats">
        {card.categories.slice(0, 5).map((c) => (
          <li key={c.category}>
            <span className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span><i className="fin-dot" style={{ background: CATEGORY_COLOR[c.category as FinanceCategory] ?? '#8DA0BA' }} />{c.category}</span>
              <strong>{euro(c.cents, card.currency)}</strong>
            </span>
            <span className="progress"><span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${(c.cents / max) * 100}%`, background: CATEGORY_COLOR[c.category as FinanceCategory] ?? '#8DA0BA' }} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
