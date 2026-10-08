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
  /* The Mechanix Pro map: the real outline of every PIN code area. Mechanix Pro sits at its office in HSR Layout; when your PIN is known, a mechanic rides a route to your spot. */
  var uid = 0;
  function pj(P, lat, lng) { return { x: P.offX + (lng - P.w) * P.k * P.scale, y: P.offY + (P.n - lat) * P.scale }; }
  var RIDER = '<g class="pm-rider-art"><ellipse cx="0" cy="3" rx="13" ry="3" fill="rgba(0,0,0,.18)"/><circle cx="-8" cy="-2" r="4.4" fill="#14295A"/><circle cx="8" cy="-2" r="4.4" fill="#14295A"/><circle cx="-8" cy="-2" r="1.6" fill="#fff"/><circle cx="8" cy="-2" r="1.6" fill="#fff"/><path d="M-9 -3h14l4-9h4" fill="none" stroke="#F2801F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M-2 -5l1-9" stroke="#14295A" stroke-width="3" stroke-linecap="round"/><circle cx="-1" cy="-19" r="4.2" fill="#F2801F" stroke="#fff" stroke-width="1.2"/><path d="M-3.5 -20.5h5" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></g>';
  function svgMap(S, geo, opts) {
    opts = opts || {}; var P = S.proj, id = opts.id || ('pm' + (++uid)), hub = pj(P, S.hub[0], S.hub[1]), sel = null, ok = false;
    if (typeof opts.lat === 'number' && typeof opts.lng === 'number' && opts.lat >= P.s - 0.04 && opts.lat <= P.n + 0.04 && opts.lng >= P.w - 0.04 && opts.lng <= P.e + 0.04) { sel = pj(P, opts.lat, opts.lng); ok = true; }
    else if (opts.pin && geo && geo[opts.pin]) { sel = pj(P, geo[opts.pin][0], geo[opts.pin][1]); ok = true; }
    var areas = '', mine = '';
    Object.keys(S.paths).forEach(function (pin) { if (opts.pin && pin === opts.pin) mine = '<path class="pm-sel-area" d="' + S.paths[pin] + '"/>'; else areas += '<path class="pm-area" d="' + S.paths[pin] + '"/>'; });
    var route = '', rider = '', pin = '', vb = [0, 0, S.w, S.h], z = 1;
    if (ok) {
      var dx = sel.x - hub.x, dy = sel.y - hub.y, dist = Math.sqrt(dx * dx + dy * dy), still = !!opts.still || dist < 8;
      if (dist < 110) { /* a spot close to Mechanix Pro: zoom in so the route and the pin are not on top of each other */
        var half = Math.max(65, Math.max(Math.abs(dx), Math.abs(dy)) / 2 + 36), mx = (hub.x + sel.x) / 2, my = (hub.y + sel.y) / 2;
        var x0 = Math.min(Math.max(mx - half, 0), S.w - 2 * half), y0 = Math.min(Math.max(my - half, 0), S.h - 2 * half);
        vb = [Math.round(x0 * 10) / 10, Math.round(y0 * 10) / 10, Math.round(2 * half * 10) / 10, Math.round(2 * half * 10) / 10]; z = vb[2] / S.w;
      }
      var cx = (hub.x + sel.x) / 2 - dy * 0.22, cy = (hub.y + sel.y) / 2 + dx * 0.22, d = 'M' + hub.x.toFixed(1) + ' ' + hub.y.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + sel.x.toFixed(1) + ' ' + sel.y.toFixed(1);
      if (dist >= 8) route = '<path id="' + id + 'r" class="pm-route' + (opts.still ? ' pm-route-still' : '') + '" d="' + d + '"/>';
      var flip = dx < 0 ? -1 : 1, art = '<g transform="scale(' + (flip * z).toFixed(3) + ' ' + z.toFixed(3) + ')">' + RIDER + '</g>';
      rider = still ? '<g class="pm-rider" transform="translate(' + sel.x.toFixed(1) + ' ' + sel.y.toFixed(1) + ')">' + art + '</g>'
        : '<g class="pm-rider" visibility="hidden">' + art + '<set attributeName="visibility" to="visible" begin="0.5s" fill="freeze"/><animateMotion dur="3.2s" begin="0.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .2 1"><mpath href="#' + id + 'r"/></animateMotion></g>';
      pin = '<g class="pm-sel' + (still ? '' : ' pm-late') + '" transform="translate(' + sel.x.toFixed(1) + ' ' + sel.y.toFixed(1) + ') scale(' + z.toFixed(3) + ')"><circle class="pm-ripple" r="8"/><circle class="pm-ripple pm-r2" r="8"/><g class="pm-pin"><path d="M0 0C-9-13-12-19-12-25a12 12 0 0 1 24 0c0 6-3 12-12 25z"/><circle cy="-25" r="4.6"/></g></g>';
    }
    var hubG = '<g class="pm-hub" transform="translate(' + hub.x.toFixed(1) + ' ' + hub.y.toFixed(1) + ') scale(' + z.toFixed(3) + ')"><circle r="9" class="pm-hub-ring"/><circle r="5.2" fill="#14295A"/><circle r="2" fill="#F2801F"/><text y="-12" text-anchor="middle">Mechanix Pro</text></g>';
    return '<svg viewBox="' + vb.join(' ') + '" style="--z:' + z.toFixed(3) + '" role="presentation" aria-hidden="true" focusable="false"><g class="pm-land">' + areas + mine + '</g>' + route + hubG + rider + pin + '</svg>';
  }
  /* Draws into an element. Uses the real outlines (loaded the first time they are needed); until then, a quick dot map. */
  var waiting = [], loading = false;
  function loadShapes() {
    if (loading || typeof document === 'undefined') return; loading = true;
    var sc = document.createElement('script'); sc.src = '/assets/js/pinshapes.js'; sc.async = true;
    sc.onload = function () { waiting.splice(0).forEach(function (w) { if (document.body.contains(w.el)) draw(w.el, w.opts); }); };
    document.head.appendChild(sc);
  }
  function draw(el, opts) {
    if (!el || typeof window === 'undefined' || !window.MXP_PIN_GEO) return;
    opts = opts || {};
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (window.MXP_PIN_SHAPES) el.innerHTML = svgMap(window.MXP_PIN_SHAPES, window.MXP_PIN_GEO, Object.assign({}, opts, { still: opts.still || opts.again || reduce }));
    else { el.innerHTML = svg(window.MXP_PIN_GEO, opts); waiting.push({ el: el, opts: opts }); loadShapes(); }
    if (el.getAttribute('data-drawn') === '1') el.classList.add('pm-again'); else el.setAttribute('data-drawn', '1');
  }
  return { layout: layout, svg: svg, svgMap: svgMap, draw: draw };
});
