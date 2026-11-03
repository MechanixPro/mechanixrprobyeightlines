import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { techJobMessage, unstaffedSoon } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const lead = { ref: 'MXP-1042', name: '[Customer Name]', phone: '9000000000', bike: 'Honda Activa', service_name: 'General service', area: 'HSR Layout', address: '12, 5th Main', preferred_date: '2026-11-04', preferred_slot: 'morning', mechanic_name: 'Ravi Kumar', notes: 'Brake noise' };

test('the job message to the technician has what they need and no money figures', () => {
  const t = techJobMessage(lead);
  assert.match(t, /^Hi Ravi, new job MXP-1042/);
  for (const s of ['Customer: [Customer Name] (9000000000)', 'Bike: Honda Activa', 'Service: General service', 'Place: HSR Layout, 12, 5th Main', 'When: 4 Nov · Morning (9 AM – 12 PM)', 'Notes: Brake noise']) assert.ok(t.includes(s), s);
  assert.doesNotMatch(t, /₹|rs\.?\s?\d/i);
});
test('empty fields are left out of the job message', () => {
  const t = techJobMessage({ ref: 'MXP-1', name: 'A', phone: '9000000001' });
  assert.doesNotMatch(t, /Bike:|Service:|Place:|When:|Notes:/);
  assert.match(t, /^Hi, new job MXP-1/);
});
test('notes with ID numbers are not sent to the technician', () => {
  assert.doesNotMatch(techJobMessage({ ...lead, notes: 'Aadhaar 1234 5678 9012' }), /1234/);
});

// 3 Nov 2026, 07:30 IST = 02:00 UTC
const at = (hhmm) => new Date('2026-11-03T' + hhmm + ':00+05:30');
const job = (slot, date = '2026-11-03') => ({ id: slot + date, ref: 'R', name: 'N', preferred_date: date, preferred_slot: slot });
test('a booked job with no technician alerts from 2 hours before its slot', () => {
  const jobs = [job('morning'), job('afternoon'), job('evening'), job('asap')];
  assert.deepEqual(unstaffedSoon(jobs, at('06:59')).map((j) => j.preferred_slot), ['asap']);
  assert.deepEqual(unstaffedSoon(jobs, at('07:00')).map((j) => j.preferred_slot), ['morning', 'asap']);
  assert.deepEqual(unstaffedSoon(jobs, at('14:30')).map((j) => j.preferred_slot), ['morning', 'afternoon', 'evening', 'asap']);
});
test('tomorrow\'s jobs and jobs with no date do not alert yet', () => {
  assert.equal(unstaffedSoon([job('morning', '2026-11-04'), { id: 'x', preferred_date: null, preferred_slot: 'morning' }], at('22:00')).length, 0);
});
test('a job from an earlier day that still has no technician keeps alerting', () => {
  assert.equal(unstaffedSoon([job('evening', '2026-11-02')], at('08:00')).length, 1);
});

test('the database gives the desk the technician and the unstaffed jobs', () => {
  const m = read('supabase/migrations/20261218000000_desk_technician.sql');
  for (const s of ["'mechanic_name'", "'mechanic_phone'", 'crm_leads_list', 'mechanic_name text', "crm_page_ok('leads')", 'crm_unstaffed_jobs', "crm_can('assign_leads')", 'grant execute on function public.crm_unstaffed_jobs()']) assert.ok(m.includes(s), s);
});
test('the desk shows, sets and shares the technician, and alerts on unstaffed jobs', () => {
  const b = read('crm/pages/booking.js'), c = read('crm/crm.js'), l = read('crm/pages/leads.js');
  assert.match(b, /crm_mechanic_picker/); assert.match(b, /'Technician', 'mechanic_id'/); assert.match(b, /p\.mechanic_id =/);
  assert.match(c, /<span>Technician<\/span>/); assert.match(c, /techJobMessage\(l\)/); assert.match(c, /crm_unstaffed_jobs/); assert.match(c, /unstaffedSoon\(/);
  assert.match(l, /<th>Technician<\/th>/); assert.match(l, /id="tech"/);
});
