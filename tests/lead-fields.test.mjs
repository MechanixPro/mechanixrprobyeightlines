import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

test('empty body gives safe defaults', () => {
  assert.deepEqual(cleanLeadFields({}), { km_band: null, issues: [], note: null, place: 'home', contact_pref: 'whatsapp', bike_type: null, ref_code: null, campaign: null });
});
test('known values pass through', () => {
  const r = cleanLeadFields({ km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'asha', campaign: 'Monsoon-Check' });
  assert.deepEqual(r, { km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'ASHA', campaign: 'monsoon-check' });
});
test('unknown enum values are rejected to defaults', () => {
  const r = cleanLeadFields({ km_band: 'huge', place: 'moon', contact_pref: 'fax', bike_type: 'x' });
  assert.equal(r.km_band, null); assert.equal(r.place, 'home'); assert.equal(r.contact_pref, 'whatsapp'); assert.equal(r.bike_type, null);
});
test('issues are filtered to known ids, de-duplicated and capped', () => {
  assert.deepEqual(cleanLeadFields({ issues: ['brake', 'brake', 'nope', 7] }).issues, ['brake']);
  assert.equal(cleanLeadFields({ issues: 'brake' }).issues.length, 0);
});
test('note strips control characters and angle brackets and is capped at 300', () => {
  assert.equal(cleanLeadFields({ note: '<b>hi</b>\u0007 there' }).note, 'bhi/b there');
  assert.equal(cleanLeadFields({ note: 'x'.repeat(500) }).note.length, 300);
  assert.equal(cleanLeadFields({ note: '   ' }).note, null);
});
test('ref_code and campaign keep only safe characters and are capped', () => {
  assert.equal(cleanLeadFields({ ref_code: 'as ha!#1' }).ref_code, 'ASHA1');
  assert.equal(cleanLeadFields({ ref_code: 'a'.repeat(40) }).ref_code.length, 20);
  assert.equal(cleanLeadFields({ campaign: 'Ad Set #1' }).campaign, 'adset1');
  assert.equal(cleanLeadFields({ campaign: 'c'.repeat(100) }).campaign.length, 60);
});
