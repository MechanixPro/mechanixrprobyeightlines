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
  const csv = reportCsv([L({ ref: 'L-9', booking_id: 'MP-9', area: 'HSR, Layout', campaign: 'say "hi"' })], { services, mechanics });
  const [head, row] = csv.split('\n');
  assert.equal(head, 'Booking ID,Date,Service,Area,Mechanic,Status,Estimate,Paid,Discount,Coupon,Source,Campaign');
  assert.match(row, /^MP-9,2026-10-08,General service,"HSR, Layout",Kiran,completed,1299,1299,0,,direct,"say ""hi"""$/);
  assert.doesNotMatch(csv, /phone|name/i);
});

// Regression: Admin > Money > Reports crashed with "Cannot read properties of null (reading 'rate')" for a completed job with a mechanic but no invoice_override (null).
test('payoutReport renders when invoice_override is null, missing or has no rate', async () => {
  const { payoutReport, invoiceGstRate } = await import('../admin/report.js');
  const mechs = [{ id: 'm1', name: '[Mechanic Name]', payout_rate: 50 }];
  for (const io of [null, undefined, {}, { rate: null }, { rate: '' }]) {
    const r = payoutReport([{ status: 'completed', mechanic_id: 'm1', paid_amount: 118, invoice_override: io }], mechs, 'before_gst');
    assert.equal(r.rows.length, 1); assert.equal(r.rows[0].jobs, 1); assert.equal(invoiceGstRate({ invoice_override: io }), 18);
  }
  assert.equal(invoiceGstRate({ invoice_override: { rate: 0 } }), 0);
  assert.equal(invoiceGstRate({ invoice_override: { rate: 12 } }), 12);
  assert.equal(invoiceGstRate(null), 18);
  assert.deepEqual(payoutReport(null, null).rows, []);
  assert.deepEqual(payoutReport([null, { status: 'completed', mechanic_id: 'm1', paid_amount: 100 }], [null, ...mechs]).rows.length, 1);
});
test('payoutReport sorts when a mechanic has no name', async () => {
  const { payoutReport } = await import('../admin/report.js');
  const mechs = [{ id: 'm1', name: null }, { id: 'm2', name: '' }, { id: 'm3', name: 'Asha' }];
  const leads = ['m1', 'm2', 'm3'].map((m) => ({ status: 'completed', mechanic_id: m, paid_amount: 118, invoice_override: null }));
  assert.doesNotThrow(() => payoutReport(leads, mechs, 'collected'));
});
