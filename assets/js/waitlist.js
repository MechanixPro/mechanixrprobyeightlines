/* Coming-soon waitlist: "Notify me" ticks the service and jumps to the form; the form is sent to the join-waitlist function. */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('waitlistForm'); if (!form) return;
  var msg = document.getElementById('wlMsg'), boxes = form.querySelectorAll('input[name="wl-interest"]'), busy = false;
  function say(t, ok) { msg.textContent = t; msg.className = 'wl-msg ' + (ok ? 'ok' : 'bad'); }
  if (form.dataset.preselect) boxes.forEach(function (x) { if (x.value === form.dataset.preselect) x.checked = true; });
  var slug = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'home').replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 24) || 'home';
  document.querySelectorAll('[data-interest]').forEach(function (b) {
    b.addEventListener('click', function () {
      boxes.forEach(function (x) { if (x.value === b.getAttribute('data-interest')) x.checked = true; });
      form.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      setTimeout(function () { var n = document.getElementById('wl-name'); if (n) n.focus({ preventScroll: true }); }, 400);
    });
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    var picked = [].filter.call(boxes, function (x) { return x.checked; }).map(function (x) { return x.value; });
    var phone = document.getElementById('wl-phone').value.replace(/\D/g, '').slice(-10), email = document.getElementById('wl-email').value.trim();
    if (!picked.length) return say('Pick at least one service you are interested in.');
    if (!phone && !email) return say('Give a mobile number or an email so we can reach you.');
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return say('Enter a valid 10-digit mobile number.');
    if (!document.getElementById('wl-consent').checked) return say('Please tick the box so we may contact you.');
    if (!C.supabaseUrl || !C.supabaseAnonKey) return say('The waitlist is not available right now. Please message us on WhatsApp.');
    busy = true; say('Sending\u2026', true);
    fetch(C.supabaseUrl + '/functions/v1/join-waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
      body: JSON.stringify({ name: document.getElementById('wl-name').value, phone: phone, email: email, interests: picked, source: 'page:' + slug, city: document.getElementById('wl-city').value, note: document.getElementById('wl-note').value, consent: true }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { if (x.ok) { form.reset(); say('You are on the list! We will message you as soon as it starts.', true); } else say((x.d && x.d.error) || 'Something went wrong. Please try again.'); })
      .catch(function () { say('No connection. Please try again.'); })
      .then(function () { busy = false; });
  });
})();
