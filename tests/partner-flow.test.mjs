// The partner flow: an independent mechanic applies as a mechanic, KYC, go live, and app access in the same step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('an independent mechanic applies as a mechanic, inactive, and a garage applies as a garage', () => {
  const f = read('supabase/functions/submit-partner/index.ts');
  assert.match(f, /if \(p\.kind === 'mechanic'\)/); assert.match(f, /from\('mechanics'\)\.insert\(\{[^}]*active: false, onboarding_status: 'applied'/);
  assert.match(f, /from\('garages'\)\.insert/); assert.match(f, /from\('mechanics'\)\.select\('id'\)\.eq\('phone', p\.mobile\)/);   // a repeat phone is not added twice
});
test('going live switches a mechanic on, only after the KYC is approved', () => {
  const sql = code(read('supabase/migrations/20270129000000_kyc_onboard_active.sql'));
  assert.match(sql, /approve the KYC first/); assert.match(sql, /update public\.mechanics set onboarding_status = 'live', active = true where id = p_id/);
  assert.match(sql, /perform public\.kyc_need_admin\(\)/);
});
test('going live makes the app access in the same step: a random PIN, the right app for the kind, shown once with a WhatsApp welcome', () => {
  const v = read('admin/kyc-view.js');
  assert.match(v, /crm_garage_access_create/); assert.match(v, /crm_mechanic_access_create/); assert.match(v, /crypto\.getRandomValues/);
  assert.match(v, /await issueAccess\(who\)/); assert.match(v, /Shown once/); assert.match(v, /wa\.me\/91/); assert.match(v, /already has app access/i);
  assert.doesNotMatch(v, /console\.log|localStorage/);
});
test('the Admin nav shows how many partners wait for a KYC decision, for owner and admin only', () => {
  const a = read('admin/admin.js'); assert.match(a, /function kycBadgeLoad/); assert.match(a, /\['owner', 'admin'\]\.includes\(S\.me\?\.role\)/); assert.match(a, /r\.submitted && r\.decision === 'pending'/);
  assert.match(read('admin/index.html'), /data-badge="kyc"/);
});
