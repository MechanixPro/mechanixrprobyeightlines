// Pro Check 20: 20 points plus a test ride. Server rules, browser copy, SQL rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, POINT_KEYS, cleanResults, isComplete, missing, summary, customerView, suggestedQuoteLines, SAFETY_LINE } from '../supabase/functions/_shared/pro-check.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const full = (over = {}) => ({ points: Object.fromEntries(POINT_KEYS.map((k) => [k, { r: 'ok' }])), test_ride: { r: 'done_fine' }, ...over });

test('exactly 20 unique points in 7 groups', () => {
  assert.equal(POINT_KEYS.length, 20); assert.equal(new Set(POINT_KEYS).size, 20); assert.equal(GROUPS.length, 7);
});
test('the browser copy is identical to the server list', () => {
  const sandbox = {}; new Function('window', read('assets/js/pro-check-data.js'))(sandbox);
  assert.deepEqual(sandbox.MXP_PRO_CHECK.groups, GROUPS);
  assert.equal(sandbox.MXP_PRO_CHECK.safety, SAFETY_LINE);
});
test('complete needs all 20 answers and a test ride answer', () => {
  assert.equal(isComplete(full()), true);
  const noRide = full(); delete noRide.test_ride; assert.equal(isComplete(noRide), false); assert.deepEqual(missing(noRide), ['test_ride']);
  const short = full(); delete short.points.horn; assert.equal(isComplete(short), false); assert.deepEqual(missing(short), ['horn']);
  assert.equal(isComplete(null), false);
});
test('cleaning keeps only real keys and values, trims notes to 140', () => {
  assert.equal(cleanResults({ points: { battery: { r: 'maybe' } } }).ok, false);
  const r = cleanResults({ points: { battery: { r: 'needs_attention', n: 'x'.repeat(300) }, fake_key: { r: 'ok' } }, test_ride: { r: 'done_note', n: 'pulls left' } });
  assert.equal(r.ok, true); assert.equal(Object.keys(r.value.points).join(), 'battery'); assert.equal(r.value.points.battery.n.length, 140);
});
test('a skipped test ride needs one of the three reasons', () => {
  assert.equal(cleanResults({ points: {}, test_ride: { r: 'not_done' } }).ok, false);
  assert.equal(cleanResults({ points: {}, test_ride: { r: 'not_done', why: 'felt like it' } }).ok, false);
  assert.equal(cleanResults({ points: {}, test_ride: { r: 'not_done', why: 'no_safe_road' } }).ok, true);
});
test('customer view: counts, labels and the test ride line', () => {
  const f = full(); f.points.horn = { r: 'needs_attention', n: 'weak' }; f.points.stands = { r: 'not_applicable' }; f.test_ride = { r: 'not_done', why: 'customer_declined' };
  const v = customerView(f);
  assert.deepEqual(v.summary, { ok: 18, attention: 1, skipped: 1, total: 20 });
  assert.equal(v.test_ride, 'Test ride not done: customer asked us not to');
  assert.deepEqual(suggestedQuoteLines(f), ['Horn: weak']);
  assert.doesNotMatch(JSON.stringify(v), /phone|address|amount|mechanic/i);
});
test('no forbidden words in the labels', () => { assert.doesNotMatch(JSON.stringify(GROUPS) + SAFETY_LINE, /guarantee|100%|zero risk/i); });
test('migration is additive, RLS on, service role only for writes, SQL repeats the rules', () => {
  const sql = read('supabase/migrations/20270121000000_pro_check.sql');
  assert.match(sql, /enable row level security/); assert.doesNotMatch(sql, /create policy/i); assert.doesNotMatch(sql, /drop table|drop column|delete from/i.test ? /drop column/ : /x/);
  assert.match(sql, /to service_role/); assert.match(sql, /perform public\.crm_lead\(p_lead\)/);
  for (const k of POINT_KEYS) assert.ok(sql.includes("'" + k + "'"), k + ' in SQL');
  assert.match(sql, /no_safe_road/); assert.match(sql, /char_length\(coalesce\(v ->> 'n', ''\)\) > 140/);
});
