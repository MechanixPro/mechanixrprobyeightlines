import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROWS, parseCsv, normPhone10, validateRows } from '../crm/import-leads.js';

test('parseCsv: quotes, commas in quotes, CRLF, blank lines, aliases', () => {
  const rows = parseCsv('Customer,Mobile,Remarks\r\n"Rao, S",98765 43210,"said ""call"""\r\n\r\nAsha,9000000001,\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Rao, S', phone: '98765 43210', note: 'said "call"' });
  assert.equal(rows[1].name, 'Asha');
  assert.deepEqual(parseCsv(''), []);
  assert.equal(parseCsv('contact,notes,source\n9876543210,hi,phone')[0].source, 'phone');
});
test('normPhone10', () => {
  assert.equal(normPhone10('+91 98765-43210'), '9876543210');
  assert.equal(normPhone10('09876543210'), '9876543210');
  assert.equal(normPhone10('919876543210'), '9876543210');
  assert.equal(normPhone10('5876543210'), null);
  assert.equal(normPhone10('12345'), null);
  assert.equal(normPhone10('98765abc10'), null);
  assert.equal(normPhone10(null), null);
});
test('validateRows: valid, invalid, duplicates (existing and in-file)', () => {
  const rows = [
    { name: 'A', phone: '9876543210' }, { name: 'Ravi', phone: '98765 43210' }, { name: 'Sam', phone: '9000000001' },
    { name: 'Bad', phone: '123' }, { name: '', phone: '9111111111' }, { name: 'Old', phone: '9222222222', source: 'phone', note: 'x' },
  ];
  const v = validateRows([{ name: 'Ann', phone: '9876543210' }, ...rows.slice(1)], new Set(['9222222222']));
  assert.deepEqual(v.valid.map((r) => r.phone), ['9876543210', '9000000001']);
  assert.deepEqual(v.invalid.map((r) => r.row), [5, 6]);
  assert.deepEqual(v.duplicates.map((r) => r.row), [3, 7]);
  assert.equal(v.tooMany, false);
});
test('validateRows: over MAX_ROWS flagged; sensitive columns ignored with warning', () => {
  assert.equal(MAX_ROWS, 500);
  assert.equal(validateRows(Array.from({ length: 501 }, () => ({ name: 'Xy', phone: '9876543210' }))).tooMany, true);
  const v = validateRows([{ name: 'Ann', phone: '9876543210', 'aadhaar no': '1', 'pan': 'x', 'dl number': 'y' }]);
  assert.equal(v.warnings.length, 3);
  assert.match(v.warnings[0], /aadhaar no/);
  assert.equal(Object.keys(v.valid[0]).join(), 'name,phone,source,note');
});
