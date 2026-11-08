/* Mechanix Pro Mechanic: the mechanic app at /mechanic/. No inline script (CSP). Same pattern as /garage/:
   - The private link /mechanic/?m=<token> is saved on this phone, then removed from the address bar; the home-screen icon opens the PIN screen.
   - The PIN creates a 12-hour session (kept until it ends or you tap Logout). Nothing private is cached by a service worker.
   - The customer's address and email never reach this app. The customer's number appears only on an open booking. A job opens on the existing /job/ page (OTP, photos, quote, steps) through a fresh link.
   - Location is asked only when you tap Available, and the app works the same if you say no.
   Pure helpers are exported for tests; the screens start only in a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_MECH = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LINK_KEY = 'mxp_mech_link', SESSION_KEY = 'mxp_mech_session', LINK_RE = /^[0-9a-f]{48}$/, SEEN_KEY = 'mxp_mech_seen';

  /* ---------- pure helpers ---------- */
  function money(n) { n = Number(n) || 0; return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function todayIST(now) { return new Date((now || Date.now()) + 5.5 * 3600e3).toISOString().slice(0, 10); }
  /* 2026-11-07 -> "Sat, 7 Nov". Built from the date's own parts so the phone's time zone never moves it. */
  function dayLabel(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function waitText(sec) { sec = Math.max(0, Math.floor(Number(sec) || 0)); var m = Math.floor(sec / 60), r = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function telHref(p) { p = digits(p).slice(-10); return /^[6-9]\d{9}$/.test(p) ? 'tel:+91' + p : null; }
  function phoneShow(p) { p = digits(p).slice(-10); return /^[6-9]\d{9}$/.test(p) ? '+91 ' + p.slice(0, 5) + ' ' + p.slice(5) : ''; }
  function teamLinks(cfg, extra) {
    cfg = cfg || {}; extra = extra || {};
    var wa = digits(extra.whatsapp || cfg.whatsapp), call = digits(extra.call || cfg.callNumber || cfg.whatsapp);
    var out = { whatsapp: /^\d{12}$/.test(wa) ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi Mechanix Pro, this is our mechanic app. I need help.') : null, call: null };
    if (/^\d{12}$/.test(call) && !cfg.callViaWhatsApp) out.call = 'tel:+' + call;
    return out;
  }
  function saveLink(win, tok) { if (!LINK_RE.test(String(tok || ''))) return false; try { win.localStorage.setItem(LINK_KEY, tok); return true; } catch (e) { return false; } }
  function savedLink(win) { try { var t = win.localStorage.getItem(LINK_KEY); return LINK_RE.test(String(t || '')) ? t : null; } catch (e) { return null; } }
  function linkFromUrl(search) { var m = /(?:^|[?&])m=([0-9a-fA-F]{48})(?:&|$)/.exec(String(search || '')); return m ? m[1].toLowerCase() : null; }
  function saveSession(win, s) { try { win.localStorage.setItem(SESSION_KEY, JSON.stringify({ t: s.session, exp: Date.parse(s.expires_at), name: s.mechanic && s.mechanic.name || '' })); } catch (e) {} }
  function savedSession(win, now) { try { var r = JSON.parse(win.localStorage.getItem(SESSION_KEY) || 'null'); if (!r || !r.t || !(r.exp > (now || Date.now()))) { win.localStorage.removeItem(SESSION_KEY); return null; } return r; } catch (e) { return null; } }
  function clearSession(win) { try { win.localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  /* The words under a figure: what the mechanic owes, or that nothing is due. */
  function dueText(cash) { if (!cash) return ''; return cash.total_due > 0 ? 'Pay this to Mechanix Pro' : cash.company_owes > 0 ? 'Mechanix Pro owes you ' + money(cash.company_owes) : 'Nothing due. All settled.'; }
  var ERR = { net: 'We could not reach the server. Check your internet and try again.', gen: 'Something went wrong. Please try again.' };
  var CHIP = { completed: 'done', paid: 'new', scheduled: 'new' };

  /* ---------- the app ---------- */
  function start(win) {
    var d = win.document, C = win.MXP || {}, app = d.getElementById('app'); if (!app) return;
    var S = { session: null, name: '', area: '', screen: 'boot', dash: null, date: todayIST(), jobs: null, dues: null, duesOpen: false, pay: null, team: null, msg: null, loc: '', today: todayIST(), at: 0, cache: {} };
    var el = function (tag, attrs, kids) {
      var n = d.createElement(tag); attrs = attrs || {};
      Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); });
      (kids || []).forEach(function (c) { if (c == null || c === false) return; n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); }); return n;
    };
    var clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
    var url = function () { return String(C.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/mechanic-app'; };

    function api(action, body) {
      var payload = Object.assign({ action: action }, body || {}); if (S.session && action !== 'login') payload.session = S.session;
      return win.fetch(url(), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey || '', Authorization: 'Bearer ' + (C.supabaseAnonKey || '') }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok !== false, status: r.status, data: j }; }); })
        .catch(function () { return { ok: false, status: 0, data: { error: ERR.net }, network: true }; });
    }
    function ended(r) { if (r.status === 401 && r.data && r.data.code === 'session') { lock('Your session has ended. Enter your PIN again.'); return true; } return false; }
    function lock(msg) { stopAlert(); clearSession(win); S.session = null; S.dash = null; S.jobs = null; S.dues = null; S.pay = null; S.cache = {}; S.offers = null; S.msg = msg || null; go('pin'); }
    function go(screen) { S.screen = screen; render(); try { win.scrollTo(0, 0); } catch (e) {} }
    var notice = function (kind, text) { return el('p', { class: 'g-note g-note-' + kind, role: kind === 'err' ? 'alert' : 'status', text: text }); };
    var loading = function (t) { return el('div', { class: 'g-card g-center g-loading', role: 'status' }, [el('span', { class: 'g-spin', 'aria-hidden': 'true' }), el('p', { text: t || 'Loading' })]); };
    function teamButtons() {
      var t = teamLinks(C, S.team || {}), kids = [];
      if (t.whatsapp) kids.push(el('a', { class: 'g-btn g-btn-wa', href: t.whatsapp, rel: 'noopener', 'data-wa': 'team', text: 'WhatsApp our team' }));
      if (t.call) kids.push(el('a', { class: 'g-btn g-btn-ghost', href: t.call, 'data-call': 'team', text: 'Call our team' }));
      if (!kids.length) kids.push(el('p', { class: 'g-muted', text: 'The team number is not set on this page yet. Please use the number Mechanix Pro gave you.' }));
      return el('div', { class: 'g-row' }, kids);
    }


    /* ---------- partner look: haptics, alarm tone (Web Audio, no files), offer page, splash (same pattern as /garage/) ---------- */
    function buzz(p) { try { if (win.navigator && win.navigator.vibrate) win.navigator.vibrate(p); } catch (e) {} }
    var AC = null, alertTimer = null, ringTimer = null;
    function unlockAudio() { try { var C0 = win.AudioContext || win.webkitAudioContext; if (!C0) return; if (!AC) AC = new C0(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
    d.addEventListener('pointerdown', unlockAudio, true);
    function beep() { try { if (!AC || AC.state !== 'running') return; var t = AC.currentTime; [880, 1175].forEach(function (f, i) { var o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.22); g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.22 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2); o.connect(g); g.connect(AC.destination); o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.22); }); } catch (e) {} }
    function startAlert() { if (alertTimer) return; var ring = function () { beep(); buzz([300, 150, 300]); }; ring(); alertTimer = win.setInterval(ring, 2500); }
    function stopAlert() { if (alertTimer) { win.clearInterval(alertTimer); alertTimer = null; } buzz(0); }
    function stopRing() { if (ringTimer) { win.clearInterval(ringTimer); ringTimer = null; } }
    function seenMap() { try { return JSON.parse(win.localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function markSeen(id) { var m = seenMap(); m[id] = Date.now(); var ks = Object.keys(m); if (ks.length > 60) ks.sort(function (a, b) { return m[a] - m[b]; }).slice(0, ks.length - 60).forEach(function (k) { delete m[k]; }); try { win.localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch (e) {} }
    function svgTick() { var n = 'http://www.w3.org/2000/svg', v = d.createElementNS(n, 'svg'), c = d.createElementNS(n, 'circle'), q = d.createElementNS(n, 'path'); v.setAttribute('viewBox', '0 0 80 80'); v.setAttribute('width', '96'); v.setAttribute('height', '96'); c.setAttribute('cx', '40'); c.setAttribute('cy', '40'); c.setAttribute('r', '36'); q.setAttribute('d', 'M24 41l11 11 21-24'); v.appendChild(c); v.appendChild(q); return v; }
    function waitRing(j) {
      var t0 = j.assigned_at ? Date.parse(j.assigned_at) : Date.now(); if (!(t0 > 0)) t0 = Date.now();
      var n = 'http://www.w3.org/2000/svg', R = 54, C2 = 2 * Math.PI * R, svg = d.createElementNS(n, 'svg'), bg = d.createElementNS(n, 'circle'), fg = d.createElementNS(n, 'circle'); svg.setAttribute('viewBox', '0 0 128 128'); svg.setAttribute('class', 'g-ring-svg'); svg.setAttribute('aria-hidden', 'true');
      [bg, fg].forEach(function (c, i) { c.setAttribute('cx', '64'); c.setAttribute('cy', '64'); c.setAttribute('r', String(R)); c.setAttribute('class', i ? 'g-ring-fg' : 'g-ring-bg'); svg.appendChild(c); });
      fg.setAttribute('stroke-dasharray', String(C2));
      var txt = el('b', { class: 'g-ring-t', id: 'gWait' }), box = el('div', { class: 'g-ring', role: 'timer', 'aria-label': 'Time this offer has waited' }, [svg, el('div', { class: 'g-ring-in' }, [txt, el('span', { class: 'g-ring-c', text: 'waiting' })])]);
      function tickR() { var sec = Math.max(0, Math.floor((Date.now() - t0) / 1000)); txt.textContent = waitText(sec); fg.setAttribute('stroke-dashoffset', String(C2 * (1 - Math.min(1, sec / 900)))); }
      tickR(); stopRing(); ringTimer = win.setInterval(tickR, 1000); return box;
    }
    function offerOf(id) { var o = S.offers; if (!o || o === 'error') return null; for (var i = 0; i < o.length; i++) if (o[i].id === id) return o[i]; return null; }
    function openOffer(j) { markSeen(j.id); S.offerId = j.id; S.offerErr = null; S.tick = false; S.screen = 'offer'; render(); try { win.scrollTo(0, 0); } catch (e) {} }
    function renderOffer() {
      var j = offerOf(S.offerId); if (!j || j.accepted_at) { stopAlert(); return openHome(); }
      clear(app); app.classList.add('g-wiz'); app.classList.add('g-dark'); d.body.classList.add('g-dark-bg');
      startAlert();
      var msg = el('div', { id: 'gOfferMsg', 'aria-live': 'polite' }, S.offerErr ? [notice('err', S.offerErr)] : []);
      var accept = el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn g-accept', type: 'button', id: 'gOfferAccept', text: 'Accept job', onclick: function () { acceptOffer(j, this, msg); } });
      var cant = el('button', { class: 'g-btn g-btn-ghost g-cant', type: 'button', id: 'gCantTake', text: 'Can’t take it', onclick: function () { declineOffer(j, cant, msg); } });
      var tick = S.tick ? el('div', { class: 'g-tick', 'aria-hidden': 'true' }, [svgTick()]) : null; S.tick = false;
      var lines = [[j.area, j.slot, j.date && j.date !== S.today ? dayLabel(j.date) : 'Today'].filter(Boolean).join(' · ')];
      app.appendChild(el('main', { class: 'g-main', id: 'gmain', tabindex: '-1' }, [el('div', { class: 'g-wiz-page g-offer' }, [tick,
        el('p', { class: 'g-wiz-l', text: 'New job for you' }), el('h1', { class: 'g-wiz-h g-key', text: j.vehicle + ' · ' + j.service })].concat(lines.map(function (t) { return el('p', { class: 'g-wiz-l', id: 'gOfferHint', text: t }); }), [waitRing(j), el('div', { class: 'g-wiz-btns' }, [accept, cant]), msg]))]));
    }
    function acceptOffer(j, btn, msg) {
      stopAlert(); buzz(15); btn.disabled = true; btn.textContent = 'Accepting'; clear(msg);
      api('accept', { id: j.id }).then(function (r) {
        if (ended(r)) return;
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Accept job'; if (r.data && r.data.code === 'gone') { S.offerErr = null; S.offers = null; S.msg = null; return openHome(); } msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); startAlert(); return; }
        j.accepted_at = new Date().toISOString(); S.tick = true; render();
        win.setTimeout(function () {
          api('job_link', { id: j.id }).then(function (r2) {
            if (ended(r2)) return;
            if (r2.ok && /^\/job\/\?t=[0-9a-f]{64}$/.test(r2.data.url)) { win.location.href = r2.data.url; return; }
            S.openErr = { id: j.id, text: r2.data && r2.data.error || ERR.gen }; openHome();
          });
        }, 700);
      });
    }
    function declineOffer(j, btn, msg) {
      stopAlert(); btn.disabled = true; clear(msg);
      api('decline', { id: j.id, reason: 'Declined in the mechanic app' }).then(function (r) {
        if (ended(r)) return;
        if (!r.ok && !(r.data && r.data.code === 'gone')) { btn.disabled = false; msg.appendChild(notice('err', r.data && r.data.error || ERR.gen)); startAlert(); return; }
        j.declined = true; clear(msg);
        msg.appendChild(notice('info', 'The team has been told. Please call them now so they can send this job to someone else.'));
        msg.appendChild(teamButtons()); msg.appendChild(el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'gOfferHome', onclick: function () { openHome(); }, text: 'Back to Home' }));
      });
    }
    /* every 15 seconds: look for a newly assigned job this phone has not shown yet, and open its offer page */
    function pollOffers() {
      if (!S.session || d.hidden || S.screen === 'pin' || S.screen === 'boot' || S.screen === 'gate') return Promise.resolve();
      return api('offers').then(function (r) {
        if (ended(r) || !r.ok) return; S.offers = r.data.jobs || []; S.today = r.data.today || S.today;
        var seen = seenMap(), fresh = S.offers.filter(function (x) { return !x.accepted_at && !seen[x.id]; })[0];
        if (fresh && S.screen !== 'offer') openOffer(fresh); else if (S.screen === 'home') render();
      });
    }
    win.setInterval(pollOffers, 15000);
    /* splash: once per session, CSS only, not shown for reduced motion */
    (function () {
      var seen = false; try { seen = win.sessionStorage.getItem('mxp_mech_splash') === '1'; win.sessionStorage.setItem('mxp_mech_splash', '1'); } catch (e) {}
      var calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (seen || calm) return;
      var n = 'http://www.w3.org/2000/svg', v = d.createElementNS(n, 'svg'), sh = d.createElementNS(n, 'path'), bo = d.createElementNS(n, 'path');
      v.setAttribute('viewBox', '0 0 100 120'); v.setAttribute('class', 'g-sp-svg'); v.setAttribute('aria-hidden', 'true');
      sh.setAttribute('d', 'M50 6 L90 22 V58 C90 84 72 102 50 114 C28 102 10 84 10 58 V22 Z'); sh.setAttribute('class', 'g-sp-shield'); bo.setAttribute('d', 'M56 30 L36 66 H50 L44 94 L66 55 H52 Z'); bo.setAttribute('class', 'g-sp-bolt'); v.appendChild(sh); v.appendChild(bo);
      var box = el('div', { class: 'g-splash', id: 'gSplash', 'aria-hidden': 'true' }, [v, el('b', { class: 'g-sp-name', text: 'Mechanix Pro' }), el('span', { class: 'g-sp-sub', text: 'Mechanic partner' })]);
      d.body.appendChild(box); win.setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1400);
    })();

    function shell(body, active, noHead) {
      clear(app); app.classList.remove('g-wiz'); var dark = !!S.session && active === 'home'; app.classList.toggle('g-dark', dark); d.body.classList.toggle('g-dark-bg', dark);
      if (!noHead) app.appendChild(el('header', { class: 'g-top' }, [el('div', { class: 'g-brand' }, [el('img', { src: '/assets/img/logo-mark.webp', alt: '', width: 28, height: 28 }), el('div', {}, [el('b', { text: 'Mechanix Pro Mechanic' }), el('span', { text: S.name || '' })])])]));
      app.appendChild(el('main', { class: 'g-main', id: 'gmain', tabindex: '-1' }, body));
      if (S.session) app.appendChild(el('nav', { class: 'g-tabs g-tabs-2', 'aria-label': 'Mechanic app' }, [['home', 'Home'], ['help', 'Help']].map(function (t) {
        return el('button', { class: 'g-tab' + (active === t[0] ? ' on' : ''), type: 'button', 'aria-current': active === t[0] ? 'page' : null, onclick: function () { if (t[0] === 'home') openHome(); else go('help'); }, text: t[1] });
      })));
    }

    /* ---------- PIN ---------- */
    function renderPin() {
      var link = savedLink(win), kids = [el('h1', { text: link ? 'Enter your PIN' : 'Open your mechanic link' })];
      if (!link) {
        kids.push(el('p', { class: 'g-lead', text: 'Mechanix Pro sent you a private link on WhatsApp. Tap that link once on this phone, then this app opens straight to the PIN screen.' }), teamButtons());
      } else {
        var input = el('input', { id: 'gpin', class: 'g-input g-pin', type: 'password', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', 'aria-label': 'PIN, 4 to 6 digits', placeholder: '• • • •' });
        var btn = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'submit', id: 'gpinGo', text: 'Open my app' }), msg = el('div', { id: 'gpinMsg', 'aria-live': 'polite' }, S.msg ? [notice('info', S.msg)] : []);
        kids.push(el('form', { class: 'g-card', novalidate: true, onsubmit: function (e) {
          e.preventDefault(); var pin = input.value.replace(/\D/g, ''); clear(msg);
          if (pin.length < 4) { msg.appendChild(notice('err', 'Enter your 4 to 6 digit PIN.')); input.focus(); return; }
          btn.disabled = true; btn.textContent = 'Checking';
          api('login', { token: link, pin: pin }).then(function (r) {
            btn.disabled = false; btn.textContent = 'Open my app'; input.value = '';
            if (!r.ok) {
              var code = r.data && r.data.code, text = r.data && r.data.error || ERR.gen;
              if (code === 'pin' && r.data.left != null) text += ' ' + r.data.left + (r.data.left === 1 ? ' try left.' : ' tries left.');
              if (code === 'link') { try { win.localStorage.removeItem(LINK_KEY); } catch (e2) {} }
              S.msg = null; msg.appendChild(notice('err', text)); if (code === 'link') setTimeout(renderPin, 1200); return;
            }
            S.session = r.data.session; S.name = r.data.mechanic && r.data.mechanic.name || ''; S.area = r.data.mechanic && r.data.mechanic.area || ''; saveSession(win, r.data); S.msg = null; loadTeam(); S.date = todayIST(); enter();
          });
        } }, [el('label', { class: 'g-label', for: 'gpin', text: 'PIN' }), input, el('p', { class: 'g-hint', text: 'The PIN is for you only. Do not share it.' }), msg, btn]));
      }
      kids.push(el('div', { class: 'g-install', id: 'gInstall' }));
      shell(kids, null); if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall'), win);
      var i = d.getElementById('gpin'); if (i) try { i.focus(); } catch (e) {}
    }

    /* ---------- home ---------- */
    function loadTeam() { api('team_contact').then(function (r) { if (r.ok) S.team = { whatsapp: r.data.whatsapp, call: r.data.call }; }); }
    var F = function () { return win.MXP_FLOW; };
    /* After login: terms (once per version) and the tour (once), then Home. */
    function enter() {
      S.screen = 'gate'; render();
      api('me').then(function (r) {
        if (ended(r)) return;
        if (!r.ok || !F()) return openHome();
        S.selfieAt = r.data.selfie_at || null;
        F().runGate(win, app, { me: r.data, kind: 'mechanic', api: api, done: openHome });
      });
    }
    function openHome() { S.screen = 'home'; S.dash = null; S.jobs = null; S.dues = null; S.pay = null; render(); pollOffers(); return refresh(); }
    function refresh(keepPanels) {
      var dateAtStart = S.date;
      return Promise.all([api('dashboard', { date: dateAtStart }), api('jobs', { date: dateAtStart }), S.duesOpen || keepPanels ? api('dues') : Promise.resolve(null)]).then(function (rs) {
        if (rs.some(function (r) { return r && ended(r); })) return;
        var dash = rs[0], jobs = rs[1], dues = rs[2];
        S.dash = dash.ok ? dash.data : 'error'; S.dashErr = !dash.ok && dash.data && dash.data.error || ERR.gen;
        if (dash.ok) { if (dash.data.mechanic) { S.name = dash.data.mechanic.name || S.name; S.area = dash.data.mechanic.area || ''; } S.today = dash.data.today || S.today; }
        if (S.date === dateAtStart) S.jobs = jobs.ok ? jobs.data.jobs : 'error';
        if (dues) S.dues = dues.ok ? dues.data.dues : 'error';
        S.at = Date.now(); if (S.screen === 'home') render();
      });
    }
    function loadJobs() { S.jobs = null; render(); var dt = S.date; return api('jobs', { date: dt }).then(function (r) { if (ended(r)) return; if (S.date !== dt) return; S.jobs = r.ok ? r.data.jobs : 'error'; if (S.screen === 'home') render(); }); }
    function loadDues() { S.dues = null; render(); return api('dues').then(function (r) { if (ended(r)) return; S.dues = r.ok ? r.data.dues : 'error'; if (S.screen === 'home') render(); }); }

    /* location is asked only here, and only to remember where he was when he said Available */
    function whereAmI() {
      return new Promise(function (res) {
        var g = win.navigator && win.navigator.geolocation; if (!g) return res(null);
        var done = false, t = setTimeout(function () { if (!done) { done = true; res(null); } }, 9000);
        try { g.getCurrentPosition(function (p) { if (done) return; done = true; clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); }, function () { if (done) return; done = true; clearTimeout(t); res(null); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }); } catch (e) { done = true; clearTimeout(t); res(null); }
      });
    }
    function setStatus(status) {
      if (S.statusBusy || !S.dash || S.dash === 'error') return;
      if (status === 'available' && F() && !F().selfieFresh(S.selfieAt)) { S.statusErr = null; return F().showSelfie(win, app, { api: api, onDone: function (at) { S.selfieAt = at; S.screen = 'home'; render(); setStatus('available'); }, onCancel: function () { S.screen = 'home'; render(); } }); } S.statusBusy = true; S.loc = ''; render();
      (status === 'available' ? whereAmI() : Promise.resolve(null)).then(function (pos) {
        var body = { status: status }; if (pos) { body.lat = pos.lat; body.lng = pos.lng; body.acc = pos.acc; }
        return api('status_set', body).then(function (r) {
          S.statusBusy = false; if (ended(r)) return;
          if (r.ok) { S.dash.mechanic.availability = r.data.availability; S.loc = status === 'available' ? (r.data.located ? 'Your location was saved.' : 'Location not shared. That is fine, you are still Available.') : ''; }
          else if (r.data && r.data.code === 'selfie') { S.selfieAt = null; setStatus('available'); return; }
          else S.statusErr = r.data && r.data.error || ERR.gen;
          render();
        });
      });
    }
    function openBooking(job, btn) {
      btn.disabled = true; var old = btn.textContent; btn.textContent = 'Opening';
      api('job_link', { id: job.id }).then(function (r) {
        if (ended(r)) return; btn.disabled = false; btn.textContent = old;
        if (r.ok && /^\/job\/\?t=[0-9a-f]{64}$/.test(r.data.url)) { win.location.href = r.data.url; return; }
        S.openErr = { id: job.id, text: r.data && r.data.error || ERR.gen }; render();
      });
    }

    /* payment: the server makes the Razorpay link for the amount it computed; here it is shown with a QR code */
    function startPay(kind, id, qrOnly) {
      var key = kind === 'all' ? 'all' : id; S.pay = { key: key, busy: true, qrOnly: !!qrOnly, err: null }; render();
      var c = S.cache[key]; if (c && Date.now() - c.at < 10 * 60000) { S.pay = { key: key, url: c.url, amount: c.amount, qrOnly: !!qrOnly }; render(); scrollToPay(); return; }
      api('pay_link', kind === 'all' ? { all: true } : { id: id }).then(function (r) {
        if (ended(r)) return;
        if (!r.ok) { S.pay = { key: key, err: r.data && r.data.error || ERR.gen, qrOnly: !!qrOnly }; render(); return; }
        S.cache[key] = { url: r.data.url, amount: r.data.amount, at: Date.now() }; S.pay = { key: key, url: r.data.url, amount: r.data.amount, qrOnly: !!qrOnly }; render(); scrollToPay();
      });
    }
    function scrollToPay() { var p = d.getElementById('dPay'); if (p && p.scrollIntoView) try { p.scrollIntoView({ block: 'start' }); } catch (e) {} }
    function payPanel() {
      var p = S.pay; if (!p) return null;
      if (p.busy) return el('section', { class: 'd-card d-pay', id: 'dPay' }, [loading('Making your payment link')]);
      var close = el('button', { class: 'g-link', type: 'button', onclick: function () { S.pay = null; render(); }, text: 'Close' });
      if (p.err) return el('section', { class: 'd-card d-pay', id: 'dPay' }, [notice('err', p.err), close]);
      var qr; try { qr = win.MXP_QR ? win.MXP_QR.svg(d, p.url, 220) : null; } catch (e) { qr = null; }
      return el('section', { class: 'd-card d-pay', id: 'dPay', 'aria-live': 'polite' }, [
        el('p', { class: 'd-label', text: 'Pay Mechanix Pro' }), el('p', { class: 'd-big', text: money(p.amount) }),
        p.qrOnly ? null : el('a', { class: 'g-btn g-btn-primary g-wide', id: 'dPayGo', href: p.url, target: '_blank', rel: 'noopener', text: 'Pay ' + money(p.amount) + ' now' }),
        el('div', { class: 'd-qr' }, [qr || el('p', { class: 'g-muted', text: 'The QR code could not be drawn. Use the button or the link.' }), el('p', { class: 'g-hint', text: 'Scan with any UPI app.' }), el('p', { class: 'd-link', id: 'dPayUrl', text: p.url })]),
        el('div', { class: 'd-row' }, [
          el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'dCopy', onclick: function (e) { var b = e.currentTarget; try { win.navigator.clipboard.writeText(p.url).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; }); } catch (x) { b.textContent = 'Copy failed'; } }, text: 'Copy link' }),
          el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'dPaid', onclick: function () { S.pay = null; S.dash = null; S.dues = null; render(); refresh(true); }, text: 'I have paid, refresh' })]),
        el('p', { class: 'g-hint', text: 'The amount drops from your dues a minute after the payment goes through.' }), close]);
    }

    function cashCard(c) {
      var due = c.total_due > 0;
      return el('section', { class: 'd-card', 'aria-label': 'Cash dues' }, [
        el('p', { class: 'd-label', text: 'Cash dues' }), el('p', { class: 'd-big ' + (due ? 'd-owe' : 'd-ok'), id: 'dTotalDue', text: money(c.total_due) }), el('p', { class: 'g-hint', text: dueText(c) }),
        due ? el('div', { class: 'd-row' }, [el('button', { class: 'g-btn g-btn-primary', type: 'button', id: 'dPayAll', onclick: function () { startPay('all'); }, text: 'Pay all' }), el('button', { class: 'g-btn g-btn-ghost', type: 'button', id: 'dQrAll', onclick: function () { startPay('all', null, true); }, text: 'QR code' })]) : null]);
    }
    function statusCard(av) {
      var on = av === 'available';
      return el('section', { class: 'd-avail' + (on ? ' on' : ' off'), 'aria-label': 'Availability' }, [
        el('div', { class: 'd-avail-txt' }, [el('p', { class: 'd-avail-title', id: 'dAvailTitle', text: on ? 'Available for jobs' : 'Not available' }), el('p', { class: 'g-hint', text: 'Crew will not send you new jobs while you are not available.' }),
          S.loc ? el('p', { class: 'g-hint', role: 'status', text: S.loc }) : null, F() && S.selfieAt ? el('p', { class: 'g-hint', id: 'dSelfie', text: F().selfieLine(S.selfieAt) }) : null, S.statusErr ? notice('err', S.statusErr) : null]),
        el('button', { class: 'd-sw', type: 'button', role: 'switch', id: 'dAvailSwitch', 'aria-checked': on ? 'true' : 'false', 'aria-label': 'Available for jobs', disabled: S.statusBusy || null, onclick: function () { setStatus(on ? 'busy' : 'available'); } }, [el('span', { class: 'd-knob' })])]);
    }
    function statsCard(m) {
      return el('section', { class: 'd-card', 'aria-label': 'My monthly stats' }, [el('p', { class: 'd-label', text: 'My monthly stats' }), el('div', { class: 'd-stats' }, [
        el('div', {}, [el('b', { text: String(m.bookings) }), el('span', { text: 'Total bookings' })]), el('div', {}, [el('b', { text: String(m.completions) }), el('span', { text: 'Completions' })]), el('div', {}, [el('b', { text: m.completions ? money(m.avg_ticket) : '—' }), el('span', { text: 'Average ticket' })])])]);
    }
    function unsettledCard() {
      var n = S.dash && S.dash !== 'error' ? S.dash.cash.unsettled_count : 0, body;
      if (!S.duesOpen) body = [];
      else if (S.dues === null) body = [loading('Loading')];
      else if (S.dues === 'error') body = [notice('err', 'We could not load your dues.'), el('button', { class: 'g-btn g-btn-ghost', type: 'button', onclick: loadDues, text: 'Retry' })];
      else if (!S.dues.unsettled.length) body = [el('p', { class: 'g-muted', text: 'No unsettled jobs.' })];
      else body = S.dues.unsettled.map(function (u) {
        return el('article', { class: 'd-job', 'data-due': u.id }, [
          el('div', { class: 'd-job-top' }, [el('b', { text: (u.booking_id || 'Booking') + ' · ' + u.service }), el('span', { class: 'g-muted', text: dayLabel(u.date) })]),
          el('dl', { class: 'd-fig' }, [el('dt', { text: 'Total collected' }), el('dd', { text: money(u.total_collected) }), el('dt', { text: 'Your payout (labour)' }), el('dd', { text: money(u.mechanic_payout) }), el('dt', { class: 'due', text: 'Due to platform' }), el('dd', { class: 'due', text: money(u.due_to_platform) })]),
          el('div', { class: 'd-row' }, [el('button', { class: 'g-btn g-btn-primary d-mini', type: 'button', 'data-pay': u.id, onclick: function () { startPay('job', u.id); }, text: 'Pay ' + money(u.due_to_platform) }), el('button', { class: 'g-btn g-btn-ghost d-mini', type: 'button', 'data-qr': u.id, onclick: function () { startPay('job', u.id, true); }, text: 'QR code' })])]);
      });
      var det = el('details', { class: 'd-fold', id: 'dUnsettled' }, [el('summary', { text: 'Previous unsettled (' + n + ')' }), el('div', { class: 'd-fold-body' }, body)]);
      if (S.duesOpen) det.setAttribute('open', '');
      det.addEventListener('toggle', function () { var open = det.hasAttribute('open'); if (open !== S.duesOpen) { S.duesOpen = open; if (open && S.dues === null) api('dues').then(function (r) { if (ended(r)) return; S.dues = r.ok ? r.data.dues : 'error'; if (S.screen === 'home') render(); }); } });
      return det;
    }

    function bookingCard(j) {
      var btn = el('button', { class: 'g-btn g-btn-primary g-wide', type: 'button', 'data-open': j.id, text: 'Open job' }); btn.addEventListener('click', function () { openBooking(j, btn); });
      var tel = j.customer_phone ? telHref(j.customer_phone) : null;
      return el('article', { class: 'd-job', 'data-job': j.id }, [
        el('div', { class: 'd-job-top' }, [el('b', { text: (j.booking_id || 'Booking') + ' · ' + j.service }), el('span', { class: 'g-chip g-chip-' + (CHIP[j.status] || 'new'), text: j.status_label })]),
        el('p', { class: 'g-muted', text: [j.vehicle + (j.reg_no ? ' ' + j.reg_no : ''), j.area, j.slot].filter(Boolean).join(' · ') }),
        el('p', { class: 'g-big', text: j.customer_first_name }),
        el('div', { class: 'd-row' }, [tel ? el('a', { class: 'g-btn g-btn-ghost', href: tel, 'data-call-customer': j.id, text: 'Call ' + phoneShow(j.customer_phone) }) : null, j.can_open ? btn : null]),
        S.openErr && S.openErr.id === j.id ? notice('err', S.openErr.text) : null]);
    }
    function bookings() {
      var kids = [el('p', { class: 'd-label', id: 'dBookings', text: S.date === S.today ? 'Today’s bookings' : 'Bookings on ' + dayLabel(S.date) })];
      if (S.jobs === null) kids.push(loading('Loading your bookings'));
      else if (S.jobs === 'error') kids.push(notice('err', 'We could not load your bookings.'), el('button', { class: 'g-btn g-btn-ghost', type: 'button', onclick: loadJobs, text: 'Retry' }));
      else if (!S.jobs.length) kids.push(el('div', { class: 'd-card g-center' }, [el('p', { text: 'No bookings for this day.' })]));
      else S.jobs.forEach(function (j) { kids.push(bookingCard(j)); });
      return el('section', { class: 'g-list', 'aria-live': 'polite' }, kids);
    }

    /* Home: "Today: N jobs" and the next job (accepted jobs first, soonest first; a job still waiting for Accept shows View offer) */
    function nextJob() {
      var o = S.offers; if (!o || o === 'error') return null;
      var rank = { asap: 0, morning: 1, afternoon: 2, evening: 3 };
      var list = o.filter(function (x) { return !x.declined; }).slice().sort(function (a, b) { return (a.accepted_at ? 1 : 0) - (b.accepted_at ? 1 : 0) || String(a.date).localeCompare(String(b.date)) || (rank[a.slot] || 4) - (rank[b.slot] || 4); });
      return list[0] || null;
    }
    function nextCard() {
      var dash = S.dash, n = dash && dash !== 'error' && S.date === dash.today ? dash.bookings_count : null, nx = nextJob(), kids = [el('p', { class: 'g-wiz-l', id: 'dTodayJobs', text: 'Today: ' + (n == null ? '-' : n) + (n === 1 ? ' job' : ' jobs') })];
      if (!nx) kids.push(el('p', { class: 'g-wiz-l', text: 'No job waiting. Stay Available and we will ring you.' }));
      else {
        kids.push(el('p', { class: 'g-wiz-l', text: nx.accepted_at ? 'Next job' : 'New job waiting' }), el('p', { class: 'g-key', id: 'dNextJob', text: nx.vehicle + ' · ' + nx.service }), el('p', { class: 'g-wiz-l', text: [nx.area, nx.slot, nx.date && nx.date !== S.today ? dayLabel(nx.date) : 'Today'].filter(Boolean).join(' · ') }));
        var b = el('button', { class: 'g-btn g-btn-primary g-wide g-step-btn', type: 'button', id: 'dNextGo', text: nx.accepted_at ? 'Open job' : 'View offer' });
        b.addEventListener('click', function () { if (nx.accepted_at) openBooking(nx, b); else openOffer(nx); }); kids.push(b);
      }
      return el('section', { class: 'g-next-card', 'aria-label': 'Next job' }, kids);
    }
    function renderHome() {
      var dash = S.dash, body = [];
      var banner = el('div', { class: 'd-banner' }, [el('div', {}, [el('h1', { text: 'Hello, ' + (S.name || 'mechanic') }), S.area ? el('p', { text: S.area }) : null]), el('button', { class: 'd-out', type: 'button', id: 'dLogout', onclick: function () { lock('You are signed out.'); }, text: 'Logout' })]);
      body.push(banner);
      if (dash === null) { body.push(loading('Loading your day')); shell(body, 'home', true); return; }
      if (dash === 'error') { body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: S.dashErr || ERR.gen }), el('button', { class: 'g-btn g-btn-primary', type: 'button', onclick: function () { S.dash = null; render(); refresh(); }, text: 'Retry' })])); shell(body, 'home', true); return; }
      body.push(statusCard(dash.mechanic.availability));
      body.push(nextCard());
      body.push(cashCard(dash.cash));
      var p = payPanel(); if (p) body.push(p);
      body.push(el('section', { class: 'd-card', 'aria-label': 'Today’s bookings count' }, [el('p', { class: 'd-label', text: 'Today’s bookings' }), el('p', { class: 'd-big', id: 'dCount', text: String(S.date === dash.today ? dash.bookings_count : (S.jobs && S.jobs !== 'error' ? S.jobs.length : dash.bookings_count)) })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Quick actions' }, [el('p', { class: 'd-label', text: 'Quick actions' }), el('button', { class: 'g-btn g-btn-primary d-xl', type: 'button', id: 'dGet', onclick: function () { S.date = todayIST(); S.dash = null; S.jobs = null; render(); refresh().then(function () { var b = d.getElementById('dBookings'); if (b && b.scrollIntoView) try { b.scrollIntoView({ block: 'start' }); } catch (e) {} }); }, text: 'Get my bookings' })]));
      body.push(statsCard(dash.month));
      body.push(unsettledCard());
      var dateIn = el('input', { class: 'g-input', type: 'date', id: 'dDate', value: S.date, 'aria-label': 'Booking date', onchange: function (e) { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { S.date = e.target.value; loadJobs(); } } });
      body.push(el('section', { class: 'd-card' }, [el('label', { class: 'd-label', for: 'dDate', text: 'Booking date' }), el('div', { class: 'd-date' }, [dateIn])]));
      body.push(bookings());
      shell(body, 'home', true);
    }

    function renderHelp() {
      shell([el('div', { class: 'g-h' }, [el('h1', { text: 'Help' })]),
        el('section', { class: 'g-card' }, [el('h2', { text: 'Call or WhatsApp our team' }), el('p', { text: 'Questions about a job, a payment or this app? Reach the Mechanix Pro team here.' }), teamButtons()]),
        el('section', { class: 'g-card' }, [el('h2', { text: 'Using this app' }), el('ul', { class: 'g-bul' }, [el('li', { text: 'Tap Available when you can take work, Busy when you cannot.' }), el('li', { text: 'Tap Open job to run the visit: arrival, the customer’s code, photos and the quote.' }), el('li', { text: 'Cash you collected at the door is shown under Cash dues. Pay it with the button or the QR code.' }), el('li', { text: 'Tap Logout when you leave the phone with others.' })])]),
        el('section', { class: 'g-card' }, [el('h2', { text: 'Add to your home screen' }), el('div', { id: 'gInstall2' })])], 'help');
      if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall2'), win);
    }

    function render() {
      stopRing(); if (S.screen !== 'offer') stopAlert();
      if (S.screen === 'pin') return renderPin(); if (S.screen === 'home') return renderHome(); if (S.screen === 'help') return renderHelp();
      if (S.screen === 'offer') return renderOffer();
      shell([loading('Opening')], null);
    }

    /* ---------- boot ---------- */
    var fromUrl = linkFromUrl(win.location.search);
    if (fromUrl) { saveLink(win, fromUrl); try { win.history.replaceState(null, '', '/mechanic/'); } catch (e) {} }
    var ses = savedSession(win);
    if (ses && savedLink(win)) { S.session = ses.t; S.name = ses.name || ''; loadTeam(); enter(); } else { go('pin'); }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && S.session && S.screen === 'home' && !S.pay && Date.now() - S.at > 60000) refresh(); });
  }
  return { start: start, money: money, todayIST: todayIST, dayLabel: dayLabel, telHref: telHref, phoneShow: phoneShow, teamLinks: teamLinks, waitText: waitText, saveLink: saveLink, savedLink: savedLink, linkFromUrl: linkFromUrl, saveSession: saveSession, savedSession: savedSession, clearSession: clearSession, dueText: dueText, LINK_KEY: LINK_KEY, SESSION_KEY: SESSION_KEY };
});
