/* Diwali on the website: a slim banner on every page, the Diwali card on the home page, and a short burst of fireworks.
   It runs only between the dates below (India time) and switches itself off afterwards. No made-up discount: an offer line shows only if
   diwaliOffer is set in config.js. Calm by design: fireworks last about six seconds, once per visit, and never for people who prefer reduced motion. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_DIWALI = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FROM = '2026-10-23', TO = '2026-11-12'; // inclusive, India date
  function istDay(now) { return new Date((now == null ? Date.now() : now) + 330 * 60000).toISOString().slice(0, 10); }
  function active(now) { var d = istDay(now); return d >= FROM && d <= TO; }
  function offerLine(cfg) { return String((cfg && cfg.diwaliOffer) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120); }

  function fireworks(win) {
    var doc = win.document, cv = doc.createElement('canvas'); cv.className = 'fx-canvas'; cv.setAttribute('aria-hidden', 'true');
    var ctx = cv.getContext && cv.getContext('2d'); if (!ctx) return;
    var dpr = Math.min(win.devicePixelRatio || 1, 2), W = 0, H = 0, parts = [], t0 = Date.now(), last = 0, COLORS = ['#F2801F', '#FFC857', '#FFFFFF', '#FF9F43', '#FFD98E'];
    function size() { W = win.innerWidth; H = win.innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function burst() {
      var x = W * (0.15 + Math.random() * 0.7), y = H * (0.12 + Math.random() * 0.38), c = COLORS[(Math.random() * COLORS.length) | 0], n = 34;
      for (var i = 0; i < n; i++) { var a = (Math.PI * 2 * i) / n, v = 1.4 + Math.random() * 2.6; parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: c }); }
    }
    function frame() {
      var now = Date.now(); ctx.clearRect(0, 0, W, H);
      if (now - t0 < 4200 && now - last > 650) { burst(); last = now; }
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.045; p.vx *= 0.985; p.life -= 0.014;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (now - t0 < 6200 || parts.length) win.requestAnimationFrame(frame); else if (cv.parentNode) cv.parentNode.removeChild(cv);
    }
    size(); doc.body.appendChild(cv); frame();
  }

  function start(win) {
    var doc = win.document, cfg = win.MXP || {};
    if (!active()) { [].forEach.call(doc.querySelectorAll('[data-diwali],[data-diwali-bar]'), function (n) { n.hidden = true; }); return; }
    var calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var store = function (k, v) { try { if (v === undefined) return win.sessionStorage.getItem(k); win.sessionStorage.setItem(k, v); } catch (e) {} return null; };
    var offer = offerLine(cfg);
    // The banner and the home card are in the page already (so nothing jumps). Here we add the offer line, and let the banner be closed.
    var card = doc.querySelector('[data-diwali]');
    if (card) { var o = card.querySelector('[data-diwali-offer]'); if (o && offer) { o.textContent = offer; o.hidden = false; } }
    var bar = doc.querySelector('[data-diwali-bar]');
    if (bar) {
      if (store('mxp_diwali_x')) bar.hidden = true;
      var line = bar.querySelector('[data-diwali-line]'); if (line && offer) line.textContent = offer;
      var x = bar.querySelector('.db-x'); if (x) x.addEventListener('click', function () { store('mxp_diwali_x', '1'); bar.hidden = true; });
    }
    // Fireworks once per visit, on the home page only, and never for reduced motion.
    var home = win.location.pathname === '/' || /\/index\.html$/.test(win.location.pathname);
    if (home && !calm && !store('mxp_fx')) { store('mxp_fx', '1'); win.setTimeout(function () { fireworks(win); }, 900); }
    var spark = doc.querySelector('.diwali-spark');
    if (spark && !calm) { spark.setAttribute('role', 'button'); spark.setAttribute('tabindex', '0'); spark.setAttribute('aria-label', 'Celebrate with fireworks');
      var go = function () { fireworks(win); }; spark.addEventListener('click', go); spark.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); }
  }
  return { start: start, active: active, istDay: istDay, offerLine: offerLine, FROM: FROM, TO: TO };
});
