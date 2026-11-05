import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { seenLine, mapsUrl, issueOrder, NOTICE_LABEL } from '../crm/flow-rules.js';
import * as adminRules from '../admin/flow-rules.js';
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const THANKS = require('../assets/js/thanks.js'), INSTALL = require('../assets/js/install.js'), TRACK = require('../assets/js/track.js'), GEO = require('../assets/js/job-geo.js');
const TOK = 'a1'.repeat(16);
const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

test('thank-you: warm and short, the booking ID, three lines, big Track button to the private link, home screen, details, WhatsApp and Call', () => {
  const h = THANKS.html({ bookingId: 'MP-26-27-0007', email: 'test@example.invalid', token: TOK, name: 'Test Customer' });
  assert.match(h, /Thank you, Test\. Your slot is confirmed\./); assert.match(h, /Booking ID <b>MP-26-27-0007<\/b>/); assert.equal((h.match(/<li>/g) || []).length, 3);
  assert.match(h, new RegExp(`class="btn btn-primary wide jy-track" href="/track/\\?t=${TOK}&amp;paid=1">Track your booking`)); assert.match(h, /data-install/); assert.match(h, /Add details or report an issue/); assert.match(h, /data-wa="general"/); assert.match(h, /data-call/);
  assert.doesNotMatch(h, /\d{10}/);   // no phone number
  assert.match(THANKS.html({ token: 'bad' }), /href="\/track\/"/);   // a bad token never builds a private link
  const t = THANKS.html({ token: TOK, onTrack: true }); assert.match(t, /href="#trMain"/); assert.match(t, /href="#trDetails"/);
  assert.match(THANKS.html({ bookingId: '<img>' }), /&lt;img&gt;/);
});
test('add to home screen: button when the browser offers it, the Share hint on iPhone, a menu hint elsewhere, nothing once installed', () => {
  const win = (ua, standalone) => ({ navigator: { userAgent: ua, maxTouchPoints: 0 }, matchMedia: () => ({ matches: !!standalone }), localStorage: store() });
  assert.deepEqual(INSTALL.state(win('Mozilla/5.0 (Linux; Android 14) Chrome/120'), true), { kind: 'button' });
  assert.deepEqual(INSTALL.state(win('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605'), false), { kind: 'ios' });
  assert.deepEqual(INSTALL.state(win('Mozilla/5.0 (Linux; Android 14) Chrome/120'), false), { kind: 'menu' });
  assert.deepEqual(INSTALL.state(win('Mozilla/5.0 (iPhone) Safari', true), true), { kind: 'installed' });
  assert.equal(INSTALL.platform({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 } }), 'ios');   // iPad in desktop mode
  const i = read('assets/js/install.js'); assert.match(i, /Tap the Share button in Safari, then Add to Home Screen|tap the Share button in Safari, then Add to Home Screen/); assert.match(i, /beforeinstallprompt/); assert.match(i, /appinstalled/);
});
test('your booking is kept on this phone: token and ID only, 30 days, bad data ignored, cleared when closed', () => {
  const w = { localStorage: store() };
  assert.equal(INSTALL.saveBooking(w, { t: TOK, id: 'MP-26-27-0007' }), true); const r = INSTALL.lastBooking(w); assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 't']); assert.equal(r.t, TOK);
  assert.equal(INSTALL.saveBooking(w, { t: 'nope', id: 'x' }), false);
  w.localStorage.setItem('mxp_last_booking', JSON.stringify({ t: TOK, id: 'MP-1', at: Date.now() - 31 * 864e5 })); assert.equal(INSTALL.lastBooking(w), null);
  w.localStorage.setItem('mxp_last_booking', 'not json'); assert.equal(INSTALL.lastBooking(w), null);
  INSTALL.saveBooking(w, { t: TOK, id: 'MP-1<script>' }); assert.equal(INSTALL.lastBooking(w).id, 'MP-1script'); INSTALL.clearBooking(w); assert.equal(INSTALL.lastBooking(w), null);
});
test('the installed app opens the saved tracking page; the browser and ?stay=1 do not', () => {
  const mk = (path, search, standalone) => { const calls = []; const w = { localStorage: store(), matchMedia: () => ({ matches: standalone }), navigator: {}, location: { pathname: path, search, replace: (u) => calls.push(u) } }; INSTALL.saveBooking(w, { t: TOK, id: 'MP-1' }); return { w, calls }; };
  let x = mk('/', '?source=pwa', true); assert.equal(INSTALL.appRedirect(x.w), true); assert.deepEqual(x.calls, ['/track/?t=' + TOK]);
  x = mk('/', '?source=pwa', false); assert.equal(INSTALL.appRedirect(x.w), false);
  x = mk('/', '?source=pwa&stay=1', true); assert.equal(INSTALL.appRedirect(x.w), false);
  x = mk('/services/', '?source=pwa', true); assert.equal(INSTALL.appRedirect(x.w), false);
  x = mk('/', '', true); assert.equal(INSTALL.appRedirect(x.w), false);
  x = mk('/', '?source=pwa', true); x.w.localStorage.setItem('mxp_last_booking', JSON.stringify({ t: TOK, id: 'MP-1', at: Date.now() - 15 * 864e5 })); assert.equal(INSTALL.appRedirect(x.w), false);   // stale after 14 days
});
test('/book/ shows the thank-you and keeps the link; the build includes the new files', () => {
  const b = read('assets/js/book-pay.js'); assert.match(b, /MXP_THANKS/); assert.match(b, /saveBooking\(win, \{ t: d\.track_token, id: d\.booking_id \}\)/); assert.match(b, /paid=1/);
  const html = read('book/index.html'); assert.match(html, /thanks\.js/); assert.match(html, /journey\.css/); assert.match(html, /install\.js/);
  const tr = read('track/index.html'); assert.match(tr, /thanks\.js/); assert.match(tr, /journey\.css/); assert.match(tr, /data-company="NOVA VENTURES/);
  for (const p of ['book/index.html', 'track/index.html', 'job/index.html']) assert.doesNotMatch(read(p), /<script(?![^>]*\bsrc=)[^>]*>[^<]/, p + ' has an inline script');
});
test('live card: names the mechanic, says "about N min away (estimate)", Maps link, last updated; Arrived and not-sharing states', () => {
  const live = { live: true, mechanic: 'Ravi', eta_line: 'about 15 min away (estimate)', maps_url: 'https://www.google.com/maps/search/?api=1&query=12.9,77.6', age_s: 40, km: 3 };
  const h = TRACK.liveHtml(live, 'on_the_way', 5, 6); assert.match(h, /Ravi is on the way\./); assert.match(h, /about 15 min away \(estimate\)/); assert.match(h, /Open in Maps/); assert.match(h, /not a promise/); assert.match(h, /Last updated 1 min ago|Last updated just now/); assert.match(h, /aria-live="polite"/); assert.match(h, /jy-bar/);
  assert.match(TRACK.liveHtml({ live: false }, 'on_the_way', 0, 0), /Live location is not available right now/); assert.match(TRACK.liveHtml(live, 'arrived'), /has arrived/); assert.equal(TRACK.liveHtml(live, 'started'), '');
  assert.equal(TRACK.ago(10), 'just now'); assert.equal(TRACK.ago(150), '3 min ago');
  assert.doesNotMatch(h, /Ravi (Kumar|S)/);   // first name only
});
test('details form: editable before work, locked after; photos x of 3; report a problem is a separate form; the saved list says Open or Resolved', () => {
  const u = { editable: true, details: { landmark: 'Near the temple', reg_no: 'KA 01 AB 1234', kms: 18500 }, photos: { count: 1, max: 3 }, issues: [{ category: 'late', body: 'Not come yet', status: 'open' }, { category: 'other', body: 'Fixed one', status: 'resolved' }] };
  const h = TRACK.detailsHtml(u, 'Saved: landmark.'); assert.match(h, /id="jyDetails"/); assert.match(h, /value="Near the temple"/); assert.match(h, /Photos \(1 of 3\)/); assert.match(h, /id="jyFile"/); assert.match(h, /Report a problem with my booking/); assert.match(h, /id="jyIssue"/); assert.match(h, />Save details</); assert.match(h, /Saved: landmark\./);
  assert.match(h, /Open<\/span>/); assert.match(h, /Resolved<\/span>/); assert.match(h, /role="status" aria-live="polite"/);
  const locked = TRACK.detailsHtml({ ...u, editable: false }); assert.match(locked, /readonly/); assert.match(locked, /locked/); assert.doesNotMatch(locked, />Save details</); assert.doesNotMatch(locked, /id="jyFile"/);
  assert.doesNotMatch(TRACK.detailsHtml({ ...u, photos: { count: 3, max: 3 } }), /id="jyFile"/);   // no room for a fourth
  assert.match(TRACK.detailsHtml({ editable: true, details: { landmark: '"><script>x</script>' }, photos: { count: 0, max: 3 }, issues: [] }), /&quot;&gt;&lt;script&gt;/);
  assert.equal(TRACK.detailsHtml(null), '');
});
test('rating card: after completion only, stars 1 to 5 and a comment; thank-you after; Share on Google only for 4 and 5 and only with a configured https link', () => {
  assert.equal(TRACK.rateHtml({ can_rate: false }, 0, ''), ''); assert.equal(TRACK.rateHtml(null, 0, ''), '');
  const f = TRACK.rateHtml({ can_rate: true, done: false }, 0, 'https://g.example.invalid/review'); assert.match(f, /How did we do\?/); assert.equal((f.match(/name="rating"/g) || []).length, 5); assert.match(f, /name="comment"/); assert.match(f, /<legend>Your rating<\/legend>/);
  assert.doesNotMatch(f, /Share on Google/);
  assert.match(TRACK.rateHtml({ can_rate: true, done: true, rating: 5 }, 0, 'https://g.example.invalid/review'), /Share on Google/);
  assert.doesNotMatch(TRACK.rateHtml({ can_rate: true, done: true, rating: 3 }, 0, 'https://g.example.invalid/review'), /Share on Google/);
  assert.match(TRACK.rateHtml({ can_rate: true, done: true, rating: 3 }, 0, ''), /We are sorry/);
  assert.doesNotMatch(TRACK.rateHtml({ can_rate: true, done: true, rating: 5 }, 0, ''), /Share on Google/);   // no link configured: nothing invented
  assert.doesNotMatch(TRACK.rateHtml({ can_rate: true, done: true, rating: 5 }, 0, 'javascript:alert(1)'), /Share on Google/);
  assert.match(TRACK.rateHtml({ can_rate: true, done: false }, 4, ''), /Thank you for rating us/);   // right after sending
  assert.match(read('assets/js/config.js'), /googleReviewUrl: ''/);
});
test('documents and earlier bookings: receipt and invoice for this booking, up to 10 earlier ones, a link only when one exists, Book again with the vehicle only', () => {
  const j = { documents: { receipt: { number: 'MP/26-27/0001', amount: 69, base: 58.47, gst: 10.53, paid_at: '2026-11-05T10:00:00Z' }, invoice: { number: 'MP/26-27/0001', total: 590, taxable: 500, cgst: 45, sgst: 45, has_gst: true, paid: 69, balance: 521, lines: [{ name: 'General service', amount: 500 }] } },
    history: { rows: [{ date: '2026-10-01', vehicle: 'bike', brand: 'Honda', model: 'Activa 125', service: 'General service', status: 'completed', invoice_no: 'MP/26-27/0000', link: '/track/?t=' + 'b'.repeat(32) }, { date: '2026-09-01', vehicle: 'bike', status: 'completed', link: null }] }, again: { vehicle: 'bike', brand: 'Honda', model: 'Activa 125' } };
  const d = TRACK.docsHtml(j); assert.match(d, /Your documents/); assert.match(d, /Fee receipt/); assert.match(d, /Invoice MP\/26-27\/0001/); assert.equal((d.match(/data-doc="/g) || []).length, 2);
  assert.match(TRACK.docView('receipt', j.documents.receipt, 'NOVA VENTURES'), /Receipt for advance[\s\S]*CGST 9%[\s\S]*SGST 9%/); assert.match(TRACK.docView('invoice', j.documents.invoice, 'NOVA VENTURES'), /Invoice MP\/26-27\/0001[\s\S]*General service[\s\S]*Balance/);
  const h = TRACK.histHtml(j); assert.match(h, /Your other bookings/); assert.match(h, /Service history/); assert.match(h, /Open this booking/); assert.equal((h.match(/Open this booking/g) || []).length, 1); assert.match(h, /href="\/book\/\?brand=Honda&amp;model=Activa%20125"/);
  assert.doesNotMatch(h, /address|phone|mechanic|\d{10}/i);
  assert.match(TRACK.histHtml({ history: null, again: { vehicle: 'bike' } }), /<h3>Book again<\/h3>/); assert.doesNotMatch(TRACK.histHtml({ history: null, again: {} }), /Your other bookings/);   // one flag off: only Book again
  assert.equal(TRACK.againUrl({ vehicle: 'car', brand: null, model: 'Swift' }), '/book/?vehicle=car&model=Swift'); assert.equal(TRACK.docsHtml({ documents: { receipt: null, invoice: null } }), '');
});
test('tracking page: each part is redrawn only when its data changed; polls only while visible, faster on the way; saves the link; clears it when closed', () => {
  const js = read('assets/js/track.js');
  assert.match(js, /sigs\[id\] === sig\) return/); assert.match(js, /doc\.activeElement/); assert.match(js, /J && J\.stage === 'on_the_way' \? 20000 : 30000/); assert.match(js, /visibilitychange/); assert.match(js, /clearBooking/); assert.match(js, /saveBooking/);
  assert.match(js, /submit-rating', \{ t: tok/); assert.match(js, /booking-update/); assert.match(js, /photo_url/); assert.match(js, /photo_done/); assert.match(js, /image\/jpeg/);
  for (const id of ['trThanks', 'trLive', 'trDetails', 'trRate', 'trDocs', 'trHist', 'trInstall']) assert.ok(js.includes(id), id);
});
test('mechanic page: throttle (15 s and 20 m, or 60 s), starts only on a tap, stops by itself', () => {
  const a = { lat: 12.9116, lng: 77.6389, t: 1000 };
  assert.equal(GEO.shouldSend(null, a, 1000), true);
  assert.equal(GEO.shouldSend(a, { lat: 12.92, lng: 77.64 }, 1000 + 14000), false);          // moved a lot, but under 15 s
  assert.equal(GEO.shouldSend(a, { lat: 12.9117, lng: 77.6389 }, 1000 + 16000), false);      // 15 s passed, moved only about 11 m
  assert.equal(GEO.shouldSend(a, { lat: 12.9120, lng: 77.6389 }, 1000 + 16000), true);       // about 44 m
  assert.equal(GEO.shouldSend(a, { lat: 12.9116, lng: 77.6389 }, 1000 + 61000), true);       // standing still: a keep-alive after 60 s
  assert.ok(Math.abs(GEO.distanceM({ lat: 12.9116, lng: 77.6389 }, { lat: 12.9125, lng: 77.6389 }) - 100) < 2);
});
test('mechanic sharer with a fake phone: nothing before the tap, watchPosition once, points throttled, stop on server "stopped", pagehide and Stop', async () => {
  let watchers = 0, cleared = 0, cb = null; const sent = [], stops = [], listeners = {};
  const win = { navigator: { geolocation: { watchPosition: (ok) => { watchers++; cb = ok; return 7; }, clearWatch: (id) => { assert.equal(id, 7); cleared++; } } }, addEventListener: (n, f) => { listeners[n] = f; } };
  let answer = { ok: true };
  const s = GEO.createSharer(win, (p) => { sent.push(p); return Promise.resolve(answer); }, { onStop: (w) => stops.push(w) });
  assert.equal(watchers, 0, 'no watch before the tap'); assert.equal(s.active(), false);
  assert.equal(s.start(), true); assert.equal(s.start(), true); assert.equal(watchers, 1, 'one watch only'); assert.equal(s.active(), true);
  const pos = (lat, lng) => ({ coords: { latitude: lat, longitude: lng, accuracy: 12, heading: null } });
  const realNow = Date.now; let now = 1_000_000; Date.now = () => now;
  try {
    cb(pos(12.9116, 77.6389)); await Promise.resolve(); assert.equal(sent.length, 1, 'first point at once');
    now += 5000; cb(pos(12.9200, 77.6389)); assert.equal(sent.length, 1, 'under 15 s: not sent');
    now += 12000; cb(pos(12.9200, 77.6389)); await Promise.resolve(); assert.equal(sent.length, 2, 'after 15 s and 940 m: sent');
    now += 16000; cb(pos(12.92001, 77.6389)); assert.equal(sent.length, 2, 'moved about 1 m: not sent');
    now += 50000; cb(pos(12.92001, 77.6389)); await Promise.resolve(); assert.equal(sent.length, 3, 'keep-alive after 60 s');
    answer = { ok: false, stopped: true }; now += 20000; cb(pos(12.93, 77.64)); await new Promise((r) => setTimeout(r, 0)); assert.equal(s.active(), false, 'the server said the job moved on: sharing stopped'); assert.deepEqual(stops, ['stage']); assert.equal(cleared, 1);
    s.start(); assert.equal(watchers, 2); listeners.pagehide(); assert.equal(s.active(), false); assert.equal(stops.at(-1), 'closed');
    s.start(); s.stop('stopped'); assert.equal(stops.at(-1), 'stopped'); assert.equal(cleared, 3);
  } finally { Date.now = realNow; }
  const denied = []; const w2 = { navigator: { geolocation: { watchPosition: (ok, err) => { err({ code: 1 }); return 9; }, clearWatch: () => {} } }, addEventListener: () => {} };
  GEO.createSharer(w2, () => Promise.resolve({ ok: true }), { onError: (m) => denied.push(m) }).start(); assert.match(denied[0], /blocked/);
  assert.equal(GEO.createSharer({ navigator: {}, addEventListener: () => {} }, () => {}, { onError: (m) => denied.push(m) }).start(), false);
});
test('job page source: consent line, Navigate, My jobs, quote read-only, sharing starts only on a tap and stops after the code', () => {
  const j = read('assets/js/job.js'), html = read('job/index.html'), f = read('supabase/functions/tech-job/index.ts');
  assert.ok(j.includes('Your location is shared with the customer and the Mechanix Pro team only while this job is On the way or Arrived. It stops when you arrive and verify the code, or finish.'));
  assert.match(j, /data-v="share"/); assert.match(j, /sharer\.start\(\)/); assert.doesNotMatch(j.replace(/if \(act === 'share'\)[^\n]*/, ''), /sharer\.start\(\)/);   // started from the tap handler only
  assert.match(j, /wasStart && sharer\) sharer\.stop/); assert.match(j, /!d\.share_ok\) sharer\.stop/); assert.match(j, /Waiting for customer approval\./); assert.match(j, /Approved: you can start\./); assert.match(j, />Navigate</); assert.match(j, /my_job_open/); assert.match(j, /My jobs/);
  assert.match(j, /d\.can_start_work \? '' : ' disabled aria-disabled="true"'/);   // Start work stays blocked until approval, as before
  assert.match(html, /job-geo\.js/); assert.match(html, /id="jbMine"/); assert.match(html, /id="jbNote"/);
  assert.match(f, /travelmode|navigateUrl/);
});
test('Crew and Admin share one screen code: identical files, last seen, customer details with Resolve, Issues list, photos only through signed links', () => {
  assert.equal(read('crm/flow-core.js'), read('admin/flow-core.js')); assert.equal(read('crm/flow-rules.js'), read('admin/flow-rules.js')); assert.equal(read('crm/flow.css'), read('admin/flow.css'));
  const fc = read('crm/flow-core.js'); for (const w of ['crm_booking_updates', 'crm_tech_location', 'resolveIssue', 'crm_issue_resolve', 'issuesHtml', 'seenLine', 'Added by customer', 'showPhotos', 'photoUrl']) assert.ok(fc.includes(w), w);
  assert.match(read('crm/crm.js'), /id: 'issues', title: 'Issues'/); assert.match(read('crm/crm.js'), /createSignedUrl\(path, 600\)/); assert.match(read('crm/crm.js'), /PHOTO_BUCKET = 'booking-updates'/); assert.match(read('admin/admin.js'), /createSignedUrl\(path, 600\)/); assert.match(read('admin/admin.js'), /crm_open_issues/); assert.match(read('admin/admin.js'), /crm_tech_seen/); assert.match(read('crm/pages/dispatch.js'), /crm_tech_seen/); assert.match(read('crm/pages/issues.js'), /crm_open_issues/);
  assert.equal(seenLine(10), 'Mechanic last seen just now'); assert.equal(seenLine(180), 'Mechanic last seen 3 min ago'); assert.match(seenLine(900), /15 min ago \(old point\)/); assert.match(seenLine(7300), /2 h ago/); assert.equal(seenLine(null), null); assert.equal(seenLine(-1), null);
  assert.match(mapsUrl(12.9, 77.6), /query=12\.900000,77\.600000/); assert.equal(mapsUrl('x', 1), null);
  assert.deepEqual(issueOrder([{ id: 'r1', status: 'resolved', resolved_at: '2026-11-05T10:00Z' }, { id: 'o2', status: 'open', created_at: '2026-11-05T09:00Z' }, { id: 'o1', status: 'open', created_at: '2026-11-05T08:00Z' }, { id: 'r2', status: 'resolved', resolved_at: '2026-11-05T11:00Z' }]).map((x) => x.id), ['o1', 'o2', 'r2', 'r1']);
  assert.deepEqual(adminRules.issueOrder([{ id: 'a', status: 'resolved', resolved_at: 'x' }, { id: 'b', status: 'open', created_at: 'y' }]).map((x) => x.id), ['b', 'a']);
  assert.equal(NOTICE_LABEL.ontheway_email, 'On-the-way email'); assert.equal(NOTICE_LABEL.team_issue, 'Team alert: customer issue');
  assert.doesNotMatch(fc, /console\.log/);
});
test('check script covers the new JS and the manifest keeps its start_url (the installed app redirects when a booking is saved)', () => {
  const pkg = JSON.parse(read('package.json')).scripts.check; for (const w of ['thanks.js', 'install.js', 'job-geo.js', 'crm/pages/issues.js', 'assets/js/track.js', 'assets/js/job.js', 'admin/flow-core.js']) assert.ok(pkg.includes(w), w);
  assert.equal(JSON.parse(read('manifest.webmanifest')).start_url, '/?source=pwa');
});
