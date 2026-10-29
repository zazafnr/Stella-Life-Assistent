import { useState, type ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2>{children}</section>;
}

/** Führt eine Aktion aus und zeigt Erfolg/Fehler darunter an. */
export function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setMsg(null);
    setBusy(true);
    try { await fn(); setMsg({ ok: true, text: okText }); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  };
  const view = (busy && <p className="muted">⏳ Einen Moment…</p>) || (msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>);
  return [run, view, busy] as const;
}

export function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <code>{value}</code>
      <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
        {copied ? '✓' : 'Kopieren'}
      </button>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
