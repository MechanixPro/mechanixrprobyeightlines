import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');

test('openNewBooking declares the customer it reads, so Add booking never throws a ReferenceError', () => {
  const m = src.match(/function openNewBooking\(([^)]*)\)\s*\{([\s\S]*?)\n\}\n/);
  assert.ok(m, 'openNewBooking not found');
  if (/\bif \(c\)/.test(m[2])) assert.match(m[1], /\bc\b/);
});
