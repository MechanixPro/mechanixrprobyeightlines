// J2 (2026-11-09): address and Navigate on an open job, Take photo, the Available for jobs card, picker migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../assets/js/garage.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('navigateUrl: the shared pin first, else the written address, encoded; nothing when empty', () => {
  assert.equal(G.navigateUrl({ lat: 12.9716, lng: 77.5946, address: 'x' }), 'https://www.google.com/maps/dir/?api=1&destination=12.9716%2C77.5946');
  assert.equal(G.navigateUrl({ lat: null, lng: null, address: '12 MG Road', area: 'Indiranagar', pincode: '560038' }), 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('12 MG Road, Indiranagar, 560038'));
  assert.equal(G.navigateUrl({ address: null, area: null, pincode: null }), null); assert.equal(G.navigateUrl(null), null);
});
test('availabilityText: one wording for both apps', () => {
  assert.equal(G.availabilityText(true).title, 'Available for jobs'); assert.equal(G.availabilityText(false).title, 'Not available');
  assert.equal(G.availabilityText(false).help, 'Crew will not send you new jobs while you are not available.');
});
test('garage.js: Address card with Navigate and Call customer, camera and gallery inputs, switch at the top of Home', () => {
  const g = read('assets/js/garage.js');
  assert.match(g, /Go to the customer/); assert.match(g, /id: 'gNavigate'/); assert.match(g, /gCallCustomer/);   // J3: the Address card became the one-step Navigate page, and the number moved to the Vehicle-found page assert.match(g, /2026-11-09 owner decision/);
  assert.match(g, /capture: 'environment'/); assert.match(g, /Take photo/); assert.match(g, /Choose from gallery/); assert.match(g, /accept: 'image\/\*', multiple: true/);
  assert.ok(!/createObjectURL/.test(g), 'previews stay data: URLs');
  assert.ok(g.indexOf("'Availability'") < g.indexOf("'My monthly stats'") && g.indexOf("'Availability'") < g.indexOf("class: 'd-two'"), 'availability card sits above the day cards');
  const m = read('assets/js/mechanic.js'); assert.match(m, /Available for jobs/); assert.match(m, /role: 'switch'/); assert.ok(m.indexOf('statusCard(dash.mechanic') < m.indexOf('cashCard(dash.cash)'));
});
test('garage-app function: open_set unchanged, address only for the open assignment, shared place helper', () => {
  const f = read('supabase/functions/garage-app/index.ts'), s = read('supabase/functions/_shared/garage.ts');
  assert.match(f, /raw\.place = /); assert.match(s, /export function jobPlace/); assert.match(s, /if \(!open \|\| !lead\) return undefined/);
  assert.ok(!/email/.test(s.slice(s.indexOf('export function jobPlace'), s.indexOf('export function garageJobDetail'))));
});
test('migration: pickers keep every key, add available, sort unavailable last, no new column', () => {
  const m = read('supabase/migrations/20270113000000_mechanic_available.sql');
  for (const k of ["'id'", "'name'", "'code'", "'pincode'", "'status'", "'area'", "'skills'", "'available'"]) assert.ok(m.includes(k), k);
  assert.match(m, /order by \(not coalesce\(is_open, true\)\), name/); assert.match(m, /order by \(availability <> 'available'\), name/); assert.match(m, /Roll back/); assert.ok(!/alter table/i.test(m));
  assert.match(read('crm/crm.js'), /Not available/); assert.match(read('crm/garage-desk.js'), /Not available/);
});
