/* Shared behaviour for area and legal pages: WhatsApp buttons and phone number from config. */
(function () {
  var C = window.MXP || {};
  var num = String(C.whatsapp || '').replace(/\D/g, '');
  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-wa]'); if (!w) return; e.preventDefault();
    if (!/^\d{12}$/.test(num)) return alert('WhatsApp number is not set yet.');
    var area = w.getAttribute('data-wa');
    location.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent('Hi Mechanix Pro, I need a bike service' + (area && area !== 'Contact' ? ' in ' + area : '') + '.');
  });
  function callHref() { var d = String(C.callNumber || C.whatsapp || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return /^91[6-9]\d{9}$/.test(d) ? 'tel:+' + d : null; }
  document.addEventListener('click', function (e) { var c = e.target.closest('[data-call]'); if (!c) return; var t = callHref(); if (!t) { e.preventDefault(); return alert('Phone number is not set yet.'); } c.setAttribute('href', t); });
  document.addEventListener('DOMContentLoaded', function () {
    var t0 = callHref(); if (t0) document.querySelectorAll('[data-call]').forEach(function (a) { a.setAttribute('href', t0); });
    if (C.phoneDisplay) document.querySelectorAll('[data-phone]').forEach(function (el) { el.textContent = C.phoneDisplay; });
  });
})();
