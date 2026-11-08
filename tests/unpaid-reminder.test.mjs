import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESK_TEMPLATES, placeholders } from '../supabase/functions/_shared/desk-templates.ts';
import { shouldRemind, inQuietHours, unpaidParams, UNPAID_TEMPLATE, UNPAID_KIND } from '../supabase/functions/_shared/unpaid-reminder.ts';

const auto = readFileSync(new URL('../supabase/functions/desk-automation/index.ts', import.meta.url), 'utf8');
const NOW = new Date('2026-11-10T12:00:00+05:30');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const lead = (o = {}) => ({ id: 'L1', phone: '9876543210', status: 'payment_sent', rzp_order_id: 'order_1', confirm_paid_at: null, consent_whatsapp: true, opted_out: false, deleted_at: null, created_at: ago(60), crm_first_contact_at: null, ...o });

test('template is UTILITY with four sequential variables and no urgency or discount words', () => {
  const t = DESK_TEMPLATES.find((x) => x.name === UNPAID_TEMPLATE);
  assert.ok(t); assert.equal(t.category, 'UTILITY'); assert.equal(t.params, 4);
  const p = placeholders(t.text); assert.equal(p.count, 4); assert.equal(p.sequential, true);
  assert.doesNotMatch(t.text, /\b(free|discount|offer|hurry|last chance|limited|best|guarantee|%)\b/i);
  assert.match(t.sample, /\[Name\].*\[Vehicle\].*\[Amount\].*\[Link\]/);
});
test('eligibility window is 30 minutes to 24 hours', () => {
  assert.equal(shouldRemind(lead({ created_at: ago(29) }), [], NOW), false);
  assert.equal(shouldRemind(lead({ created_at: ago(31) }), [], NOW), true);
  assert.equal(shouldRemind(lead({ created_at: ago(24 * 60 - 1) }), [], NOW), true);
  assert.equal(shouldRemind(lead({ created_at: ago(24 * 60 + 1) }), [], NOW), false);
});
test('consent, opt-out, phone, paid, status, deleted and no-order exclusions', () => {
  for (const o of [{ consent_whatsapp: false }, { consent_whatsapp: null }, { opted_out: true }, { phone: '' }, { confirm_paid_at: ago(5) }, { status: 'lost' }, { status: 'junk' }, { status: 'scheduled' }, { deleted_at: ago(1) }, { rzp_order_id: null }])
    assert.equal(shouldRemind(lead(o), [], NOW), false, JSON.stringify(o));
});
test('a recent human contact blocks it, an old one does not', () => {
  assert.equal(shouldRemind(lead({ status: 'contacted', crm_first_contact_at: ago(10) }), [], NOW), false);
  assert.equal(shouldRemind(lead({ status: 'contacted', crm_first_contact_at: ago(45) }), [], NOW), true);
});
test('once per lead', () => {
  assert.equal(shouldRemind(lead(), [{ lead_id: 'L1', kind: UNPAID_KIND }], NOW), false);
  assert.equal(shouldRemind(lead(), [{ lead_id: 'L2', kind: UNPAID_KIND }], NOW), true);
});
test('quiet hours 21:00 to 09:00 IST wait, then send once the window opens if still inside 24 hours', () => {
  const at = (h) => new Date('2026-11-10T' + h + ':00+05:30');
  assert.equal(inQuietHours(at('21:00')), true); assert.equal(inQuietHours(at('08:59')), true); assert.equal(inQuietHours(at('09:00')), false); assert.equal(inQuietHours(at('20:59')), false);
  const created = new Date('2026-11-09T22:00:00+05:30').toISOString();
  assert.equal(shouldRemind(lead({ created_at: created }), [], at('03:00')), false);
  assert.equal(shouldRemind(lead({ created_at: created }), [], at('09:00')), true);
  assert.equal(shouldRemind(lead({ created_at: created }), [], new Date('2026-11-10T22:30:00+05:30')), false);
});
test('parameters: first name, vehicle with model, fee, plain /book/ link', () => {
  assert.deepEqual(unpaidParams({ name: 'Asha Rao', vehicle: 'bike', brand: 'Honda', model: 'Activa', fee: 49 }), ['Asha', 'bike (Honda Activa)', '49', 'https://mechanixpro.in/book/']);
  assert.deepEqual(unpaidParams({ name: 'Ravi', vehicle: 'car', fee: '99.00' }).slice(0, 3), ['Ravi', 'car', '99']);
});
test('source: ready guard, once-per-lead key, switch, same try/catch log pattern', () => {
  assert.match(auto, /\/\* 10\. unpaid booking reminder/);
  assert.match(auto, /!ready\[ut\.campaign\] \|\| !env\('AISENSY_API_KEY'\)\) \{ result\.unpaid_reminder = 'skipped'/);
  assert.match(auto, /desk_auto_unpaid_reminder', true/);
  assert.match(auto, /upsert\(\{ lead_id: l\.id, kind: UNPAID_KIND \}, \{ onConflict: 'lead_id,kind', ignoreDuplicates: true \}\)/);
  assert.match(auto, /\.is\('confirm_paid_at', null\)\.not\('rzp_order_id', 'is', null\)\.eq\('consent_whatsapp', true\)\.eq\('opted_out', false\)/);
  assert.match(auto, /catch \(e\) \{ result\.unpaid_reminder = \{ error/);
});
