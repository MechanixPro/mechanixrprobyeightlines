import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REQUIRED, applicantChip, sortApplicants, canApprove, missingAccepted, checkReason, esc } from '../crm/kyc-rules.js';
import { listHtml, detailHtml } from '../admin/kyc-view.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const accepted = (kind) => REQUIRED[kind].flatMap((r) => Array.from({ length: r.min }, (_, i) => ({ id: r.type + i, doc_type: r.type, status: 'accepted' })));

test('required list matches the server copy', () => {
  const ts = read('supabase/functions/_shared/partner-kyc.ts');
  for (const kind of ['garage', 'mechanic']) for (const r of REQUIRED[kind]) assert.ok(ts.includes(`{ type: '${r.type}', min: ${r.min} }`), kind + ' ' + r.type);
  assert.equal(read('crm/kyc-rules.js'), read('admin/kyc-rules.js'));
});
test('approve is enabled only when every required document is accepted', () => {
  for (const kind of ['garage', 'mechanic']) {
    const all = accepted(kind);
    assert.equal(canApprove(kind, all), true);
    assert.equal(canApprove(kind, all.slice(1)), false);
    assert.equal(canApprove(kind, all.map((d, i) => (i === 0 ? { ...d, status: 'pending' } : d))), false);
    assert.equal(canApprove(kind, all.map((d, i) => (i === 0 ? { ...d, status: 'rejected' } : d))), false);
  }
  assert.equal(canApprove('garage', accepted('garage').filter((d) => d.id !== 'garage_photo2')), false, 'needs 3 garage photos');
  assert.equal(missingAccepted('mechanic', []).length, 5);
  assert.equal(canApprove('other', []), false);
});
test('rejecting needs a reason', () => {
  assert.equal(checkReason('  ').ok, false); assert.equal(checkReason(null).ok, false);
  assert.deepEqual(checkReason(' Blurred '), { ok: true, reason: 'Blurred' });
});
test('chips and order: submitted first, then waiting, approved, rejected', () => {
  const rows = [{ name: 'd', decision: 'rejected' }, { name: 'c', decision: 'approved' }, { name: 'b', decision: 'pending', submitted: false }, { name: 'a', decision: 'pending', submitted: true }];
  assert.deepEqual(sortApplicants(rows).map((r) => applicantChip(r).label), ['Documents submitted', 'Waiting for documents', 'Approved', 'Rejected']);
});
test('names are escaped in the list and the detail', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const l = listHtml([{ kind: 'garage', id: 'i', name: evil, phone: '1', status: 'applied', decision: 'pending', submitted: true, docs: 1 }]);
  assert.ok(!l.includes('<img') && l.includes('&lt;img'));
  const d = detailHtml({ kind: 'mechanic', id: 'i', name: evil, status: 'applied', decision: 'rejected', decision_reason: evil, docs: [{ id: 'x', doc_type: 'pan', status: 'rejected', reject_reason: evil }] });
  assert.ok(!d.includes('<img') && d.includes('Delete documents'));
  assert.equal(esc('"<'), '&quot;&lt;');
});
test('detail: approve disabled until ready, go live only after approval', () => {
  const base = { kind: 'mechanic', id: 'i', name: 'N', status: 'applied', decision: 'pending', submitted_at: 'x' };
  assert.match(detailHtml({ ...base, docs: [] }), /data-approve disabled/);
  assert.doesNotMatch(detailHtml({ ...base, docs: accepted('mechanic') }), /data-approve disabled/);
  assert.doesNotMatch(detailHtml({ ...base, docs: accepted('mechanic') }), /data-onboard/);
  assert.match(detailHtml({ ...base, decision: 'approved', docs: accepted('mechanic') }), /data-onboard/);
});
test('source: documents are never embedded, viewing goes through the kyc-admin function', () => {
  const src = read('admin/kyc-view.js');
  assert.doesNotMatch(src, /<img|<iframe|<embed|<object|createSignedUrl/);
  assert.match(src, /invoke\('kyc-admin', \{ action: 'view'/);
  assert.match(src, /invoke\('kyc-admin', \{ action: 'link'/);
  assert.match(src, /invoke\('kyc-admin', \{ action: 'delete'/);
  assert.match(src, /60 seconds/);
  assert.doesNotMatch(src, /\son[a-z]+=/);
});
test('page is mounted for owner and admin only', () => {
  const a = read('admin/admin.js');
  assert.match(a, /\['owner', 'admin'\]\.includes\(S\.me\?\.role\)/);
  assert.match(a, /kycView\.mount/);
});
