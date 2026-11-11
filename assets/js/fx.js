/* Small, honest motion for three places: the tracking steps, the thank-you card and the customer app cards.
   Uses a trimmed animejs (anime-lite.js, about 15 KB gzipped) that is fetched when the browser is idle, never in the page's critical path.
   Skipped for visitors who prefer reduced motion, and the page reads the same without it: content is never hidden first, so if the library
   does not load, nothing is lost. Nothing here shows a number or a claim. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_FX = api; if (root.document) api.warm(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SRC = '/assets/js/anime-lite.js', MAX = 14;
  // What each effect moves. Pure data, so a test can read it.
  var KINDS = {
    steps: [
      { sel: '.track-steps li', props: { opacity: [0, 1], translateX: [-10, 0] }, duration: 380, gap: 70 },
      { sel: '.track-steps li.done i', props: { scale: [0.6, 1] }, duration: 320, gap: 70, after: 200 }
    ],
    thanks: [
      { sel: '.jy-thanks h2, .jy-id, .jy-sub', props: { opacity: [0, 1], translateY: [10, 0] }, duration: 420, gap: 90 },
      { sel: '.jy-id b', props: { scale: [0.85, 1] }, duration: 500, gap: 0, after: 150 },
      { sel: '.jy-next li', props: { opacity: [0, 1], translateY: [10, 0] }, duration: 420, gap: 110, after: 250 }
    ],
    cards: [
      { sel: '.ca-card', props: { opacity: [0, 1], translateY: [12, 0] }, duration: 360, gap: 45 }
    ]
  };
  var reduced = function (win) { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return true; } };
  var loading = null;
  // Fetches the library once. Resolves with the library or null; never rejects.
  function load(win) {
    if (win.MXP_ANIME) return Promise.resolve(win.MXP_ANIME);
    if (reduced(win)) return Promise.resolve(null);
    if (loading) return loading;
    loading = new Promise(function (ok) {
      var s = win.document.createElement('script'); s.src = SRC; s.async = true;
      s.onload = function () { ok(win.MXP_ANIME || null); }; s.onerror = function () { ok(null); };
      win.document.head.appendChild(s);
    });
    return loading;
  }
  function warm(win) {
    if (reduced(win)) return;
    var go = function () { load(win); };
    if (win.requestIdleCallback) win.requestIdleCallback(go, { timeout: 4000 }); else win.setTimeout(go, 1500);
  }
  // Plays one effect inside root. Safe to call anytime: returns a promise that resolves true when something moved.
  function play(win, kind, root) {
    var spec = KINDS[kind]; if (!spec || !root || reduced(win)) return Promise.resolve(false);
    return load(win).then(function (A) {
      if (!A) return false; var moved = false;
      spec.forEach(function (s) {
        var t = Array.prototype.slice.call(root.querySelectorAll(s.sel), 0, MAX); if (!t.length) return;
        var o = { duration: s.duration, ease: 'outQuad', delay: A.stagger(s.gap, { start: s.after || 0 }) };
        Object.keys(s.props).forEach(function (k) { o[k] = s.props[k]; });
        A.animate(t, o); moved = true;
      });
      return moved;
    }).catch(function () { return false; });
  }
  return { KINDS: KINDS, SRC: SRC, reduced: reduced, load: load, warm: warm, play: play };
});
