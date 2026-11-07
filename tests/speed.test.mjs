import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firstReplyMinutes, median, speedStats, speedByPerson, longestWaiting, followUpQueue, followUpBucket, bucketCounts, snoozeAt, fmtMinutes, withoutMoney } from '../crm/speed.js';

const NOW = new Date('2027-01-10T08:00:00Z').getTime(); // 13:30 IST
const L = (o) => ({ status: 'new', created_at: '2027-01-10T06:00:00Z', ...o });

test('first reply minutes', () => {
  assert.equal(firstReplyMinutes(L({ crm_first_contact_at: '2027-01-10T06:12:00Z' })), 12);
  assert.equal(firstReplyMinutes(L({})), null);
  assert.equal(firstReplyMinutes(L({ crm_first_contact_at: 'junk' })), null);
  assert.equal(firstReplyMinutes(L({ crm_first_contact_at: '2027-01-10T05:00:00Z' })), 0);
  assert.equal(firstReplyMinutes(null), null);
});
test('median', () => { assert.equal(median([]), null); assert.equal(median([5]), 5); assert.equal(median([9, 1, 5]), 5); assert.equal(median([1, 2, 3, 10]), 2.5); assert.equal(median([NaN, 4]), 4); });
test('speed stats, junk ignored', () => {
  const s = speedStats([L({ crm_first_contact_at: '2027-01-10T06:05:00Z' }), L({ crm_first_contact_at: '2027-01-10T06:45:00Z' }), L({}), L({ status: 'junk', crm_first_contact_at: '2027-01-10T06:01:00Z' })]);
  assert.deepEqual([s.leads, s.replied, s.waiting, s.medianMin, s.pctWithin], [3, 2, 1, 25, 50]);
  assert.deepEqual(speedStats([]), { leads: 0, replied: 0, waiting: 0, medianMin: null, pctWithin: null, within: 0 });
  assert.equal(speedStats(null).leads, 0);
});
test('per person', () => {
  const p = speedByPerson([L({ crm_owner: 'a1', crm_first_contact_at: '2027-01-10T06:10:00Z' }), L({ crm_owner: 'a1' }), L({ crm_owner: 'b2', crm_first_contact_at: '2027-01-10T07:00:00Z' }), L({})], { a1: 'Asha' });
  assert.equal(p[0].name, 'Asha'); assert.equal(p[0].leads, 2); assert.equal(p[0].pctWithin, 100);
  assert.deepEqual(p.map((x) => x.name).sort(), ['Asha', 'Team member b2', 'Unassigned'].sort());
  assert.equal(p.find((x) => x.name === 'Team member b2').pctWithin, 0);
});
test('longest waiting', () => {
  const w = longestWaiting([L({ id: 'x', created_at: '2027-01-10T07:00:00Z' }), L({ id: 'y', created_at: '2027-01-10T01:00:00Z' }), L({ id: 'z', crm_first_contact_at: '2027-01-10T07:10:00Z' }), L({ id: 'q', status: 'contacted' })], NOW, 5);
  assert.deepEqual(w.map((x) => x.id), ['y', 'x']); assert.equal(w[0].waitMin, 420);
});
test('follow-up queue order: overdue, today, later, no date; value then age', () => {
  const q = followUpQueue([
    L({ id: 'later', crm_next_action_at: '2027-01-12T04:30:00Z', est_total: 9999 }),
    L({ id: 'today-lo', crm_next_action_at: '2027-01-10T12:00:00Z', est_total: 500 }),
    L({ id: 'today-hi', crm_next_action_at: '2027-01-10T11:00:00Z', est_total: 2000 }),
    L({ id: 'over-old', crm_next_action_at: '2027-01-09T05:00:00Z', est_total: 500, created_at: '2027-01-01T00:00:00Z' }),
    L({ id: 'over-new', crm_next_action_at: '2027-01-10T07:00:00Z', est_total: 500, created_at: '2027-01-05T00:00:00Z' }),
    L({ id: 'over-big', crm_next_action_at: '2027-01-10T07:30:00Z', est_total: 5000 }),
    L({ id: 'nodate' }), L({ id: 'lost', status: 'lost', crm_next_action_at: '2027-01-01T00:00:00Z' }),
  ], NOW);
  assert.deepEqual(q.map((x) => x.id), ['over-big', 'over-old', 'over-new', 'today-hi', 'today-lo', 'later', 'nodate']);
  assert.deepEqual(bucketCounts(q), { overdue: 3, today: 2, later: 1, nodate: 1 });
});
test('bucket boundaries use India day', () => {
  assert.equal(followUpBucket({ crm_next_action_at: '2027-01-10T18:29:00Z' }, NOW), 'today'); // 23:59 IST
  assert.equal(followUpBucket({ crm_next_action_at: '2027-01-10T18:31:00Z' }, NOW), 'later'); // 00:01 IST next day
  assert.equal(followUpBucket({}, NOW), 'nodate');
});
test('snooze is 10 AM IST', () => {
  assert.equal(snoozeAt(1, NOW), '2027-01-11T04:30:00.000Z');
  assert.equal(snoozeAt(3, NOW), '2027-01-13T04:30:00.000Z');
  assert.equal(snoozeAt(1, new Date('2027-01-10T20:00:00Z').getTime()), '2027-01-12T04:30:00.000Z'); // already 01:30 IST on the 11th
});
test('format and money', () => {
  assert.equal(fmtMinutes(null), 'n/a'); assert.equal(fmtMinutes(0), 'under 1 min'); assert.equal(fmtMinutes(12), '12 min'); assert.equal(fmtMinutes(120), '2 h');
  assert.equal('est_total' in withoutMoney([{ est_total: 5, value: 5, a: 1 }], false)[0], false);
  assert.equal(withoutMoney([{ est_total: 5 }], true)[0].est_total, 5);
});
test('admin copy matches after sync', () => { if (fs.existsSync('admin/speed.js')) assert.equal(fs.readFileSync('admin/speed.js', 'utf8'), fs.readFileSync('crm/speed.js', 'utf8')); });
