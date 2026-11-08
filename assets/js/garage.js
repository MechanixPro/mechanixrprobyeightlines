/* Mechanix Pro Garage: the partner garage app at /garage/. No inline script (CSP). Design: docs/superpowers/specs/2026-11-06-partner-garage-app-design.md
   - The private link /garage/?g=<token> is saved on this phone, then removed from the address bar; the home-screen icon opens the PIN screen.
   - The PIN creates a 12-hour session (kept on this phone until it ends or you tap Lock). Nothing private is cached by a service worker.
   - The customer's email never reaches this app. The phone number and (2026-11-09 owner decision: the garage must know where to go) the job address, area, pincode and map pin appear only in an OPEN job's detail, never in lists, and are not stored by the app.
   Pure helpers are exported for tests; the screens start only in a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_GARAGE = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PAGES = ['offer', 'navigate', 'phone', 'code', 'inspect', 'ready', 'done'];
  /** The 4-digit code: digits only, at most four. */
  function cleanCode(v) { return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 4); }
  function isCode(v) { return /^[0-9]{4}$/.test(String(v == null ? '' : v)); }
  /** Which full-screen page a job is on. flow: { arrived, found, view } (local choices kept in place; view = a page the garage went Back to). */
  function jobPage(j, flow) {
    flow = flow || {};
    var nat;
    if (!j) nat = 'offer';
    else if (j.status === 'sent') nat = 'offer';
    else if (j.status === 'received') nat = j.code_needed && j.code !== 'verified' ? (flow.found ? 'code' : flow.arrived ? 'phone' : 'navigate') : 'inspect';
    else if (j.status === 'in_work') nat = 'ready';
    else nat = 'done';
    if (flow.view === 'estimate' && nat === 'inspect') return 'estimate';
    if (flow.view && PAGES.indexOf(flow.view) >= 0 && PAGES.indexOf(flow.view) < PAGES.indexOf(nat)) return flow.view;
    return nat;
  }
  /** Event each page sends (null: no event; the page moves on locally or calls verify_code / the estimate). */
  var STEP_EVENT = { offer: 'received', navigate: null, phone: null, code: null, inspect: 'work_started', ready: 'ready', done: null };
  var LINK_KEY = 'mxp_garage_link', SESSION_KEY = 'mxp_garage_session', LOC_KEY = 'mxp_garage_loc_asked', LINK_RE = /^[0-9a-f]{48}$/, MAX_PHOTOS = 4;

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
  /* Google Maps directions link: the shared pin if there is one, else the written address. Pure. */
  function navigateUrl(place) {
    if (!place) return null;
    var lat = Number(place.lat), lng = Number(place.lng), has = place.lat !== null && place.lat !== undefined && place.lng !== null && place.lng !== undefined && isFinite(lat) && isFinite(lng);
    var dest = has ? lat + ',' + lng : [place.address, place.area, place.pincode].filter(Boolean).join(', ');
    return dest ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) : null;
  }
  /* One shared wording for the Available switch (garage and mechanic apps). Pure. */
  function availabilityText(on) { return { title: on ? 'Available for jobs' : 'Not available', help: 'Crew will not send you new jobs while you are not available.', state: on ? 'On' : 'Off' }; }
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
  function locAsked(win) { try { return !!win.localStorage.getItem(LOC_KEY); } catch (e) { return true; } }
  function markLocAsked(win) { try { win.localStorage.setItem(LOC_KEY, String(Date.now())); } catch (e) {} }
  /* "Saved 7 Nov, 3:30 pm" or "Not saved yet". */
  function locText(loc) { if (!loc || !loc.set) return 'Not saved yet'; var w = whenText(loc.at); return w ? 'Saved ' + w.split(', ').slice(1).join(', ') : 'Saved'; }
  var CHIP = { sent: 'new', received: 'received', in_work: 'work', ready: 'ready', returned: 'done', cancelled: 'done' };
  var ERR = { net: 'We could not reach the server. Check your internet and try again.', gen: 'Something went wrong. Please try again.' };

  /* ---------- the app ---------- */
  function start(win) {
    var d = win.document, C = win.MXP || {}, app = d.getElementById('app'); if (!app) return;
    var S = { session: null, name: '', screen: 'boot', dash: null, locMsg: null, locBusy: false, openBusy: false, tab: 'open', jobs: null, job: null, jobId: null, statement: null, team: null, msg: null, busy: false, draft: null, photos: [], confirm: null, jobsAt: 0 };
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
    function lock(msg) { clearSession(win); S.session = null; S.dash = null; S.jobs = null; S.job = null; S.statement = null; S.msg = msg || null; go('pin'); }
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
    function shell(body, active, noLock) {
      clear(app); app.classList.remove('g-wiz');
      var head = el('header', { class: 'g-top' }, [el('div', { class: 'g-brand' }, [el('img', { src: '/assets/img/logo-mark.webp', alt: '', width: 28, height: 28 }), el('div', {}, [el('b', { text: 'Mechanix Pro Garage' }), el('span', { text: S.name || '' })])]),
        S.session && !noLock ? el('button', { class: 'g-lock', type: 'button', onclick: function () { lock('You are signed out.'); }, text: 'Lock' }) : null]);
      var tabs = S.session ? el('nav', { class: 'g-tabs g-tabs-4', 'aria-label': 'Garage app' }, [['home', 'Home'], ['jobs', 'Jobs'], ['statement', 'Statement'], ['help', 'Help']].map(function (t) {
        return el('button', { class: 'g-tab' + (active === t[0] ? ' on' : ''), type: 'button', 'aria-current': active === t[0] ? 'page' : null, onclick: function () { if (t[0] === 'home') openHome(); else if (t[0] === 'jobs') openJobs(); else if (t[0] === 'statement') openStatement(); else go('help'); }, text: t[1] });
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
            S.session = r.data.session; S.name = r.data.garage && r.data.garage.name || ''; saveSession(win, r.data); S.msg = null; loadTeam(); openHome(true);
          });
        } }, [el('label', { class: 'g-label', for: 'gpin', text: 'PIN' }), input, el('p', { class: 'g-hint', text: 'The PIN is for your garage only. Do not share it.' }), msg, btn]);
        kids.push(form);
      }
      var inst = el('div', { class: 'g-install', id: 'gInstall' }); kids.push(inst);
      shell(kids, null); if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall'), win);
      var i = d.getElementById('gpin'); if (i) try { i.focus(); } catch (e) {}
    }

    /* ---------- home (dashboard): greeting, today, status, quick action, month figures, what we owe you, shop location ---------- */
    function openHome(first) { S.screen = 'home'; S.dash = null; render(); return fetchHome(first); }
    function fetchHome(first) {
      return api('dashboard').then(function (r) {
        if (ended(r)) return;
        S.dash = r.ok ? r.data.dashboard : 'error'; S.dashErr = !r.ok && r.data && r.data.error || ERR.gen;
        if (r.ok && r.data.dashboard.name) S.name = r.data.dashboard.name;
        S.jobsAt = Date.now(); if (S.screen === 'home') render();
        // The first time on this phone, ask where the shop is. A "no" is remembered and never blocks anything; the Update shop location button stays.
        if (r.ok && first && !r.data.dashboard.location.set && !locAsked(win)) { markLocAsked(win); saveLocation(); }
      });
    }
    function saveLocation() {
      var g = win.navigator && win.navigator.geolocation;
      if (!g) { S.locMsg = { kind: 'info', text: 'This phone cannot share its location. You can carry on without it.' }; if (S.screen === 'home') render(); return; }
      S.locBusy = true; S.locMsg = null; if (S.screen === 'home') render();
      var fail = function (text) { S.locBusy = false; S.locMsg = { kind: 'info', text: text || 'Location was not shared. You can still use the app, and tap Update shop location any time.' }; if (S.screen === 'home') render(); };
      try {
        g.getCurrentPosition(function (p) {
          api('location_set', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }).then(function (r) {
            if (ended(r)) return; S.locBusy = false;
            if (r.ok) { S.locMsg = { kind: 'ok', text: 'Shop location saved.' }; if (S.dash && S.dash !== 'error') S.dash.location = { set: true, at: r.data.at || new Date().toISOString() }; if (S.screen === 'home') render(); }
            else fail(r.data && r.data.error);
          });
        }, function () { fail(); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
      } catch (e) { fail(); }
    }
    function setOpen(open) {
      if (S.openBusy || !S.dash || S.dash === 'error') return; S.openBusy = true; render();
      api('open_set', { open: open }).then(function (r) { S.openBusy = false; if (ended(r)) return; if (r.ok) S.dash.is_open = r.data.open; render(); });
    }
    function renderHome() {
      var dsh = S.dash, body = [];
      body.push(el('div', { class: 'd-banner' }, [el('div', {}, [el('h1', { text: 'Hello, ' + (S.name || 'garage') }), dsh && dsh !== 'error' && dsh.city ? el('p', { text: dsh.city }) : null]), el('button', { class: 'd-out', type: 'button', id: 'dLogout', onclick: function () { lock('You are signed out.'); }, text: 'Logout' })]));
      if (dsh === null) { body.push(loading('Loading your day')); shell(body, 'home', true); return; }
      if (dsh === 'error') { body.push(retryCard(S.dashErr || ERR.gen, function () { S.dash = null; render(); fetchHome(); })); shell(body, 'home', true); return; }
      var av = availabilityText(!!dsh.is_open);
      body.push(el('section', { class: 'd-avail' + (dsh.is_open ? ' on' : ' off'), 'aria-label': 'Availability' }, [
        el('div', { class: 'd-avail-txt' }, [el('p', { class: 'd-avail-title', id: 'dAvailTitle', text: av.title }), el('p', { class: 'g-hint', text: av.help })]),
        el('button', { class: 'd-sw', type: 'button', role: 'switch', id: 'dAvailSwitch', 'aria-checked': dsh.is_open ? 'true' : 'false', 'aria-label': 'Available for jobs', disabled: S.openBusy || null, onclick: function () { setOpen(!dsh.is_open); } }, [el('span', { class: 'd-knob' })])]));
      body.push(el('div', { class: 'd-two' }, [el('section', { class: 'd-card', 'aria-label': 'Today’s jobs' }, [el('p', { class: 'd-label', text: 'Today’s jobs' }), el('p', { class: 'd-big', id: 'dToday', text: String(dsh.today_jobs) })]), el('section', { class: 'd-card', 'aria-label': 'Open now' }, [el('p', { class: 'd-label', text: 'Open now' }), el('p', { class: 'd-big', id: 'dOpenJobs', text: String(dsh.open_jobs) })])]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Quick actions' }, [el('p', { class: 'd-label', text: 'Quick actions' }), el('button', { class: 'g-btn g-btn-primary d-xl', type: 'button', id: 'dGet', onclick: function () { S.tab = 'open'; openJobs(); }, text: 'Get my jobs' })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'My monthly stats' }, [el('p', { class: 'd-label', text: 'My monthly stats' }), el('div', { class: 'd-stats' }, [
        el('div', {}, [el('b', { text: String(dsh.month.jobs) }), el('span', { text: 'Total jobs' })]), el('div', {}, [el('b', { text: String(dsh.month.completed) }), el('span', { text: 'Completed' })]), el('div', {}, [el('b', { text: dsh.month.avg_ticket == null ? '—' : money(dsh.month.avg_ticket) }), el('span', { text: 'Average ticket' })])])]));
      var lines = dsh.unsettled.map(function (u) {
        return el('article', { class: 'd-job' }, [el('div', { class: 'd-job-top' }, [el('b', { text: (u.booking_id || 'Job') + ' · ' + u.vehicle }), el('span', { class: 'g-muted', text: u.completed_at ? whenText(u.completed_at).split(', ').slice(0, 2).join(', ') : '' })]),
          el('dl', { class: 'd-fig' }, [el('dt', { text: u.label }), el('dd', { class: 'd-ok', text: money(u.amount) })])]);
      });
      body.push(el('details', { class: 'd-fold', id: 'dUnsettled' }, [el('summary', { text: 'Previous unsettled (' + dsh.unsettled.length + ')' }), el('div', { class: 'd-fold-body' }, lines.length ? lines.concat([el('p', { class: 'g-hint', text: 'Total ' + money(dsh.unsettled_total) + '. Amounts are entered by Mechanix Pro for each finished job.' })]) : [el('p', { class: 'g-muted', text: 'Nothing is waiting. Settled jobs are on the Statement tab.' })])]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Shop location' }, [el('p', { class: 'd-label', text: 'Shop location' }), el('p', { id: 'dLocText', text: locText(dsh.location) }),
        el('p', { class: 'g-hint', text: 'Helps Mechanix Pro send you jobs nearby. Your phone asks first, and the app works the same if you say no.' }),
        S.locMsg ? notice('info', S.locMsg.text) : null,
        el('button', { class: 'g-btn g-btn-ghost g-wide', type: 'button', id: 'dLoc', disabled: S.locBusy || null, onclick: function () { saveLocation(); }, text: S.locBusy ? 'Finding your location' : 'Update shop location' })]));
      shell(body, 'home', true);
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
      var j = S.job, body = [];
      if (j === null) { body.push(loading('Loading the job')); shell(body, 'jobs'); return; }
      if (j === 'error') { body.push(S.jobGone ? el('div', { class: 'g-card g-center' }, [el('p', { text: 'This job is not available any more.' })]) : retryCard(S.jobErr || ERR.gen, function () { S.job = null; render(); fetchJob(); })); shell(body, 'jobs'); return; }
      var page = jobPage(j, flowOf(j.id));
      if (page === 'estimate') { body.push(wizTop(j, page), el('h1', { text: 'Send estimate' }), estimateCard(j)); shell(body, 'jobs'); app.classList.remove('g-wiz'); return; }
      body.push(wizPage(j, page));
      shell(body, 'jobs'); app.classList.add('g-wiz');
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
    function photoPicker(paint, required, compact) {
      var wrap = el('div', { class: 'g-pick' }), prev = el('div', { class: 'g-photos' }), msg = el('div', { 'aria-live': 'polite' });
      var onPick = function (input) { return function () {
        var files = [].slice.call(input.files || []); input.value = ''; clear(msg);
        var room = MAX_PHOTOS - S.photos.length; if (files.length > room) { msg.appendChild(notice('err', 'You can add ' + MAX_PHOTOS + ' photos at most.')); files = files.slice(0, Math.max(0, room)); }
        files.reduce(function (p, f) { return p.then(function () { return compress(f).then(function (x) { S.photos.push(x); drawPrev(); }); }); }, Promise.resolve()).catch(function () { msg.appendChild(notice('err', 'That photo could not be read. Try another.')); });
      }; };
      // Camera: capture=environment opens the rear camera on iPhone and Android. Gallery: several at once. Both feed the same compress and upload path.
      var camIn = el('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'gphotoCam', class: 'g-file' });
      var galIn = el('input', { type: 'file', accept: 'image/*', multiple: true, id: 'gphotos', class: 'g-file' });
      camIn.onchange = onPick(camIn); galIn.onchange = onPick(galIn);
      function drawPrev() { if (paint) paint(); clear(prev); S.photos.forEach(function (p, i) { prev.appendChild(el('span', { class: 'g-ph' }, [el('img', { src: p.preview, alt: 'Photo ' + (i + 1) }), el('button', { type: 'button', class: 'g-x', 'aria-label': 'Remove photo ' + (i + 1), onclick: function () { S.photos.splice(i, 1); drawPrev(); }, text: '×' })])); }); }
      drawPrev();
      wrap.appendChild(el('div', { class: 'g-row g-photobtns' }, [el('label', { class: 'g-btn ' + (compact ? 'g-btn-navy' : 'g-btn-primary'), for: 'gphotoCam', id: 'gTakePhoto', text: 'Take photo' }), el('label', { class: 'g-btn g-btn-ghost', for: 'gphotos', id: 'gGallery', text: 'Choose from gallery' })]));
      wrap.appendChild(camIn); wrap.appendChild(galIn); if (!compact) wrap.appendChild(el('p', { class: 'g-hint', text: required ? 'Take at least one photo. Up to ' + MAX_PHOTOS + '.' : 'Photos are optional. Up to ' + MAX_PHOTOS + '.' })); wrap.appendChild(prev); wrap.appendChild(msg); return wrap;
    }
    /* Owner rule: one step per screen, no scrolling, one big primary button, at most 3 lines. Local steps (arrived, vehicle found) have no event; the others map to existing events (docs/j3-notes.md). */
    function flowOf(id) { S.flow = S.flow || {}; return S.flow[id] || (S.flow[id] = {}); }
    function toJobs() { try { win.history.replaceState(null, '', '/garage/'); } catch (e) {} openJobs(); }
    function wizTop(j, page) {
      var idx = PAGES.indexOf(page), f = flowOf(j.id);
      var back = el('button', { class: 'g-back', type: 'button', id: 'gBack', text: '← Back', onclick: function () { if (page === 'estimate') { f.view = 'inspect'; render(); } else if (page === 'phone' || page === 'code') { f.view = PAGES[idx - 1]; render(); } else toJobs(); } });
      return el('div', { class: 'g-wiz-top' }, [back, el('ol', { class: 'g-dots', 'aria-label': 'Step ' + (Math.max(0, idx) + 1) + ' of ' + PAGES.length }, PAGES.map(function (x, i) { return el('li', { class: i < idx ? 'is-done' : i === idx ? 'is-now' : '', 'aria-current': i === idx ? 'step' : null }); }))]);
    }
    function wizPage(j, page) {
      var f = flowOf(j.id), idx = PAGES.indexOf(page), nat = jobPage(j, { }), natIdx = PAGES.indexOf(nat), msg = el('div', { id: 'gProgMsg', 'aria-live': 'polite' });
      var advance = function () { var n = PAGES[idx + 1]; f.view = idx + 1 >= natIdx ? null : n; render(); };
      var big = function (id, text, fn, off) { return el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: id, disabled: off || null, text: text, onclick: function () { fn(this); } }); };
      var send = function (btn, event, items) {
        btn.disabled = true; var old = btn.textContent; btn.textContent = 'Saving'; clear(msg);
        uploadPhotos(j.id, items).then(function (paths) { return api('progress', { id: j.id, event: event, photos: paths }); }).then(function (r) {
          if (ended(r)) return; btn.disabled = false; btn.textContent = old;
          if (!r.ok) { msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; }
          S.photos = []; f.view = null; S.job = null; render(); fetchJob(); S.jobs = null;
        }).catch(function (e) { btn.disabled = false; btn.textContent = old; msg.appendChild(notice('err', e && e.message || ERR.gen)); });
      };
      var pl = j.place || {}, area = [pl.area, pl.pincode].filter(Boolean).join(' · '), kids = [], title = j.vehicle, lines = [];
      if (page === 'offer') {
        lines = [(area || 'Customer area not shown') + ' · ' + j.work, whenText(j.return_by) ? 'Return by ' + whenText(j.return_by) : 'Return time not set'];
        kids.push(big('gStepAccept', 'Accept job', function (b) { send(b, 'received', []); }));
        var cant = el('button', { class: 'g-btn g-btn-ghost g-wide', type: 'button', id: 'gCantTake', text: 'Can’t take it' }); cant.onclick = function () { cant.replaceWith(el('div', {}, [notice('info', 'Tell the team now so they can send this job elsewhere.'), teamButtons()])); };
        kids.push(cant);
      } else if (page === 'navigate') {
        title = 'Go to the customer'; lines = [pl.address || area || 'Address not shown'];
        var nav = navigateUrl(pl); if (nav) kids.push(el('a', { class: 'g-btn g-btn-navy g-wide g-step-nav', id: 'gNavigate', href: nav, target: '_blank', rel: 'noopener noreferrer', text: 'Navigate' }));
        kids.push(big('gStepArrived', 'I have arrived', function () { f.arrived = true; advance(); }));
      } else if (page === 'phone') {
        title = j.customer_first_name; lines = [j.customer_phone ? 'Call the customer if you cannot find them.' : 'The number is not shown now.'];
        if (j.customer_phone) kids.push(el('a', { class: 'g-btn g-btn-navy g-wide g-step-nav', id: 'gCallCustomer', href: telHref(j.customer_phone), text: 'Call ' + phoneShow(j.customer_phone) }));
        kids.push(big('gStepFound', 'Vehicle found', function () { f.found = true; advance(); }));
      } else if (page === 'code') {
        title = 'Customer code'; lines = ['Ask the customer for their 4-digit code.'];
        if (j.code === 'locked' || j.code === 'expired' || j.code === 'none') { lines = [j.code === 'locked' ? 'Too many wrong codes. The team will send a new code.' : j.code === 'expired' ? 'The code has expired. Ask the team for a new one.' : 'The customer has no code yet. Ask the team to send one.']; kids.push(teamButtons()); }
        else kids.push(codeBoxes(function (code, done) {
          clear(msg);
          api('verify_code', { id: j.id, code: code }).then(function (r) {
            if (ended(r)) return;
            if (r.ok) { f.view = null; S.job = null; render(); fetchJob(); return; }
            done(); msg.appendChild(notice('err', r.data && r.data.error || ERR.gen));
            if (r.data && r.data.locked) { S.job = null; fetchJob(); }
          });
        }));
      } else if (page === 'inspect') {
        title = 'Inspect and quote'; lines = [j.quote.label];
        if (j.can_start) { lines.push('Code confirmed. Start the work.'); kids.push(big('gStepStart', 'Start work', function (b) { send(b, 'work_started', []); })); }
        else { lines.push(j.start_blocked_reason || 'The customer must approve the quote first.'); kids.push(big('gStepEstimate', 'Send estimate', function () { f.view = 'estimate'; render(); })); }
      } else if (page === 'ready') {
        title = 'Work done'; lines = ['Take a photo, then mark ready.'];
        var rb; kids.push(photoPicker(function () { if (rb) rb.disabled = !S.photos.length; }, true, true));
        rb = big('gStepReady', 'Ready for return', function (b) { send(b, 'ready', S.photos.slice()); }, !S.photos.length); kids.push(rb);
      } else {
        title = 'Ready for return'; lines = ['Mechanix Pro has been told.', 'The team hands the vehicle back and closes the job.'];
        kids.push(big('gStepDone', 'All jobs', toJobs));
      }
      return el('div', { class: 'g-wiz-page' }, [wizTop(j, page), el('h1', { class: 'g-wiz-h', text: title })].concat(lines.map(function (t, i) { return el('p', { class: 'g-wiz-l', id: i === 0 ? 'gStepHint' : null, text: t }); }), [el('div', { class: 'g-wiz-btns' }, kids), msg]));
    }
    /* four big numeric boxes: one hidden number input holds the digits (numeric keypad), the boxes only show them */
    function codeBoxes(onDone) {
      var inp = el('input', { class: 'g-code-in', id: 'gCodeIn', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'one-time-code', 'aria-label': 'Customer 4-digit code' });
      var boxes = [0, 1, 2, 3].map(function () { return el('span', { class: 'g-code-box', 'aria-hidden': 'true' }); });
      var row = el('label', { class: 'g-code', for: 'gCodeIn' }, boxes.concat([inp]));
      function paint() { var v = inp.value; boxes.forEach(function (b, i) { b.textContent = v.charAt(i) ? '\u2022' : ''; b.className = 'g-code-box' + (i === v.length ? ' is-cur' : ''); }); }
      inp.oninput = function () { inp.value = cleanCode(inp.value); paint(); go.disabled = !isCode(inp.value); };
      var go = el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: 'gStepCode', disabled: true, text: 'Confirm code', onclick: function () {
        if (!isCode(inp.value)) return; go.disabled = true; go.textContent = 'Checking';
        onDone(inp.value, function () { inp.value = ''; paint(); go.textContent = 'Confirm code'; inp.focus(); });
      } });
      paint();
      return el('div', {}, [row, go]);
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
      if (S.screen === 'pin') return renderPin(); if (S.screen === 'home') return renderHome(); if (S.screen === 'jobs') return renderJobs(); if (S.screen === 'job') return renderJob();
      if (S.screen === 'statement') return renderStatement(); if (S.screen === 'help') return renderHelp();
      shell([loading('Opening')], null);
    }

    /* ---------- boot ---------- */
    var fromUrl = linkFromUrl(win.location.search);
    if (fromUrl) { saveLink(win, fromUrl); try { win.history.replaceState(null, '', '/garage/'); } catch (e) {} }
    var ses = savedSession(win);
    if (ses && savedLink(win)) { S.session = ses.t; S.name = ses.name || ''; loadTeam(); openHome(true); } else { go('pin'); }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && S.session && Date.now() - S.jobsAt > 60000) { if (S.screen === 'jobs') fetchJobs(); else if (S.screen === 'home') fetchHome(); } });
  }
  return { jobPage: jobPage, cleanCode: cleanCode, isCode: isCode, STEP_EVENT: STEP_EVENT, PAGES: PAGES, start: start, locText: locText, locAsked: locAsked, markLocAsked: markLocAsked, LOC_KEY: LOC_KEY, money: money, totals: totals, whenText: whenText, telHref: telHref, navigateUrl: navigateUrl, availabilityText: availabilityText, phoneShow: phoneShow, teamLinks: teamLinks, saveLink: saveLink, savedLink: savedLink, linkFromUrl: linkFromUrl, saveSession: saveSession, savedSession: savedSession, clearSession: clearSession, LINK_KEY: LINK_KEY, SESSION_KEY: SESSION_KEY };
});
