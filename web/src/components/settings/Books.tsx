import { useState } from 'react';
import { SUBJECTS } from '@stella/shared';
import { api, refreshMe, type BookConfig, type BookProvider, type Me } from '../../store.ts';
import { AuthImage } from '../Rich.tsx';
import { Section, Toggle, useAction } from './ui.tsx';

const PROVIDERS: [BookProvider, string][] = [['digi4school', 'digi4school'], ['scook', 'scook']];

type Shelf = { title: string; url: string }[];

/** PC-App: echtes Anmeldefenster des Anbieters → Cookies → Server prüft und liefert das Bücherregal */
async function connectInWindow(provider: BookProvider): Promise<Shelf> {
  const pages = await api<Record<string, { url: string; domains: string }>>('/api/integrations/books/login-pages');
  const page = pages[provider];
  if (!page) throw new Error('Unbekannter Anbieter');
  const cookies = await window.stellaDesktop!.connectBook!(provider, page.url, page.domains);
  if (!cookies) throw new Error('Abgebrochen – keine Anmeldung übernommen.');
  const res = await api<{ shelf?: Shelf }>(`/api/integrations/books/${provider}`, { method: 'PUT', json: { cookies, verify: true } });
  await refreshMe();
  return res.shelf ?? [];
}

const canLoginInWindow = typeof window.stellaDesktop?.connectBook === 'function';

function ProviderLogin({ me, provider, label, onShelf }: { me: Me; provider: BookProvider; label: string; onShelf: (s: Shelf) => void }) {
  const [run, view] = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cookies, setCookies] = useState('');
  const [showCookies, setShowCookies] = useState(false);
  const [shelf, setShelfState] = useState<Shelf | null>(null);
  const setShelf = (s: Shelf) => { setShelfState(s); onShelf(s); };
  const state = me.integrations.books[provider];
  const [showPassword, setShowPassword] = useState(!canLoginInWindow);

  return (
    <div className="provider">
      <h3>{label}</h3>
      {canLoginInWindow && (
        <div className="button-row">
          <button type="button" className={state.connected ? 'btn secondary' : 'btn'}
            onClick={() => run(async () => setShelf(await connectInWindow(provider)), `Angemeldet! Unten deine Bücher einem Fach zuordnen.`)}>
            {state.connected ? 'Neu anmelden' : `Bei ${label} anmelden`}
          </button>
          {!state.connected && <span className="muted small">Öffnet die echte {label}-Seite – auch mit Schul- oder Microsoft-Login. Danach Fenster schließen.</span>}
        </div>
      )}
      {state.connected ? (
        <div className="button-row">
          <span className="ok-text">✅ Verbunden{state.email ? ` (${state.email})` : ''}{state.cookies ? ' · mit Cookies' : ''}</span>
          <button type="button" className="btn secondary" onClick={() => run(async () => setShelf(await api(`/api/integrations/books/${provider}/shelf`)), 'Bücherregal geladen.')}>Bücherregal laden</button>
          <button type="button" className="link danger" onClick={() => run(async () => { await api(`/api/integrations/books/${provider}`, { method: 'DELETE' }); await refreshMe(); }, 'Getrennt.')}>Trennen</button>
        </div>
      ) : showPassword ? (
        <form className="form-grid two" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/integrations/books/${provider}`, { method: 'PUT', json: { email, password } }); setPassword(''); await refreshMe(); }, 'Gespeichert.'); }}>
          <label>E-Mail / Benutzer<input autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Passwort<input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button type="submit" className="btn">Verbinden</button>
        </form>
      ) : (
        <button type="button" className="link small" onClick={() => setShowPassword(true)}>Lieber mit E-Mail und Passwort</button>
      )}
      {!canLoginInWindow && !state.connected && <p className="hint">Tipp: In der PC-App und der iPad-/iPhone-App meldest du dich einfach auf der echten {label}-Seite an – ohne Passwort hier einzutippen.</p>}
      <button type="button" className="link" onClick={() => setShowCookies(!showCookies)}>
        {showCookies ? 'Cookies ausblenden' : 'Login klappt nicht (Schul-/Microsoft-Login)? Cookies einfügen'}
      </button>
      {showCookies && (
        <>
          <p className="muted small">Am PC in Chrome bei {label} einloggen → Erweiterung „Cookie-Editor“ → Export → JSON → hier einfügen.</p>
          <textarea className="cookies" value={cookies} onChange={(e) => setCookies(e.target.value)} placeholder='[{"name": "...", "value": "...", "domain": "..."}]' />
          <button type="button" className="btn" onClick={() => run(async () => { await api(`/api/integrations/books/${provider}`, { method: 'PUT', json: { cookies } }); setCookies(''); await refreshMe(); }, 'Cookies gespeichert.')}>Cookies speichern</button>
        </>
      )}
      {shelf && shelf.length === 0 && <p className="muted">Keine Bücher gefunden.</p>}
      {view}
    </div>
  );
}

export function Books({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [books, setBooks] = useState<BookConfig[]>(me.settings.books ?? []);
  const [preview, setPreview] = useState<{ subject: string; page: string; fileId?: string }>({ subject: '', page: '45' });
  const update = (i: number, patch: Partial<BookConfig>) => setBooks(books.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const autopilot = me.settings.homeworkAutopilot !== false;
  const [shelf, setShelf] = useState<(Shelf[number] & { provider: BookProvider })[]>([]);
  const assign = (book: Shelf[number] & { provider: BookProvider }, subject: string) => {
    const next = [...books.filter((b) => b.subject !== subject), { subject, provider: book.provider, url: book.url, pageOffset: 0 }];
    setBooks(next);
    void run(async () => { await api('/api/settings', { method: 'PATCH', json: { books: next } }); await refreshMe(); }, `${subject} → ${book.title || 'Buch'} gespeichert.`);
  };

  return (
    <Section title="Schulbücher & HÜ-Autopilot">
      <p className="muted">Schreibst du „Französisch HÜ S. 45 Nr. 16 Freitag“, holt Stella die Seite aus dem E-Book{autopilot ? ', löst die Aufgabe und schreibt sie dir ins Heft' : ''}. Zugangsdaten werden verschlüsselt auf deinem Server gespeichert.</p>
      <Toggle label="HÜ-Autopilot: Aufgaben automatisch lösen & ins Heft schreiben" checked={autopilot}
        onChange={(v) => run(async () => { await api('/api/settings', { method: 'PATCH', json: { homeworkAutopilot: v } }); await refreshMe(); }, v ? 'Autopilot an.' : 'Autopilot aus.')} />

      {PROVIDERS.map(([p, label]) => (
        <ProviderLogin key={p} me={me} provider={p} label={label}
          onShelf={(s) => setShelf((old) => [...old.filter((b) => b.provider !== p), ...s.map((b) => ({ ...b, provider: p }))])} />
      ))}

      {shelf.length > 0 && (
        <>
          <h3>Deine Bücher</h3>
          <p className="muted small">Wähl zu jedem Buch das Fach – dann weiß Stella, wo sie bei „Latein HÜ S. 45“ nachschauen muss.</p>
          <div className="shelf">
            {shelf.map((b) => {
              const current = books.find((x) => x.url === b.url)?.subject ?? '';
              return (
                <div key={b.url} className="shelf-row">
                  <span>{b.title || b.url}</span>
                  <select aria-label={`Fach für ${b.title}`} value={current} onChange={(e) => e.target.value && assign(b, e.target.value)}>
                    <option value="">Fach …</option>
                    {SUBJECTS.map(([s]) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3>Fach → Buch</h3>
      <p className="muted small">Link = Adresse des Buchs im Browser (z. B. scook.at/produkt/…). Fach genau wie Stella es nennt: Mathe, Deutsch, Englisch, Französisch, Latein …</p>
      {books.map((b, i) => (
        <div key={i} className="book-row">
          <input placeholder="Fach" value={b.subject} onChange={(e) => update(i, { subject: e.target.value })} />
          <select value={b.provider} onChange={(e) => update(i, { provider: e.target.value as BookProvider })}>
            {PROVIDERS.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
          </select>
          <input className="url" placeholder="https://…" value={b.url} onChange={(e) => update(i, { url: e.target.value })} />
          <input type="number" title="Seitenversatz" value={b.pageOffset ?? 0} onChange={(e) => update(i, { pageOffset: Number(e.target.value) })} />
          <button type="button" className="link danger" onClick={() => setBooks(books.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="button-row">
        <button type="button" className="btn secondary" onClick={() => setBooks([...books, { subject: '', provider: 'scook', url: '', pageOffset: 0 }])}>+ Buch</button>
        <button type="button" className="btn" onClick={() => run(async () => { await api('/api/settings', { method: 'PATCH', json: { books } }); await refreshMe(); }, 'Bücher gespeichert.')}>Speichern</button>
      </div>

      <h3>Testen</h3>
      <p className="muted small">Holt eine Seite als Bild. Zeigt das Bild eine andere Seite, den Seitenversatz anpassen (z. B. +2).</p>
      <div className="button-row">
        <select value={preview.subject} onChange={(e) => setPreview({ ...preview, subject: e.target.value })}>
          <option value="">Fach wählen</option>
          {(me.settings.books ?? []).map((b) => <option key={b.subject} value={b.subject}>{b.subject}</option>)}
        </select>
        <input type="number" style={{ width: 90 }} value={preview.page} onChange={(e) => setPreview({ ...preview, page: e.target.value })} />
        <button type="button" className="btn" disabled={!preview.subject} onClick={() => run(async () => {
          const { fileId } = await api<{ fileId: string }>('/api/integrations/books/preview', { method: 'POST', json: { subject: preview.subject, page: Number(preview.page) } });
          setPreview((p) => ({ ...p, fileId }));
        }, 'Seite geholt.')}>Seite holen</button>
      </div>
      {preview.fileId && <AuthImage id={preview.fileId} onOpen={(url) => window.open(url)} />}
      {view}
    </Section>
  );
}
