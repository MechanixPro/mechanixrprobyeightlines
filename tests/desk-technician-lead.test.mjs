import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the technician lead migration adds the permission, the preset, the designation and the PIN backfill', () => {
  const m = read('supabase/migrations/20261221000000_desk_technician_lead.sql');
  for (const s of ["'manage_technicians'", "p_designation = 'tech_lead'", "('sales','support','tech_lead')", "regexp_match(name, '(56[0-9]{4})')", 'crm_update_booking was not patched', 'crm_tech_board was not patched', 'crm_unstaffed_jobs was not patched']) assert.ok(m.includes(s), s);
  // every action that existed before is still in the list
  for (const a of ['view_all_leads', 'assign_leads', 'manage_mechanics', 'edit_knowledge', 'review_knowledge', 'close_chats']) assert.ok(m.includes("'" + a + "'"), a);
});
test('Crew uses one technician check, and the Team page offers the role and the permission', () => {
  const c = read('crm/crm.js'), b = read('crm/pages/booking.js'), t = read('crm/pages/team.js');
  assert.match(c, /const canTech = \(\) => can\('assign_leads'\) \|\| can\('manage_technicians'\)/);
  assert.match(c, /view === 'mine' && canTech\(\)/);
  assert.match(b, /ctx\.can\('manage_technicians'\)/);
  assert.match(t, /\['tech_lead', 'Technician lead'\]/); assert.match(t, /manage_technicians: '/);
});
