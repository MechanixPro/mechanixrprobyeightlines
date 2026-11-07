import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX, emptySel, toggle, selectAll, clear, validateAction, summaryText } from '../crm/bulk.js';

test('toggle adds and removes, immutably', () => {
  const s = emptySel(), a = toggle(s, 'x');
  assert.deepEqual(s.ids, []); assert.deepEqual(a.ids, ['x']);
  assert.deepEqual(toggle(a, 'x').ids, []);
});
test('selectAll caps at MAX and dedupes', () => {
  const ids = Array.from({ length: 150 }, (_, i) => 'i' + i);
  assert.equal(selectAll(emptySel(), ids).ids.length, MAX);
  assert.deepEqual(selectAll({ ids: ['a'] }, ['a', 'b']).ids, ['a', 'b']);
  assert.equal(toggle(selectAll(emptySel(), ids), 'zz').ids.length, MAX);
  assert.deepEqual(clear().ids, []);
});
test('validateAction rules', () => {
  assert.equal(validateAction({ kind: 'assign', to: 'u' }, 0).ok, false);
  assert.equal(validateAction({ kind: 'assign', to: 'u' }, 101).ok, false);
  assert.equal(validateAction({ kind: 'assign' }, 2).ok, false);
  assert.equal(validateAction({ kind: 'assign', to: 'u' }, 2).ok, true);
  assert.equal(validateAction({ kind: 'status', status: 'lost', reason: '  ' }, 2).ok, false);
  assert.equal(validateAction({ kind: 'status', status: 'lost', reason: 'no answer' }, 2).ok, true);
  assert.equal(validateAction({ kind: 'status', status: 'contacted' }, 2).ok, true);
  assert.equal(validateAction({ kind: 'snooze', days: 0 }, 2).ok, false);
  assert.equal(validateAction({ kind: 'snooze', days: 4 }, 2).ok, false);
  assert.equal(validateAction({ kind: 'snooze', days: 3 }, 2).ok, true);
  assert.equal(validateAction({ kind: 'x' }, 2).ok, false);
});
test('summaryText', () => {
  assert.match(summaryText('assign', 1, 'Ravi', true), /Assign 1 lead to Ravi\./);
  assert.match(summaryText('snooze', 3, 2, false), /3 leads for 2 days.*may be skipped/);
});
