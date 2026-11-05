/* Track your booking. Two ways in: the reference and mobile number, or the private link from the confirmation email (?t=...).
   The link adds the one-time code, the address you gave, the itemised quote with Approve and Decline, and the delivery estimate.
   Sends to the track-booking and quote-decision functions and draws the progress. No inline script (CSP). */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('trackForm'), msg = document.getElementById('trMsg'), out = document.getElementById('trResult'), go = document.getElementById('trGo');
  if (!form) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q = new URLSearchParams(location.search), preRef = (q.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 13), tok = (q.get('t') || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(tok)) tok = '';
  if (preRef) document.getElementById('tr-ref').value = preRef;
  var inr = function (n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var KIND = { parts: 'Parts', labour: 'Labour', other: 'Other' };
  var post = function (fn, body) {
    return fetch(C.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  };
  function steps(list, closed) {
    return '<ol class="track-steps' + (closed ? ' closed' : '') + '" aria-label="Progress">' + list.map(function (s) {
      var cls = closed ? 'todo' : s.state === 'done' ? 'done' : s.state === 'current' ? 'now' : 'todo';
      return '<li class="' + cls + '"' + (cls === 'now' ? ' aria-current="step"' : '') + '><i aria-hidden="true"></i><span>' + esc(s.label) + '</span></li>';
    }).join('') + '</ol>';
  }
  function quoteCard(v) {
    var z = v.quote; if (!z || !z.lines) return z ? '<div class="card track-card"><h3>Quote</h3><p>Status: <b>' + esc(z.status) + '</b>. Open the link in your email to review it.</p></div>' : '';
    var items = z.lines.map(function (l) { return '<tr><td>' + esc(l.name) + ' <small>' + esc(KIND[l.kind] || l.kind) + '</small></td><td class="r">' + inr(l.amount) + '</td></tr>'; }).join('');
    var sum = '<tr><td>Subtotal (before GST)</td><td class="r">' + inr(z.subtotal) + '</td></tr><tr><td>GST @ 18%</td><td class="r">' + inr(z.gst) + '</td></tr><tr class="b"><td>Total</td><td class="r">' + inr(z.total) + '</td></tr>'
      + (Number(z.fee_credit) ? '<tr><td>Confirmation fee already paid</td><td class="r">− ' + inr(z.fee_credit) + '</td></tr>' : '') + '<tr class="b"><td>Balance to pay</td><td class="r">' + inr(z.balance) + '</td></tr>';
    var act = z.status === 'sent'
      ? '<div class="tq-act"><button class="btn btn-primary wide" type="button" data-q="approve" data-v="' + z.version + '">Approve the quote</button><label class="label" for="tq-why">If you decline, tell us why (optional)</label><input id="tq-why" maxlength="200" autocomplete="off"><button class="btn btn-ghost wide" type="button" data-q="decline" data-v="' + z.version + '">Decline</button></div>'
      : '<p><b>' + (z.status === 'approved' ? 'You approved this quote.' : z.status === 'declined' ? 'You declined this quote.' : '') + '</b></p>';
    return '<div class="card track-card tq"><h3>' + (z.version > 1 ? 'Revised quote' : 'Your quote') + '</h3><table class="tq-t"><tbody>' + items + sum + '</tbody></table><p><b>Estimated delivery:</b> ' + esc(z.eta_text || 'to be confirmed') + '</p>' + act + '<p class="tq-msg" id="tqMsg" role="status" aria-live="polite"></p></div>';
  }
  function draw(v) {
    var tl = v.visit, list = tl ? tl.steps : v.stages.map(function (s, i) { return { label: s, state: i < v.stage ? 'done' : i === v.stage ? 'current' : 'todo' }; });
    var closed = tl ? tl.closed : v.closed, note = tl ? tl.note : v.note, head = tl ? (closed ? 'Closed' : (list.filter(function (s) { return s.state === 'current'; })[0] || list[0]).label) : (closed ? 'Closed' : v.stages[v.stage]);
    var rows = [['Booking ID', v.booking_id], ['Service', v.service], [v.vehicle === 'car' ? 'Car' : 'Bike', v.bike], ['Address', v.address || v.area], ['When', v.when], ['Your mechanic', v.mechanic ? v.mechanic + (v.certified ? ' (Mechanix Pro certified)' : '') : null],
      ['Estimated delivery', tl && tl.eta], ['Confirmation fee', v.confirmation ? '₹' + v.confirmation.fee + (v.confirmation.paid ? ' paid. Adjusted in your final bill.' : ' (not paid yet)') : null], ['Starting estimate', !tl && v.estimate ? '₹' + Number(v.estimate).toLocaleString('en-IN') + ', GST included' : null]]
      .filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    var code = v.door_code ? '<div class="card track-card tcode"><h3>Your code</h3><p class="tcode-n" aria-label="Your code is ' + esc(v.door_code.split('').join(' ')) + '">' + esc(v.door_code) + '</p><p><b>' + esc(v.door_line) + '</b></p></div>' : '';
    var next = tl && tl.next ? '<p class="track-next"><b>What happens next.</b> ' + esc(tl.next) + '</p>' : '';
    out.innerHTML = '<div class="card track-card fade">' + steps(list, closed) + '<p class="track-note"><b>' + esc(head) + '.</b> ' + esc(note) + '</p>' + next + '<dl class="rcpt-rows track-rows">' + rows + '</dl><div class="row"><a class="btn btn-wa btn-sm" href="#" data-wa="general">Message us on WhatsApp</a></div></div>' + code + (tok ? quoteCard(v) : '');
  }
  function load(quiet) {
    var body = tok ? { t: tok } : { ref: document.getElementById('tr-ref').value.trim(), phone: document.getElementById('tr-phone').value.trim() };
    if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Tracking is not available right now. Please message us on WhatsApp.'; return Promise.resolve(); }
    return post('track-booking', body).then(function (x) { go.disabled = false; if (x.ok) { msg.textContent = ''; draw(x.d); } else if (!quiet) msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; })
      .catch(function () { go.disabled = false; if (!quiet) msg.textContent = 'No connection. Please try again.'; });
  }
  out.addEventListener('click', function (e) {
    var b = e.target.closest('[data-q]'); if (!b || !tok) return; var m = document.getElementById('tqMsg'), why = document.getElementById('tq-why');
    Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (x) { x.disabled = true; }); m.textContent = 'Saving…';
    post('quote-decision', { t: tok, version: Number(b.getAttribute('data-v')), decision: b.getAttribute('data-q'), reason: why ? why.value : '' }).then(function (x) {
      if (x.ok) load(true); else { m.textContent = (x.d && x.d.error) || 'Could not save. Please try again.'; if (x.d && x.d.superseded) load(true); Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (y) { y.disabled = false; }); }
    }).catch(function () { m.textContent = 'No connection. Please try again.'; Array.prototype.forEach.call(out.querySelectorAll('[data-q]'), function (y) { y.disabled = false; }); });
  });
  if (tok) {
    form.hidden = true; msg.textContent = 'Loading your booking…'; load(false);
    setInterval(function () { if (!document.hidden) load(true); }, 30000);   // the page follows the mechanic's steps
    return;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); out.innerHTML = '';
    var ref = document.getElementById('tr-ref').value.trim(), phone = document.getElementById('tr-phone').value.trim();
    if (!ref || !phone) { msg.textContent = 'Enter your reference and the mobile number you booked with.'; return; }
    go.disabled = true; msg.textContent = 'Checking…'; load(false);
  });
})();
