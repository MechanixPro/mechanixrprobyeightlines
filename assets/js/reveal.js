/* Fades content in as it scrolls into view: anything with the "reveal" class. Content stays visible without JavaScript or with reduced motion. */
(function () {
  'use strict';
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!('IntersectionObserver' in window) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { for (var i = 0; i < els.length; i++) els[i].classList.add('in'); return; }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
  for (var j = 0; j < els.length; j++) io.observe(els[j]);
})();
