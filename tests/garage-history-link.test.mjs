// Admin > Garages > History: every booking ID opens the full booking sheet, for active, completed and cancelled jobs, with a way back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const v = read('admin/garages-view.js'), a = read('admin/admin.js');

test('each job row in the history is a button that carries the booking ID (and the lead id when the database sends it)', () => {
  assert.match(v, /data-booking="\$\{esc\(j\.ref\)\}" data-lead="\$\{esc\(j\.lead_id \|\| ''\)\}"/);
  assert.match(v, /aria-label="Open booking/);
  assert.match(v, /jobRows\(h\.garage_jobs\)/); assert.match(v, /jobRows\(h\.mechanic_jobs\)/);   // garage jobs and earlier mechanic jobs, whatever the status
  assert.doesNotMatch(v.slice(v.indexOf('const jobRows'), v.indexOf('async function history')), /status === 'cancelled'|status !== /, 'no status filter: cancelled and completed jobs open too');
});
test('clicking closes the dialog and opens the booking, with a back action that reopens the same garage history', () => {
  assert.match(v, /dlg\.close\(\);/); assert.match(v, /openBooking\(\{ ref: b\.dataset\.booking, leadId: b\.dataset\.lead \|\| null, back: \(\) => history\(id\) \}\)/);
});
test('Admin finds the booking by lead id or by the original booking ID, even when it is not in the loaded 500, then shows the full sheet', () => {
  assert.match(a, /async function openBookingFromHistory\(\{ ref, leadId, back \}\)/);
  assert.match(a, /booking_id\.eq\.\$\{ref\},ref\.eq\.\$\{ref\}/); assert.match(a, /await openLead\(l\.id\)/);
  assert.match(a, /openBooking: openBookingFromHistory/);
  assert.match(a, /Back to garage history/); assert.match(a, /const back = S\.backTo; S\.backTo = null; if \(back\)/);
});
test('the history sheet shows the same full booking: customer, vehicle, payment, estimates, history all come from openLead', () => {
  assert.match(a, /async function openLead\(id, silent\) \{ await openLeadBase\(id, silent\); await paintFlow\(id\)/);
});
