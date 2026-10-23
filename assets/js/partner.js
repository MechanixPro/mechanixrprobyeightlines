/* "Join us" form: garages and independent mechanics apply here. Sent to the submit-partner function; it lands in the Care Buddy desk. */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('partnerForm'); if (!form) return;
  var msg = document.getElementById('ptMsg'), busy = false, $ = function (id) { return document.getElementById(id); };
  function say(t, ok) { msg.textContent = t; msg.className = 'wl-msg ' + (ok ? 'ok' : 'bad'); }
  function kind() { var r = form.querySelector('input[name="pt-kind"]:checked'); return r ? r.value : 'garage'; }
  function swap() { var g = kind() === 'garage'; $('pt-name-wrap').hidden = !g; $('pt-bays-wrap').hidden = !g; }
  form.querySelectorAll('input[name="pt-kind"]').forEach(function (r) { r.addEventListener('change', swap); }); swap();
  form.addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    var work = [].filter.call(form.querySelectorAll('input[name="pt-work"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
    var mobile = $('pt-mobile').value.replace(/\D/g, '').slice(-10), pin = $('pt-pin').value.replace(/\D/g, '');
    if ($('pt-owner').value.trim().length < 2) return say('Enter your name.');
    if (!/^[6-9]\d{9}$/.test(mobile)) return say('Enter a valid 10-digit mobile number.');
    if (kind() === 'garage' && $('pt-name').value.trim().length < 2) return say('Enter your garage name.');
    if ($('pt-address').value.trim().length < 3) return say('Enter your area or address in Bengaluru.');
    if (pin && !/^\d{6}$/.test(pin)) return say('Enter a valid 6-digit PIN code, or leave it empty.');
    if (!work.length) return say('Pick at least one kind of vehicle you work on.');
    if (!$('pt-consent').checked) return say('Please tick the box so we may contact you.');
    if (!C.supabaseUrl || !C.supabaseAnonKey) return say('Applications are not available right now. Please message us on WhatsApp.');
    busy = true; say('Sending…', true);
    fetch(C.supabaseUrl + '/functions/v1/submit-partner', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey },
      body: JSON.stringify({ kind: kind(), name: $('pt-name').value, owner_name: $('pt-owner').value, mobile: mobile, address: $('pt-address').value, pincode: pin, categories: work, bays: $('pt-bays').value, note: $('pt-note').value, consent: true }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { if (x.ok) { form.reset(); swap(); say(x.d && x.d.duplicate ? 'We already have an application from this number. Our team will call you soon.' : 'Thank you! Our team will call you soon.', true); } else say((x.d && x.d.error) || 'Something went wrong. Please try again.'); })
      .catch(function () { say('No connection. Please try again.'); })
      .then(function () { busy = false; });
  });
})();
