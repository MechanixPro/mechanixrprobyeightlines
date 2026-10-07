/* Unsubscribe page: sends the signed link details to the unsubscribe function and shows the result. No inline script (CSP). */
(function () {
  'use strict';
  var C = window.MXP || {}, q = new URLSearchParams(location.search), c = q.get('c') || '', t = q.get('t') || '';
  var btn = document.getElementById('unsubGo'), msg = document.getElementById('unsubMsg');
  if (!btn || !msg) return;
  if (!c || !t) { btn.hidden = true; msg.textContent = 'This link is incomplete. Please use the unsubscribe link from the email, or write to hello@mechanixpro.in.'; return; }
  btn.addEventListener('click', function () {
    btn.disabled = true; msg.textContent = 'Updating…';
    fetch(C.supabaseUrl + '/functions/v1/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify({ c: c, t: t }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { if (x.ok) { btn.hidden = true; msg.textContent = 'Done. You will not get offer emails from Mechanix Pro any more. Booking updates about your own service will still reach you.'; } else { btn.disabled = false; msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; } })
      .catch(function () { btn.disabled = false; msg.textContent = 'No connection. Please try again.'; });
  });
})();
