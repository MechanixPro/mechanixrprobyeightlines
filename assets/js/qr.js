/* A small QR code encoder for the payment screens: byte mode, error correction M, versions 1 to 10 (up to 213 bytes, plenty for a payment link). No library, no external service, no network.
   Follows ISO/IEC 18004 (same algorithm as the public-domain Nayuki reference): Reed-Solomon over GF(256), block interleaving, function patterns, the 8 masks and the standard penalty score.
   MXP_QR.encode(text) -> { size, get(x, y) }.  MXP_QR.svg(doc, text, px) -> an <svg> element built with createElementNS (no inline style, no innerHTML: the page's CSP allows neither). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_QR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [0, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5];   // level M, index = version
  var MAX_VERSION = 10;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]; }
  function utf8(s) { var out = [], b = unescape(encodeURIComponent(s)); for (var i = 0; i < b.length; i++) out.push(b.charCodeAt(i)); return out; }

  /* Reed-Solomon */
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var k = 0; k < deg; k++) { for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) { var f = b ^ r.shift(); r.push(0); div.forEach(function (c, i) { r[i] ^= gfMul(c, f); }); });
    return r;
  }

  function addEccAndInterleave(data, ver) {
    var nb = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8), shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], div = rsDivisor(eccLen), k = 0;
    for (var i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1)); k += dat.length;
      var ecc = rsRemainder(dat, div); if (i < shortBlocks) dat.push(0); blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (var c = 0; c < blocks[0].length; c++) blocks.forEach(function (b, j) { if (c !== shortLen - eccLen || j >= shortBlocks) out.push(b[c]); });
    return out;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, size = ver * 4 + 17, r = [6];
    for (var pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  function build(codewords, ver) {
    var size = ver * 4 + 17, mod = [], fn = [], i, j;
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    function finder(cx, cy) { for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(ver);
    ap.forEach(function (ay, a) { ap.forEach(function (ax, b) {
      if ((a === 0 && b === 0) || (a === 0 && b === ap.length - 1) || (a === ap.length - 1 && b === 0)) return;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }); });
    function format(mask) {   // error correction level M has format bits 0
      var data = (0 << 3) | mask, rem = data, k; for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412, bit = function (n) { return ((bits >>> n) & 1) !== 0; };
      for (k = 0; k <= 5; k++) set(8, k, bit(k)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (k = 9; k < 15; k++) set(14 - k, 8, bit(k));
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k)); for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(k)); set(8, size - 8, true);
    }
    format(0);
    if (ver >= 7) {
      var rem = ver, k; for (k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (k = 0; k < 18; k++) { var d = ((vb >>> k) & 1) !== 0, a = size - 11 + k % 3, b = Math.floor(k / 3); set(a, b, d); set(b, a, d); }
    }
    // data bits, zig-zag from the bottom right, skipping the vertical timing column
    var bi = 0, total = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < total) { mod[y][x] = ((codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv; switch (m) {
          case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break; default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
      }
    }
    function penalty() {
      var score = 0, x, y, line;
      function lineScore(get) {
        var s = 0, i2, runv = 1;
        for (i2 = 1; i2 < size; i2++) { if (get(i2) === get(i2 - 1)) { runv++; } else { if (runv >= 5) s += runv - 2; runv = 1; } }
        if (runv >= 5) s += runv - 2;
        // finder-like 1:1:3:1:1 with 4 light modules either side
        var bits = []; for (i2 = 0; i2 < size; i2++) bits.push(get(i2) ? 1 : 0);
        var str = '0000' + bits.join('') + '0000', re = /(?=(10111010000|00001011101))/g, m; while ((m = re.exec(str))) { s += 40; re.lastIndex = m.index + 1; }
        return s;
      }
      for (y = 0; y < size; y++) { line = mod[y]; score += lineScore(function (i2) { return line[i2]; }); }
      for (x = 0; x < size; x++) score += lineScore(function (i2) { return mod[i2][x]; });
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3; }
      var dark = 0; mod.forEach(function (r) { r.forEach(function (v) { if (v) dark++; }); });
      var tot = size * size, kk = Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1; score += Math.max(0, kk) * 10;
      return score;
    }
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) { applyMask(m); format(m); var p = penalty(); if (p < bestScore) { best = m; bestScore = p; } applyMask(m); }
    applyMask(best); format(best);
    return { size: size, get: function (x, y) { return x >= 0 && y >= 0 && x < size && y < size && mod[y][x]; } };
  }

  function encode(text) {
    var bytes = utf8(String(text)), ver = 1;
    while (ver <= MAX_VERSION) { var cc = ver < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(ver) * 8) break; ver++; }
    if (ver > MAX_VERSION) throw new Error('Too long for a QR code here');
    var bits = []; function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }
    var q = build(addEccAndInterleave(data, ver), ver); q.version = ver; return q;
  }

  /* One <path> for all dark modules, with a 4-module quiet zone, drawn as SVG attributes only. */
  function svg(doc, text, px) {
    var q = encode(text), n = q.size + 8, NS = 'http://www.w3.org/2000/svg', s = doc.createElementNS(NS, 'svg'), d = '';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.get(x, y)) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
    s.setAttribute('viewBox', '0 0 ' + n + ' ' + n); s.setAttribute('width', String(px || 220)); s.setAttribute('height', String(px || 220)); s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'QR code'); s.setAttribute('shape-rendering', 'crispEdges');
    var bg = doc.createElementNS(NS, 'rect'); bg.setAttribute('width', String(n)); bg.setAttribute('height', String(n)); bg.setAttribute('fill', '#ffffff'); s.appendChild(bg);
    var p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', '#000000'); s.appendChild(p);
    return s;
  }
  return { encode: encode, svg: svg, MAX_VERSION: MAX_VERSION };
});
