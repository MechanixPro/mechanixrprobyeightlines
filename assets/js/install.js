/* "Add to your home screen" and "Your booking". No inline script (CSP).
   - Chrome and Android: the browser says when the site can be installed (beforeinstallprompt); we keep that and show the button.
   - iPhone Safari never says it: we show the hint "Tap Share, then Add to Home Screen" (the page you add from is the one the icon opens, so add it from your tracking page).
   - The last booking (its private tracking token and booking ID only, no name, no phone) is kept in this browser (localStorage 'mxp_last_booking') so the home page and the installed app can show "Your booking".
   The footer button is kept as it was. MXP_INSTALL is also used by the thank-you on /book/ and the tracking page. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_INSTALL = api; api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'mxp_last_booking', DAY = 864e5, ev = null, mounts = [];
  var TOKEN = /^[0-9a-f]{32}$/;
  function platform(win) {
    var n = (win && win.navigator) || {}, ua = String(n.userAgent || ''), touchMac = /Macintosh/.test(ua) && n.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(ua) || touchMac ? 'ios' : /Android/.test(ua) ? 'android' : 'other';
  }
  function isStandalone(win) {
    try { return !!((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || (win.navigator && win.navigator.standalone)); } catch (e) { return false; }
  }
  function saveBooking(win, rec) {
    if (!rec || !TOKEN.test(String(rec.t || ''))) return false;
    var id = String(rec.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
    try { win.localStorage.setItem(KEY, JSON.stringify({ t: rec.t, id: id, at: Date.now() })); return true; } catch (e) { return false; }
  }
  function lastBooking(win, maxDays) {
    try {
      var r = JSON.parse(win.localStorage.getItem(KEY) || 'null');
      if (!r || !TOKEN.test(String(r.t || '')) || !(Number(r.at) > 0) || Date.now() - Number(r.at) > (maxDays || 30) * DAY) return null;
      return { t: r.t, id: String(r.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20), at: Number(r.at) };
    } catch (e) { return null; }
  }
  function clearBooking(win) { try { win.localStorage.removeItem(KEY); } catch (e) {} }
  var link = function (rec) { return '/track/?t=' + rec.t; };

  /* What the install area should say right now. Pure, so it can be tested: { kind: 'button' | 'ios' | 'menu' | 'installed' } */
  function state(win, hasPrompt) {
    if (isStandalone(win)) return { kind: 'installed' };
    if (hasPrompt) return { kind: 'button' };
    var p = platform(win);
    return p === 'ios' ? { kind: 'ios' } : { kind: 'menu' };
  }
  function paint(el, win) {
    var s = state(win, !!ev), d = win.document;
    el.textContent = '';
    if (s.kind === 'installed') { var m = d.createElement('p'); m.className = 'jy-install-note'; m.textContent = 'Mechanix Pro is on your home screen.'; el.appendChild(m); return s; }
    if (s.kind === 'button') {
      var b = d.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost wide jy-install-btn'; b.textContent = 'Add Mechanix Pro to your home screen';
      b.addEventListener('click', function () { if (!ev) return; var e = ev; ev = null; e.prompt(); if (e.userChoice) e.userChoice.then(refresh, refresh); });
      el.appendChild(b); return s;
    }
    var p = d.createElement('p'); p.className = 'jy-install-hint'; p.setAttribute('role', 'note');
    var b2 = d.createElement('b'); b2.textContent = 'Add Mechanix Pro to your home screen. ';
    p.appendChild(b2);
    p.appendChild(d.createTextNode(s.kind === 'ios' ? 'On iPhone, tap the Share button in Safari, then Add to Home Screen.' : 'Open your browser menu and choose Add to Home screen.'));
    el.appendChild(p); return s;
  }
  var gwin = null;
  function refresh() { if (!gwin) return; mounts.forEach(function (el) { paint(el, gwin); }); var f = gwin.document.getElementById('installApp'); if (f && !ev && f.parentNode) f.parentNode.removeChild(f); }
  function mount(el, win) { gwin = gwin || win; if (mounts.indexOf(el) < 0) mounts.push(el); return paint(el, win); }

  function footerButton(win) {
    var d = win.document, f = d.querySelector('footer'); if (!f || d.getElementById('installApp') || !ev) return;
    var b = d.createElement('button'); b.id = 'installApp'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = 'Add Mechanix Pro to your home screen';
    b.addEventListener('click', function () { if (!ev) return; var e = ev; ev = null; e.prompt(); if (e.userChoice) e.userChoice.then(refresh, refresh); });
    var w = d.createElement('div'); w.className = 'wrap install-row'; w.appendChild(b); f.appendChild(w);
  }

  /* The installed app opens the home page (manifest start_url). If this phone has a recent booking, go straight to its tracking page. ?stay=1 skips this (used by the Home link on the tracking page). */
  function appRedirect(win) {
    var loc = win.location, rec = lastBooking(win, 14);
    if (!rec || !isStandalone(win) || loc.pathname !== '/' || !/(^|[?&])source=pwa(&|$)/.test(loc.search) || /(^|[?&])stay=1(&|$)/.test(loc.search)) return false;
    loc.replace(link(rec)); return true;
  }
  /* A small "Your booking" strip at the top of the home page. */
  function homeStrip(win) {
    var d = win.document, rec = lastBooking(win, 30); if (!rec || win.location.pathname !== '/' || d.getElementById('yourBooking')) return;
    var main = d.getElementById('main') || d.querySelector('main'); if (!main) return;
    if (!d.getElementById('jyCss')) { var l = d.createElement('link'); l.id = 'jyCss'; l.rel = 'stylesheet'; l.href = '/assets/css/journey.css'; d.head.appendChild(l); }
    var a = d.createElement('a'); a.id = 'yourBooking'; a.className = 'jy-strip'; a.href = link(rec);
    var s = d.createElement('span'); s.textContent = 'Your booking' + (rec.id ? ' ' + rec.id : ''); var g = d.createElement('b'); g.textContent = 'Track it';
    a.appendChild(s); a.appendChild(g); main.insertBefore(a, main.firstChild);
  }
  function start(win) {
    gwin = win;
    if (appRedirect(win)) return;
    win.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); ev = e; footerButton(win); refresh(); });
    win.addEventListener('appinstalled', function () { ev = null; refresh(); });
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', function () { homeStrip(win); }); else homeStrip(win);
  }
  return { start: start, platform: platform, isStandalone: isStandalone, state: state, mount: mount, saveBooking: saveBooking, lastBooking: lastBooking, clearBooking: clearBooking, appRedirect: appRedirect, homeStrip: homeStrip, KEY: KEY };
});
