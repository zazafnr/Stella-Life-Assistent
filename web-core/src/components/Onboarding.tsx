import { useMemo, useState } from 'react';
import {
  COUNTRIES, COUNTRY_LOCALE, TONES, TONE_INFO, countryName, isCountry, LOCALES, LOCALE_NAMES, onboardingSteps, schoolTerms,
  type AgeGroup, type Country, type Feature, type Locale, type LocationPermission, type OnboardingStep, type Situation, type Tone, type UserProfile,
} from '@stella/shared';
import { api, refreshMe, useStore, type Me } from '../store.ts';
import { rememberLocale, useLocale, useT } from '../i18n.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sky, StarMark, showToast } from '../ui/Decor.tsx';

const SITUATIONS: { id: Situation; icon: IconName }[] = [
  { id: 'school', icon: 'school' }, { id: 'university', icon: 'book' }, { id: 'work', icon: 'calendar' },
  { id: 'apprenticeship', icon: 'pen' }, { id: 'other', icon: 'sparkle' },
];

const AGES: AgeGroup[] = ['u14', '14-17', '18-24', '25-34', '35-49', '50+'];
/** Gespeichert wird weiterhin der deutsche Stufenname (Profil und Prompts kennen ihn so); angezeigt wird die Übersetzung. */
const LEVELS: [string, string][] = [['Unterstufe', 'lower'], ['Mittelstufe', 'middle'], ['Oberstufe', 'upper'], ['Berufsschule', 'vocational']];

const FEATURE_ICON: Record<Feature, IconName> = { mails: 'mail', planner: 'calendar', homework: 'book', shopping: 'plus', goals: 'star', finance: 'steps', health: 'heart' };
const FEATURE_ORDER: Feature[] = ['planner', 'mails', 'homework', 'shopping', 'goals', 'finance', 'health'];
/** Funktionen, die der Server gerade ausblendet (Schalter), tauchen in der Einführung nicht auf */
const featureVisible = (f: Feature, me: Me) => f !== 'finance' || !!me.flags?.finance;

const DEFAULT_FEATURES: Record<Situation, Feature[]> = {
  school: ['planner', 'homework', 'mails', 'health'],
  university: ['planner', 'mails', 'goals', 'health'],
  work: ['planner', 'mails', 'shopping', 'goals', 'health'],
  apprenticeship: ['planner', 'mails', 'shopping', 'goals', 'health'],
  other: ['planner', 'mails', 'shopping', 'goals'],
};

type StepId = OnboardingStep;
const BRIEFING_TIMES = ['06:30', '07:00', '07:30', '08:00'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Land aus der Region des Browsers (de-AT → AT), sonst das typische Land der Sprache */
function guessCountry(locale: Locale): Country {
  for (const tag of (typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])) {
    const region = tag.split('-')[1]?.toUpperCase();
    if (isCountry(region) && region !== 'OTHER') return region;
  }
  return (Object.entries(COUNTRY_LOCALE).find(([, l]) => l === locale)?.[0] as Country | undefined) ?? 'OTHER';
}

/** Schreibschrift-Mockup eines Hefts für die FreeNotes-Folie */
function NotebookMockup({ alt }: { alt: string }) {
  return (
    <svg className="onb-notebook" viewBox="0 0 280 150" role="img" aria-label={alt}>
      <rect x="4" y="4" width="272" height="142" rx="10" fill="#FFFDF7" stroke="#D9D3C4" />
      {[40, 66, 92, 118].map((y) => <line key={y} x1="20" x2="262" y1={y} y2={y} stroke="#C9DCF2" />)}
      <line x1="36" x2="36" y1="8" y2="142" stroke="#F0B7B7" />
      <path d="M46 36c6-12 10 8 16-2s8 4 14-4 8 6 14-2 10 6 16-2 8 4 14-2 8 6 14-2 10 4 16-2" fill="none" stroke="#2F4A8A" strokeWidth="2" strokeLinecap="round" />
      <path d="M46 62c8-10 10 6 18-2s8 6 16-2 8 6 16-2 10 4 16-2 8 6 14-2 10 4 14-2" fill="none" stroke="#2F4A8A" strokeWidth="2" strokeLinecap="round" />
      <path d="M46 88c6-10 12 6 18-2s10 4 16-2 8 6 16-2" fill="none" stroke="#2F4A8A" strokeWidth="2" strokeLinecap="round" />
      <path d="M46 98h56" stroke="#2F4A8A" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Einführung in ein paar Klicks: Sprache, wer bist du, wobei soll Stella helfen. Jederzeit „Überspringen“.
 * `startAt = 'situation'` öffnet sie als „Profil bearbeiten“ ohne Begrüßung.
 */
export function Onboarding({ onDone, startAt = 'language', situations, studentsHint }: { onDone: (after?: 'settings') => void; startAt?: StepId; /** welche Lebenssituationen die App anbietet (Standard: alle) */ situations?: Situation[]; /** Adresse von Stella for Students: unter der Auswahl erscheint „Du gehst zur Schule oder studierst?“ mit Link */ studentsHint?: string }) {
  const me = useStore((s) => s.me) as Me;
  const t = useT();
  const locale = useLocale();
  const p = me.settings.profile;
  const [d, setD] = useState({
    name: me.name,
    country: (isCountry(me.settings.country) ? me.settings.country : guessCountry(locale)) as Country,
    situation: p?.situation as Situation | undefined,
    age: p?.ageGroup as AgeGroup | undefined,
    level: p?.school?.level ?? '',
    uni: p?.university?.name ?? '',
    days: p?.workHours?.days ?? [1, 2, 3, 4, 5],
    start: p?.workHours?.start ?? '09:00',
    end: p?.workHours?.end ?? '17:00',
    commute: !!p?.workHours?.commute,
    features: p?.features ?? ([] as Feature[]),
    tone: (me.settings.tone ?? 'nett') as Tone,
    briefing: me.settings.briefing ?? 'auto',
    location: me.settings.locationPermission as LocationPermission | undefined,
    notifyFreenotes: !!me.settings.notify?.freenotes,
    /** 'yes': Kalender-Abo geöffnet, 'no': Termine nur in Stella */
    calendar: undefined as 'yes' | 'no' | undefined,
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const terms = schoolTerms(locale, d.country);
  const weekday = (n: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, n)));

  const steps = useMemo<StepId[]>(() => onboardingSteps(d.situation), [d.situation]);
  const [i, setI] = useState(() => Math.max(0, steps.indexOf(startAt)));
  const step = steps[Math.min(i, steps.length - 1)]!;
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState<'settings' | undefined>();

  /** Sprache sofort umschalten (alle Texte der Einführung wechseln) und im Konto merken */
  const pickLocale = (l: Locale) => {
    rememberLocale(l);
    // Passt das Land nicht zur neuen Sprache, schlagen wir das typische Land der Sprache vor (änderbar)
    setD((x) => (COUNTRY_LOCALE[x.country] === l ? x : { ...x, country: guessCountry(l) }));
    void api('/api/settings', { method: 'PATCH', json: { locale: l } }).catch(() => {});
  };

  const pickSituation = (s: Situation) => setD((x) => ({ ...x, situation: s, features: x.situation === s && x.features.length ? x.features : DEFAULT_FEATURES[s] }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const canNext = step === 'name' ? !!d.name.trim() : step === 'situation' ? !!d.situation
    : step === 'details' && (d.situation === 'work' || d.situation === 'apprenticeship') ? d.days.length > 0 && d.end > d.start : true;

  const profile = (): UserProfile => ({
    situation: d.situation!,
    ...(d.age ? { ageGroup: d.age } : {}),
    features: d.features,
    ...(d.situation === 'school' && d.level ? { school: { level: d.level } } : {}),
    ...(d.situation === 'university' && d.uni.trim() ? { university: { name: d.uni.trim() } } : {}),
    ...((d.situation === 'work' || d.situation === 'apprenticeship') ? { workHours: { days: d.days, start: d.start, end: d.end, ...(d.commute ? { commute: true } : {}) } } : {}),
  });

  async function finish() {
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PATCH', json: {
        name: d.name.trim(), tone: d.tone, briefing: d.briefing, locale, country: d.country,
        ...(d.location ? { locationPermission: d.location } : {}), notifyFreenotes: d.notifyFreenotes,
      } });
      await api('/api/profile', { method: 'PUT', json: profile() });
      await refreshMe();
      onDone(after);
    } catch (err) {
      showToast((err as Error).message, true);
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PATCH', json: { locale, country: d.country } });
      await api('/api/profile/skip', { method: 'POST' });
      await refreshMe();
      onDone();
    } catch (err) {
      showToast((err as Error).message, true);
      setBusy(false);
    }
  }

  /** „Standort freigeben“: erst nach der Erklär-Folie die Systemabfrage des Browsers auslösen */
  function allowLocation() {
    if (!('geolocation' in navigator)) { set('location', 'denied'); return; }
    navigator.geolocation.getCurrentPosition(() => set('location', 'granted'), () => set('location', 'denied'), { maximumAge: 600_000, timeout: 15_000 });
  }

  const setNotify = () => {
    set('notifyFreenotes', true);
    void api('/api/settings', { method: 'PATCH', json: { notifyFreenotes: true } }).catch(() => {});
  };

  const homeworkPl = terms.homeworkPlural;
  const days = d.days.map(weekday).join(', ');
  const briefingWhen = d.briefing === 'auto' ? t('onboarding.sum.briefingAuto') : t('onboarding.sum.briefingAt', { time: d.briefing });
  const summary = [
    d.situation === 'school' && t('onboarding.sum.school', { homework: homeworkPl }),
    d.situation === 'university' && t('onboarding.sum.university'),
    (d.situation === 'work' || d.situation === 'apprenticeship') && t('onboarding.sum.work', { days, start: d.start, end: d.end }),
    d.features.includes('mails') && t('onboarding.sum.mails'),
    d.features.includes('shopping') && t('onboarding.sum.shopping'),
    d.features.includes('goals') && t('onboarding.sum.goals'),
    d.calendar === 'yes' && t('onboarding.sum.calendar'),
    d.briefing !== 'off' && t('onboarding.sum.briefing', { when: briefingWhen }),
    t('onboarding.sum.tone', { tone: t(`tone.${d.tone}`).toLowerCase() }),
    me.flags?.telegram && t('onboarding.sum.telegram'),
  ].filter(Boolean) as string[];

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={t('onboarding.aria')}>
      <Sky />
      <div className="onb-top">
        <div className="onb-dots" aria-label={t('onboarding.step', { n: i + 1, total: steps.length })}>{steps.map((s, j) => <span key={s} className={j === i ? 'on' : j < i ? 'past' : ''} />)}</div>
        {step !== 'done' && <button type="button" className="link small" disabled={busy} onClick={() => void skip()}>{t('common.skip')}</button>}
      </div>

      <div className="onb-card rise" key={step}>
        {step === 'language' && (
          <>
            <h1 className="display">{t('onboarding.language.title')}</h1>
            <div className="choice-grid" role="radiogroup" aria-label={t('onboarding.language.title')}>
              {LOCALES.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={locale === l} lang={l} className={locale === l ? 'choice on' : 'choice'} onClick={() => pickLocale(l)}>
                  <strong>{LOCALE_NAMES[l]}</strong>
                </button>
              ))}
            </div>
            <label className="field">{t('onboarding.country.label')}
              <select value={d.country} onChange={(e) => set('country', e.target.value as Country)}>
                {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
              </select>
            </label>
            <p className="muted small">{t('onboarding.country.sub')} {t('onboarding.language.sub')}</p>
          </>
        )}
        {step === 'welcome' && (
          <>
            <span className="onb-star"><StarMark size={40} /></span>
            <h1 className="display">{t('onboarding.welcome.title')}</h1>
            <p className="muted">{t('onboarding.welcome.text')}</p>
          </>
        )}
        {step === 'name' && (
          <>
            <h1 className="display">{t('onboarding.name.title')}</h1>
            <label className="field">{t('onboarding.name.label')}<input autoFocus autoComplete="given-name" value={d.name} onChange={(e) => set('name', e.target.value)} /></label>
          </>
        )}
        {step === 'situation' && (
          <>
            <h1 className="display">{t('onboarding.situation.title')}</h1>
            <div className="choice-grid">
              {SITUATIONS.filter((s) => !situations || situations.includes(s.id)).map((s) => (
                <button key={s.id} type="button" className={d.situation === s.id ? 'choice on' : 'choice'} onClick={() => pickSituation(s.id)} aria-pressed={d.situation === s.id}>
                  <span className="icon-tile blue"><Icon name={s.icon} size={22} /></span>
                  <strong>{t(`onboarding.situation.${s.id}.label`)}</strong>
                  <span className="small muted">{t(`onboarding.situation.${s.id}.sub`, { homework: cap(homeworkPl) })}</span>
                </button>
              ))}
            </div>
            {studentsHint && <p className="muted small" style={{ margin: 0 }}>{t('onboarding.studentsHint')} <a href={studentsHint} className="link">{t('onboarding.studentsHint.link')} →</a></p>}
          </>
        )}
        {step === 'freenotes' && (
          <>
            <h1 className="display">{t('onboarding.freenotes.title', { homework: homeworkPl })}</h1>
            <NotebookMockup alt={t('onboarding.freenotes.alt')} />
            <p>{t('onboarding.freenotes.text', { homework: homeworkPl })}</p>
            {me.flags?.freenotesUrl
              ? <a className="btn" href={me.flags.freenotesUrl} target="_blank" rel="noopener noreferrer">{t('onboarding.freenotes.get')}</a>
              : d.notifyFreenotes
                ? <p className="muted small" role="status"><Icon name="check" size={14} /> {t('onboarding.freenotes.notified')}</p>
                : <>
                    <p className="muted small">{t('onboarding.freenotes.soon')}</p>
                    <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={setNotify}><Icon name="bell" size={16} /> {t('onboarding.freenotes.notify')}</button>
                  </>}
          </>
        )}
        {step === 'age' && (
          <>
            <h1 className="display">{t('onboarding.age.title')}</h1>
            <p className="muted small">{t('onboarding.age.sub')}</p>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {AGES.map((id) => <button key={id} type="button" className={d.age === id ? 'chip active' : 'chip'} onClick={() => set('age', d.age === id ? undefined : id)}>{id === 'u14' ? t('onboarding.age.under14') : id.replace('-', '–')}</button>)}
            </div>
          </>
        )}
        {step === 'details' && d.situation === 'school' && (
          <>
            <h1 className="display">{t('onboarding.level.title')}</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {LEVELS.map(([value, key]) => <button key={value} type="button" className={d.level === value ? 'chip active' : 'chip'} onClick={() => set('level', d.level === value ? '' : value)}>{t(`onboarding.level.${key}`)}</button>)}
            </div>
            <p className="muted small">{t('onboarding.level.sub')}</p>
            <button type="button" className={after ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => setAfter(after ? undefined : 'settings')}>{t('onboarding.afterSettings')}</button>
          </>
        )}
        {step === 'details' && d.situation === 'university' && (
          <>
            <h1 className="display">{t('onboarding.uni.title')}</h1>
            <label className="field">{t('onboarding.uni.label')}<input value={d.uni} placeholder={t('onboarding.uni.placeholder')} onChange={(e) => set('uni', e.target.value)} /></label>
            <p className="muted small">{t('onboarding.uni.sub')}</p>
          </>
        )}
        {step === 'details' && (d.situation === 'work' || d.situation === 'apprenticeship') && (
          <>
            <h1 className="display">{t('onboarding.work.title')}</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('onboarding.work.days')}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} type="button" className={d.days.includes(n) ? 'chip active' : 'chip'} aria-pressed={d.days.includes(n)} onClick={() => set('days', toggle(d.days, n).sort())}>{weekday(n)}</button>)}
            </div>
            <div className="form-grid two">
              <label className="field">{t('onboarding.work.from')}<input type="time" value={d.start} onChange={(e) => set('start', e.target.value)} /></label>
              <label className="field">{t('onboarding.work.to')}<input type="time" value={d.end} onChange={(e) => set('end', e.target.value)} /></label>
            </div>
            {d.end <= d.start && <p className="error-text small">{t('onboarding.work.endError')}</p>}
            <button type="button" className={d.commute ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => set('commute', !d.commute)} aria-pressed={d.commute}>{t('onboarding.work.commute')}</button>
            <p className="muted small">{t('onboarding.work.sub', { end: d.end })}</p>
          </>
        )}
        {step === 'features' && (
          <>
            <h1 className="display">{t('onboarding.features.title')}</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {FEATURE_ORDER.filter((f) => (f !== 'homework' || d.situation === 'school') && featureVisible(f, me)).map((f) => (
                <button key={f} type="button" className={d.features.includes(f) ? 'chip active' : 'chip'} aria-pressed={d.features.includes(f)} onClick={() => set('features', toggle(d.features, f))}>
                  <Icon name={FEATURE_ICON[f]} size={15} /> {f === 'homework' ? cap(homeworkPl) : t(`onboarding.feature.${f}`)}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 'location' && (
          <>
            <h1 className="display">{t('onboarding.location.title')}</h1>
            <ul className="onb-summary">
              <li><Icon name="pin" size={18} />{t('onboarding.location.r1')}</li>
              <li><Icon name="calendar" size={18} />{t('onboarding.location.r2')}</li>
              <li><Icon name="cloud" size={18} />{t('onboarding.location.r3')}</li>
            </ul>
            <p className="muted small">{t('onboarding.location.fine')}</p>
            {d.location === 'granted' && <p className="muted small" role="status"><Icon name="check" size={14} /> {t('onboarding.location.granted')}</p>}
            {d.location === 'denied' && <p className="muted small" role="status">{t('onboarding.location.denied')}</p>}
            {d.location !== 'granted' && (
              <div className="button-row">
                <button type="button" className="btn" onClick={allowLocation}>{t('onboarding.location.allow')}</button>
                <button type="button" className="btn secondary" onClick={() => { set('location', d.location ?? 'later'); setI(i + 1); }}>{t('onboarding.location.later')}</button>
              </div>
            )}
          </>
        )}
        {step === 'calendar' && (
          <>
            <h1 className="display">{t('onboarding.calendar.title')}</h1>
            <p className="muted">{t('onboarding.calendar.text')}</p>
            {d.calendar === 'yes' && <p className="muted small" role="status"><Icon name="check" size={14} /> {t('onboarding.calendar.added')}</p>}
            {d.calendar !== 'yes' && (
              <div className="button-row">
                {/* webcal:// öffnet auf iPhone und Mac direkt „Abonnieren“; Google und Outlook nehmen denselben Link unter Einstellungen → Kalenderabo */}
                <a className="btn" href={`${me.ingestUrl.replace(/^https?:\/\//, 'webcal://')}/calendar.ics`} onClick={() => set('calendar', 'yes')}>{t('onboarding.calendar.yes')}</a>
                <button type="button" className="btn secondary" onClick={() => { set('calendar', 'no'); setI(i + 1); }}>{t('onboarding.calendar.no')}</button>
              </div>
            )}
          </>
        )}
        {step === 'mail' && (
          <>
            <h1 className="display">{t('onboarding.mail.title')}</h1>
            <p className="muted">{t('onboarding.mail.text')}</p>
            <button type="button" className={after ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => setAfter(after ? undefined : 'settings')}>{t('onboarding.mail.settings')}</button>
            <p className="muted small">{t('onboarding.mail.later')}</p>
          </>
        )}
        {step === 'tone' && (
          <>
            <h1 className="display">{t('onboarding.tone.title')}</h1>
            <div className="tone-grid" role="radiogroup" aria-label={t('onboarding.tone.title')}>
              {TONES.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={d.tone === x} className={d.tone === x ? 'tone active' : 'tone'} onClick={() => set('tone', x)}>
                  <span className="tone-emoji" aria-hidden="true">{TONE_INFO[x].emoji}</span><span className="tone-label">{t(`tone.${x}`)}</span>
                </button>
              ))}
            </div>
            <p className="tone-example" key={d.tone}>„{t(`tone.${d.tone}.example`)}“</p>
          </>
        )}
        {step === 'briefing' && (
          <>
            <h1 className="display">{t('onboarding.briefing.title')}</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {[['auto', t('onboarding.briefing.auto')], ...BRIEFING_TIMES.map((x) => [x, x]), ['off', t('onboarding.briefing.off')]].map(([id, label]) => (
                <button key={id} type="button" className={d.briefing === id ? 'chip active' : 'chip'} onClick={() => set('briefing', id!)}>{label}</button>
              ))}
            </div>
            <p className="muted small">{t('onboarding.briefing.sub')}</p>
          </>
        )}
        {step === 'done' && (
          <>
            <span className="onb-star"><StarMark size={40} /></span>
            <h1 className="display">{t('onboarding.done.title', { name: d.name.trim().split(' ')[0]! })}</h1>
            <p className="muted">{t('onboarding.done.lead')}</p>
            <ul className="onb-summary">{summary.map((x) => <li key={x}><Icon name="check" size={16} />{x}</li>)}</ul>
          </>
        )}
      </div>

      <div className="onb-nav">
        {i > 0 && step !== 'done' ? <button type="button" className="btn secondary" disabled={busy} onClick={() => setI(i - 1)}>{t('common.back')}</button> : <span />}
        {step === 'done'
          ? <button type="button" className="btn" disabled={busy || !d.situation} onClick={() => void finish()}>{busy ? t('onboarding.wait') : t('onboarding.done.start')}</button>
          : <button type="button" className="btn" disabled={!canNext} onClick={() => setI(i + 1)}>{t('common.next')}</button>}
      </div>
    </div>
  );
}
