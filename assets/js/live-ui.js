/* Mechanix Live screen, shared by the technician job page (/job/) and the garage app (/garage/).
   Take a photo or record a short clip (up to 15 seconds); it uploads and appears on the customer's tracking page.
   Needs a call(action, body) that resolves { ok, data }. No inline script, no inline style (CSP). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_LIVE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX_CLIP_S = 15, MAX_BYTES = 30 * 1024 * 1024, GRACE_S = 1;

  /** Can this file be shared? A photo or a clip no longer than 15 seconds and under 30 MB. Pure. */
  function checkFile(kind, size, seconds) {
    if (!size || size > MAX_BYTES) return { ok: false, error: 'This file is too big. Record a shorter clip, up to 15 seconds.' };
    if (kind === 'clip' && !(seconds > 0 && seconds <= MAX_CLIP_S + GRACE_S)) return { ok: false, error: 'Clips can be up to 15 seconds. Record a shorter one.' };
    return { ok: true };
  }
  function mimeOf(file, kind) {
    var t = String(file.type || '').split(';')[0].toLowerCase();
    if (/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(t)) return t;
    return kind === 'clip' ? 'video/mp4' : 'image/jpeg';
  }

  function create(o) {
    var doc = o.doc, shared = 0, busy = false, root = doc.createElement('div'); root.className = 'pc lv';
    var el = function (tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    var msg = el('p', 'pc-err'); msg.setAttribute('role', 'alert');
    var info = el('p', 'cp-line', '');
    function say(t, ok) { msg.textContent = t || ''; msg.className = ok ? 'cp-line' : 'pc-err'; }
    function seconds(file) {
      return new Promise(function (resolve) {
        var v = doc.createElement('video'), url = (o.win || window).URL.createObjectURL(file), done = function (s) { try { (o.win || window).URL.revokeObjectURL(url); } catch (e) {} resolve(s); };
        v.preload = 'metadata'; v.onloadedmetadata = function () { done(v.duration); }; v.onerror = function () { done(0); }; v.src = url;
      });
    }
    function toJpeg(file) {   // photos: longest side 1280 px, JPEG 0.7 (about 150 KB)
      return new Promise(function (resolve) {
        var img = new Image(), win = o.win || window, url = win.URL.createObjectURL(file);
        img.onload = function () {
          var s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = doc.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); win.URL.revokeObjectURL(url);
          c.toBlob(function (b) { resolve(b || file); }, 'image/jpeg', 0.7);
        };
        img.onerror = function () { win.URL.revokeObjectURL(url); resolve(file); }; img.src = url;
      });
    }
    function send(kind, file) {
      busy = true; say('Preparing…', true);
      var prep = kind === 'clip' ? seconds(file).then(function (s) { var g = checkFile('clip', file.size, s); if (!g.ok) throw new Error(g.error); return file; })
        : toJpeg(file).then(function (b) { var g = checkFile('photo', b.size, 0); if (!g.ok) throw new Error(g.error); return b; });
      prep.then(function (blob) {
        var type = kind === 'clip' ? mimeOf(file, 'clip') : 'image/jpeg';
        say('Sharing…', true);
        return o.call('live_upload_url', { types: [type] }).then(function (x) {
          if (!x.ok) throw new Error((x.data && x.data.error) || 'Could not share. Try again.');
          var u = x.data.uploads[0], fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', blob, 'live');
          return fetch(u.url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: fd }).then(function (r) {
            if (!r.ok) throw new Error('The upload did not finish. Check your internet and try again.');
            return o.call('live_add', { paths: [u.path] });
          });
        });
      }).then(function (x) {
        busy = false; if (!x.ok) throw new Error((x.data && x.data.error) || 'Could not share. Try again.');
        shared++; info.textContent = shared + (shared === 1 ? ' update' : ' updates') + ' shared. The customer can see ' + (shared === 1 ? 'it' : 'them') + ' now.'; say('Shared.', true);
      }).catch(function (e) { busy = false; say(e && e.message ? e.message : 'Could not share. Try again.'); });
    }
    function pick(kind) {
      var inp = doc.createElement('input'); inp.type = 'file'; inp.accept = kind === 'clip' ? 'video/*' : 'image/*'; inp.setAttribute('capture', 'environment'); inp.className = 'lv-file'; inp.hidden = true;
      inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); if (f && !busy) send(kind, f); };
      root.appendChild(inp); inp.click();
    }
    var top = el('div', 'pc-top'), back = el('button', 'cp-linkbtn', '← Back to the job'); back.type = 'button'; back.onclick = function () { o.onClose(); }; top.appendChild(back);
    var photo = el('button', 'cp-btn cp-primary', 'Take a photo'); photo.type = 'button'; photo.onclick = function () { if (!busy) pick('photo'); };
    var clip = el('button', 'cp-btn', 'Record a clip (up to 15 seconds)'); clip.type = 'button'; clip.onclick = function () { if (!busy) pick('clip'); };
    var done = el('button', 'cp-linkbtn', 'Done'); done.type = 'button'; done.onclick = function () { o.onClose(); };
    var inner = el('div', 'pc-in'); [top, el('h2', 'cp-h', 'Share an update'), el('p', 'cp-line', 'Show the customer the work as it goes: a photo or a short clip. Keep faces, number plates and other people out of the shot.'), photo, clip, info, msg, done].forEach(function (n) { inner.appendChild(n); });
    root.appendChild(inner);
    return { el: root, stop: function () {} };
  }
  return { create: create, checkFile: checkFile, mimeOf: mimeOf, MAX_CLIP_S: MAX_CLIP_S };
});
