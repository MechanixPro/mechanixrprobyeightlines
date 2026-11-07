import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { progressPct, barPct, dayFraction, weekFraction, expectedNow, statusOf, metricRows, overallStatus, teamRows, myRows, parseTargetForm, statusTone } from '../crm/targets.js';

test('progress percent and bar width', () => {
  assert.equal(progressPct(5, 10), 50); assert.equal(progressPct(12, 10), 120); assert.equal(progressPct(1, 0), null); assert.equal(progressPct(null, null), null);
  assert.equal(barPct(12, 10), 100); assert.equal(barPct(1, 0), 0); assert.equal(barPct('x', 10), 0);
});
test('day fraction runs 9 AM to 7 PM India time', () => {
  assert.equal(dayFraction('2027-01-11T08:00:00'), 0); assert.equal(dayFraction('2027-01-11T14:00:00'), 0.5); assert.equal(dayFraction('2027-01-11T23:00:00'), 1);
  assert.equal(dayFraction('garbage'), 0); assert.equal(dayFraction(null), 0);
});
test('week fraction: Monday start, Saturday end, Sunday is the end', () => {
  assert.equal(weekFraction('2027-01-11T09:00:00'), 0);   // Monday
  assert.equal(weekFraction('2027-01-13T19:00:00'), 0.5); // Wednesday evening
  assert.equal(weekFraction('2027-01-16T19:00:00'), 1);   // Saturday evening
  assert.equal(weekFraction('2027-01-17T10:00:00'), 1);   // Sunday
});
test('status: Done, On track, Behind, No target', () => {
  assert.equal(statusOf(10, 10, 0.2), 'Done'); assert.equal(statusOf(0, 10, 0), 'On track');
  assert.equal(statusOf(3, 10, 0.5), 'Behind'); assert.equal(statusOf(4, 10, 0.5), 'On track');
  assert.equal(statusOf(5, 10, 0.5), 'On track'); assert.equal(statusOf(4, 10, 0.4), 'On track');
  assert.equal(statusOf(3, 0, 1), 'No target'); assert.equal(statusOf(3, null, 1), 'No target');
  assert.equal(expectedNow(10, 0.5), 5); assert.equal(expectedNow(10, 5), 10); assert.equal(statusTone('Behind'), 'bad');
});
test('rows and overall status', () => {
  const rows = metricRows({ target: { calls: 20, quotes_sent: 5, paid_bookings: 0 }, actual: { calls: 20, quotes_sent: 0, paid_bookings: 3 } }, 0.5);
  assert.deepEqual(rows.map((r) => r.status), ['Done', 'Behind', 'No target']); assert.equal(rows[2].target, 0);
  assert.equal(overallStatus(rows), 'Behind');
  assert.equal(overallStatus(metricRows({ target: { calls: 2, quotes_sent: 0, paid_bookings: 0 }, actual: { calls: 2 } }, 1)), 'Done');
  assert.equal(overallStatus(metricRows(null, 1)), 'No target'); assert.equal(overallStatus(null), 'No target');
});
test('team rows survive junk and sort by name', () => {
  const p = { now_ist: '2027-01-11T14:00:00', people: [null, { user_id: 'b', name: 'Zed', day: null }, { user_id: 'a', name: 'Asha', day: { target: { calls: 10, quotes_sent: 0, paid_bookings: 0 }, actual: { calls: 2 } } }] };
  const t = teamRows(p); assert.deepEqual(t.map((x) => x.name), ['Asha', 'Zed']); assert.equal(t[0].status, 'Behind'); assert.equal(t[1].status, 'No target');
  assert.deepEqual(teamRows(null), []); assert.equal(myRows(p, 'a').name, 'Asha'); assert.equal(myRows(p, 'nope'), null);
  assert.equal(teamRows(p, 'week')[0].rows[0].target, null);
});
test('target form validation', () => {
  assert.deepEqual(parseTargetForm({ calls: '20', quotes_sent: '5', paid_bookings: '0' }), { ok: true, values: { calls: 20, quotes_sent: 5, paid_bookings: 0 } });
  assert.equal(parseTargetForm({ calls: '', quotes_sent: '1', paid_bookings: '1' }).ok, false);
  assert.equal(parseTargetForm({ calls: '1.5', quotes_sent: '1', paid_bookings: '1' }).ok, false);
  assert.equal(parseTargetForm({ calls: '-1', quotes_sent: '1', paid_bookings: '1' }).ok, false);
  assert.equal(parseTargetForm({ calls: '1001', quotes_sent: '1', paid_bookings: '1' }).ok, false);
});
test('admin copy matches after sync', () => { if (fs.existsSync('admin/targets.js')) assert.equal(fs.readFileSync('admin/targets.js', 'utf8'), fs.readFileSync('crm/targets.js', 'utf8')); });
test('migration: no money columns returned, owner-only set', () => {
  const sql = fs.readFileSync('supabase/migrations/20270107000000_sales_targets.sql', 'utf8');
  const prog = sql.slice(sql.indexOf('function public.crm_targets_progress'));
  assert.ok(!/est_total|paid_amount|\btotal\b|subtotal|balance|fee_credit|confirm_fee/.test(prog));
  assert.ok(/crm_targets_set[\s\S]*?is_owner\(\)/.test(sql));
});

import { targetsPanelHtml } from '../admin/targets-panel.js';
import { myTargetsHtml, barsHtml } from '../crm/targets-view.js';
import { myRows as mr } from '../crm/targets.js';
const P = { now_ist: '2027-01-12T15:00:00', people: [{ user_id: 'a', name: '<b>Asha</b>', day: { target: { calls: 10, quotes_sent: 2, paid_bookings: 1 }, actual: { calls: 1, quotes_sent: 0, paid_bookings: 1 } }, week: null }] };
test('panel: escapes names, owner gets the form, supervisor does not, empty state', () => {
  const owner = targetsPanelHtml(P, { canSet: true }), sup = targetsPanelHtml(P, { canSet: false });
  assert.ok(!owner.includes('<b>Asha</b>') && owner.includes('&lt;b&gt;Asha')); assert.ok(owner.includes('id="tgForm"') && owner.includes('Behind'));
  assert.ok(!sup.includes('tgForm') && !sup.includes('data-tg-set') && !/₹|rupee/i.test(sup));
  assert.ok(targetsPanelHtml({ people: [] }, {}).includes('No team members yet'));
});
test('crew card: no target message, bars carry progressbar roles', () => {
  const none = myTargetsHtml({ day: mr({ people: [{ user_id: 'z', name: 'Z' }] }, 'z', 'day'), week: mr({ people: [{ user_id: 'z', name: 'Z' }] }, 'z', 'week') });
  assert.ok(none.includes('No targets set for you yet')); assert.equal(myTargetsHtml(null), '');
  const h = barsHtml(mr(P, 'a', 'day').rows); assert.ok(h.includes('role="progressbar"') && h.includes('1 of 10'));
});
