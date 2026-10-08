import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinRows, validPin, cleanPinName } from '../admin/pins-view.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rows = [{ pin: '560102', name: 'HSR Layout', active: true }, { pin: '562106', name: 'Anekal', active: true }, { pin: '560001', name: 'MG Road', active: false }];

test('pin rows are sorted by PIN, searchable by PIN or area, and paused ones are marked', () => {
  assert.deepEqual(pinRows(rows).map((r) => r.pin), ['560001', '560102', '562106']);
  assert.deepEqual(pinRows(rows, 'hsr').map((r) => r.pin), ['560102']);
  assert.deepEqual(pinRows(rows, '5621').map((r) => r.pin), ['562106']);
  assert.equal(pinRows(rows).find((r) => r.pin === '560001').status, 'Paused');
  assert.equal(pinRows(rows).find((r) => r.pin === '560102').status, 'Served');
});
test('a PIN must be six digits and the area name is cleaned', () => {
  assert.equal(validPin('560102'), true); assert.equal(validPin(' 560 102 '), true); assert.equal(validPin('12345'), false); assert.equal(validPin('abcdef'), false);
  assert.equal(cleanPinName('  <b>Hebbal</b>   Kempapura '), 'Hebbal Kempapura'); assert.equal(cleanPinName('x'.repeat(100)).length, 60);
});
test('the database holds the served PIN codes: everyone can read, only the owner can change, and the 106 current ones are loaded', () => {
  const sql = read('../supabase/migrations/20261026000000_service_pincodes.sql');
  assert.match(sql, /create table if not exists public\.service_pincodes/); assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to anon, authenticated using \(true\)/);
  for (const op of ['insert', 'update', 'delete']) assert.match(sql, new RegExp(`for ${op} to authenticated`));
  assert.match(sql, /public\.is_owner\(\)/); assert.equal((sql.match(/\('56\d{4}', '/g) || []).length, 106); assert.match(sql, /'560102', 'HSR Layout'/);
  assert.match(sql, /on conflict \(pin\) do nothing/);
});
test('the website reads the live list, so a PIN added or paused in the admin shows up without a new release', () => {
  const js = read('../assets/js/pins-live.js');
  assert.match(js, /\/rest\/v1\/service_pincodes/); assert.match(js, /mxp:pins/); assert.match(js, /MXP_PINS_OFF/);
  assert.match(read('../assets/js/pincheck.js'), /mxp:pins/); assert.match(read('../assets/js/app.js'), /mxp:pins/);
  assert.match(read('../index.html'), /pins-live\.js/); assert.match(read('../book/index.html'), /pins-live\.js/);
});
test('the admin has a PIN codes tab to add, rename, pause and delete served PIN codes (owner only)', () => {
  assert.match(read('../admin/index.html'), /data-tab="pins"/);
  const a = read('../admin/admin.js');
  for (const act of ['addPin', 'savePin', 'togglePin', 'deletePin']) assert.ok(a.includes(act), act);
  assert.match(a, /from\('service_pincodes'\)/); assert.match(a, /pin_added|pin_updated|pin_deleted/);
});
