// Genuine Parts Promise: every part line is marked Genuine or Equivalent, in the database, both quote builders, the customer views and the terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteCheck, PART_TYPES } from '../crm/flow-rules.js';
import { quoteMaths, quoteDocHtml } from '../crm/quote-doc.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const eta = { kind: 'hours', hours: 3 };

test('a part line without Genuine or Equivalent is refused, other lines are not asked', () => {
  assert.equal(quoteCheck([{ kind: 'parts', name: 'Brake pads', amount: 400 }], eta).ok, false);
  assert.equal(quoteCheck([{ kind: 'parts', name: 'Brake pads', amount: 400, part_type: 'maybe' }], eta).ok, false);
  assert.equal(quoteCheck([{ kind: 'parts', name: 'Brake pads', amount: 400, part_type: 'genuine' }, { kind: 'labour', name: 'Fitting', amount: 150 }], eta).ok, true);
  assert.deepEqual(PART_TYPES.map((p) => p[0]), ['genuine', 'equivalent']);
});
test('the quote document keeps and shows the part type', () => {
  const m = quoteMaths([{ kind: 'parts', name: 'Brake pads', amount: 400, part_type: 'equivalent' }, { kind: 'labour', name: 'Fitting', amount: 150, part_type: 'genuine' }]);
  assert.equal(m.lines[0].part_type, 'equivalent'); assert.equal(m.lines[1].part_type, undefined);
  assert.match(quoteDocHtml({ lines: [{ kind: 'parts', name: 'Brake pads', amount: 400, part_type: 'genuine' }], version: 1, status: 'sent' }), /Parts, Genuine/);
});
test('the database refuses part lines without a type, for the desk and the garage', () => {
  const sql = read('supabase/migrations/20270124000000_part_type.sql');
  assert.equal((sql.match(/not in \('genuine','equivalent'\)/g) || []).length, 2);
  assert.match(sql, /function public\.crm_quote_save\(p_lead uuid, p_lines jsonb, p_eta jsonb\)/);
  assert.match(sql, /function public\.garage_estimate_save\(p_access uuid/);
});
test('the garage estimate, the tracking page, the email and the terms carry it', () => {
  assert.match(read('supabase/functions/_shared/garage.ts'), /Mark each part as Genuine or Equivalent/);
  assert.match(read('assets/js/garage.js'), /Genuine or Equivalent/);
  assert.match(read('assets/js/track.js'), /PTYPE\[l\.part_type\]/);
  assert.match(read('supabase/functions/_shared/email-templates.ts'), /partTypeSuffix/);
  assert.match(read('scripts/build_pages.py'), /Genuine Parts Promise/);
  assert.equal(read('admin/quote-doc.js'), read('crm/quote-doc.js'));
});
