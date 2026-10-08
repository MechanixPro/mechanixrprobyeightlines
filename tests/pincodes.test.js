const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/js/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const data = JSON.parse(read('src/pincodes.json')).pins;

test('every Bengaluru PIN code from 560001 to 560110 that India Post uses is in the list', () => {
  const pins = Object.keys(data);
  assert.equal(pins.length, 106);
  for (let p = 560001; p <= 560110; p++) { if ([560031, 560044, 560101, 560106].includes(p)) continue; assert.ok(data[String(p)], 'missing ' + p); }
  for (const p of pins) assert.ok(data[p].name && data[p].areas.length, p);
});
test('the website gets the same list, as a small script', () => {
  global.window = {}; delete require.cache[require.resolve('../assets/js/pincodes.js')]; require('../assets/js/pincodes.js');
  assert.equal(Object.keys(global.window.MXP_PINS).length, 106); assert.equal(global.window.MXP_PINS['560102'], 'HSR Layout');
});
test('pinInfo tells a visitor whether we serve their PIN and names the area', () => {
  const pins = { '560102': 'HSR Layout', '560001': 'Vidhana Soudha' };
  assert.deepEqual(L.pinInfo('560102', pins), { pin: '560102', name: 'HSR Layout', served: true, known: true });
  assert.deepEqual(L.pinInfo(' 560 001 ', pins), { pin: '560001', name: 'Vidhana Soudha', served: true, known: true });
  assert.deepEqual(L.pinInfo('560031', pins), { pin: '560031', name: '', served: true, known: false });
  assert.deepEqual(L.pinInfo('600001', pins), { pin: '600001', name: '', served: false, known: false });
  assert.equal(L.pinInfo('12345', pins), null); assert.equal(L.pinInfo('abcdef', pins), null);
});
test('anywhere inside Bengaluru is served; only places outside the city are not', () => {
  const a = L.nearestPlace(12.9784, 77.6408); assert.equal(a.name, 'Indiranagar'); assert.equal(a.served, true);
  const b = L.nearestPlace(12.9698, 77.7500); assert.equal(b.name, 'Whitefield'); assert.equal(b.served, true);
  assert.equal(L.nearestPlace(12.9121, 77.6446).served, true);
  const out = L.nearestPlace(13.0827, 80.2707); assert.equal(out.served, false); assert.equal(out.name, 'Other area');
  assert.equal(L.nearestPlace(NaN, 1), null);
});
test('the PIN check is on the home page, the help page and a page that lists every PIN code', () => {
  for (const f of ['index.html', 'help/index.html']) { const h = read(f); assert.match(h, /data-pincheck/); assert.match(h, /All of Bengaluru/); assert.doesNotMatch(h, /South-East Bengaluru|Starting in/); }
  const a = read('areas/index.html');
  assert.equal((a.match(/class="pin-row"/g) || []).length, 106); assert.match(a, /560102/); assert.match(a, /HSR Layout/); assert.equal((a.match(/<h1/g) || []).length, 1);
  assert.match(read('sitemap.xml'), /\/areas\//);
});
test('the booking form asks for a PIN code, fills the area from it, and sends it with the booking', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /id="f-pin"/); assert.match(app, /autocomplete="postal-code"/); assert.match(app, /L\.pinInfo\(/);
  const lead = L.leadPayload({ contact: 'whatsapp', brand: 'Honda', model: 'Activa', nick: '', type: 's', cc: 'std', issues: [], addons: [], place: 'home', area: 'HSR Layout', pin: '560102', dateIso: '2026-10-11', hour: 10, slot: 'morning', name: 'A', phone: '9876543210', service: 'general' }, '2026-10-11', '2026-10-08');
  assert.equal(lead.pincode, '560102');
  assert.equal(L.leadPayload({ contact: 'whatsapp', brand: 'Honda', model: 'Activa', nick: '', type: 's', cc: 'std', issues: [], addons: [], place: 'home', pin: '12', service: 'general', name: 'A', phone: '9876543210' }, '2026-10-11', '2026-10-08').pincode, '');
});
test('area wording says we serve all of Bengaluru everywhere customers or the AI read it', () => {
  assert.doesNotMatch(read('supabase/functions/_shared/ai.ts'), /South-East Bengaluru/);
  assert.match(read('supabase/migrations/20261023000000_serve_all_bengaluru.sql'), /pincode/);
  assert.match(read('supabase/functions/_shared/lead-fields.ts'), /pincode/);
});

test('a PIN code the company has paused is reported as not served', () => {
  assert.deepEqual(L.pinInfo('560102', { '560102': 'HSR Layout' }, { '560102': true }), { pin: '560102', name: '', served: false, known: false });
  assert.equal(L.pinInfo('560110', {}, {}).served, true);
});
