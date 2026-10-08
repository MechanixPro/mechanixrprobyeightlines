import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLookup, stageFor, trackView, STAGES } from '../supabase/functions/_shared/track.ts';

test('cleanLookup accepts a reference in any case and a phone with spaces or +91', () => {
  assert.deepEqual(cleanLookup({ ref: ' mp-0cebac ', phone: '+91 98765 43210' }), { ok: true, ref: 'MP-0CEBAC', phone: '9876543210' });
});
test('cleanLookup rejects a malformed reference or number', () => {
  assert.equal(cleanLookup({ ref: 'hello', phone: '9876543210' }).ok, false);
  assert.equal(cleanLookup({ ref: 'MP-0CEBAC', phone: '123' }).ok, false);
  assert.equal(cleanLookup({}).ok, false);
});
test('every status maps to a stage and the stages run in order', () => {
  assert.equal(STAGES.length, 5);
  const idx = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed'].map((s) => stageFor(s).index);
  assert.deepEqual(idx, [0, 0, 1, 1, 2, 3, 4]);
  assert.equal(stageFor('lost').closed, true);
  assert.equal(stageFor('weird').index, 0);
});
test('trackView shows progress only, no phone, address or notes', () => {
  const v = trackView({ ref: 'MP-0CEBAC', status: 'scheduled', phone: '9876543210', address: 'Flat 4B', notes: 'secret', area: 'HSR Layout', preferred_date: '2026-10-10', preferred_slot: 'morning', preferred_time: null, est_total: 1299, paid_amount: 349 },
    { service: 'General service', bike: 'Honda Activa 6G', nick: 'Raja', mechanic: 'Ravi Kumar', certified: true });
  assert.equal(v.ref, 'MP-0CEBAC'); assert.equal(v.stage, 3); assert.equal(v.service, 'General service');
  assert.equal(v.bike, '"Raja" (Honda Activa 6G)'); assert.equal(v.mechanic, 'Ravi'); assert.match(v.when, /Morning/);
  const text = JSON.stringify(v);
  for (const bad of ['9876543210', 'Flat 4B', 'secret', 'Kumar']) assert.equal(text.includes(bad), false, bad);
});
test('trackView hides the mechanic until the job is scheduled', () => {
  const v = trackView({ ref: 'MP-1', status: 'quoted', preferred_date: null, preferred_slot: null }, { service: 'Basic service', bike: '', mechanic: 'Ravi Kumar' });
  assert.equal(v.mechanic, null); assert.equal(v.when, null);
});
