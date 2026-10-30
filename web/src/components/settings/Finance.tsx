import { api, type Me } from '../../store.ts';
import { Copy, Section, useAction } from './ui.tsx';

/** Anleitung: Apple-Kurzbefehl, der jede Kartenzahlung an Stella meldet */
export function FinanceSetup({ me }: { me: Me }) {
  const [run, view, busy] = useAction();
  return (
    <>
      <Section title="So meldet dein iPhone Zahlungen an Stella">
        <ol className="steps">
          <li>App <strong>Kurzbefehle</strong> → <strong>Automation</strong> → <strong>+</strong> → <strong>Transaktion</strong> (Wallet).</li>
          <li>Deine <strong>Karte</strong> wählen, Händler und Betrag lassen („beliebig“).</li>
          <li><strong>Sofort ausführen</strong> einschalten, damit nichts nachfragt.</li>
          <li>Aktion <strong>Inhalte von URL abrufen</strong> hinzufügen: Methode <strong>POST</strong>, Anfragetext <strong>JSON</strong> mit den Feldern <code>amount</code> (Betrag), <code>merchant</code> (Händler) und <code>card</code> (Karte) – jeweils die passende Variable aus „Transaktion“ einsetzen.</li>
          <li>Als Adresse diese URL einfügen:</li>
        </ol>
        <Copy value={`${me.ingestUrl}/payment`} />
        <p className="muted small">Stella speichert nur Betrag, Händler und Kartenname – nie Kartennummern. Die Adresse ist geheim wie ein Passwort. Meldet Wallet eine Zahlung doppelt, zählt sie nur einmal.</p>
      </Section>
      <Section title="Funktioniert es?">
        <p className="muted">Schickt eine Probebuchung (1,00 €) auf dem gleichen Weg wie der Kurzbefehl. Du findest sie danach unter „Ausgaben“ und kannst sie dort löschen.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { const r = await api<{ message: string }>('/api/finance/test', { method: 'POST' }); if (r.message.includes('nochmal')) throw new Error(r.message); }, 'Probebuchung ist angekommen – schau unter „Ausgaben“ nach.')}>Probebuchung senden</button>
        {view}
      </Section>
    </>
  );
}
