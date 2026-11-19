import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATUS } from '../crm/ds.js';
import { cleanWarrantyInput } from '../supabase/functions/_shared/warranty-rules.ts';
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('a booking with no tracking link gets one before the quote email, so Approve now works', () => {
  const s = src('supabase/functions/_shared/after-payment.ts');
  assert.match(s, /booking_open_secrets/);
  assert.match(s, /if \(!secrets\?\.track_token\)/);
});
test('cancelled shows red and completed shows green; Admin can filter cancelled and customer overdue', () => {
  assert.equal(STATUS.cancelled.tone, 'bad'); assert.equal(STATUS.completed.tone, 'good');
  assert.match(src('crm/ds.css'), /\.pill\.cancelled/);
  const a = src('admin/admin.js');
  assert.match(a, /value="cancelled"/); assert.match(a, /value="overdue"/);
  assert.match(a, /statusLabels\.includes\('Overdue'\)/);
});
test('warranty card: "not covered" is optional and only sent when given', () => {
  assert.deepEqual(cleanWarrantyInput({ days: '60', covers: 'Chain work' }), { ok: true, value: { days: 60, covers: 'Chain work' } });
  assert.equal(cleanWarrantyInput({ days: '30', covers: 'x', excludes: ' Wear   and tear <b> ' }).value.excludes, 'Wear and tear b');
  const w = src('supabase/functions/_shared/warranty.ts');
  assert.match(w, /if \(opts\.excludes\) patch\.excludes/);
  assert.match(src('supabase/functions/warranty-verify/index.ts'), /select\('\*'\)/);   // does not break before the database update is run
  assert.match(src('assets/js/warranty.js'), /Not covered/);
});
test('SAC/HSN is a setting; it prints on the invoice views and the invoice email only when set', () => {
  const a = src('admin/admin.js');
  assert.match(a, /id="st-hsn"/); assert.match(a, /S\.settings\.hsn_code \? '<th>SAC\/HSN<\/th>'/);
  assert.match(src('supabase/functions/send-invoice/index.ts'), /\(invoice as any\)\.hsn = hsn/);
  assert.match(src('supabase/functions/_shared/email-templates.ts'), /SAC\/HSN/);
});
