/* "Watch the work": the two job videos play (muted, looping) only while on screen. Reduced motion: they wait for a tap. */
(function () {
  'use strict';
  var vids = [].slice.call(document.querySelectorAll('video[data-watch]')); if (!vids.length) return;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); v.parentNode.classList.add('on'); }
  function pause(v) { v.pause(); v.parentNode.classList.remove('on'); }
  vids.forEach(function (v) {
    var btn = v.parentNode.querySelector('.watch-play');
    if (btn) btn.addEventListener('click', function () { if (v.paused) play(v); else pause(v); });
    v.addEventListener('click', function () { if (v.paused) play(v); else pause(v); });
  });
  if (calm || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { var v = e.target; if (e.isIntersecting) { v.preload = 'auto'; play(v); } else pause(v); });
  }, { threshold: 0.55 });
  vids.forEach(function (v) { io.observe(v); });
})();
