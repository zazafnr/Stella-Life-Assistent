// Neue Karten für „Heute“ (Design-Auswahl „Extras 1“, „Ziele A“, „News B“), wie in der iOS-App (Design/TodayCards.swift):
// Begrüßung als Wetter-Karte, Ziele als Fortschritts-Ringe, News als Story-Karussell mit Bildern.

import type { ReactNode } from 'react';
import type { GoalProgress, NewsEntry } from '@stella/shared';
import { useAnimMode, useWeather } from '../weather.ts';
import { useLocale, useT } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';

/** kräftige Verläufe je Wetter, damit weiße Schrift überall lesbar ist (dieselben Farben wie iOS) */
function heroLook(w: { type: string; day: boolean } | null): { bg: string; art: 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' } {
  if (!w) return { bg: 'linear-gradient(135deg, #3E8FE8, #79BDFF)', art: 'sun' };
  if (!w.day) return { bg: 'linear-gradient(135deg, #0A1230, #2A3A6B)', art: 'moon' };
  switch (w.type) {
    case 'clear': return { bg: 'linear-gradient(135deg, #3E8FE8, #79BDFF)', art: 'sun' };
    case 'partly': return { bg: 'linear-gradient(135deg, #5A9BDE, #93C2EE)', art: 'sun' };
    case 'drizzle': case 'rain': return { bg: 'linear-gradient(135deg, #5E7690, #8499AF)', art: 'rain' };
    case 'heavy_rain': case 'thunder': return { bg: 'linear-gradient(135deg, #2F3A4C, #4C5A6E)', art: 'rain' };
    case 'snow': case 'sleet': return { bg: 'linear-gradient(135deg, #6F88AA, #9DB2CE)', art: 'snow' };
    default: return { bg: 'linear-gradient(135deg, #7F93AA, #A9B8C9)', art: 'cloud' };
  }
}

/** Begrüßung oben auf „Heute“ in einer Karte, die wie das Wetter draußen aussieht */
export function WeatherHero({ title, dateLabel, actions }: { title: string; dateLabel: string; actions?: ReactNode }) {
  const t = useT();
  const w = useWeather();
  const anim = useAnimMode();
  const look = heroLook(w);
  return (
    <header className={`weather-hero art-${look.art}`} style={{ background: look.bg }} data-still={anim === 'off' ? '' : undefined}>
      <span className="wh-art" aria-hidden="true" />
      <div className="wh-text">
        <div className="wh-when">{dateLabel}</div>
        {w && <div className="wh-temp" aria-label={t('weather.chip', { type: t(`weather.type.${w.type}`), temp: w.temp })}>{w.temp}°</div>}
        <h1 className="display">{title}</h1>
        {w && <div className="wh-type">{t(`weather.type.${w.type}`)}</div>}
      </div>
      {actions && <div className="wh-actions">{actions}</div>}
    </header>
  );
}

const RING_COLORS = ['var(--blue)', '#34C77B', '#FF7EB3'];
const num = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/** Ziele dieser Woche als Ringe direkt unter der Begrüßung */
export function GoalRings({ goals, onOpen }: { goals: GoalProgress[]; onOpen: () => void }) {
  const t = useT();
  if (!goals.length) return null;
  return (
    <button type="button" className="goal-rings" onClick={onOpen} aria-label={t('today.yourGoals')}>
      <span className="panel-head" style={{ margin: 0 }}><span className="eyebrow">{t('today.yourGoals')}</span><Icon name="chevron" size={16} /></span>
      <span className="goal-rings-row">
        {goals.slice(0, 3).map((g, i) => {
          const p = g.weekTarget > 0 ? Math.min(1, g.weekValue / g.weekTarget) : 0;
          const c = RING_COLORS[i % 3];
          return (
            <span key={g.id} className="goal-ring">
              <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
                <circle cx="32" cy="32" r="26" fill="none" stroke={c} strokeOpacity=".16" strokeWidth="8" />
                <circle cx="32" cy="32" r="26" fill="none" stroke={c} strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${(p * 163.4).toFixed(1)} 163.4`} transform="rotate(-90 32 32)" />
                <text x="32" y="37" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">{p >= 1 ? '✓' : `${num(g.weekValue)}/${num(g.weekTarget)}`}</text>
              </svg>
              <span className="goal-ring-title">{g.title}</span>
            </span>
          );
        })}
      </span>
    </button>
  );
}

const FALLBACKS = ['linear-gradient(135deg, #4B8FE0, #173A6B)', 'linear-gradient(135deg, #B9A7FF, #5B43D8)', 'linear-gradient(135deg, #FF9FC2, #C0306E)', 'linear-gradient(135deg, #7BD3A0, #1F7A4D)'];
const TOPIC_TONE: Record<string, string> = { tech: 'blue', science: 'blue', climate: 'green', health: 'green', sport: 'pink', culture: 'pink' };

/** Story-Karussell: große Bildkarten zum Durchwischen, Titel auf dem Bild */
export function NewsStories({ items }: { items: NewsEntry[] }) {
  const t = useT();
  const locale = useLocale();
  if (!items.length) return null;
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const ago = (iso: string) => {
    const h = Math.round((Date.parse(iso) - Date.now()) / 3_600_000);
    return Math.abs(h) < 24 ? rel.format(h, 'hour') : rel.format(Math.round(h / 24), 'day');
  };
  return (
    <section className="news-stories" aria-label={t('ios.your.news')}>
      <span className="eyebrow">{t('ios.your.news')}</span>
      <div className="news-strip">
        {items.map((n, i) => (
          <a key={n.url} className="news-story" href={n.url} target="_blank" rel="noopener noreferrer"
            style={{ backgroundImage: n.image ? `url("${n.image.replace(/"/g, '%22')}"), ${FALLBACKS[i % 4]}` : FALLBACKS[i % 4] }}
            aria-label={`${n.sentence} – ${n.source}. ${t('news.card.open')}`}>
            <span className="ns-shade" aria-hidden="true" />
            <span className="ns-body">
              {n.topic && <span className={`ns-topic ${TOPIC_TONE[n.topic] ?? 'gold'}`}>{t(`news.topic.${n.topic}`)}</span>}
              <span className="ns-title">{n.sentence}</span>
              <span className="ns-src">{n.favorite && '★ '}{n.source} · {ago(n.publishedAt)}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
