import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mechanicStats } from '../admin/people.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('migration adds the mechanic profile fields and a confirmed time, safely', () => {
  const sql = read('../supabase/migrations/20261016000000_mechanic_profile.sql');
  for (const c of ['city', 'specialties', 'experience_years', 'certified', 'notes']) assert.match(sql, new RegExp('mechanics\\s+add column if not exists ' + c + '\\b|add column if not exists ' + c + '\\b'), c);
  assert.match(sql, /add column if not exists confirmed_at/);
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
});
test('mechanicStats carries the profile so the roster can show it', () => {
  const r = mechanicStats([{ id: 'm1', name: 'Ravi', active: true, payout_rate: 40, city: 'Bengaluru', specialties: 'Scooters, EV', experience_years: 6, certified: true }], []).find((x) => x.id === 'm1');
  assert.equal(r.city, 'Bengaluru'); assert.equal(r.specialties, 'Scooters, EV'); assert.equal(r.years, 6); assert.equal(r.certified, true);
});
test('mechanic defaults: certified unless switched off, city defaults to Bengaluru', () => {
  const r = mechanicStats([{ id: 'm2', name: 'Asha', payout_rate: 0 }], [])[0];
  assert.equal(r.certified, true); assert.equal(r.city, 'Bengaluru'); assert.equal(r.years, 0);
});
test('confirm-booking is admin-only, emails the customer, logs it and moves the booking to scheduled', () => {
  const f = read('../supabase/functions/confirm-booking/index.ts');
  assert.match(f, /from\('admins'\)/);
  assert.match(f, /bookingConfirmed\(/);
  assert.match(f, /email_log/);
  assert.match(f, /status: 'scheduled'/);
  assert.match(f, /confirmed_at/);
  assert.match(f, /Mechanix Pro certified/);
});
test('admin has profile fields and a confirm button that calls the function', () => {
  const a = read('../admin/admin.js');
  for (const id of ['mcity', 'msp', 'mexp', 'mcert', 'mnotes']) assert.ok(a.includes('id="' + id + '"'), id);
  assert.match(a, /data-act="confirmBooking"/);
  assert.match(a, /functions\.invoke\('confirm-booking'/);
});
