import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, validCode, istDate, validUntil, warrantyStatus, maskReg, shortName, CODE_ALPHABET } from '../supabase/functions/_shared/warranty-rules.ts';

test('card codes use only unambiguous characters and validate', () => {
  const c = makeCode([0, 1, 31, 32, 255, 7]); assert.match(c, /^MPW-[2-9A-HJ-NP-Z]{6}$/); assert.ok(validCode(c));
  assert.ok(![...CODE_ALPHABET].some((x) => '01IO'.includes(x)));
  for (const bad of ['', 'MPW-12345', 'mpw-AAAAAA', 'MPW-AAAAA0', null, 5]) assert.equal(validCode(bad), false, String(bad));
});
test('validity counts the day of service as day 1', () => {
  assert.equal(validUntil('2026-10-12', 30), '2026-11-10'); assert.equal(validUntil('2026-12-15', 30), '2027-01-13'); assert.equal(validUntil('2026-10-12', 1), '2026-10-12');
});
test('the card is active through its last day in India and expired after', () => {
  assert.equal(warrantyStatus('2026-11-10', Date.parse('2026-11-10T18:00:00Z')), 'active'); // 11:30 PM IST on the last day
  assert.equal(warrantyStatus('2026-11-10', Date.parse('2026-11-10T19:00:00Z')), 'expired'); // 12:30 AM IST next day
  assert.equal(istDate(Date.parse('2026-10-12T19:00:00Z')), '2026-10-13');
});
test('the public page hides most of the name and the registration number', () => {
  assert.equal(maskReg('ka05mq1234'), 'KA••MQ1234'); assert.equal(maskReg('KA 05 MQ 1234'), 'KA••MQ1234'); assert.equal(maskReg('KA1234'), 'KA1234'); assert.equal(maskReg(null), '');
  assert.equal(shortName('Asha Rao'), 'Asha R.'); assert.equal(shortName('Asha'), 'Asha'); assert.equal(shortName(''), 'Customer');
});

import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('the card system is wired end to end', () => {
  assert.match(read('supabase/functions/warranty-verify/index.ts'), /maskReg\(c\.vehicle_reg\)/);
  assert.match(read('supabase/functions/warranty-card/index.ts'), /from\('admins'\)/);
  const auto = read('supabase/functions/desk-automation/index.ts'); assert.match(auto, /warranty_candidates/); assert.match(auto, /mxp_warranty_card/);
  assert.match(read('supabase/migrations/20261201000000_warranty_cards.sql'), /paid >= total - 0\.5/);
  assert.match(read('admin/admin.js'), /data-act="warrantyCard"/);
  assert.ok(readFileSync(new URL('../warranty/index.html', import.meta.url), 'utf8').includes('warranty.js'));
});

test('the site build ships the warranty and rate card pages', () => {
  const sh = read('scripts/build_site.sh'); assert.match(sh, /\brate-card\b/); assert.match(sh, /\bwarranty\b/);
});
