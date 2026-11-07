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
  var LINK_KEY = 'mxp_mech_link', SESSION_KEY = 'mxp_mech_session', LINK_RE = /^[0-9a-f]{48}$/;

  /* ---------- pure helpers ---------- */
  function money(n) { n = Number(n) || 0; return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function todayIST(now) { return new Date((now || Date.now()) + 5.5 * 3600e3).toISOString().slice(0, 10); }
  /* 2026-11-07 -> "Sat, 7 Nov". Built from the date's own parts so the phone's time zone never moves it. */
  function dayLabel(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
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
    function lock(msg) { clearSession(win); S.session = null; S.dash = null; S.jobs = null; S.dues = null; S.pay = null; S.cache = {}; S.msg = msg || null; go('pin'); }
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

    function shell(body, active, noHead) {
      clear(app);
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
            S.session = r.data.session; S.name = r.data.mechanic && r.data.mechanic.name || ''; S.area = r.data.mechanic && r.data.mechanic.area || ''; saveSession(win, r.data); S.msg = null; loadTeam(); S.date = todayIST(); openHome();
          });
        } }, [el('label', { class: 'g-label', for: 'gpin', text: 'PIN' }), input, el('p', { class: 'g-hint', text: 'The PIN is for you only. Do not share it.' }), msg, btn]));
      }
      kids.push(el('div', { class: 'g-install', id: 'gInstall' }));
      shell(kids, null); if (win.MXP_INSTALL) win.MXP_INSTALL.mount(d.getElementById('gInstall'), win);
      var i = d.getElementById('gpin'); if (i) try { i.focus(); } catch (e) {}
    }

    /* ---------- home ---------- */
    function loadTeam() { api('team_contact').then(function (r) { if (r.ok) S.team = { whatsapp: r.data.whatsapp, call: r.data.call }; }); }
    function openHome() { S.screen = 'home'; S.dash = null; S.jobs = null; S.dues = null; S.pay = null; render(); return refresh(); }
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
      if (S.statusBusy || !S.dash || S.dash === 'error') return; S.statusBusy = true; S.loc = ''; render();
      (status === 'available' ? whereAmI() : Promise.resolve(null)).then(function (pos) {
        var body = { status: status }; if (pos) { body.lat = pos.lat; body.lng = pos.lng; body.acc = pos.acc; }
        return api('status_set', body).then(function (r) {
          S.statusBusy = false; if (ended(r)) return;
          if (r.ok) { S.dash.mechanic.availability = r.data.availability; S.loc = status === 'available' ? (r.data.located ? 'Your location was saved.' : 'Location not shared. That is fine, you are still Available.') : ''; }
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
      return el('section', { class: 'd-card', 'aria-label': 'Current status' }, [el('p', { class: 'd-label', text: 'Current status' }),
        el('div', { class: 'd-toggle' }, [
          el('button', { class: 'd-opt' + (av === 'available' ? ' on-ok' : ''), type: 'button', id: 'dAvail', 'aria-pressed': av === 'available' ? 'true' : 'false', disabled: S.statusBusy || null, onclick: function () { setStatus('available'); }, text: 'Available' }),
          el('button', { class: 'd-opt' + (av === 'busy' ? ' on-off' : ''), type: 'button', id: 'dBusy', 'aria-pressed': av === 'busy' ? 'true' : 'false', disabled: S.statusBusy || null, onclick: function () { setStatus('busy'); }, text: 'Busy' })]),
        S.loc ? el('p', { class: 'g-hint', role: 'status', text: S.loc }) : null, S.statusErr ? notice('err', S.statusErr) : null]);
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

    function renderHome() {
      var dash = S.dash, body = [];
      var banner = el('div', { class: 'd-banner' }, [el('div', {}, [el('h1', { text: 'Hello, ' + (S.name || 'mechanic') }), S.area ? el('p', { text: S.area }) : null]), el('button', { class: 'd-out', type: 'button', id: 'dLogout', onclick: function () { lock('You are signed out.'); }, text: 'Logout' })]);
      body.push(banner);
      if (dash === null) { body.push(loading('Loading your day')); shell(body, 'home', true); return; }
      if (dash === 'error') { body.push(el('div', { class: 'g-card g-center' }, [el('p', { text: S.dashErr || ERR.gen }), el('button', { class: 'g-btn g-btn-primary', type: 'button', onclick: function () { S.dash = null; render(); refresh(); }, text: 'Retry' })])); shell(body, 'home', true); return; }
      body.push(cashCard(dash.cash));
      var p = payPanel(); if (p) body.push(p);
      body.push(el('section', { class: 'd-card', 'aria-label': 'Today’s bookings count' }, [el('p', { class: 'd-label', text: 'Today’s bookings' }), el('p', { class: 'd-big', id: 'dCount', text: String(S.date === dash.today ? dash.bookings_count : (S.jobs && S.jobs !== 'error' ? S.jobs.length : dash.bookings_count)) })]));
      body.push(el('section', { class: 'd-card', 'aria-label': 'Quick actions' }, [el('p', { class: 'd-label', text: 'Quick actions' }), el('button', { class: 'g-btn g-btn-primary d-xl', type: 'button', id: 'dGet', onclick: function () { S.date = todayIST(); S.dash = null; S.jobs = null; render(); refresh().then(function () { var b = d.getElementById('dBookings'); if (b && b.scrollIntoView) try { b.scrollIntoView({ block: 'start' }); } catch (e) {} }); }, text: 'Get my bookings' })]));
      body.push(statusCard(dash.mechanic.availability));
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
      if (S.screen === 'pin') return renderPin(); if (S.screen === 'home') return renderHome(); if (S.screen === 'help') return renderHelp();
      shell([loading('Opening')], null);
    }

    /* ---------- boot ---------- */
    var fromUrl = linkFromUrl(win.location.search);
    if (fromUrl) { saveLink(win, fromUrl); try { win.history.replaceState(null, '', '/mechanic/'); } catch (e) {} }
    var ses = savedSession(win);
    if (ses && savedLink(win)) { S.session = ses.t; S.name = ses.name || ''; loadTeam(); openHome(); } else { go('pin'); }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && S.session && S.screen === 'home' && !S.pay && Date.now() - S.at > 60000) refresh(); });
  }
  return { start: start, money: money, todayIST: todayIST, dayLabel: dayLabel, telHref: telHref, phoneShow: phoneShow, teamLinks: teamLinks, saveLink: saveLink, savedLink: savedLink, linkFromUrl: linkFromUrl, saveSession: saveSession, savedSession: savedSession, clearSession: clearSession, dueText: dueText, LINK_KEY: LINK_KEY, SESSION_KEY: SESSION_KEY };
});
