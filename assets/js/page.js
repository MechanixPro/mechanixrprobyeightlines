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
  document.addEventListener('DOMContentLoaded', function () {
    if (C.phoneDisplay) document.querySelectorAll('[data-phone]').forEach(function (el) { el.textContent = C.phoneDisplay; });
  });
})();
