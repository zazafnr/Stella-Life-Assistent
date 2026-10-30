import { useMemo, useState } from 'react';
import { TONES, TONE_INFO, type AgeGroup, type Feature, type Situation, type Tone, type UserProfile } from '@stella/shared';
import { api, refreshMe, useStore, type Me } from '../store.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sky, StarMark, showToast } from '../ui/Decor.tsx';

const SITUATIONS: { id: Situation; icon: IconName; label: string; sub: string }[] = [
  { id: 'school', icon: 'school', label: 'Schule', sub: 'HÜs, Tests, Stundenplan' },
  { id: 'university', icon: 'book', label: 'Studium', sub: 'Lehrveranstaltungen, Prüfungen' },
  { id: 'work', icon: 'calendar', label: 'Job', sub: 'Arbeitszeiten, Termine, Alltag' },
  { id: 'apprenticeship', icon: 'pen', label: 'Lehre', sub: 'Betrieb und Berufsschule' },
  { id: 'other', icon: 'sparkle', label: 'Etwas anderes', sub: 'Elternzeit, Pause, alles Mögliche' },
];

const AGES: [AgeGroup, string][] = [['u14', 'unter 14'], ['14-17', '14–17'], ['18-24', '18–24'], ['25-34', '25–34'], ['35-49', '35–49'], ['50+', '50+']];
const LEVELS = ['Unterstufe', 'Mittelstufe', 'Oberstufe', 'Berufsschule'];
const DAYS: [number, string][] = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [7, 'So']];

const FEATURE_INFO: Record<Feature, { icon: IconName; label: string }> = {
  mails: { icon: 'mail', label: 'Mails sortieren' },
  planner: { icon: 'calendar', label: 'Planer & Erinnerungen' },
  homework: { icon: 'book', label: 'Hausübungen' },
  shopping: { icon: 'plus', label: 'Einkaufsliste' },
  goals: { icon: 'star', label: 'Ziele' },
  finance: { icon: 'steps', label: 'Ausgaben' },
  health: { icon: 'heart', label: 'Gesundheit' },
};
const FEATURE_ORDER: Feature[] = ['planner', 'mails', 'homework', 'shopping', 'goals', 'finance', 'health'];

const DEFAULT_FEATURES: Record<Situation, Feature[]> = {
  school: ['planner', 'homework', 'mails', 'health'],
  university: ['planner', 'mails', 'goals', 'health'],
  work: ['planner', 'mails', 'shopping', 'goals', 'health'],
  apprenticeship: ['planner', 'mails', 'shopping', 'goals', 'health'],
  other: ['planner', 'mails', 'shopping', 'goals'],
};

type StepId = 'welcome' | 'name' | 'situation' | 'age' | 'details' | 'features' | 'mail' | 'tone' | 'briefing' | 'done';

const BRIEFINGS: [string, string][] = [['auto', 'Automatisch'], ['06:30', '06:30'], ['07:00', '07:00'], ['07:30', '07:30'], ['08:00', '08:00'], ['off', 'Kein Briefing']];

/**
 * Einführung in ein paar Klicks: wer bist du, wobei soll Stella helfen. Jederzeit „Überspringen“.
 * `startAt = 'situation'` öffnet sie als „Profil bearbeiten“ ohne Begrüßung.
 */
export function Onboarding({ onDone, startAt = 'welcome' }: { onDone: (after?: 'settings') => void; startAt?: StepId }) {
  const me = useStore((s) => s.me) as Me;
  const p = me.settings.profile;
  const [d, setD] = useState({
    name: me.name,
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
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));

  const steps = useMemo<StepId[]>(() => {
    const hasDetails = d.situation === 'school' || d.situation === 'university' || d.situation === 'work' || d.situation === 'apprenticeship';
    return ['welcome', 'name', 'situation', 'age', ...(hasDetails ? ['details' as const] : []), 'features', 'mail', 'tone', 'briefing', 'done'];
  }, [d.situation]);
  const [i, setI] = useState(() => Math.max(0, steps.indexOf(startAt)));
  const step = steps[Math.min(i, steps.length - 1)]!;
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState<'settings' | undefined>();

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
      await api('/api/settings', { method: 'PATCH', json: { name: d.name.trim(), tone: d.tone, briefing: d.briefing } });
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
      await api('/api/profile/skip', { method: 'POST' });
      await refreshMe();
      onDone();
    } catch (err) {
      showToast((err as Error).message, true);
      setBusy(false);
    }
  }

  const summary = [
    d.situation === 'school' && 'Stundenplan, HÜs und Tests im Blick – mit Lernplänen.',
    d.situation === 'university' && 'Prüfungen und Lernpläne im Blick.',
    (d.situation === 'work' || d.situation === 'apprenticeship') && `Plant nie in deine Arbeitszeit (${d.days.map((x) => DAYS[x - 1]![1]).join(', ')} ${d.start}–${d.end}). „Nach der Arbeit“ heißt ${d.end}.`,
    d.features.includes('mails') && 'Sortiert deine Mails: wichtig, neutral, unwichtig, Werbung.',
    d.features.includes('shopping') && 'Führt deine Einkaufsliste und erinnert an Erledigungen.',
    d.features.includes('goals') && 'Hilft dir, Ziele im Auge zu behalten.',
    d.briefing !== 'off' && `Schickt dir ein Morgen-Briefing (${d.briefing === 'auto' ? 'automatisch' : `um ${d.briefing}`}).`,
    `Schreibt im Ton „${TONE_INFO[d.tone].label.toLowerCase()}“.`,
  ].filter(Boolean) as string[];

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Einführung">
      <Sky />
      <div className="onb-top">
        <div className="onb-dots" aria-label={`Schritt ${i + 1} von ${steps.length}`}>{steps.map((s, j) => <span key={s} className={j === i ? 'on' : j < i ? 'past' : ''} />)}</div>
        {step !== 'done' && <button type="button" className="link small" disabled={busy} onClick={() => void skip()}>Überspringen</button>}
      </div>

      <div className="onb-card rise" key={step}>
        {step === 'welcome' && (
          <>
            <span className="onb-star"><StarMark size={40} /></span>
            <h1 className="display">Schön, dass du da bist!</h1>
            <p className="muted">Ich bin Stella und helfe dir im Alltag. Mit ein paar Klicks stelle ich mich auf dein Leben ein – das dauert eine Minute.</p>
          </>
        )}
        {step === 'name' && (
          <>
            <h1 className="display">Wie soll ich dich nennen?</h1>
            <label className="field">Dein Name<input autoFocus autoComplete="given-name" value={d.name} onChange={(e) => set('name', e.target.value)} /></label>
          </>
        )}
        {step === 'situation' && (
          <>
            <h1 className="display">Was trifft auf dich zu?</h1>
            <div className="choice-grid">
              {SITUATIONS.map((s) => (
                <button key={s.id} type="button" className={d.situation === s.id ? 'choice on' : 'choice'} onClick={() => pickSituation(s.id)} aria-pressed={d.situation === s.id}>
                  <span className="icon-tile blue"><Icon name={s.icon} size={22} /></span>
                  <strong>{s.label}</strong><span className="small muted">{s.sub}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 'age' && (
          <>
            <h1 className="display">Wie alt bist du?</h1>
            <p className="muted small">Damit passe ich Ton und Vorschläge an. Du kannst das auch offen lassen.</p>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {AGES.map(([id, label]) => <button key={id} type="button" className={d.age === id ? 'chip active' : 'chip'} onClick={() => set('age', d.age === id ? undefined : id)}>{label}</button>)}
            </div>
          </>
        )}
        {step === 'details' && d.situation === 'school' && (
          <>
            <h1 className="display">In welcher Stufe bist du?</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {LEVELS.map((l) => <button key={l} type="button" className={d.level === l ? 'chip active' : 'chip'} onClick={() => set('level', d.level === l ? '' : l)}>{l}</button>)}
            </div>
            <p className="muted small">WebUntis und deine Schulbücher richtest du danach in den Einstellungen ein – dort tippst du „Verbindungen“ an.</p>
            <button type="button" className={after ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => setAfter(after ? undefined : 'settings')}>Danach gleich zu den Einstellungen</button>
          </>
        )}
        {step === 'details' && d.situation === 'university' && (
          <>
            <h1 className="display">Wo studierst du?</h1>
            <label className="field">Uni oder Hochschule<input value={d.uni} placeholder="z. B. Uni Wien" onChange={(e) => set('uni', e.target.value)} /></label>
            <p className="muted small">Deinen Stundenplan holst du dir als Kalender-Abo in die App: Einstellungen → Health, SMS & Kalender.</p>
          </>
        )}
        {step === 'details' && (d.situation === 'work' || d.situation === 'apprenticeship') && (
          <>
            <h1 className="display">Wann arbeitest du?</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label="Arbeitstage">
              {DAYS.map(([n, label]) => <button key={n} type="button" className={d.days.includes(n) ? 'chip active' : 'chip'} aria-pressed={d.days.includes(n)} onClick={() => set('days', toggle(d.days, n).sort())}>{label}</button>)}
            </div>
            <div className="form-grid two">
              <label className="field">von<input type="time" value={d.start} onChange={(e) => set('start', e.target.value)} /></label>
              <label className="field">bis<input type="time" value={d.end} onChange={(e) => set('end', e.target.value)} /></label>
            </div>
            {d.end <= d.start && <p className="error-text small">Das Ende muss nach dem Beginn liegen.</p>}
            <button type="button" className={d.commute ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => set('commute', !d.commute)} aria-pressed={d.commute}>Ich pendle</button>
            <p className="muted small">In dieser Zeit plane ich nichts ein, und „nach der Arbeit“ heißt für mich {d.end}.</p>
          </>
        )}
        {step === 'features' && (
          <>
            <h1 className="display">Wobei soll Stella helfen?</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {FEATURE_ORDER.filter((f) => f !== 'homework' || d.situation === 'school').map((f) => (
                <button key={f} type="button" className={d.features.includes(f) ? 'chip active' : 'chip'} aria-pressed={d.features.includes(f)} onClick={() => set('features', toggle(d.features, f))}>
                  <Icon name={FEATURE_INFO[f].icon} size={15} /> {FEATURE_INFO[f].label}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 'mail' && (
          <>
            <h1 className="display">Postfach verbinden?</h1>
            <p className="muted">Wenn du magst, sortiert Stella deine Mails in Wichtig, Neutral, Unwichtig und Werbung. Das geht mit Gmail (per „Mit Google anmelden“) oder iCloud.</p>
            <button type="button" className={after ? 'chip active' : 'chip'} style={{ alignSelf: 'flex-start' }} onClick={() => setAfter(after ? undefined : 'settings')}>Danach zu den Einstellungen → E-Mail</button>
            <p className="muted small">Du kannst das jederzeit später machen.</p>
          </>
        )}
        {step === 'tone' && (
          <>
            <h1 className="display">Wie soll ich schreiben?</h1>
            <div className="tone-grid" role="radiogroup" aria-label="Ton">
              {TONES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={d.tone === t} className={d.tone === t ? 'tone active' : 'tone'} onClick={() => set('tone', t)}>
                  <span className="tone-emoji" aria-hidden="true">{TONE_INFO[t].emoji}</span><span className="tone-label">{TONE_INFO[t].label}</span>
                </button>
              ))}
            </div>
            <p className="tone-example" key={d.tone}>„{TONE_INFO[d.tone].example}“</p>
          </>
        )}
        {step === 'briefing' && (
          <>
            <h1 className="display">Wann soll dein Morgen-Briefing kommen?</h1>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {BRIEFINGS.map(([id, label]) => <button key={id} type="button" className={d.briefing === id ? 'chip active' : 'chip'} onClick={() => set('briefing', id)}>{label}</button>)}
            </div>
            <p className="muted small">Ein kurzer Überblick über deinen Tag. „Automatisch“ richtet sich nach deinem Stundenplan, sonst nach dem Vormittag.</p>
          </>
        )}
        {step === 'done' && (
          <>
            <span className="onb-star"><StarMark size={40} /></span>
            <h1 className="display">Alles bereit, {d.name.trim().split(' ')[0]}!</h1>
            <p className="muted">Das macht Stella jetzt für dich:</p>
            <ul className="onb-summary">{summary.map((t) => <li key={t}><Icon name="check" size={16} />{t}</li>)}</ul>
          </>
        )}
      </div>

      <div className="onb-nav">
        {i > 0 && step !== 'done' ? <button type="button" className="btn secondary" disabled={busy} onClick={() => setI(i - 1)}>Zurück</button> : <span />}
        {step === 'done'
          ? <button type="button" className="btn" disabled={busy || !d.situation} onClick={() => void finish()}>{busy ? 'Einen Moment …' : 'Los geht’s'}</button>
          : <button type="button" className="btn" disabled={!canNext} onClick={() => setI(i + 1)}>Weiter</button>}
      </div>
    </div>
  );
}
