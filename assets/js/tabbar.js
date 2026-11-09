(function () {
  try {
    var p = location.pathname.replace(/index\.html$/, '');
    var map = { '/': 'home', '/services/': 'services', '/rate-card/': 'services', '/book/': 'book', '/track/': 'track' };
    var k = map[p] || (p.indexOf('/car-service') === 0 ? 'services' : '');
    var a = document.querySelector('.tabbar [data-tab="' + k + '"]');
    if (a) a.setAttribute('aria-current', 'page');
  } catch (e) {}
})();
