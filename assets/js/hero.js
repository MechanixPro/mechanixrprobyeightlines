/* Mechanix Pro — hero preview animation and scroll reveals. Respects prefers-reduced-motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function rupee(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

  function counters() {
    var els = document.querySelectorAll('[data-count]');
    function run(el) {
      var to = parseInt(el.getAttribute('data-count'), 10), t0 = null;
      function tick(t) { if (t0 === null) t0 = t; var k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString('en-IN'); if (k < 1) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
    }
    if (reduce || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }); });
    for (var i = 0; i < els.length; i++) io.observe(els[i]);
  }

  function reveals() {
    var els = document.querySelectorAll('.reveal');
    if (reduce || !('IntersectionObserver' in window)) { for (var i = 0; i < els.length; i++) els[i].classList.add('in'); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  function preview() {
    var root = $('#heroPreview'); if (!root) return;
    var name = $('#pvName'), input = $('#pvInput'), pack = $('#pvPack'), add = $('#pvAdd'), price = $('#pvPrice');
    var opts = root.querySelectorAll('.pv-opt'), bars = root.querySelectorAll('.pv-bar i');
    var NICK = 'Bullet Raja';
    function priceOf(id) { var el = document.querySelector('[data-price="' + id + '"]'); return el ? parseInt(el.textContent.replace(/\D/g, ''), 10) || 0 : 0; }
    var timers = [], cur = 0;
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function bar(n) { for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < n); }
    function pick(id) { for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('on', opts[i].getAttribute('data-id') === id); }
    function count(to, ms) {
      var from = cur, t0 = null;
      function tick(t) { if (t0 === null) t0 = t; var k = Math.min(1, (t - t0) / ms); cur = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); price.textContent = rupee(cur); if (k < 1) timers.push(requestAnimationFrame(tick)); }
      timers.push(requestAnimationFrame(tick));
    }
    function final() {
      name.textContent = NICK; input.classList.remove('on'); pick('general'); bar(3);
      pack.textContent = '"' + NICK + '"'; add.textContent = 'General service + Foam wash'; cur = priceOf('general') + priceOf('wash'); price.textContent = rupee(cur);
    }
    function reset() { name.textContent = ''; pick(''); bar(1); cur = 0; price.textContent = rupee(0); pack.textContent = 'Your bike'; add.textContent = 'Choose a service'; input.classList.add('on'); }
    function run() {
      reset(); var i = 0;
      (function type() {
        if (i < NICK.length) { name.textContent = NICK.slice(0, ++i); return later(type, 85); }
        later(function () { input.classList.remove('on'); bar(2); pick('general'); pack.textContent = '"' + NICK + '"'; add.textContent = 'General service'; count(priceOf('general'), 600); }, 500);
        later(function () { bar(3); add.textContent = 'General service + Foam wash'; count(priceOf('general') + priceOf('wash'), 500); }, 1900);
        later(run, 5200);
      })();
    }
    if (reduce) return final();
    run();
    document.addEventListener('visibilitychange', function () { if (document.hidden) { timers.forEach(function (t) { clearTimeout(t); cancelAnimationFrame(t); }); timers = []; } else if (!timers.length) run(); });
  }

  function init() { reveals(); counters(); preview(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
