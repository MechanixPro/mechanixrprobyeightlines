/* Track your booking: sends the reference and number to the track-booking function and draws the progress. No inline script (CSP). */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('trackForm'), msg = document.getElementById('trMsg'), out = document.getElementById('trResult'), go = document.getElementById('trGo');
  if (!form) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q = new URLSearchParams(location.search), preRef = (q.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  if (preRef) document.getElementById('tr-ref').value = preRef;
  function draw(v) {
    var steps = v.stages.map(function (s, i) {
      var cls = v.closed ? 'todo' : i < v.stage ? 'done' : i === v.stage ? 'now' : 'todo';
      return '<li class="' + cls + '"><i aria-hidden="true"></i><span>' + esc(s) + '</span></li>';
    }).join('');
    var rows = [['Reference', v.ref], ['Service', v.service], ['Bike', v.bike], ['Area', v.area], ['When', v.when], ['Your mechanic', v.mechanic ? v.mechanic + (v.certified ? ' (Mechanix Pro certified)' : '') : null], ['Starting estimate', v.estimate ? '₹' + Number(v.estimate).toLocaleString('en-IN') + ', GST included' : null]]
      .filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    out.innerHTML = '<div class="card track-card fade"><ol class="track-steps' + (v.closed ? ' closed' : '') + '" aria-label="Progress">' + steps + '</ol><p class="track-note"><b>' + esc(v.closed ? 'Closed' : v.stages[v.stage]) + '.</b> ' + esc(v.note) + '</p><dl class="rcpt-rows track-rows">' + rows + '</dl><div class="row"><a class="btn btn-wa btn-sm" href="#" data-wa="general">Message us on WhatsApp</a></div></div>';
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ref = document.getElementById('tr-ref').value.trim(), phone = document.getElementById('tr-phone').value.trim();
    out.innerHTML = '';
    if (!ref || !phone) { msg.textContent = 'Enter your reference and the mobile number you booked with.'; return; }
    if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Tracking is not available right now. Please message us on WhatsApp.'; return; }
    go.disabled = true; msg.textContent = 'Checking…';
    fetch(C.supabaseUrl + '/functions/v1/track-booking', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify({ ref: ref, phone: phone }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { go.disabled = false; if (x.ok) { msg.textContent = ''; draw(x.d); } else msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; })
      .catch(function () { go.disabled = false; msg.textContent = 'No connection. Please try again.'; });
  });
})();
