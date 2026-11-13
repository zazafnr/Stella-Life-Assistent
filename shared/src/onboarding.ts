// Reihenfolge der Einführung – für Web und iOS gleich (die iOS-App hat dieselbe Liste in OnboardingView.swift).

import type { Situation } from './types.ts';

export const ONBOARDING_STEPS = ['language', 'welcome', 'name', 'situation', 'freenotes', 'age', 'details', 'features', 'location', 'calendar', 'mail', 'tone', 'briefing', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Schritte je Lebenssituation: FreeNotes nur in der Schule, Details nur, wo es etwas einzustellen gibt. */
export function onboardingSteps(situation?: Situation): OnboardingStep[] {
  const details = situation === 'school' || situation === 'university' || situation === 'work' || situation === 'apprenticeship';
  return ONBOARDING_STEPS.filter((s) => (s !== 'freenotes' || situation === 'school') && (s !== 'details' || details));
}

/** Ergebnis der Standort-Abfrage: 'later' = Erklär-Folie mit „Später“ beantwortet, wird bei Bedarf noch einmal gefragt */
export const LOCATION_PERMISSIONS = ['granted', 'denied', 'later'] as const;
export type LocationPermission = (typeof LOCATION_PERMISSIONS)[number];
export const isLocationPermission = (v: unknown): v is LocationPermission => typeof v === 'string' && (LOCATION_PERMISSIONS as readonly string[]).includes(v);
