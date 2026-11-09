/* Home hero picture carousel (bike set and car set). One slide at a time, cross-fade, 6 second auto-advance.
   The advance is driven by the progress bar's CSS animation (it ends, we move on), so pausing the bar pauses the timer.
   It pauses on hover, keyboard focus, touch, the pause button, a hidden tab and when the hero is off screen.
   No autoplay (first picture only, manual controls) for people who ask for reduced motion or data saving.
   The video on slide 1 plays only while slide 1 is showing. Other pictures get their src only when they are next. No tracking, no outside requests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_HERO_SLIDER = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DWELL_MS = 6000;

  // ---- state logic (pure) ----
  function create(n, auto) { return { i: 0, n: Math.max(1, n | 0), auto: !!auto, holds: {} }; }
  function copy(s, patch) { var o = { i: s.i, n: s.n, auto: s.auto, holds: {} }, k; for (k in s.holds) o.holds[k] = s.holds[k]; for (k in patch) o[k] = patch[k]; return o; }
  function wrap(i, n) { return ((i % n) + n) % n; }
  function go(s, i) { return copy(s, { i: wrap(i | 0, s.n) }); }
  function next(s) { return go(s, s.i + 1); }
  function prev(s) { return go(s, s.i - 1); }
  function hold(s, why, on) { var h = {}, k; for (k in s.holds) h[k] = s.holds[k]; if (on) h[why] = true; else delete h[why]; return copy(s, { holds: h }); }
  function held(s) { for (var k in s.holds) if (s.holds[k]) return true; return false; }
  function playing(s) { return s.auto && s.n > 1 && !held(s); }          // is the progress bar running
  function wantsVideo(s, videoIndex) { return s.i === videoIndex && !s.holds.hidden && !s.holds.offscreen; }
  function near(s) { return [s.i, wrap(s.i + 1, s.n)]; }                // indexes to load now (the shown one and the next)
  function swipe(dx, dy, min) { min = min || 40; if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.2) return 0; return dx < 0 ? 1 : -1; }

  // ---- page wiring ----
  var CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="';
  function btn(cls, label, inner) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.innerHTML = inner; return b; }

  function setup(el, win, still) {
    var doc = win.document, slides = [].slice.call(el.querySelectorAll('.hs-slide')), n = slides.length; if (n < 2) return;
    var track = el.querySelector('.hs-track'), video = el.querySelector('video'), st = create(n, !still), dots = [];
    var vi = -1; slides.forEach(function (s, k) { if (s.querySelector('video')) vi = k; });   // the video is whichever slide holds it (it is the last one now)
    var ctl = doc.createElement('div'); ctl.className = 'hs-ctl'; ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Picture controls');
    var bp = btn('hs-btn hs-prev', 'Previous picture', CHEV + 'M15 5l-7 7 7 7"/></svg>'), bn = btn('hs-btn hs-next', 'Next picture', CHEV + 'M9 5l7 7-7 7"/></svg>');
    var dw = doc.createElement('div'); dw.className = 'hs-dots';
    slides.forEach(function (_, k) { var d = btn('hs-dot', 'Show picture ' + (k + 1) + ' of ' + n, '<span class="hs-bar"><i class="hs-fill"></i></span>'); d.addEventListener('click', function () { show(k); }); dw.appendChild(d); dots.push(d); });
    ctl.appendChild(bp); ctl.appendChild(dw); ctl.appendChild(bn);
    var pp = null;
    if (!still) { pp = btn('hs-btn hs-pp', 'Pause moving pictures', '<svg class="hs-i-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg><svg class="hs-i-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'); pp.setAttribute('aria-pressed', 'false'); ctl.appendChild(pp); }
    el.appendChild(ctl); el.classList.add('is-live'); if (still) el.classList.add('hs-still');

    function visible() { return el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0); }
    function load(k) {
      var im = slides[k] && slides[k].querySelector('img[data-src]'); if (!im) return;
      if (im.getAttribute('data-srcset')) im.srcset = im.getAttribute('data-srcset'); im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); im.removeAttribute('data-srcset');
    }
    function loadNear() { if (!visible()) return; if (still || (win.navigator.connection && win.navigator.connection.saveData)) load(st.i); else near(st).forEach(load); }
    function video_() {
      if (!video) return;
      if (vi >= 0 && wantsVideo(st, vi) && !still && !doc.hidden) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause();
    }
    function paint() {
      slides.forEach(function (s, k) { var on = k === st.i; s.classList.toggle('is-on', on); if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true'); });
      dots.forEach(function (d, k) { var on = k === st.i; d.classList.toggle('is-on', on); if (on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      el.classList.toggle('hs-hold', !playing(st));
      track.setAttribute('aria-live', playing(st) ? 'off' : 'polite');
      video_();
    }
    function restartBar() { var f = dots[st.i].querySelector('.hs-fill'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; }
    function show(k) { st = go(st, k); loadNear(); paint(); restartBar(); }
    function setHold(why, on) { st = hold(st, why, on); paint(); }

    bp.addEventListener('click', function () { show(prev(st).i); });
    bn.addEventListener('click', function () { show(next(st).i); });
    if (pp) pp.addEventListener('click', function () { var on = pp.getAttribute('aria-pressed') !== 'true'; pp.setAttribute('aria-pressed', on ? 'true' : 'false'); pp.setAttribute('aria-label', on ? 'Play moving pictures' : 'Pause moving pictures'); setHold('manual', on); });
    dw.addEventListener('animationend', function (e) { if (e.target.className === 'hs-fill' && playing(st)) show(next(st).i); });
    el.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { show(next(st).i); } else if (e.key === 'ArrowLeft') { show(prev(st).i); } });
    if (!still && win.matchMedia && win.matchMedia('(hover: hover)').matches) {
      el.addEventListener('mouseenter', function () { setHold('hover', true); }); el.addEventListener('mouseleave', function () { setHold('hover', false); });
    }
    if (!still) {
      el.addEventListener('focusin', function (e) { var f = false; try { f = e.target.matches(':focus-visible'); } catch (x) {} if (f) setHold('focus', true); });
      el.addEventListener('focusout', function () { setHold('focus', false); });
    }
    var x0 = 0, y0 = 0;
    el.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; if (!still) setHold('touch', true); }, { passive: true });
    function tend(e) { var t = e.changedTouches && e.changedTouches[0]; if (!still) setHold('touch', false); if (t) { var d = swipe(t.clientX - x0, t.clientY - y0); if (d) show(wrap(st.i + d, n)); } }
    el.addEventListener('touchend', tend, { passive: true }); el.addEventListener('touchcancel', function () { if (!still) setHold('touch', false); }, { passive: true });
    if (!still) {
      doc.addEventListener('visibilitychange', function () { setHold('hidden', !!doc.hidden); });
      if ('IntersectionObserver' in win) new win.IntersectionObserver(function (es) { es.forEach(function (e) { setHold('offscreen', !e.isIntersecting); }); }, { threshold: 0.2 }).observe(el);
    }
    el._hsRefresh = function () { loadNear(); video_(); };
    paint(); loadNear();
    return el;
  }

  function start(win) {
    var doc = win.document, sets = [].slice.call(doc.querySelectorAll('.hero-media .hs')); if (!sets.length) return;
    var calm = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var saver = !!(win.navigator && win.navigator.connection && win.navigator.connection.saveData);
    var live = sets.map(function (el) { return setup(el, win, calm || saver); }).filter(Boolean);
    // The Bike and Car choice is plain CSS (radio buttons); when it changes, load the picture of the set that just appeared.
    [].slice.call(doc.querySelectorAll('.veh-in')).forEach(function (r) { r.addEventListener('change', function () { live.forEach(function (el) { el._hsRefresh(); }); }); });
    win.addEventListener('pageshow', function () { live.forEach(function (el) { el._hsRefresh(); }); });
  }

  return { create: create, go: go, next: next, prev: prev, hold: hold, held: held, playing: playing, wantsVideo: wantsVideo, near: near, swipe: swipe, wrap: wrap, DWELL_MS: DWELL_MS, start: start };
});
