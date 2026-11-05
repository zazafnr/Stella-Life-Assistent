import type { CalendarKind } from '@stella/shared';

/** Farbe je Art – nur über Variablen der App (theme.css); die Ausweichwerte gelten, wenn eine App keine eigene Farbe festlegt */
export const KIND_COLOR: Record<CalendarKind, string> = {
  event: 'var(--cal-event, var(--blue))',
  todo: 'var(--cal-todo, var(--muted))',
  exam: 'var(--cal-exam, var(--pink-text))',
  study: 'var(--cal-study, var(--green-stroke))',
  assignment: 'var(--cal-assignment, var(--deadline-text, #B7791F))',
  homework: 'var(--cal-assignment, var(--deadline-text, #B7791F))',
  reminder: 'var(--cal-reminder, var(--pink))',
  lesson: 'var(--cal-lesson, var(--blue-light))',
  goal: 'var(--cal-goal, var(--blue-2))',
  routine: 'var(--cal-routine, var(--faint))',
};
