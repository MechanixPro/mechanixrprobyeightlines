const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/js/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const BIKES = { Honda: [['Activa 6G', 's', 0]] };

test('a link can prefill the bike name and the service', () => {
  const p = L.prefillExtras('?brand=Honda&model=Activa%206G&nick=Raja%3Cb%3E&service=general', ['basic', 'general']);
  assert.equal(p.nick, 'Raja'); assert.equal(p.service, 'general');
  assert.equal(L.prefillExtras('?service=evil', ['basic', 'general']).service, '');
  assert.equal(L.prefillExtras('?nick=' + 'x'.repeat(60), []).nick.length, 24);
});
test('calendar file for a booked slot is valid and uses India time', () => {
  const ics = L.icsFor({ dateIso: '2026-10-11', hour: 10, place: 'home', nick: 'Raja', brand: 'Honda', model: 'Activa 6G', service: 'general', area: 'HSR Layout' }, 'MP-1', 'General service');
  assert.match(ics, /^BEGIN:VCALENDAR/); assert.match(ics, /END:VCALENDAR\s*$/);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261011T100000/); assert.match(ics, /DTEND;TZID=Asia\/Kolkata:20261011T110000/);
  assert.match(ics, /SUMMARY:Mechanix Pro/); assert.match(ics, /MP-1/);
  assert.equal(L.icsFor({ dateIso: '', hour: null, place: 'home' }, 'MP-1', 'x'), '');
  assert.equal(L.icsFor({ dateIso: '2026-10-11', hour: 10, place: 'road' }, 'MP-1', 'x'), '');
});
test('after sending, a success popup names the bike, shows the next steps and offers the calendar', () => {
  const a = read('assets/js/app.js');
  assert.match(a, /doneSheet/); assert.match(a, /Add to calendar/); assert.match(a, /L\.icsFor\(/); assert.match(a, /Open WhatsApp now/);
});
test('returning visitors with a saved build get a welcome-back card', () => {
  const a = read('assets/js/app.js');
  assert.match(a, /function welcomeBack\(/); assert.match(a, /Welcome back/);
  assert.match(read('assets/css/style.css'), /\.welcome/);
});

test('after sending, the confirmation prints like a receipt: a slot, a paper that slides out, perforation, details, a barcode and confetti', () => {
  const a = read('assets/js/app.js'); const fn = a.slice(a.indexOf('function showDone'), a.indexOf('/* ---------- events'));
  for (const c of ['rcpt-slot', 'rcpt-paper', 'rcpt-perf', 'rcpt-rows', 'rcpt-barcode', 'confetti']) assert.ok(fn.includes(c), c);
  for (const t of ['Thank you!', 'Reference', 'Estimate', 'Status', 'Request received', 'Open WhatsApp now', 'Add to calendar']) assert.ok(fn.includes(t), t);
  const css = read('assets/css/style.css'); const i = css.indexOf('.rcpt-paper');
  assert.ok(i > 0); for (const k of ['@keyframes rcptPrint', '@keyframes cfFall']) assert.ok(css.includes(k), k);
  assert.match(css.slice(css.indexOf('/* receipt checkout')), /prefers-reduced-motion/);
});
test('the barcode drawing is the same for the same reference and different for another', () => {
  assert.equal(typeof L.receiptBars, 'function');
  assert.deepEqual(L.receiptBars('MP-ABC123'), L.receiptBars('MP-ABC123')); assert.notDeepEqual(L.receiptBars('MP-ABC123'), L.receiptBars('MP-ABC124'));
  assert.ok(L.receiptBars('MP-1').every((w) => w >= 1 && w <= 3));
});
