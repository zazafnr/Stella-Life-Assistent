import { useEffect, useState, type ReactNode } from 'react';
import { COUNTRIES, countryName, LOCALES, LOCALE_NAMES, TONE_INFO, TONES, type Tone } from '@stella/shared';
import { useLocale, useT } from '../i18n.ts';
import { api, logout, logoutLocal, meHas, meIsSchool, refreshMe, useStore, type Me } from '../store.ts';
import { enablePush, isIos, isStandalone, pushPermission } from '../push.ts';
import { Copy, Section, useAction } from './settings/ui.tsx';
import { Books } from './settings/Books.tsx';
import { Mail } from './settings/Mail.tsx';
import { Untis } from './settings/Untis.tsx';
import { Handwriting } from './settings/Handwriting.tsx';
import { Server } from './settings/Server.tsx';
import { PlanSheet } from './settings/Plan.tsx';
import { Addresses } from './settings/Addresses.tsx';
import { FinanceSetup } from './settings/Finance.tsx';
import { ActionLog, MemoryView, Permissions } from './settings/Assistant.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Sheet, Sky, StarMark, Switch, showToast } from '../ui/Decor.tsx';
import { VERSION } from '../version.ts';

type SheetId = 'plan' | 'books' | 'untis' | 'mail' | 'notes' | 'health' | 'finance' | 'notify' | 'ai' | 'perms' | 'memory' | 'log' | 'server' | 'addresses' | 'delete';

interface CostSummary { totalMicroUsd: number; requests: number }
interface AiStatusData {
  configured: boolean; chain: string[]; visionChain: string[]; coolingDown: string[]; usedToday: number; dailyLimit: number;
  claude?: { configured: boolean; light: string; heavy: string; allowFreeFallback: boolean };
  cost?: { today: CostSummary; month: CostSummary; eurPerUsd: number };
}
const eur = (micro: number, rate: number) => `${((micro / 1e6) * rate).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function Settings({ back, openOnboarding, openPlan }: { back: () => void; openOnboarding: (startAt: 'welcome' | 'situation') => void; openPlan: () => void }) {
  const t = useT();
  const locale = useLocale();
  const me = useStore((s) => s.me);
  const online = useStore((s) => s.online);
  const waiting = useStore((s) => Object.values(s.actions).filter((a) => a.status === 'proposed').length);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [ai, setAi] = useState<AiStatusData | null>(null);
  const [perm, setPerm] = useState(pushPermission());

  useEffect(() => {
    void refreshMe().catch(() => {});
    api<AiStatusData>('/api/ai/status').then(setAi).catch(() => {});
  }, []);

  if (!me) return <div className="page"><Sky clouds={false} /></div>;
  const i = me.integrations;
  const booksConnected = Object.values(i.books ?? {}).some((b) => b.connected);
  const bookCount = me.settings.books?.length ?? 0;

  const rows: { id: SheetId; icon: IconName; tile: string; title: string; sub: string; status: [string, 'ok' | 'todo' | 'warn'] }[] = [
    {
      id: 'books', icon: 'book', tile: 'pink', title: t('settings.books'),
      sub: bookCount ? me.settings.books!.map((b) => b.subject).join(', ') : t('settings.booksSub'),
      status: booksConnected && bookCount ? [t('settings.connected'), 'ok'] : booksConnected ? [t('settings.subjectMissing'), 'warn'] : [t('settings.setUp'), 'todo'],
    },
    { id: 'untis', icon: 'school', tile: 'blue', title: 'WebUntis', sub: t('settings.untisSub'), status: i.webuntis ? [t('settings.connected'), 'ok'] : [t('settings.setUp'), 'todo'] },
    {
      id: 'mail', icon: 'mail', tile: 'teal', title: t('settings.email'), sub: i.mailAccounts ? t('settings.mailboxes', { count: i.mailAccounts }) : t('settings.mailSub'),
      status: i.mailAccounts ? [t('settings.connected'), 'ok'] : [t('settings.setUp'), 'todo'],
    },
    { id: 'notes', icon: 'pen', tile: 'blue', title: t('settings.notesTitle'), sub: t('settings.notesSub'), status: i.freeNotes ? [t('settings.connected'), 'ok'] : [t('settings.setUp'), 'todo'] },
    { id: 'health', icon: 'heart', tile: 'pink', title: t('settings.healthTitle'), sub: t('settings.healthSub'), status: [t('settings.guide'), 'todo'] },
    { id: 'finance', icon: 'wallet', tile: 'green', title: t('nav.finance'), sub: t('settings.financeSub'), status: [t('settings.guide'), 'todo'] },
    {
      id: 'notify', icon: 'bell', tile: 'green', title: t('settings.notify'), sub: t('settings.notifySub'),
      status: perm === 'granted' ? [t('settings.on'), 'ok'] : perm === 'denied' ? [t('settings.blocked'), 'warn'] : [t('settings.turnOn'), 'todo'],
    },
  ];

  const school = meIsSchool(me);
  const visibleRows = rows.filter((r) => {
    if (r.id === 'books' || r.id === 'untis' || r.id === 'notes') return school;
    if (r.id === 'mail') return meHas(me, 'mails');
    if (r.id === 'health') return meHas(me, 'health');
    if (r.id === 'finance') return meHas(me, 'finance');
    return true;
  });

  async function patch(json: Record<string, unknown>, ok = t('settings.saved')) {
    try {
      await api('/api/settings', { method: 'PATCH', json });
      await refreshMe();
      showToast(ok);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  }

  return (
    <div className="page">
      <Sky clouds={false} />
      <div className="page-inner stagger">
        <header className="page-head">
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="icon-btn" aria-label={t('settings.back')} onClick={back}><Icon name="back" size={18} /></button>
            <h1 className="display" style={{ fontSize: 28 }}>{t('settings.title')}</h1>
          </div>
        </header>

        <section className="card row">
          <span className="avatar-star" style={{ width: 52, height: 52 }}><StarMark size={24} /></span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600 }}>{me.name}</span>
            <span className="small" style={{ color: online ? 'var(--green)' : 'var(--pink-text)' }}>{online ? t('settings.serverOnline') : t('settings.offline')}</span>
          </div>
        </section>

        <TonePicker value={me.settings.tone ?? 'nett'} onChange={(tone) => void patch({ tone }, `${TONE_INFO[tone].emoji} ${t('settings.toneNow', { tone: t(`tone.${tone}`).toLowerCase() })}`)} />

        <LanguagePicker />

        <Group title={t('plan.title')}>
          <button type="button" className="list-row" onClick={() => setSheet('plan')}>
            <span className="icon-tile pink" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="star" size={18} /></span>
            <span className="grow"><span className="list-title">{t('plan.current')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
        </Group>

        <Group title={t('settings.groupConnections')}>
          {visibleRows.map((r) => (
            <button key={r.id} type="button" className="list-row" onClick={() => setSheet(r.id)}>
              <span className={`icon-tile ${r.tile}`} style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name={r.icon} size={18} /></span>
              <span className="grow"><span className="list-title">{r.title}</span><span className="list-sub">{r.sub}</span></span>
              <span className={`status ${r.status[1]}`}>{r.status[0]}</span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </Group>

        <Group title={t('settings.groupYou')}>
          <button type="button" className="list-row" onClick={() => openOnboarding('situation')}>
            <span className="icon-tile pink" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="star" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.profile')}</span><span className="list-sub">{profileSummary(me, t)}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="list-row" onClick={() => setSheet('addresses')}>
            <span className="icon-tile green" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="mail" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.mailToStella')}</span><span className="list-sub">{t('settings.mailToStellaSub')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="list-row" onClick={() => openOnboarding('welcome')}>
            <span className="icon-tile blue" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="sparkle" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.redoIntro')}</span><span className="list-sub">{t('settings.redoIntroSub')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
        </Group>

        <Group title={t('settings.groupAssistant')}>
          <button type="button" className="list-row" onClick={openPlan}>
            <span className="icon-tile green" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="calendar" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.plan')}</span><span className="list-sub">{t('settings.planSub')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="list-row" onClick={() => setSheet('perms')}>
            <span className="icon-tile blue" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="shield" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.perms')}</span><span className="list-sub">{t('settings.permsSub')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="list-row" onClick={() => setSheet('memory')}>
            <span className="icon-tile pink" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="memory" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.memory')}</span><span className="list-sub">{t('settings.memorySub')}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="list-row" onClick={() => setSheet('log')}>
            <span className="icon-tile green" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="history" size={18} /></span>
            <span className="grow"><span className="list-title">{t('settings.log')}</span><span className="list-sub">{t('settings.logSub')}</span></span>
            {waiting > 0 && <span className="status warn">{t('settings.questions', { count: waiting })}</span>}
            <Icon name="chevron" size={16} />
          </button>
        </Group>

        <Group title={t('settings.groupTimes')}>
          <BriefingRow value={me.settings.briefing ?? 'auto'} onSave={(v) => void patch({ briefing: v }, v === 'off' ? t('settings.briefingOff') : t('settings.saved'))} />
          <label className="list-row">
            <span className="grow"><span className="list-title">{t('settings.weekPlan')}</span>
              <span className="list-sub">{t('settings.weekPlanSub')}</span></span>
            <Switch label={t('settings.weekPlan')} checked={me.settings.weekPlan !== 'off'}
              onChange={(on) => void patch({ weekPlan: on ? 'sunday' : 'off' }, on ? t('settings.weekPlanOn') : t('settings.weekPlanOff'))} />
          </label>
          <TimeRow label={t('settings.eveningReminder')} value={me.settings.eveningTime ?? '19:00'} onSave={(v) => void patch({ eveningTime: v })} />
          <TimeRow label={t('settings.studyTime')} value={me.settings.studyTime ?? '16:30'} onSave={(v) => void patch({ studyTime: v })} />
          <label className="list-row">
            <span className="grow"><span className="list-title">{t('settings.stepGoal')}</span></span>
            <input type="number" min={1000} step={500} defaultValue={me.settings.stepGoal ?? 8000} style={{ width: 110, textAlign: 'right' }}
              onBlur={(e) => { const n = Number(e.target.value); if (n && n !== me.settings.stepGoal) void patch({ stepGoal: n }); }} />
          </label>
        </Group>

        {me.role === 'owner' && (
          <Group title={t('settings.groupServer')}>
            <button type="button" className="list-row" onClick={() => setSheet('server')}>
              <span className="icon-tile blue" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="shield" size={18} /></span>
              <span className="grow"><span className="list-title">{t('settings.keysTitle')}</span><span className="list-sub">{t('settings.keysSub')}</span></span>
              <Icon name="chevron" size={16} />
            </button>
          </Group>
        )}

        {ai?.configured && (
          <button type="button" className="card interactive" onClick={() => setSheet('ai')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>{t('settings.aiToday')}</span>
              <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}><strong style={{ color: 'var(--text)' }}>{ai.usedToday}</strong> / {ai.dailyLimit} {t('settings.aiRequests')}</span>
            </div>
            <div className="progress"><div style={{ width: `${Math.min(100, (ai.usedToday / ai.dailyLimit) * 100)}%` }} /></div>
            {ai.dailyLimit <= 50 && <span className="small muted">Einmal 10 $ bei OpenRouter aufladen → 1.000 pro Tag</span>}
          </button>
        )}

        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{t('settings.about')}</span>
          <span className="small muted">{t('settings.version', { version: VERSION })}</span>
          <span className="small">Stella by EVOLSIOR – <em>Built to become</em></span>
          <span className="small muted" dangerouslySetInnerHTML={{ __html: t('settings.etymology') }} />
        </section>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn secondary" onClick={() => void logout()}><Icon name="logout" size={18} />{t('settings.logout')}</button>
          <button type="button" className="link danger" onClick={() => setSheet('delete')}>{t('settings.deleteAccount')}</button>
        </div>
      </div>

      {sheet === 'plan' && <Sheet title={t('plan.title')} onClose={() => setSheet(null)}><PlanSheet /></Sheet>}
      {sheet === 'books' && <Sheet title={t('settings.books')} onClose={() => setSheet(null)}><Books me={me} /></Sheet>}
      {sheet === 'untis' && <Sheet title="WebUntis" onClose={() => setSheet(null)}><Untis me={me} /></Sheet>}
      {sheet === 'mail' && <Sheet title={t('settings.email')} onClose={() => setSheet(null)}><Mail me={me} /></Sheet>}
      {sheet === 'notes' && <Sheet title={t('settings.notesTitle')} onClose={() => setSheet(null)}><Handwriting me={me} /></Sheet>}
      {sheet === 'health' && <Sheet title={t('settings.healthTitle')} onClose={() => setSheet(null)}><Shortcuts me={me} /></Sheet>}
      {sheet === 'finance' && <Sheet title={t('nav.finance')} onClose={() => setSheet(null)}><FinanceSetup me={me} /></Sheet>}
      {sheet === 'notify' && <Sheet title={t('settings.notify')} onClose={() => setSheet(null)}><Notifications onChange={() => setPerm(pushPermission())} /></Sheet>}
      {sheet === 'ai' && ai && <Sheet title={t('settings.ai')} onClose={() => setSheet(null)}><AiDetails ai={ai} owner={me.role === 'owner'} /></Sheet>}
      {sheet === 'perms' && <Sheet title={t('settings.perms')} onClose={() => setSheet(null)}><Permissions /></Sheet>}
      {sheet === 'memory' && <Sheet title={t('settings.memory')} onClose={() => setSheet(null)}><MemoryView /></Sheet>}
      {sheet === 'addresses' && <Sheet title={t('settings.mailToStella')} onClose={() => setSheet(null)}><Addresses me={me} /></Sheet>}
      {sheet === 'server' && <Sheet title={t('settings.groupServer')} onClose={() => setSheet(null)}><Server /></Sheet>}
      {sheet === 'delete' && <Sheet title={t('settings.deleteAccount')} onClose={() => setSheet(null)}><DeleteAccount onDeleted={() => { setSheet(null); logoutLocal(); }} /></Sheet>}
      {sheet === 'log' && <Sheet title={t('settings.log')} onClose={() => setSheet(null)}><ActionLog /></Sheet>}
    </div>
  );
}

/** Sprache und Land: gelten für die App, Stellas Antworten, Mails und Mitteilungen */
function LanguagePicker() {
  const t = useT();
  const me = useStore((s) => s.me);
  const locale = useLocale();
  const country = me?.settings.country ?? '';
  async function save(patchBody: Record<string, string>) {
    try {
      await api('/api/settings', { method: 'PATCH', json: patchBody });
      await refreshMe();
      showToast(t('settings.languageSaved'));
    } catch (err) { showToast((err as Error).message, true); }
  }
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="eyebrow" style={{ margin: '4px 4px 0' }}>{t('settings.languageTitle')}</h2>
      <div className="list">
        <label className="list-row">
          <span className="grow"><span className="list-title">{t('settings.language')}</span><span className="list-sub">{t('settings.languageSub')}</span></span>
          <select value={locale} aria-label={t('settings.language')} onChange={(e) => void save({ locale: e.target.value })}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
          </select>
        </label>
        <label className="list-row">
          <span className="grow"><span className="list-title">{t('settings.country')}</span></span>
          <select value={country} aria-label={t('settings.country')} onChange={(e) => void save({ country: e.target.value })}>
            {!country && <option value="">–</option>}
            {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

function TonePicker({ value, onChange }: { value: Tone; onChange: (t: Tone) => void }) {
  const t = useT();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="eyebrow" style={{ margin: '4px 4px 0' }}>{t('settings.toneTitle')}</h2>
      <div className="tone-grid" role="radiogroup" aria-label={t('settings.toneTitle')}>
        {TONES.map((tone) => (
          <button key={tone} type="button" role="radio" aria-checked={value === tone} className={value === tone ? 'tone active' : 'tone'}
            onClick={() => value !== tone && onChange(tone)}>
            <span className="tone-emoji" aria-hidden="true">{TONE_INFO[tone].emoji}</span>
            <span className="tone-label">{t(`tone.${tone}`)}</span>
          </button>
        ))}
      </div>
      <p className="tone-example" key={value}>„{t(`tone.${value}.example`)}“</p>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="eyebrow" style={{ margin: '4px 4px 0' }}>{title}</h2>
      <div className="list">{children}</div>
    </section>
  );
}

/** Morning Briefing: vor der ersten Stunde (WebUntis), feste Zeit oder aus */
function BriefingRow({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const mode = value === 'auto' || value === 'off' ? value : 'fixed';
  return (
    <div className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
      <span className="grow"><span className="list-title">Morning Briefing</span>
        <span className="list-sub">{mode === 'auto' ? '45 Minuten vor der ersten Stunde' : mode === 'off' ? 'kommt nicht' : 'jeden Morgen zur selben Zeit'}</span></span>
      <select value={mode} aria-label="Morning Briefing" onChange={(e) => onSave(e.target.value === 'fixed' ? '07:00' : e.target.value)}>
        <option value="auto">Automatisch</option>
        <option value="fixed">Feste Zeit</option>
        <option value="off">Aus</option>
      </select>
      {mode === 'fixed' && <input type="time" defaultValue={value} style={{ width: 120 }} onBlur={(e) => { if (e.target.value && e.target.value !== value) onSave(e.target.value); }} />}
    </div>
  );
}

function TimeRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <label className="list-row">
      <span className="grow"><span className="list-title">{label}</span></span>
      <input type="time" defaultValue={value} style={{ width: 120 }} onBlur={(e) => { if (e.target.value && e.target.value !== value) onSave(e.target.value); }} />
    </label>
  );
}

function Notifications({ onChange }: { onChange: () => void }) {
  const [run, view] = useAction();
  const [perm, setPerm] = useState(pushPermission());
  const desktop = 'stellaDesktop' in window;
  return (
    <Section title="Auf diesem Gerät">
      {desktop ? (
        <p className="muted">In der PC-App kommen Mitteilungen automatisch, solange Stella läuft (auch im Hintergrund in der Taskleiste).</p>
      ) : (
        <>
          {isIos() && !isStandalone() && (
            <p className="hint">Auf iPhone/iPad gehen Web-Mitteilungen nur am Home-Bildschirm. Mit der Stella-App für iOS brauchst du das nicht.</p>
          )}
          <p className="muted">Status: {perm === 'granted' ? 'erlaubt' : perm === 'denied' ? 'blockiert – in den Systemeinstellungen ändern' : perm === 'unsupported' ? 'nicht verfügbar' : 'noch nicht aktiviert'}</p>
          <div className="button-row">
            <button type="button" className="btn" onClick={() => run(async () => { await enablePush(); setPerm(pushPermission()); onChange(); }, 'Mitteilungen sind aktiv.')}>Mitteilungen aktivieren</button>
            {perm === 'granted' && <button type="button" className="btn secondary" onClick={() => run(() => api('/api/push/test', { method: 'POST' }), 'Test gesendet.')}>Test senden</button>}
          </div>
        </>
      )}
      {view}
    </Section>
  );
}

function Shortcuts({ me }: { me: Me }) {
  return (
    <>
      <Section title="Kalender-Abo">
        <p className="muted">Alle HÜs, Tests und Lerneinheiten in deinem iPhone-Kalender: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → <strong>Kalenderabo hinzufügen</strong> → diese Adresse einfügen. Geht auch mit Google und Outlook.</p>
        <Copy value={`${me.ingestUrl}/calendar.ics`} />
      </Section>
      <Section title="Schritte & Schlaf (Apple Health)">
        <ol className="steps">
          <li>Kurzbefehle → <strong>Automation</strong> → „Tageszeit“ 21:00, täglich, „Sofort ausführen“.</li>
          <li><strong>Health-Samples suchen</strong>: Schritte, Startdatum heute → <strong>Statistik berechnen</strong>: Summe.</li>
          <li><strong>Inhalte von URL abrufen</strong>: POST, JSON, Feld <code>steps</code> = Summe, an diese Adresse:</li>
        </ol>
        <Copy value={`${me.ingestUrl}/health`} />
      </Section>
      <Section title="SMS weiterleiten">
        <ol className="steps">
          <li>Automation → <strong>Nachricht</strong> → „Absender: beliebig“ → „Sofort ausführen“.</li>
          <li><strong>Inhalte von URL abrufen</strong>, POST, JSON: <code>sender</code> = Absender, <code>text</code> = Nachricht:</li>
        </ol>
        <Copy value={`${me.ingestUrl}/sms`} />
        <p className="muted small">Schreibt dir jemand 3× in 30 Minuten, meldet sich Stella. Die Adressen sind geheim wie ein Passwort.</p>
      </Section>
    </>
  );
}

function AiDetails({ ai, owner }: { ai: AiStatusData; owner: boolean }) {
  return (
    <>
      {ai.claude?.configured && (
        <Section title="Claude">
          <p className="small">Alltag: <code>{ai.claude.light}</code><br />Schwere Aufgaben: <code>{ai.claude.heavy}</code></p>
          {ai.cost && owner && (
            <p className="small">Kosten heute <strong>{eur(ai.cost.today.totalMicroUsd, ai.cost.eurPerUsd)}</strong> ({ai.cost.today.requests} Anfragen) · diesen Monat <strong>{eur(ai.cost.month.totalMicroUsd, ai.cost.eurPerUsd)}</strong></p>
          )}
        </Section>
      )}
      <Section title="Verbrauch heute (Gratis-Modelle)">
        <p><strong>{ai.usedToday}</strong> von {ai.dailyLimit} Anfragen. Mails sortieren nutzt höchstens die Hälfte, damit für dich immer etwas übrig bleibt.</p>
      </Section>
      <Section title="Modelle (automatisch gewählt)">
        <p className="muted small">Für Chat und Planer:</p>
        <ol className="models">{ai.chain.map((m) => <li key={m}><code>{m}</code>{ai.coolingDown.includes(m) && ' · Pause'}</li>)}</ol>
        <p className="muted small">Für Buchseiten und Fotos:</p>
        <ol className="models">{ai.visionChain.map((m) => <li key={m}><code>{m}</code>{ai.coolingDown.includes(m) && ' · Pause'}</li>)}</ol>
      </Section>
    </>
  );
}

function profileSummary(me: Me, t: (k: string) => string) {
  const p = me.settings.profile;
  if (!p) return t('settings.notSetUp');
  const w = p.workHours;
  return `${t(`onboarding.situation.${p.situation}.label`)}${w ? ` · ${w.start}–${w.end}` : ''}`;
}

/** Konto samt allen Daten löschen – mit Passwort als Bestätigung. */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [run, view, busy] = useAction();
  return (
    <Section title="Konto löschen">
      <p>Dein Konto und <strong>alle Daten</strong> – Chats, Einträge, Mails, Fotos, Aufnahmen und was Stella über dich weiß – werden unwiderruflich gelöscht.</p>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/me', { method: 'DELETE', json: { password } }); onDeleted(); }, 'Gelöscht.'); }}>
        <label>Zur Bestätigung: dein Passwort<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="submit" className="btn danger" disabled={busy || !password}>Endgültig löschen</button>
      </form>
      {view}
    </Section>
  );
}
