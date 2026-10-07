import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeFor, buildReport, reportCsv } from '../admin/report.js';

const NOW = new Date('2026-10-10T10:00:00+05:30');
const services = [{ id: 'general', name: 'General service' }, { id: 'full', name: 'Full service' }];
const mechanics = [{ id: 'm1', name: 'Kiran' }];
const L = (o) => ({ ref: 'MP-1', created_at: '2026-10-08T10:00:00+05:30', service_id: 'general', area: 'HSR Layout', status: 'completed', est_total: 1299, paid_amount: 1299, coupon_discount: 0, coupon_code: null, mechanic_id: 'm1', utm: {}, campaign: null, ...o });
const leads = [
  L({ ref: 'MP-1' }),
  L({ ref: 'MP-2', service_id: 'full', area: 'Koramangala', est_total: 1999, paid_amount: 1799, coupon_code: 'A', coupon_discount: 200, utm: { utm_source: 'google' }, campaign: 'monsoon', status: 'paid' }),
  L({ ref: 'MP-3', status: 'new', paid_amount: null, mechanic_id: null, area: null, created_at: '2026-10-09T10:00:00+05:30' }),
  L({ ref: 'MP-4', status: 'lost', paid_amount: null, mechanic_id: null, created_at: '2026-08-01T10:00:00+05:30' })
];

test('rangeFor gives the start of each period, in Indian time', () => {
  assert.equal(rangeFor('7d', NOW).from.toISOString(), new Date(NOW.getTime() - 7 * 864e5).toISOString());
  assert.equal(rangeFor('30d', NOW).from.toISOString(), new Date(NOW.getTime() - 30 * 864e5).toISOString());
  assert.equal(rangeFor('month', NOW).from.toISOString(), new Date('2026-10-01T00:00:00+05:30').toISOString());
  assert.equal(rangeFor('all', NOW).from, null);
  assert.equal(rangeFor('nonsense', NOW).from.toISOString(), new Date(NOW.getTime() - 30 * 864e5).toISOString());
});
test('the report counts only bookings inside the range', () => {
  const r = buildReport(leads, { services, mechanics }, rangeFor('30d', NOW));
  assert.equal(r.totals.bookings, 3);
  assert.equal(buildReport(leads, { services, mechanics }, rangeFor('all', NOW)).totals.bookings, 4);
});
test('totals: went ahead, conversion, collected, discount given and average paid order', () => {
  const t = buildReport(leads, { services, mechanics }, rangeFor('30d', NOW)).totals;
  assert.equal(t.wentAhead, 2); assert.equal(t.conversion, 67); assert.equal(t.collected, 3098); assert.equal(t.discount, 200); assert.equal(t.avgOrder, 1549);
});
test('an empty range gives zeros, not errors', () => {
  const t = buildReport([], { services, mechanics }, rangeFor('7d', NOW)).totals;
  assert.deepEqual(t, { bookings: 0, wentAhead: 0, conversion: 0, collected: 0, discount: 0, avgOrder: 0 });
});
test('breakdowns name things in plain words and sort by money collected', () => {
  const r = buildReport(leads, { services, mechanics }, rangeFor('30d', NOW));
  assert.deepEqual(r.byService, [{ name: 'General service', count: 2, collected: 1299 }, { name: 'Full service', count: 1, collected: 1799 }].sort((a, b) => b.collected - a.collected));
  assert.deepEqual(r.byArea.map((x) => x.name), ['Koramangala', 'HSR Layout', 'Not given']);
  assert.deepEqual(r.byMechanic.map((x) => [x.name, x.count, x.collected]), [['Kiran', 2, 3098], ['Unassigned', 1, 0]]);
  assert.deepEqual(r.bySource.map((x) => x.name), ['google', 'direct']);
});
test('reportCsv has a header, one row per booking, no names or phone numbers, and quotes safely', () => {
  const csv = reportCsv([L({ ref: 'MP-9', area: 'HSR, Layout', campaign: 'say "hi"' })], { services, mechanics });
  const [head, row] = csv.split('\n');
  assert.equal(head, 'Ref,Date,Service,Area,Mechanic,Status,Estimate,Paid,Discount,Coupon,Source,Campaign');
  assert.match(row, /^MP-9,2026-10-08,General service,"HSR, Layout",Kiran,completed,1299,1299,0,,direct,"say ""hi"""$/);
  assert.doesNotMatch(csv, /phone|name/i);
});
