/* "See how it feels": a swipeable rail of story cards with arrows and dots. Plain scrolling works without this file. */
(function () {
  'use strict';
  var rail = document.querySelector('[data-stories]'); if (!rail) return;
  var cards = [].slice.call(rail.children), wrap = rail.parentNode, dots = wrap.querySelector('[data-dots]');
  var prev = wrap.querySelector('[data-prev]'), next = wrap.querySelector('[data-next]');
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cards.forEach(function (c, i) { var d = document.createElement('i'); dots.appendChild(d); });
  var dotEls = [].slice.call(dots.children);
  function step() { return cards[0] ? cards[0].getBoundingClientRect().width + 16 : 300; }
  function go(dir) { rail.scrollBy({ left: dir * step(), behavior: calm ? 'auto' : 'smooth' }); }
  function sync() {
    var max = rail.scrollWidth - rail.clientWidth, i = max > 0 ? Math.round((rail.scrollLeft / max) * (cards.length - 1)) : 0;
    var near = 0, best = 1e9; cards.forEach(function (c, k) { var d = Math.abs(c.offsetLeft - rail.offsetLeft - rail.scrollLeft - 20); if (d < best) { best = d; near = k; } });
    if (max > 0 && rail.scrollLeft > max - 4) near = cards.length - 1; i = near;
    cards.forEach(function (c, k) { c.classList.toggle('is-active', k === i); });
    dotEls.forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
    wrap.setAttribute('data-i', i);
    if (prev) prev.disabled = rail.scrollLeft < 4; if (next) next.disabled = rail.scrollLeft > max - 4;
  }
  if (prev) prev.addEventListener('click', function () { go(-1); });
  if (next) next.addEventListener('click', function () { go(1); });
  rail.addEventListener('scroll', function () { window.requestAnimationFrame(sync); }, { passive: true });
  rail.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
  window.addEventListener('resize', sync); sync();
  /* Gentle autoplay: moves on every 5 seconds, loops, and stops for touch, hover, focus, a hidden tab, or reduced motion. */
  if (calm || !('IntersectionObserver' in window)) return;
  var timer = null, held = false, seen = false, DELAY = 5000;
  function tick() {
    var max = rail.scrollWidth - rail.clientWidth;
    if (rail.scrollLeft > max - 4) rail.scrollTo({ left: 0, behavior: 'smooth' }); else go(1);
  }
  function arm() { clearTimeout(timer); wrap.classList.remove('st-run'); if (held || !seen || document.hidden) return; void wrap.offsetWidth; wrap.classList.add('st-run'); timer = setTimeout(function () { tick(); }, DELAY); }
  function hold(v) { held = v; arm(); }
  ['pointerenter', 'focusin', 'touchstart'].forEach(function (ev) { wrap.addEventListener(ev, function () { hold(true); }, { passive: true }); });
  ['pointerleave', 'focusout'].forEach(function (ev) { wrap.addEventListener(ev, function () { hold(false); }); });
  wrap.addEventListener('touchend', function () { setTimeout(function () { hold(false); }, 4000); }, { passive: true });
  rail.addEventListener('scroll', function () { if (!held) { clearTimeout(timer); timer = setTimeout(arm, 250); } }, { passive: true });
  document.addEventListener('visibilitychange', arm);
  new IntersectionObserver(function (e) { seen = e[0].isIntersecting; arm(); }, { threshold: 0.4 }).observe(wrap);
})();
