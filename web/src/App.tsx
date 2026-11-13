import { useCallback, useEffect, useMemo, useState } from 'react';
import { startWeatherOnce } from '@stella/web-core/weather.ts';
import { meHas, meIsSchool, newConversation, refreshMe, startBackgroundSync, useStore } from '@stella/web-core/store.ts';
import { Today } from './components/Today.tsx';
import { Chat } from '@stella/web-core/components/Chat.tsx';
import { CalendarTab } from './components/CalendarTab.tsx';
import { Inbox } from '@stella/web-core/components/Inbox.tsx';
import { Goals } from '@stella/web-core/components/Goals.tsx';
import { Finance } from '@stella/web-core/components/Finance.tsx';
import { StellaPlan } from '@stella/web-core/components/StellaPlan.tsx';
import { Health } from '@stella/web-core/components/Health.tsx';
import { Settings } from './components/Settings.tsx';
import { Intro, dismissBoot, introShown } from './components/Intro.tsx';
import { Onboarding } from '@stella/web-core/components/Onboarding.tsx';
import { Login } from '@stella/web-core/components/Login.tsx';
import { Icon, type IconName } from '@stella/web-core/ui/Icon.tsx';
import { StarMark, showToast } from '@stella/web-core/ui/Decor.tsx';
import { CommandPalette, Topbar, type PaletteEntry } from '@stella/web-core/ui/Shell.tsx';
import { isDesktopApp } from '@stella/web-core/platform.ts';
import { useHtmlLang, useT } from '@stella/web-core/i18n.ts';

export type { Tab } from '@stella/web-core/nav.ts';
import type { Tab } from '@stella/web-core/nav.ts';

const TABS: [Tab, IconName, string][] = [
  ['today', 'sparkle', 'nav.today'],
  ['chat', 'chat', 'nav.chat'],
  ['calendar', 'calendar', 'nav.calendar'],
  ['inbox', 'inbox', 'nav.inbox'],
];
const ALL: Tab[] = ['today', 'chat', 'calendar', 'goals', 'inbox', 'health', 'finance', 'plan', 'settings'];

function initialTab(): Tab {
  const hash = location.hash.slice(1).split('/')[0] as Tab;
  if ((hash as string) === 'planner') return 'calendar'; // der Planer lebt jetzt als Listenansicht im Kalender
  return ALL.includes(hash) ? hash : 'today';
}

const SIDE_KEY = 'stella.sidebar';
const readCollapsed = () => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } };

export function App() {
  const t = useT();
  useHtmlLang();
  const token = useStore((s) => s.token);
  const online = useStore((s) => s.online);
  const items = useStore((s) => s.items);
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  /** „Planer“ gibt es nicht mehr als eigenen Tab: Sprünge dorthin landen im Kalender */
  const setTab = useCallback((id: Tab) => setTabRaw(id === 'planner' ? 'calendar' : id), []);
  const me = useStore((s) => s.me);
  /** Einführung: beim ersten Mal von selbst (onboarding = pending), später aus den Einstellungen */
  const [onboarding, setOnboarding] = useState<{ startAt: 'language' | 'situation' } | null>(null);
  const showOnboarding = onboarding ?? (me?.settings.onboarding === 'pending' ? { startAt: 'language' as const } : null);

  const hasMe = useStore((s) => !!s.me);
  const lastSync = useStore((s) => s.lastSync);
  const [intro, setIntro] = useState(() => !introShown());
  const [ready, setReady] = useState(false);
  // Ladebildschirm (steht in index.html) geht weg, sobald Anmeldestatus und Daten da sind – spätestens nach 4 s
  useEffect(() => { if (!token || hasMe || lastSync) setReady(true); }, [token, hasMe, lastSync]);
  useEffect(() => { const t = setTimeout(() => setReady(true), 4000); return () => clearTimeout(t); }, []);
  useEffect(() => { if (ready) dismissBoot(); }, [ready]);
  useEffect(() => { if (token) startBackgroundSync(); }, [token]);
  useEffect(() => { if (token && hasMe) startWeatherOnce(); }, [token, hasMe]);
  useEffect(() => { if (token && !hasMe) void refreshMe().catch(() => {}); }, [token, hasMe]);
  useEffect(() => { if (!(tab === 'calendar' && location.hash.startsWith('#calendar/'))) history.replaceState(null, '', tab === 'today' ? location.pathname : `#${tab}`); }, [tab]);
  // Sprunglinks (#calendar/JJJJ-MM-TT) wechseln auch bei laufender App in den Kalender
  useEffect(() => { const on = () => { if (location.hash.startsWith('#calendar')) setTab('calendar'); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, [setTab]);
  useEffect(() => { document.documentElement.classList.toggle('is-desktop', isDesktopApp); }, []);
  // zurück von "Mit Google anmelden": ?provider=gmail&ok=1&message=…#settings
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('provider')) return;
    showToast(q.get('message') || (q.get('ok') === '1' ? t('app.connected') : t('app.failed')), q.get('ok') !== '1');
    history.replaceState(null, '', location.pathname + location.hash);
    if (token) void refreshMe().catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!isDesktopApp) return;
    document.documentElement.classList.toggle('is-mac', window.stellaDesktop?.platform === 'darwin');
    // Fensterknöpfe sitzen auf dem oberen Band, das fast weiß ist
    window.stellaDesktop?.setTitleBarColor?.('#FCFDFE');
  }, []);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleSide = () => setCollapsed((c) => { try { localStorage.setItem(SIDE_KEY, c ? '0' : '1'); } catch { /* ohne Speicher geht es auch */ } return !c; });
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const school = meIsSchool(me);
  const openHomework = useMemo(() => (school ? Object.values(items).filter((i) => i.kind === 'homework' && i.status === 'open' && !i.deleted).length : 0), [items, school]);

  const introLayer = intro ? <Intro onDone={() => setIntro(false)} /> : null;

  const main = TABS.filter(([id]) => id !== 'inbox' || meHas(me, 'mails'));
  // Ziele sind kein Haupt-Tab mehr (Einstieg über „Heute“), nur noch unter „Mehr“ wie in Stella for Students
  const more: [Tab, IconName, string][] = [
    ...(meHas(me, 'goals') ? [['goals', 'target', 'nav.goals'] as [Tab, IconName, string]] : []),
    ...(meHas(me, 'health') ? [['health', 'heart', 'nav.health'] as [Tab, IconName, string]] : []),
    ...(meHas(me, 'finance') ? [['finance', 'wallet', 'nav.finance'] as [Tab, IconName, string]] : []),
    ['plan', 'star', 'settings.plan'],
  ];
  const titleOf = (id: Tab) => t(id === 'plan' ? 'settings.plan' : `nav.${id}`);
  const startChat = useCallback(async () => {
    try { await newConversation(); setTab('chat'); } catch (err) { showToast((err as Error).message, true); }
  }, []);
  const entries: PaletteEntry[] = [
    ...[...main, ...more, ['settings', 'gear', 'nav.settings'] as [Tab, IconName, string]].map(([id, icon, label]): PaletteEntry => ({ id, group: 'pages', label: t(label), icon, run: () => setTab(id) })),
    { id: 'new-chat', group: 'actions', label: t('palette.newChat'), icon: 'plus', run: () => void startChat() },
  ];
  const initial = (me?.name ?? '?').trim().charAt(0).toUpperCase();

  if (!token) return <>{introLayer}<Login /></>;

  const link = ([id, icon, label]: [Tab, IconName, string]) => (
    <button key={id} type="button" className={tab === id ? 'side-link active' : 'side-link'} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} title={collapsed ? t(label) : undefined}>
      <Icon name={icon} size={18} /><span className="label">{t(label)}</span>
      {id === 'calendar' && openHomework > 0 && <span className="side-badge">{openHomework}</span>}
    </button>
  );

  return (
    <>
    {introLayer}
    {showOnboarding && <Onboarding situations={['work', 'apprenticeship', 'other']} studentsHint={me?.flags?.studentsUrl} startAt={showOnboarding.startAt} onDone={(after) => { setOnboarding(null); if (after === 'settings') setTab('settings'); }} />}
    {palette && <CommandPalette entries={entries} onClose={() => setPalette(false)} />}
    <div className={collapsed ? 'app collapsed' : 'app'}>
      <nav className="sidebar" aria-label={t('nav.navigation')}>
        <div className="brand"><span className="mark"><StarMark size={16} /></span><span className="name display">Stella</span></div>
        {main.map(link)}
        <div className="side-group">{t('shell.more')}</div>
        {more.map(link)}
        <div className="side-spacer" />
        {link(['settings', 'gear', 'nav.settings'])}
        <button type="button" className="side-link" onClick={toggleSide} aria-label={collapsed ? t('shell.expand') : t('shell.collapse')} title={collapsed ? t('shell.expand') : t('shell.collapse')}>
          <Icon name="sidebar" size={18} /><span className="label">{collapsed ? t('shell.expand') : t('shell.collapse')}</span>
        </button>
        <div className="side-user"><span className="avatar" aria-hidden="true">{initial}</span><span className="who"><span>{me?.name ?? ''}</span><span className="small muted">{me?.email ?? ''}</span></span></div>
      </nav>

      <main className="content">
        <Topbar title={titleOf(tab)} onSearch={() => setPalette(true)} />
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'chat' && <Chat />}
        {tab === 'calendar' && <CalendarTab go={setTab} />}
        {tab === 'goals' && <Goals />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'health' && <Health back={() => setTab('today')} />}
        {tab === 'finance' && <Finance back={() => setTab('today')} go={setTab} />}
        {tab === 'plan' && <StellaPlan back={() => setTab('today')} go={setTab} />}
        {tab === 'settings' && <Settings back={() => setTab('today')} openOnboarding={(startAt) => setOnboarding({ startAt })} openPlan={() => setTab('plan')} />}
      </main>

      <nav className="tabbar" aria-label={t('nav.navigation')}>
        {main.map(([id, icon, label]) => (
          <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon name={icon} size={22} />{t(label)}
          </button>
        ))}
      </nav>
    </div>
    </>
  );
}
