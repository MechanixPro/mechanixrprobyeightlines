/* Mechanix Pro Garage: the partner garage app at /garage/. No inline script (CSP). Design: docs/superpowers/specs/2026-11-06-partner-garage-app-design.md
   - The private link /garage/?g=<token> is saved on this phone, then removed from the address bar; the home-screen icon opens the PIN screen.
   - The PIN creates a 12-hour session (kept on this phone until it ends or you tap Lock). Nothing private is cached by a service worker.
   - The customer's address and email never reach this app. The phone number appears only in an open job's detail, and is not stored by the app.
   Pure helpers are exported for tests; the screens start only in a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_GARAGE = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LINK_KEY = 'mxp_garage_link', SESSION_KEY = 'mxp_garage_session', LINK_RE = /^[0-9a-f]{48}$/, MAX_PHOTOS = 4;

  /* ---------- pure helpers ---------- */
  function money(n) { n = Number(n) || 0; return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function totals(lines) {
    var sub = 0; (lines || []).forEach(function (l) { var a = Number(l.amount); if (isFinite(a) && a > 0) sub += a; });
    sub = Math.round(sub * 100) / 100; var gst = Math.round(sub * 18) / 100;
    return { subtotal: sub, gst: gst, total: Math.round((sub + gst) * 100) / 100 };
  }
  function whenText(iso, now) {
    if (!iso) return null; var d = new Date(iso); if (isNaN(d)) return null;
    var opt = { timeZone: 'Asia/Kolkata' }, day = d.toLocaleDateString('en-IN', Object.assign({ weekday: 'short', day: 'numeric', month: 'short' }, opt)), hm = d.toLocaleTimeString('en-IN', Object.assign({ hour: 'numeric', minute: '2-digit', hour12: true }, opt));
    return day + ', ' + hm.toLowerCase();
  }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function telHref(phone10) { var p = digits(phone10).slice(-10); return /^[6-9]\d{9}$/.test(p) ? 'tel:+91' + p : null; }
  function phoneShow(phone10) { var p = digits(phone10).slice(-10); return /^[6-9]\d{9}$/.test(p) ? '+91 ' + p.slice(0, 5) + ' ' + p.slice(5) : ''; }
  /* Team contact from the site config (window.MXP): never a number typed into this file. */
  function teamLinks(cfg, extra) {
    cfg = cfg || {}; extra = extra || {};
    var wa = digits(extra.whatsapp || cfg.whatsapp), call = digits(extra.call || cfg.callNumber || cfg.whatsapp);
    var out = { whatsapp: /^\d{12}$/.test(wa) ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi Mechanix Pro, this is our garage. I need help with a job.') : null, call: null, display: cfg.phoneDisplay || '' };
    if (/^\d{12}$/.test(call) && !cfg.callViaWhatsApp) out.call = 'tel:+' + call; else if (cfg.callViaWhatsApp) out.call = null;
    return out;
  }
  function saveLink(win, tok) { if (!LINK_RE.test(String(tok || ''))) return false; try { win.localStorage.setItem(LINK_KEY, tok); return true; } catch (e) { return false; } }
  function savedLink(win) { try { var t = win.localStorage.getItem(LINK_KEY); return LINK_RE.test(String(t || '')) ? t : null; } catch (e) { return null; } }
  function linkFromUrl(search) { var m = /(?:^|[?&])g=([0-9a-fA-F]{48})(?:&|$)/.exec(String(search || '')); return m ? m[1].toLowerCase() : null; }
  function saveSession(win, s) { try { win.localStorage.setItem(SESSION_KEY, JSON.stringify({ t: s.session, exp: Date.parse(s.expires_at), name: s.garage && s.garage.name || '' })); } catch (e) {} }
  function savedSession(win, now) { try { var r = JSON.parse(win.localStorage.getItem(SESSION_KEY) || 'null'); if (!r || !r.t || !(r.exp > (now || Date.now()))) { win.localStorage.removeItem(SESSION_KEY); return null; } return r; } catch (e) { return null; } }
  function clearSession(win) { try { win.localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  var CHIP = { sent: 'new', received: 'received', in_work: 'work', ready: 'ready', returned: 'done', cancelled: 'done' };
  var ERR = { net: 'We could not reach the server. Check your internet and try again.', gen: 'Something went wrong. Please try again.' };

  /* ---------- the app ---------- */
  function start(win) {
    var d = win.document, C = win.MXP || {}, app = d.getElementById('app'); if (!app) return;
    var S = { session: null, name: '', screen: 'boot', tab: 'open', jobs: null, job: null, jobId: null, statement: null, team: null, msg: null, busy: false, draft: null, photos: [], confirm: null, jobsAt: 0 };
    var el = function (tag, attrs, kids) {
      var n = d.createElement(tag); attrs = attrs || {};
      Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); });
      (kids || []).forEach(function (c) { if (c == null || c === false) return; n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); }); return n;
    };
    var clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
    var url = function () { return String(C.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/garage-app'; };

    function api(action, body) {
      var payload = Object.assign({ action: action }, body || {}); if (S.session && action !== 'login') payload.session = S.session;
      return win.fetch(url(), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey || '', Authorization: 'Bearer ' + (C.supabaseAnonKey || '') }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok !== false, status: r.status, data: j }; }); })
        .catch(function () { return { ok: false, status: 0, data: { error: ERR.net }, network: true }; });
    }
    function ended(r) { if (r.status === 401 && r.data && r.data.code === 'session') { lock('Your session has ended. Enter your PIN again.'); return true; } return false; }
    function lock(msg) { clearSession(win); S.session = null; S.jobs = null; S.job = null; S.statement = null; S.msg = msg || null; go('pin'); }
    function go(screen, opts) { S.screen = screen; if (opts) Object.keys(opts).forEach(function (k) { S[k] = opts[k]; }); render(); try { win.scrollTo(0, 0); } catch (e) {} }

    /* small pieces */
    var chip = function (job) { return el('span', { class: 'g-chip g-chip-' + (CHIP[job.status] || 'new'), text: job.status_label }); };
    var notice = function (kind, text) { return el('p', { class: 'g-note g-note-' + kind, role: kind === 'err' ? 'alert' : 'status', text: text }); };
    var retryCard = function (text, fn) { return el('div', { class: 'g-card g-center' }, [el('p', { text: text }), el('button', { class: 'g-btn g-btn-primary', type: 'button', onclick: fn, text: 'Retry' })]); };
    var loading = function (t) { return el('div', { class: 'g-card g-center g-loading', role: 'status' }, [el('span', { class: 'g-spin', 'aria-hidden': 'true' }), el('p', { text: t || 'Loading' })]); };
    function teamButtons() {
      var t = teamLinks(C, S.team || {}), kids = [];
      if (t.whatsapp) kids.push(el('a', { class: 'g-btn g-btn-wa', href: t.whatsapp, rel: 'noopener', 'data-wa': 'team', text: 'WhatsApp our team' }));
      if (t.call) kids.push(el('a', { class: 'g-btn g-btn-ghost', href: t.call, 'data-call': 'team', text: 'Call our team' }));
      if (!kids.length) kids.push(el('p', { class: 'g-muted', text: 'The team number is not set on this page yet. Please use the number Mechanix Pro gave you.' }));
      return el('div', { class: 'g-row' }, kids);
    }

    /* ---------- shell ---------- */
    function shell(body, active) {
      clear(app);
      var head = el('header', { class: 'g-top' }, [el('div', { class: 'g-brand' }, [el('img', { src: '/assets/img/logo-mark.webp', alt: '', width: 28, height: 28 }), el('div', {}, [el('b', { text: 'Mechanix Pro Garage' }), el('span', { text: S.name || '' })])]),
        S.session ? el('button', { class: 'g-lock', type: 'button', onclick: function () { lock('You are signed out.'); }, text: 'Lock' }) : null]);
      var tabs = S.session ? el('nav', { class: 'g-tabs', 'aria-label': 'Garage app' }, [['jobs', 'Jobs'], ['statement', 'Statement'], ['help', 'Help']].map(function (t) {
        return el('button', { class: 'g-tab' + (active === t[0] ? ' on' : ''), type: 'button', 'aria-current': active === t[0] ? 'page' : null, onclick: function () { if (t[0] === 'jobs') openJobs(); else if (t[0] === 'statement') openStatement(); else go('help'); }, text: t[1] });
      })) : null;
      app.appendChild(head); app.appendChild(el('main', { class: 'g-main', id: 'gmain', tabindex: '-1' }, body)); if (tabs) app.appendChild(tabs);
    }

    /* ---------- PIN ---------- */
    function renderPin() {
      var link = savedLink(win), kids = [el('h1', { text: link ? 'Enter your PIN' : 'Open your garage link' })];
      if (!link) {
        kids.push(el('p', { class: 'g-lead', text: 'Mechanix Pro sent your garage a private link on WhatsApp. Tap that link once on this phone, then this app opens straight to the PIN screen.' }), teamButtons());
      } else {
        var input = el('input', { id: 'gpin', class: 'g-input g-pin', type: 'password', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', 'aria-label': 'PIN, 4 to 6 digits', placeholder: '• • • •' });
        var btn = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'submit', id: 'gpinGo', text: 'Open my jobs' }), msg = el('div', { id: 'gpinMsg', 'aria-live': 'polite' }, S.msg ? [notice(S.msgKind || 'info', S.msg)] : []);
        var form = el('form', { class: 'g-card', novalidate: true, onsubmit: function (e) {
          e.preventDefault(); var pin = input.value.replace(/\D/g, ''); clear(msg);
          if (pin.length < 4) { msg.appendChild(notice('err', 'Enter your 4 to 6 digit PIN.')); input.focus(); return; }
          btn.disabled = true; btn.textContent = 'Checking';
          api('login', { token: link, pin: pin }).then(function (r) {
            btn.disabled = false; btn.textContent = 'Open my jobs'; input.value = '';
            if (!r.ok) {
              var code = r.data && r.data.code, text = r.data && r.data.error || ERR.gen;
              if (code === 'pin' && r.data.left != null) text += ' ' + r.data.left + (r.data.left === 1 ? ' try left.' : ' tries left.');
              if (code === 'link') { try { win.localStorage.removeItem(LINK_KEY); } catch (e2) {} }
              S.msg = null; msg.appendChild(notice('err', text)); if (code === 'link') setTimeout(renderPin, 1200); return;
            }
            S.session = r.data.session; S.name = r.data.garage && r.data.garage.name || ''; saveSession(win, r.data); S.msg = null; loadTeam(); openJobs();
          });
        } }, [el('label', { class: 'g-label', for: 'gpin', text: 'PIN' }), input, el('p', { class: 'g-hint', text: 'The PIN is for your garage only. Do not share it.' }), msg, btn]);
        kids.push(form);
      }
      var inst = el('div', { class: 'g-install', id: 'gInstall' }); kids.push(inst);
      shell(kids, null); if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall'), win);
      var i = d.getElementById('gpin'); if (i) try { i.focus(); } catch (e) {}
    }

    /* ---------- jobs list ---------- */
    function loadTeam() { api('team_contact').then(function (r) { if (r.ok) S.team = { whatsapp: r.data.whatsapp, call: r.data.call }; }); }
    function openJobs() { S.screen = 'jobs'; S.jobs = null; render(); fetchJobs(); }
    function fetchJobs() {
      return api('jobs').then(function (r) {
        if (ended(r)) return; if (!r.ok) { S.jobs = 'error'; S.jobsErr = r.data && r.data.error || ERR.gen; } else { S.jobs = r.data.jobs || []; if (r.data.garage && r.data.garage.name) S.name = r.data.garage.name; S.jobsAt = Date.now(); }
        if (S.screen === 'jobs') render();
      });
    }
    function renderJobs() {
      var body = [], jobs = S.jobs;
      body.push(el('div', { class: 'g-h' }, [el('h1', { text: 'Your jobs' }), el('button', { class: 'g-link', type: 'button', onclick: function () { S.jobs = null; render(); fetchJobs(); }, text: 'Refresh' })]));
      if (jobs === null) { body.push(loading('Loading your jobs')); shell(body, 'jobs'); return; }
      if (jobs === 'error') { body.push(retryCard(S.jobsErr || ERR.gen, function () { S.jobs = null; render(); fetchJobs(); })); shell(body, 'jobs'); return; }
      var by = { open: [], ready: [], done: [] }; jobs.forEach(function (j) { by[j.tab].push(j); });
      body.push(el('div', { class: 'g-seg', role: 'tablist' }, [['open', 'Open'], ['ready', 'Ready'], ['done', 'Done']].map(function (t) {
        return el('button', { class: 'g-seg-b' + (S.tab === t[0] ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': S.tab === t[0] ? 'true' : 'false', onclick: function () { S.tab = t[0]; render(); } }, [t[1], el('span', { class: 'g-count', text: String(by[t[0]].length) })]);
      })));
      var list = by[S.tab];
      if (!list.length) {
        var empty = { open: 'No open jobs right now. New jobs from Mechanix Pro appear here.', ready: 'Nothing is waiting for return.', done: 'Finished jobs appear here.' };
        body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: empty[S.tab] })]));
      } else {
        body.push(el('ul', { class: 'g-list' }, list.map(function (j) {
          var rb = whenText(j.return_by);
          return el('li', {}, [el('button', { class: 'g-row-job', type: 'button', onclick: function () { openJob(j.id); } }, [
            el('span', { class: 'g-rj-top' }, [el('b', { text: j.vehicle + (j.reg_no ? ' · ' + j.reg_no : '') }), chip(j)]),
            el('span', { class: 'g-rj-work', text: j.work }),
            el('span', { class: 'g-rj-meta', text: (j.tab === 'done' ? '' : rb ? 'Return by ' + rb : 'Return time not set') + (j.tab === 'done' ? '' : ' · ') + j.customer_first_name + (j.booking_id ? ' · ' + j.booking_id : '') }),
            j.quote && j.tab !== 'done' ? el('span', { class: 'g-rj-q', text: j.quote.label }) : null])]);
        })));
      }
      shell(body, 'jobs');
    }

    /* ---------- one job ---------- */
    function openJob(id) { S.jobId = id; S.job = null; S.draft = null; S.photos = []; S.confirm = null; S.msg = null; S.screen = 'job'; render(); fetchJob(); try { win.location.hash = '#/job/' + id; } catch (e) {} }
    function fetchJob() {
      return api('job', { id: S.jobId }).then(function (r) {
        if (ended(r)) return; if (!r.ok) { S.job = 'error'; S.jobErr = r.data && r.data.error || ERR.gen; S.jobGone = r.status === 404; } else { S.job = r.data.job; }
        if (S.screen === 'job') render();
      });
    }
    function section(title, kids, cls) { return el('section', { class: 'g-card ' + (cls || '') }, [el('h2', { text: title })].concat(kids)); }
    function renderJob() {
      var j = S.job, body = [el('button', { class: 'g-back', type: 'button', onclick: function () { try { win.history.replaceState(null, '', '/garage/'); } catch (e) {} openJobs(); }, text: '← All jobs' })];
      if (j === null) { body.push(loading('Loading the job')); shell(body, 'jobs'); return; }
      if (j === 'error') { body.push(S.jobGone ? el('div', { class: 'g-card g-center' }, [el('p', { text: 'This job is not available any more.' })]) : retryCard(S.jobErr || ERR.gen, function () { S.job = null; render(); fetchJob(); })); shell(body, 'jobs'); return; }
      body.push(el('div', { class: 'g-jh' }, [el('div', {}, [el('h1', { text: j.vehicle }), el('p', { class: 'g-muted', text: (j.reg_no ? j.reg_no + ' · ' : '') + (j.booking_id || '') })]), chip(j)]));
      var rb = whenText(j.return_by); body.push(el('p', { class: 'g-return', text: rb ? 'Return by ' + rb : 'Return time not set' }));

      // customer: first name, and the number only while the job is open
      var cust = [el('p', { class: 'g-big', text: j.customer_first_name })];
      if (j.customer_phone) { cust.push(el('a', { class: 'g-btn g-btn-primary g-wide', href: telHref(j.customer_phone), id: 'gCallCustomer', text: 'Call customer ' + phoneShow(j.customer_phone) }), el('p', { class: 'g-hint', text: 'Use this number only for this job. Mechanix Pro records that you opened it.' })); }
      else if (j.contact_limited) cust.push(notice('info', 'Too many opens just now. Wait a few minutes to see the number again.'));
      else if (!j.open) cust.push(el('p', { class: 'g-muted', text: 'This job is closed, so the customer’s number is no longer shown.' }));
      body.push(section('Customer', cust));
      body.push(section('Work needed', [el('p', { text: j.work }), j.work_needed ? el('p', { class: 'g-quote', text: j.work_needed }) : null]));
      if (j.found) body.push(section('What was found', [el('p', { text: j.found })]));
      if (j.pickup && (j.pickup.note || (j.pickup.photos || []).length)) body.push(section('Pickup notes and photos', [j.pickup.note ? el('p', { text: j.pickup.note }) : null, photoGrid(j.pickup.photos)]));
      body.push(section('Quote', [el('p', { class: 'g-q g-q-' + j.quote.status, text: j.quote.label })]));

      // progress
      if (j.next) body.push(progressCard(j));
      else if (j.status === 'ready') body.push(section('Ready for return', [el('p', { text: 'Mechanix Pro has been told. The mechanic will bring the vehicle back to the customer.' })]));
      else if (!j.open) body.push(section('Closed', [el('p', { text: 'This job is ' + j.status_label.toLowerCase() + '.' })]));
      body.push(timelineCard(j));
      body.push(estimateCard(j));
      shell(body, 'jobs');
    }
    function photoGrid(urls) { urls = urls || []; if (!urls.length) return null; return el('div', { class: 'g-photos' }, urls.map(function (u, i) { return el('a', { href: u, target: '_blank', rel: 'noopener', 'aria-label': 'Open photo ' + (i + 1) }, [el('img', { src: u, alt: 'Photo ' + (i + 1), loading: 'lazy' })]); })); }
    function timelineCard(j) {
      return section('Progress', [el('ol', { class: 'g-tl' }, j.timeline.map(function (t) {
        return el('li', {}, [el('b', { text: t.label }), el('span', { class: 'g-muted', text: whenText(t.at) || '' }), t.note ? el('p', { text: t.note }) : null, photoGrid(t.photos)]);
      }))]);
    }

    /* photos: shrink on the phone, show a data: preview (blob: previews are blocked by the site's CSP) */
    function readDataUrl(f) { return new Promise(function (res, rej) { var fr = new win.FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(f); }); }
    function compress(file) {
      return readDataUrl(file).then(function (u) { return new Promise(function (res, rej) {
        var im = new win.Image(); im.onload = function () {
          var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h)), c = d.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(function (b) { b ? res({ blob: b, preview: c.toDataURL('image/jpeg', 0.5) }) : rej(new Error('compress')); }, 'image/jpeg', 0.8); };
        im.onerror = function () { rej(new Error('image')); }; im.src = u; }); });
    }
    function uploadPhotos(id, items) {
      if (!items.length) return Promise.resolve([]);
      return api('photo_upload_url', { id: id, types: items.map(function () { return 'image/jpeg'; }) }).then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.error || ERR.gen);
        return Promise.all(r.data.uploads.map(function (u, i) { var fd = new win.FormData(); fd.append('cacheControl', '3600'); fd.append('', items[i].blob);
          return win.fetch(u.url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: fd }).then(function (x) { if (!x.ok) throw new Error('A photo did not upload. Check your internet and try again.'); return u.path; }); }));
      });
    }
    function photoPicker(paint) {
      var wrap = el('div', { class: 'g-pick' }), prev = el('div', { class: 'g-photos' }), msg = el('div', { 'aria-live': 'polite' });
      var input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, id: 'gphotos', class: 'g-file', onchange: function () {
        var files = [].slice.call(input.files || []); input.value = ''; clear(msg);
        var room = MAX_PHOTOS - S.photos.length; if (files.length > room) { msg.appendChild(notice('err', 'You can add ' + MAX_PHOTOS + ' photos at most.')); files = files.slice(0, Math.max(0, room)); }
        files.reduce(function (p, f) { return p.then(function () { return compress(f).then(function (x) { S.photos.push(x); drawPrev(); }); }); }, Promise.resolve()).catch(function () { msg.appendChild(notice('err', 'That photo could not be read. Try another.')); });
      } });
      function drawPrev() { clear(prev); S.photos.forEach(function (p, i) { prev.appendChild(el('span', { class: 'g-ph' }, [el('img', { src: p.preview, alt: 'Photo ' + (i + 1) }), el('button', { type: 'button', class: 'g-x', 'aria-label': 'Remove photo ' + (i + 1), onclick: function () { S.photos.splice(i, 1); drawPrev(); }, text: '×' })])); }); }
      drawPrev();
      wrap.appendChild(el('label', { class: 'g-btn g-btn-ghost g-wide', for: 'gphotos', text: 'Add photos (optional)' })); wrap.appendChild(input); wrap.appendChild(prev); wrap.appendChild(msg); return wrap;
    }
    function progressCard(j) {
      var n = j.next, blocked = j.status === 'received' && !j.can_start, msg = el('div', { id: 'gProgMsg', 'aria-live': 'polite' }), note = el('textarea', { class: 'g-input', id: 'gnote', rows: 2, maxlength: 300, placeholder: 'Note for Mechanix Pro (optional)' });
      var go1 = el('button', { class: 'g-btn g-btn-primary g-wide g-xl', type: 'button', id: 'gProgress', disabled: blocked || null, text: n.label, onclick: function () {
        if (n.event === 'ready' && S.confirm !== 'ready') { S.confirm = 'ready'; clear(msg); msg.appendChild(el('div', { class: 'g-confirm' }, [el('p', { text: 'Mark this vehicle ready for return? Mechanix Pro will be told.' }), el('div', { class: 'g-row' }, [
          el('button', { class: 'g-btn g-btn-primary', type: 'button', id: 'gConfirmYes', onclick: function () { go1.click(); }, text: 'Yes, ready for return' }), el('button', { class: 'g-btn g-btn-ghost', type: 'button', onclick: function () { S.confirm = null; clear(msg); }, text: 'Not yet' })])])); return; }
        go1.disabled = true; var old = go1.textContent; go1.textContent = 'Saving'; clear(msg);
        var items = S.photos.slice();
        uploadPhotos(j.id, items).then(function (paths) { return api('progress', { id: j.id, event: n.event, photos: paths, note: note.value.trim() || null }); }).then(function (r) {
          if (ended(r)) return; go1.disabled = false; go1.textContent = old;
          if (!r.ok) { msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; }
          S.photos = []; S.confirm = null; S.job = null; render(); fetchJob(); S.jobs = null;
        }).catch(function (e) { go1.disabled = false; go1.textContent = old; msg.appendChild(notice('err', e && e.message || ERR.gen)); });
      } });
      var kids = [];
      if (blocked) kids.push(notice('warn', j.start_blocked_reason || 'The customer has not approved the quote yet.'));
      kids.push(photoPicker(), note, go1, msg);
      return section('Next step', kids, 'g-next');
    }

    /* ---------- estimate ---------- */
    function estStatusText(e) { return { draft: 'Draft', submitted: 'With the Mechanix Pro team for review', converted: 'Accepted. Mechanix Pro will send the quote to the customer', approved: 'Accepted', rejected: 'Not accepted' }[e.status] || e.status; }
    function estimateCard(j) {
      var kids = [], waiting = (j.estimates || []).some(function (e) { return e.status === 'submitted'; });
      (j.estimates || []).forEach(function (e) {
        kids.push(el('div', { class: 'g-est g-est-' + e.status }, [el('b', { text: estStatusText(e) }), el('ul', { class: 'g-lines' }, e.lines.map(function (l) { return el('li', {}, [el('span', { text: l.name }), el('span', { text: money(l.amount) })]); })),
          totalsBlock(e), e.review_note ? el('p', { class: 'g-quote', text: 'Note from Mechanix Pro: ' + e.review_note }) : null]));
      });
      if (j.can_estimate && !waiting) kids.push(estimateForm(j));
      else if (!j.can_estimate && j.open) kids.push(el('p', { class: 'g-muted', text: 'You can send an estimate after you mark Vehicle received.' }));
      if (!kids.length) return d.createDocumentFragment();
      return section('Repair estimate', kids);
    }
    function totalsBlock(t) { return el('dl', { class: 'g-tot' }, [el('div', {}, [el('dt', { text: 'Subtotal' }), el('dd', { text: money(t.subtotal) })]), el('div', {}, [el('dt', { text: 'GST 18%' }), el('dd', { text: money(t.gst) })]), el('div', { class: 'g-tot-all' }, [el('dt', { text: 'Total' }), el('dd', { text: money(t.total) })])]); }
    function estimateForm(j) {
      var st = S.draft || (S.draft = { lines: [{ kind: 'parts', name: '', amount: '' }], mode: 'hours', hours: '', day: '', notes: '' });
      var host = el('form', { class: 'g-form', id: 'gEstForm', novalidate: true }), tot = el('div', { id: 'gEstTot' }), msg = el('div', { id: 'gEstMsg', 'aria-live': 'polite' });
      function sums() { clear(tot); tot.appendChild(totalsBlock(totals(st.lines))); }
      function draw() {
        clear(host);
        st.lines.forEach(function (l, i) {
          host.appendChild(el('div', { class: 'g-line' }, [
            el('select', { class: 'g-input', 'aria-label': 'Line ' + (i + 1) + ' type', onchange: function (e) { l.kind = e.target.value; } }, [['parts', 'Parts'], ['labour', 'Labour'], ['other', 'Other']].map(function (o) { return el('option', { value: o[0], selected: l.kind === o[0] ? true : null, text: o[1] }); })),
            el('input', { class: 'g-input', type: 'text', maxlength: 80, placeholder: 'What (e.g. Front brake pads)', 'aria-label': 'Line ' + (i + 1) + ' name', value: l.name, oninput: function (e) { l.name = e.target.value; } }),
            el('input', { class: 'g-input g-amt', type: 'number', inputmode: 'decimal', min: 0, max: 100000, step: '0.01', placeholder: '₹ before GST', 'aria-label': 'Line ' + (i + 1) + ' amount in rupees before GST', value: l.amount, oninput: function (e) { l.amount = e.target.value; sums(); } }),
            st.lines.length > 1 ? el('button', { type: 'button', class: 'g-x2', 'aria-label': 'Remove line ' + (i + 1), onclick: function () { st.lines.splice(i, 1); draw(); }, text: '×' }) : null]));
        });
        if (st.lines.length < 20) host.appendChild(el('button', { type: 'button', class: 'g-btn g-btn-ghost', id: 'gAddLine', onclick: function () { st.lines.push({ kind: 'parts', name: '', amount: '' }); draw(); }, text: 'Add a line' }));
        host.appendChild(tot); sums();
        host.appendChild(el('fieldset', { class: 'g-fs' }, [el('legend', { text: 'When can it go back?' }), el('div', { class: 'g-row' }, [
          el('label', { class: 'g-radio' }, [el('input', { type: 'radio', name: 'gmode', value: 'hours', checked: st.mode === 'hours' ? true : null, onchange: function () { st.mode = 'hours'; draw(); } }), 'Hours of work']),
          el('label', { class: 'g-radio' }, [el('input', { type: 'radio', name: 'gmode', value: 'day', checked: st.mode === 'day' ? true : null, onchange: function () { st.mode = 'day'; draw(); } }), 'Return day'])]),
          st.mode === 'hours' ? el('input', { class: 'g-input', type: 'number', inputmode: 'numeric', min: 1, max: 72, placeholder: 'Estimated hours (1 to 72)', 'aria-label': 'Estimated hours', value: st.hours, oninput: function (e) { st.hours = e.target.value; } })
            : el('input', { class: 'g-input', type: 'date', 'aria-label': 'Return day', value: st.day, oninput: function (e) { st.day = e.target.value; } })]));
        host.appendChild(el('label', { class: 'g-label', for: 'gEstNotes', text: 'Notes for Mechanix Pro (optional)' }));
        host.appendChild(el('textarea', { class: 'g-input', id: 'gEstNotes', rows: 3, maxlength: 500, oninput: function (e) { st.notes = e.target.value; } }, [st.notes]));
        host.appendChild(el('p', { class: 'g-hint', text: 'Mechanix Pro checks this first. The customer sees nothing until the team approves and sends a quote.' }));
        host.appendChild(msg);
        host.appendChild(el('button', { class: 'g-btn g-btn-primary g-wide', type: 'submit', id: 'gEstSend', text: 'Send estimate to Mechanix Pro' }));
      }
      host.addEventListener('submit', function (e) {
        e.preventDefault(); clear(msg); var btn = d.getElementById('gEstSend');
        var body = { id: j.id, lines: st.lines.map(function (l) { return { kind: l.kind, name: String(l.name).trim(), amount: Number(l.amount) }; }), notes: st.notes.trim() || null, hours: st.mode === 'hours' && st.hours !== '' ? Number(st.hours) : null, day: st.mode === 'day' && st.day ? st.day : null };
        for (var i = 0; i < body.lines.length; i++) { var l = body.lines[i]; if (l.name.length < 2) return msg.appendChild(notice('err', 'Line ' + (i + 1) + ' needs a name.')); if (!isFinite(l.amount) || l.amount < 0) return msg.appendChild(notice('err', 'Line ' + (i + 1) + ' needs an amount.')); }
        if (body.hours == null && !body.day) return msg.appendChild(notice('err', 'Give the estimated hours or a return day.'));
        btn.disabled = true; btn.textContent = 'Sending';
        api('estimate_submit', body).then(function (r) {
          if (ended(r)) return; btn.disabled = false; btn.textContent = 'Send estimate to Mechanix Pro';
          if (!r.ok) return msg.appendChild(notice('err', r.data && r.data.error || ERR.gen));
          S.draft = null; S.job = null; render(); fetchJob();
        });
      });
      draw(); return host;
    }

    /* ---------- statement ---------- */
    function openStatement() { S.screen = 'statement'; S.statement = null; render(); api('statement').then(function (r) { if (ended(r)) return; S.statement = r.ok ? r.data.statement : 'error'; if (S.screen === 'statement') render(); }); }
    function renderStatement() {
      var s = S.statement, body = [el('div', { class: 'g-h' }, [el('h1', { text: 'Statement' })])];
      if (s === null) body.push(loading('Loading your statement'));
      else if (s === 'error') body.push(retryCard('We could not load your statement.', openStatement));
      else {
        body.push(el('div', { class: 'g-sum' }, [el('div', {}, [el('span', { text: 'Pending' }), el('b', { text: money(s.pending) })]), el('div', {}, [el('span', { text: 'Settled' }), el('b', { text: money(s.settled) })])]));
        if (!s.items.length) body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: 'Completed jobs appear here once they are ready for return.' })]));
        else body.push(el('ul', { class: 'g-list' }, s.items.map(function (i) {
          var label = { settled: 'Settled' + (i.settled_at ? ' ' + whenText(i.settled_at).split(',').slice(0, 2).join(',') : ''), pending: 'Pending', amount_not_entered: 'Amount not entered yet' }[i.status];
          return el('li', { class: 'g-card g-st' }, [el('div', { class: 'g-rj-top' }, [el('b', { text: i.vehicle }), el('b', { text: i.amount == null ? '—' : money(i.amount) })]), el('span', { class: 'g-muted', text: (i.booking_id || '') + (i.completed_at ? ' · ' + (whenText(i.completed_at) || '') : '') }), el('span', { class: 'g-chip g-chip-' + (i.status === 'settled' ? 'done' : i.status === 'pending' ? 'work' : 'new'), text: label }), i.note ? el('p', { class: 'g-muted', text: i.note }) : null]);
        })));
        body.push(el('p', { class: 'g-hint', text: 'Amounts are entered by Mechanix Pro for each job. If something looks wrong, tap Help and message the team.' }));
      }
      shell(body, 'statement');
    }

    /* ---------- help ---------- */
    function renderHelp() {
      shell([el('div', { class: 'g-h' }, [el('h1', { text: 'Help' })]),
        section('Call or WhatsApp our team', [el('p', { text: 'Questions about a job, a payment or this app? Reach the Mechanix Pro team here.' }), teamButtons()]),
        section('Using this app', [el('ul', { class: 'g-bul' }, [el('li', { text: 'Tap a job to see the vehicle, the work and the customer’s first name.' }), el('li', { text: 'Mark each step as it happens. Add photos if you can.' }), el('li', { text: 'Work can start only after the customer approves the quote. Send your estimate first.' }), el('li', { text: 'Tap Lock when you leave the phone with others.' })])]),
        section('Add to your home screen', [el('div', { id: 'gInstall2' })])], 'help');
      if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall2'), win);
    }

    function render() {
      if (S.screen === 'pin') return renderPin(); if (S.screen === 'jobs') return renderJobs(); if (S.screen === 'job') return renderJob();
      if (S.screen === 'statement') return renderStatement(); if (S.screen === 'help') return renderHelp();
      shell([loading('Opening')], null);
    }

    /* ---------- boot ---------- */
    var fromUrl = linkFromUrl(win.location.search);
    if (fromUrl) { saveLink(win, fromUrl); try { win.history.replaceState(null, '', '/garage/'); } catch (e) {} }
    var ses = savedSession(win);
    if (ses && savedLink(win)) { S.session = ses.t; S.name = ses.name || ''; loadTeam(); openJobs(); } else { go('pin'); }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && S.session && S.screen === 'jobs' && Date.now() - S.jobsAt > 60000) fetchJobs(); });
  }
  return { start: start, money: money, totals: totals, whenText: whenText, telHref: telHref, phoneShow: phoneShow, teamLinks: teamLinks, saveLink: saveLink, savedLink: savedLink, linkFromUrl: linkFromUrl, saveSession: saveSession, savedSession: savedSession, clearSession: clearSession, LINK_KEY: LINK_KEY, SESSION_KEY: SESSION_KEY };
});
