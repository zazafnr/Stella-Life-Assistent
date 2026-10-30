import { useCallback, useEffect, useState } from 'react';
import type { MessageCard, NearbyPlaces, StellaList } from '@stella/shared';
import { api } from '../store.ts';
import { Icon } from '../ui/Icon.tsx';

const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);

/**
 * „Läden in der Nähe“ unter der Erinnerung an eine Erledigung. Der Standort wird nur hier und nur einmal abgefragt –
 * von selbst, wenn du ihn dieser App schon erlaubt hast, sonst erst nach einem Tipp. Er wird nirgends gespeichert.
 */
export function PlacesCard({ card }: { card: Extract<MessageCard, { type: 'places' }> }) {
  const [state, setState] = useState<'idle' | 'locating' | 'loading' | 'done' | 'error'>('idle');
  const [data, setData] = useState<NearbyPlaces | null>(null);
  const [error, setError] = useState('');
  const [shopping, setShopping] = useState<StellaList | null>(null);

  const find = useCallback(() => {
    if (!navigator.geolocation) { setState('error'); setError('Dieses Gerät kann den Standort nicht bestimmen.'); return; }
    setState('locating');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setState('loading');
      try {
        const q = new URLSearchParams({ category: card.category, lat: String(pos.coords.latitude), lon: String(pos.coords.longitude) });
        setData(await api<NearbyPlaces>(`/api/places?${q}`));
        // beim Einkaufen kommt die Einkaufsliste gleich mit
        if (card.category === 'supermarket') setShopping((await api<{ lists: StellaList[] }>('/api/lists')).lists[0] ?? null);
        setState('done');
      } catch (err) { setError((err as Error).message); setState('error'); }
    }, (err) => {
      setError(err.code === err.PERMISSION_DENIED ? 'Ohne Standort kann ich keine Läden zeigen. Du kannst ihn in den Einstellungen des Browsers erlauben.' : 'Ich konnte den Standort gerade nicht bestimmen.');
      setState('error');
    }, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 });
  }, [card.category]);

  useEffect(() => {
    // schon erlaubt → gleich suchen; sonst auf den Tipp warten (die Erlaubnis-Frage kommt nur auf Wunsch)
    void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((p) => { if (p.state === 'granted') find(); }).catch(() => {});
  }, [find]);

  return (
    <div className="places-card">
      <span className="eyebrow">{data?.emoji ?? '📍'} {data?.plural ?? card.label} in der Nähe</span>
      {state === 'idle' && <button type="button" className="btn small" onClick={find}><Icon name="link" size={15} />Läden in der Nähe zeigen</button>}
      {(state === 'locating' || state === 'loading') && <span className="small muted">{state === 'locating' ? '📡 Standort wird bestimmt …' : '🔎 Ich suche …'}</span>}
      {state === 'error' && (<><span className="small error-text">{error}</span><button type="button" className="btn small secondary" onClick={find}>Nochmal versuchen</button></>)}
      {state === 'done' && data && data.places.length === 0 && <span className="small muted">Im Umkreis von 3 km habe ich nichts gefunden.</span>}
      {state === 'done' && data?.places.map((p) => (
        <div key={`${p.lat},${p.lon}`} className="place-row">
          <div className="grow">
            <strong>{p.name}</strong>
            <span className="small muted">{km(p.distanceM)}{p.address ? ` · ${p.address}` : ''}</span>
            {p.openNow !== null && <span className={p.openNow ? 'pill green' : 'pill pink'} style={{ alignSelf: 'flex-start' }}>{p.openNow ? 'offen' : 'geschlossen'}</span>}
          </div>
          <a className="btn small secondary" href={isApple ? p.appleMapsUrl : p.osmUrl} target="_blank" rel="noreferrer">Route</a>
        </div>
      ))}
      {shopping && shopping.items.some((i) => !i.done) && (
        <div className="place-shopping">
          <span className="eyebrow">🛒 Einkaufsliste</span>
          <ul>{shopping.items.filter((i) => !i.done).slice(0, 8).map((i) => <li key={i.id}>{i.text}{i.qty && <span className="muted small"> · {i.qty}</span>}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
