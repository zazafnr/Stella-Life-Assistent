import { useState } from 'react';
import type { AvailabilityItem, MessageCard, RestaurantCardItem } from '@stella/shared';
import { api, refreshMe } from '../store.ts';
import { useLocale, useT } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';

type RestaurantsCard = Extract<MessageCard, { type: 'restaurants' }>;
type AvailabilityCard = Extract<MessageCard, { type: 'availability' }>;

const dist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Drei Vorschläge mit „Reservieren“ (Link oder Anruf), „Route“ und „In den Planer“. Stella bucht nicht selbst – das steht auch auf der Karte. */
export function RestaurantsCardView({ card }: { card: RestaurantsCard }) {
  const t = useT();
  const [planned, setPlanned] = useState<Record<string, string | 'busy'>>({});
  const [error, setError] = useState('');

  async function plan(r: RestaurantCardItem) {
    if (!card.when) return;
    setPlanned((p) => ({ ...p, [r.id]: 'busy' }));
    try {
      const res = await api<{ actionId: string }>('/api/errands/plan', { method: 'POST', json: { name: r.name, when: card.when, people: card.people, address: r.address, phone: r.phone } });
      setPlanned((p) => ({ ...p, [r.id]: res.actionId }));
    } catch (err) { setPlanned((p) => { const { [r.id]: _x, ...rest } = p; return rest; }); setError((err as Error).message); }
  }
  async function undo(r: RestaurantCardItem) {
    const id = planned[r.id];
    if (!id || id === 'busy') return;
    await api(`/api/actions/${id}/undo`, { method: 'POST' }).catch(() => {});
    setPlanned((p) => { const { [r.id]: _x, ...rest } = p; return rest; });
  }

  return (
    <div className="errand-card" aria-label={t('errand.card.restaurants')}>
      <strong className="small">{t('errand.card.restaurants')}</strong>
      {card.items.map((r) => {
        const open = r.openNow === true ? t('errand.openNow') : r.openNow === false ? t('errand.closed') : t('errand.hoursUnknown');
        const done = planned[r.id];
        return (
          <div key={r.id} className="errand-item">
            <div><strong>{r.name}</strong><span className="small muted"> · {r.cuisine.join(', ') || r.kind} · {dist(r.distanceM)} · {open}</span></div>
            <div className="button-row">
              {r.bookingUrl
                ? <a className="btn small" href={r.bookingUrl} target="_blank" rel="noopener noreferrer">{t('errand.reserve')}{r.bookingService ? ` · ${r.bookingService}` : ''}</a>
                : r.phone ? <a className="btn small" href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}><Icon name="message" size={14} /> {t('errand.call')}</a>
                : r.website ? <a className="btn small" href={r.website} target="_blank" rel="noopener noreferrer">{t('errand.website')}</a> : null}
              <a className="btn small secondary" href={r.osmUrl} target="_blank" rel="noopener noreferrer">{t('errand.route')}</a>
              {card.when && (done && done !== 'busy'
                ? <button type="button" className="btn small secondary" onClick={() => void undo(r)}>{t('telegram.undo')}</button>
                : <button type="button" className="btn small secondary" disabled={done === 'busy'} onClick={() => void plan(r)}>{t('errand.plan')}</button>)}
            </div>
          </div>
        );
      })}
      <p className="small muted">{t('errand.card.notBooked')}</p>
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

const STATUS_KEY: Record<AvailabilityItem['status'], string> = { in_stock: 'errand.inStock', orderable: 'errand.orderable', unclear: 'errand.unclear' };

/** Händler, Filiale, Status mit Quelle und Link, dazu die Uhrzeit der Prüfung. Bei „unklar“ mit Telefonnummer, wenn bekannt. */
export function AvailabilityCardView({ card }: { card: AvailabilityCard }) {
  const t = useT();
  const locale = useLocale();
  const time = new Date(card.checkedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="errand-card" aria-label={t('errand.card.availability')}>
      <strong className="small">{t('errand.card.availability')}: {card.product}</strong>
      {card.items.map((r) => (
        <div key={`${r.retailer}-${r.store ?? ''}`} className="errand-item">
          <div><strong>{r.retailer}</strong>{r.store ? <span className="small muted"> · {r.store}</span> : null}</div>
          <div className="small"><span className={`errand-status ${r.status}`}>{t(STATUS_KEY[r.status])}</span> · {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.source}</a> : r.source}
            {r.status === 'unclear' && r.phone ? <> · <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{t('errand.call')}: {r.phone}</a></> : null}</div>
        </div>
      ))}
      <p className="small muted">{t('errand.checkedAt', { time })}</p>
    </div>
  );
}

/** Frage nach dem Standort, wenn Stella ihn für Restaurants oder Läden braucht (gleiche Erklärung wie in der Einführung) */
export function LocationAskCard() {
  const t = useT();
  const [done, setDone] = useState(false);
  if (done) return null;
  const answer = (permission: 'granted' | 'denied' | 'later') => api('/api/settings', { method: 'PATCH', json: { locationPermission: permission } }).then(() => refreshMe()).finally(() => setDone(true));
  const allow = () => {
    if (!('geolocation' in navigator)) { void answer('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { void api('/api/weather/place', { method: 'POST', json: { lat: p.coords.latitude, lon: p.coords.longitude } }).catch(() => {}); void answer('granted'); },
      () => void answer('denied'), { maximumAge: 600_000, timeout: 15_000 });
  };
  return (
    <div className="button-row" style={{ marginTop: 8 }}>
      <button type="button" className="btn small" onClick={allow}>{t('onboarding.location.allow')}</button>
      <button type="button" className="btn small secondary" onClick={() => void answer('later')}>{t('onboarding.location.later')}</button>
    </div>
  );
}
