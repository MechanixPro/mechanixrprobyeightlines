/* A small map of Bengaluru made from the centre points of our PIN codes. The visitor's own PIN drops onto it with a ripple.
   Needs pingeo.js. Decorative: the words next to it carry the meaning. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXP_PINMAP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PAD = 22;
  function bounds(geo) {
    var b = { s: 90, n: -90, w: 180, e: -180 };
    Object.keys(geo).forEach(function (k) { var g = geo[k]; b.s = Math.min(b.s, g[0]); b.n = Math.max(b.n, g[0]); b.w = Math.min(b.w, g[1]); b.e = Math.max(b.e, g[1]); });
    return b;
  }
  /* Equirectangular projection, scaled so north-south and east-west distances look right. */
  function project(b, w, h) {
    var k = Math.cos(((b.s + b.n) / 2) * Math.PI / 180), spanX = (b.e - b.w) * k, spanY = (b.n - b.s);
    var scale = Math.min((w - 2 * PAD) / spanX, (h - 2 * PAD) / spanY), offX = (w - spanX * scale) / 2, offY = (h - spanY * scale) / 2;
    return function (lat, lng) { return { x: Math.round((offX + (lng - b.w) * k * scale) * 10) / 10, y: Math.round((offY + (b.n - lat) * scale) * 10) / 10 }; };
  }
  function layout(geo, w, h) {
    var p = project(bounds(geo), w, h), out = {};
    Object.keys(geo).forEach(function (k) { out[k] = p(geo[k][0], geo[k][1]); });
    return out;
  }
  function svg(geo, opts) {
    opts = opts || {}; var w = opts.w || 300, h = opts.h || 300, b = bounds(geo), p = project(b, w, h), pts = layout(geo, w, h), sel = null;
    if (typeof opts.lat === 'number' && typeof opts.lng === 'number' && opts.lat >= b.s - 0.08 && opts.lat <= b.n + 0.08 && opts.lng >= b.w - 0.08 && opts.lng <= b.e + 0.08) sel = p(opts.lat, opts.lng);
    else if (opts.pin && pts[opts.pin]) sel = pts[opts.pin];
    var glow = '', dots = '', i = 0;
    Object.keys(pts).forEach(function (k) {
      var q = pts[k]; glow += '<circle cx="' + q.x + '" cy="' + q.y + '" r="21"/>';
      if (opts.pin && k === opts.pin && !opts.lat) return;
      dots += '<circle class="pm-dot" cx="' + q.x + '" cy="' + q.y + '" r="2.4" style="--i:' + (i++) + '"/>';
    });
    var pin = sel ? '<g class="pm-sel" transform="translate(' + sel.x + ' ' + sel.y + ')"><circle class="pm-ripple" r="8"/><circle class="pm-ripple pm-r2" r="8"/><g class="pm-pin"><path d="M0 0C-9-13-12-19-12-25a12 12 0 0 1 24 0c0 6-3 12-12 25z"/><circle cy="-25" r="4.6"/></g></g>' : '';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="presentation" aria-hidden="true" focusable="false"><g class="pm-glow">' + glow + '</g>' + dots + pin + '</svg>';
  }
  /* Draws into an element. A second draw keeps the dots still and only drops the pin again. */
  function draw(el, opts) {
    if (!el || typeof window === 'undefined' || !window.MXP_PIN_GEO) return;
    el.innerHTML = svg(window.MXP_PIN_GEO, opts);
    if (el.getAttribute('data-drawn') === '1') el.classList.add('pm-again'); else { el.setAttribute('data-drawn', '1'); }
  }
  return { layout: layout, svg: svg, draw: draw };
});
