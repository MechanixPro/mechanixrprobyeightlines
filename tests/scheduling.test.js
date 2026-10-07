const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/js/logic.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'assets/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets/css/style.css'), 'utf8');
const NOW = new Date('2026-10-08T10:20:00+05:30'); // a Thursday, 10:20 in India

test('the calendar for October 2026 starts on a Thursday and shows 31 days', () => {
  const g = L.calendarGrid(2026, 9, '2026-10-08', 30);
  assert.equal(g.title, 'October 2026');
  assert.deepEqual(g.weeks[0].map((c) => (c ? c.d : null)), [null, null, null, null, 1, 2, 3]);
  assert.equal(g.weeks.flat().filter(Boolean).length, 31);
  for (const w of g.weeks) assert.equal(w.length, 7);
});
test('past days and days beyond 30 ahead cannot be picked, today and the last day can', () => {
  const g = L.calendarGrid(2026, 9, '2026-10-08', 30), day = (n) => g.weeks.flat().find((c) => c && c.d === n);
  assert.equal(day(7).disabled, true); assert.equal(day(8).disabled, false); assert.equal(day(8).today, true); assert.equal(day(31).disabled, false);
  const nov = L.calendarGrid(2026, 10, '2026-10-08', 30), nd = (n) => nov.weeks.flat().find((c) => c && c.d === n);
  assert.equal(nd(7).disabled, false); assert.equal(nd(8).disabled, true);
});
test('month navigation is limited to the booking window', () => {
  const oct = L.calendarGrid(2026, 9, '2026-10-08', 30); assert.equal(oct.canPrev, false); assert.equal(oct.canNext, true);
  const nov = L.calendarGrid(2026, 10, '2026-10-08', 30); assert.equal(nov.canPrev, true); assert.equal(nov.canNext, false);
});
test('a date is written the way a person says it', () => assert.equal(L.dayLabelFor('2026-10-11'), 'Sunday, 11 Oct'));
test('arrival windows run from 9 AM to 8 PM in one-hour steps with clear labels', () => {
  const w = L.timeWindows('2026-10-10', NOW);
  assert.deepEqual(w.map((x) => x.hour), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual([w[0].label, w[2].label, w[3].label, w[10].label], ['9–10 AM', '11 AM–12 PM', '12–1 PM', '7–8 PM']);
  assert.ok(w.every((x) => !x.disabled));
});
test('today only offers windows that start at least two hours from now', () => {
  const w = L.timeWindows('2026-10-08', NOW);
  assert.deepEqual(w.filter((x) => x.disabled).map((x) => x.hour), [9, 10, 11, 12]);
  assert.equal(w.find((x) => x.hour === 13).disabled, false);
  assert.ok(L.timeWindows('2026-10-08', new Date('2026-10-08T19:00:00+05:30')).every((x) => x.disabled));
});
test('each window belongs to the morning, afternoon or evening slot the team already uses', () => {
  assert.deepEqual([9, 11, 12, 15, 16, 19].map(L.hourGroup), ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
});
test('the preferred time reads as day plus window', () => assert.equal(L.whenLabel('2026-10-11', 10), 'Sunday, 11 Oct · 10–11 AM'));
test('the booking carries the window text and its slot group', () => {
  const p = L.leadPayload({ brand: 'Honda', model: 'Activa 6G', type: 's', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', hour: 10, slot: 'morning', name: 'A', phone: '9876543210' }, '2026-10-11');
  assert.equal(p.preferred_time, '10–11 AM'); assert.equal(p.preferred_slot, 'morning'); assert.equal(p.preferred_date, '2026-10-11');
});
test('the booking form shows a month calendar and a clock face, with keyboard-friendly buttons', () => {
  assert.match(app, /class="cal"/); assert.match(app, /data-act="pickDay"/); assert.match(app, /data-act="calPrev"/); assert.match(app, /data-act="calNext"/);
  assert.match(app, /class="clock"/); assert.match(app, /data-act="pickHour"/); assert.match(app, /data-act="ampm"/); assert.match(app, /aria-label="Choose a day"/); assert.match(app, /aria-label="Choose an arrival time"/);
  assert.doesNotMatch(app, /lb-day|lb-slot/);
});
test('the calendar and clock are styled, and still work without motion', () => {
  for (const sel of ['.cal-grid', '.cal-day', '.clock-face', '.clock-hand', '.clock-num']) assert.ok(css.includes(sel), sel);
  assert.match(css, /prefers-reduced-motion/);
});
