// Partner KYC data layer (migration 20270116000000_partner_kyc.sql): private documents, admin-only review, no identity numbers stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20270116000000_partner_kyc.sql', import.meta.url), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the kyc bucket is private and has no storage policy', () => {
  assert.match(code, /values \('kyc', 'kyc', false/);
  assert.doesNotMatch(code, /create policy[^;]*storage\.objects/i);
});
test('every kyc table has row level security and no policy', () => {
  for (const t of ['partner_onboarding_links', 'partner_docs', 'partner_kyc', 'partner_onboarding_log']) assert.match(code, new RegExp('alter table public\\.' + t + ' enable row level security'));
  assert.doesNotMatch(code, /create policy/i);
});
test('no column can hold an Aadhaar, PAN, bank or card number', () => {
  const cols = code.match(/create table[\s\S]*?\);/g).join('\n').toLowerCase();
  for (const w of ['aadhaar', 'aadhar', 'pan_', 'pan ', 'account', 'card', 'ifsc', 'licence_no', 'dl_no']) assert.ok(!cols.includes(w), 'column text mentions ' + w);
});
test('each review function checks the admin role first and logs', () => {
  for (const f of ['kyc_review_list', 'kyc_review_detail', 'kyc_doc_set_status', 'kyc_decide', 'kyc_onboard', 'kyc_delete_docs']) {
    const m = code.match(new RegExp('function public\\.' + f + '\\([\\s\\S]*?end \\$\\$;'));
    assert.ok(m, f + ' exists');
    assert.match(m[0], /perform public\.kyc_need_admin\(\)/, f + ' checks the role');
    if (f !== 'kyc_review_list' && f !== 'kyc_review_detail') assert.match(m[0], /partner_onboarding_log/, f + ' logs');
  }
});
test('going live needs an approved KYC, and rejection needs a reason', () => {
  assert.match(code, /approve the KYC first/);
  assert.match(code, /give a reason/);
});
test('link helpers are service role only and store a hash, not the token', () => {
  assert.match(code, /grant execute on function public\.kyc_link_create\(text, uuid\), public\.kyc_link_check\(text\), public\.kyc_submit\(text, uuid\) to service_role/);
  assert.match(code, /encode\(sha256\(convert_to\(tok/);
  assert.doesNotMatch(code, /insert into public\.partner_onboarding_links \(token_hash[^)]*\) values \(tok/);
});
test('the existing status pipeline is kept (no constraint change)', () => {
  assert.doesNotMatch(code, /drop constraint/i);
  assert.match(code, /'kyc_done'/);
});
