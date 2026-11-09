import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signSession, verifySession, garageJobListItem, garageJobDetail, garageStatement, cleanUpload, cleanEstimate, photoPath, photoPathOk, scrubText, firstName, estimateView, partnerGarageLine, teamGarageMessage, CONTACT_MODE, isOpen, NEXT_EVENT, safeEqual } from '../supabase/functions/_shared/garage.ts';
import { trackView } from '../supabase/functions/_shared/track.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SECRET = 'test-secret-0123456789abcdef';
const PHONE = '9876543210', ADDRESS = '42 Secret Lane, Test Nagar', EMAIL = 'private.person@example.invalid';
const ID = '11111111-1111-1111-1111-111111111111', GID = '22222222-2222-2222-2222-222222222222', UUID = '33333333-3333-3333-3333-333333333333';

/** A lead with the customer's phone, address and email in EVERY text field a careless query could return. */
const leak = (extra = {}) => {
  const all = `${PHONE} ${ADDRESS} ${EMAIL}`;
  return { id: ID, name: 'Asha Rao', phone: PHONE, email: EMAIL, address: ADDRESS, area: ADDRESS, pincode: '560102', landmark: ADDRESS, notes: all, lat: 12.9, lng: 77.6, booking_id: 'MP-26-27-0001', vehicle: 'bike', alt_phone: '9000000000',
    customer_email: EMAIL, whatsapp: PHONE, access_note: ADDRESS, ...extra };
};
const rawJob = (status = 'received', lead = leak()) => ({
  assignment: { id: UUID, status, eta: '2026-11-09T10:00:00Z', notes: `Brake pads worn. Call ${PHONE} or write ${EMAIL}`, assigned_at: '2026-11-07T04:00:00Z', lead_id: ID },
  lead, service: 'Bike service', vehicle: { brand: 'Honda', model: 'Activa', reg_no: 'ka01ab1234' }, issue: `Noise. Reach me on +91 ${PHONE}, ${EMAIL}`,
  pickup: { note: `Left mirror scratched, mirror and tank`, photos: ['https://example.invalid/signed/1'] },
  progress: [{ event: 'received', at: '2026-11-07T05:00:00Z', note: `call ${PHONE}`, photos: ['https://example.invalid/signed/2'] }],
  estimates: [{ id: 'e1', status: 'rejected', lines: [{ kind: 'parts', name: 'Pads', amount: 800 }], notes: `ring ${PHONE}`, hours: 5, review_note: `Too high, ${EMAIL}` }], quote: { status: 'sent' } });

test('the job list never holds a phone, address or email, whatever the lead row carries', () => {
  for (const s of ['sent', 'received', 'in_work', 'ready', 'returned']) {
    const out = JSON.stringify(garageJobListItem(rawJob(s)));
    for (const bad of [PHONE, ADDRESS, EMAIL, 'Secret Lane', 'Test Nagar', 'private.person', '560102', 'Asha Rao', '9000000000']) assert.ok(!out.includes(bad), `list leaked ${bad} at ${s}`);
    assert.ok(out.includes('"customer_first_name":"Asha"'));
  }
});
// 2026-11-09 owner decision: the garage must see where to go. The old rule "the address never reaches this app" is replaced by: address, area, pincode and pin only for an OPEN job's detail; never email; never in lists.
test('the job detail holds the address only for an open job, never the email, and the phone ONLY for an open job with contact allowed', () => {
  for (const s of ['sent', 'received', 'in_work', 'ready']) {
    const raw = rawJob(s); raw.place = { address: 'Flat 4, Secret Lane', area: 'Test Nagar', pincode: '560102', lat: 12.9, lng: 77.6 };
    const d = garageJobDetail(raw, true), out = JSON.stringify(d);
    for (const bad of [EMAIL, 'private.person', 'Asha Rao']) assert.ok(!out.includes(bad), `detail leaked ${bad} at ${s}`);
    assert.deepEqual(d.place, { address: 'Flat 4, Secret Lane', area: 'Test Nagar', pincode: '560102', lat: 12.9, lng: 77.6 });
    assert.equal(out.split(PHONE).length - 1, 1, 'the number appears exactly once (customer_phone), not in any note');
    assert.equal(d.customer_phone, PHONE);
  }
  for (const s of ['returned', 'cancelled']) { const raw = rawJob(s); raw.place = { address: 'Flat 4', area: 'X', pincode: '560102', lat: 12.9, lng: 77.6 }; const d = garageJobDetail(raw, true); assert.equal(d.customer_phone, undefined); assert.equal(d.place, undefined, 'no address once the job is closed'); }
  assert.equal(garageJobDetail(rawJob('received'), true).place, undefined, 'the lead row alone never yields an address: only the place the function fetched for an open job');
  assert.ok(!JSON.stringify(garageJobDetail(rawJob('received'), false)).includes(PHONE), 'no number unless contact was allowed');
  assert.ok(!JSON.stringify(garageJobDetail(rawJob('received'), false)).includes(ADDRESS), 'the whole lead row is never passed through');
  const noPin = garageJobDetail({ ...rawJob('received'), place: { address: 'A', area: null, pincode: 'x', lat: 99, lng: 77 } }, false).place; assert.deepEqual(noPin, { address: 'A', area: null, pincode: null, lat: null, lng: null });
});
test('the whitelist: unknown fields on the lead, assignment or vehicle are never passed through (fuzz)', () => {
  const rnd = () => Math.random().toString(36).slice(2);
  for (let i = 0; i < 200; i++) {
    const marks = {}; const lead = leak(), raw = rawJob(['sent', 'received', 'in_work', 'ready', 'returned'][i % 5], lead);
    for (const o of [lead, raw.assignment, raw.vehicle]) for (let k = 0; k < 4; k++) { const key = 'f_' + rnd(), val = 'SENTINEL_' + rnd(); o[key] = val; marks[val] = 1; }
    lead.phone = `+91 ${PHONE.slice(0, 5)}-${PHONE.slice(5)}`;
    const outs = [JSON.stringify(garageJobListItem(raw)), JSON.stringify(garageJobDetail(raw, i % 2 === 0))];
    for (const o of outs) { for (const m of Object.keys(marks)) assert.ok(!o.includes(m), 'unlisted field leaked'); assert.ok(!o.includes(ADDRESS) && !o.includes(EMAIL)); }
    assert.ok(!outs[0].includes(PHONE));
  }
});
test('free text from customers and staff has numbers and emails removed', () => {
  assert.equal(scrubText('call 98765 43210 now'), 'call [number removed] now');
  assert.equal(scrubText('mail a.b@x.invalid please'), 'mail [email removed] please');
  assert.equal(scrubText('<b>hi</b>'), 'b hi /b');
  assert.equal(firstName('9876543210'), 'Customer'); assert.equal(firstName('a@b.co Rao'), 'Customer'); assert.equal(firstName('  Asha   Rao '), 'Asha');
});
test('the detail shows vehicle, work, findings, pickup, timeline, estimate and the plain quote message', () => {
  const d = garageJobDetail(rawJob('received'), true);
  assert.equal(d.vehicle, 'Honda Activa'); assert.equal(d.reg_no, 'KA01AB1234'); assert.equal(d.work, 'Bike service');
  assert.ok(d.found.startsWith('Brake pads worn')); assert.equal(d.pickup.photos.length, 1); assert.equal(d.timeline.length, 2);
  assert.equal(d.quote.status, 'sent'); assert.equal(d.can_start, false); assert.match(d.start_blocked_reason, /not approved the quote yet/);
  assert.equal(garageJobDetail({ ...rawJob('received'), quote: { status: 'approved' } }, true).can_start, true);
  assert.deepEqual(d.next, { event: 'work_started', label: 'Work started' });
  assert.equal(d.estimates[0].review_note, 'Too high, [email removed]'); assert.equal(d.estimates[0].gst, 144);
  assert.equal(d.can_estimate, true); assert.equal(garageJobDetail(rawJob('sent'), true).can_estimate, false);
});
test('contact mode: direct today; flipping the one constant is the only switch for masked calling later', () => {
  assert.equal(CONTACT_MODE, 'direct');
  const src = read('supabase/functions/_shared/garage.ts');
  assert.equal((src.match(/CONTACT_MODE/g) || []).length, 2, "declared once, used once");
  assert.ok(!/agentive/i.test(src + read('supabase/functions/garage-app/index.ts') + read('supabase/migrations/20270101000000_garage_app.sql')), 'no masked-call code ships');
});
test('sessions: signed, 12 hours, tamper-proof', async () => {
  const now = Date.now(), s = await signSession(SECRET, { access: ID, garage: GID, version: 3 }, now);
  assert.deepEqual(await verifySession(SECRET, s.token, now + 11 * 3600e3), { a: ID, g: GID, v: 3, exp: Math.floor(now / 1000) + 43200 });
  assert.equal(await verifySession(SECRET, s.token, now + 12 * 3600e3 + 1000), null, 'expired after 12 hours');
  assert.equal(await verifySession('another-secret-0123456789', s.token, now), null);
  const [body, sig] = s.token.split('.');
  assert.equal(await verifySession(SECRET, body + '.' + sig.slice(0, -2) + 'AA', now), null);
  const forged = Buffer.from(JSON.stringify({ a: ID, g: 'other', v: 3, exp: 9999999999 })).toString('base64url');
  assert.equal(await verifySession(SECRET, forged + '.' + sig, now), null, 'a changed payload fails');
  for (const bad of [null, '', 'x', 'a.b', '.', 'a'.repeat(700)]) assert.equal(await verifySession(SECRET, bad, now), null);
  await assert.rejects(signSession('short', { access: ID, garage: GID, version: 1 }));
  assert.equal(safeEqual('abc', 'abc'), true); assert.equal(safeEqual('abc', 'abd'), false); assert.equal(safeEqual('abc', 'ab'), false);
});
test('estimates: lines, amounts, hours or a day, never both; totals show GST apart', () => {
  const ok = cleanEstimate({ lines: [{ kind: 'parts', name: 'Pads', amount: '850', part_type: 'genuine' }, { kind: 'labour', name: 'Fit', amount: 400 }], hours: '6', notes: 'x' });
  assert.equal(ok.ok, true); assert.equal(ok.value.hours, 6); assert.equal(ok.value.lines[0].amount, 850);
  for (const b of [{ lines: [] }, { lines: [{ kind: 'gold', name: 'xx', amount: 1 }] }, { lines: [{ kind: 'parts', name: 'x', amount: 1 }] }, { lines: [{ kind: 'parts', name: 'xx', amount: -1 }] },
    { lines: [{ kind: 'parts', name: 'xx', amount: 100001 }] }, { lines: [{ kind: 'parts', name: 'xx', amount: 1 }], hours: 99 }, { lines: [{ kind: 'parts', name: 'xx', amount: 1 }], hours: 2, day: '2026-11-09' },
    { lines: Array(21).fill({ kind: 'parts', name: 'xx', amount: 1 }) }]) assert.equal(cleanEstimate(b).ok, false);
  const v = estimateView({ id: 'e', status: 'submitted', lines: [{ kind: 'parts', name: 'A', amount: 1250 }] });
  assert.deepEqual([v.subtotal, v.gst, v.total], [1250, 225, 1475]);
});
test('photos: JPEG, PNG, WebP only, at most 4, only under this garage and job', () => {
  assert.deepEqual(cleanUpload({ types: ['image/jpeg', 'image/webp'] }).value, ['jpg', 'webp']);
  for (const t of [[], ['image/gif'], ['application/pdf'], Array(5).fill('image/png')]) assert.equal(cleanUpload({ types: t }).ok, false);
  const p = photoPath(GID, UUID, '44444444-4444-4444-4444-444444444444', 'jpg');
  assert.equal(photoPathOk(p, GID, UUID), true); assert.equal(photoPathOk(p, 'x'.repeat(36), UUID), false); assert.equal(photoPathOk(p.replace('.jpg', '.exe'), GID, UUID), false); assert.equal(photoPathOk('../' + p, GID, UUID), false);
});
test('statement: amounts come from Admin; no rate is computed; missing amounts say so', () => {
  const s = garageStatement([
    { assignment: { id: 'a', returned_at: '2026-11-08' }, lead: leak(), vehicle: { brand: 'Honda', model: 'Activa' }, settlement: { amount: '1500.00', settled: true, settled_at: '2026-11-09', note: `paid ${PHONE}` } },
    { assignment: { id: 'b', ready_at: '2026-11-08' }, lead: leak(), vehicle: null, settlement: { amount: 900, settled: false } },
    { assignment: { id: 'c' }, lead: leak(), vehicle: null, settlement: null }]);
  assert.deepEqual(s.items.map((i) => i.status), ['settled', 'pending', 'amount_not_entered']);
  assert.equal(s.settled, 1500); assert.equal(s.pending, 900); assert.equal(s.items[2].amount, null);
  assert.ok(!JSON.stringify(s).includes(PHONE) && !JSON.stringify(s).includes(EMAIL));
});
test('customer tracking: a plain partner-garage line, never a garage name, address or number', () => {
  assert.equal(partnerGarageLine('in_work').line, 'Your vehicle is at a partner garage'); assert.equal(partnerGarageLine('returned'), null); assert.equal(partnerGarageLine(null), null);
  const t = trackView({ status: 'paid', confirm_fee: 49, confirm_paid_at: 'x', visit_stage: 'picked_up', job_place: 'garage' }, { garage: 'ready', vehicle: 'bike' });
  assert.equal(t.partner_garage.line, 'Your vehicle is at a partner garage'); assert.match(t.partner_garage.detail, /ready/);
  assert.equal(trackView({ status: 'paid' }, {}).partner_garage, null);
  assert.ok(!/garage name|address/i.test(read('supabase/functions/track-booking/index.ts').match(/garage_assignments[^\n]*/)[0].replace(/never the garage's name/, '')));
});
test('team alerts name the garage and the booking, never the customer', () => {
  const m = teamGarageMessage('estimate', { bookingId: 'MP-1', vehicle: 'bike', garageName: 'Test Garage', total: 1475, deskUrl: 'https://crew.example.invalid/crm/' });
  assert.match(m.text, /Test Garage sent a repair estimate of Rs 1475 incl. GST/); assert.match(teamGarageMessage('ready', { vehicle: 'car', garageName: 'G', deskUrl: 'x' }).text, /ready for return/);
  assert.match(read('supabase/functions/_shared/notify.ts'), /'team_garage_estimate', 'team_garage_ready'/);
});
test('the Edge Function: login limits, session check on every call, whitelist only, no address or email selected, no secrets in code', () => {
  const f = read('supabase/functions/garage-app/index.ts');
  assert.match(f, /garage_login_try/); assert.match(f, /perIp \?\? 0\) >= 20/); assert.match(f, /perLink \?\? 0\) >= 15/); assert.match(f, /garage_session_check/); assert.match(f, /verifySession/);
  assert.match(f, /GARAGE_SESSION_SECRET/); assert.match(f, /503/);
  // 2026-11-09: the address is selected in exactly one place, inside the open-assignment block of 'job'; email and landmark never.
  assert.ok(!/select\('[^']*\b(email|landmark)\b/.test(f), 'no query selects email');
  assert.deepEqual(f.match(/select\('[^']*\baddress\b[^']*'\)/g), ["select('address,area,pincode,lat,lng')"]);
  assert.ok(f.indexOf("select('address,area,pincode,lat,lng')") > f.indexOf('if (isOpen(a.status))'), 'only inside the open-job block');
  const phoneSelects = f.match(/select\('[^']*\bphone\b[^']*'\)/g) || []; assert.deepEqual(phoneSelects, ["select('phone')"], 'the phone is selected in exactly one place');
  assert.ok(f.indexOf('garage_contact_view') < f.indexOf("select('phone')"), 'the view is logged before the number is read');
  assert.match(f, /\.eq\('garage_id', garageId\)/); assert.match(f, /photoPathOk/); assert.match(f, /createSignedUploadUrl/); assert.match(f, /createSignedUrl\(p, 600\)/);
  assert.match(f, /notifyTeamGarage\(db, r\.lead_id, 'ready'/); assert.match(f, /notifyTeamGarage\(db, r\.lead_id, 'estimate'/);
  assert.ok(!/eyJ|sk_live|service_role/.test(f.replace(/SUPABASE_SERVICE_ROLE_KEY/g, '')), 'no keys in code');
  assert.ok(!/console\.(log|error)\([^)]*(phone|pin|token)/i.test(f.replace(/'garage-app', fn/g, '')), 'nothing sensitive is logged');
});
test('the migration: closed tables, hashed secrets, explicit grants, gate reuse, one open assignment, rollback notes', () => {
  const m = read('supabase/migrations/20270101000000_garage_app.sql');
  assert.match(m, /Roll back/); assert.match(m, /enable row level security/); assert.match(m, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(m, /link_hash\s+text not null unique/); assert.match(m, /crypt\(p_pin, extensions\.gen_salt\('bf', 8\)\)/); assert.match(m, /garage_assignments_one_open/);
  assert.match(m, /quote_is_approved\(l\.id\)/); assert.match(m, /crm_quote_save\(l\.id, e\.lines, eta\)/);
  for (const fn of ['garage_login(text, text)', 'garage_session_check(uuid, int)', 'garage_progress_set(uuid, uuid, text, text[], text)', 'garage_estimate_save(uuid, uuid, jsonb, text, int, date, boolean)', 'garage_contact_view(uuid, uuid)'])
    assert.match(m, new RegExp(`revoke all on function public\\.${fn.replace(/[()[\]]/g, '\\$&')} from public, anon, authenticated;\\ngrant execute on function public\\.${fn.replace(/[()[\]]/g, '\\$&')} to service_role;`), fn);
  for (const fn of ['crm_garage_access_create', 'crm_garage_pin_reset', 'crm_garage_revoke', 'crm_garage_enable', 'crm_garage_assign', 'crm_garage_assignments_list', 'crm_garage_estimates_inbox', 'crm_garage_estimate_review', 'crm_garage_settlement_set']) assert.match(m, new RegExp(fn));
  assert.ok(!/garage_calls|garage_calls_enabled|AGENTIVE/i.test(m));
});
