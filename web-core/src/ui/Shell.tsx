// Oberes Band und Befehlspalette der Desktop-Oberfläche.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { useWeather } from '../weather.ts';
import { useT } from '../i18n.ts';
import { isDesktopApp, modKey } from '../platform.ts';
import { Icon, type IconName } from './Icon.tsx';

export type PaletteEntry = { id: string; group: 'pages' | 'actions'; label: string; icon: IconName; run: () => void; sub?: string };

/** Wetter für die PC-App: kleiner Chip oben rechts. Im Browser gibt es keins (useWeather liefert dort null). */
function WeatherPill() {
  const t = useT();
  const w = useWeather();
  if (!isDesktopApp || !w) return null;
  const icon: IconName = w.type === 'clear' || w.type === 'partly' ? (w.day ? 'sun' : 'moon') : 'cloud';
  const label = t('weather.chip', { type: t(`weather.type.${w.type}`), temp: w.temp });
  return <span className="top-chip" title={label} aria-label={label} data-testid="weather-chip"><Icon name={icon} size={15} />{w.temp}° · {t(`weather.type.${w.type}`)}</span>;
}

export function Topbar({ title, parent, onSearch }: { title: string; parent?: string; onSearch: () => void }) {
  const t = useT();
  const online = useStore((s) => s.online);
  return (
    <header className="topbar">
      <h1 className="top-title">{parent && <><span className="crumb">{parent}</span><span className="crumb" aria-hidden="true">/</span></>}{title}</h1>
      <div className="top-spacer" />
      <button type="button" className="search-btn" onClick={onSearch} aria-label={t('shell.search')} aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" size={16} /><span>{t('shell.search')}</span><kbd>{modKey} K</kbd>
      </button>
      <WeatherPill />
      {!online && <span className="top-chip off">{t('app.offlineBar')}</span>}
      {/* Platz für die Fensterknöpfe von Windows in der PC-App */}
      {isDesktopApp && <span style={{ width: 138 }} aria-hidden="true" />}
    </header>
  );
}

export function CommandPalette({ entries, onClose }: { entries: PaletteEntry[]; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? entries.filter((e) => e.label.toLowerCase().includes(n)) : entries;
  }, [q, entries]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[sel]; if (h) { onClose(); h.run(); } }
  }
  const groups: ['pages' | 'actions', string][] = [['pages', t('palette.pages')], ['actions', t('palette.actions')]];
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('shell.search')}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={t('palette.placeholder')}
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label={t('shell.search')} />
        <ul id="palette-list" role="listbox" ref={listRef}>
          {hits.length === 0 && <li className="sub" style={{ cursor: 'default' }}>{t('palette.empty')}</li>}
          {groups.map(([g, label]) => {
            const list = hits.filter((h) => h.group === g);
            if (!list.length) return null;
            return (
              <li key={g} role="presentation" style={{ display: 'block', padding: 0, cursor: 'default' }}>
                <div className="group">{label}</div>
                <ul style={{ padding: 0, maxHeight: 'none' }} role="presentation">
                  {list.map((e) => {
                    const i = hits.indexOf(e);
                    return (
                      <li key={e.id} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => { onClose(); e.run(); }}>
                        <Icon name={e.icon} size={17} />{e.label}{e.sub && <span className="sub">{e.sub}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot"><span><span className="kbd">↑↓</span> {t('palette.select')}</span><span><span className="kbd">↵</span> {t('palette.open')}</span><span><span className="kbd">Esc</span> {t('palette.close')}</span></div>
      </div>
    </div>
  );
}
