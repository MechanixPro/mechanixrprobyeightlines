/* The thank-you after payment. One piece of markup used twice: on /book/ right after the payment is verified, and on /track/ while the link has ?paid=1.
   Warm and short: the booking ID, what happens next in three lines, a big Track button, Add to home screen, Add details or report an issue, WhatsApp and Call. No inline script (CSP). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_THANKS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var TOKEN = /^[0-9a-f]{32}$/;
  var NEXT = [
    'We assign your mechanic. You see the name on your tracking page and get an email when they set off.',
    'At your door, give the mechanic your one-time code. Nothing starts before that.',
    'You get an itemised quote to approve first. Your confirmation fee is adjusted in the final bill.'
  ];
  /* o: { bookingId, email, token, name, onTrack } . onTrack = already on the tracking page (the Track button then scrolls to the progress instead of reloading). */
  function html(o) {
    o = o || {}; var t = TOKEN.test(String(o.token || '')) ? o.token : null, first = String(o.name || '').trim().split(/\s+/)[0];
    var track = t ? (o.onTrack ? '#trMain' : '/track/?t=' + t + '&paid=1') : '/track/';
    var details = t ? (o.onTrack ? '#trDetails' : '/track/?t=' + t + '#trDetails') : '/track/';
    return '<section class="card jy-thanks" aria-labelledby="jyThanksH">'
      + '<h2 id="jyThanksH" tabindex="-1">Thank you' + (first ? ', ' + esc(first) : '') + '. Your slot is confirmed.</h2>'
      + '<p class="jy-id">' + (o.bookingId ? 'Booking ID <b>' + esc(o.bookingId) + '</b>' : 'Your booking is confirmed') + '</p>'
      + (o.email ? '<p class="jy-sub">We sent your confirmation and your one-time code to <b>' + esc(o.email) + '</b>' + (o.whatsapp === false ? '.' : ' and on WhatsApp.') + '</p>' : '')
      + '<ol class="jy-next" aria-label="What happens next">' + NEXT.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>'
      + '<a class="btn btn-primary wide jy-track" href="' + esc(track) + '">Track your booking</a>'
      + '<div class="jy-install" data-install></div>'
      + '<a class="btn btn-ghost wide" href="' + esc(details) + '">Add details or report an issue</a>'
      + '<div class="jy-help"><a class="btn btn-wa btn-sm" href="#" data-wa="general">Message us on WhatsApp</a> <a class="btn btn-ghost btn-sm" href="#" data-call>Call us</a></div>'
      + '<p class="tiny muted">Your tracking link is private to you. We saved it on this phone, so Mechanix Pro can show it as Your booking.</p></section>';
  }
  /* Draws the card into el, mounts the home-screen area and moves focus to the heading (screen readers announce it). */
  function render(el, win, o) {
    el.innerHTML = html(o);
    var slot = el.querySelector('[data-install]'); if (slot && win.MXP_INSTALL) win.MXP_INSTALL.mount(slot, win);
    var h = el.querySelector('#jyThanksH'); if (h && h.focus) h.focus({ preventScroll: true });
    if (el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }
  return { html: html, render: render, NEXT: NEXT };
});
