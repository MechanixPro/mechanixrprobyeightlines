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
    dotEls.forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
    if (prev) prev.disabled = rail.scrollLeft < 4; if (next) next.disabled = rail.scrollLeft > max - 4;
  }
  if (prev) prev.addEventListener('click', function () { go(-1); });
  if (next) next.addEventListener('click', function () { go(1); });
  rail.addEventListener('scroll', function () { window.requestAnimationFrame(sync); }, { passive: true });
  rail.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
  window.addEventListener('resize', sync); sync();
})();
