/* Rate your service: sends the rating to the submit-rating function. The booking reference and signature come from the link. No inline script (CSP). */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('rateForm'), msg = document.getElementById('rtMsg'), go = document.getElementById('rtGo'), done = document.getElementById('rtDone');
  if (!form) return;
  var q = new URLSearchParams(location.search);
  var ref = (q.get('r') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9), k = (q.get('k') || '').toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 24);
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  if (!/^MP-[A-Z0-9]{6}$/.test(ref) || !/^[a-f0-9]{24}$/.test(k)) {
    form.hidden = true;
    done.innerHTML = '<div class="card fade"><h2>This link is not valid</h2><p>Please use the link from your WhatsApp message, or message us and we will help.</p></div>';
    return;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var picked = form.querySelector('input[name=rating]:checked');
    if (!picked) { msg.textContent = 'Tap a number from 1 to 5 first.'; return; }
    if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Rating is not available right now. Please message us on WhatsApp.'; return; }
    go.disabled = true; msg.textContent = 'Sending…';
    fetch(C.supabaseUrl + '/functions/v1/submit-rating', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
      body: JSON.stringify({ ref: ref, k: k, rating: Number(picked.value), comment: document.getElementById('rt-comment').value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        go.disabled = false;
        if (!x.ok) { msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; return; }
        form.hidden = true; var n = x.d.rating || Number(picked.value);
        done.innerHTML = '<div class="card fade"><h2>Thank you!</h2><p>' + (n <= 3 ? 'We are sorry it was not better. Someone from our team will call you to put it right.' : 'We are glad it went well. Thank you for choosing Mechanix Pro.') + '</p></div>';
      })
      .catch(function () { go.disabled = false; msg.textContent = 'No connection. Please try again.'; });
  });
})();
