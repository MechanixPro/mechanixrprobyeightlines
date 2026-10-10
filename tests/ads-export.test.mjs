import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adsConversions } from '../admin/ads-export.js';

const now = new Date('2026-10-30T10:00:00Z');
const GC = 'CjwKCAjwoaLWBhAWEiwAnyitu0CHZao7SVLabc123456';
const L = (o) => ({ ref: 'MP-1', status: 'completed', created_at: '2026-10-12T06:00:00Z', completed_at: '2026-10-14T09:30:00Z', est_total: 1299, paid_amount: 1500, utm: { gclid: GC, utm_source: 'google' }, ...o });

test('a completed job from a Google click becomes one upload row, in India time, with the money collected', () => {
  const r = adsConversions([L()], { now });
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0], { gclid: GC, name: 'Completed job', time: '2026-10-14 15:00:00', value: 1500, currency: 'INR', ref: 'MP-1' });
});
test('the file starts with the time zone line and the exact Google column names', () => {
  const csv = adsConversions([L()], { now }).csv.split('\n');
  assert.equal(csv[0], 'Parameters:TimeZone=Asia/Kolkata');
  assert.equal(csv[1], 'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency');
  assert.equal(csv[2], GC + ',Completed job,2026-10-14 15:00:00,1500,INR');
});
test('the value falls back to the estimate, then to 1, and a custom conversion name is used', () => {
  assert.equal(adsConversions([L({ paid_amount: 0 })], { now }).rows[0].value, 1299);
  assert.equal(adsConversions([L({ paid_amount: 0, est_total: null })], { now }).rows[0].value, 1);
  assert.equal(adsConversions([L()], { now, name: 'Paid job' }).rows[0].name, 'Paid job');
});
test('only completed jobs that have a Google click ID are included, and each click ID once', () => {
  const r = adsConversions([L({ ref: 'A' }), L({ ref: 'B', status: 'scheduled' }), L({ ref: 'C', utm: {} }), L({ ref: 'D', utm: { gclid: 'short' } }), L({ ref: 'E' })], { now });
  assert.deepEqual(r.rows.map((x) => x.ref), ['A']);
  assert.equal(r.skipped.notCompleted, 1); assert.equal(r.skipped.noClick, 2); assert.equal(r.skipped.duplicate, 1);
});
test('clicks older than 90 days are left out because Google no longer accepts them', () => {
  const r = adsConversions([L({ created_at: '2026-06-01T00:00:00Z', completed_at: '2026-06-03T00:00:00Z' })], { now });
  assert.equal(r.rows.length, 0); assert.equal(r.skipped.tooOld, 1);
});
test('test clicks from our own checks never go to Google', () => {
  assert.equal(adsConversions([L({ utm: { gclid: 'TEST_GCLID_123' } })], { now }).rows.length, 0);
});
test('the admin Reports tab has the download button and the guide explains the Google setup', () => {
  const a = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(a, /data-act="adsExport"/); assert.match(a, /adsConversions/);
  const d = readFileSync(new URL('../docs/GOOGLE-ADS-OFFLINE.md', import.meta.url), 'utf8');
  assert.match(d, /Completed job/); assert.match(d, /Import/); assert.match(d, /90 days/);
});
