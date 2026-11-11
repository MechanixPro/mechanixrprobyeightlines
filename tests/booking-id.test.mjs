import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bookingId, idParam, forBooking, leadLabel, idOrRequest, refFilter, REF_RE, REF_IN_TEXT, NEUTRAL_ID } from '../supabase/functions/_shared/booking-id.ts';
import { cleanLookup, trackView } from '../supabase/functions/_shared/track.ts';
import { cleanRating } from '../supabase/functions/_shared/rating.ts';
import { bookingReceived, bookingConfirmed, paymentLinkEmail, vehiclePickedUp } from '../supabase/functions/_shared/email-templates.ts';
import { adsConversions } from '../admin/ads-export.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// A lead is not a booking: the booking ID (MP-yy-yy-####) is given after confirmation. leads.ref is private and never shown to a customer.

test('the display helpers show the booking ID, and a neutral word when there is none', () => {
  assert.equal(bookingId({ booking_id: 'MP-26-27-0007' }), 'MP-26-27-0007');
  assert.equal(bookingId({ booking_id: '  ' }), null); assert.equal(bookingId({}), null); assert.equal(bookingId(null), null);
  assert.equal(idParam({ booking_id: 'MP-26-27-0007' }), 'MP-26-27-0007'); assert.equal(idParam({ ref: 'L-ABC234' }), 'request'); assert.equal(NEUTRAL_ID, 'request');
  assert.equal(forBooking({ booking_id: 'MP-26-27-0007' }), 'booking MP-26-27-0007'); assert.equal(forBooking({ ref: 'L-ABC234' }), 'your request');
  assert.equal(leadLabel({ ref: 'L-ABC234' }), 'Lead'); assert.equal(leadLabel({ booking_id: 'MP-26-27-0007' }), 'MP-26-27-0007');
  assert.equal(idOrRequest({ ref: 'L-ABC234' }), 'your request');
  for (const l of [{ ref: 'L-ABC234' }, { ref: 'L-ABC234', booking_id: null }]) for (const f of [idParam, forBooking, leadLabel, idOrRequest]) assert.doesNotMatch(f(l), /L-ABC234/);
});

test('every ref form still resolves: the new private ref, the serial ID and the older random ID', () => {
  for (const r of ['L-ABC234', 'MP-26-27-0001', 'MP-AB12CD']) { assert.match(r, REF_RE); assert.equal(cleanLookup({ ref: r.toLowerCase(), phone: '9876543210' }).ok, true, r); assert.equal(cleanRating({ ref: r, k: 'x', rating: 5 }).ok, true, r); }
  for (const r of ['hello', 'L-ABC', 'X-ABC234', 'MP-1']) assert.doesNotMatch(r, REF_RE);
  assert.equal('Hi, my booking MP-26-27-0001 please'.match(REF_IN_TEXT)[0], 'MP-26-27-0001'); assert.equal('ref L-ABC234'.match(REF_IN_TEXT)[0], 'L-ABC234');
});

test('lookups by ref also consult old_ref, ref_aliases and the booking ID, so links already sent keep working', () => {
  const f = refFilter('mp-26-27-0001');
  for (const part of ['ref.eq.MP-26-27-0001', 'old_ref.eq.MP-26-27-0001', 'booking_id.eq.MP-26-27-0001', 'ref_aliases.cs.{MP-26-27-0001}']) assert.ok(f.includes(part), part);
  assert.equal(refFilter('a,b);drop').includes(')'), false);   // nothing a customer types can add a filter
  for (const fn of ['track-booking', 'create-order', 'submit-rating']) assert.match(read(`supabase/functions/${fn}/index.ts`), /refFilter\(/, fn);
  assert.match(read('supabase/functions/whatsapp-webhook/index.ts'), /refFilter\(ref\)/);
  assert.match(read('assets/js/rate.js'), /L-\[A-Z0-9\]\{6\}/);
});

test('the track view carries the booking ID only when there is one, and never the private ref', () => {
  const none = trackView({ ref: 'L-ABC234', status: 'new', area: 'HSR' }, {});
  assert.equal(none.booking_id, null); assert.equal(JSON.stringify(none).includes('L-ABC234'), false);
  assert.equal(trackView({ ref: 'L-ABC234', booking_id: 'MP-26-27-0001', status: 'scheduled' }, {}).booking_id, 'MP-26-27-0001');
  const js = read('assets/js/track.js'); assert.match(js, /\['Booking ID', v\.booking_id\]/); assert.doesNotMatch(js, /v\.ref/);
});

const SITE = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 83106 21498', phoneTel: '+918310621498', whatsappUrl: 'https://wa.me/918310621498', email: 'hello@mechanixpro.in' };
test('emails leave the ID out when there is none: the received email never shows a reference', () => {
  const d = { ...SITE, name: 'Asha', bike: 'Honda Activa', service: 'Basic service', area: 'HSR', whenText: 'Tomorrow', estimate: 599 };
  const m = bookingReceived(d);
  assert.equal(m.subject, 'We got your request'); assert.doesNotMatch(m.html + m.text, /Reference|L-[A-Z0-9]{6}|undefined|null/);
  assert.match(bookingReceived({ ...d, ref: 'MP-26-27-0001' }).subject, /MP-26-27-0001/);
  const c = bookingConfirmed({ ...d }); assert.equal(c.subject, 'Your service is confirmed'); assert.doesNotMatch(c.text, /Reference/);
  assert.match(bookingConfirmed({ ...d, ref: 'MP-26-27-0001' }).text, /Reference: MP-26-27-0001/);
  const p = paymentLinkEmail({ ...SITE, name: 'Asha', amount: 99, payUrl: 'https://rzp.io/x' });
  assert.match(p.subject, /to lock your slot/); assert.match(p.text, /for your request to lock your slot/); assert.doesNotMatch(p.html + p.text, /undefined|null/);
  assert.match(paymentLinkEmail({ ...SITE, name: 'Asha', amount: 99, payUrl: 'https://rzp.io/x', ref: 'MP-26-27-0001' }).text, /for booking MP-26-27-0001/);
  const k = vehiclePickedUp({ ...SITE, name: 'Asha', bike: 'Activa', service: 'Basic' }); assert.doesNotMatch(k.subject + k.text, /Reference|undefined|null/);
});

test('the website answers a new request with no ID, and the success screen shows none', () => {
  const sl = read('supabase/functions/submit-lead/index.ts');
  assert.match(sl, /return json\(req, \{ ok: true, total: priced\.total, coupon_discount: couponDiscount \}\)/);
  assert.doesNotMatch(sl.slice(sl.indexOf("from('leads').insert(")), /ref: lead\.ref|lead\.ref\]/);
  const app = read('assets/js/app.js');
  assert.doesNotMatch(app, /'Pending'/); assert.match(app, /\(ref \? '<div><dt>Booking ID<\/dt><dd>' \+ esc\(ref\) \+ '<\/dd><\/div>' : ''\)/);
  assert.match(read('supabase/functions/aisensy-lead/index.ts'), /return json\(req, \{ ok: true, estimate: est \}\)/);
});

// The Meta-approved templates keep their parameter count. The slot that used to carry the ID carries a neutral word until the booking has an ID.
test('WhatsApp templates keep the same number of parameters; the ID slot is the neutral word for a lead', () => {
  const sl = read('supabase/functions/submit-lead/index.ts');
  assert.match(sl, /\[name\.split\(' '\)\[0\], NEUTRAL_ID, priced\.service\.name\]/);
  const fu = read('supabase/functions/follow-up/index.ts');
  assert.match(fu, /params: \[first, String\(lead\.amount_due \?\? 199\), idParam\(lead\), lead\.payment_link\]/);   // 4, as before
  assert.equal([...fu.matchAll(/params: \[first, idParam\(lead\)\]/g)].length, 2);                                  // followup and last: 2, as before
  assert.match(read('supabase/functions/payment-link/index.ts'), /params: \[first, String\(amount\), idParam\(lead\), link\.url\]/);
  assert.match(read('supabase/functions/desk-payment-link/index.ts'), /params: \[first, String\(amount\), idParam\(lead\), link\.url\]/);
  assert.match(read('supabase/functions/desk-template/index.ts'), /\[first, idParam\(lead\), link\]/);
  for (const f of ['razorpay-webhook', 'verify-payment']) assert.match(read(`supabase/functions/${f}/index.ts`), /params: \[String\(amount\), bid \?\? 'request'\]/);
  const da = read('supabase/functions/desk-automation/index.ts');
  for (const s of ["[String(l.name).split(' ')[0], idParam(l), link]", "[String(l.name).split(' ')[0], idParam(l), String(Math.round(l.est_total))]", "[String(l.name).split(' ')[0], idParam(l)], note: 'Service-done"]) assert.ok(da.includes(s), s);
});

test('the exact sentence a lead gets from the "received" template', () => {
  const docs = read('docs/WHATSAPP_TEMPLATES.md');
  const body = docs.split('\n').find((l) => l.startsWith('| `mxp_booking_received`')).split('|')[2].trim();
  const sentence = body.replace('{{1}}', 'Asha').replace('{{2}}', NEUTRAL_ID).replace('{{3}}', 'Basic service');
  assert.equal(sentence, 'Hi Asha, we have received your Mechanix Pro booking request for Basic service. Reply here to confirm your slot.');
  assert.equal(body.match(/\{\{\d\}\}/g).length, 3);
});

test('no customer or desk text prints the private ref: displays use booking_id', () => {
  const offenders = [];
  const scan = (dir, skip = []) => { for (const f of readdirSync(new URL('../' + dir, import.meta.url), { recursive: true })) { if (!/\.(ts|js)$/.test(f) || skip.some((s) => f.includes(s))) continue; const t = read(dir + '/' + f); if (/\$\{\s*(lead|l|c|j\.l)\.ref\s*\}|esc\(\s*(lead|l|c)\.ref\s*\)|' \+ (lead|l)\.ref \+ '/.test(t)) offenders.push(dir + '/' + f); } };
  scan('supabase/functions', ['checkout.ts']);   // checkout.ts: the Razorpay receipt id, private to us
  scan('crm'); scan('assets/js');
  const admin = read('admin/admin.js'); if (/\$\{\s*l\.ref\s*\}|esc\(\s*l\.ref\s*\)/.test(admin)) offenders.push('admin/admin.js');
  assert.deepEqual(offenders, []);
});

test('junk is not a lead: it is left out of reports, follow-ups, reminders and ad conversions', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const r = adsConversions([{ status: 'junk', created_at: '2026-11-29T00:00:00Z', utm: { gclid: 'Cj0KCQiAabcdefgh1234' }, paid_amount: 0 }], { now });
  assert.equal(r.rows.length, 0);
  const fu = read('supabase/functions/follow-up/index.ts'); assert.match(fu, /\.in\('status', \['new', 'contacted', 'quoted', 'payment_sent'\]\)/);
  const da = read('supabase/functions/desk-automation/index.ts'); assert.match(da, /const OPEN = \['new', 'contacted', 'quoted', 'payment_sent'\]/);
  assert.match(read('admin/admin.js'), /S\.leads = data\.filter\(\(l\) => l\.status !== 'junk'\); S\.junkLeads = /);
  for (const f of ['whatsapp-webhook/index.ts', '_shared/inbound.ts']) assert.match(read('supabase/functions/' + f), /\['completed', 'lost', 'junk'\]\.includes\(lead\.status\)/, f);
  assert.match(read('supabase/functions/payment-link/index.ts') + read('supabase/functions/desk-payment-link/index.ts'), /./);
});
