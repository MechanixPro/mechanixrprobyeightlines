import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firstReplyMinutes, median, speedStats, speedByPerson, longestWaiting, followUpQueue, followUpBucket, bucketCounts, snoozeAt, fmtMinutes, withoutMoney, isMissedCall, missedCallQueue, quotesWaiting } from '../crm/speed.js';

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
  assert.equal(fmtMinutes(null), 'n/a'); assert.equal(fmtMinutes(0), '<1 min'); assert.equal(fmtMinutes(12), '12 min'); assert.equal(fmtMinutes(120), '2 h');
  assert.equal('est_total' in withoutMoney([{ est_total: 5, value: 5, a: 1 }], false)[0], false);
  assert.equal(withoutMoney([{ est_total: 5 }], true)[0].est_total, 5);
});
test('admin copy matches after sync', () => { if (fs.existsSync('admin/speed.js')) assert.equal(fs.readFileSync('admin/speed.js', 'utf8'), fs.readFileSync('crm/speed.js', 'utf8')); });

import { speedPanelHtml, inPeriod } from '../admin/speed-panel.js';
test('panel html: table per person, no money, escapes names, empty state', () => {
  const leads = [L({ crm_owner: 'a1', est_total: 7777, crm_first_contact_at: '2027-01-10T06:05:00Z' }), L({ crm_owner: 'a1', id: 'w' })];
  const h = speedPanelHtml(leads, { names: { a1: '<b>Asha</b>' }, days: 30, now: NOW });
  assert.match(h, /&lt;b&gt;Asha/); assert.ok(!h.includes('7777') && !h.includes('₹')); assert.match(h, /Within 15 min/); assert.match(h, /Longest waiting/);
  assert.match(speedPanelHtml([], { now: NOW }), /No leads in this period/);
  assert.equal(inPeriod([L({ created_at: '2026-01-01T00:00:00Z' }), L({})], 7, NOW).length, 1);
  assert.equal(inPeriod(null, 7, NOW).length, 0);
});
test('admin and crew wiring', () => {
  assert.match(fs.readFileSync('crm/crm.js', 'utf8'), /id: 'followups'/);
  const a = fs.readFileSync('admin/admin.js', 'utf8'); assert.match(a, /id="spRoot"/); assert.match(a, /speedPanel\.mount/);
  assert.ok(!/est_total|rupee/.test(fs.readFileSync('admin/speed-panel.js', 'utf8')));
});

test('missed calls: only open, uncontacted IVR missed-call leads, oldest first', () => {
  const now = Date.parse('2026-11-08T10:00:00Z'), ago = (m) => new Date(now - m * 60000).toISOString();
  const mk = (id, o = {}) => ({ id, page: 'ivr', source: 'phone', notes: 'Missed call to the IVR number.', status: 'new', crm_first_contact_at: null, created_at: ago(10), ...o });
  assert.equal(isMissedCall(mk('a')), true);
  assert.equal(isMissedCall(mk('b', { page: 'home', source: 'website' })), false);
  assert.equal(isMissedCall(mk('c', { notes: 'Answered call' })), false);
  assert.equal(isMissedCall(mk('d', { crm_first_contact_at: ago(1) })), false);
  assert.equal(isMissedCall(mk('e', { status: 'lost' })), false);
  assert.equal(isMissedCall(mk('f', { page: undefined })), true, 'queue rows without page fall back to source phone');
  assert.equal(isMissedCall(mk('g', { page: undefined, source: 'website' })), false);
  assert.equal(isMissedCall(null), false);
  const q = missedCallQueue([mk('new', { created_at: ago(5) }), mk('old', { created_at: ago(130) }), mk('x', { status: 'won' }), mk('mid', { created_at: ago(61) })], now);
  assert.deepEqual(q.map((l) => l.id), ['old', 'mid', 'new']);
  assert.deepEqual(q.map((l) => l.minutesWaiting), [130, 61, 5]);
  assert.deepEqual(missedCallQueue(null, now), []);
});

test('quotes waiting: 2 hour threshold, expired and decided excluded, oldest first, money for admin only', () => {
  const h = (n) => new Date(NOW - n * 3600e3).toISOString();
  const q = [
    { id: 'a', sent_at: h(1.9), total: 100 }, { id: 'b', sent_at: h(2), total: 200 }, { id: 'c', sent_at: h(30), total: 300 },
    { id: 'd', sent_at: h(5), total: 400, valid_until: h(1) }, { id: 'e', sent_at: h(5), status: 'approved' }, { id: 'f', sent_at: h(6), decided_at: h(3) },
    { id: 'g', sent_at: h(9), valid_until: new Date(NOW + 3600e3).toISOString(), total: 700 }, { id: 'h' }, null, { id: 'i', sent_at: 'junk' },
  ];
  const admin = quotesWaiting(q, NOW, true);
  assert.deepEqual(admin.map((x) => x.id), ['c', 'g', 'b']);
  assert.equal(admin[0].stale, true); assert.equal(admin[1].stale, false); assert.equal(admin[2].minutesWaiting, 120);
  assert.equal(admin[0].total, 300);
  for (const x of quotesWaiting(q, NOW, false)) assert.equal('total' in x, false);
  assert.deepEqual(quotesWaiting(null, NOW), []);
});
