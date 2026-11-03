import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestByPin } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const geo = { '560102': [12.91, 77.64], '560068': [12.90, 77.63], '560004': [12.945, 77.576] };
const techs = [
  { id: 'far', name: 'Far', area: 'Basavanagudi', pincodes: ['560004'], jobs: [] },
  { id: 'cov', name: 'Cover', area: 'Bommanahalli', pincodes: ['560068', '560102'], jobs: [{ id: 'j' }] },
  { id: 'none', name: 'Nopin', area: '', pincodes: [], jobs: [] },
];
const garages = [{ id: 'g1', name: 'Far garage', pincode: '560004' }, { id: 'g2', name: 'Near garage', pincode: '560068' }];

test('technicians who cover the PIN come first, then the rest by distance, unknown ones last', () => {
  const r = nearestByPin('560102', techs, garages, geo);
  assert.equal(r.pinKnown, true);
  assert.deepEqual(r.techs.map((t) => t.id), ['cov', 'far', 'none']);
  assert.equal(r.techs[0].covers, true); assert.equal(r.techs[0].jobs, 1);
  assert.equal(r.techs[1].covers, false); assert.ok(r.techs[1].km > 5 && r.techs[1].km < 10, String(r.techs[1].km));
  assert.equal(r.techs[2].km, null);
  assert.deepEqual(r.garages.map((g) => g.id), ['g2', 'g1']);
  assert.equal(r.techs[0].km, 1.6);
});
test('a PIN with no centre point still lists the technicians who cover it', () => {
  const r = nearestByPin('560114', [{ id: 'x', name: 'X', pincodes: ['560114'], jobs: [] }, ...techs], garages, geo);
  assert.equal(r.pinKnown, false); assert.equal(r.techs[0].id, 'x'); assert.equal(r.techs[0].covers, true);
});
test('a PIN that is not 6 digits is refused with a plain message', () => {
  assert.throws(() => nearestByPin('5601', techs, garages, geo), /Enter a 6-digit PIN code\./);
});
test('Crew ships the PIN centre file and shows Find by PIN on My day and Mechanics', () => {
  assert.match(read('scripts/build_crm.sh'), /pingeo\.js/);
  assert.match(read('crm/index.html'), /\/assets\/js\/pingeo\.js/);
  assert.match(read('crm/crm.js'), /Find by PIN/); assert.match(read('crm/pages/mechanics.js'), /Find by PIN/);
  assert.match(read('crm/pages/pinsearch.js'), /nearestByPin\(/); assert.match(read('crm/pages/pinsearch.js'), /No garages near this PIN yet\./);
});
