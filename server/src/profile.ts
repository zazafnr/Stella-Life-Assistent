// Profil aus der Einführung: wer Stella benutzt und wobei sie helfen soll. Steuert, was die Oberfläche zeigt,
// welche Hinweise Stella gibt und wann sie plant (Arbeitszeiten sind belegt).

import { FEATURES, profileHas, profileIsLearner, profileIsSchool, SITUATIONS, AGE_GROUPS, type Feature, type UserProfile } from '@stella/shared';
import { getUser, updateUserSettings, type User } from './db.ts';
import { HttpError } from './auth.ts';
import { addMemory } from './memory.ts';

export const hasFeature = (user: User, f: Feature) => profileHas(user.settings.profile, f);
export const isSchool = (user: User) => profileIsSchool(user.settings.profile);
/** Schule oder Studium: Tests, Lerneinheiten, Lernpläne */
export const isLearner = (user: User) => profileIsLearner(user.settings.profile);

const HHMM = /^\d{2}:\d{2}$/;

/** Eingabe prüfen: nur bekannte Werte, sinnvolle Zeiten. */
export function cleanProfile(raw: unknown): UserProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!SITUATIONS.includes(r.situation as never)) throw new HttpError(400, 'Bitte wähle aus, was auf dich zutrifft.');
  const situation = r.situation as UserProfile['situation'];
  const features = [...new Set((Array.isArray(r.features) ? r.features : []).filter((f): f is Feature => FEATURES.includes(f as never)))];
  const out: UserProfile = { situation, features };
  if (AGE_GROUPS.includes(r.ageGroup as never)) out.ageGroup = r.ageGroup as UserProfile['ageGroup'];

  const w = r.workHours as Record<string, unknown> | undefined;
  if (w && (situation === 'work' || situation === 'apprenticeship')) {
    const days = [...new Set((Array.isArray(w.days) ? w.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    if (days.length && HHMM.test(String(w.start)) && HHMM.test(String(w.end)) && String(w.end) > String(w.start)) {
      out.workHours = { days, start: String(w.start), end: String(w.end), ...(w.commute === true ? { commute: true } : {}) };
    }
  }
  const level = (r.school as { level?: unknown } | undefined)?.level;
  if (situation === 'school' && typeof level === 'string' && level.trim()) out.school = { level: level.trim().slice(0, 40) };
  const uni = (r.university as { name?: unknown } | undefined)?.name;
  if (situation === 'university' && typeof uni === 'string' && uni.trim()) out.university = { name: uni.trim().slice(0, 80) };
  return out;
}

/** „Nach der Arbeit“: Ende der Arbeitszeit, sonst 17:30 */
export function afterWorkTime(user: User): string {
  return user.settings.profile?.workHours?.end ?? '17:30';
}

export const WORK_ROUTINE = 'Arbeit';

/**
 * Profil speichern und umsetzen:
 * - Arbeitszeiten werden eine Routine im Gedächtnis → im Lagebild belegt, der Wochenplaner plant nicht hinein
 * - außerhalb der Schule ist der HÜ-Autopilot aus
 */
export function applyProfile(user: User, profile: UserProfile): User {
  const patch: Parameters<typeof updateUserSettings>[1] = { profile, onboarding: 'done' };
  if (profile.situation !== 'school' && !user.settings.permissions?.homework) {
    patch.permissions = { ...user.settings.permissions, homework: 'never' };
  } else if (profile.situation === 'school' && user.settings.permissions?.homework === 'never' && !user.settings.profile) {
    // erstes Profil als Schüler:in: Autopilot wie üblich an
    const { homework: _h, ...rest } = user.settings.permissions;
    patch.permissions = rest;
  }
  updateUserSettings(user.id, patch);
  if (profile.workHours) {
    const w = profile.workHours;
    addMemory(user.id, { category: 'routine', text: WORK_ROUTINE, source: 'user', schedule: { days: w.days, start: w.start, end: w.end } });
  }
  return getUser(user.id)!;
}

/** „Überspringen“: ein schlankes Profil, ohne Schulkram */
export function skipProfile(user: User): User {
  return applyProfile(user, { situation: 'other', features: ['mails', 'planner', 'shopping', 'goals', 'health'] });
}
