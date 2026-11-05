import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveCheck } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('move-lead migration adds the two sub-dispositions and both RPCs with their checks', () => {
  const m = read('supabase/migrations/20261220000000_desk_move_lead.sql');
  for (const s of ["('Interested','Technician assigned'", "('Interested','Booking confirmed'", 'function public.crm_assign_technician(p_id uuid, p_mechanic uuid', 'function public.crm_confirm_booking(p_id uuid, p_mechanic uuid, p_date date, p_slot text',
    "crm_require('edit_leads')", "onboarding_status in ('live','pilot')", "status in ('lost','completed')", "'already', true", "('morning','afternoon','evening','asap')", 'grant execute on function public.crm_confirm_booking',
    'this lead belongs to a colleague', 'crm_has_pii']) assert.ok(m.includes(s), s);
});

test('assigning needs a technician; confirming needs technician, date and slot, not in the past', () => {
  assert.deepEqual(moveCheck('assign', { mechanic_id: '' }, '2026-11-03'), { ok: false, error: 'Choose the technician.' });
  assert.equal(moveCheck('assign', { mechanic_id: 'm1' }, '2026-11-03').ok, true);
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '', slot: 'morning' }, '2026-11-03').error, 'Choose the date.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-03', slot: '' }, '2026-11-03').error, 'Choose a time slot.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-02', slot: 'evening' }, '2026-11-03').error, 'The date is in the past.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-03', slot: 'asap' }, '2026-11-03').ok, true);
  assert.equal(moveCheck('confirm', { mechanic_id: '', date: '2026-11-03', slot: 'asap' }, '2026-11-03').error, 'Choose the technician.');
});

test('the log form handles both moves inline: no button bar, no pop-up', () => {
  const c = read('crm/crm.js'), f = read('supabase/functions/confirm-booking/index.ts');
  for (const s of ['Move this lead to', '<option value="confirm">Schedule: technician, date, slot (after Confirm booking)</option>', 'id="techBox"', 'id="lfTech"', 'id="lfDate"', 'id="lfSlot"', "rpc('crm_assign_technician'", "rpc('crm_confirm_booking'", 'Send job to', "invoke('confirm-booking'"]) assert.ok(c.includes(s), s);
  for (const gone of ['data-act="move"', 'class="move-bar"', 'MOVE_SUBS', 'function moveAction']) assert.ok(!c.includes(gone), 'removed: ' + gone);
  assert.match(f, /crm_users/); assert.match(f, /status !== 'scheduled'|status === 'scheduled'/);
});

test('review fixes: the Technician lead can move unowned leads, desk emails resend on a real change and check permission', () => {
  const m = read('supabase/migrations/20261220000000_desk_move_lead.sql'), f = read('supabase/functions/confirm-booking/index.ts');
  assert.match(m, /l\.crm_owner is null and r <> 'supervisor' and not public\.crm_can\('manage_technicians'\)/);
  assert.match(f, /preferred_date[\s\S]{0,80}preferred_slot[\s\S]{0,80}mechanic_id/); assert.match(f, /details->>key/);
  assert.match(f, /crm_can[\s\S]{0,40}edit_leads/); assert.match(f, /deleted_at/);
});
