import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversineKm, etaMinutes, etaLine, navigateUrl, mapsPointUrl, AVG_KMPH, DETOUR } from '../supabase/functions/_shared/eta.ts';
import { cleanDetails, cleanIssue, cleanPhotoRequest, photoPathOk } from '../supabase/functions/_shared/booking-update.ts';
import { journeyView } from '../supabase/functions/_shared/track.ts';
import { teamIssueMessage, KINDS } from '../supabase/functions/_shared/notify.ts';
import { mechanicOnTheWay } from '../supabase/functions/_shared/email-templates.ts';
import { cleanRatingBody } from '../supabase/functions/_shared/rating.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const site = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 00000 00000', phoneTel: '+910000000000', whatsappUrl: 'https://wa.me/910000000000', email: 'hello@example.invalid' };

test('haversine: HSR to Indiranagar is about 8 km in a straight line; same point is 0', () => {
  const hsr = { lat: 12.9116, lng: 77.6389 }, indira = { lat: 12.9719, lng: 77.6412 };
  assert.ok(Math.abs(haversineKm(hsr, indira) - 6.7) < 0.4); assert.equal(haversineKm(hsr, hsr), 0);
});
test('ETA: detour factor, average speed, rounded up to 5 minutes, never an exact promise', () => {
  const e = etaMinutes({ lat: 12.9116, lng: 77.6389 }, { lat: 12.9719, lng: 77.6412 });
  assert.ok(e && e.minutes % 5 === 0 && e.minutes >= 5);
  assert.equal(e.minutes, Math.max(5, Math.ceil((haversineKm({ lat: 12.9116, lng: 77.6389 }, { lat: 12.9719, lng: 77.6412 }) * DETOUR / AVG_KMPH * 60) / 5) * 5));
  assert.match(etaLine(e), /^about \d+ min away \(estimate\)$/);
  assert.equal(etaMinutes(null, { lat: 1, lng: 2 }), null); assert.equal(etaMinutes({ lat: 12, lng: 77 }, { lat: null, lng: null }), null); assert.equal(etaLine(null), null);
  assert.match(etaLine({ km: 0.1, minutes: 5 }), /very close \(estimate\)/);
  assert.equal(etaMinutes({ lat: 'x', lng: 77 }, { lat: 12, lng: 77 }), null);
});
test('Navigate link: pin first, address as a fallback, two-wheeler for bikes and driving for cars', () => {
  assert.equal(navigateUrl({ lat: 12.9116, lng: 77.6389, vehicle: 'bike' }), 'https://www.google.com/maps/dir/?api=1&destination=12.911600,77.638900&travelmode=two_wheeler');
  assert.match(navigateUrl({ lat: 12.9, lng: 77.6, vehicle: 'car' }), /travelmode=driving$/);
  assert.match(navigateUrl({ address: '12, 3rd Cross, HSR Layout, 560102', vehicle: 'bike' }), /destination=12%2C%203rd%20Cross/);
  assert.equal(navigateUrl({ vehicle: 'bike' }), null);
  assert.match(mapsPointUrl(12.9, 77.6), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=12\.900000,77\.600000$/);
});
test('customer details: only sent keys, cleaned, limited; a bad registration or kilometres is refused with its field', () => {
  const ok = cleanDetails({ landmark: '  Near <b>temple</b>\n', reg_no: 'ka 01 ab 1234', kms: '18,500', issue_text: 'x'.repeat(900) });
  assert.equal(ok.ok, true); assert.equal(ok.value.landmark, 'Near b temple /b');   // angle brackets become spaces assert.equal(ok.value.reg_no, 'KA 01 AB 1234'); assert.equal(ok.value.kms, '18500'); assert.equal(ok.value.issue_text.length, 600);
  assert.ok(!('access_note' in ok.value));
  assert.equal(cleanDetails({ reg_no: '!!' }).field, 'reg_no'); assert.equal(cleanDetails({ kms: '12 km' }).field, 'kms'); assert.equal(cleanDetails({}).ok, false);
  assert.equal(cleanDetails({ landmark: '' }).value.landmark, '');   // empty clears
});
test('issues: a type from the list and a short text', () => {
  assert.deepEqual(cleanIssue({ category: 'late', body: '  The mechanic is late  ' }), { ok: true, value: { category: 'late', body: 'The mechanic is late' } });
  assert.equal(cleanIssue({ category: 'rude', body: 'abc' }).field, 'category'); assert.equal(cleanIssue({ category: 'other', body: 'a' }).field, 'body');
  assert.equal(cleanIssue({ category: 'other', body: 'z'.repeat(800) }).value.body.length, 500);
});
test('photos: JPEG, PNG or WebP only, never more than the free slots, paths only in the booking folder', () => {
  assert.deepEqual(cleanPhotoRequest({ types: ['image/jpeg', 'image/webp'] }, 3).value, ['jpg', 'webp']);
  assert.equal(cleanPhotoRequest({ types: ['image/gif'] }, 3).ok, false); assert.equal(cleanPhotoRequest({ types: ['image/png', 'image/png'] }, 1).ok, false); assert.equal(cleanPhotoRequest({ types: [] }, 3).ok, false);
  const id = '11111111-1111-1111-1111-111111111111';
  assert.equal(photoPathOk(id, `${id}/22222222-2222-2222-2222-222222222222.jpg`), true);
  assert.equal(photoPathOk(id, `99999999-9999-9999-9999-999999999999/22222222-2222-2222-2222-222222222222.jpg`), false); assert.equal(photoPathOk(id, `${id}/../x.jpg`), false); assert.equal(photoPathOk(id, `${id}/22222222-2222-2222-2222-222222222222.exe`), false);
});
test('journeyView: live point and estimate only while On the way, a Maps link, "about N min away (estimate)"', () => {
  const lead = { status: 'scheduled', visit_stage: 'on_the_way', lat: 12.9116, lng: 77.6389, vehicle: 'bike' };
  const v = journeyView({ lead, token: 'a'.repeat(32), mechanicFirst: 'Ravi', live: { live: true, lat: 12.9719, lng: 77.6412, age_s: 12 } });
  assert.equal(v.live.live, true); assert.match(v.live.eta_line, /^about \d+ min away \(estimate\)$/); assert.match(v.live.maps_url, /google\.com\/maps/); assert.equal(v.live.mechanic, 'Ravi'); assert.equal(v.live.age_s, 12);
  const arrived = journeyView({ lead: { ...lead, visit_stage: 'arrived' }, token: 't', live: { live: true, lat: 12.9719, lng: 77.6412, age_s: 5 } });
  assert.equal(arrived.live.live, true); assert.equal(arrived.live.eta_line, null);
  assert.equal(journeyView({ lead: { ...lead, visit_stage: 'started' }, token: 't', live: { live: true, lat: 12.9, lng: 77.6, age_s: 1 } }).live.live, false);   // the stage moved on: nothing is shown even if the database still had a point
  assert.equal(journeyView({ lead, token: 't', live: { live: false } }).live.live, false); assert.equal(journeyView({ lead, token: 't', live: null }).live.live, false);
  assert.ok(!JSON.stringify(v.live).includes('trail'));
  const noPin = journeyView({ lead: { ...lead, lat: null, lng: null }, token: 't', live: { live: true, lat: 12.97, lng: 77.64, age_s: 3 } });
  assert.equal(noPin.live.eta_line, null); assert.ok(noPin.live.maps_url);   // no pin for the customer's address: last seen and a Maps link, no estimate
});
test('journeyView: documents, earlier bookings (private link only when one exists, no address or phone), book again, rating', () => {
  const lead = { status: 'completed', visit_stage: 'returned', vehicle: 'bike' };
  const v = journeyView({ lead, token: 't', documents: { receipt: { number: 'MP/26-27/0001', amount: 69, paid_at: '2026-11-05T10:00:00Z' }, invoice: { number: 'MP/26-27/0001', total: 500 } },
    history: { enabled: true, rows: [{ date: '2026-10-01', vehicle: 'bike', brand: 'Honda', model: 'Activa 125', service: 'General service', status: 'completed', invoice_no: 'MP/26-27/0000', token: 'b'.repeat(32), address: 'SECRET', phone: '9876543210' }, { date: '2026-09-01', vehicle: 'bike', status: 'completed', token: null }] },
    vehicleName: { brand: 'Honda', model: 'Activa 125' }, rating: null });
  assert.equal(v.documents.receipt.base + v.documents.receipt.gst, 69); assert.equal(v.history.rows[0].link, '/track/?t=' + 'b'.repeat(32)); assert.equal(v.history.rows[1].link, null);
  assert.doesNotMatch(JSON.stringify(v.history), /SECRET|9876543210|address|phone/);
  assert.deepEqual(v.again, { vehicle: 'bike', brand: 'Honda', model: 'Activa 125' }); assert.equal(v.rating.can_rate, true); assert.equal(v.rating.done, false);
  assert.equal(journeyView({ lead, token: 't', history: { enabled: false, rows: [{}] } }).history, null);   // the one switch hides the block
  assert.equal(journeyView({ lead: { ...lead, status: 'scheduled' }, token: 't' }).rating.can_rate, false);
  assert.equal(journeyView({ lead, token: 't', rating: { rating: 5 } }).rating.done, true);
  assert.equal(journeyView({ lead, token: 't', history: { enabled: true, rows: Array.from({ length: 15 }, () => ({ status: 'completed' })) } }).history.rows.length, 10);
});
test('team issue alert and on-the-way email: no customer words, no phone, no code', () => {
  const m = teamIssueMessage({ bookingId: 'MP-26-27-0001', vehicle: 'bike', area: 'HSR Layout', category: 'late', deskUrl: 'https://crew.example.invalid/crm/' });
  assert.match(m.subject, /Customer problem MP-26-27-0001: Running late/); assert.match(m.text, /#issues/); assert.doesNotMatch(m.text + m.html, /\d{10}/);
  const e = mechanicOnTheWay({ ...site, name: 'Test Customer', ref: 'MP-26-27-0001', mechanicFirst: 'Ravi', trackUrl: 'https://mechanixpro.in/track/?t=' + 'a'.repeat(32) });
  assert.match(e.subject, /on the way/i); assert.match(e.text, /Track live: https:\/\/mechanixpro\.in\/track\/\?t=/); assert.match(e.text, /estimate/); assert.doesNotMatch(e.html + e.text, /code is \d{4}/i);
  assert.ok(KINDS.includes('ontheway_email') && KINDS.includes('team_issue'));
});
test('rating by tracking link uses the same rules as /rate/', () => {
  assert.equal(cleanRatingBody({ rating: 5, comment: ' Great <b>job</b> ' }).value.comment, 'Great b job /b'); assert.equal(cleanRatingBody({ rating: 6 }).ok, false); assert.equal(cleanRatingBody({ rating: 0 }).ok, false); assert.equal(cleanRatingBody({ rating: 3.5 }).ok, false);
  assert.equal(cleanRatingBody({ rating: 4 }).value.comment, null);
});
test('functions are wired: rate limits, CORS, token gating, no customer text in logs', () => {
  const bu = read('supabase/functions/booking-update/index.ts');
  assert.match(bu, /corsHeaders/); assert.match(bu, /booking_update_hit/); assert.match(bu, />= 30/); assert.match(bu, /\[0-9a-f\]\{32\}/); assert.match(bu, /booking-updates/);
  assert.doesNotMatch(bu, /console\.(log|error)\([^)]*(body|v\.value|t\b)/);   // logs never carry the request body or the token
  const tj = read('supabase/functions/tech-job/index.ts');
  assert.match(tj, /JOURNEY_ACTIONS = \['my_jobs', 'my_job_open', 'location_update'\]/); assert.match(tj, /tech_location_put/); assert.match(tj, /tech_my_jobs/); assert.match(tj, /sendOnTheWay/);
  assert.match(tj, /const ping = action === 'location_update'/);   // pings do not eat the 30-per-10-minutes budget
  assert.match(tj, /lat < 6 \|\| lat > 38/);
  assert.doesNotMatch(tj.slice(tj.indexOf('async function customerNote')), /booking_issues/);   // the mechanic never gets the customer's complaints
  const tb = read('supabase/functions/track-booking/index.ts');
  assert.match(tb, /token \? 150 : 20/); assert.match(tb, /booking_tech_location/); assert.match(tb, /booking_history/); assert.match(tb, /booking_documents/);
  assert.match(read('supabase/functions/submit-rating/index.ts'), /cleanRatingBody/);
  assert.match(read('supabase/functions/desk-automation/index.ts'), /tech_locations_purge/);
});
