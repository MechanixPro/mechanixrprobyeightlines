/* Mechanix Pro — home picture shuffle. Shows the built-in pictures at once, swaps in the ones set in the admin panel when they load.
   Cross-fades every few seconds; stays still for people who prefer reduced motion. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXP_SHOW = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';
  function normalizeSlides(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || typeof r.url !== 'string' || r.url.indexOf('https://') !== 0) return;
      out.push({ url: r.url, caption: typeof r.caption === 'string' ? r.caption.slice(0, 80) : '' });
    });
    return out.slice(0, 12);
  }
  function nextIndex(i, n) { return n < 2 ? 0 : (i + 1) % n; }

  function start() {
    var box = document.querySelector('[data-show]'); if (!box) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dots = box.parentNode.querySelector('.show-dots'), cur = 0, timer = null;
    function slides() { return box.querySelectorAll('.slide'); }
    function paint() {
      var s = slides();
      for (var i = 0; i < s.length; i++) s[i].classList.toggle('on', i === cur);
      if (dots) { var d = dots.children; for (var j = 0; j < d.length; j++) d[j].setAttribute('aria-pressed', String(j === cur)); }
    }
    function go(i) { cur = i; paint(); }
    function buildDots() {
      if (!dots) return; dots.innerHTML = '';
      var n = slides().length; if (n < 2) return;
      for (var i = 0; i < n; i++) { var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Show picture ' + (i + 1)); b.dataset.i = i; dots.appendChild(b); }
    }
    function play() { stop(); if (reduce || slides().length < 2) return; timer = setInterval(function () { go(nextIndex(cur, slides().length)); }, 4500); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    if (dots) dots.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { go(+b.dataset.i); play(); } });
    box.addEventListener('mouseenter', stop); box.addEventListener('mouseleave', play);
    box.addEventListener('focusin', stop); box.addEventListener('focusout', play);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
    buildDots(); paint(); play();

    var C = window.MXP_CONFIG || window.MXP || {};
    var url = C.supabaseUrl, key = C.supabaseAnonKey; if (!url || !key || !window.fetch) return;
    fetch(url + '/rest/v1/home_images?select=url,caption&active=eq.true&order=position.asc,created_at.asc&limit=12', { headers: { apikey: key, Authorization: 'Bearer ' + key } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var list = normalizeSlides(rows); if (!list.length) return;
        box.innerHTML = '';
        list.forEach(function (s, i) {
          var f = document.createElement('figure'); f.className = 'slide' + (i === 0 ? ' on' : '');
          var im = document.createElement('img'); im.src = s.url; im.alt = s.caption || 'Mechanix Pro at work'; im.width = 1200; im.height = 600; im.loading = i ? 'lazy' : 'eager'; im.decoding = 'async';
          f.appendChild(im);
          if (s.caption) { var c = document.createElement('figcaption'); c.textContent = s.caption; f.appendChild(c); }
          box.appendChild(f);
        });
        cur = 0; buildDots(); paint(); play();
      }).catch(function () {});
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
  return { normalizeSlides: normalizeSlides, nextIndex: nextIndex };
});
