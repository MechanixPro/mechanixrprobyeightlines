/* Mechu, the Mechanix Pro virtual assistant: the small round button. A guided script, not an AI model and not a person.
   Loads after the page is ready; the chat itself (mechu-chat.js) and its facts (mechu-data.js) load on the first tap or hover.
   If this file fails, the page is unchanged: there is simply no button. No inline script (CSP). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else if (root.document) api.start(root);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* single-task pages never get the button: booking, payment, tracking, job, rating, warranty, unsubscribe (and staff pages) */
  var OFF = /^\/(book|pay|track|job|rate|warranty|unsubscribe|quote|admin|crm)(\/|$)/;
  function isExcluded(path) { return OFF.test(String(path || '')); }

  function loadScript(win, src) {
    return new Promise(function (ok, bad) {
      var s = win.document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = bad; win.document.head.appendChild(s);
    });
  }
  function start(win) {
    var doc = win.document;
    if (isExcluded(win.location.pathname) || doc.querySelector('.mechu-btn')) return;
    var btn = null, chat = null;
    function ready() {
      if (win.MXP_MECHU_CHAT) return Promise.resolve(win.MXP_MECHU_CHAT);
      if (!chat) chat = loadScript(win, '/assets/js/mechu-data.js').then(function () { return loadScript(win, '/assets/js/mechu-chat.js'); }).then(function () { return win.MXP_MECHU_CHAT; });
      return chat;
    }
    function build() {
      btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'mechu-btn';
      btn.setAttribute('aria-label', 'Chat with Mechu, the Mechanix Pro virtual assistant'); btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
      var img = doc.createElement('img'); img.src = '/assets/img/mechu-avatar.svg'; img.alt = ''; img.width = 58; img.height = 58; img.setAttribute('aria-hidden', 'true'); btn.appendChild(img);
      ['pointerenter', 'touchstart', 'focus'].forEach(function (e) { btn.addEventListener(e, function () { ready().catch(function () {}); }, { passive: true, once: true }); });
      btn.addEventListener('click', function () {
        ready().then(function (c) { if (c) c.toggle(btn); }).catch(function () { btn.remove(); });   // if the chat cannot load, the button goes away
      });
      doc.body.appendChild(btn);
    }
    function go() {
      var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/css/mechu.css';
      l.onload = build; l.onerror = function () {};   // no style, no button
      doc.head.appendChild(l);
    }
    var later = function () { (win.requestIdleCallback || function (f) { win.setTimeout(f, 200); })(go); };
    if (doc.readyState === 'complete') later(); else win.addEventListener('load', later, { once: true });
  }
  return { isExcluded: isExcluded, start: start };
});
