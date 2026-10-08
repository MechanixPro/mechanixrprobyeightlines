/* "Do you serve my PIN code?" Works on any page with a [data-pincheck] box. Needs assets/js/pincodes.js. Nothing is sent anywhere. */
(function () {
  'use strict';
  function say(pin) {
    if (!/^\d{6}$/.test(pin)) return { text: '', cls: '' };
    var pins = window.MXP_PINS || {}, off = window.MXP_PINS_OFF || {}, n = +pin, name = pins[pin];
    if (off[pin]) return { text: 'We do not serve ' + pin + ' yet. Build your service anyway and we will tell you when we reach you.', cls: 'no' };
    if (name) return { text: 'Yes, we serve ' + name + ' (' + pin + ').', cls: 'ok', link: pin };
    if (n >= 560001 && n <= 560110) return { text: 'Yes, ' + pin + ' is in Bengaluru and we serve it.', cls: 'ok', link: pin };
    return { text: pin + ' is outside Bengaluru. Build your service anyway and we will tell you when we reach you.', cls: 'no' };
  }
  document.querySelectorAll('[data-pincheck]').forEach(function (box) {
    var input = box.querySelector('input'), out = box.querySelector('.pc-out');
    if (!input || !out) return;
    function update() {
      var v = input.value.replace(/\D/g, '').slice(0, 6); if (v !== input.value) input.value = v;
      var r = say(v); out.className = 'pc-out ' + r.cls; out.textContent = r.text;
      if (r.link) { var a = document.createElement('a'); a.href = '/book/?pin=' + r.link; a.textContent = ' Build your service'; out.appendChild(a); }
    }
    input.addEventListener('input', update);
    document.addEventListener('mxp:pins', update);
  });
})();
