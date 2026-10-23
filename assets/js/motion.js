/* Small, honest motion and memory for the site (all pages):
   a thin progress line while you scroll, the owner-confirmed numbers counting up once, and a "continue your build" nudge on the home page
   when this device already holds a saved build (the IKEA effect: people finish what they started). No fake urgency, no made-up numbers.
   Everything is skipped for visitors who prefer reduced motion, and the page reads the same without this file. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_MOTION = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var clean = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); };

  // The words for the "continue" nudge, from a saved build. Returns '' when there is nothing worth resuming.
  function resumeName(saved) {
    if (!saved || typeof saved !== 'object') return '';
    var name = clean(saved.nick, 24) || clean(((saved.brand || '') + ' ' + (saved.model || '')).trim(), 40);
    return name;
  }
  // "10,000+ services done" -> { n: 10000, text: '10,000+', rest: ' services done' }
  function parseCount(text) {
    var m = /^\s*([\d,]+)(\+?)(.*)$/.exec(String(text || '')); if (!m) return null;
    var n = parseInt(m[1].replace(/,/g, ''), 10); if (!(n > 0)) return null;
    return { n: n, plus: m[2], rest: m[3] };
  }
  function fmt(n) { return n.toLocaleString('en-IN'); }

  function start(win) {
    var doc = win.document, calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 1) Progress line
    if (!calm) {
      var bar = doc.createElement('div'); bar.className = 'scroll-progress'; bar.setAttribute('aria-hidden', 'true'); doc.body.appendChild(bar);
      var tick = false;
      var upd = function () { tick = false; var h = doc.documentElement.scrollHeight - win.innerHeight; bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, win.scrollY / h) : 0) + ')'; };
      win.addEventListener('scroll', function () { if (!tick) { tick = true; win.requestAnimationFrame(upd); } }, { passive: true }); upd();
    }
    // 2) Count-up for the proof line, once, when it is seen
    var proof = doc.querySelectorAll('.hero-proof b');
    if (!calm && 'IntersectionObserver' in win) {
      [].forEach.call(proof, function (b) {
        var p = parseCount(b.textContent); if (!p) return;
        var io = new win.IntersectionObserver(function (es) {
          if (!es[0].isIntersecting) return; io.disconnect();
          var t0 = win.performance.now(), dur = 1100;
          (function step(now) { var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); b.textContent = fmt(Math.round(p.n * e)) + (k === 1 ? p.plus : '') + p.rest; if (k < 1) win.requestAnimationFrame(step); })(t0);
        }, { threshold: 0.6 });
        io.observe(b);
      });
    }
    // 3) Continue your build (home page only)
    var host = doc.querySelector('.hero-copy .chat, .hero-copy .hero-alt'); var home = doc.body && doc.body.classList.contains('home');
    if (home && host) {
      var saved = null; try { saved = JSON.parse(win.localStorage.getItem('mxp_build_v1') || 'null'); } catch (e) {}
      var name = resumeName(saved);
      if (name) {
        var a = doc.createElement('a'); a.className = 'resume'; a.href = '/book/';
        var s = doc.createElement('span'); s.textContent = 'Welcome back. Continue your build for ';
        var b = doc.createElement('b'); b.textContent = name; a.appendChild(s); a.appendChild(b); a.appendChild(doc.createTextNode(' →'));
        host.parentNode.insertBefore(a, host);
      }
    }
  }
  return { start: start, resumeName: resumeName, parseCount: parseCount, fmt: fmt };
});
