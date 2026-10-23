/* "Add to your home screen": shown only when the browser says the site can be installed (Chrome and Android). Quick access for riders who come back. */
(function () {
  'use strict';
  var ev = null;
  function remove() { var b = document.getElementById('installApp'); if (b && b.parentNode) b.parentNode.removeChild(b); }
  function show() {
    var f = document.querySelector('footer'); if (!f || document.getElementById('installApp')) return;
    var b = document.createElement('button'); b.id = 'installApp'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = 'Add Mechanix Pro to your home screen';
    b.addEventListener('click', function () { if (!ev) return; var e = ev; ev = null; e.prompt(); if (e.userChoice) e.userChoice.then(remove, remove); });
    var w = document.createElement('div'); w.className = 'wrap install-row'; w.appendChild(b); f.appendChild(w);
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); ev = e; show(); });
  window.addEventListener('appinstalled', remove);
})();
