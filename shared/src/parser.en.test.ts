import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, type Intent } from './parser.ts';

// Mittwoch, 4. November 2026
const TODAY = '2026-11-04';
const en = (text: string, now = '12:00') => interpret(text, TODAY, now, { locale: 'en' });
const create = (text: string) => { const i = en(text); assert.equal(i?.type, 'create', text); return (i as Extract<Intent, { type: 'create' }>).entry; };

test('Hausaufgabe mit Seite, Aufgabe und Wochentag', () => {
  const e = create('math homework p. 45 no. 3 friday');
  assert.equal(e.kind, 'homework');
  assert.equal(e.title, 'Math Homework');
  assert.equal(e.page, '45');
  assert.equal(e.exercises, '3');
  assert.equal(e.due, '2026-11-06');
  assert.equal(e.detail, 'p. 45 no. 3');
});

test('Hausaufgabe ohne Datum: nächster Schultag', () => {
  const e = create('French hw page 20-21 ex 1, 2');
  assert.equal(e.dueAssumed, true);
  assert.equal(e.page, '20–21');
  assert.equal(e.exercises, '1, 2');
});

test('Test mit Datum in drei Schreibweisen', () => {
  assert.equal(create('history test 12.11.').due, '2026-11-12');
  assert.equal(create('chemistry exam on 12 Nov').due, '2026-11-12');
  assert.equal(create('physics quiz November 12th').due, '2026-11-12');
  assert.equal(create('math test next week tuesday').due, '2026-11-10');
  assert.equal(create('latin test in 3 days').due, '2026-11-07');
  assert.equal(create('english presentation tomorrow').kindLabel, 'Presentation');
});

test('Termin ohne Schulwörter', () => {
  const e = create('friday 3pm hairdresser');
  assert.equal(e.kind, 'event');
  assert.equal(e.time, '15:00');
  assert.equal(e.due, '2026-11-06');
  assert.equal(e.title, 'Hairdresser');
  assert.equal(create('tomorrow dentist').kind, 'todo');
});

test('Erinnerungen: relativ, mit Uhrzeit, vor und nach dem Text', () => {
  assert.deepEqual(en('remind me in 2 hours to call mom', '10:30'), { type: 'remind', due: TODAY, time: '12:30', text: 'Call mom' });
  assert.deepEqual(en('in 30 min pizza out of the oven', '23:50'), { type: 'remind', due: '2026-11-05', time: '00:20', text: 'Pizza out of the oven' });
  assert.deepEqual(en('remind me tomorrow at 5pm to pick up the parcel'), { type: 'remind', due: '2026-11-05', time: '17:00', text: 'Pick up the parcel' });
  assert.deepEqual(en('remind me to take my pills at 8:30'), { type: 'remind', due: '2026-11-05', time: '08:30', text: 'Take my pills' });
  assert.deepEqual(en('remind me at 5 to water the plants', '09:00'), { type: 'remind', due: TODAY, time: '17:00', text: 'Water the plants' });
});

test('Daueraufträge', () => {
  assert.deepEqual(en('remind me every monday at 7am to take out the trash'), { type: 'recurring', recurrence: 'weekly:1', time: '07:00', text: 'Take out the trash' });
  assert.deepEqual(en('remind me every weekday at 8:00 to take my vitamins'), { type: 'recurring', recurrence: 'weekly:1,2,3,4,5', time: '08:00', text: 'Take my vitamins' });
  assert.deepEqual(en('remind me daily to stretch'), { type: 'recurring', recurrence: 'daily', time: null, text: 'Stretch' });
  assert.equal((en('remind me on the 15th of every month at 9 to pay rent') as { recurrence: string }).recurrence, 'monthly:15');
});

test('Einkaufsliste', () => {
  assert.deepEqual(en('add milk and 2 liters of juice to the shopping list'), { type: 'list_add', items: [{ text: 'Milk', qty: null }, { text: 'Juice', qty: '2 liters' }] });
  assert.deepEqual(en('we need eggs, butter'), { type: 'list_add', items: [{ text: 'Eggs', qty: null }, { text: 'Butter', qty: null }] });
  assert.equal(en('we need help'), null, 'kein Einkauf');
  assert.deepEqual(en("what's on the shopping list?"), { type: 'list_show' });
  assert.deepEqual(en('I got everything'), { type: 'list_done', items: 'all' });
  assert.deepEqual(en('bought the milk'), { type: 'list_done', items: ['Milk'] });
  assert.equal(en('math homework done')?.type, 'done', 'Schulwort schlägt Einkaufsliste');
});

test('Erledigungen mit Ort', () => {
  const i = en('after work buy flowers for my wife') as Extract<Intent, { type: 'errand' }>;
  assert.equal(i.type, 'errand');
  assert.equal(i.when, 'after_work');
  assert.equal(i.place?.category, 'florist');
  const j = en('pick up my prescription tonight') as Extract<Intent, { type: 'errand' }>;
  assert.equal(j.place?.category, 'pharmacy');
  assert.equal(j.when, 'evening');
});

test('Agenda, erledigt, verschieben, absagen, Korrektur, merken', () => {
  assert.deepEqual(en("what's up?"), { type: 'agenda', days: 14 });
  assert.deepEqual(en('what do I have this week'), { type: 'agenda', days: 7 });
  assert.deepEqual(en('finished the math homework'), { type: 'done', subject: 'Mathe', kind: 'homework' });
  const move = en('move the dentist to monday at 4pm') as Extract<Intent, { type: 'move' }>;
  assert.equal(move.type, 'move');
  assert.deepEqual([move.query.words, move.due, move.time], [['dentist'], '2026-11-09', '16:00']);
  const del = en('cancel the english homework') as Extract<Intent, { type: 'delete' }>;
  assert.equal(del.type, 'delete');
  assert.equal(del.query.subject, 'Englisch');
  assert.deepEqual(en('no, thursday'), { type: 'correct', due: '2026-11-05', time: null });
  assert.deepEqual(en('make it 6pm'), { type: 'correct', due: null, time: '18:00' });
  assert.deepEqual(en('remember that Mia is my best friend'), { type: 'remember', text: 'Mia is my best friend' });
});

test('alles andere geht an die KI, andere Sprachen haben keinen Schnellweg', () => {
  assert.equal(en('How do I get better at maths?'), null);
  assert.equal(en('Can you help me plan a birthday party for my sister next month?'), null);
  assert.equal(interpret('matemáticas deberes página 45 viernes', TODAY, '12:00', { locale: 'es' }), null);
  // Deutsch bleibt wie bisher (Standard ohne Angabe)
  assert.equal(interpret('Latein HÜ S. 45 Nr. 3 Freitag', TODAY)?.type, 'create');
});
