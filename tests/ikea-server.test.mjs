import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../supabase/functions/submit-lead/index.ts', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261013000000_ikea.sql', import.meta.url), 'utf8');

test('a call-back request needs only a name, a number and a service: no day, time or area', () => {
  assert.match(src, /extra\.request_type === 'callback'/);
  assert.match(src, /const isCallback/);
  const checks = src.slice(src.indexOf('// 2) Validate'), src.indexOf('const db = adminDb()'));
  assert.match(checks, /isCallback \|\|/);
});
test('the migration adds the request type, registration and reminder columns and allows pick up', () => {
  for (const c of ['request_type', 'reg_no', 'reminder_opt_in']) assert.match(sql, new RegExp('add column if not exists ' + c + '\\b'), c);
  assert.match(sql, /check \(request_type in \('quote','callback'\)\)/);
  assert.match(sql, /place in \('home','road','unsure','pickup'\)/);
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
});
