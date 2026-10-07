import test from 'node:test';
import assert from 'node:assert/strict';
import { leadDetailRows, sourceReport } from '../admin/lead-view.js';

test('shows only the details that were given, in a fixed order', () => {
  const rows = leadDetailRows({ bike_type: 's', km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', ref_code: 'ASHA', campaign: 'monsoon' });
  assert.deepEqual(rows, [
    ['Bike type', 'Scooter'], ['Last service', '3,000–6,000 km'], ['Problems', 'Brakes weak or noisy, Chain noise or loose chain'],
    ['Note', 'rattle'], ['Where', 'Stuck on the road'], ['Contact by', 'Phone call'], ['Referred by', 'ASHA'], ['Campaign', 'monsoon']
  ]);
});
test('an old lead with none of the new fields gives no rows except the default place', () => {
  assert.deepEqual(leadDetailRows({}), []);
  assert.deepEqual(leadDetailRows({ place: 'home', contact_pref: 'whatsapp', issues: [] }), [['Where', 'Home or office'], ['Contact by', 'WhatsApp chat']]);
});
test('unknown problem ids are shown as they are, not dropped', () => {
  assert.equal(leadDetailRows({ issues: ['mystery'] })[0][1], 'mystery');
});
test('sourceReport counts leads by source, campaign and referrer', () => {
  const r = sourceReport([
    { utm: { utm_source: 'google' }, campaign: 'monsoon', ref_code: 'ASHA' },
    { utm: { utm_source: 'google' }, campaign: 'monsoon', ref_code: null },
    { utm: {}, campaign: null, ref_code: 'ASHA' },
    { utm: { utm_source: 'instagram' } }
  ]);
  assert.deepEqual(r.source, [['google', 2], ['direct', 1], ['instagram', 1]]);
  assert.deepEqual(r.campaign, [['monsoon', 2]]);
  assert.deepEqual(r.referrer, [['ASHA', 2]]);
});
test('sourceReport on no leads gives empty lists', () => {
  assert.deepEqual(sourceReport([]), { source: [], campaign: [], referrer: [] });
});
