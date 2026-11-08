/* Mechanix Pro partner flow, shared by /garage/ and /mechanic/. No inline script (CSP).
   - Availability selfie: tapping Available opens a camera screen (input capture=user), a preview, "Use this photo", then upload. The server checks the 24-hour rule again.
   - Terms: one short screen the first time after a release (version key), stored by the server.
   - Tour: 4 screens, one step each, shown once (localStorage, guarded, and recorded with the terms).
   Pure helpers are exported for tests; the screens need a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_FLOW = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var WINDOW_MS = 24 * 3600e3, MAX_BYTES = 5 * 1024 * 1024, TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };
  var TERMS = [
    ['Do the job', 'Accept it, go, call the customer, do the work.'],
    ['Quote first', 'Send the quote before any extra work. The customer must approve it.'],
    ['Code', 'Ask for the customer’s code at the door before you start.'],
    ['Photos', 'Take before and after photos on every job.'],
    ['Payment', 'The customer pays online first. Cash only when the team allows it.'],
    ['No outside contact', 'Do not take jobs or money outside Mechanix Pro.'],
    ['Penalties', 'No-show ₹300. Cancel ₹200. Missing photos ₹100.']
  ];
  var TOUR = [
    ['1', 'Accept the job', 'New jobs show on Home. Tap Accept so the customer knows you are coming.'],
    ['2', 'Go and call', 'Tap Go, then call the customer when you are close.'],
    ['3', 'Code and quote', 'Ask for the code at the door. Then send the quote for approval.'],
    ['4', 'Photos and payment', 'Take photos, then ask for online payment. Your payout follows.']
  ];
  /* ---------- pure helpers ---------- */
  function selfieFresh(at, now) {
    var t = typeof at === 'number' ? at : Date.parse(String(at || '')); if (!isFinite(t)) return false;
    var age = (now == null ? Date.now() : now) - t; return age >= -60000 && age < WINDOW_MS;
  }
  function selfieOk(type, size) { return !!TYPES[String(type || '')] && size > 0 && size <= MAX_BYTES; }
  function hhmm(at) { var t = Date.parse(String(at || '')); if (!isFinite(t)) return ''; var d = new Date(t + 5.5 * 3600e3); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  function selfieLine(at, now) { return selfieFresh(at, now) ? 'Selfie taken ' + hhmm(at) : 'Selfie needed to go Available'; }
  function tourKey(kind, version) { return 'mxp_tour_' + kind + '_' + version; }
  function tourSeen(win, kind, version) { try { return win.localStorage.getItem(tourKey(kind, version)) === '1'; } catch (e) { return false; } }
  function tourMark(win, kind, version) { try { win.localStorage.setItem(tourKey(kind, version), '1'); } catch (e) {} }
  /* What to show after login: 'terms' (then the tour), 'tour', or '' (nothing). */
  function nextGate(me, seenLocal) {
    var t = me && me.terms; if (!t) return '';
    if (!t.accepted) return 'terms';
    return !t.tour_done && !seenLocal ? 'tour' : '';
  }

  /* ---------- screens ---------- */
  function kit(win, app) {
    var d = win.document;
    function el(tag, attrs, kids) {
      var n = d.createElement(tag); attrs = attrs || {};
      Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); });
      (kids || []).forEach(function (c) { if (c == null || c === false) return; n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); }); return n;
    }
    function screen(kids) { while (app.firstChild) app.removeChild(app.firstChild); var s = el('main', { class: 'pf', id: 'pfScreen', tabindex: '-1' }, kids); app.appendChild(s); try { s.focus(); } catch (e) {} return s; }
    return { d: d, el: el, screen: screen };
  }

  /* o: { api, onDone(selfie_at), onCancel() } */
  function showSelfie(win, app, o) {
    var k = kit(win, app), el = k.el, file = null, busy = false;
    function draw(preview, err) {
      var input = el('input', { type: 'file', accept: 'image/*', capture: 'user', id: 'pfFile', class: 'pf-file', 'aria-label': 'Take a selfie', onchange: function () { pick(input.files && input.files[0]); } });
      var kids = [el('p', { class: 'pf-step', text: 'Quick check' }), el('h1', { text: 'Take a selfie' }), el('p', { class: 'pf-p', text: 'We ask once a day before you go Available. Face the camera in good light.' })];
      if (preview) kids.push(el('img', { class: 'pf-prev', id: 'pfPrev', src: preview, alt: 'Your selfie preview', width: 160, height: 160 }));
      else kids.push(el('div', { class: 'pf-face', 'aria-hidden': 'true' }));
      if (err) kids.push(el('p', { class: 'pf-err', role: 'alert', text: err }));
      kids.push(input);
      if (preview) {
        kids.push(el('button', { class: 'pf-btn', type: 'button', id: 'pfUse', disabled: busy ? 'disabled' : null, onclick: upload, text: busy ? 'Saving' : 'Use this photo' }));
        kids.push(el('button', { class: 'pf-link', type: 'button', id: 'pfRetake', disabled: busy ? 'disabled' : null, onclick: function () { input.click(); }, text: 'Retake' }));
      } else kids.push(el('button', { class: 'pf-btn', type: 'button', id: 'pfOpen', onclick: function () { input.click(); }, text: 'Open camera' }));
      kids.push(el('button', { class: 'pf-link', type: 'button', id: 'pfCancel', onclick: function () { if (o.onCancel) o.onCancel(); }, text: 'Not now' }));
      k.screen(kids);
    }
    function pick(f) {
      if (!f) return;
      if (!selfieOk(f.type, f.size)) { file = null; return draw(null, 'Use a JPG, PNG or WebP photo under 5 MB.'); }
      file = f; var r = new win.FileReader();
      r.onload = function () { draw(String(r.result), null); }; r.onerror = function () { draw(null, 'Could not read that photo. Try again.'); }; r.readAsDataURL(f);
    }
    function upload() {
      if (!file || busy) return; busy = true; var cur = file; draw(preview(), null);
      function preview() { var i = k.d.getElementById('pfPrev'); return i ? i.getAttribute('src') : null; }
      var pv = preview();
      function fail(m) { busy = false; draw(pv, m || 'Could not save the photo. Check your internet and try again.'); }
      o.api('selfie_upload_url', { content_type: cur.type, size: cur.size }).then(function (r) {
        if (!r.ok) return fail(r.data && r.data.error);
        var fd = new win.FormData(); fd.append('cacheControl', '3600'); fd.append('', cur);
        return win.fetch(r.data.url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: fd }).then(function (x) {
          if (!x.ok) return fail();
          return o.api('selfie_record', { path: r.data.path }).then(function (z) { if (!z.ok) return fail(z.data && z.data.error); busy = false; o.onDone(z.data.selfie_at); });
        }, function () { fail(); });
      });
    }
    draw(null, null);
  }

  /* o: { api, version, onDone() } */
  function showTerms(win, app, o) {
    var k = kit(win, app), el = k.el, busy = false;
    function draw(err) {
      k.screen([el('p', { class: 'pf-step', text: 'Partner terms ' + o.version }), el('h1', { text: 'How we work together' }),
        el('ul', { class: 'pf-list' }, TERMS.map(function (t) { return el('li', {}, [el('b', { text: t[0] + '. ' }), t[1]]); })),
        err ? el('p', { class: 'pf-err', role: 'alert', text: err }) : null,
        el('button', { class: 'pf-btn', type: 'button', id: 'pfAgree', disabled: busy ? 'disabled' : null, onclick: agree, text: busy ? 'Saving' : 'I agree' })]);
    }
    function agree() { if (busy) return; busy = true; draw(null); o.api('terms_accept', { tour: false }).then(function (r) { busy = false; if (!r.ok) return draw(r.data && r.data.error || 'Could not save. Try again.'); o.onDone(); }); }
    draw(null);
  }

  /* o: { api, kind, version, onDone() } one step per screen, Skip on every screen */
  function showTour(win, app, o) {
    var k = kit(win, app), el = k.el, i = 0;
    function finish() { tourMark(win, o.kind, o.version); o.api('terms_accept', { tour: true }).then(function () {}); o.onDone(); }
    function draw() {
      var t = TOUR[i], last = i === TOUR.length - 1;
      k.screen([el('p', { class: 'pf-step', text: 'Step ' + (i + 1) + ' of ' + TOUR.length }), el('div', { class: 'pf-num', 'aria-hidden': 'true', text: t[0] }), el('h1', { text: t[1] }), el('p', { class: 'pf-p', text: t[2] }),
        el('div', { class: 'pf-dots', 'aria-hidden': 'true' }, TOUR.map(function (_, j) { return el('span', { class: j === i ? 'on' : '' }); })),
        el('button', { class: 'pf-btn', type: 'button', id: 'pfNext', onclick: function () { if (last) finish(); else { i++; draw(); } }, text: last ? 'Start' : 'Next' }),
        el('button', { class: 'pf-link', type: 'button', id: 'pfSkip', onclick: finish, text: 'Skip' })]);
    }
    draw();
  }

  /* After login: run the gates one after another, then call done(). */
  function runGate(win, app, o) {
    var g = nextGate(o.me, tourSeen(win, o.kind, o.me && o.me.terms && o.me.terms.version));
    var v = o.me && o.me.terms && o.me.terms.version;
    if (g === 'terms') return showTerms(win, app, { api: o.api, version: v, onDone: function () { if (tourSeen(win, o.kind, v)) o.done(); else showTour(win, app, { api: o.api, kind: o.kind, version: v, onDone: o.done }); } });
    if (g === 'tour') return showTour(win, app, { api: o.api, kind: o.kind, version: v, onDone: o.done });
    o.done();
  }
  return { selfieFresh: selfieFresh, selfieOk: selfieOk, selfieLine: selfieLine, hhmm: hhmm, nextGate: nextGate, tourKey: tourKey, tourSeen: tourSeen, tourMark: tourMark, showSelfie: showSelfie, showTerms: showTerms, showTour: showTour, runGate: runGate, TOUR: TOUR, TERMS: TERMS, WINDOW_MS: WINDOW_MS };
});
