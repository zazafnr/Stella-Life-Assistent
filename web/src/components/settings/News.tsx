import { useEffect, useState } from 'react';
import type { NewsEntry } from '@stella/shared';
import { api, refreshMe } from '../../store.ts';
import { useLocale, useT } from '../../i18n.ts';
import { countryName } from '@stella/shared';
import { Section, useAction } from './ui.tsx';

interface NewsView {
  settings: { enabled: boolean; topics: string[]; countries: string[]; sources: string[]; favorites: { name: string; feedUrl: string }[]; count?: number };
  limits: { count: number; favorites: boolean; maxFavorites: number };
  effectiveCount: number;
  topics: string[];
  countries: string[];
  defaultCountries: string[];
}
interface Found { name: string; feedUrl: string; sample: string[] }

/** Einstellungen → News: ein/aus, Themen, Länder, Lieblingszeitung (ab Pro) */
export function NewsSettings({ onSaved }: { onSaved?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [v, setV] = useState<NewsView | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [run, view] = useAction();
  useEffect(() => { api<NewsView>('/api/news').then(setV).catch(() => {}); }, []);
  if (!v) return <p className="muted">{t('common.later')}…</p>;

  const s = v.settings;
  const countries = s.countries.length ? s.countries : v.defaultCountries;
  const save = (patch: Record<string, unknown>) => run(async () => {
    const r = await api<NewsView>('/api/news', { method: 'PUT', json: { asked: true, ...patch } });
    setV(r);
    await refreshMe();
    onSaved?.();
  }, t('settings.saved'));
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const label = (c: string) => (c === 'INT' ? t('settings.news.international') : countryName(c, locale));

  return (
    <>
      <Section title={t('settings.news.title')}>
        <p className="muted small">{t('settings.news.sub')}</p>
        <button type="button" className={s.enabled ? 'chip active' : 'chip'} aria-pressed={s.enabled} onClick={() => void save({ enabled: !s.enabled })}>{t('settings.news.enable')}</button>
      </Section>
      {s.enabled && (
        <>
          <Section title={t('settings.news.topics')}>
            <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('settings.news.topics')}>
              {v.topics.map((x) => (
                <button key={x} type="button" className={s.topics.includes(x) ? 'chip active' : 'chip'} aria-pressed={s.topics.includes(x)} onClick={() => void save({ topics: toggle(s.topics, x) })}>{t(`news.topic.${x}`)}</button>
              ))}
            </div>
          </Section>
          <Section title={t('settings.news.countries')}>
            <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('settings.news.countries')}>
              {v.countries.map((c) => (
                <button key={c} type="button" className={countries.includes(c) ? 'chip active' : 'chip'} aria-pressed={countries.includes(c)} onClick={() => void save({ countries: toggle(countries, c) })}>{label(c)}</button>
              ))}
            </div>
          </Section>
          {v.limits.favorites && (
            <Section title={t('settings.news.favorite')}>
              <p className="muted small">{t('settings.news.favoriteHint')}</p>
              {s.favorites.map((f) => (
                <div key={f.feedUrl} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{f.name}</span>
                  <button type="button" className="link danger" onClick={() => void save({ favorites: s.favorites.filter((x) => x.feedUrl !== f.feedUrl) })}>{t('settings.news.remove')}</button>
                </div>
              ))}
              {s.favorites.length < v.limits.maxFavorites && (
                <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); setFound(null); void run(async () => setFound(await api<Found>('/api/news/feed-search', { method: 'POST', json: { query } })), ''); }}>
                  <label style={{ gridColumn: '1 / -1' }}>{t('settings.news.favorite')}<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
                  <button type="submit" className="btn secondary">{t('settings.news.search')}</button>
                </form>
              )}
              {found && (
                <div className="card">
                  <strong>{t('settings.news.found')}: {found.name}</strong>
                  <ul className="small muted">{found.sample.map((x) => <li key={x}>{x}</li>)}</ul>
                  <button type="button" className="btn" onClick={() => { void save({ favorites: [...s.favorites, { name: found.name, feedUrl: found.feedUrl }] }); setFound(null); setQuery(''); }}>{t('settings.news.use')}</button>
                </div>
              )}
            </Section>
          )}
        </>
      )}
      {view}
    </>
  );
}

/** Kleine Liste der Meldungen (Briefing-Karte): Satz, Quelle und Uhrzeit, Antippen öffnet den Artikel in einem neuen Tab */
export function NewsList({ items, locale }: { items: NewsEntry[]; locale: string }) {
  const t = useT();
  return (
    <ul className="news-list">
      {items.map((n) => (
        <li key={n.url}>
          <a href={n.url} target="_blank" rel="noopener noreferrer" aria-label={`${n.sentence} – ${n.source}. ${t('news.card.open')}`}>
            <span className="news-sentence">{n.sentence}</span>
            <span className="small muted">{n.source} · {new Date(n.publishedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
