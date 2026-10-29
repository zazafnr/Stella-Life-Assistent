// Stella-Einträge als Kalender-Abo (iCalendar), damit sie im iPhone-/Google-/Outlook-Kalender auftauchen.

import { addDays, zonedToUtc, type Item } from '@stella/shared';

const ICON: Record<string, string> = { homework: '📚', exam: '📝', assignment: '📌', event: '📅', todo: '☑️', study: '🧠' };
const DURATION_MIN: Record<string, number> = { study: 45, exam: 50 };

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (s: string) => s.replace(/-/g, '');

/** Zeilen über 75 Zeichen umbrechen (RFC 5545) */
function fold(line: string): string {
  const chars = [...line];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 70) parts.push(chars.slice(i, i + 70).join(''));
  return parts.join('\r\n ');
}

export function toICalendar(items: Item[], timeZone: string): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stella Life Assistant//DE', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Stella', 'X-PUBLISHED-TTL:PT15M', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  for (const i of items) {
    if (!i.due || i.deleted || i.status === 'cancelled') continue;
    lines.push('BEGIN:VEVENT', `UID:${i.id}@stella`, `DTSTAMP:${utc(new Date(i.updatedAt))}`);
    if (i.time) {
      const start = zonedToUtc(i.due, i.time, timeZone);
      const end = new Date(start.getTime() + (DURATION_MIN[i.kind] ?? 60) * 60_000);
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd(i.due)}`, `DTEND;VALUE=DATE:${ymd(addDays(i.due, 1))}`, 'TRANSP:TRANSPARENT');
    }
    const title = `${i.status === 'done' ? '✅ ' : ''}${ICON[i.kind] ?? ''} ${i.title}`.trim();
    lines.push(`SUMMARY:${escape(title)}`);
    const desc = [i.detail, i.material && `Stoff: ${i.material}`, i.notes].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${escape(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
