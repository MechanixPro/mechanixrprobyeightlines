import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../assets/js/rider-tools.js'), L = require('../assets/js/logic.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const day = (s) => new Date(s + 'T12:00:00');

test('service due: time and distance both count, whichever comes first', () => {
  const now = day('2026-10-23');
  assert.equal(T.dueStatus('scooter', '2026-10-01', 500, now).state, 'ok');
  assert.equal(T.dueStatus('scooter', '2026-07-20', 1000, now).state, 'soon');      // 3.1 months of 4
  assert.equal(T.dueStatus('scooter', '2026-09-20', 3200, now).state, 'due');       // distance past 3,000 km
  assert.equal(T.dueStatus('commuter', '2026-05-01', 800, now).state, 'due');       // 5+ months of 4
  assert.equal(T.dueStatus('scooter', '2026-09-20', 3200, now).why, 'distance');
});
test('electric bikes only count time, and bad input gives nothing', () => {
  const now = day('2026-10-23');
  assert.equal(T.dueStatus('ev', '2026-09-01', 99999, now).state, 'ok');
  assert.equal(T.dueStatus('ev', '2026-02-01', 0, now).state, 'due');
  assert.equal(T.dueStatus('scooter', '2027-01-01', 100, now), null);
  assert.equal(T.dueStatus('scooter', '2026-09-01', 999999, now), null);
  assert.equal(T.dueStatus('jet', '2026-09-01', 1, now), null);
});
test('the symptom guide takes up to three, sends brakes and tyres to roadside help, and links a prefilled problem check', () => {
  const p = T.symptomPlan(['brake', 'start', 'chain', 'leak', 'brake', 'nonsense']);
  assert.deepEqual(p.items.map((i) => i.key), ['brake', 'start', 'chain']);
  assert.equal(p.road, true); assert.equal(p.service, 'repair');
  assert.equal(p.bookUrl, '/book/?service=repair&issues=brake,start,chain');
  assert.equal(T.symptomPlan(['chain']).road, false); assert.equal(T.symptomPlan([]).bookUrl, '');
  for (const s of Object.values(T.SYMPTOMS)) assert.doesNotMatch(s.causes, /always|guarantee|definitely/i);
});
test('every symptom the guide links is a problem the booking builder knows, and the builder reads them from the link', () => {
  const ids = Object.keys(T.SYMPTOMS);
  const q = L.prefillExtras('?issues=' + ids.join(',') + ',bogus&km=gt6', ['basic', 'general', 'repair']);
  assert.deepEqual(q.issues, ids.slice(0, 4)); assert.equal(q.km, 'gt6');
  assert.deepEqual(L.prefillExtras('?issues=evil,<b>', []).issues, []); assert.equal(L.prefillExtras('?km=evil', []).km, '');
  for (const id of ids) assert.ok(L.prefillExtras('?issues=' + id, []).issues.length === 1, id);
});
test('the home page has the two tools, and the page script has no inline code', () => {
  const h = read('../index.html');
  for (const id of ['rider-tools', 'due-type', 'due-date', 'due-km', 'due-out', 'sym-out']) assert.match(h, new RegExp('id="' + id + '"'), id);
  assert.match(h, /rider-tools\.js/); assert.doesNotMatch(h, /<script>[^<]*dueStatus/);
});
test('the calendar reminder is a valid all-day event on the due date with a two-day nudge', () => {
  const ics = T.reminderIcs('scooter', day('2026-11-20'), new Date('2026-10-23T05:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /DTSTART;VALUE=DATE:20261120/); assert.match(ics, /DTEND;VALUE=DATE:20261121/);
  assert.match(ics, /SUMMARY:Bike service due: scooter/); assert.match(ics, /TRIGGER:-P2D/); assert.match(ics, /END:VCALENDAR$/);
  assert.doesNotMatch(ics, /<|>/);
});
test('the pre-ride check lists what is missing, puts brakes and tyres first, and links a prefilled problem check', () => {
  const all = ['tyre', 'brake', 'chain', 'leak', 'elec', 'battery', 'fuel', 'gear'];
  assert.equal(T.preRide(all).ready, true); assert.equal(T.preRide(all).bookUrl, '');
  const p = T.preRide(['chain', 'leak', 'elec', 'battery', 'fuel', 'gear']);
  assert.equal(p.ready, false); assert.deepEqual(p.missing, ['tyre', 'brake']); assert.equal(p.safetyFirst, true);
  assert.equal(p.bookUrl, '/book/?service=repair&issues=tyre,brake');
  const q = T.preRide(['tyre', 'brake', 'chain', 'leak', 'elec', 'battery', 'gear']);
  assert.deepEqual(q.missing, ['fuel']); assert.equal(q.safetyFirst, false); assert.equal(q.bookUrl, '');
});
test('the home page has the pre-ride checklist with eight items', () => {
  const h = read('../index.html'); assert.match(h, /id="rt-pre"/); assert.equal((h.match(/data-k="/g) || []).length, 8);
});
test('the install button is a plain script that only appears when the browser offers an install', () => {
  const js = read('../assets/js/install.js'); assert.match(js, /beforeinstallprompt/); assert.match(js, /preventDefault/);
  assert.match(read('../index.html'), /install\.js/); assert.doesNotMatch(read('../index.html'), /<script>[^<]*beforeinstallprompt/);
});
