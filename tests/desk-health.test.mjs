import test from 'node:test';
import assert from 'node:assert/strict';
import { findProblems } from '../supabase/functions/_shared/desk-health-rules.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z'), ago = (m) => new Date(NOW - m * 60_000).toISOString();
const ok = { now: NOW, hour: 14, autoAt: ago(2), pollAt: ago(2), pollChecked: 5, pollFailed: 0, recentJobFailures: 0, campaignsReady: true };
const keys = (h) => findProblems({ ...ok, ...h }).map((p) => p.key);

test('a healthy desk raises nothing', () => assert.deepEqual(keys({}), []));
test('a stopped automation is reported after 15 minutes', () => { assert.deepEqual(keys({ autoAt: ago(14) }), []); assert.deepEqual(keys({ autoAt: ago(16) }), ['automation_stale']); assert.deepEqual(keys({ autoAt: null }), ['automation_stale']); });
test('the reply checker is only judged during the day', () => { assert.deepEqual(keys({ pollAt: ago(40) }), ['poll_stale']); assert.deepEqual(keys({ pollAt: ago(40), hour: 23 }), []); assert.deepEqual(keys({ pollAt: ago(40), hour: 3 }), []); });
test('every AiSensy check failing is reported, one failure is not', () => { assert.deepEqual(keys({ pollChecked: 4, pollFailed: 4 }), ['poll_failing']); assert.deepEqual(keys({ pollChecked: 4, pollFailed: 1 }), []); assert.deepEqual(keys({ pollChecked: 0, pollFailed: 0 }), []); });
test('three failed steps in an hour are reported', () => { assert.deepEqual(keys({ recentJobFailures: 2 }), []); assert.deepEqual(keys({ recentJobFailures: 3 }), ['jobs_failing']); });
test('templates are reported after a day of waiting, with their names', () => {
  assert.deepEqual(keys({ campaignsReady: false, waitingSince: ago(23 * 60) }), []);
  const p = findProblems({ ...ok, campaignsReady: false, waitingSince: ago(25 * 60), waitingNames: ['mxp_quote_ready'] });
  assert.equal(p[0].key, 'templates_waiting'); assert.match(p[0].line, /mxp_quote_ready/); assert.equal(p[0].coolHours, 24);
  assert.deepEqual(keys({ campaignsReady: true, waitingSince: ago(99 * 60) }), []);
});

import { readFileSync } from 'node:fs';
test('the desk lead sheet shows the same money figures as the admin', () => {
  const crm = readFileSync(new URL('../crm/crm.js', import.meta.url), 'utf8');
  assert.match(crm, /crm_lead_money/); assert.match(crm, /Vehicle number/); assert.match(crm, /Quote, excluding GST/);
  const sql = readFileSync(new URL('../supabase/migrations/20261203000000_desk_lead_money.sql', import.meta.url), 'utf8');
  assert.match(sql, /crm_can_see/); assert.match(sql, /voided_at is null/); assert.match(sql, /reverses_id/);
});
