/* Ad reference: when someone who clicked a Google ad taps WhatsApp, the message ends with a short Ref code and the click (campaign, keyword, gclid)
   is saved under that code. When the booking is added in the admin, typing the code links the booking to the ad click, so ads are judged on real jobs.
   The code reveals nothing about the person. It is only added for visitors who arrived from an ad. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_ADREF = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', DAYS30 = 30 * 864e5;
  var strip = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); };

  function newCode(rand) {
    var out = '';
    for (var i = 0; i < 5; i++) out += ALPHA.charAt(Math.floor((rand ? rand() : Math.random()) * ALPHA.length) % ALPHA.length);
    return out;
  }
  function isAd(ctx) { ctx = ctx || {}; return !!(ctx.gclid || ctx.fbclid || (ctx.utm_source && ctx.utm_source !== 'direct')); }
  function parse(s) { try { var o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function readCtx(sessionJson, localJson, now) {
    var sess = parse(sessionJson), loc = parse(localJson), keep = {};
    if (loc.v && typeof loc.v === 'object' && loc.t && now - loc.t < DAYS30) Object.keys(loc.v).forEach(function (k) { keep[k] = loc.v[k]; });
    Object.keys(sess).forEach(function (k) { keep[k] = sess[k]; });
    return keep;
  }
  function tagText(text, code) {
    text = String(text == null ? '' : text);
    if (!code || /Ref:\s*[A-Z2-9]{5}/.test(text)) return text;
    return (text.replace(/\s+$/, '') ? text.replace(/\s+$/, '') + '\n\n' : '') + 'Ref: ' + code;
  }
  function tagWaUrl(url, code) {
    var m = /^(https:\/\/wa\.me\/\d*)(?:\?text=(.*))?$/.exec(String(url || ''));
    if (!m || !code) return url;
    var text = ''; try { text = decodeURIComponent(m[2] || ''); } catch (e) { return url; }
    return m[1] + '?text=' + encodeURIComponent(tagText(text, code));
  }
  function clickPayload(code, ctx, page) {
    var utm = {}; KEYS.forEach(function (k) { if (ctx && ctx[k]) utm[k] = strip(ctx[k], 100); });
    return { code: String(code || '').toUpperCase(), utm: utm, page: strip(page, 120) };
  }

  function start(win) {
    var C = win.MXP || {}, S, L;
    try { S = win.sessionStorage; L = win.localStorage; } catch (e) { return; }
    // keep what the ad click brought for 30 days, even if the tab is closed
    try {
      var p = new win.URLSearchParams(win.location.search), got = {}, any = false;
      KEYS.forEach(function (k) { if (p.get(k)) { got[k] = strip(p.get(k), 100); any = true; } });
      if (any) { var cur = parse(L.getItem('mxp_utm_30')); var v = {}; Object.keys(cur.v || {}).forEach(function (k) { v[k] = cur.v[k]; }); Object.keys(got).forEach(function (k) { v[k] = got[k]; }); L.setItem('mxp_utm_30', JSON.stringify({ t: Date.now(), v: v })); }
    } catch (e) {}
    function ctx() { try { return readCtx(S.getItem('mxp_utm'), L.getItem('mxp_utm_30'), Date.now()); } catch (e) { return {}; } }
    var sent = false;
    function code() {
      var c = ctx(); if (!isAd(c)) return '';
      var r = ''; try { r = S.getItem('mxp_ref') || ''; } catch (e) {}
      if (!r) { r = newCode(); try { S.setItem('mxp_ref', r); } catch (e) {} }
      if (!sent && C.supabaseUrl && C.supabaseAnonKey) {
        sent = true;
        try { win.fetch(C.supabaseUrl.replace(/\/$/, '') + '/functions/v1/log-click', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(clickPayload(r, c, win.location.pathname)) }).catch(function () {}); } catch (e) {}
      }
      return r;
    }
    win.MXP_ADREF = { tag: function (text) { return tagText(text, code()); }, ctx: ctx };
    // links that already point at WhatsApp (the chat's "Continue on WhatsApp", the floating button)
    win.document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="https://wa.me/"]') : null; if (!a) return;
      var r = code(); if (r) a.setAttribute('href', tagWaUrl(a.getAttribute('href'), r));
    }, true);
  }
  return { newCode: newCode, isAd: isAd, readCtx: readCtx, tagText: tagText, tagWaUrl: tagWaUrl, clickPayload: clickPayload, start: start };
});
