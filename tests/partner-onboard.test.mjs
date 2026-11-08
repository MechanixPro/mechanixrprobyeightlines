import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkUpload, docPath, pathOk, missing, canSubmit, countDocs, REQUIRED, DOC_TYPES, MAX_BYTES } from '../supabase/functions/_shared/partner-kyc.ts';

const P = '11111111-2222-3333-4444-555555555555';
test('upload checks: type, content type, size', () => {
  assert.equal(checkUpload('garage', 'pan', 'image/jpeg', 1000).ok, true);
  assert.equal(checkUpload('garage', 'pan', 'image/gif', 1000).ok, false);
  assert.equal(checkUpload('garage', 'pan', 'image/png', MAX_BYTES + 1).ok, false);
  assert.equal(checkUpload('garage', 'pan', 'image/png', 0).ok, false);
  assert.equal(checkUpload('mechanic', 'garage_photo', 'image/png', 10).ok, false, 'a mechanic has no garage photos');
  assert.equal(checkUpload('garage', 'signed_agreement', 'image/jpeg', 10).ok, false, 'agreement must be a PDF');
  assert.equal(checkUpload('garage', 'signed_agreement', 'application/pdf', 10).ok, true);
});
test('paths: only our own prefix and a safe name pass', () => {
  const p = docPath('garage', P, 'pan', 'abcdef1234567890', 'jpg');
  assert.equal(pathOk('garage', P, p), true);
  assert.equal(pathOk('mechanic', P, p), false);
  assert.equal(pathOk('garage', P, 'garage/other/pan-abcdef1234567890.jpg'), false);
  assert.equal(pathOk('garage', P, `garage/${P}/../x-abcdef1234567890.jpg`), false);
  assert.equal(pathOk('garage', P, `garage/${P}/pan-abcdef1234567890.exe`), false);
});
test('submit needs every required document, rejected ones do not count', () => {
  const full = {}; for (const r of REQUIRED.garage) full[r.type] = r.min;
  assert.equal(canSubmit('garage', full), true);
  assert.deepEqual(missing('garage', { ...full, garage_photo: 2 }), [{ type: 'garage_photo', need: 1 }]);
  assert.deepEqual(countDocs([{ doc_type: 'pan', status: 'rejected' }, { doc_type: 'pan', status: 'uploaded' }]), { pan: 1 });
  assert.equal(canSubmit('mechanic', {}), false);
});
test('every required type is a known type', () => {
  for (const k of ['garage', 'mechanic']) for (const r of REQUIRED[k]) assert.ok(DOC_TYPES[k].includes(r.type), k + ' ' + r.type);
});
test('the function never logs tokens and never returns a public file URL', () => {
  const s = readFileSync(new URL('../supabase/functions/partner-onboard/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /console\.(log|error)\([^)]*token/);
  assert.doesNotMatch(s, /getPublicUrl|createSignedUrl\(/);
  assert.match(s, /createSignedUploadUrl/);
  assert.match(s, /Too many tries/);
  assert.match(s, /kyc_link_check/);
});
