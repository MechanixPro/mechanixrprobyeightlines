/* Mechanix Pro partner onboarding: the private page at /onboard/?t=<64 hex>. No inline script (CSP). One step per screen.
   The link token is kept in sessionStorage for this tab and removed from the address bar. Server: supabase/functions/partner-onboard. */
(function () {
  'use strict';
  var win = window, d = document, C = win.MXP || {}, app = d.getElementById('app'); if (!app) return;
  var KEY = 'mxp_onboard_t', AGREEMENT = '/assets/legal/Mechanix-Pro-Garage-Partner-Agreement.pdf';
  var CONSENT = 'We collect these documents only to verify you. Only authorised Mechanix Pro staff can see them. We keep them while you work with us and as the law requires. You can ask us to delete them.';
  var NET = 'Check your internet and try again.';
  var S = { me: null, steps: [], i: 0, agreed: false, busy: false, err: null, last: {} };

  function token() {
    var t = '';
    try { t = new URLSearchParams(win.location.search).get('t') || ''; } catch (e) {}
    if (/^[a-f0-9]{64}$/.test(t)) { try { win.sessionStorage.setItem(KEY, t); } catch (e) {} try { win.history.replaceState(null, '', '/onboard/'); } catch (e) {} return t; }
    try { return win.sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  var TOKEN = token();

  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); });
    (kids || []).forEach(function (c) { if (c == null || c === false) return; n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function api(action, body) {
    var url = String(C.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/partner-onboard';
    var payload = Object.assign({ action: action, token: TOKEN }, body || {});
    return win.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey || '', Authorization: 'Bearer ' + (C.supabaseAnonKey || '') }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok !== false, data: j }; }); })
      .catch(function () { return { ok: false, data: { error: NET } }; });
  }

  function item() { var s = S.steps[S.i]; return s && s.item; }
  function shell(kind, kids, withBack) {
    app.textContent = '';
    var dots = el('div', { class: 'o-dots', 'aria-hidden': 'true' }, S.steps.map(function (s, k) { return el('span', { class: k === S.i ? 'cur' : (k < S.i ? 'on' : '') }); }));
    app.appendChild(el('div', { class: 'o-top' }, [el('span', { class: 'o-brand' }, ['Mechanix ', el('i', { text: 'Pro' })]), withBack ? el('button', { class: 'o-back', type: 'button', text: 'Back', onclick: function () { go(S.i - 1); } }) : null]));
    if (kind !== 'done') app.appendChild(dots);
    var main = el('main', { class: 'o-main' + (kind === 'done' ? ' o-done' : ''), tabindex: '-1' }, kids); app.appendChild(main);
  }
  function go(i) { S.i = Math.max(0, Math.min(S.steps.length - 1, i)); S.err = null; render(); }
  function errBox(msg) { return msg ? el('p', { class: 'o-err', role: 'alert', text: msg }) : null; }
  function next(label, fn, enabled) { return el('button', { class: 'o-btn', type: 'button', text: label, disabled: enabled === false, onclick: fn }); }

  function welcome() {
    var cb = el('input', { type: 'checkbox', id: 'oAgree', checked: S.agreed });
    var go1 = next('Start', function () { go(S.i + 1); }, S.agreed);
    cb.addEventListener('change', function () { S.agreed = cb.checked; go1.disabled = !cb.checked; });
    var list = S.me.checklist.map(function (c) { return c.label + (c.min > 1 ? ' (' + c.min + ')' : ''); });
    shell('welcome', [el('h1', { text: 'Hi' + (S.me.name ? ' ' + S.me.name : '') + ', let us verify you' }), el('p', { class: 'o-lead', text: 'Keep these ready. It takes about 5 minutes.' }),
      el('ul', { class: 'o-list' }, list.map(function (t) { return el('li', { text: t }); })),
      el('label', { class: 'o-consent', for: 'oAgree' }, [cb, el('span', { text: CONSENT + ' I agree.' })]), el('div', { style: 'flex:1' }), go1], false);
  }
  function agreement() {
    var mech = S.me.kind === 'mechanic';
    shell('agreement', [el('h1', { text: 'Partner agreement' }),
      mech ? el('p', { class: 'o-lead', text: 'Your agreement will be sent to you.' }) : el('p', { class: 'o-lead', text: 'Print it, sign every page, scan it as one PDF.' }),
      el('div', { style: 'flex:1' }), mech ? null : el('a', { class: 'o-btn alt', href: AGREEMENT, download: 'Mechanix-Pro-Garage-Partner-Agreement.pdf', text: 'Download agreement' }), next('Next', function () { go(S.i + 1); })], true);
  }

  function docStep() {
    var it = item(), pdfOnly = it.type === 'signed_agreement', multi = it.min > 1, done = it.have >= it.min;
    var rej = it.rejected && it.rejected[0] && !S.last[it.type] ? it.rejected[0] : null;
    var prev = el('div', { class: 'o-prev' }), state = el('p', { class: 'o-state', 'aria-live': 'polite' });
    if (S.last[it.type] && S.last[it.type].url) prev.appendChild(el('img', { src: S.last[it.type].url, alt: 'Your photo' }));
    else prev.textContent = done ? 'Uploaded' : (pdfOnly ? 'Choose the signed PDF' : 'Nothing added yet');
    state.textContent = multi ? it.have + ' of ' + it.min + ' added' : (done ? 'Uploaded' : '');
    if (done) state.className = 'o-state ok';
    var bar = el('div', { class: 'o-bar', hidden: true }, [el('b')]); bar.hidden = true;
    var nextBtn = next(multi && !done ? 'Add ' + (it.min - it.have) + ' more to continue' : 'Next', function () { go(S.i + 1); }, done);
    var pick = function (accept, label, capture, primary) {
      var inp = el('input', { type: 'file', accept: accept, capture: capture, 'aria-label': label });
      inp.addEventListener('change', function () { if (inp.files && inp.files[0]) upload(inp.files[0]); inp.value = ''; });
      return el('span', { class: 'o-btn o-pick' + (primary ? '' : ' alt'), 'aria-hidden': 'false' }, [label, inp]);
    };
    function setBusy(b) { S.busy = b; bar.hidden = !b; nextBtn.disabled = b || !(item().have >= item().min); btns.forEach(function (x) { x.style.pointerEvents = b ? 'none' : ''; x.style.opacity = b ? '.5' : ''; }); }
    function fail(msg) { setBusy(false); state.className = 'o-state'; state.textContent = ''; S.err = msg; var old = app.querySelector('.o-err'); if (old) old.remove(); var e = errBox(msg); if (e) main.insertBefore(e, main.firstChild); }
    function upload(f) {
      if (pdfOnly && f.type !== 'application/pdf') return fail('The signed agreement must be one PDF.');
      if (!/^image\/|^application\/pdf$/.test(f.type)) return fail('Choose a photo or a PDF.');
      var old = app.querySelector('.o-err'); if (old) old.remove();
      setBusy(true); state.className = 'o-state'; state.textContent = 'Uploading';
      if (f.type.indexOf('image/') === 0 && win.FileReader) { var fr = new win.FileReader(); fr.onload = function () { S.last[it.type] = { url: String(fr.result) }; prev.textContent = ''; prev.appendChild(el('img', { src: String(fr.result), alt: 'Your photo' })); }; fr.readAsDataURL(f); }
      else { prev.textContent = f.name; }
      api('upload_url', { doc_type: it.type, content_type: f.type, size: f.size }).then(function (r) {
        if (!r.ok) throw new Error(r.data.error || NET);
        return win.fetch(r.data.url, { method: 'PUT', headers: { 'Content-Type': f.type, 'x-upsert': 'false' }, body: f }).then(function (x) { if (!x.ok) throw new Error('The upload did not finish. ' + NET); return r.data.path; });
      }).then(function (path) { return api('doc_done', { doc_type: it.type, path: path }).then(function (r) { if (!r.ok) throw new Error(r.data.error || NET); }); })
        .then(function () { return refresh(); }).then(function () { S.last[it.type] = S.last[it.type] || {}; render(true); })
        .catch(function (e) { fail(e && e.message ? e.message : NET); });
    }
    var btns = [];
    var tops = [];
    if (!pdfOnly) btns.push(pick('image/*', done && !multi ? 'Retake photo' : (multi && it.have ? 'Add another photo' : 'Take photo'), 'environment', !done));
    btns.push(pick(pdfOnly ? 'application/pdf' : 'image/*,application/pdf', done && !multi ? 'Choose another file' : 'Choose file', null, pdfOnly && !done));
    var main = null;
    shell('doc', [errBox(rej || S.err), el('h1', { text: it.label }), prev, state, bar, done ? nextBtn : null, el('div', { class: 'o-row' }, btns.map(function (b, k) { return b; })), done ? null : nextBtn], true);
    main = app.querySelector('.o-main'); if (rej) { var e0 = main.firstChild; if (e0) e0.className = 'o-red'; e0.removeAttribute('role'); }
  }

  function review() {
    var m = S.me, busyBtn = next('Send for review', function () {
      busyBtn.disabled = true; busyBtn.textContent = 'Sending';
      api('submit').then(function (r) { if (r.ok) { S.me.submitted = true; go(S.steps.length - 1); } else { S.err = r.data.error || NET; render(); } });
    }, !!m.can_submit);
    shell('review', [errBox(S.err), el('h1', { text: 'Check and send' }), el('ul', { class: 'o-check' }, m.checklist.map(function (c, k) {
      var ok = c.have >= c.min;
      return el('li', { onclick: function () { go(2 + k); } }, [el('span', { class: 't' + (ok ? ' ok' : ''), text: ok ? '✓' : '' }), el('span', { text: c.label + (c.min > 1 ? ' (' + c.have + '/' + c.min + ')' : '') })]);
    })), el('div', { style: 'flex:1' }), busyBtn], true);
  }
  function finished() { shell('done', [el('div', { class: 'o-tick', 'aria-hidden': 'true', text: '✓' }), el('h1', { text: 'Sent' }), el('p', { class: 'o-lead', text: 'We will check your documents and contact you.' })], false); }
  function message(text) { app.textContent = ''; app.appendChild(el('main', { class: 'o-main o-done' }, [el('h1', { text: 'Mechanix Pro' }), el('p', { class: 'o-lead', role: 'alert', text: text })])); }

  function render(stay) {
    var st = S.steps[S.i]; if (!st) return;
    if (st.kind === 'welcome') welcome(); else if (st.kind === 'agreement') agreement(); else if (st.kind === 'doc') docStep(); else if (st.kind === 'review') review(); else finished();
    var m = app.querySelector('.o-main'); if (m && !stay) try { m.focus({ preventScroll: true }); } catch (e) {}
  }
  function build() {
    var s = [{ kind: 'welcome' }, { kind: 'agreement' }];
    S.me.checklist.forEach(function (c) { s.push({ kind: 'doc', item: c }); });
    s.push({ kind: 'review' }, { kind: 'done' }); S.steps = s;
  }
  function refresh() {
    return api('me').then(function (r) {
      if (!r.ok) throw new Error(r.data.error || NET);
      S.me = r.data; var cur = S.steps[S.i] && S.steps[S.i].item && S.steps[S.i].item.type;
      build(); if (cur) S.steps.forEach(function (st, k) { if (st.item && st.item.type === cur) S.i = k; });
    });
  }

  if (!TOKEN) { message('This link has expired or is not valid. Ask Mechanix Pro for a new one.'); return; }
  refresh().then(function () { S.i = S.me.submitted ? S.steps.length - 1 : 0; render(); }).catch(function (e) { message(e && e.message ? e.message : NET); });
})();
