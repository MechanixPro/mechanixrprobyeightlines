/* Pro Check 20 screens, shared by the technician job page (/job/) and the garage app (/garage/).
   One group of points per screen, then the test ride, then a finish screen. Selecting an answer updates in place. Progress is saved after each screen (check_save), so a reload resumes.
   Needs assets/js/pro-check-data.js (window.MXP_PRO_CHECK). No inline script, no inline style (CSP). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_PCHK = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var D = function () { return (typeof window !== 'undefined' && window.MXP_PRO_CHECK) || (typeof self !== 'undefined' && self.MXP_PRO_CHECK) || null; };

  /** Index of the first screen that still has an unanswered point (groups first, then the test ride at index = groups.length). */
  function firstOpen(groups, res) {
    for (var i = 0; i < groups.length; i++) for (var j = 0; j < groups[i].points.length; j++) if (!(res.points && res.points[groups[i].points[j].key])) return i;
    return res.test_ride ? groups.length + 1 : groups.length;
  }
  /** A group screen can go Next only when every point on it has an answer. */
  function groupDone(group, res) { return group.points.every(function (p) { return !!(res.points && res.points[p.key]); }); }
  /** The test ride screen can go Next when it has an answer, and a reason if it was not done. */
  function rideDone(res) { var t = res.test_ride; return !!(t && (t.r !== 'not_done' || t.why)); }
  /** Plain suggested quote lines from the needs-attention points. */
  function suggested(groups, res) {
    var out = []; groups.forEach(function (g) { g.points.forEach(function (p) { var v = res.points && res.points[p.key]; if (v && v.r === 'needs_attention') out.push(p.label + (v.n ? ': ' + v.n : '')); }); }); return out;
  }
  function counts(groups, res) {
    var ok = 0, att = 0, skip = 0; groups.forEach(function (g) { g.points.forEach(function (p) { var v = res.points && res.points[p.key]; if (!v) return; if (v.r === 'ok') ok++; else if (v.r === 'needs_attention') att++; else skip++; }); }); return { ok: ok, attention: att, skipped: skip };
  }

  function create(o) {
    var doc = o.doc, data = D(), groups = data.groups, total = groups.length + 1;
    var res = { points: {}, test_ride: null }, idx = 0, busy = false, root = doc.createElement('div'); root.className = 'pc';
    var el = function (tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    function save() {
      var body = { points: res.points }; if (res.test_ride) body.test_ride = res.test_ride;
      return o.call('check_save', { results: body });
    }
    function head(step) {
      var h = el('div', 'pc-top'), dots = el('div', 'pc-dots'); dots.setAttribute('aria-label', 'Step ' + (step + 1) + ' of ' + (total + 1));
      for (var i = 0; i <= total; i++) dots.appendChild(el('span', 'pc-dot' + (i < step ? ' done' : i === step ? ' now' : '')));
      var back = el('button', 'cp-linkbtn', step === 0 ? '← Back to the job' : '← Back'); back.type = 'button'; back.onclick = function () { if (step === 0) o.onClose(); else { idx = step - 1; draw(); } };
      h.appendChild(back); h.appendChild(dots); return h;
    }
    function row(p) {
      var v = res.points[p.key], r = el('div', 'pc-row'); r.appendChild(el('p', 'pc-q', p.label));
      var seg = el('div', 'pc-seg');
      [['ok', 'OK'], ['needs_attention', 'Needs attention'], ['not_applicable', 'Skip']].forEach(function (a) {
        var b = el('button', 'pc-b pc-' + a[0] + (v && v.r === a[0] ? ' on' : ''), a[1]); b.type = 'button'; b.setAttribute('aria-pressed', v && v.r === a[0] ? 'true' : 'false');
        b.onclick = function () { var keep = res.points[p.key] && res.points[p.key].n; res.points[p.key] = { r: a[0] }; if (a[0] === 'needs_attention' && keep) res.points[p.key].n = keep; draw(true); };
        seg.appendChild(b);
      });
      r.appendChild(seg);
      if (v && v.r === 'needs_attention') {
        var n = el('input', 'pc-note'); n.type = 'text'; n.maxLength = data.noteMax; n.placeholder = 'What did you see? (optional)'; n.value = v.n || ''; n.setAttribute('aria-label', 'Note for ' + p.label);
        n.oninput = function () { var t = n.value.trim(); if (t) res.points[p.key].n = t; else delete res.points[p.key].n; }; r.appendChild(n);
      }
      return r;
    }
    function next(label, ok, fn) {
      var b = el('button', 'cp-btn cp-primary', label); b.type = 'button'; b.disabled = !ok || busy; b.onclick = function () { if (busy) return; busy = true; b.disabled = true; fn(); }; return b;
    }
    function failText(m) { var e = root.querySelector('.pc-err'); if (e) e.textContent = m; busy = false; var nb = root.querySelector('.cp-primary'); if (nb) nb.disabled = false; }
    function draw(keepScroll) {
      var sc = keepScroll ? (root.querySelector('.pc-list') || { scrollTop: 0 }).scrollTop : 0;
      root.textContent = ''; var inner = el('div', 'pc-in'); root.appendChild(inner);
      if (idx < groups.length) {
        var g = groups[idx]; inner.appendChild(head(idx)); inner.appendChild(el('h2', 'cp-h', g.title)); inner.appendChild(el('p', 'cp-line', 'Point ' + (groups.slice(0, idx).reduce(function (a, x) { return a + x.points.length; }, 0) + 1) + ' of 20 starts here'));
        var list = el('div', 'pc-list'); g.points.forEach(function (p) { list.appendChild(row(p)); }); inner.appendChild(list);
        inner.appendChild(el('p', 'pc-err')); inner.lastChild.setAttribute('role', 'alert');
        inner.appendChild(next('Next', groupDone(g, res), function () { save().then(function (x) { if (x.ok) { busy = false; idx++; draw(); } else failText((x.data && x.data.error) || 'Could not save. Try again.'); }); }));
        if (keepScroll) { var l = root.querySelector('.pc-list'); if (l) l.scrollTop = sc; }
      } else if (idx === groups.length) {
        inner.appendChild(head(idx)); inner.appendChild(el('h2', 'cp-h', 'Test ride')); inner.appendChild(el('p', 'cp-line', data.safety));
        var list2 = el('div', 'pc-list');
        [['done_fine', 'Done, all fine'], ['done_note', 'Done, something to note'], ['not_done', 'Not done']].forEach(function (a) {
          var b = el('button', 'pc-big' + (res.test_ride && res.test_ride.r === a[0] ? ' on' : ''), a[1]); b.type = 'button'; b.setAttribute('aria-pressed', res.test_ride && res.test_ride.r === a[0] ? 'true' : 'false');
          b.onclick = function () { var keep = res.test_ride && res.test_ride.n; res.test_ride = { r: a[0] }; if (keep) res.test_ride.n = keep; draw(); }; list2.appendChild(b);
        });
        if (res.test_ride && res.test_ride.r === 'not_done') {
          var why = el('div', 'pc-why');
          data.skip.forEach(function (k) { var c = el('button', 'pc-chip' + (res.test_ride.why === k ? ' on' : ''), data.labels[k]); c.type = 'button'; c.onclick = function () { res.test_ride.why = k; draw(); }; why.appendChild(c); });
          list2.appendChild(why);
        }
        if (res.test_ride) { var tn = el('input', 'pc-note'); tn.type = 'text'; tn.maxLength = data.noteMax; tn.placeholder = 'Note (optional)'; tn.value = res.test_ride.n || ''; tn.setAttribute('aria-label', 'Test ride note'); tn.oninput = function () { var t = tn.value.trim(); if (t) res.test_ride.n = t; else delete res.test_ride.n; }; list2.appendChild(tn); }
        inner.appendChild(list2); inner.appendChild(el('p', 'pc-err')); inner.lastChild.setAttribute('role', 'alert');
        inner.appendChild(next('Finish the check', rideDone(res), function () { save().then(function (x) { if (x.ok && x.data && x.data.complete) { busy = false; idx++; draw(); if (o.onDone) o.onDone(); } else failText((x.data && x.data.error) || 'Some points are still unanswered. Go back and check.'); }); }));
      } else {
        var c = counts(groups, res), sg = suggested(groups, res);
        inner.appendChild(el('div', 'cp-tick')); inner.lastChild.appendChild(el('div', 'cp-tickmark', '✓'));
        inner.appendChild(el('h2', 'cp-h', 'Pro Check complete')); inner.appendChild(el('p', 'cp-line', c.ok + ' OK' + (c.attention ? ', ' + c.attention + ' need attention' : '') + (c.skipped ? ', ' + c.skipped + ' skipped' : '') + '.'));
        if (sg.length) { inner.appendChild(el('p', 'pc-sg-h', 'Suggested lines for the quote')); var ul = el('ul', 'pc-sg'); sg.forEach(function (s) { ul.appendChild(el('li', null, s)); }); inner.appendChild(ul); }
        var done = el('button', 'cp-btn cp-primary', 'Back to the job'); done.type = 'button'; done.onclick = function () { o.onClose(); }; inner.appendChild(done);
      }
    }
    // Open: load what is saved, then jump to the first screen that still needs answers.
    root.appendChild(el('p', 'cp-line', 'Loading the check'));
    o.call('check_get', {}).then(function (x) {
      if (x.ok && x.data && x.data.results) { res = { points: x.data.results.points || {}, test_ride: x.data.results.test_ride || null }; }
      idx = x.ok && x.data && x.data.complete ? total : firstOpen(groups, res); draw();
    }, function () { root.textContent = ''; root.appendChild(el('p', 'pc-err', 'Could not open the check. Go back and try again.')); });
    return { el: root, stop: function () {} };
  }
  return { create: create, firstOpen: firstOpen, groupDone: groupDone, rideDone: rideDone, suggested: suggested, counts: counts };
});
