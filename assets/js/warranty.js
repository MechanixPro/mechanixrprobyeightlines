/* Warranty card page: reads the card number from the link (?c=MPW-XXXXXX), asks the public verify function, and shows the card. No personal data is stored in the browser. */
(function () {
  'use strict';
  var cfg = window.MXP_CONFIG || window.MXP || {}, base = (cfg.supabaseUrl || 'https://mejdxsbpyscujpvbwvmg.supabase.co').replace(/\/$/, '');
  var lead = document.getElementById('wrLead'), box = document.getElementById('wrCard'); if (!box) return;
  var code = (new URLSearchParams(location.search).get('c') || '').toUpperCase().trim();
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (d) { try { return new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); } catch (e) { return d; } };
  function fail(msg) { lead.textContent = msg; box.innerHTML = ''; }
  if (!/^MPW-[23456789A-HJ-NP-Z]{6}$/.test(code)) return fail('Open the link from your WhatsApp message, or scan the QR on your card.');
  fetch(base + '/functions/v1/warranty-verify?c=' + encodeURIComponent(code)).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
    if (!x.ok || !x.j.valid) return fail((x.j && x.j.error) || 'We could not find that card.');
    var c = x.j, live = c.status === 'active';
    lead.textContent = live ? 'This warranty is genuine and active.' : 'This warranty is genuine, but it has ended.';
    box.innerHTML = '<article class="wr-card' + (live ? '' : ' ended') + '"><header><img src="/assets/img/logo.svg" alt="" width="28" height="29"><b>MECHANIX PRO</b><span class="wr-state">' + (live ? 'Active' : 'Ended') + '</span></header>' +
      '<h2>' + esc(c.customer) + '</h2><p class="wr-sub">' + esc([c.bike, c.vehicle].filter(Boolean).join(' · ')) + '</p>' +
      '<dl><dt>Service</dt><dd>' + esc(c.service || 'Service') + '</dd><dt>Done on</dt><dd>' + esc(fmt(c.done_on)) + '</dd><dt>Valid until</dt><dd><b>' + esc(fmt(c.valid_until)) + '</b></dd><dt>Card number</dt><dd>' + esc(c.code) + '</dd></dl>' +
      '<div class="wr-qr" role="img" aria-label="QR code for this card">' + (c.qr_svg || '') + '</div></article>' +
      '<h3>Terms</h3><ul class="wr-terms">' + (c.terms || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  }).catch(function () { fail('We could not check the card right now. Please try again in a minute.'); });
})();
