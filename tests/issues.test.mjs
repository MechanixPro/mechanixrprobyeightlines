import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issueRows, openIssueCount, warrantyInfo } from '../admin/issue-view.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const leads = [{ id: 'l1', ref: 'MP-AAA111', name: 'Asha', phone: '9876543210', preferred_date: '2026-10-01', status: 'completed' }];
const issues = [
  { id: 'i1', lead_id: 'l1', kind: 'refund', status: 'open', amount: 349, note: 'Slot missed', created_at: '2026-10-05T10:00:00Z' },
  { id: 'i2', lead_id: 'l1', kind: 'warranty', status: 'resolved', amount: null, note: 'Chain loose again', created_at: '2026-10-06T10:00:00Z', resolved_at: '2026-10-07T10:00:00Z' },
  { id: 'i3', lead_id: null, kind: 'complaint', status: 'in_progress', amount: null, note: 'Rude call', created_at: '2026-10-04T10:00:00Z' },
];

test('rows carry the booking details, are newest first, and open ones are counted', () => {
  const r = issueRows(issues, leads);
  assert.deepEqual(r.map((x) => x.id), ['i2', 'i1', 'i3']);
  assert.equal(r[1].ref, 'MP-AAA111'); assert.equal(r[1].customer, 'Asha'); assert.equal(r[2].ref, '—');
  assert.equal(openIssueCount(issues), 2);
});
test('filtering by status keeps resolved ones separate', () => {
  assert.deepEqual(issueRows(issues, leads, 'open').map((x) => x.id), ['i1', 'i3']);
  assert.deepEqual(issueRows(issues, leads, 'resolved').map((x) => x.id), ['i2']);
});
test('warranty runs 30 days from the service day', () => {
  const w = warrantyInfo(leads[0], 30, new Date('2026-10-20T00:00:00Z'));
  assert.equal(w.active, true); assert.equal(w.endsOn, '2026-10-31'); assert.equal(w.daysLeft, 11);
  assert.equal(warrantyInfo(leads[0], 30, new Date('2026-11-05T00:00:00Z')).active, false);
  assert.equal(warrantyInfo({ ...leads[0], status: 'new' }, 30, new Date('2026-10-20T00:00:00Z')).active, false);
});
test('migration: issues table, admin-only access, sensible limits', () => {
  const sql = read('../supabase/migrations/20261019000000_issues.sql');
  assert.match(sql, /create table if not exists public\.issues/); assert.match(sql, /enable row level security/);
  assert.match(sql, /public\.is_admin\(\)/); assert.match(sql, /kind\s+text not null check \(kind in \('complaint','refund','warranty'\)\)/);
  assert.match(sql, /status\s+text not null default 'open'/); assert.doesNotMatch(sql, /to anon/);
});
test('admin has an Issues tab with new, update and warranty hint', () => {
  assert.match(read('../admin/index.html'), /data-tab="issues"/);
  const a = read('../admin/admin.js');
  assert.match(a, /from\('issues'\)/); for (const act of ['newIssue', 'saveIssue']) assert.ok(a.includes(act), act);
  assert.match(a, /warrantyInfo\(/);
});
