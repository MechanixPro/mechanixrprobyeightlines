// The edge function runs on Deno, so Node checks that it is wired to the validator and stores every field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

const src = readFileSync(new URL('../supabase/functions/submit-lead/index.ts', import.meta.url), 'utf8');

test('submit-lead imports and calls cleanLeadFields', () => {
  assert.match(src, /import \{ cleanLeadFields \} from '\.\.\/_shared\/lead-fields\.ts'/);
  assert.match(src, /cleanLeadFields\(b\)/);
});
test('submit-lead stores every validated field on the lead row', () => {
  const insertBlock = src.slice(src.indexOf("from('leads').insert("));
  for (const key of Object.keys(cleanLeadFields({}))) assert.match(insertBlock, new RegExp('\\.\\.\\.extra|\\b' + key + '\\b'), 'not stored: ' + key);
});

test('submit-lead does not save a booking for a blocked customer', () => {
  assert.match(src, /\.select\('id, blocked'\)/);
  assert.match(src, /if \(cust\.blocked\)/);
  assert.ok(src.indexOf('if (cust.blocked)') < src.indexOf("from('leads').insert("), 'block check must come before the lead is saved');
});

test('submit-lead works out the coupon on the server and saves code and discount', () => {
  assert.match(src, /import \{ applyCoupon, normalizeCode \} from '\.\.\/_shared\/coupons\.ts'/);
  assert.match(src, /applyCoupon\(/);
  assert.match(src, /coupon_code/);
  assert.match(src, /coupon_discount/);
});

test('submit-lead sends the confirmation email after saving, logs it, and can never block the booking', () => {
  assert.match(src, /import \{ sendEmail \} from '\.\.\/_shared\/resend\.ts'/);
  assert.match(src, /import \{ bookingReceived \} from '\.\.\/_shared\/email-templates\.ts'/);
  assert.match(src, /import \{ formatWhen \} from '\.\.\/_shared\/when\.ts'/);
  const afterInsert = src.slice(src.indexOf("from('leads').insert("));
  assert.match(afterInsert, /if \(extra\.email\)/);
  assert.match(afterInsert, /try \{[\s\S]*sendEmail\([\s\S]*\} catch/);
  assert.match(afterInsert, /from\('email_log'\)\.insert/);
  assert.match(afterInsert, /email_marketing_consent/);
  assert.ok(afterInsert.indexOf('sendEmail(') < afterInsert.indexOf('return json(req, { ok: true, ref: lead.ref'), 'email is sent before the response is returned');
});
