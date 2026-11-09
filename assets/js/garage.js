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
  var PAGES = ['offer', 'navigate', 'phone', 'receive', 'code', 'inspect', 'ready', 'pay', 'done'];
  /** 75 seconds becomes 01:15. */
  function waitText(sec) { sec = Math.max(0, Math.floor(Number(sec) || 0)); var m = Math.floor(sec / 60), r = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  /** The 4-digit code: digits only, at most four. */
  function cleanCode(v) { return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 4); }
  function isCode(v) { return /^[0-9]{4}$/.test(String(v == null ? '' : v)); }
  /** Which full-screen page a job is on. flow: { arrived, found, view } (local choices kept in place; view = a page the garage went Back to). */
  function jobPage(j, flow) {
    flow = flow || {};
    var nat;
    if (!j) nat = 'offer';
    else if (j.status === 'sent') nat = 'offer';
    else if (j.status === 'received') {
      // Receiving checklist (client BRD): odometer, condition, damage and photos before the code and the inspection. A job detail without it (older data) counts as done.
      var needCode = j.code_needed && j.code !== 'verified', rec = !j.receiving || j.receiving.done;
      nat = needCode ? (flow.found ? (rec ? 'code' : 'receive') : flow.arrived ? 'phone' : 'navigate') : (rec ? 'inspect' : 'receive');
    }
    else if (j.status === 'in_work') nat = 'ready';
    else if (j.status === 'ready' && j.pay && j.pay.paid === false && !flow.skipPay) nat = 'pay';
    else nat = 'done';
    if (flow.view === 'estimate' && nat === 'inspect') return 'estimate';
    if (flow.view && PAGES.indexOf(flow.view) >= 0 && PAGES.indexOf(flow.view) < PAGES.indexOf(nat)) return flow.view;
    return nat;
  }
  /** Event each page sends (null: no event; the page moves on locally or calls verify_code / the estimate). */
  var STEP_EVENT = { offer: 'received', navigate: null, phone: null, receive: null, code: null, inspect: 'work_started', ready: 'ready', pay: null, done: null };
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

    /* haptics, alert tone (Web Audio, no files) and the vibrate pattern while a new job waits */
    function buzz(p) { try { if (win.navigator && win.navigator.vibrate) win.navigator.vibrate(p); } catch (e) {} }
    var AC = null, alertTimer = null;
    function unlockAudio() { try { var C0 = win.AudioContext || win.webkitAudioContext; if (!C0) return; if (!AC) AC = new C0(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
    d.addEventListener('pointerdown', unlockAudio, true);
    function beep() { try { if (!AC || AC.state !== 'running') return; var t = AC.currentTime; [880, 1175].forEach(function (f, i) { var o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.22); g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.22 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2); o.connect(g); g.connect(AC.destination); o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.22); }); } catch (e) {} }
    function startAlert() { if (alertTimer) return; var ring = function () { beep(); buzz([300, 150, 300]); }; ring(); alertTimer = win.setInterval(ring, 2500); }
    function stopAlert() { if (alertTimer) { win.clearInterval(alertTimer); alertTimer = null; } buzz(0); }
    var ringTimer = null;
    function stopRing() { if (ringTimer) { win.clearInterval(ringTimer); ringTimer = null; } }
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
      clear(app); app.classList.remove('g-wiz'); var dark = !!S.session && (active === 'home' || active === 'jobs'); app.classList.toggle('g-dark', dark); d.body.classList.toggle('g-dark-bg', dark);
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
            S.session = r.data.session; S.name = r.data.garage && r.data.garage.name || ''; saveSession(win, r.data); S.msg = null; loadTeam(); enter();
          });
        } }, [el('label', { class: 'g-label', for: 'gpin', text: 'PIN' }), input, el('p', { class: 'g-hint', text: 'The PIN is for your garage only. Do not share it.' }), msg, btn]);
        kids.push(form);
      }
      var inst = el('div', { class: 'g-install', id: 'gInstall' }); kids.push(inst);
      shell(kids, null); if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall'), win);
      var i = d.getElementById('gpin'); if (i) try { i.focus(); } catch (e) {}
    }

    /* ---------- home (dashboard): greeting, today, status, quick action, month figures, what we owe you, shop location ---------- */
    var F = function () { return win.MXP_FLOW; };
    /* After login: terms (once per version) and the tour (once), then Home. */
    function enter() {
      S.screen = 'gate'; render();
      api('me').then(function (r) {
        if (ended(r)) return;
        if (!r.ok || !F()) return openHome(true);
        S.selfieAt = r.data.selfie_at || null; S.suspended = !!r.data.suspended;
        F().runGate(win, app, { me: r.data, kind: 'garage', api: api, done: function () { openHome(true); } });
      });
    }
    function openHome(first) { S.screen = 'home'; S.dash = null; render(); fetchJobs(); fetchUnread(); return fetchHome(first); }
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
      if (S.openBusy || !S.dash || S.dash === 'error') return;
      if (open && F() && !F().selfieFresh(S.selfieAt)) { return F().showSelfie(win, app, { api: api, onDone: function (at) { S.selfieAt = at; S.screen = 'home'; render(); setOpen(true); }, onCancel: function () { S.screen = 'home'; render(); } }); }
      S.openBusy = true; render();
      api('open_set', { open: open }).then(function (r) { S.openBusy = false; if (ended(r)) return; if (r.ok) S.dash.is_open = r.data.open; else if (r.data && r.data.code === 'selfie') { S.selfieAt = null; setOpen(true); return; } render(); });
    }
    function renderHome() {
      var dsh = S.dash, body = [];
      body.push(el('div', { class: 'd-banner' }, [el('div', {}, [el('h1', { text: 'Hello, ' + (S.name || 'garage') }), dsh && dsh !== 'error' && dsh.city ? el('p', { text: dsh.city }) : null]), el('button', { class: 'd-out', type: 'button', id: 'dLogout', onclick: function () { lock('You are signed out.'); }, text: 'Logout' })]));
      if (dsh === null) { body.push(loading('Loading your day')); shell(body, 'home', true); return; }
      if (dsh === 'error') { body.push(retryCard(S.dashErr || ERR.gen, function () { S.dash = null; render(); fetchHome(); })); shell(body, 'home', true); return; }
      var av = availabilityText(!!dsh.is_open);
      body.push(el('section', { class: 'd-avail' + (dsh.is_open ? ' on' : ' off'), 'aria-label': 'Availability' }, [
        el('div', { class: 'd-avail-txt' }, [el('p', { class: 'd-avail-title', id: 'dAvailTitle', text: av.title }), el('p', { class: 'g-hint', text: av.help }), F() && S.selfieAt ? el('p', { class: 'g-hint', id: 'dSelfie', text: F().selfieLine(S.selfieAt) }) : null]),
        el('button', { class: 'd-sw', type: 'button', role: 'switch', id: 'dAvailSwitch', 'aria-checked': dsh.is_open ? 'true' : 'false', 'aria-label': 'Available for jobs', disabled: S.openBusy || null, onclick: function () { setOpen(!dsh.is_open); } }, [el('span', { class: 'd-knob' })])]));
      var openJobsList = Array.isArray(S.jobs) ? S.jobs.filter(function (x) { return x.tab === 'open'; }) : [], nx = openJobsList[0];
      body.push(el('div', { class: 'g-chips' }, [el('span', { class: 'g-chip g-chip-work', id: 'dTodayChip', text: 'Today: ' + dsh.today_jobs + (dsh.today_jobs === 1 ? ' job' : ' jobs') })]));
      body.push(el('section', { class: 'g-next-card', 'aria-label': 'Next job' }, nx ? [el('p', { class: 'g-wiz-l', text: nx.status === 'sent' ? 'New job waiting' : 'Next job' }), el('p', { class: 'g-key', id: 'dNextJob', text: nx.vehicle }), el('p', { class: 'g-wiz-l', text: nx.work }),
        el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: 'dOpenNext', text: nx.status === 'sent' ? 'View offer' : 'Continue job', onclick: function () { buzz(15); openJob(nx.id); } })] : [el('p', { class: 'g-key', id: 'dNextJob', text: Array.isArray(S.jobs) ? 'No open jobs' : 'Checking for jobs' }), el('p', { class: 'g-wiz-l', text: dsh.is_open ? 'New jobs appear here and ring your phone.' : 'Switch Available on to get jobs.' })]));
      body.push(el('div', { class: 'd-two' }, [el('section', { class: 'd-card', 'aria-label': 'Today’s jobs' }, [el('p', { class: 'd-label', text: 'Today’s jobs' }), el('p', { class: 'd-big', id: 'dToday', text: String(dsh.today_jobs) })]), el('section', { class: 'd-card', 'aria-label': 'Open now' }, [el('p', { class: 'd-label', text: 'Open now' }), el('p', { class: 'd-big', id: 'dOpenJobs', text: String(dsh.open_jobs) })])]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Quick actions' }, [el('p', { class: 'd-label', text: 'Quick actions' }), el('button', { class: 'g-btn g-btn-primary d-xl', type: 'button', id: 'dGet', onclick: function () { S.tab = 'open'; openJobs(); }, text: 'Get my jobs' })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'My monthly stats' }, [el('p', { class: 'd-label', text: 'My monthly stats' }), el('div', { class: 'd-stats' }, [
        el('div', {}, [el('b', { text: String(dsh.month.jobs) }), el('span', { text: 'Total jobs' })]), el('div', {}, [el('b', { text: String(dsh.month.completed) }), el('span', { text: 'Completed' })]), el('div', {}, [el('b', { text: dsh.month.avg_ticket == null ? '—' : money(dsh.month.avg_ticket) }), el('span', { text: 'Average ticket' })])])]));
      var lines = dsh.unsettled.map(function (u) {
        return el('article', { class: 'd-job' }, [el('div', { class: 'd-job-top' }, [el('b', { text: (u.booking_id || 'Job') + ' · ' + u.vehicle }), el('span', { class: 'g-muted', text: u.completed_at ? whenText(u.completed_at).split(', ').slice(0, 2).join(', ') : '' })]),
          el('dl', { class: 'd-fig' }, [el('dt', { text: u.label }), el('dd', { class: 'd-ok', text: money(u.amount) })])]);
      });
      body.push(el('details', { class: 'd-fold', id: 'dUnsettled' }, [el('summary', { text: 'Previous unsettled (' + dsh.unsettled.length + ')' }), el('div', { class: 'd-fold-body' }, lines.length ? lines.concat([el('p', { class: 'g-hint', text: 'Total ' + money(dsh.unsettled_total) + '. Amounts are entered by Mechanix Pro for each finished job.' })]) : [el('p', { class: 'g-muted', text: 'Nothing is waiting. Settled jobs are on the Statement tab.' })])]));
      body.push(el('section', { class: 'd-card g-leads-card', 'aria-label': 'Live leads' }, [el('p', { class: 'd-label', text: 'Live leads' }), el('p', { text: 'Open bookings near you. The first garage to tap Claim gets the job.' }), el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', id: 'dLeads', onclick: function () { openLeads(); }, text: 'See live leads' })]));
      if (S.suspended) body.push(notice('err', 'Your account is suspended. You can see past jobs, payments and your profile, but you cannot take new jobs or make changes. Contact Mechanix Pro.'));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Announcements' }, [el('p', { class: 'd-label', text: 'Announcements' }), el('p', { text: 'Updates and policies from Mechanix Pro.' }), el('button', { class: 'g-btn g-btn-ghost g-wide', type: 'button', id: 'dAnn', onclick: function () { openAnnouncements(); }, text: 'Open announcements' + (S.annUnread ? ' (' + S.annUnread + ' new)' : '') })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Profile and performance' }, [el('p', { class: 'd-label', text: 'Profile and performance' }), el('p', { text: 'Your details, ratings, and requests to change bank details or working hours.' }), el('button', { class: 'g-btn g-btn-ghost g-wide', type: 'button', id: 'dAcct', onclick: function () { openAccount(); }, text: 'Open profile and performance' })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Shop location' }, [el('p', { class: 'd-label', text: 'Shop location' }), el('p', { id: 'dLocText', text: locText(dsh.location) }),
        el('p', { class: 'g-hint', text: 'Helps Mechanix Pro send you jobs nearby. Your phone asks first, and the app works the same if you say no.' }),
        S.locMsg ? notice('info', S.locMsg.text) : null,
        el('button', { class: 'g-btn g-btn-ghost g-wide', type: 'button', id: 'dLoc', disabled: S.locBusy || null, onclick: function () { saveLocation(); }, text: S.locBusy ? 'Finding your location' : 'Update shop location' })]));
      shell(body, 'home', true);
    }

    /* ---------- jobs list ---------- */
    function loadTeam() { api('team_contact').then(function (r) { if (r.ok) S.team = { whatsapp: r.data.whatsapp, call: r.data.call }; }); }
    /* Live leads: open paid bookings near this garage, first to claim wins. The list carries no name, phone or street address. Refreshes every 20 seconds while the screen is open and the page is visible. */
    var leadsTimer = null;
    function stopLeads() { if (leadsTimer) { win.clearInterval(leadsTimer); leadsTimer = null; } }
    function fetchLeads() {
      return api('leads').then(function (r) {
        if (ended(r)) return;
        if (!r.ok) { S.leads = 'error'; S.leadsErr = r.data && r.data.error || ERR.gen; } else { S.leads = r.data; }
        if (S.screen === 'leads') render();
      });
    }
    function openLeads() { S.screen = 'leads'; S.leads = null; S.leadsMsg = null; render(); fetchLeads(); stopLeads(); leadsTimer = win.setInterval(function () { if (S.screen !== 'leads') { stopLeads(); return; } if (!d.hidden) fetchLeads(); }, 20000); }
    function claimLead(id, btn) {
      if (btn) btn.disabled = true;
      api('claim', { lead: id }).then(function (r) {
        if (ended(r)) return;
        if (r.ok) { stopLeads(); S.jobs = null; fetchJobs().then(function () { var mine = (S.jobs && S.jobs !== 'error' ? S.jobs : []).filter(function (j) { return j.id === r.data.id; })[0]; if (mine) openJob(mine.id); else openJobs(); }); return; }
        S.leadsMsg = (r.data && r.data.error) || ERR.gen; fetchLeads();
      });
    }
    function renderLeads() {
      var body = [], L = S.leads;
      body.push(el('div', { class: 'g-h' }, [el('h1', { text: 'Live leads' }), el('button', { class: 'g-link', type: 'button', onclick: function () { S.leads = null; render(); fetchLeads(); }, text: 'Refresh' })]));
      body.push(el('button', { class: 'g-back', type: 'button', onclick: function () { stopLeads(); S.screen = 'home'; render(); }, text: '← Back to Home' }));
      if (S.leadsMsg) body.push(notice('info', S.leadsMsg));
      if (L === null) { body.push(loading('Looking for jobs near you')); shell(body, 'jobs'); return; }
      if (L === 'error') { body.push(retryCard(S.leadsErr || ERR.gen, function () { S.leads = null; render(); fetchLeads(); })); shell(body, 'jobs'); return; }
      if (!L.available) body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: 'Switch Available on to see live leads.' })]));
      else if (L.full) body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: 'You have as many open jobs as you can take. Finish one to see more.' })]));
      else if (!L.leads.length) body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: 'No open jobs near you right now. This list refreshes by itself.' })]));
      else body.push(el('ul', { class: 'g-list g-leads' }, L.leads.map(function (x) {
        var when = (x.slot_date ? x.slot_date : 'Date to confirm') + (x.slot_part ? ' · ' + x.slot_part : ''), where = (x.area || 'Area to confirm') + (x.pin ? ' · ' + x.pin : '') + (x.distance_km != null ? ' · ' + x.distance_km + ' km' : '');
        var btn = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', text: 'Claim this job' }); btn.onclick = function () { claimLead(x.id, btn); };
        return el('li', {}, [el('article', { class: 'd-job g-lead' }, [el('div', { class: 'd-job-top' }, [el('b', { text: (x.model || (x.vehicle_type === 'car' ? 'Car' : 'Bike')) }), el('span', { class: 'g-muted', text: x.ref || '' })]), el('p', { class: 'g-wiz-l', text: x.service }), el('p', { class: 'g-muted', text: where }), el('p', { class: 'g-muted', text: when }), btn])]);
      })));
      shell(body, 'jobs');
    }
    function openJobs() { S.screen = 'jobs'; S.jobs = null; render(); fetchJobs(); }
    function fetchJobs() {
      return api('jobs').then(function (r) {
        if (ended(r)) return; if (!r.ok) { S.jobs = 'error'; S.jobsErr = r.data && r.data.error || ERR.gen; } else { S.jobs = r.data.jobs || []; if (r.data.garage && r.data.garage.name) S.name = r.data.garage.name; S.jobsAt = Date.now(); }
        if (S.screen === 'jobs' || S.screen === 'home') render();
      });
    }
    function renderJobs() {
      var body = [], jobs = S.jobs;
      body.push(el('div', { class: 'g-h' }, [el('h1', { text: 'Your jobs' }), el('button', { class: 'g-link', type: 'button', onclick: function () { S.jobs = null; render(); fetchJobs(); }, text: 'Refresh' })]));
      if (S.flash) { body.push(notice('info', S.flash)); S.flash = null; }
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
    function openJob(id) { (S.seen = S.seen || {})[id] = true; S.jobId = id; S.job = null; S.draft = null; S.photos = []; S.confirm = null; S.msg = null; S.screen = 'job'; render(); fetchJob(); try { win.location.hash = '#/job/' + id; } catch (e) {} }
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
      if (page === 'pay') { body.push(payPage(j)); shell(body, 'jobs'); app.classList.add('g-wiz'); return; }
      body.push(wizPage(j, page));
      shell(body, 'jobs'); app.classList.add('g-wiz');
    }
    /* Pro Check 20: a full-screen set of screens over the job (shared module assets/js/pro-check-ui.js). */
    var chkOverlay = null;
    function closeCheck() { if (chkOverlay && chkOverlay.parentNode) chkOverlay.parentNode.removeChild(chkOverlay); chkOverlay = null; render(); }
    function openCheck(j) {
      if (chkOverlay || !win.MXP_PCHK) return;
      chkOverlay = d.createElement('div'); chkOverlay.className = 'cp-overlay'; chkOverlay.id = 'gCheckPage';
      var ui = win.MXP_PCHK.create({ doc: d, win: win, onClose: closeCheck,
        call: function (a, b) { return api(a, Object.assign({ id: j.id }, b || {})).then(function (r) { return { ok: r.ok, data: r.data }; }); } });
      chkOverlay.appendChild(ui.el); d.body.appendChild(chkOverlay);
    }
    /* Mechanix Live: share a photo or a short clip with the customer (shared module assets/js/live-ui.js). */
    var liveOverlay = null;
    function closeLive() { if (liveOverlay && liveOverlay.parentNode) liveOverlay.parentNode.removeChild(liveOverlay); liveOverlay = null; render(); }
    function openLive(j) {
      if (liveOverlay || !win.MXP_LIVE) return;
      liveOverlay = d.createElement('div'); liveOverlay.className = 'cp-overlay'; liveOverlay.id = 'gLivePage';
      var ui = win.MXP_LIVE.create({ doc: d, win: win, onClose: closeLive, call: function (a, b) { return api(a, Object.assign({ id: j.id }, b || {})).then(function (r) { return { ok: r.ok, data: r.data }; }); } });
      liveOverlay.appendChild(ui.el); d.body.appendChild(liveOverlay);
    }
    /* Collect payment page: online first (amount, QR, WhatsApp link); cash/UPI behind 'Customer wants to inspect first'. Rules are enforced by the server. */
    var payUI = null;
    function payPage(j) {
      if (payUI) payUI.stop();
      var holder = el('div', { class: 'g-wiz-page g-pay' });
      var skip = el('button', { class: 'cp-linkbtn', type: 'button', id: 'gPaySkip', text: 'Not now: the team will follow up', onclick: function () { if (payUI) payUI.stop(); flowOf(j.id).skipPay = true; render(); } });
      if (!win.MXP_PAY) { holder.appendChild(el('p', { class: 'g-wiz-l', text: 'The payment page could not load. Tell the team.' })); holder.appendChild(skip); return holder; }
      payUI = win.MXP_PAY.create({ doc: d, win: win, state: Object.assign({}, j.pay), phone: j.customer_phone || '', first: '',
        call: function (a, b) { return api(a, Object.assign({ id: j.id }, b || {})).then(function (r) { return { ok: r.ok, data: r.data }; }); },
        poll: function () { return api('job', { id: j.id }).then(function (r) { return r.ok && r.data.job && r.data.job.pay ? Object.assign({}, r.data.job.pay) : null; }); },
        onChange: function (st) { j.pay = Object.assign({}, j.pay, st); } });
      holder.appendChild(payUI.el); holder.appendChild(skip); return holder;
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
    function svgTick() { var n = 'http://www.w3.org/2000/svg', v = d.createElementNS(n, 'svg'), c = d.createElementNS(n, 'circle'), p = d.createElementNS(n, 'path'); v.setAttribute('viewBox', '0 0 80 80'); v.setAttribute('width', '96'); v.setAttribute('height', '96'); c.setAttribute('cx', '40'); c.setAttribute('cy', '40'); c.setAttribute('r', '36'); p.setAttribute('d', 'M24 41l11 11 21-24'); v.appendChild(c); v.appendChild(p); return v; }
    /* how long the offer has waited (not an auto-expire): a ring that fills over 15 minutes and mm:ss in the middle */
    function waitRing(j) {
      var t0 = j.timeline && j.timeline[0] && j.timeline[0].at ? Date.parse(j.timeline[0].at) : Date.now(), exp = j.offer_expires_at ? Date.parse(j.offer_expires_at) : null, n = 'http://www.w3.org/2000/svg', R = 54, C = 2 * Math.PI * R;
      var svg = d.createElementNS(n, 'svg'), bg = d.createElementNS(n, 'circle'), fg = d.createElementNS(n, 'circle'); svg.setAttribute('viewBox', '0 0 128 128'); svg.setAttribute('class', 'g-ring-svg'); svg.setAttribute('aria-hidden', 'true');
      [bg, fg].forEach(function (c, i) { c.setAttribute('cx', '64'); c.setAttribute('cy', '64'); c.setAttribute('r', String(R)); c.setAttribute('class', i ? 'g-ring-fg' : 'g-ring-bg'); svg.appendChild(c); });
      fg.setAttribute('stroke-dasharray', String(C));
      var txt = el('b', { class: 'g-ring-t', id: 'gWait' }), cap = el('span', { class: 'g-ring-c', text: exp ? 'left to accept' : 'waiting' }), box = el('div', { class: 'g-ring', role: 'timer', 'aria-label': 'Time this offer has waited' }, [svg, el('div', { class: 'g-ring-in' }, [txt, cap])]);
      function tickR() {
        var sec = Math.max(0, Math.floor((Date.now() - t0) / 1000));
        if (exp) { var left = Math.max(0, Math.floor((exp - Date.now()) / 1000)); txt.textContent = waitText(left); fg.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, left / 900)))); if (left <= 0) { stopRing(); stopAlert(); S.jobs = null; S.job = null; win.setTimeout(function () { if (S.screen === 'job') { S.flash = 'This offer was not accepted in time and went back to the team.'; toJobs(); } }, 1500); } return; }
        txt.textContent = waitText(sec); fg.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, sec / 900))));
      }
      tickR(); if (j.status === 'sent') { stopRing(); ringTimer = win.setInterval(tickR, 1000); }
      return box;
    }
    function wizTop(j, page) {
      var idx = PAGES.indexOf(page), f = flowOf(j.id);
      var back = el('button', { class: 'g-back', type: 'button', id: 'gBack', text: '← Back', onclick: function () { if (page === 'estimate') { f.view = 'inspect'; render(); } else if (page === 'phone' || page === 'receive' || page === 'code') { f.view = PAGES[idx - 1]; render(); } else toJobs(); } });
      return el('div', { class: 'g-wiz-top' }, [back, el('ol', { class: 'g-dots', 'aria-label': 'Step ' + (Math.max(0, idx) + 1) + ' of ' + PAGES.length }, PAGES.map(function (x, i) { return el('li', { class: i < idx ? 'is-done' : i === idx ? 'is-now' : '', 'aria-current': i === idx ? 'step' : null }); }))]);
    }
    function wizPage(j, page) {
      var f = flowOf(j.id), idx = PAGES.indexOf(page), nat = jobPage(j, { }), natIdx = PAGES.indexOf(nat), msg = el('div', { id: 'gProgMsg', 'aria-live': 'polite' });
      var advance = function () { var n = PAGES[idx + 1]; f.view = idx + 1 >= natIdx ? null : n; S.tick = true; render(); };
      var big = function (id, text, fn, off) { return el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: id, disabled: off || null, text: text, onclick: function () { buzz(15); fn(this); } }); };
      var send = function (btn, event, items) {
        btn.disabled = true; var old = btn.textContent; btn.textContent = 'Saving'; clear(msg);
        uploadPhotos(j.id, items).then(function (paths) { return api('progress', { id: j.id, event: event, photos: paths }); }).then(function (r) {
          if (ended(r)) return; btn.disabled = false; btn.textContent = old;
          if (!r.ok) { msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; }
          S.photos = []; f.view = null; S.job = null; S.tick = true; stopAlert(); render(); fetchJob(); S.jobs = null;
        }).catch(function (e) { btn.disabled = false; btn.textContent = old; msg.appendChild(notice('err', e && e.message || ERR.gen)); });
      };
      var pl = j.place || {}, area = [pl.area, pl.pincode].filter(Boolean).join(' · '), kids = [], title = j.vehicle, lines = [];
      if (page === 'offer') {
        title = j.vehicle; lines = [(area || 'Customer area not shown'), j.work + (whenText(j.return_by) ? ' · return by ' + whenText(j.return_by) : '')];
        kids.push(waitRing(j));
        if (j.status === 'sent') startAlert();
        kids.push(el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn g-accept', type: 'button', id: 'gStepAccept', text: 'Accept job', onclick: function () { stopAlert(); buzz(15); send(this, 'received', []); } }));
        var cant = el('button', { class: 'g-btn g-btn-ghost g-cant', type: 'button', id: 'gCantTake', text: 'Decline this job' });
        cant.onclick = function () {
          stopAlert();
          var why = el('textarea', { class: 'g-input', id: 'gDeclineWhy', rows: 3, maxlength: 200, placeholder: 'Why can you not take it? For example: no free bay today', 'aria-label': 'Reason for declining' }), dmsg = el('div', { 'aria-live': 'polite' });
          var go = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', id: 'gDeclineGo', text: 'Send decline', onclick: function () {
            clear(dmsg); var r0 = why.value.trim(); if (r0.length < 5) { dmsg.appendChild(notice('err', 'Tell us why, in a few words.')); return; }
            go.disabled = true; go.textContent = 'Sending';
            api('decline', { id: j.id, reason: r0 }).then(function (r) {
              if (ended(r)) return; go.disabled = false; go.textContent = 'Send decline';
              if (!r.ok) { dmsg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; }
              stopRing(); S.job = null; S.jobs = null; S.flash = r.data.free_used ? 'Declined. You have declined more than one job this week, and the team can see it.' : 'Declined. The job went back to the team. Your first decline each week is free.'; toJobs();
            });
          } });
          cant.replaceWith(el('div', { class: 'g-card' }, [el('label', { class: 'g-label', for: 'gDeclineWhy', text: 'Reason (required)' }), why, dmsg, go]));
        };
        kids.push(cant);
      } else if (page === 'navigate') {
        title = 'Go to the customer'; lines = [pl.address || area || 'Address not shown'];
        var nav = navigateUrl(pl); if (nav) kids.push(el('a', { class: 'g-btn g-btn-navy g-wide g-step-nav', id: 'gNavigate', href: nav, target: '_blank', rel: 'noopener noreferrer', text: 'Navigate' }));
        kids.push(big('gStepArrived', 'I have arrived', function () { f.arrived = true; advance(); }));
      } else if (page === 'phone') {
        title = j.customer_first_name; lines = [j.customer_phone ? 'Call the customer if you cannot find them.' : 'The number is not shown now.'];
        if (j.customer_phone) kids.push(el('a', { class: 'g-btn g-btn-navy g-wide g-step-nav', id: 'gCallCustomer', href: telHref(j.customer_phone), text: 'Call ' + phoneShow(j.customer_phone) }));
        kids.push(big('gStepFound', 'Vehicle found', function () { f.found = true; advance(); }));
      } else if (page === 'receive') {
        title = 'Vehicle received'; lines = ['Record how it arrived: odometer, condition, damage and photos.'];
        var rc = flowOf(j.id).rc || (flowOf(j.id).rc = { odo: '', checks: {}, damage: '' }), POINTS = [['body', 'Body and panels'], ['lights', 'Lights and indicators'], ['tyres', 'Tyres'], ['fuel', 'Fuel level'], ['accessories', 'Accessories (mirrors, seat, bags)']];
        var odo = el('input', { class: 'g-input', id: 'gOdo', type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: 'Odometer (km)', 'aria-label': 'Odometer reading in kilometres', value: rc.odo, oninput: function (e) { rc.odo = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = rc.odo; fin(); } });
        var go2 = null;
        function fin() { if (go2) go2.disabled = !(rc.odo !== '' && POINTS.every(function (p) { return rc.checks[p[0]]; }) && S.photos.length); }
        kids.push(odo);
        POINTS.forEach(function (p) {
          var row = el('div', { class: 'g-row g-rc' }, [el('span', { class: 'g-rc-l', text: p[1] })]);
          [['ok', 'OK'], ['issue', 'Issue']].forEach(function (o) { var b = el('button', { type: 'button', class: 'g-btn ' + (rc.checks[p[0]] === o[0] ? (o[0] === 'ok' ? 'g-btn-primary' : 'g-btn-navy') : 'g-btn-ghost') + ' g-rc-b', 'aria-pressed': rc.checks[p[0]] === o[0] ? 'true' : 'false', text: o[1], onclick: function () { rc.checks[p[0]] = o[0]; render(); } }); row.appendChild(b); });
          kids.push(row);
        });
        kids.push(el('textarea', { class: 'g-input', id: 'gDamage', rows: 2, maxlength: 300, placeholder: 'Any damage already on the vehicle? (optional)', 'aria-label': 'Damage noted', oninput: function (e) { rc.damage = e.target.value; } }, [rc.damage]));
        kids.push(photoPicker(fin, true, true));
        go2 = big('gStepReceived', 'Save the checklist', function (b) {
          b.disabled = true; var old2 = b.textContent; b.textContent = 'Saving'; clear(msg);
          uploadPhotos(j.id, S.photos.slice()).then(function (paths) { return api('receiving_save', { id: j.id, odometer_km: Number(rc.odo), checks: rc.checks, damage: rc.damage.trim() || null, photos: paths }); }).then(function (r) {
            if (ended(r)) return; b.disabled = false; b.textContent = old2;
            if (!r.ok) { msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; }
            S.photos = []; flowOf(j.id).rc = null; S.job = null; S.tick = true; render(); fetchJob();
          }).catch(function (e) { b.disabled = false; b.textContent = old2; msg.appendChild(notice('err', e && e.message || ERR.gen)); });
        }, true); kids.push(go2); fin();
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
        if (j.vehicle_type === 'bike' && win.MXP_PCHK && win.MXP_PRO_CHECK) kids.push(big('gStepCheck', 'Pro Check 20 and test ride', function () { openCheck(j); }));
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
      if (['navigate', 'phone', 'receive', 'code', 'inspect', 'ready'].indexOf(page) >= 0 && (j.status === 'received' || j.status === 'in_work') && !S.suspended) {
        var ask = el('button', { class: 'g-link g-cancel-ask', type: 'button', id: 'gCancelAsk', text: 'Ask to cancel this job' });
        ask.onclick = function () {
          var cw = el('textarea', { class: 'g-input', id: 'gCancelWhy', rows: 2, maxlength: 200, placeholder: 'Why can you not do this job?', 'aria-label': 'Reason for cancelling' }), cm = el('div', { 'aria-live': 'polite' });
          var cg = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', id: 'gCancelGo', text: 'Send to the team', onclick: function () {
            clear(cm); var r0 = cw.value.trim(); if (r0.length < 5) { cm.appendChild(notice('err', 'Tell us why, in a few words.')); return; }
            cg.disabled = true; api('cancel_request', { id: j.id, reason: r0 }).then(function (r) { if (ended(r)) return; cg.disabled = false; if (!r.ok) { cm.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; } clear(cm); cm.appendChild(notice('ok', 'Sent. The team will reply. Until they approve, the job stays yours.')); cg.hidden = true; cw.hidden = true; });
          } });
          ask.replaceWith(el('div', { class: 'g-card' }, [el('p', { class: 'g-hint', text: 'A cancel request needs the team to approve it.' }), cw, cm, cg]));
        };
        kids.push(ask);
      }
      if ((page === 'inspect' || page === 'ready') && win.MXP_LIVE) kids.push(big('gStepLive', 'Share an update with the customer', function () { openLive(j); }));
      if (page !== 'offer') stopAlert();
      var tick = S.tick ? el('div', { class: 'g-tick', 'aria-hidden': 'true' }, [svgTick()]) : null; S.tick = false;
      return el('div', { class: 'g-wiz-page' + (page === 'offer' && j.status === 'sent' ? ' g-offer' : '') }, [tick, wizTop(j, page), el('h1', { class: 'g-wiz-h g-key', text: title })].concat(lines.map(function (t, i) { return el('p', { class: 'g-wiz-l', id: i === 0 ? 'gStepHint' : null, text: t }); }), [el('div', { class: 'g-wiz-btns' }, kids), msg]));
    }
    /* four big numeric boxes: one hidden number input holds the digits (numeric keypad), the boxes only show them */
    function codeBoxes(onDone) {
      var inp = el('input', { class: 'g-code-in', id: 'gCodeIn', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'one-time-code', 'aria-label': 'Customer 4-digit code' });
      var boxes = [0, 1, 2, 3].map(function () { return el('span', { class: 'g-code-box', 'aria-hidden': 'true' }); });
      var row = el('label', { class: 'g-code', for: 'gCodeIn' }, boxes.concat([inp]));
      function paint() { var v = inp.value; boxes.forEach(function (b, i) { b.textContent = v.charAt(i) ? '\u2022' : ''; b.className = 'g-code-box' + (i === v.length ? ' is-cur' : ''); }); }
      inp.oninput = function () { inp.value = cleanCode(inp.value); paint(); go.disabled = !isCode(inp.value); };
      var go = el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: 'gStepCode', disabled: true, text: 'Confirm code', onclick: function () {
        if (!isCode(inp.value)) return; buzz(15); go.disabled = true; go.textContent = 'Checking';
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
            el('select', { class: 'g-input', 'aria-label': 'Line ' + (i + 1) + ' type', onchange: function (e) { l.kind = e.target.value; draw(); } }, [['parts', 'Parts'], ['labour', 'Labour'], ['other', 'Other']].map(function (o) { return el('option', { value: o[0], selected: l.kind === o[0] ? true : null, text: o[1] }); })),
            l.kind === 'parts' ? el('select', { class: 'g-input', 'aria-label': 'Line ' + (i + 1) + ' Genuine or Equivalent', onchange: function (e) { l.part_type = e.target.value; } }, [['', 'Genuine or Equivalent?'], ['genuine', 'Genuine'], ['equivalent', 'Equivalent']].map(function (o) { return el('option', { value: o[0], selected: (l.part_type || '') === o[0] ? true : null, text: o[1] }); })) : null,
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
        var body = { id: j.id, lines: st.lines.map(function (l) { return l.kind === 'parts' ? { kind: l.kind, name: String(l.name).trim(), amount: Number(l.amount), part_type: l.part_type || '' } : { kind: l.kind, name: String(l.name).trim(), amount: Number(l.amount) }; }), notes: st.notes.trim() || null, hours: st.mode === 'hours' && st.hours !== '' ? Number(st.hours) : null, day: st.mode === 'day' && st.day ? st.day : null };
        for (var i = 0; i < body.lines.length; i++) { var l = body.lines[i]; if (l.name.length < 2) return msg.appendChild(notice('err', 'Line ' + (i + 1) + ' needs a name.')); if (!isFinite(l.amount) || l.amount < 0) return msg.appendChild(notice('err', 'Line ' + (i + 1) + ' needs an amount.')); if (l.kind === 'parts' && !l.part_type) return msg.appendChild(notice('err', 'Line ' + (i + 1) + ': mark the part as Genuine or Equivalent.')); }
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
    /* ---------- announcements (from the Mechanix Pro team) ---------- */
    var KIND_LABEL = { info: 'Update', policy: 'Policy', alert: 'Service alert' };
    function fetchUnread() { api('announcements').then(function (r) { if (ended(r) || !r.ok) return; S.annUnread = r.data.unread || 0; if (S.screen === 'home') render(); }); }
    function openAnnouncements() { S.screen = 'announcements'; S.ann = null; render(); api('announcements').then(function (r) { if (ended(r)) return; S.ann = r.ok ? r.data.announcements : 'error'; if (S.screen === 'announcements') render(); }); }
    function renderAnnouncements() {
      var body = [el('div', { class: 'g-h' }, [el('button', { class: 'g-link', type: 'button', onclick: function () { openHome(); }, text: '← Home' }), el('h1', { text: 'Announcements' })])], a = S.ann;
      if (a === null || a === undefined) body.push(loading('Loading'));
      else if (a === 'error') body.push(retryCard(ERR.gen, openAnnouncements));
      else if (!a.length) body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: 'No announcements right now.' })]));
      else a.forEach(function (x) {
        body.push(el('article', { class: 'g-card' + (x.read ? '' : ' g-unread') }, [el('p', { class: 'g-hint', text: (KIND_LABEL[x.kind] || 'Update') + ' · ' + (whenText(x.at) || '') }), el('h2', { text: x.title }), el('p', { text: x.body }),
          x.read ? null : el('button', { class: 'g-btn g-btn-ghost', type: 'button', text: 'Mark as read', onclick: function () { api('announcement_read', { announcement: x.id }).then(function () { x.read = true; S.annUnread = Math.max(0, (S.annUnread || 1) - 1); render(); }); } })]));
      });
      shell(body, 'home', true);
    }
    /* ---------- profile (view only), performance, and requests the team approves ---------- */
    var REQ_LABEL = { bank: 'Bank details', hours: 'Working hours', cancel: 'Cancel a job' }, REQ_STATE = { pending: 'Waiting for the team', approved: 'Approved', declined: 'Declined' };
    function openAccount() { S.screen = 'account'; S.acct = null; S.reqForm = null; render(); Promise.all([api('profile'), api('performance')]).then(function (rs) { if (ended(rs[0]) || ended(rs[1])) return; S.acct = rs[0].ok && rs[1].ok ? { profile: rs[0].data.profile, requests: rs[0].data.requests, perf: rs[1].data.performance } : 'error'; if (S.screen === 'account') render(); }); }
    function reqForm(kind) {
      var why = el('textarea', { class: 'g-input', id: 'gReqWhy', rows: 2, maxlength: 200, placeholder: kind === 'bank' ? 'What needs to change? Do not type account numbers. The team will ask for the documents on WhatsApp.' : 'Why are the hours changing?', 'aria-label': 'Reason' }), m = el('div', { 'aria-live': 'polite' });
      var days = el('input', { class: 'g-input', id: 'gReqDays', type: 'text', maxlength: 40, placeholder: 'Open days, for example Mon to Sat', 'aria-label': 'Open days' }), op = el('input', { class: 'g-input', id: 'gReqOpen', type: 'time', 'aria-label': 'Opens at' }), cl = el('input', { class: 'g-input', id: 'gReqClose', type: 'time', 'aria-label': 'Closes at' });
      var go = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', id: 'gReqGo', text: 'Send request', onclick: function () {
        clear(m); var body = { kind: kind, reason: why.value.trim() };
        if (body.reason.length < 5) { m.appendChild(notice('err', 'Tell us why, in a few words.')); return; }
        if (kind === 'hours') { body.details = { open_days: days.value.trim(), open_time: op.value, close_time: cl.value }; if (!body.details.open_days || !op.value || !cl.value) { m.appendChild(notice('err', 'Give the days, the opening time and the closing time.')); return; } }
        go.disabled = true; go.textContent = 'Sending';
        api('change_request', body).then(function (r) { if (ended(r)) return; go.disabled = false; go.textContent = 'Send request'; if (!r.ok) { m.appendChild(notice('err', r.data && r.data.error || ERR.gen)); return; } S.reqForm = null; openAccount(); });
      } });
      return el('div', { class: 'g-card' }, [el('h2', { text: kind === 'bank' ? 'Request a bank detail change' : 'Request a working hours change' })].concat(kind === 'hours' ? [days, el('div', { class: 'g-row' }, [op, cl])] : []).concat([why, m, go, el('button', { class: 'g-link', type: 'button', onclick: function () { S.reqForm = null; render(); }, text: 'Cancel' })]));
    }
    function renderAccount() {
      var body = [el('div', { class: 'g-h' }, [el('button', { class: 'g-link', type: 'button', onclick: function () { openHome(); }, text: '← Home' }), el('h1', { text: 'Profile and performance' })])], a = S.acct;
      if (a === null || a === undefined) { body.push(loading('Loading')); shell(body, 'home', true); return; }
      if (a === 'error') { body.push(retryCard(ERR.gen, openAccount)); shell(body, 'home', true); return; }
      var pf = a.perf, rows = [['Ratings', pf.rating_count ? pf.rating_avg + ' out of 5 (' + pf.rating_count + (pf.rating_count === 1 ? ' rating' : ' ratings') + ')' : 'No ratings yet'], ['Completed this month', pf.completed_month], ['Declined this week', pf.declined_week], ['Declined this month', pf.declined_month], ['Offers not accepted this month', pf.expired_month], ['Cancelled after accepting this month', pf.cancelled_month], ['Complaints open', pf.complaints_open], ['Complaints this month', pf.complaints_month]];
      body.push(el('section', { class: 'd-card', 'aria-label': 'Performance' }, [el('p', { class: 'd-label', text: 'Your performance' }), el('dl', { class: 'd-fig' }, rows.reduce(function (acc, r) { return acc.concat([el('dt', { text: r[0] }), el('dd', { text: String(r[1]) })]); }, []))]));
      var p = a.profile || {}, prow = [['Garage', p.name], ['Code', p.code], ['Contact person', p.owner_name], ['Address', [p.address, p.landmark, p.pincode, p.city].filter(Boolean).join(', ')], ['Works on', (p.categories || []).join(', ')], ['Bays', p.bays], ['Working days', p.open_days], ['Hours', p.open_time && p.close_time ? p.open_time + ' to ' + p.close_time : null], ['Bank details', 'Held by Mechanix Pro']].filter(function (r) { return r[1]; });
      body.push(el('section', { class: 'd-card', 'aria-label': 'Profile' }, [el('p', { class: 'd-label', text: 'Your profile' }), el('dl', { class: 'd-fig' }, prow.reduce(function (acc, r) { return acc.concat([el('dt', { text: r[0] }), el('dd', { text: String(r[1]) })]); }, [])), el('p', { class: 'g-hint', text: 'You cannot change these yourself. Send a request and the team approves it.' })]));
      if (S.reqForm) body.push(reqForm(S.reqForm));
      else if (!S.suspended) body.push(el('div', { class: 'g-row' }, [el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'gReqBank', onclick: function () { S.reqForm = 'bank'; render(); }, text: 'Request a bank detail change' }), el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'gReqHours', onclick: function () { S.reqForm = 'hours'; render(); }, text: 'Request a working hours change' })]));
      if (a.requests && a.requests.length) body.push(el('section', { class: 'd-card', 'aria-label': 'Your requests' }, [el('p', { class: 'd-label', text: 'Your requests' })].concat(a.requests.map(function (r) { return el('p', {}, [el('b', { text: (REQ_LABEL[r.kind] || r.kind) + ': ' }), el('span', { text: (REQ_STATE[r.status] || r.status) + (r.note ? '. ' + r.note : '') })]); }))));
      shell(body, 'home', true);
    }

    function renderHelp() {
      shell([el('div', { class: 'g-h' }, [el('h1', { text: 'Help' })]),
        section('Call or WhatsApp our team', [el('p', { text: 'Questions about a job, a payment or this app? Reach the Mechanix Pro team here.' }), teamButtons()]),
        section('Using this app', [el('ul', { class: 'g-bul' }, [el('li', { text: 'Tap a job to see the vehicle, the work and the customer’s first name.' }), el('li', { text: 'Mark each step as it happens. Add photos if you can.' }), el('li', { text: 'Work can start only after the customer approves the quote. Send your estimate first.' }), el('li', { text: 'Tap Lock when you leave the phone with others.' })])]),
        section('Add to your home screen', [el('div', { id: 'gInstall2' })])], 'help');
      if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall2'), win);
    }

    function render() {
      stopRing(); if (S.screen !== 'job') stopAlert();
      if (S.screen === 'pin') return renderPin(); if (S.screen === 'home') return renderHome(); if (S.screen === 'jobs') return renderJobs(); if (S.screen === 'leads') return renderLeads(); if (S.screen === 'job') return renderJob();
      if (S.screen === 'announcements') return renderAnnouncements(); if (S.screen === 'account') return renderAccount(); if (S.screen === 'statement') return renderStatement(); if (S.screen === 'help') return renderHelp();
      shell([loading('Opening')], null);
    }

    /* every 15 seconds: look for a newly assigned job this phone has not shown yet, and open its offer page */
    win.setInterval(function () {
      if (!S.session || d.hidden || S.screen === 'pin' || S.screen === 'boot') return;
      api('jobs').then(function (r) {
        if (ended(r) || !r.ok) return; S.jobs = r.data.jobs || []; S.jobsAt = Date.now();
        var busy = S.screen === 'job' && S.job && S.job !== 'error' && S.job.status !== 'sent' && S.job.status !== 'ready';
        var fresh = S.jobs.filter(function (x) { return x.status === 'sent' && !(S.seen || {})[x.id]; })[0];
        if (fresh && !busy && !(S.screen === 'job' && S.jobId === fresh.id)) openJob(fresh.id); else if (S.screen === 'jobs') render();
      });
    }, 15000);
    /* splash: once per session, CSS only, not shown for reduced motion */
    (function () {
      var seen = false; try { seen = win.sessionStorage.getItem('mxp_garage_splash') === '1'; win.sessionStorage.setItem('mxp_garage_splash', '1'); } catch (e) {}
      var calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (seen || calm) return;
      var n = 'http://www.w3.org/2000/svg', v = d.createElementNS(n, 'svg'), sh = d.createElementNS(n, 'path'), bo = d.createElementNS(n, 'path');
      v.setAttribute('viewBox', '0 0 100 120'); v.setAttribute('class', 'g-sp-svg'); v.setAttribute('aria-hidden', 'true');
      sh.setAttribute('d', 'M50 6 L90 22 V58 C90 84 72 102 50 114 C28 102 10 84 10 58 V22 Z'); sh.setAttribute('class', 'g-sp-shield'); bo.setAttribute('d', 'M56 30 L36 66 H50 L44 94 L66 55 H52 Z'); bo.setAttribute('class', 'g-sp-bolt'); v.appendChild(sh); v.appendChild(bo);
      var box = el('div', { class: 'g-splash', id: 'gSplash', 'aria-hidden': 'true' }, [v, el('b', { class: 'g-sp-name', text: 'Mechanix Pro' }), el('span', { class: 'g-sp-sub', text: 'Garage partner' })]);
      d.body.appendChild(box); win.setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1400);
    })();
    /* ---------- boot ---------- */
    var fromUrl = linkFromUrl(win.location.search);
    if (fromUrl) { saveLink(win, fromUrl); try { win.history.replaceState(null, '', '/garage/'); } catch (e) {} }
    var ses = savedSession(win);
    if (ses && savedLink(win)) { S.session = ses.t; S.name = ses.name || ''; loadTeam(); enter(); } else { go('pin'); }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && S.session && Date.now() - S.jobsAt > 60000) { if (S.screen === 'jobs') fetchJobs(); else if (S.screen === 'home') fetchHome(); } });
  }
  return { jobPage: jobPage, waitText: waitText, cleanCode: cleanCode, isCode: isCode, STEP_EVENT: STEP_EVENT, PAGES: PAGES, start: start, locText: locText, locAsked: locAsked, markLocAsked: markLocAsked, LOC_KEY: LOC_KEY, money: money, totals: totals, whenText: whenText, telHref: telHref, navigateUrl: navigateUrl, availabilityText: availabilityText, phoneShow: phoneShow, teamLinks: teamLinks, saveLink: saveLink, savedLink: savedLink, linkFromUrl: linkFromUrl, saveSession: saveSession, savedSession: savedSession, clearSession: clearSession, LINK_KEY: LINK_KEY, SESSION_KEY: SESSION_KEY };
});
