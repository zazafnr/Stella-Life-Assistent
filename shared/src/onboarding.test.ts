import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingSteps, ONBOARDING_STEPS, isLocationPermission, LOCALES, t } from './index.ts';

test('Einführung: Sprache steht ganz vorn, FreeNotes nur in der Schule, Details nur wo nötig', () => {
  const school = onboardingSteps('school');
  assert.deepEqual(school, ['language', 'welcome', 'name', 'situation', 'freenotes', 'age', 'details', 'features', 'location', 'mail', 'tone', 'briefing', 'done']);
  assert.ok(!onboardingSteps('work').includes('freenotes'));
  assert.ok(onboardingSteps('work').includes('details'));
  assert.ok(!onboardingSteps('other').includes('details'));
  assert.ok(!onboardingSteps().includes('freenotes'));
  for (const s of ['school', 'university', 'work', 'apprenticeship', 'other'] as const) {
    const steps = onboardingSteps(s);
    assert.equal(steps[0], 'language');
    assert.equal(steps.at(-1), 'done');
    assert.ok(steps.indexOf('location') < steps.indexOf('mail'), 'Standort vor Mail');
  }
});

test('Standort-Status: nur granted, denied, later', () => {
  assert.ok(isLocationPermission('later'));
  assert.ok(!isLocationPermission('always'));
});

test('Die Standort-Folie nennt nur Gründe, für die Stella den Standort wirklich nutzt (3 Gründe, kein Werbe-Grund)', () => {
  for (const l of LOCALES) {
    for (const k of ['onboarding.location.r1', 'onboarding.location.r2', 'onboarding.location.r3', 'onboarding.location.fine']) assert.ok(t(l, k).length > 10, `${l} ${k}`);
    assert.ok(!/\b(ads?|advert|Werbung|publicidad|publicité|pubblicità|propaganda|reklam|reklamy)\b/i.test(['r1', 'r2', 'r3'].map((r) => t(l, `onboarding.location.${r}`)).join(' ').replace(/Wetter und lokale News/, '')), `${l} nennt Werbung`);
  }
});

test('Die iOS-Einführung hat dieselbe Schritt-Reihenfolge wie Web und Server', async () => {
  const { readFileSync } = await import('node:fs');
  const swift = readFileSync(new URL('../../ios/Stella.swiftpm/Views/OnboardingView.swift', import.meta.url), 'utf8');
  const m = /private enum Step: Hashable \{ case ([a-z, ]+) \}/.exec(swift);
  assert.ok(m, 'Step-Enum nicht gefunden');
  assert.deepEqual(m![1]!.split(',').map((s) => s.trim()), [...ONBOARDING_STEPS]);
});
