/* Mechanix Pro — sphere helper renderer. Our own small renderer for the owner's avatar design (assets/data/sphere.json):
   a sphere body with two eyes that sit on its surface, turn with the head, change look and blink. Pure maths on top, a little DOM below. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_SPHERE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RAD = Math.PI / 180, CX = 150, CY = 150;

  // Both eyes of one look, in svg units (centre 150,150): where, how big, how tilted. Eyes sit on the sphere, so turning the head slides and narrows them.
  function eyes(expr, size) {
    var R = size / 2, h = expr.head, a = h.x * RAD, b = h.y * RAD, c = h.z * RAD;
    var fx = Math.max(0.35, Math.cos(b)), fy = Math.max(0.35, Math.cos(a));
    return [-1, 1].map(function (sign, i) {
      var e = expr.eyes[i === 0 ? 'left' : 'right'];
      var u = sign * expr.eyes.spacing / 2 + (e.x || 0), v = e.y || 0;
      var w = Math.sqrt(Math.max(0, R * R - u * u - v * v));
      var x1 = u * Math.cos(b) + w * Math.sin(b), z1 = -u * Math.sin(b) + w * Math.cos(b);   // turn left/right
      var y2 = v * Math.cos(a) - z1 * Math.sin(a), z2 = v * Math.sin(a) + z1 * Math.cos(a);  // look up/down
      var x3 = x1 * Math.cos(c) - y2 * Math.sin(c), y3 = x1 * Math.sin(c) + y2 * Math.cos(c); // tilt
      return { cx: CX + x3, cy: CY + y3, rx: e.width / 2 * fx, ry: e.height / 2 * fy, rot: (e.angle || 0) + h.z, visible: z2 > 0 };
    });
  }
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  function mix(a, b, t) {
    var side = function (x, y) { return { width: lerp(x.width, y.width, t), height: lerp(x.height, y.height, t), x: lerp(x.x || 0, y.x || 0, t), y: lerp(x.y || 0, y.y || 0, t), angle: lerp(x.angle || 0, y.angle || 0, t) }; };
    return {
      head: { x: lerp(a.head.x, b.head.x, t), y: lerp(a.head.y, b.head.y, t), z: lerp(a.head.z, b.head.z, t) },
      eyes: { left: side(a.eyes.left, b.eyes.left), right: side(a.eyes.right, b.eyes.right), spacing: lerp(a.eyes.spacing, b.eyes.spacing, t) },
    };
  }
  var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  // Where the animation is at time t (ms): moving towards a step, or holding on it. Loops forever.
  function frame(anim, exprs, t, startFrom) {
    var steps = anim.steps, total = 0, i;
    steps.forEach(function (s) { total += s.transitionMs + s.holdMs; });
    var loops = Math.floor(t / total), tt = t - loops * total;
    for (i = 0; i < steps.length; i++) {
      var s = steps[i], seg = s.transitionMs + s.holdMs;
      if (tt < seg) {
        var from = i > 0 ? steps[i - 1].expression : (loops > 0 ? steps[steps.length - 1].expression : (startFrom || 'neutral'));
        return { from: from, to: s.expression, k: tt < s.transitionMs ? ease(tt / s.transitionMs) : 1, first: loops === 0 && i === 0 };
      }
      tt -= seg;
    }
    return { from: steps[0].expression, to: steps[0].expression, k: 1, first: false };
  }
  // 1 = eyes open, dips towards 0.08 and back over the blink's duration.
  function blink(t, dur) { if (t <= 0 || t >= dur) return 1; return 1 - 0.92 * Math.sin(Math.PI * t / dur); }

  // The picture. container: an element; def: assets/data/sphere.json. Returns { play(name), destroy() }.
  function create(container, def, opts) {
    opts = opts || {};
    var reduce = !!opts.reduce, NS = 'http://www.w3.org/2000/svg', doc = container.ownerDocument;
    var gid = 'sg' + Math.floor(Math.random() * 1e6);
    var svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 300 300'); svg.setAttribute('class', 'sphere-svg'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.innerHTML = '<defs><radialGradient id="' + gid + '" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs>' +
      '<ellipse cx="150" cy="282" rx="80" ry="9" fill="#14295A" opacity=".12"/>' +
      '<circle cx="150" cy="150" r="' + def.size / 2 + '" fill="' + def.colors.body + '"/><circle cx="150" cy="150" r="' + def.size / 2 + '" fill="url(#' + gid + ')"/><g class="sphere-eyes"></g>';
    var g = svg.querySelector('.sphere-eyes'), els = [0, 1].map(function () { var e = doc.createElementNS(NS, 'ellipse'); e.setAttribute('fill', def.colors.eyes); g.appendChild(e); return e; });
    container.appendChild(svg);
    var cur = def.expressions.neutral, anim = null, t0 = 0, anchor = cur, raf = 0, nextBlink = 0, blinkAt = -1e9, stopped = false;
    function draw(expr, open) {
      eyes(expr, def.size).forEach(function (p, i) {
        var e = els[i]; if (!p.visible) { e.setAttribute('rx', 0); return; }
        e.setAttribute('cx', p.cx.toFixed(2)); e.setAttribute('cy', p.cy.toFixed(2)); e.setAttribute('rx', Math.max(0, p.rx).toFixed(2)); e.setAttribute('ry', Math.max(0.6, p.ry * open).toFixed(2));
        e.setAttribute('transform', 'rotate(' + p.rot.toFixed(1) + ' ' + p.cx.toFixed(2) + ' ' + p.cy.toFixed(2) + ')');
      });
    }
    function tick(ts) {
      if (stopped || !container.isConnected) return;
      var fr = frame(anim, def.expressions, ts - t0), from = fr.first ? anchor : def.expressions[fr.from];
      cur = mix(from, def.expressions[fr.to], fr.k);
      var b = anim.blink; if (b && ts >= nextBlink) { blinkAt = ts; nextBlink = ts + b.durationMs + b.minIntervalMs + Math.random() * (b.maxIntervalMs - b.minIntervalMs); }
      draw(cur, b ? blink(ts - blinkAt, b.durationMs) : 1);
      raf = requestAnimationFrame(tick);
    }
    function play(name) {
      var a = def.animations[name] || def.animations.idle; anchor = cur; anim = a; cancelAnimationFrame(raf);
      if (reduce) { cur = def.expressions[a.steps[0].expression]; draw(cur, 1); return; } // one still look, no motion
      t0 = performance.now(); nextBlink = t0 + (a.blink ? a.blink.initialDelayMs : 1e9); raf = requestAnimationFrame(tick);
    }
    draw(cur, 1);
    return { play: play, destroy: function () { stopped = true; cancelAnimationFrame(raf); svg.remove(); } };
  }
  return { eyes: eyes, mix: mix, ease: ease, frame: frame, blink: blink, create: create };
});
