import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20270143000000_cancellations.sql');

test('policy rules are in the database: 2 hours, mechanic left, SOS, and our own cancellations', () => {
  assert.match(sql, /hrs > 2/); assert.match(sql, /visit_stage is not null/); assert.match(sql, /sos|roadside/i); assert.match(sql, /p_kind in \('company', 'unreachable'\)/);
});
test('Crew can cancel, only an Admin can overrule the refund, and refunds are never written by these functions', () => {
  assert.match(sql, /only an admin can change the refund decision/); assert.match(sql, /not public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /insert into public\.ledger_entries/);   // recording a refund stays an Admin-only ledger insert (row security)
  assert.match(sql, /flow_need\(\)/);
});
test('the migration only adds: no dropped tables or columns, and the new status keeps the old ones', () => {
  assert.doesNotMatch(sql, /drop (table|column)/i);
  for (const s of ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed', 'lost', 'junk', 'cancelled']) assert.ok(sql.includes(`'${s}'`), s);
});
test('a customer asks from the tracking page; the request is a typed issue, not an instant cancel', () => {
  assert.match(read('assets/js/track.js'), /\['cancel', 'I want to cancel this booking'\]/);
  assert.match(read('assets/js/track.js'), /We confirm it before anything is refunded/);
  assert.match(read('supabase/functions/_shared/booking-update.ts'), /'cancel'\] as const/);
  assert.match(sql, /p_category not in \('late','mechanic','payment','safety','other','cancel'\)/);
});
test('Crew and Admin share the cancel dialog; the refund button exists only where a refund sheet is provided (Admin)', () => {
  const core = read('crm/flow-core.js'); assert.equal(read('admin/flow-core.js'), core);
  assert.match(core, /data-flow="cancel"/); assert.match(core, /deps\.openRefund \?/);
  assert.match(read('admin/admin.js'), /canOverrideRefund: \(\) => true/); assert.doesNotMatch(read('crm/crm.js'), /canOverrideRefund|openRefund/);
  assert.match(read('crm/crm.js'), /id: 'cancellations'/);
});
