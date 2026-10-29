import { useRef, useState } from 'react';
import { api, getState, refreshMe, type Me } from '../../store.ts';
import { AuthImage } from '../Rich.tsx';
import { Section, useAction } from './ui.tsx';

export function Handwriting({ me }: { me: Me }) {
  const [run, view] = useAction();
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    const res = await fetch('/api/handwriting/font', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getState().token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
      body: file,
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload fehlgeschlagen');
    await refreshMe();
  }

  return (
    <Section title="Handschrift & Hefte">
      <p className="muted">
        <strong>Mit FreeNotes (iPad):</strong> Gelöste HÜs schreibt FreeNotes Strich für Strich in <em>deiner</em> Handschrift ins passende Fach-Heft –
        einfach in FreeNotes unter Einstellungen → Stella mit diesem Konto verbinden.
      </p>
      <p className="muted">
        <strong>Im Chat</strong> zeigt Stella die Lösung als Heftseite. Damit die wie deine Schrift aussieht, kannst du eine Schriftdatei aus deiner Handschrift
        hochladen (z. B. kostenlos mit calligraphr.com: Vorlage ausdrucken, ausfüllen, scannen → .ttf).
      </p>
      <div className="button-row">
        <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(() => upload(f), 'Schrift gespeichert.');
          e.target.value = '';
        }} />
        <button type="button" className="btn secondary" onClick={() => fileRef.current?.click()}>{me.integrations.handwritingFont ? 'Andere Schrift hochladen' : 'Eigene Schrift hochladen'}</button>
        {me.integrations.handwritingFont && (
          <button type="button" className="link danger" onClick={() => run(async () => { await api('/api/handwriting/font', { method: 'DELETE' }); await refreshMe(); }, 'Standard-Schrift aktiv.')}>Eigene Schrift entfernen</button>
        )}
        <button type="button" className="btn" onClick={() => run(async () => setPreview((await api<{ fileId: string }>('/api/handwriting/preview', { method: 'POST' })).fileId), 'Vorschau erstellt.')}>Vorschau</button>
      </div>
      {preview && <AuthImage key={preview} id={preview} onOpen={(url) => window.open(url)} />}
      {view}
    </Section>
  );
}
