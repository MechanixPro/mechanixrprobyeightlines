import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESK_TEMPLATES, placeholders } from '../supabase/functions/_shared/desk-templates.ts';
import { alertKind, alreadyAlerted, mayAlertNow, mechanicPhone, alertParams, slotIsCurrent, JOB_ALERT_TEMPLATE } from '../supabase/functions/_shared/job-alert.ts';

const t = DESK_TEMPLATES.find((x) => x.name === JOB_ALERT_TEMPLATE);
const auto = readFileSync(new URL('../supabase/functions/desk-automation/index.ts', import.meta.url), 'utf8');
const at = (hhmm, date = '2026-11-10') => new Date(date + 'T' + hhmm + ':00+05:30');

test('mxp_job_assigned is a UTILITY template listed with six variables and no phone or street address', () => {
  assert.ok(t); assert.equal(t.category, 'UTILITY'); assert.equal(t.campaign, 'mxp_job_assigned'); assert.equal(t.params, 6);
  const p = placeholders(t.text); assert.equal(p.count, 6); assert.equal(p.sequential, true);
  assert.doesNotMatch(t.text + t.sample, /phone|mobile|address|street/i);
  assert.doesNotMatch(t.text, /\b(free|guarantee|best|100%)\b/i);
});
test('the parameters are first name, booking ID, vehicle and service, area and PIN, slot, link', () => {
  const p = alertParams({ mechanicName: 'Ravi Kumar', bookingId: 'MX-1042', vehicle: 'Honda Activa', service: 'General service', area: 'HSR Layout', pincode: '560102', when: 'Tuesday, 10 Nov', link: 'https://mechanixpro.in/job/?t=abc' });
  assert.equal(p.length, 6); assert.deepEqual(p.slice(0, 5), ['Ravi', 'MX-1042', 'Honda Activa, General service', 'HSR Layout 560102', 'Tuesday, 10 Nov']); assert.match(p[5], /\/job\/\?t=/);
});
test('the step is guarded by the ready map and the switch, and skips silently when the campaign is not ready', () => {
  assert.match(auto, /\/\* 9\. mechanic assigned/);
  assert.match(auto, /!ready\[jt\.campaign\] \|\| !env\('AISENSY_API_KEY'\)\) \{ result\.mechanic_alert = 'skipped'/);
  assert.match(auto, /desk_auto_mechanic_alert/);
  assert.match(auto, /\.eq\('status', 'scheduled'\)\.not\('mechanic_id', 'is', null\)\.gte\('preferred_date', today\)/);
});
test('one alert per (lead, mechanic): a reassignment alerts the new mechanic only', () => {
  const sent = [{ lead_id: 'L1', kind: alertKind('M1') }];
  assert.equal(alreadyAlerted(sent, 'L1', 'M1'), true);
  assert.equal(alreadyAlerted(sent, 'L1', 'M2'), false);
  assert.equal(alreadyAlerted(sent, 'L2', 'M1'), false);
  assert.match(auto, /kind: alertKind\(l\.mechanic_id\)/);
});
test('no message when the mechanic has no usable phone, and it is not marked sent', () => {
  assert.equal(mechanicPhone(null), null); assert.equal(mechanicPhone('12345'), null); assert.equal(mechanicPhone('+91 98765 43210'), '9876543210');
  assert.match(auto, /if \(!m \|\| !phone\) continue;/);
});
test('quiet hours 21 to 9 IST, but a job within 2 hours is sent anyway; past dates are not current', () => {
  assert.equal(mayAlertNow('2026-11-10', 'afternoon', at('14:00')), true);
  assert.equal(mayAlertNow('2026-11-11', 'morning', at('22:00', '2026-11-10')), false);
  assert.equal(mayAlertNow('2026-11-10', 'morning', at('07:30')), true);
  assert.equal(mayAlertNow('2026-11-10', 'afternoon', at('07:30')), false);
  assert.equal(slotIsCurrent('2026-11-10', at('10:00')), true); assert.equal(slotIsCurrent('2026-11-09', at('10:00')), false);
});
