/* Smoothness: animations that nobody can see are paused, so the page has less to paint while you scroll.
   It only adds and removes a class; nothing changes in how the page looks or reads. */
(function () {
  'use strict';
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { e.target.classList.toggle('is-off', !e.isIntersecting); });
  }, { rootMargin: '120px 0px' });
  [].forEach.call(document.querySelectorAll('.hero, .ticker, .diwali-bar, .diwali-card, .soon-hero, main > section, main > .page > section, .cover, footer'), function (n) { io.observe(n); });
})();
