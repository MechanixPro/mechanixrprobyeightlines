import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPartner } from '../supabase/functions/_shared/partner.ts';
const good = { kind: 'garage', name: ' Sri <b>Motors</b> ', owner_name: 'Ravi K', mobile: '+91 98765 43210', address: 'Jayanagar 4th Block', pincode: '560011', categories: ['bike', 'car', 'bike', 'ghost'], bays: '4', note: 'Open since 2015', consent: true };

test('a good garage application is cleaned and kept', () => {
  const r = cleanPartner(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { kind: 'garage', name: 'Sri Motors', owner_name: 'Ravi K', mobile: '9876543210', address: 'Jayanagar 4th Block', pincode: '560011', categories: ['bike', 'car'], bays: 4, note: 'Open since 2015' });
});
test('an independent mechanic needs no garage name and has no bays', () => {
  const r = cleanPartner({ ...good, kind: 'mechanic', name: '', bays: 9 });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Ravi K');
  assert.equal(r.value.bays, null);
});
test('kind, name, number, area, vehicle type and consent are required', () => {
  for (const bad of [{ kind: 'shop' }, { owner_name: '' }, { name: '', kind: 'garage' }, { mobile: '1234567890' }, { address: '' }, { categories: [] }, { consent: false }, { pincode: '12' }])
    assert.equal(cleanPartner({ ...good, ...bad }).ok, false, JSON.stringify(bad));
});
