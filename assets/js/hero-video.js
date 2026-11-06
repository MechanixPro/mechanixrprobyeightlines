/* Muted loop videos (class hm-v): the home hero, the garage, help, societies and fleet pages. Each video plays only while it is on screen and the tab is visible.
   They stay still (poster picture only) for people who ask for reduced motion or data saving. No tracking, no outside requests. */
(function () {
  'use strict';
  var vs = [].slice.call(document.querySelectorAll('video.hm-v')); if (!vs.length) return;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saver = navigator.connection && navigator.connection.saveData;
  if (calm || saver) { vs.forEach(function (v) { v.pause(); v.removeAttribute('autoplay'); v.removeAttribute('loop'); v.preload = 'none'; }); return; }
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  function sync(v) { if (v._on && !document.hidden) play(v); else v.pause(); }
  vs.forEach(function (v) { v._on = !('IntersectionObserver' in window); v.pause(); });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target._on = e.isIntersecting; sync(e.target); }); }, { threshold: 0.25 });
    vs.forEach(function (v) { io.observe(v); });
  } else vs.forEach(sync);
  document.addEventListener('visibilitychange', function () { vs.forEach(sync); });
})();
