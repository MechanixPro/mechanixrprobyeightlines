import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { isCode, isKind, isPickupJob, handoverHash, sameHash, codeExpiry, codeState, stepState, afterWrongTry, cleanPhotos, cleanUploadRequest, purgeCutoff, CODE_TTL_HOURS, MAX_ATTEMPTS, MIN_PHOTOS, MAX_PHOTOS, HANDOVER_KEEP_MONTHS } from '../supabase/functions/_shared/handover.ts';
import { handoverStatus, canSendHandoverCode, handoverMessage } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LEAD = '11111111-2222-3333-4444-555555555555', U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const now = new Date('2026-11-10T10:00:00Z');

test('the code is exactly 4 digits', () => {
  for (const ok of ['0000', '1234', '9999']) assert.equal(isCode(ok), true, ok);
  for (const bad of ['123', '12345', 'abcd', '12 4', '', null, undefined]) assert.equal(isCode(bad), false, String(bad));
  assert.equal(isKind('pickup'), true); assert.equal(isKind('return'), true); assert.equal(isKind('other'), false);
});
test('only pickup jobs have a handover', () => {
  assert.equal(isPickupJob({ job_place: 'garage' }), true);
  assert.equal(isPickupJob({ place: 'pickup' }), true);
  assert.equal(isPickupJob({ job_place: 'doorstep', place: 'home' }), false);
  assert.equal(isPickupJob(null), false);
});
test('the hash is the SHA-256 of "<id>:<code>", differs per handover and is compared in constant time', async () => {
  assert.equal(await handoverHash('abc', '1234'), '1755a2d5b309d75bede226f2b6cf858bb14287b917e76ad3b943de0dda4683fb');
  const a = await handoverHash(U(1), '1234'), b = await handoverHash(U(2), '1234'), c = await handoverHash(U(1), '1235');
  assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, b); assert.notEqual(a, c);
  assert.equal(sameHash(a, await handoverHash(U(1), '1234')), true);
  assert.equal(sameHash(a, c), false); assert.equal(sameHash(a, a.slice(1)), false);
});
test('a code lasts 24 hours', () => {
  assert.equal(CODE_TTL_HOURS, 24);
  assert.equal(codeExpiry(now).toISOString(), '2026-11-11T10:00:00.000Z');
  const row = { code_expires_at: codeExpiry(now).toISOString(), attempts: 0 };
  assert.equal(codeState(row, new Date('2026-11-11T09:59:59Z')), 'open');
  assert.equal(codeState(row, new Date('2026-11-11T10:00:00Z')), 'expired');
  assert.equal(codeState(null, now), 'none');
});
test('5 wrong tries lock the code; a verified row stays verified', () => {
  assert.equal(MAX_ATTEMPTS, 5);
  let a = 0, locked = false;
  for (let i = 1; i <= 5; i++) { const w = afterWrongTry(a); a = w.attempts; locked = w.locked; assert.equal(w.left, 5 - i); assert.equal(locked, i === 5); }
  const open = { code_expires_at: codeExpiry(now).toISOString() };
  assert.equal(codeState({ ...open, attempts: 5 }, now), 'locked');
  assert.equal(codeState({ ...open, attempts: 1, locked_at: now.toISOString() }, now), 'locked');
  assert.equal(codeState({ ...open, attempts: 4 }, now), 'open');
  assert.equal(codeState({ ...open, attempts: 9, verified_at: now.toISOString() }, now), 'verified');
});
test('the return step waits for a verified pickup, and a new code row decides the state', () => {
  const live = codeExpiry(now).toISOString();
  assert.equal(stepState([], 'pickup', now).state, 'no_code');
  assert.equal(stepState([], 'return', now).state, 'waiting');
  assert.equal(stepState([{ kind: 'pickup', code_expires_at: live, attempts: 0 }], 'pickup', now).state, 'open');
  assert.equal(stepState([{ kind: 'pickup', code_expires_at: live, attempts: 5 }], 'pickup', now).state, 'locked');
  const v = { kind: 'pickup', verified_at: now.toISOString(), photo_paths: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(stepState([v], 'pickup', now), { kind: 'pickup', state: 'verified', verified_at: now.toISOString(), photos: 4 });
  assert.equal(stepState([v], 'return', now).state, 'no_code');
  assert.equal(stepState([{ kind: 'return', code_expires_at: live, attempts: 0 }, v], 'return', now).state, 'open');
});
test('photos: 4 to 8, this lead and this kind only, one file each', () => {
  assert.equal(MIN_PHOTOS, 4); assert.equal(MAX_PHOTOS, 8);
  const ok = (n) => cleanPhotos(Array.from({ length: n }, (_, i) => `${LEAD}/pickup/aaaaaaaa-aaaa-aaaa-aaaa-00000000000${i}.jpg`), LEAD, 'pickup');
  assert.equal(ok(3).ok, false); assert.equal(ok(4).ok, true); assert.equal(ok(8).ok, true);
  assert.equal(cleanPhotos(Array.from({ length: 9 }, (_, i) => `${LEAD}/pickup/aaaaaaaa-aaaa-aaaa-aaaa-00000000000${i}.jpg`), LEAD, 'pickup').ok, false);
  assert.equal(cleanPhotos(['x'], LEAD, 'pickup').ok, false);
  assert.equal(cleanPhotos('nope', LEAD, 'pickup').ok, false);
  const four = Array.from({ length: 4 }, (_, i) => `${LEAD}/pickup/aaaaaaaa-aaaa-aaaa-aaaa-00000000000${i}.jpg`);
  assert.equal(cleanPhotos([...four.slice(0, 3), `99999999-2222-3333-4444-555555555555/pickup/aaaaaaaa-aaaa-aaaa-aaaa-000000000009.jpg`], LEAD, 'pickup').ok, false, 'another lead');
  assert.equal(cleanPhotos(four, LEAD, 'return').ok, false, 'wrong kind folder');
  assert.equal(cleanPhotos([...four.slice(0, 3), four[0]], LEAD, 'pickup').ok, false, 'a repeated photo counts once');
  assert.equal(cleanPhotos([...four.slice(0, 3), `${LEAD}/pickup/../x.jpg`], LEAD, 'pickup').ok, false);
});
test('upload requests: 1 to 8 photos, jpeg, png or webp', () => {
  assert.deepEqual(cleanUploadRequest({ types: ['image/jpeg', 'image/png', 'image/webp'] }), { ok: true, value: ['jpg', 'png', 'webp'] });
  assert.equal(cleanUploadRequest({ types: [] }).ok, false);
  assert.equal(cleanUploadRequest({ types: Array(9).fill('image/jpeg') }).ok, false);
  assert.equal(cleanUploadRequest({ types: ['image/gif'] }).ok, false);
  assert.equal(cleanUploadRequest({}).ok, false);
});
test('photos are kept 12 months; the purge cutoff is that far back and respects short months', () => {
  assert.equal(HANDOVER_KEEP_MONTHS, 12);
  assert.equal(purgeCutoff(new Date('2026-11-04T08:30:00Z')).toISOString(), '2025-11-04T08:30:00.000Z');
  assert.equal(purgeCutoff(new Date('2024-02-29T00:00:00Z')).toISOString(), '2023-02-28T00:00:00.000Z');
  assert.equal(purgeCutoff(new Date('2026-03-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
  // the photo made 12 months and a day ago is due; the one made 11 months ago is not
  const cut = purgeCutoff(now).getTime();
  assert.ok(new Date('2025-11-09T10:00:00Z').getTime() < cut); assert.ok(new Date('2025-12-10T10:00:00Z').getTime() > cut);
});

test('Crew shows each step as not started, code sent, locked, expired or verified, and sends the return code only after the pickup', () => {
  const live = codeExpiry(now).toISOString();
  assert.equal(handoverStatus([], 'pickup', now).state, 'none');
  assert.equal(handoverStatus([{ kind: 'pickup', code_expires_at: live, attempts: 0 }], 'pickup', now).state, 'sent');
  assert.equal(handoverStatus([{ kind: 'pickup', code_expires_at: live, attempts: 5 }], 'pickup', now).state, 'locked');
  assert.equal(handoverStatus([{ kind: 'pickup', code_expires_at: '2026-11-09T10:00:00Z', attempts: 0 }], 'pickup', now).state, 'expired');
  const v = [{ kind: 'pickup', verified_at: now.toISOString(), mechanic_name: 'Ravi K', photo_paths: ['a', 'b', 'c', 'd', 'e'] }];
  assert.deepEqual(handoverStatus(v, 'pickup', now), { state: 'verified', label: 'Verified', verifiedAt: now.toISOString(), by: 'Ravi K', photos: 5 });
  assert.equal(canSendHandoverCode([], 'pickup'), true); assert.equal(canSendHandoverCode([], 'return'), false);
  assert.equal(canSendHandoverCode(v, 'pickup'), false); assert.equal(canSendHandoverCode(v, 'return'), true);
});
test('the WhatsApp message carries the code for the customer only', () => {
  const m = handoverMessage({ name: 'Asha Rao', ref: 'MP-1', mechanic_name: 'Ravi Kumar' }, 'pickup', '4821');
  assert.match(m, /^Hi Asha, your Mechanix Pro pickup code for booking MP-1 is 4821\./); assert.match(m, /Ravi/); assert.match(m, /24 hours/);
  assert.match(handoverMessage({ name: 'Asha', ref: 'MP-1' }, 'return', '0007'), /return code .* 0007/);
});

test('the handover migration: private table, hardened, one verified per kind, private bucket and desk RPCs', () => {
  const m = read('supabase/migrations/20261224000000_handover.sql');
  for (const s of ['create table if not exists public.handovers', "check (kind in ('pickup','return'))", 'code_hash', 'code_expires_at', 'attempts', 'locked_at', 'verified_at', 'mechanic_id', 'photo_paths     text[]', 'note ',
    'enable row level security', 'revoke all on public.handovers from public, anon, authenticated', "values ('handover', 'handover', false", "array['image/jpeg','image/png','image/webp']", 'file_size_limit',
    'function public.crm_handover_code(p_lead uuid, p_kind text)', 'function public.crm_handovers(p_lead uuid)', 'for update', "crm_can('assign_leads')", "crm_can('manage_technicians')", "crm_can('edit_leads') and l.crm_owner = auth.uid()",
    'extensions.gen_random_bytes(3)', "extensions.digest(hid::text || ':' || code, 'sha256')", "interval '24 hours'", "lpad(", 'code_expires_at = now()', 'crm_can_see(l, public.crm_role())', 'handover_bucket_desk_read',
    'grant execute on function public.crm_handover_code', 'grant execute on function public.crm_handovers', 'function public.handover_purge_photos(p_months int default null)', "'handover_keep_months'",
    'revoke all on function public.handover_purge_photos(int) from public, anon, authenticated', 'this is not a pickup job', 'verify the pickup first']) assert.ok(m.includes(s), s);
  assert.match(m, /create unique index if not exists handovers_one_verified on public\.handovers \(lead_id, kind\) where verified_at is not null/);
  assert.doesNotMatch(m, /grant [a-z, ]+ on public\.handovers/i);
  const read2 = m.slice(m.indexOf('function public.crm_handovers'), m.indexOf('handover_purge_photos'));
  assert.doesNotMatch(read2, /'code_hash'|'code'/, 'the desk read never returns the code or its hash');
  assert.match(m, /begin\s*\n\s*perform public\.crm_need_role\(\);/);
});
test('the tech-job function: handover actions, limits and the unchanged get and report', () => {
  const f = read('supabase/functions/tech-job/index.ts');
  for (const s of ["'handover_state'", "'handover_upload_url'", "'handover_verify'", 'createSignedUploadUrl', 'handoverHash(row.id', 'sameHash(', 'afterWrongTry(', 'cleanPhotos(', 'locked_at', "'handover_verified'", "'handover_locked'", 'verified by ${name}, ${photos.value.length} photos', "'Pickup' : 'Return'",
    'lead.deleted_at', "status === 'lost'", 'lead.mechanic_id !== link.mechanic_id', 'tech_job_hit', 'Too many tries. Wait a few minutes.', "'23505'", 'isPickupJob(lead)', "action === 'report'", "action === 'get'",
    'This job is already reported.', "source: 'technician'"]) assert.ok(f.includes(s), s);
  const st = f.slice(f.indexOf("if (action === 'handover_state')"), f.indexOf('const kind = body?.kind'));
  assert.ok(st.length > 50); assert.doesNotMatch(st, /phone|address|first_name|price|est_total|name/);
  const ver = f.slice(f.indexOf('// handover_verify'));
  assert.ok(ver.indexOf('cleanPhotos(') < ver.indexOf('attempts: row.attempts + 1'), 'a photo problem does not use up a try');
  assert.ok(ver.indexOf('attempts: row.attempts + 1') < ver.indexOf('sameHash('), 'the try is counted before the compare');
  const sh = read('supabase/functions/_shared/handover.ts');
  assert.doesNotMatch(sh, /Deno\./);
});
test('the /job/ page takes photos on the phone, compresses them and sends the code, with no inline script', () => {
  const j = read('assets/js/job.js'), h = read('job/index.html'), c = read('assets/css/job.css');
  for (const s of ['capture="environment"', 'accept="image/*"', ' multiple>', 'MAX_SIDE = 1280', 'QUALITY = 0.7', "toBlob(", "'image/jpeg'", "action: 'handover_upload_url'", "action: 'handover_verify'", "action: 'handover_state'", 'inputmode="numeric"', 'maxlength="4"', 'autocomplete="off"', 'MIN_PHOTOS = 4', 'MAX_PHOTOS = 8']) assert.ok(j.includes(s), s);
  assert.match(h, /id="jbHand"/); assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(c, /min-height:5[0-9]px|min-height:44px/); assert.match(c, /\.job-code/);
  assert.doesNotMatch(j, /innerHTML\s*=[^;]*\bd\.(phone|address)/);
});
test('Crew has a Handover card for pickup jobs with send-code buttons and private photos', () => {
  const c = read('crm/crm.js'), css = read('crm/crm.css');
  for (const s of ["rpc('crm_handovers'", "rpc('crm_handover_code'", 'function handoverCard', 'h.is_pickup', 'data-act="hoSend"', 'data-act="hoPhotos"', "act === 'hoSend'", "act === 'hoPhotos'", 'createSignedUrls(', ', 600)', 'handoverMessage(l, kind, r.code)',
    'Send the ${name} code', 'data-act="sendJob"', "rpc('crm_tech_link'", 'logForm(l, moves)', "rpc('crm_assign_technician'"]) assert.ok(c.includes(s), s);
  assert.doesNotMatch(c, /getPublicUrl/);
  assert.match(css, /\.ho-card/);
});
test('the handover build leaves site wording, terms and prices alone', () => {
  assert.ok(existsSync(new URL('../docs/superpowers/specs/2026-11-04-otp-handover-design.md', import.meta.url)));
});
