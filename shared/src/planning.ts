// Regeln, wann Stella an was erinnert und wie ein Lernplan aussieht.
// Bewusst deterministisch: funktioniert ohne KI, die KI darf die Inhalte nur verfeinern.

import { addDays, diffDays, formatDateDe, weekdayOf, type Ymd } from './dates.ts';
import type { ItemKind } from './parser.ts';

export interface PlannedReminder {
  date: Ymd;
  time: string;
  message: string;
  /** Aufgabenbild mitschicken (HÜ-Screenshot) */
  withAttachments: boolean;
}

export interface ReminderPrefs {
  /** "Donnerstag abend" – Uhrzeit der Vorabend-Erinnerung */
  eveningTime: string;
  /** Uhrzeit für Lern-Erinnerungen */
  studyTime: string;
}

export const DEFAULT_PREFS: ReminderPrefs = { eveningTime: '19:00', studyTime: '16:30' };

export function planReminders(
  item: { kind: ItemKind; title: string; detail?: string | null; due: Ymd | null; time?: string | null },
  today: Ymd,
  prefs: ReminderPrefs = DEFAULT_PREFS,
): PlannedReminder[] {
  if (!item.due) return [];
  const label = [item.title, item.detail].filter(Boolean).join(' – ');
  const out: PlannedReminder[] = [];
  const add = (daysBefore: number, time: string, message: string, withAttachments = false) => {
    const date = addDays(item.due!, -daysBefore);
    if (date >= today) out.push({ date, time, message, withAttachments });
  };

  switch (item.kind) {
    case 'homework':
      add(1, prefs.eveningTime, `📚 Morgen fällig: ${label}`, true);
      break;
    case 'exam':
      add(7, prefs.studyTime, `📅 In einer Woche: ${item.title}. Zeit, mit dem Lernen zu starten!`);
      add(1, prefs.eveningTime, `🍀 Morgen ist ${item.title}. Letzte Wiederholung – und früh schlafen!`);
      break;
    case 'assignment':
      add(3, prefs.studyTime, `⏳ In 3 Tagen: ${label}`);
      add(1, prefs.eveningTime, `📌 Morgen fällig: ${label}`);
      break;
    case 'event':
    case 'todo':
      if (item.time) {
        // 1 Stunde vorher
        const [h, m] = item.time.split(':').map(Number);
        if (h >= 1) out.push({ date: item.due, time: `${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`, message: `⏰ In einer Stunde: ${label}`, withAttachments: false });
      } else {
        add(1, prefs.eveningTime, `📌 Morgen: ${label}`);
      }
      break;
    case 'study':
      out.push({ date: item.due, time: item.time ?? prefs.studyTime, message: `🧠 Lernzeit: ${label}`, withAttachments: false });
      break;
  }
  return out;
}

export interface StudySession { date: Ymd; focus: string }

/** Zerlegt "Kapitel 5-7, Vokabeln L12 und AcI" in Themen. */
export function splitTopics(material: string): string[] {
  return material
    .split(/\s*(?:,|;|\n|\bund\b|\+)\s*/iu)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Verteilt Lerneinheiten zwischen morgen und dem Tag vor der Prüfung.
 * Mehr Einheiten kurz vor dem Termin, die letzte ist immer Wiederholung.
 */
export function buildStudyPlan(examDate: Ymd, today: Ymd, material: string, maxSessions = 6): StudySession[] {
  const available: Ymd[] = [];
  for (let d = addDays(today, 1); d < examDate; d = addDays(d, 1)) available.push(d);
  if (!available.length) return [];

  // Samstage lieber auslassen, wenn genug Tage da sind
  const preferred = available.length > maxSessions ? available.filter((d) => weekdayOf(d) !== 6) : available;
  const count = Math.min(maxSessions, preferred.length);
  const days: Ymd[] = [];
  for (let i = 0; i < count; i++) {
    // quadratische Verteilung → dichter Richtung Prüfung
    const t = count === 1 ? 1 : i / (count - 1);
    const idx = Math.round((1 - (1 - t) ** 1.6) * (preferred.length - 1));
    if (!days.includes(preferred[idx])) days.push(preferred[idx]);
  }

  const topics = splitTopics(material);
  return days.map((date, i) => {
    const last = i === days.length - 1;
    if (last && days.length > 1) return { date, focus: 'Alles wiederholen + Probe-Test unter Zeitdruck' };
    if (!topics.length) return { date, focus: i === 0 ? 'Überblick verschaffen, Unklares markieren' : 'Üben & Fehler wiederholen' };
    const learnSlots = days.length > 1 ? days.length - 1 : 1;
    const perSlot = Math.ceil(topics.length / learnSlots);
    const chunk = topics.slice(i * perSlot, (i + 1) * perSlot);
    return { date, focus: chunk.length ? chunk.join(', ') : 'Schwierige Themen nochmal üben' };
  });
}

export function describePlan(sessions: StudySession[], today: Ymd): string {
  return sessions.map((s) => `• ${formatDateDe(s.date, today)}: ${s.focus}`).join('\n');
}

export function daysUntil(date: Ymd, today: Ymd): number {
  return diffDays(today, date);
}
