import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photoPolicy, PHOTO_POLICY, cleanPhotos, allowedStages, doorState, canChooseOutcome, DOOR_KIND, isPickupJob, codeState, MIN_PHOTOS } from '../supabase/functions/_shared/handover.ts';
import { canStartWork, quoteCheck, quoteTotals } from '../crm/flow-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LEAD = '11111111-2222-3333-4444-555555555555', uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const photos = (k, n) => Array.from({ length: n }, (_, i) => `${LEAD}/${k}/${uuid(i + 1)}.jpg`);
const future = new Date(Date.now() + 3600e3).toISOString();

test('the door code is a third handover kind that every job uses, with the same hash and lock rules', () => {
  assert.equal(DOOR_KIND, 'start');
  assert.equal(doorState([]), 'none');
  assert.equal(doorState([{ kind: 'start', code_expires_at: future, attempts: 0 }]), 'open');
  assert.equal(doorState([{ kind: 'start', code_expires_at: future, attempts: 5 }]), 'locked');
  assert.equal(doorState([{ kind: 'start', code_expires_at: '2020-01-01T00:00:00Z', attempts: 0 }]), 'expired');
  assert.equal(doorState([{ kind: 'start', verified_at: '2026-11-06T05:00:00Z' }, { kind: 'start', code_expires_at: future }]), 'verified');
  assert.equal(codeState({ attempts: 5, code_expires_at: future }), 'locked');   // 5 wrong tries, unchanged
});
test('repair at the door and pick-up open only after the code is verified', () => {
  assert.equal(canChooseOutcome([]), false);
  assert.equal(canChooseOutcome([{ kind: 'start', code_expires_at: future }]), false);
  assert.equal(canChooseOutcome([{ kind: 'pickup', verified_at: 'x' }]), false);   // a pickup row is not the door code
  assert.equal(canChooseOutcome([{ kind: 'start', verified_at: '2026-11-06T05:00:00Z' }]), true);
  assert.deepEqual(allowedStages(null), ['on_the_way', 'arrived']); assert.deepEqual(allowedStages('on_the_way'), ['arrived']);
  assert.deepEqual(allowedStages('arrived'), []);   // the next step is the code, not a button
  assert.deepEqual(allowedStages('started'), ['repair_doorstep', 'picked_up']); assert.deepEqual(allowedStages('repair_doorstep'), []); assert.deepEqual(allowedStages('picked_up'), ['ready']);
});
test('the pickup photo list suits the vehicle: bikes keep the existing 4, cars need 4 sides plus the odometer and the dashboard', () => {
  assert.equal(photoPolicy('bike').min, MIN_PHOTOS); assert.equal(MIN_PHOTOS, 4); assert.deepEqual(photoPolicy('bike').labels, ['front', 'back', 'left', 'right']);
  assert.equal(photoPolicy('car').min, 6); assert.deepEqual(photoPolicy('car').labels, ['front', 'back', 'left', 'right', 'odometer', 'dashboard']); assert.equal(photoPolicy(undefined).min, 4);
  assert.equal(cleanPhotos(photos('pickup', 4), LEAD, 'pickup').ok, true);   // the old call still works
  const b = photoPolicy('bike'), c = photoPolicy('car');
  assert.equal(cleanPhotos(photos('pickup', 4), LEAD, 'pickup', b.min, b.hint).ok, true);
  const short = cleanPhotos(photos('pickup', 4), LEAD, 'pickup', c.min, c.hint); assert.equal(short.ok, false); assert.match(short.error, /at least 6 photos: front, back, left, right, the odometer and the dashboard/);
  assert.equal(cleanPhotos(photos('pickup', 6), LEAD, 'pickup', c.min, c.hint).ok, true);
  assert.equal(PHOTO_POLICY.car.labels.length, PHOTO_POLICY.car.min);
});
test('a pickup is still a pickup job only when the bike goes to a garage; the outcome at the door decides it', () => {
  assert.equal(isPickupJob({ job_place: 'garage' }), true); assert.equal(isPickupJob({ job_place: 'doorstep', place: 'home' }), false);
  const f = read('supabase/functions/tech-job/index.ts');
  assert.match(f, /await db\.from\('leads'\)\.update\(\{ job_place: 'garage' \}\)/);   // choosing pick-up sets it
  assert.match(f, /\{ job_place: 'doorstep' \}/);
});
test('the mechanic cannot start work or pick up before the quote is approved (function and database both enforce it)', () => {
  assert.equal(canStartWork('approved'), true);
  for (const st of [null, undefined, 'draft', 'sent', 'declined', 'superseded']) assert.equal(canStartWork(st), false, String(st));
  const f = read('supabase/functions/tech-job/index.ts');
  assert.match(f, /if \(lead\.confirm_fee != null && !approved\)[\s\S]{0,400}Start work is blocked[\s\S]{0,200}blocked: 'quote'/);
  assert.match(f, /status !== 'approved'\) return json\(req, \{ error: 'The customer has not approved the quote yet/);   // pickup photos step
  assert.match(f, /action === 'visit_outcome'/); assert.match(f, /doorOk|canChooseOutcome/);
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(sql, /create trigger leads_d_quote_gate_tr before update of visit_stage on public\.leads/); assert.match(sql, /latest is distinct from 'approved'/);
  assert.match(read('assets/js/job.js'), /Start work is blocked until the customer approves the quote/);
});
test('a revised quote needs a new approval: sending it supersedes the old one', () => {
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(sql, /update public\.job_quotes set status = 'superseded' where lead_id = p_lead and status in \('sent','approved'\) and id <> q\.id/);
  assert.match(sql, /order by q\.version desc limit 1;\s+if latest is distinct from 'approved'/);
});
test('the delivery estimate is required before a quote can be sent', () => {
  const lines = [{ kind: 'parts', name: 'Brake pad set', amount: '400' }];
  assert.equal(quoteCheck(lines, null).ok, false); assert.match(quoteCheck(lines, {}).error, /estimated delivery/i);
  assert.equal(quoteCheck(lines, { kind: 'hours', hours: 0 }).ok, false); assert.equal(quoteCheck(lines, { kind: 'hours', hours: 73 }).ok, false); assert.equal(quoteCheck(lines, { kind: 'hours', hours: 3 }).ok, true);
  const today = new Date('2026-11-05T05:00:00Z');
  assert.equal(quoteCheck(lines, { kind: 'date', date: '' }, today).ok, false); assert.equal(quoteCheck(lines, { kind: 'date', date: '2026-11-04' }, today).ok, false);
  assert.equal(quoteCheck(lines, { kind: 'date', date: '2026-11-08', window: 'afternoon' }, today).ok, true); assert.equal(quoteCheck(lines, { kind: 'date', date: '2027-03-01' }, today).ok, false);
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql'); assert.match(sql, /set the estimated delivery before sending the quote/); assert.match(sql, /if q\.eta_text is null or q\.eta_kind is null then raise/);
});
test('quote lines are checked: parts, labour or other, named, 0 to 1,00,000, no ID numbers; totals add GST apart and credit the fee', () => {
  const ok = { kind: 'parts', name: 'Pad', amount: 1 }, eta = { kind: 'hours', hours: 2 };
  assert.equal(quoteCheck([], eta).ok, false); assert.equal(quoteCheck(Array(21).fill(ok), eta).ok, false);
  assert.equal(quoteCheck([{ ...ok, kind: 'gift' }], eta).ok, false); assert.equal(quoteCheck([{ ...ok, name: 'x' }], eta).ok, false); assert.equal(quoteCheck([{ ...ok, amount: -1 }], eta).ok, false); assert.equal(quoteCheck([{ ...ok, amount: 100001 }], eta).ok, false); assert.equal(quoteCheck([{ ...ok, amount: '' }], eta).ok, false);
  assert.equal(quoteCheck([{ ...ok, name: 'ABCDE1234F' }], eta).ok, false);
  assert.deepEqual(quoteTotals([{ amount: 400 }, { amount: 150 }], 49), { subtotal: 550, gst: 99, total: 649, feeCredit: 49, balance: 600 });
  assert.deepEqual(quoteTotals([{ amount: 20 }], 99), { subtotal: 20, gst: 3.6, total: 23.6, feeCredit: 23.6, balance: 0 });   // the credit never goes above the bill
});
test('Crew can record a phone approval and it is audited with the name of who recorded it', () => {
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(sql, /'Quote v' \|\| q\.version \|\| ' approved by phone, recorded by ' \|\| who/); assert.match(sql, /'quote_approved_phone'[\s\S]{0,120}'recorded_by', auth\.uid\(\)/); assert.match(sql, /decided_via = 'phone'/);
  assert.match(read('crm/flow-core.js'), /Your name goes on the record/);
});
test('the /job/ page walks the visit: on the way, arrived, code, then repair or pick-up, ready, delivered; cars get the car photo list', () => {
  const js = read('assets/js/job.js'), html = read('job/index.html'), f = read('supabase/functions/tech-job/index.ts');
  for (const w of ['visit_state', 'visit_status', 'visit_start', 'visit_outcome', 'visit_ready', 'visit_deliver']) { assert.ok(js.includes(w), 'job.js ' + w); assert.ok(f.includes(w), 'tech-job ' + w); }
  assert.match(html, /id="jbVisit"/); assert.match(js, /d\.photos\) \{ MIN_PHOTOS = d\.photos\.min; HINT = d\.photos\.hint/); assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]/);
  assert.match(f, /A pickup job is delivered with the return code and photos/);   // the existing return OTP is kept
  assert.match(f, /eq\('attempts', row\.attempts\)/);   // the try is counted before comparing, as in the pickup code
  assert.doesNotMatch(f.slice(f.indexOf('async function visit')), /amount|price|total/i);   // no prices on the mechanic's screen
});
