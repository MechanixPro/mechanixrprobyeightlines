import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { watchList, redCount, ruleTitle, fmtAge, watchCard } from '../crm/watch.js';

const I = (o) => ({ lead_id: 'a', rule: 'no_eta', severity: 'amber', minutes: 10, name: 'Asha', ...o });
test('red before amber, longest first', () => {
  const l = watchList([I({ lead_id: '1', minutes: 500 }), I({ lead_id: '2', severity: 'red', minutes: 20 }), I({ lead_id: '3', severity: 'red', minutes: 90 }), I({ lead_id: '4', minutes: 900 })]);
  assert.deepEqual(l.map((x) => x.lead_id), ['3', '2', '4', '1']);
});
test('plain labels', () => {
  assert.equal(ruleTitle('not_accepted'), 'Garage has not accepted');
  assert.equal(ruleTitle('no_eta'), 'Vehicle at garage, no estimated date');
  assert.equal(ruleTitle('zzz'), 'Needs attention');
  assert.equal(fmtAge(5), '5 min'); assert.equal(fmtAge(180), '3 h'); assert.equal(fmtAge(4000), '3 days'); assert.equal(fmtAge(null), 'a while');
  for (const r of ['not_accepted', 'late_for_slot', 'code_pending', 'quote_not_sent', 'quote_waiting', 'no_eta', 'ready_not_requested', 'payment_pending', 'delivered_no_proof']) assert.ok(!/_/.test(ruleTitle(r)));
});
test('money hidden unless allowed', () => {
  assert.equal(watchList([I({ amount: 1200 })])[0].amount, null);
  assert.equal(watchList([I({ amount: 1200 })], true)[0].amount, 1200);
  assert.ok(!watchCard(watchList([I({ amount: 1200 })])[0]).includes('₹'));
  assert.ok(watchCard(watchList([I({ amount: 1200 })], true)[0]).includes('₹1,200'));
});
test('junk survives, red count, escaping, buttons', () => {
  assert.deepEqual(watchList(null), []); assert.deepEqual(watchList([null, {}, 5]), []);
  assert.equal(redCount([I({ severity: 'red' }), I({})]), 1);
  const h = watchCard(watchList([I({ rule: 'not_accepted', name: '<b>x</b>', phone: '9876543210', garage_phone: '9123456780', garage_name: 'G1' })])[0]);
  assert.ok(h.includes('&lt;b&gt;') && h.includes('Reassign') && h.includes('Call garage') && h.includes('tel:+919876543210'));
  assert.ok(!watchCard(watchList([I({ rule: 'no_eta', phone: '9876543210' })])[0]).includes('Reassign'));
});
test('migration is read-only and scoped', () => {
  const s = fs.readFileSync(new URL('../supabase/migrations/20270118000000_service_watch.sql', import.meta.url), 'utf8');
  assert.ok(/stable security definer/.test(s) && /crm_need_role\(\)/.test(s) && /crm_need_page\('leads'\)/.test(s));
  assert.ok(!/\b(insert into public|update public|delete from public)\b/i.test(s.replace(/--.*$/gm, '')));
  assert.ok(/case when adm then/.test(s));
});
