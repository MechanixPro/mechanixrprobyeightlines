import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen } from '../supabase/functions/_shared/when.ts';

test('formatWhen writes the day and the time window the way the website does', () => {
  assert.equal(formatWhen('2026-10-11', 'morning'), 'Sunday, 11 Oct · Morning (9 AM – 12 PM)');
  assert.equal(formatWhen('2026-10-12', 'afternoon'), 'Monday, 12 Oct · Afternoon (12 – 4 PM)');
  assert.equal(formatWhen('2026-10-13', 'evening'), 'Tuesday, 13 Oct · Evening (4 – 8 PM)');
});
test('an emergency booking says as soon as possible, with no day', () => assert.equal(formatWhen('2026-10-11', 'asap'), 'As soon as possible'));
test('an unknown slot still gives a readable day', () => assert.equal(formatWhen('2026-10-11', 'weird'), 'Sunday, 11 Oct'));

test('an exact arrival window replaces the broad slot text in emails', () => {
  assert.equal(formatWhen('2026-10-11', 'morning', '10–11 AM'), 'Sunday, 11 Oct · 10–11 AM');
  assert.equal(formatWhen('2026-10-11', 'asap', '10–11 AM'), 'As soon as possible');
});
