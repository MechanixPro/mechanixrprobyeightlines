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
