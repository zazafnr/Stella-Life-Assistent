import { useEffect, useState } from 'react';
import { api, refreshMe } from '../store.ts';
import { useT } from '../i18n.ts';
import { Sheet } from '../ui/Decor.tsx';
import { NewsSettings } from './settings/News.tsx';

/** Karte unter der Frage am ersten Tag: „Ja, gern“ öffnet die Auswahl, „Nein danke“ merkt sich die Antwort */
export function NewsAskCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className="button-row" style={{ marginTop: 8 }}>
      <button type="button" className="btn small" onClick={() => setOpen(true)}>{t('news.ask.yes')}</button>
      <button type="button" className="btn small secondary" onClick={() => void api('/api/news/answer', { method: 'POST', json: { answer: 'no' } }).then(() => { setDone(true); return refreshMe(); }).catch(() => {})}>{t('news.ask.no')}</button>
      {open && (
        <Sheet title={t('settings.news.title')} onClose={() => { setOpen(false); setDone(true); }}>
          <NewsSettingsStart />
        </Sheet>
      )}
    </div>
  );
}

/** Beim ersten Öffnen aus der Frage: gleich einschalten, dann Themen und Länder wählen */
function NewsSettingsStart() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void api('/api/news', { method: 'PUT', json: { enabled: true, asked: true } }).then(() => setReady(true)).catch(() => setReady(true)); }, []);
  return ready ? <NewsSettings /> : null;
}
