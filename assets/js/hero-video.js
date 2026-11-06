/* Home hero video: a short muted loop of the Mechanix Pro garage. It stays still (poster picture only) for people who ask for reduced motion
   or data saving, and pauses while the tab is hidden. No tracking, no outside requests. */
(function () {
  'use strict';
  var v = document.querySelector('.hm-v'); if (!v) return;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saver = navigator.connection && navigator.connection.saveData;
  if (calm || saver) { v.pause(); v.removeAttribute('autoplay'); v.removeAttribute('loop'); v.preload = 'none'; return; }
  document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
})();
