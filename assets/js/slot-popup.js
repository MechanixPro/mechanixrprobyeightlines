/* "Book your slot" prompt. A small card, not a full-screen block: bottom sheet on phones (above the tab bar), corner card on larger screens.
   Shows once per visit after the visitor has had a look round (about 20 seconds, or 40% scroll, or the cursor leaving the top of the window on a computer).
   Closing it hides it for 3 days. Tapping Book hides it for 14 days. Never on booking, tracking, payment, rating or partner pages. No script or number is hard-wired: it only links to /book/. */
(function () {
  var W = window, D = document;
  var SKIP = /^\/(book|track|pay|rate|warranty|unsubscribe|quote|thanks|onboard|garage|mechanic|job|app|admin|offline)(\/|$)/;
  var K = 'mxp_slot_popup', DAY = 864e5;
  function store(get, v) { try { if (get) return W.localStorage.getItem(K); W.localStorage.setItem(K, v); } catch (e) {} return null; }
  function snoozed() { var t = Number(store(true)); return t && Date.now() < t; }
  function snooze(days) { store(false, String(Date.now() + days * DAY)); }
  if (SKIP.test(location.pathname) || snoozed() || !D.body) return;
  try { if (W.sessionStorage.getItem(K)) return; } catch (e) {}

  var shown = false, card;
  function el(tag, attrs, text) { var n = D.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text) n.textContent = text; return n; }
  function close(days) {
    snooze(days);
    if (!card) return;
    card.classList.remove('sp-in');
    W.setTimeout(function () { if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }, 250);
    D.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(3); }
  function show() {
    if (shown || D.hidden) return; shown = true;
    try { W.sessionStorage.setItem(K, '1'); } catch (e) {}
    card = el('div', { class: 'sp', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'spT' });
    var x = el('button', { class: 'sp-x', type: 'button', 'aria-label': 'Close' }, '×'); x.addEventListener('click', function () { close(3); });
    var h = el('h2', { id: 'spT' }, 'Book your slot');
    var p = el('p', {}, 'Pick a day and time that suits you. We confirm by message, and you approve the quote before any work starts.');
    var row = el('div', { class: 'sp-row' });
    var bike = el('a', { class: 'btn btn-primary', href: '/book/' }, 'Book a bike slot');
    var car = el('a', { class: 'btn btn-ghost', href: '/book/?vehicle=car' }, 'Book a car slot');
    [bike, car].forEach(function (a) { a.addEventListener('click', function () { snooze(14); }); row.appendChild(a); });
    var later = el('button', { class: 'sp-later', type: 'button' }, 'Not now'); later.addEventListener('click', function () { close(3); });
    [x, h, p, row, later].forEach(function (n) { card.appendChild(n); });
    D.body.appendChild(card);
    D.addEventListener('keydown', onKey);
    W.requestAnimationFrame(function () { card && card.classList.add('sp-in'); });
  }
  var t0 = Date.now();
  W.setTimeout(show, 20000);
  W.addEventListener('scroll', function f() {
    var h = D.documentElement, max = h.scrollHeight - W.innerHeight;
    if (Date.now() - t0 > 8000 && max > 0 && W.scrollY / max > 0.4) { W.removeEventListener('scroll', f); show(); }
  }, { passive: true });
  D.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 0 && Date.now() - t0 > 10000 && W.innerWidth > 720) show(); });
})();
