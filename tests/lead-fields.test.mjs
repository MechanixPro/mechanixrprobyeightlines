import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

test('empty body gives safe defaults', () => {
  assert.deepEqual(cleanLeadFields({}), { km_band: null, issues: [], note: null, place: 'home', contact_pref: 'whatsapp', bike_type: null, ref_code: null, campaign: null, address: null, lat: null, lng: null, email: null, email_marketing: false, request_type: 'quote', reg_no: null, reminder_opt_in: false, preferred_time: null });
});
test('known values pass through', () => {
  const r = cleanLeadFields({ km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'asha', campaign: 'Monsoon-Check' });
  assert.deepEqual(r, { km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'ASHA', campaign: 'monsoon-check', address: null, lat: null, lng: null, email: null, email_marketing: false, request_type: 'quote', reg_no: null, reminder_opt_in: false, preferred_time: null });
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

test('address is cleaned and capped at 200', () => {
  assert.equal(cleanLeadFields({ address: '  Flat <4B>, 27th Main ' }).address, 'Flat 4B, 27th Main');
  assert.equal(cleanLeadFields({ address: 'a'.repeat(300) }).address.length, 200);
  assert.equal(cleanLeadFields({ address: '  ' }).address, null);
});
test('lat and lng are kept only when both are valid numbers inside India', () => {
  const ok = cleanLeadFields({ lat: 12.9121, lng: 77.6446 });
  assert.equal(ok.lat, 12.9121); assert.equal(ok.lng, 77.6446);
  assert.equal(cleanLeadFields({ lat: '12.9121', lng: '77.6446' }).lat, 12.9121);
  for (const bad of [{ lat: 12.9 }, { lng: 77.6 }, { lat: 'x', lng: 77.6 }, { lat: 51.5, lng: -0.12 }, { lat: 0, lng: 0 }, { lat: Infinity, lng: 77 }]) {
    const r = cleanLeadFields(bad); assert.equal(r.lat, null, JSON.stringify(bad)); assert.equal(r.lng, null, JSON.stringify(bad));
  }
});
test('lat and lng are rounded to 5 decimals', () => assert.equal(cleanLeadFields({ lat: 12.912345678, lng: 77.644412345 }).lat, 12.91235));

test('email is trimmed, lowercased and kept only when it looks valid', () => {
  assert.equal(cleanLeadFields({ email: '  Asha.K@Gmail.COM ' }).email, 'asha.k@gmail.com');
  for (const bad of ['', 'asha', 'asha@', '@gmail.com', 'a b@c.in', 'a@b', 'a@b..in', 'x'.repeat(130) + '@a.in', null, 42]) assert.equal(cleanLeadFields({ email: bad }).email, null, String(bad));
});
test('email marketing consent counts only with an email and an explicit yes', () => {
  assert.equal(cleanLeadFields({ email: 'a@b.in', email_marketing: true }).email_marketing, true);
  assert.equal(cleanLeadFields({ email: 'a@b.in', email_marketing: 'yes' }).email_marketing, false);
  assert.equal(cleanLeadFields({ email_marketing: true }).email_marketing, false);
});

test('request type is quote unless it is exactly callback', () => {
  assert.equal(cleanLeadFields({ request_type: 'callback' }).request_type, 'callback');
  for (const v of ['CALLBACK', 'call', '', null, 7]) assert.equal(cleanLeadFields({ request_type: v }).request_type, 'quote', String(v));
});
test('registration numbers are tidied and bad ones dropped', () => {
  assert.equal(cleanLeadFields({ reg_no: ' ka 01 ab 1234 ' }).reg_no, 'KA01AB1234');
  for (const v of ['abc', '12345', 'KA01AB123456', '<b>', null]) assert.equal(cleanLeadFields({ reg_no: v }).reg_no, null, String(v));
});
test('pick up and drop is an accepted place, and the reminder choice must be an explicit yes', () => {
  assert.equal(cleanLeadFields({ place: 'pickup' }).place, 'pickup');
  assert.equal(cleanLeadFields({ reminder_opt_in: true }).reminder_opt_in, true);
  assert.equal(cleanLeadFields({ reminder_opt_in: 'true' }).reminder_opt_in, false);
});

test('the arrival window text is tidied and capped', () => {
  assert.equal(cleanLeadFields({ preferred_time: ' 10–11 AM ' }).preferred_time, '10–11 AM');
  assert.equal(cleanLeadFields({ preferred_time: '<b>9–10 AM</b>' }).preferred_time, 'b9–10 AM/b');
  assert.equal(cleanLeadFields({ preferred_time: 'x'.repeat(80) }).preferred_time.length, 30);
  assert.equal(cleanLeadFields({ preferred_time: '' }).preferred_time, null);
});
