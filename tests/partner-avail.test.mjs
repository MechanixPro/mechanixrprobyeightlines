import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { selfieFresh, checkSelfie, selfiePath, selfiePathOk, SELFIE_WINDOW_MS, TERMS_VERSION } from '../supabase/functions/_shared/partner-avail.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = createRequire(import.meta.url)('../assets/js/partner-flow.js');
const NOW = Date.parse('2026-11-09T06:00:00Z'), H = 3600e3;

test('24-hour rule: fresh under 24 h, stale from 24 h, missing or junk is not fresh', () => {
  assert.equal(SELFIE_WINDOW_MS, 24 * H);
  for (const fn of [selfieFresh, F.selfieFresh]) {
    assert.equal(fn(new Date(NOW - 1 * H).toISOString(), NOW), true);
    assert.equal(fn(new Date(NOW - 23.99 * H).toISOString(), NOW), true);
    assert.equal(fn(new Date(NOW - 24 * H).toISOString(), NOW), false);
    assert.equal(fn(new Date(NOW - 30 * H).toISOString(), NOW), false);
    assert.equal(fn(new Date(NOW + 2 * H).toISOString(), NOW), false);
    assert.equal(fn(null, NOW), false); assert.equal(fn('junk', NOW), false);
  }
});
test('selfie upload check: jpeg/png/webp, 5 MB at most', () => {
  assert.equal(checkSelfie('image/jpeg', 1000).ext, 'jpg'); assert.equal(checkSelfie('image/webp', 5 * 1024 * 1024).ok, true);
  assert.equal(checkSelfie('image/gif', 1000).ok, false); assert.equal(checkSelfie('image/png', 5 * 1024 * 1024 + 1).ok, false); assert.equal(checkSelfie('image/png', 0).ok, false);
  assert.equal(F.selfieOk('image/png', 10), true); assert.equal(F.selfieOk('application/pdf', 10), false);
});
test('selfie path is prefixed with the partner and cannot be another partner\'s', () => {
  const id = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222', u = '33333333-3333-3333-3333-333333333333';
  const p = selfiePath('garage', id, u, 'jpg');
  assert.equal(selfiePathOk(p, 'garage', id), true); assert.equal(selfiePathOk(p, 'garage', other), false); assert.equal(selfiePathOk(p, 'mechanic', id), false); assert.equal(selfiePathOk('garage/' + id + '/../x.jpg', 'garage', id), false);
});
test('gate: terms first, then tour once; accepted version never shows again', () => {
  const me = (accepted, tour_done) => ({ terms: { version: 'v1', accepted, tour_done } });
  assert.equal(F.nextGate(me(false, false), false), 'terms'); assert.equal(F.nextGate(me(true, false), false), 'tour');
  assert.equal(F.nextGate(me(true, false), true), ''); assert.equal(F.nextGate(me(true, true), false), ''); assert.equal(F.nextGate({}, false), '');
  assert.equal(F.TOUR.length, 4); assert.deepEqual(F.TOUR.map((t) => t[1]), ['Accept the job', 'Go and call', 'Code and quote', 'Photos and payment']);
});
test('selfie line shows the time in IST, and asks when stale', () => {
  assert.equal(F.selfieLine('2026-11-09T03:42:00Z', NOW), 'Selfie taken 09:12'); assert.match(F.selfieLine('2026-11-01T03:42:00Z', NOW), /needed/);
});
test('tour memory is guarded: a throwing localStorage never breaks it', () => {
  const bad = { localStorage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } };
  assert.equal(F.tourSeen(bad, 'garage', 'v1'), false); F.tourMark(bad, 'garage', 'v1');
  const mem = {}; const ok = { localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } } };
  assert.equal(F.tourSeen(ok, 'garage', 'v1'), false); F.tourMark(ok, 'garage', 'v1'); assert.equal(F.tourSeen(ok, 'garage', 'v1'), true); assert.equal(F.tourSeen(ok, 'garage', 'v2'), false);
});
test('migration: private selfies bucket, RLS with no policies, terms keyed by version, service-role only', () => {
  const m = read('supabase/migrations/20270119000000_partner_avail.sql');
  assert.match(m, /values \('selfies', 'selfies', false/); assert.doesNotMatch(m, /create policy/i);
  assert.match(m, /partner_selfies[\s\S]*taken_at timestamptz not null default now\(\)/); assert.match(m, /alter table public\.partner_selfies enable row level security/); assert.match(m, /alter table public\.partner_terms enable row level security/);
  assert.match(m, /primary key \(partner_kind, partner_id, version\)/); assert.match(m, /grant execute[\s\S]*to service_role/); assert.doesNotMatch(m, /grant [^;]*to (anon|authenticated|public)\b/);
  assert.equal(TERMS_VERSION, 'v1');
});
test('server: Available needs a selfie under 24 h in both apps; Not available needs none', () => {
  const g = read('supabase/functions/garage-app/index.ts'), mh = read('supabase/functions/_shared/mechanic-handler.ts');
  assert.match(g, /b\.open === true && !selfieFresh\(await selfieAt\(\)\)[\s\S]{0,120}409[\s\S]{0,200}garage_open_set/);
  assert.match(mh, /status === 'available' && !selfieFresh\(await selfieAt\(\), now\(\)\)[\s\S]{0,120}409[\s\S]{0,200}mechanic_status_set/);
  for (const t of [g, mh]) { assert.match(t, /from\('selfies'\)\.createSignedUploadUrl/); assert.match(t, /checkSelfie\(b\?\.content_type, b\?\.size\)/); assert.match(t, /selfiePathOk\(b\?\.path/); assert.match(t, /partner_terms_accept/); assert.match(t, /TERMS_VERSION/); assert.doesNotMatch(t, /getPublicUrl/); }
});
test('front end: selfie camera input, data URL preview, upload before Available, terms and tour once, ds look', () => {
  const f = read('assets/js/partner-flow.js'), css = read('assets/css/garage.css');
  assert.match(f, /accept: 'image\/\*', capture: 'user'/); assert.match(f, /readAsDataURL/); assert.match(f, /Use this photo/); assert.match(f, /I agree/); assert.match(f, /id: 'pfSkip'/); assert.match(f, /tourMark\(win, o\.kind, o\.version\)/); assert.match(f, /terms_accept', \{ tour: true/);
  for (const a of ['assets/js/garage.js', 'assets/js/mechanic.js']) { const j = read(a); assert.match(j, /showSelfie[\s\S]{0,300}setOpen|showSelfie[\s\S]{0,300}setStatus/); assert.match(j, /runGate/); assert.match(j, /api\('me'\)/); }
  for (const h of ['garage/index.html', 'mechanic/index.html']) assert.match(read(h), /partner-flow\.js/);
  assert.match(css, /\.pf-btn\{min-height:56px/); assert.doesNotMatch(f, /innerHTML|eval\(|onclick=/);
});
