/* Track your booking. Two ways in: the reference and mobile number, or the private link from the confirmation email (?t=...).
   The link adds the one-time code, the address you gave, the itemised quote with Approve and Decline, the delivery estimate, and after payment:
   the thank-you (?paid=1), your mechanic live on the way, details and photos you can add, Report a problem, a rating when the job is done, your documents and earlier bookings, and Book again.
   Talks to track-booking, quote-decision, booking-update and submit-rating. No inline script (CSP). Each part of the page is redrawn only when its own data changed, so typing is never lost. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_TRACK = api; if (typeof document !== 'undefined') api.init(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var inr = function (n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var KIND = { parts: 'Parts', labour: 'Labour', other: 'Other' };
  var ISSUE = [['late', 'The mechanic is late or has not come'], ['mechanic', 'About the mechanic'], ['payment', 'A payment problem'], ['safety', 'A safety concern'], ['cancel', 'I want to cancel this booking'], ['other', 'Something else']];
  var STATUS = { paid: 'Confirmed', scheduled: 'Scheduled', completed: 'Completed', lost: 'Closed' };
  var GOOGLE_OK = /^https:\/\/[^\s"'<>]+$/;

  /* "N min ago" from a number of seconds. */
  function ago(sec) { sec = Math.max(0, Math.round(sec)); if (sec < 45) return 'just now'; if (sec < 3600) return Math.round(sec / 60) + ' min ago'; return Math.round(sec / 3600) + ' h ago'; }
  /* The live card. Pure: journey.live + the stage in, html out. Says "estimate" every time and never promises an arrival. */
  function liveHtml(live, stage, fetchedAgoSec, startKm) {
    if (stage !== 'on_the_way' && stage !== 'arrived') return '';
    var who = live && live.mechanic ? esc(live.mechanic) : 'Your mechanic';
    if (stage === 'arrived') return '<div class="card track-card jy-live"><h3 aria-live="polite">' + who + ' has arrived.</h3><p>Give your one-time code to the mechanic so the job can start.</p></div>';
    if (!live || !live.live) return '<div class="card track-card jy-live"><h3 aria-live="polite">' + who + ' is on the way.</h3><p class="jy-meta">Live location is not available right now. We will update this page as soon as your mechanic shares it.</p></div>';
    var pct = startKm && live.km != null ? Math.max(4, Math.min(100, Math.round((1 - live.km / Math.max(startKm, live.km)) * 100))) : null;
    return '<div class="card track-card jy-live"><h3 aria-live="polite">' + who + ' is on the way.</h3>'
      + (live.eta_line ? '<p class="jy-eta" aria-live="polite">' + esc(live.eta_line) + '</p>' : '')
      + (pct != null ? '<div class="jy-bar" role="img" aria-label="Distance covered so far"><i style="width:' + pct + '%"></i></div>' : '')
      + '<p><a class="btn btn-ghost btn-sm" href="' + esc(live.maps_url) + '" target="_blank" rel="noopener">Open in Maps</a></p>'
      + '<p class="jy-meta">Last updated ' + esc(ago((live.age_s || 0) + (fetchedAgoSec || 0))) + '. The time is an estimate, not a promise. Have your code ready.</p></div>';
  }
  /* Details form. u = journey.updates. msg = the last saved or error line. */
  function detailsHtml(u, msg) {
    if (!u) return '';
    var d = u.details || {}, ed = u.editable, ro = ed ? '' : ' readonly', n = (u.photos && u.photos.count) || 0, max = (u.photos && u.photos.max) || 3;
    var inp = function (id, label, val, extra) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id.slice(3) + '" value="' + esc(val || '') + '" autocomplete="off"' + ro + (extra || '') + '>'; };
    var area = function (id, label, val, hint, rows) { return '<label for="' + id + '">' + label + '</label><textarea id="' + id + '" name="' + id.slice(3) + '" rows="' + (rows || 3) + '"' + ro + ' maxlength="600">' + esc(val || '') + '</textarea>' + (hint ? '<p class="jy-hint">' + hint + '</p>' : ''); };
    var form = '<form class="jy-form" id="jyDetails" novalidate>'
      + inp('jy-landmark', 'Landmark near your address', d.landmark, ' maxlength="120" placeholder="Near the temple, opposite the school"')
      + inp('jy-access_note', 'Gate, parking or floor', d.access_note, ' maxlength="200" placeholder="Gate 2, park inside, 3rd floor"')
      + '<div class="jy-two"><div>' + inp('jy-reg_no', 'Registration number (optional)', d.reg_no, ' maxlength="13" autocapitalize="characters" placeholder="KA 01 AB 1234"') + '</div><div>' + inp('jy-kms', 'Kilometres on the clock', d.kms, ' inputmode="numeric" maxlength="7" placeholder="18500"') + '</div></div>'
      + area('jy-vehicle_note', 'Anything else about the vehicle', d.vehicle_note, '', 2)
      + area('jy-issue_text', 'What is the issue?', d.issue_text, 'Tell the mechanic what you notice: a sound, a warning light, when it happens.', 3)
      + (ed ? '<button class="btn btn-primary wide" type="submit">Save details</button>' : '<p class="jy-meta">The work has started, so these details are locked. Message us on WhatsApp to change anything.</p>')
      + '<p class="jy-meta" id="jyMsg" role="status" aria-live="polite">' + esc(msg || '') + '</p></form>';
    var photos = '<h4>Photos (' + n + ' of ' + max + ')</h4><div class="jy-photos" aria-hidden="' + (n ? 'false' : 'true') + '">' + Array.apply(null, Array(max)).map(function (_, i) { return i < n ? '<span>Photo ' + (i + 1) + ' added</span>' : '<span></span>'; }).join('') + '</div>'
      + (ed && n < max ? '<input class="jy-file" id="jyFile" type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple><label class="btn btn-ghost wide jy-pick" for="jyFile">Add a photo</label><p class="jy-meta" id="jyPhotoMsg" role="status" aria-live="polite"></p>' : '<p class="jy-meta" id="jyPhotoMsg" role="status" aria-live="polite"></p>');
    var issues = (u.issues || []).length ? '<ul class="jy-list" aria-label="Your reports">' + u.issues.map(function (i) {
      var t = (ISSUE.filter(function (x) { return x[0] === i.category; })[0] || [0, 'Other'])[1];
      return '<li><b>' + esc(t) + '</b><span class="jy-chip' + (i.status === 'resolved' ? ' good' : '') + '">' + (i.status === 'resolved' ? 'Resolved' : 'Open') + '</span><br>' + esc(i.body) + '</li>'; }).join('') + '</ul>' : '';
    var report = '<div class="jy-issue"><h4>Report a problem with my booking</h4><form class="jy-form" id="jyIssue" novalidate><label for="jyCat">What is it about?</label><select id="jyCat" name="category">' + ISSUE.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + '</option>'; }).join('') + '</select>'
      + '<p class="jy-meta">Choosing &ldquo;I want to cancel this booking&rdquo; sends us a request. Cancelling more than 2 hours before your slot is free, and your confirmation fee is refunded. We confirm it before anything is refunded.</p><label for="jyBody">Tell us what went wrong</label><textarea id="jyBody" name="body" rows="3" maxlength="500"></textarea><button class="btn btn-ghost wide" type="submit">Report a problem</button><p class="jy-meta" id="jyIssueMsg" role="status" aria-live="polite"></p></form>' + issues + '</div>';
    return '<div class="card track-card" id="trDetailsCard"><h3 id="trDetailsH">Add details or report an issue</h3><p class="jy-meta">' + (ed ? 'You can add or change these until the work starts. Only you, our team and your mechanic can see them.' : 'Saved with your booking.') + '</p>' + form + photos + report + '</div>';
  }
  /* After the service: ready for delivery, delivered, closed. d = { stage: 'none'|'ready'|'delivered'|'closed', at }. */
  function deliveryHtml(d) {
    if (!d || !d.stage || d.stage === 'none') return '';
    var when = d.at ? new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
    var t = d.stage === 'ready' ? 'Your vehicle is ready for delivery' : d.stage === 'delivered' ? 'Delivered' + (when ? ' on ' + when : '') : d.stage === 'closed' ? 'Booking closed' : '';
    return t ? '<div class="card track-card fade" data-delivery="' + esc(d.stage) + '"><h3>' + esc(t) + '</h3>' + (d.stage === 'ready' ? '<p>We will bring it to you, or tell you when to collect it.</p>' : d.stage === 'closed' ? '<p>Thank you for choosing Mechanix Pro.</p>' : '') + '</div>' : '';
  }
  /* A cancelled booking: a clear card and the refund in plain words. Never a gateway id. c = { cancelled, kind, refund: { status, amount } }. */
  var REFUND_WORDS = { none: 'No refund is due for this booking.', pending: 'Your refund is being arranged. We will update this page.', processing: 'Your refund has been sent and is on its way. It reaches your original payment method in 5 to 7 working days.', refunded: 'Your refund has been paid back to your original payment method.', failed: 'Your refund could not be completed yet. Our team is fixing it and will contact you. You do not need to do anything.' };
  function cancelHtml(c) {
    if (!c || !c.cancelled) return '';
    var r = c.refund || { status: 'none' }, amt = Number(r.amount) > 0 && r.status !== 'none' ? '<p><b>Refund amount: ' + esc(inr(r.amount)) + '</b></p>' : '';
    return '<div class="card track-card fade" data-cancelled="1"><h3>This booking was cancelled' + (c.kind === 'customer' ? ' at your request' : '') + '</h3>' + amt + '<p data-refund="' + esc(r.status) + '">' + esc(REFUND_WORDS[r.status] || REFUND_WORDS.none) + '</p></div>';
  }
  function rateHtml(r, done, google) {
    if (!r || !r.can_rate) return '';
    if (r.done || done) {
      var n = done || r.rating;
      return '<div class="card track-card" id="trRateCard"><h3>Thank you for rating us</h3><p>' + (n && n <= 3 ? 'We are sorry it was not better. Someone from our team will call you to put it right.' : 'We are glad it went well. Thank you for choosing Mechanix Pro.') + '</p>'
        + (n >= 4 && google && GOOGLE_OK.test(google) ? '<a class="btn btn-ghost" href="' + esc(google) + '" target="_blank" rel="noopener">Share on Google</a>' : '') + '</div>';
    }
    return '<div class="card track-card" id="trRateCard"><h3>How did we do?</h3><form class="jy-form" id="jyRate" novalidate><fieldset class="jy-stars"><legend>Your rating</legend>'
      + [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="rating" value="' + n + '" aria-label="' + n + ' out of 5"><span aria-hidden="true">' + n + '</span></label>'; }).join('')
      + '</fieldset><label for="jyRateText">Anything to add? (optional)</label><textarea id="jyRateText" name="comment" rows="2" maxlength="500"></textarea><button class="btn btn-primary wide" type="submit">Send my rating</button><p class="jy-meta" id="jyRateMsg" role="status" aria-live="polite"></p></form></div>';
  }
  function docView(kind, d, company) {
    var row = function (a, b) { return '<tr><td>' + esc(a) + '</td><td class="r">' + esc(b) + '</td></tr>'; };
    if (kind === 'receipt') {
      return '<div class="jy-docview" id="jyDocView"><h4>Receipt for advance</h4><p class="jy-meta">' + esc(company) + '</p><table><tbody>' + row('Receipt number', d.number || 'will be on your emailed receipt') + row('Date', new Date(d.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))
        + row('Taxable value', inr(d.base)) + row('CGST 9%', inr(d.gst / 2)) + row('SGST 9%', inr(d.gst / 2)) + row('Amount paid', inr(d.amount)) + '</tbody></table><p class="jy-meta">Confirmation fee, adjusted in your final bill.</p><p><button class="btn btn-ghost btn-sm" type="button" data-doc="print">Print or save as PDF</button> <button class="btn btn-ghost btn-sm" type="button" data-doc="close">Close</button></p></div>';
    }
    var lines = (d.lines || []).map(function (l) { return row(l.name || l.description || 'Item', inr(l.amount != null ? l.amount : l.total)); }).join('');
    return '<div class="jy-docview" id="jyDocView"><h4>Invoice ' + esc(d.number) + '</h4><p class="jy-meta">' + esc(company) + '</p><table><tbody>' + lines + row('Taxable value', inr(d.taxable)) + (Number(d.discount) ? row('Discount', '− ' + inr(d.discount)) : '') + (d.has_gst ? row('CGST', inr(d.cgst)) + row('SGST', inr(d.sgst)) : '') + row('Total', inr(d.total)) + row('Paid', inr(d.paid)) + row('Balance', inr(d.balance)) + '</tbody></table>'
      + '<p><button class="btn btn-ghost btn-sm" type="button" data-doc="print">Print or save as PDF</button> <button class="btn btn-ghost btn-sm" type="button" data-doc="close">Close</button></p></div>';
  }
  function docsHtml(j) {
    var d = j && j.documents; if (!d || (!d.receipt && !d.invoice)) return '';
    var item = function (label, sub, key) { return '<li class="jy-doc"><span><b>' + esc(label) + '</b><br><span class="jy-meta">' + esc(sub) + '</span></span><button class="btn btn-ghost btn-sm" type="button" data-doc="' + key + '">View</button></li>'; };
    return '<div class="card track-card"><h3>Your documents</h3><ul class="jy-list">'
      + (d.receipt ? item('Fee receipt', inr(d.receipt.amount) + ' paid', 'receipt') : '') + (d.invoice ? item('Invoice ' + d.invoice.number, 'Total ' + inr(d.invoice.total), 'invoice') : '') + '</ul><div id="jyDocSlot"></div></div>';
  }
  function againUrl(a) {
    var q = []; if (a && a.vehicle === 'car') q.push('vehicle=car'); if (a && a.brand) q.push('brand=' + encodeURIComponent(a.brand)); if (a && a.model) q.push('model=' + encodeURIComponent(a.model));
    return '/book/' + (q.length ? '?' + q.join('&') : '');
  }
  function histHtml(j) {
    if (!j) return '';
    var h = j.history, rows = h && h.rows ? h.rows : [];
    var list = h ? (rows.length ? '<ul class="jy-list" aria-label="Your earlier bookings">' + rows.map(function (r) {
      var veh = [r.brand, r.model].filter(Boolean).join(' ') || (r.vehicle === 'car' ? 'Car' : 'Bike');
      return '<li><b>' + esc(veh) + '</b> · ' + esc(r.service || 'Service') + '<br><span class="jy-meta">' + esc(new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) + ' · ' + esc(STATUS[r.status] || r.status) + (r.invoice_no ? ' · Invoice ' + esc(r.invoice_no) : '') + '</span>' + (r.link ? '<br><a href="' + esc(r.link) + '">Open this booking</a>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="jy-meta">Your earlier bookings will show here.</p>') : '';
    return '<div class="card track-card"><h3>' + (h ? 'Your other bookings' : 'Book again') + '</h3>' + (h ? '<p class="jy-meta">Service history for your vehicles.</p>' : '') + list + '<div class="jy-again"><a class="btn btn-primary" href="' + esc(againUrl(j.again)) + '">Book again</a></div></div>';
  }

  function init(win) {
    var doc = win.document, C = win.MXP || {}, form = doc.getElementById('trackForm'), msg = doc.getElementById('trMsg'), out = doc.getElementById('trResult'), go = doc.getElementById('trGo');
    if (!form) return;
    var q = new URLSearchParams(win.location.search), preRef = (q.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 13), tok = (q.get('t') || '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(tok)) tok = '';
    var paidMode = !!tok && q.get('paid') === '1';
    if (preRef) doc.getElementById('tr-ref').value = preRef;
    var post = function (fn, body) {
      return win.fetch(C.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
    };
    var SECTIONS = ['trThanks', 'trMain', 'trLive', 'trCode', 'trQuote', 'trDelivery', 'trCancel', 'trCheck', 'trRedo', 'trShield', 'trClips', 'trDetails', 'trRate', 'trDocs', 'trHist', 'trInstall'];
    var sigs = {}, state = { msg: '', issueMsg: '', rated: 0, fetchedAt: 0, startKm: 0, last: null, rateMsg: '' };
    if (tok) { out.innerHTML = SECTIONS.map(function (id) { return '<div id="' + id + '"></div>'; }).join(''); }
    // A part of the page is redrawn only when its data changed and the person is not typing in it.
    var put = function (id, html, sig) {
      var el = doc.getElementById(id) || out; if (!el) return;
      if (!tok && id !== 'trMain') return;
      sig = String(sig == null ? html : sig); if (sigs[id] === sig) return;
      if (el !== out && doc.activeElement && el.contains(doc.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(doc.activeElement.tagName) && sigs[id] != null) return;
      sigs[id] = sig; el.innerHTML = html;
    };
    function steps(list, closed) {
      return '<ol class="track-steps' + (closed ? ' closed' : '') + '" aria-label="Progress">' + list.map(function (s) {
        var cls = closed ? 'todo' : s.state === 'done' ? 'done' : s.state === 'current' ? 'now' : 'todo';
        return '<li class="' + cls + '"' + (cls === 'now' ? ' aria-current="step"' : '') + '><i aria-hidden="true"></i><span>' + esc(s.label) + '</span></li>';
      }).join('') + '</ol>';
    }
    /* Pro Check 20 card: the 20 points with their results, then the test ride. Pure: pro_check in, html out. Empty until the technician has finished the check. */
    function proCheckCard(pc) {
      if (!pc || !pc.summary) return '';
      var s = pc.summary, mark = { ok: '<span class="pc-ok" aria-label="OK">&#10003;</span>', needs_attention: '<span class="pc-warn" aria-label="Needs attention">!</span>', not_applicable: '<span class="pc-skip" aria-label="Skipped">&ndash;</span>' };
      var g = (pc.groups || []).map(function (grp) {
        return '<h4>' + esc(grp.title) + '</h4><ul class="pc-list">' + grp.items.map(function (i) { return '<li class="pc-' + esc(i.r) + '">' + (mark[i.r] || '') + ' <span>' + esc(i.label) + '</span>' + (i.n ? '<small>' + esc(i.n) + '</small>' : '') + '</li>'; }).join('') + '</ul>';
      }).join('');
      return '<div class="card track-card"><h3>Pro Check 20</h3><p class="pc-sum"><b>' + s.ok + ' OK</b>' + (s.attention ? ', <b>' + s.attention + ' need' + (s.attention === 1 ? 's' : '') + ' attention</b>' : '') + (s.skipped ? ', ' + s.skipped + ' skipped' : '') + '. Your mechanic checked these before the quote.</p>' + g + (pc.test_ride ? '<p class="pc-ride"><b>' + esc(pc.test_ride) + '</b></p>' : '') + '</div>';
    }
    /* Redo Promise card: if the same repair work fails within 30 days of the service, a free redo. Shows the form while eligible, then the state of the request. Pure: redo in, html out. */
    function redoCard(r) {
      if (!r) return '';
      var rq = r.request, until = r.until ? new Date(r.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
      var line = '<p class="jy-meta">If the same repair work fails within 30 days of the service, we redo it free. Parts follow the maker&#39;s warranty.</p>';
      if (rq && (rq.status === 'open' || rq.status === 'approved')) return '<div class="card track-card"><h3>Redo Promise <small>' + (rq.status === 'open' ? 'Request received' : 'Approved') + '</small></h3><p>' + (rq.status === 'open' ? 'We have your request and will call you to arrange the redo.' : 'Your redo is approved. We will confirm the time with you.') + (rq.note ? ' ' + esc(rq.note) : '') + '</p></div>';
      if (r.eligible) return '<div class="card track-card"><h3>Redo Promise</h3>' + line + '<p class="jy-meta">You can ask until ' + esc(until) + '.</p><label class="label" for="rd-why">What is not right?</label><textarea id="rd-why" maxlength="500" rows="3" autocomplete="off" placeholder="For example: the noise is back after two weeks"></textarea><button class="btn btn-ghost wide" type="button" data-redo="1">Ask for a redo</button><p class="tq-msg" id="rdMsg" role="status" aria-live="polite"></p></div>'
        + '';
      if (rq && rq.status === 'declined') return '<div class="card track-card"><h3>Redo Promise <small>Not approved</small></h3><p>' + esc(rq.note || 'We could not approve this redo. Message us and we will look at it again.') + '</p></div>';
      if (rq && rq.status === 'done') return '<div class="card track-card"><h3>Redo Promise <small>Done</small></h3><p>Your redo was completed.</p></div>';
      return '';
    }
    var PTYPE = { genuine: 'Genuine', equivalent: 'Equivalent' };
    /* Mechanix Shield card: up to Rs 5,000 if the vehicle is damaged in our care, reported within 48 hours of delivery. Pure: shield in, html out. */
    function shieldCard(r) {
      if (!r) return '';
      var c = r.claim, until = r.until ? new Date(r.until).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
      var line = '<p class="jy-meta">If your vehicle is damaged while in our care, Mechanix Pro pays up to &#8377;5,000 for a valid claim reported within 48 hours of delivery. We check it against the photos taken at pickup and delivery.</p>';
      if (c && (c.status === 'open' || c.status === 'approved' || c.status === 'paid')) {
        var head = { open: 'Claim received', approved: 'Approved', paid: 'Paid' }[c.status];
        var txt = c.status === 'open' ? 'We have your claim and will call you after we check the photos.' : c.status === 'approved' ? 'Your claim is approved' + (c.amount ? ' for &#8377;' + Number(c.amount).toLocaleString('en-IN') : '') + '. We will confirm how it is paid.' : 'Your claim is paid' + (c.amount ? ' (&#8377;' + Number(c.amount).toLocaleString('en-IN') + ')' : '') + '.';
        return '<div class="card track-card"><h3>Mechanix Shield <small>' + head + '</small></h3><p>' + txt + (c.note ? ' ' + esc(c.note) : '') + '</p></div>';
      }
      if (r.eligible) return '<div class="card track-card"><h3>Mechanix Shield</h3>' + line + '<p class="jy-meta">You can report damage until ' + esc(until) + '.</p><label class="label" for="sh-why">What was damaged, and how?</label><textarea id="sh-why" maxlength="800" rows="3" autocomplete="off" placeholder="For example: a scratch on the left side panel that was not there at pickup"></textarea><button class="btn btn-ghost wide" type="button" data-shield="1">Report damage</button><p class="tq-msg" id="shMsg" role="status" aria-live="polite"></p></div>';
      if (c && c.status === 'declined') return '<div class="card track-card"><h3>Mechanix Shield <small>Not approved</small></h3><p>' + esc(c.note || 'We could not approve this claim. Message us and we will look at it again.') + '</p></div>';
      return '';
    }
    /* Mechanix Live card: the photos and short clips the mechanic or garage shared, newest first, and a Video call button while the job is on. Pure: live_updates + job_on in, html out. */
    function clipsCard(items, on, bookingId) {
      items = items || []; if (!items.length && !on) return '';
      var when = function (a) { return new Date(a).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); };
      var grid = items.length ? '<ul class="lv-grid">' + items.map(function (i) { return '<li>' + (i.kind === 'clip' ? '<video controls playsinline preload="metadata" src="' + esc(i.url) + '#t=0.1" aria-label="Short clip from your service"></video>' : '<a href="' + esc(i.url) + '" target="_blank" rel="noopener"><img loading="lazy" decoding="async" src="' + esc(i.url) + '" alt="Photo from your service"></a>') + '<small>' + esc(when(i.at)) + '</small></li>'; }).join('') + '</ul>' : '<p class="jy-meta">Photos and short clips from your service will show here as the work goes on.</p>';
      var call = on ? '<a class="btn btn-wa wide" href="#" data-wa="Video call" data-wa-text="' + esc('Hi Mechanix Pro, please show me my service live on a WhatsApp video call. Booking ID: ' + (bookingId || '')) + '">Ask for a video call</a><p class="jy-meta">We will call you on WhatsApp video so you can see the work.</p>' : '';
      return '<div class="card track-card"><h3>Mechanix Live</h3>' + grid + call + '</div>';
    }
    function quoteCard(v) {
      var z = v.quote; if (!z || !z.lines) return z ? '<div class="card track-card"><h3>Quote</h3><p>Status: <b>' + esc(z.status) + '</b>. Open the link in your email to review it.</p></div>' : '';
      var items = z.lines.map(function (l) { return '<tr><td>' + esc(l.name) + ' <small>' + esc((KIND[l.kind] || l.kind) + (l.kind === 'parts' && PTYPE[l.part_type] ? ', ' + PTYPE[l.part_type] : '')) + '</small></td><td class="r">' + inr(l.amount) + '</td></tr>'; }).join('');
      var sum = '<tr><td>Subtotal (before GST)</td><td class="r">' + inr(z.subtotal) + '</td></tr><tr><td>GST @ 18%</td><td class="r">' + inr(z.gst) + '</td></tr><tr class="b"><td>Total</td><td class="r">' + inr(z.total) + '</td></tr>'
        + (Number(z.fee_credit) ? '<tr><td>Confirmation fee already paid</td><td class="r">− ' + inr(z.fee_credit) + '</td></tr>' : '') + '<tr class="b"><td>Balance to pay</td><td class="r">' + inr(z.balance) + '</td></tr>';
      var open = z.status === 'sent' && !z.expired, asked = z.status === 'changes_requested';
      var until = z.valid_until ? new Date(z.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
      var badge = z.expired ? 'Expired' : z.status === 'approved' ? 'Approved' : z.status === 'declined' ? 'Declined' : asked ? 'Changes requested' : 'Sent';
      var act = open || asked
        ? '<div class="tq-act">' + (open ? '<button class="btn btn-primary wide" type="button" data-q="approve" data-v="' + z.version + '">Approve the quote</button>' : '<p>You asked for changes' + (z.change_request ? ': “' + esc(z.change_request) + '”' : '') + '. We will send a revised quote. You can still approve this one below.</p><button class="btn btn-primary wide" type="button" data-q="approve" data-v="' + z.version + '">Approve this quote</button>')
          + '<label class="label" for="tq-why">If you reject it, tell us why (optional)</label><input id="tq-why" maxlength="200" autocomplete="off"><button class="btn btn-ghost wide" type="button" data-q="decline" data-v="' + z.version + '">Reject the quote</button>'
          + (open ? '<label class="label" for="tq-chg">Want something changed? Tell us what.</label><textarea id="tq-chg" maxlength="500" rows="2" autocomplete="off"></textarea><button class="btn btn-ghost wide" type="button" data-q="changes" data-v="' + z.version + '">Ask for changes</button>' : '') + '</div>'
        : '<p><b>' + (z.expired ? 'This quote has expired. Ask us for a fresh one.' : z.status === 'approved' ? 'You approved this quote.' : z.status === 'declined' ? 'You declined this quote.' : '') + '</b></p>';
      return '<div class="card track-card tq"><h3>' + (z.version > 1 ? 'Revised quote' : 'Your quote') + ' <small>' + esc(badge) + '</small></h3>' + (z.quote_no ? '<p class="tq-no"><small>' + esc(z.quote_no) + (until ? ' · ' + (z.expired ? 'expired on ' : 'valid until ') + esc(until) : '') + '</small></p>' : '') + '<table class="tq-t"><tbody>' + items + sum + '</tbody></table><p><b>Estimated delivery:</b> ' + esc(z.eta_text || 'to be confirmed') + '</p>' + (z.terms ? '<p class="tq-terms"><small>' + esc(z.terms) + '</small></p>' : '') + act + '<p class="tq-msg" id="tqMsg" role="status" aria-live="polite"></p></div>';
    }
    function draw(v) {
      var tl = v.visit, list = tl ? tl.steps : v.stages.map(function (s, i) { return { label: s, state: i < v.stage ? 'done' : i === v.stage ? 'current' : 'todo' }; });
      var closed = tl ? tl.closed : v.closed, note = tl ? tl.note : v.note, head = tl ? (closed ? 'Closed' : (list.filter(function (s) { return s.state === 'current'; })[0] || list[0]).label) : (closed ? 'Closed' : v.stages[v.stage]);
      var rows = [['Booking ID', v.booking_id], ['Service', v.service], [v.vehicle === 'car' ? 'Car' : 'Bike', v.bike], ['Address', v.address || v.area], ['When', v.when], ['Your mechanic', v.mechanic ? v.mechanic + (v.certified ? ' (Mechanix Pro certified)' : '') : null],
        ['Estimated delivery', tl && tl.eta], ['Confirmation fee', v.confirmation ? '₹' + v.confirmation.fee + (v.confirmation.paid ? ' paid. Adjusted in your final bill.' : ' (not paid yet)') : null], ['Starting estimate', !tl && v.estimate ? '₹' + Number(v.estimate).toLocaleString('en-IN') + ', GST included' : null]]
        .filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
      var code = v.door_code ? '<div class="card track-card tcode"><h3>Your code</h3><p class="tcode-n" aria-label="Your code is ' + esc(v.door_code.split('').join(' ')) + '">' + esc(v.door_code) + '</p><p><b>' + esc(v.door_line) + '</b></p></div>' : '';
      var next = (v.partner_garage ? '<p class="track-next"><b>' + esc(v.partner_garage.line) + '.</b> ' + esc(v.partner_garage.detail) + '</p>' : '') + (tl && tl.next ? '<p class="track-next"><b>What happens next.</b> ' + esc(tl.next) + '</p>' : '');
      var main = '<div class="card track-card fade" id="trMainCard">' + steps(list, closed) + '<p class="track-note"><b>' + esc(head) + '.</b> ' + esc(note) + '</p>' + next + '<dl class="rcpt-rows track-rows">' + rows + '</dl><div class="row"><a class="btn btn-wa btn-sm" href="#" data-wa="general">Message us on WhatsApp</a></div></div>';
      var fx = function () { if (!state.fxSteps && win.MXP_FX) { state.fxSteps = 1; win.MXP_FX.play(win, 'steps', doc.getElementById('trMain') || out); } };
      if (!tok) { put('trMain', main); fx(); return; }
      var J = v.journey || null, I = win.MXP_INSTALL, st = J && J.stage ? J.stage : '';
      put('trMain', main); fx();
      // thank-you right after payment (?paid=1), until the customer hides it
      if (paidMode && T()) put('trThanks', T().html({ bookingId: v.booking_id, token: tok, onTrack: true }) + '<p><button class="btn btn-ghost btn-sm" type="button" data-hide-thanks="1">Hide this</button></p>', 'thanks'); else put('trThanks', '', 'none');
      if (J && J.live && J.live.live && J.live.km != null && J.live.km > state.startKm) state.startKm = J.live.km;
      put('trLive', liveHtml(J && J.live, st, 0, state.startKm), JSON.stringify([st, J && J.live && [J.live.eta_line, J.live.age_s, J.live.maps_url]]));
      put('trCode', code, code);
      put('trQuote', quoteCard(v), JSON.stringify(v.quote || null));
      put('trDelivery', deliveryHtml(v.delivery), JSON.stringify(v.delivery || null));
      put('trCancel', cancelHtml(v.cancel), JSON.stringify(v.cancel || null));
      put('trCheck', proCheckCard(v.pro_check), JSON.stringify(v.pro_check || null));
      put('trRedo', redoCard(v.redo), JSON.stringify(v.redo || null));
      put('trShield', shieldCard(v.shield), JSON.stringify(v.shield || null));
      put('trClips', clipsCard(v.live_updates, v.job_on, v.booking_id), JSON.stringify([(v.live_updates || []).map(function (i) { return i.id; }), !!v.job_on]));   // signed links change on every poll, so only the ids decide a redraw
      if (J) {
        put('trDetails', detailsHtml(J.updates, state.msg), JSON.stringify([J.updates, state.msg]));
        put('trRate', rateHtml(J.rating, state.rated, C.googleReviewUrl), JSON.stringify([J.rating, state.rated]));
        put('trDocs', docsHtml(J), JSON.stringify(J.documents || null));
        put('trHist', histHtml(J), JSON.stringify([J.history, J.again]));
        var slot = doc.getElementById('trInstall');
        if (slot && !sigs.trInstall) { sigs.trInstall = 1; slot.innerHTML = '<div class="card track-card"><h3>Keep this on your phone</h3><p class="jy-meta">Add Mechanix Pro to your home screen to open your booking in one tap.</p><div data-install></div></div>'; if (I) I.mount(slot.querySelector('[data-install]'), win); }
        if (I) { if (v.status === 'lost' || v.status === 'junk' || v.status === 'cancelled' || v.closed) I.clearBooking(win); else I.saveBooking(win, { t: tok, id: v.booking_id }); }
      }
    }
    var T = function () { return win.MXP_THANKS; };
    var timer = null, lastLoad = 0;
    function load(quiet) {
      var body = tok ? { t: tok } : { ref: doc.getElementById('tr-ref').value.trim(), phone: doc.getElementById('tr-phone').value.trim() };
      if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Tracking is not available right now. Please message us on WhatsApp.'; return Promise.resolve(); }
      lastLoad = Date.now();
      return post('track-booking', body).then(function (x) { go.disabled = false; if (x.ok) { msg.textContent = ''; state.last = x.d; draw(x.d); } else if (!quiet) msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; })
        .catch(function () { go.disabled = false; if (!quiet) msg.textContent = 'No connection. Please try again.'; });
    }
    var say = function (id, text) { var el = doc.getElementById(id); if (el) el.textContent = text; };
    // compress a photo on the phone: longest side 1280 px, JPEG 0.7 (about 150 KB)
    var dataUrl = function (blob) { return new Promise(function (resolve, reject) { var r = new win.FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = function () { reject(new Error('read')); }; r.readAsDataURL(blob); }); };
    var compress = function (file) {
      return dataUrl(file).then(function (url) {
        return new Promise(function (resolve, reject) {
          var img = new win.Image();
          img.onload = function () { var k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (bl) { bl ? resolve(bl) : reject(new Error('compress')); }, 'image/jpeg', 0.7); };
          img.onerror = function () { reject(new Error('image')); }; img.src = url;   // a data: URL: the site's CSP blocks blob: images
        });
      });
    };
    function addPhotos(files) {
      files = files.slice(0, 3); if (!files.length) return;
      say('jyPhotoMsg', 'Preparing your photo…');
      Promise.all(files.map(compress)).then(function (blobs) {
        return post('booking-update', { action: 'photo_url', t: tok, types: blobs.map(function () { return 'image/jpeg'; }) }).then(function (x) {
          if (!x.ok) throw new Error((x.d && x.d.error) || 'Could not add the photo.');
          return Promise.all(x.d.uploads.map(function (u, i) { var fd = new win.FormData(); fd.append('cacheControl', '3600'); fd.append('', blobs[i]); return win.fetch(u.url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: fd }).then(function (r) { if (!r.ok) throw new Error('A photo did not upload. Check your internet and try again.'); return u.path; }); }));
        });
      }).then(function (paths) { return post('booking-update', { action: 'photo_done', t: tok, paths: paths }); })
        .then(function (x) { if (!x.ok) throw new Error((x.d && x.d.error) || 'Could not add the photo.'); state.msg = 'Photo added.'; sigs.trDetails = null; return load(true).then(function () { say('jyPhotoMsg', 'Photo added.'); }); })
        .catch(function (e) { say('jyPhotoMsg', e && e.message ? e.message : 'Could not add the photo. Please try again.'); });
    }
    var LABEL = { landmark: 'landmark', 'gate or parking note': 'gate or parking note', 'registration number': 'registration number', kilometres: 'kilometres', 'vehicle note': 'vehicle note', 'issue description': 'issue description' };
    out.addEventListener('submit', function (e) {
      var f = e.target; if (!tok) return; e.preventDefault();
      if (f.id === 'jyDetails') {
        var body = { action: 'save', t: tok }; ['landmark', 'access_note', 'reg_no', 'kms', 'vehicle_note', 'issue_text'].forEach(function (k) { if (f.elements[k]) body[k] = f.elements[k].value; });
        say('jyMsg', 'Saving…'); var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
        post('booking-update', body).then(function (x) {
          if (btn) btn.disabled = false;
          if (x.ok) { state.msg = x.d.unchanged ? 'Nothing changed.' : 'Saved: ' + (x.d.changed || []).map(function (c) { return LABEL[c] || c; }).join(', ') + '.'; say('jyMsg', state.msg); sigs.trDetails = null; load(true); }
          else { say('jyMsg', (x.d && x.d.error) || 'Could not save. Please try again.'); if (x.d && x.d.field && f.elements[x.d.field === 'reg_no' ? 'reg_no' : x.d.field]) f.elements[x.d.field].focus(); if (x.d && x.d.locked) load(true); }
        }).catch(function () { if (btn) btn.disabled = false; say('jyMsg', 'No connection. Your details are still on the screen. Please try again.'); });
      } else if (f.id === 'jyIssue') {
        var b = f.elements.body.value.trim(); if (b.length < 3) { say('jyIssueMsg', 'Tell us briefly what went wrong.'); f.elements.body.focus(); return; }
        say('jyIssueMsg', 'Sending…'); var bt = f.querySelector('button[type=submit]'); bt.disabled = true;
        post('booking-update', { action: 'issue', t: tok, category: f.elements.category.value, body: b }).then(function (x) {
          bt.disabled = false;
          if (x.ok) { f.elements.body.value = ''; sigs.trDetails = null; load(true).then(function () { say('jyIssueMsg', 'We got your report. Our team will look at it and contact you.'); }); } else say('jyIssueMsg', (x.d && x.d.error) || 'Could not send. Please try again.');
        }).catch(function () { bt.disabled = false; say('jyIssueMsg', 'No connection. Please try again.'); });
      } else if (f.id === 'jyRate') {
        var picked = f.querySelector('input[name=rating]:checked'); if (!picked) { say('jyRateMsg', 'Tap a number from 1 to 5 first.'); return; }
        say('jyRateMsg', 'Sending…'); var br = f.querySelector('button[type=submit]'); br.disabled = true;
        post('submit-rating', { t: tok, rating: Number(picked.value), comment: f.elements.comment.value }).then(function (x) {
          br.disabled = false;
          if (x.ok) { state.rated = (x.d && x.d.rating) || Number(picked.value); sigs.trRate = null; if (state.last) draw(state.last); } else say('jyRateMsg', (x.d && x.d.error) || 'Something went wrong. Please try again.');
        }).catch(function () { br.disabled = false; say('jyRateMsg', 'No connection. Please try again.'); });
      }
    });
    out.addEventListener('change', function (e) { if (e.target && e.target.id === 'jyFile') { var fl = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; addPhotos(fl); } });
    out.addEventListener('click', function (e) {
      var sb = e.target.closest('[data-shield]');
      if (sb && tok) {
        var sm = doc.getElementById('shMsg'), sw = doc.getElementById('sh-why');
        if (!(sw && sw.value.trim().length >= 10)) { sm.textContent = 'Tell us what was damaged and how, in a few words.'; return; }
        sb.disabled = true; sm.textContent = 'Sending…';
        post('shield-claim', { t: tok, description: sw.value }).then(function (x) {
          if (x.ok) load(true); else { sm.textContent = (x.d && x.d.error) || 'Could not send. Please try again.'; sb.disabled = false; }
        }).catch(function () { sm.textContent = 'No connection. Please try again.'; sb.disabled = false; });
        return;
      }
      var rb = e.target.closest('[data-redo]');
      if (rb && tok) {
        var rm = doc.getElementById('rdMsg'), rw = doc.getElementById('rd-why');
        if (!(rw && rw.value.trim().length >= 5)) { rm.textContent = 'Tell us what is not right, in a few words.'; return; }
        rb.disabled = true; rm.textContent = 'Sending…';
        post('redo-request', { t: tok, reason: rw.value }).then(function (x) {
          if (x.ok) load(true); else { rm.textContent = (x.d && x.d.error) || 'Could not send. Please try again.'; rb.disabled = false; }
        }).catch(function () { rm.textContent = 'No connection. Please try again.'; rb.disabled = false; });
        return;
      }
      var b = e.target.closest('[data-q]');
      if (b && tok) {
        var m = doc.getElementById('tqMsg'), why = doc.getElementById(b.getAttribute('data-q') === 'changes' ? 'tq-chg' : 'tq-why');
        if (b.getAttribute('data-q') === 'changes' && !(why && why.value.trim())) { m.textContent = 'Tell us what you would like changed.'; return; }
        // Rejecting asks once more, so a stray tap never ends the quote.
        if (b.getAttribute('data-q') === 'decline' && !b.getAttribute('data-sure')) { b.setAttribute('data-sure', '1'); b.textContent = 'Yes, reject this quote'; m.textContent = 'Reject this quote? Tap the button again to confirm. We will not start the work.'; return; }
        Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (x) { x.disabled = true; }); m.textContent = 'Saving…';
        post('quote-decision', { t: tok, version: Number(b.getAttribute('data-v')), decision: b.getAttribute('data-q'), reason: why ? why.value : '', source: 'track' }).then(function (x) {
          if (x.ok) load(true); else { m.textContent = (x.d && x.d.error) || 'Could not save. Please try again.'; if (x.d && x.d.superseded) load(true); Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (y) { y.disabled = false; }); }
        }).catch(function () { m.textContent = 'No connection. Please try again.'; Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (y) { y.disabled = false; }); });
        return;
      }
      var h = e.target.closest('[data-hide-thanks]');
      if (h) { paidMode = false; try { var u = new win.URL(win.location.href); u.searchParams.delete('paid'); win.history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (x) {} sigs.trThanks = null; if (state.last) draw(state.last); return; }
      var dk = e.target.closest('[data-doc]');
      if (dk && state.last && state.last.journey) {
        var slot = doc.getElementById('jyDocSlot'), k = dk.getAttribute('data-doc'), docs = state.last.journey.documents, company = out.getAttribute('data-company') || '';
        if (k === 'print') { win.print(); return; } if (k === 'close') { slot.innerHTML = ''; return; }
        slot.innerHTML = docView(k, k === 'receipt' ? docs.receipt : docs.invoice, company); var v = doc.getElementById('jyDocView'); if (v) v.scrollIntoView({ block: 'nearest' });
      }
    });
    if (tok) {
      form.hidden = true; msg.textContent = 'Loading your booking…';
      var tick = function () {
        var J = state.last && state.last.journey, every = J && J.stage === 'on_the_way' ? 20000 : 30000;   // a little faster while the mechanic is on the way
        timer = win.setTimeout(function () { if (!doc.hidden) load(true).then(tick); else tick(); }, every);   // only while the page is visible
      };
      load(false).then(function () { tick(); var th = paidMode && doc.getElementById('jyThanksH'); if (th) th.focus({ preventScroll: true }); });
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden && Date.now() - lastLoad > 10000) load(true); });
      return;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault(); out.innerHTML = '<div id="trMain"></div>'; sigs = {};
      var ref = doc.getElementById('tr-ref').value.trim(), phone = doc.getElementById('tr-phone').value.trim();
      if (!ref || !phone) { msg.textContent = 'Enter your reference and the mobile number you booked with.'; return; }
      go.disabled = true; msg.textContent = 'Checking…'; load(false);
    });
  }
  return { init: init, liveHtml: liveHtml, detailsHtml: detailsHtml, rateHtml: rateHtml, docsHtml: docsHtml, docView: docView, histHtml: histHtml, deliveryHtml: deliveryHtml, cancelHtml: cancelHtml, againUrl: againUrl, ago: ago };
});
