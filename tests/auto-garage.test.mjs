import test from 'node:test';
import assert from 'node:assert/strict';
import { pickGarage, haversineKm, normalizeAuto } from '../supabase/functions/_shared/auto-garage.ts';

const S = { max_open_jobs: 3, radius_km: 15 };
const g = (id, o = {}) => ({ id, open_jobs: 0, available: true, ...o });
const lead = { lat: 12.9716, lng: 77.5946, pincode: '560001' };

test('haversine: about 1 degree of latitude is 111 km', () => assert.ok(Math.abs(haversineKm(12, 77, 13, 77) - 111.2) < 0.5));
test('nearest within radius wins', () => {
  const gs = [g('far', { lat: 13.05, lng: 77.6 }), g('near', { lat: 12.98, lng: 77.6 })];
  assert.equal(pickGarage(lead, gs, S), 'near');
});
test('radius exceeded falls back to same pincode', () => {
  const gs = [g('a', { lat: 13.4, lng: 77.9, pincode: '560099' }), g('b', { lat: 13.4, lng: 77.9, pincode: '560001' })];
  assert.equal(pickGarage(lead, gs, S), 'b');
});
test('radius exceeded and no pincode match falls back to round robin', () => {
  const gs = [g('a', { lat: 13.4, lng: 77.9, open_jobs: 2 }), g('b', { lat: 13.4, lng: 77.9, open_jobs: 1, last_assigned_at: '2026-11-01T00:00:00Z' }), g('c', { open_jobs: 1, last_assigned_at: '2026-10-01T00:00:00Z' })];
  assert.equal(pickGarage(lead, gs, S), 'c');
});
test('lead without coordinates uses pincode then round robin', () => {
  assert.equal(pickGarage({ pincode: '560001' }, [g('a'), g('b', { pincode: '560001' })], S), 'b');
  assert.equal(pickGarage({}, [g('a', { open_jobs: 2 }), g('b', { open_jobs: 0 })], S), 'b');
});
test('full garages are skipped', () => {
  assert.equal(pickGarage(lead, [g('near', { lat: 12.98, lng: 77.6, open_jobs: 3 }), g('other', { open_jobs: 2 })], S), 'other');
});
test('unavailable garages are skipped', () => {
  assert.equal(pickGarage(lead, [g('near', { lat: 12.98, lng: 77.6, available: false }), g('other')], S), 'other');
});
test('nothing qualifies returns null', () => {
  assert.equal(pickGarage(lead, [], S), null);
  assert.equal(pickGarage(lead, [g('a', { open_jobs: 3 }), g('b', { available: false })], S), null);
});
test('ties are deterministic whatever the input order', () => {
  const a = g('a'), b = g('b');
  assert.equal(pickGarage({}, [a, b], S), 'a');
  assert.equal(pickGarage({}, [b, a], S), 'a');
});
test('settings: default off, bad values fall back', () => {
  assert.deepEqual(normalizeAuto(undefined), { enabled: false, max_open_jobs: 3, radius_km: 15 });
  assert.equal(normalizeAuto({ enabled: 'true' }).enabled, false);
  assert.deepEqual(normalizeAuto({ enabled: true, max_open_jobs: 5, radius_km: 8 }), { enabled: true, max_open_jobs: 5, radius_km: 8 });
  assert.equal(normalizeAuto({ max_open_jobs: -2 }).max_open_jobs, 3);
});
