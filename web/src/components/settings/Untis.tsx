import { useState } from 'react';
import { api, refreshMe, type Me } from '../../store.ts';
import { Section, useAction } from './ui.tsx';

export function Untis({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [mode, setMode] = useState<'password' | 'qr'>('password');
  const [form, setForm] = useState({ server: '', school: '', username: '', password: '', qr: '' });
  const set = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <Section title="WebUntis">
      <p className="muted">Stella kennt dann deinen Stundenplan: „Latein HÜ“ ohne Datum = nächste Lateinstunde, Entfall wird gemeldet, und HÜs/Tests, die Lehrer:innen eintragen, landen automatisch im Planer.</p>
      {me.integrations.webuntis ? (
        <div className="button-row">
          <span className="ok-text">✅ Verbunden</span>
          <button type="button" className="secondary" onClick={() => run(() => api('/api/integrations/webuntis/sync', { method: 'POST' }), 'Abgeglichen.')}>Jetzt abgleichen</button>
          <button type="button" className="link danger" onClick={() => run(async () => { await api('/api/integrations/webuntis', { method: 'DELETE' }); await refreshMe(); }, 'Getrennt.')}>Trennen</button>
        </div>
      ) : (
        <>
          <div className="chips" style={{ margin: '8px 0' }}>
            <button type="button" className={mode === 'password' ? 'chip active' : 'chip'} onClick={() => setMode('password')}>Benutzername & Passwort</button>
            <button type="button" className={mode === 'qr' ? 'chip active' : 'chip'} onClick={() => setMode('qr')}>Microsoft-Login / QR-Code</button>
          </div>
          <form className="form-grid" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/api/integrations/webuntis', { method: 'PUT', json: mode === 'qr' ? { qr: form.qr } : form });
              await refreshMe();
            }, 'Verbunden! Stundenplan wird geladen.');
          }}>
            {mode === 'password' ? (
              <>
                <label>Server<input placeholder="z. B. neilo.webuntis.com" {...set('server')} required /></label>
                <label>Schule<input placeholder="wie in der WebUntis-Adresse" {...set('school')} required /></label>
                <label>Benutzername<input autoComplete="off" {...set('username')} required /></label>
                <label>Passwort<input type="password" autoComplete="off" {...set('password')} required /></label>
              </>
            ) : (
              <label style={{ gridColumn: '1 / -1' }}>Inhalt des QR-Codes<input placeholder="untis://setschool?url=…" {...set('qr')} required /></label>
            )}
            <button type="submit">Verbinden</button>
          </form>
          <p className="muted small">
            {mode === 'password'
              ? 'Server und Schule stehen in der Adresszeile, wenn du WebUntis im Browser öffnest (…webuntis.com/WebUntis/?school=…).'
              : 'Wenn du dich mit Microsoft/Office anmeldest: In WebUntis (Browser) → Profil → Freigaben → „Zugriff über Untis Mobile“ → QR-Code anzeigen. Mit der Kamera-App scannen und den Text (untis://…) hier einfügen.'}
          </p>
        </>
      )}
      {view}
    </Section>
  );
}
