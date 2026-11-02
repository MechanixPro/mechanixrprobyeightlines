/* Shared behaviour for area and legal pages: WhatsApp buttons and phone number from config. */
(function () {
  var C = window.MXP || {};
  var num = String(C.whatsapp || '').replace(/\D/g, '');
  // for visitors who came from an ad, the message ends with a short Ref code so the booking can be linked to the ad click
  var T = function (t) { return window.MXP_ADREF ? window.MXP_ADREF.tag(t) : t; };
  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-wa]'); if (!w) return; e.preventDefault();
    if (!/^\d{12}$/.test(num)) return alert('WhatsApp number is not set yet.');
    var area = w.getAttribute('data-wa');
    var custom = w.getAttribute('data-wa-text');
    if (custom) { location.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(T(custom)); return; }
    location.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(T('Hi Mechanix Pro, I need a bike service' + (area && area !== 'Contact' ? ' in ' + area : '') + '.'));
  });
  function callHref() { var d = String(C.callNumber || C.whatsapp || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return /^91[6-9]\d{9}$/.test(d) ? 'tel:+' + d : null; }
  document.addEventListener('click', function (e) { var c = e.target.closest('[data-call]'); if (!c) return; var t = callHref(); if (!t) { e.preventDefault(); return alert('Phone number is not set yet.'); } c.setAttribute('href', t); });

  // Call buttons open a WhatsApp chat instead of a phone call while MXP.callViaWhatsApp is on (config.js).
  function callsToWhatsApp() {
    if (!C.callViaWhatsApp) return;
    var n = String(C.whatsapp || '').replace(/\D/g, ''); if (!/^\d{12}$/.test(n)) return;
    document.querySelectorAll('[data-call]').forEach(function (a) {
      a.removeAttribute('data-call'); a.setAttribute('data-wa', 'Contact'); a.setAttribute('data-wa-text', 'Hi Mechanix Pro, I need help with my bike or car.'); a.setAttribute('href', 'https://wa.me/' + n);
      if (a.getAttribute('aria-label')) a.setAttribute('aria-label', a.getAttribute('aria-label').replace(/\bCall\b/, 'WhatsApp'));
      a.childNodes.forEach(function (c) { if (c.nodeType === 3) c.textContent = c.textContent.replace(/\bCall\b/, 'WhatsApp'); });
    });
    document.querySelectorAll('[data-phone]').forEach(function (el) { el.textContent = '+91 ' + n.slice(2, 7) + ' ' + n.slice(7); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var t0 = callHref(); if (t0) document.querySelectorAll('[data-call]').forEach(function (a) { a.setAttribute('href', t0); });
    if (C.phoneDisplay) document.querySelectorAll('[data-phone]').forEach(function (el) { el.textContent = C.phoneDisplay; });
    callsToWhatsApp();
  });
})();
