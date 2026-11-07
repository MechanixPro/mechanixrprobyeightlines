// Funnel pure rules and screen markup (crm/funnel.js, the identical copy admin/funnel.js). Fixtures include nulls and odd data on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeFunnel, stageRows, biggestDrop, fmtHours, fmtAge, funnelCsv, timingOf, routeInfo, routeChipHtml, periodDates, createFunnelDesk, STAGES } from '../admin/funnel.js';

const rpcData = { targets: { claim_minutes: 15, quote_hours: 2, valid_days: 3 }, money: false,
  stages: [['lead', 100, null], ['contacted', 80, 0.2], ['quote_sent', 40, 1.5], ['quote_approved', 30, 3], ['paid', 25, 0.5], ['completed', 20, 26], ['invoiced', 18, 5]].map(([key, n, h]) => ({ key, label: key, n, median_hours: h })),
  lost: [{ reason: 'Price too high', n: 5 }, { reason: null, n: 2 }], quote_outcomes: { sent: 40, approved: 30, declined: 4, changes: 2, expired: 1 },
  overdue_claim: [{ id: 'a', ref: 'L-AAA111', vehicle: 'bike', age_min: 40 }], overdue_quote: [{ id: 'b', ref: 'L-BBB222', vehicle: 'car', age_hours: 3.5 }], invoiced_total: null };

test('the admin copy is identical to the Crew source', () => { assert.equal(fs.readFileSync('admin/funnel.js', 'utf8'), fs.readFileSync('crm/funnel.js', 'utf8')); });

test('stages: percent of previous, drop-off, percent of all, in order', () => {
  const rows = stageRows(normalizeFunnel(rpcData));
  assert.deepEqual(rows.map((r) => r.key), STAGES.map((s) => s[0]));
  assert.equal(rows[0].pctPrev, null); assert.equal(rows[1].pctPrev, 80); assert.equal(rows[1].drop, 20); assert.equal(rows[2].pctPrev, 50); assert.equal(rows[2].pctAll, 40);
  assert.equal(biggestDrop(rows).key, 'quote_sent');
});

test('fuzz: null, empty and odd RPC results never throw and still give seven stages', () => {
  for (const bad of [null, undefined, {}, [], 'x', 5, { stages: null }, { stages: [null, 3, 'a', {}] }, { stages: [{ key: 'lead', n: 'abc' }, { key: 'contacted', n: -4 }, { key: 'paid', n: 1e9 }] },
    { stages: rpcData.stages, lost: [null, { reason: undefined, n: null }, 7], overdue_claim: [null, {}, { ref: null, age_min: 'zz' }], overdue_quote: 'no', targets: { claim_minutes: -1, quote_hours: 'x' }, quote_outcomes: null }]) {
    const f = normalizeFunnel(bad), rows = stageRows(f);
    assert.equal(f.stages.length, 7); assert.equal(rows.length, 7);
    assert.ok(rows.every((r) => Number.isFinite(r.n) && r.n >= 0));
    assert.ok(f.targets.claim_minutes > 0 && f.targets.quote_hours > 0);
    assert.doesNotThrow(() => funnelCsv(f)); assert.doesNotThrow(() => biggestDrop(rows));
  }
  const f = normalizeFunnel({ stages: [{ key: 'lead', n: 0 }, { key: 'contacted', n: 0 }] });
  assert.equal(stageRows(f)[1].pctPrev, null, 'no divide by zero');
  assert.equal(biggestDrop(stageRows(f)), null);
  assert.equal(normalizeFunnel(rpcData).lost[1].reason, 'No reason recorded');
});

test('time formats', () => {
  assert.equal(fmtHours(0.2), '12 min'); assert.equal(fmtHours(1.54), '1.5 h'); assert.equal(fmtHours(60), '2.5 days'); assert.equal(fmtHours(null), 'n/a'); assert.equal(fmtHours(-3), 'n/a'); assert.equal(fmtHours('x'), 'n/a');
  assert.equal(fmtAge(40), '40 min'); assert.equal(fmtAge(null), 'n/a'); assert.equal(fmtAge(300), '5 h');
  const p = periodDates(7, Date.parse('2026-11-07T10:00:00Z')); assert.deepEqual(p, { from: '2026-11-01', to: '2026-11-07' });
});

test('CSV: stages, lost reasons, late leads; formula cells are neutralised; money only for admin', () => {
  const csv = funnelCsv(normalizeFunnel(rpcData), { label: '=cmd' });
  assert.match(csv, /^Funnel,'=cmd/); assert.match(csv, /Quote sent,40,50,40,40,1\.5/); assert.match(csv, /Price too high,5/); assert.match(csv, /L-AAA111,40/); assert.match(csv, /L-BBB222,3\.5/);
  assert.doesNotMatch(csv, /Invoiced total/);
  assert.match(funnelCsv(normalizeFunnel({ ...rpcData, money: true, invoiced_total: 12345 })), /Invoiced total \(Rs\),12345/);
});

const NOW = Date.parse('2026-11-07T12:00:00Z'), ago = (min) => new Date(NOW - min * 60e3).toISOString();
test('late against the targets: unclaimed over 15 minutes, quote over 2 hours', () => {
  assert.deepEqual([timingOf({ status: 'new', created_at: ago(20) }, undefined, NOW).late, timingOf({ status: 'new', created_at: ago(10) }, undefined, NOW).late], [true, false]);
  assert.equal(timingOf({ status: 'new', created_at: ago(20), crm_owner: 'u1' }, undefined, NOW).kind, null, 'an owned lead is not "unclaimed"');
  assert.equal(timingOf({ status: 'contacted', created_at: ago(300), crm_first_contact_at: ago(130) }, undefined, NOW).late, true);
  assert.equal(timingOf({ status: 'contacted', created_at: ago(300), crm_first_contact_at: ago(60) }, undefined, NOW).late, false);
  assert.equal(timingOf({ status: 'contacted', created_at: ago(300), crm_first_contact_at: ago(500), has_quote: true }, undefined, NOW).late, false, 'quote sent');
  assert.equal(timingOf({ status: 'contacted', created_at: ago(300), crm_first_contact_at: ago(130) }, { quote_hours: 4 }, NOW).late, false, 'configurable');
  for (const s of ['lost', 'junk', 'completed']) assert.equal(timingOf({ status: s, created_at: ago(900) }, undefined, NOW).late, false);
});
test('late: fuzz', () => {
  for (const l of [null, undefined, {}, 'x', { status: 'new' }, { status: 'new', created_at: 'not a date' }, { status: 'contacted', crm_first_contact_at: 'zz' }, { status: 'new', created_at: null, deleted_at: '2026-01-01' }])
    assert.doesNotThrow(() => timingOf(l, null, NOW));
  assert.equal(timingOf({ status: 'new', created_at: 'not a date' }, null, NOW).late, false);
});

test('routing chip: owner, one Next step button, late in red; unassigned and null owner are safe', () => {
  const i = routeInfo({ status: 'new', created_at: ago(40), ref: 'L-X' }, { now: NOW, next: { key: 'call', label: 'Call now' } });
  assert.equal(i.owner, 'Unassigned'); assert.equal(i.next.label, 'Call now'); assert.equal(i.timing.late, true);
  const h = routeChipHtml(i); assert.match(h, /Unassigned/); assert.match(h, /data-act="routeNext" data-step="call">Next: Call now/); assert.match(h, /mx-chip--bad route-late/); assert.equal((h.match(/<button/g) || []).length, 1);
  assert.equal(routeInfo({ status: 'quoted', crm_owner: 'u1', owner_name: 'Asha' }, { now: NOW }).owner, 'Asha');
  assert.doesNotMatch(routeChipHtml(routeInfo({ status: 'quoted', created_at: ago(5) }, { now: NOW, next: null })), /<button/);
  assert.match(routeChipHtml(routeInfo({ owner_name: '<b>x</b>', status: 'quoted' }, { now: NOW })), /&lt;b&gt;x/);
  assert.doesNotThrow(() => routeChipHtml(routeInfo(null))); assert.equal(routeChipHtml(null), '');
});

function fakeRoot() { const h = {}; return { isConnected: true, innerHTML: '', addEventListener(t, f) { h[t] = f; }, h, querySelector() { return null; } }; }
test('screen: loading, data, empty and error states; filters go to the RPC; CSV button downloads', async () => {
  const calls = [], root = fakeRoot(); let mode = 'ok', dl = null;
  const desk = createFunnelDesk({ rpc: async (n, a) => { calls.push([n, a]); if (n === 'crm_funnel_options') return { sources: ['google', 'website'], campaigns: [], owners: [{ id: 'u1', name: 'Asha' }, null] }; if (mode === 'err') throw new Error('boom'); return mode === 'empty' ? { stages: [] } : rpcData; }, download: (n, t) => { dl = [n, t]; } });
  const p = desk.mount(root); assert.match(root.innerHTML, /aria-busy="true"/); assert.match(root.innerHTML, /Loading the funnel/);
  await p;
  assert.match(root.innerHTML, /Quote approved/); assert.match(root.innerHTML, /Not claimed in time/); assert.match(root.innerHTML, /L-AAA111/); assert.match(root.innerHTML, /Biggest leak/); assert.match(root.innerHTML, /Price too high/); assert.match(root.innerHTML, /No reason recorded/);
  assert.match(root.innerHTML, /<option value="u1">Asha/); assert.doesNotMatch(root.innerHTML, /Invoiced total/);
  root.h.change({ target: { id: 'fnSource', value: 'google' } }); await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.at(-1)[1].p_source, 'google'); assert.equal(calls.at(-1)[1].p_campaign, null);
  root.h.click({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-fn' ? 'csv' : null) }) } }); assert.match(dl[0], /^mechanix-funnel-/); assert.match(dl[1], /^﻿Funnel/);
  mode = 'empty'; await desk.reload(); assert.match(root.innerHTML, /No leads in this period/);
  mode = 'err'; await desk.reload(); assert.match(root.innerHTML, /role="alert"/); assert.match(root.innerHTML, /boom/); assert.match(root.innerHTML, /Try again/);
});
